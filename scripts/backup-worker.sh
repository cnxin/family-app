#!/bin/sh
set -eu

DB_HOST=${DB_HOST:-db}
DB_PORT=${DB_PORT:-5432}
DB_USER=${DB_USER:-family}
DB_NAME=${DB_NAME:-family_app}
BACKUP_ROOT=${BACKUP_ROOT:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/source/uploads}
RESTORE_WORK_ROOT=${RESTORE_WORK_ROOT:-/restore-work}
POLL_SECONDS=${BACKUP_WORKER_POLL_SECONDS:-15}
APP_GIT_COMMIT=${APP_GIT_COMMIT:-unknown}
RUN_ONCE=${BACKUP_WORKER_ONCE:-false}

if [ -n "${DB_PASSWORD_FILE:-}" ]; then
  if [ ! -r "$DB_PASSWORD_FILE" ]; then
    printf 'Database password file is not readable.\n' >&2
    exit 2
  fi
  PGPASSWORD=$(tr -d '\r\n' <"$DB_PASSWORD_FILE")
else
  PGPASSWORD=${DB_PASSWORD:-}
fi
export PGPASSWORD

case "$DB_NAME" in
  ''|*[!A-Za-z0-9_]*)
    printf 'DB_NAME may contain only letters, numbers, and underscores.\n' >&2
    exit 2
    ;;
esac

case "$POLL_SECONDS" in
  ''|*[!0-9]*) POLL_SECONDS=15 ;;
esac
if [ "$POLL_SECONDS" -lt 2 ]; then POLL_SECONDS=2; fi
if [ "$POLL_SECONDS" -gt 300 ]; then POLL_SECONDS=300; fi

mkdir -p "$BACKUP_ROOT" "$RESTORE_WORK_ROOT"

psql_database() {
  database=$1
  shift
  psql -X --no-psqlrc -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$database" "$@"
}

psql_main() {
  psql_database "$DB_NAME" "$@"
}

is_uuid() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
}

checksum_files() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum database.dump uploads.tar.gz manifest.txt
  else
    shasum -a 256 database.dump uploads.tar.gz manifest.txt
  fi
}

verify_checksums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c checksums.sha256
  else
    shasum -a 256 -c checksums.sha256
  fi
}

claim_run() {
  psql_main -At -F '|' -c "
    WITH candidate AS (
      SELECT id
      FROM backup_runs
      WHERE status = 'queued'
      ORDER BY \"createdAt\" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    ), claimed AS (
      UPDATE backup_runs run
      SET status = 'running',
          \"startedAt\" = now(),
          \"heartbeatAt\" = now(),
          \"updatedAt\" = now()
      FROM candidate
      WHERE run.id = candidate.id
      RETURNING run.*
    )
    SELECT claimed.id,
           claimed.\"householdId\",
           claimed.kind,
           COALESCE(source.\"backupLabel\", '')
    FROM claimed
    LEFT JOIN backup_runs source ON source.id = claimed.\"sourceBackupRunId\"
  "
}

update_worker_presence() {
  psql_main -q -c 'UPDATE backup_policies SET "workerLastSeenAt" = now()' >/dev/null
}

update_run_failed() {
  run_id=$1
  code=$2
  message=$3
  psql_main -q -c "
    UPDATE backup_runs
    SET status = 'failed',
        \"finishedAt\" = now(),
        \"heartbeatAt\" = now(),
        \"errorCode\" = '$code',
        \"errorMessage\" = '$message',
        \"updatedAt\" = now()
    WHERE id = '$run_id' AND status = 'running'
  " >/dev/null
}

heartbeat_loop() {
  run_id=$1
  while :; do
    sleep 30
    psql_main -q -c "
      UPDATE backup_runs SET \"heartbeatAt\" = now(), \"updatedAt\" = now()
      WHERE id = '$run_id' AND status = 'running'
    " >/dev/null 2>&1 || true
  done
}

stop_heartbeat() {
  if [ -n "${HEARTBEAT_PID:-}" ]; then
    kill "$HEARTBEAT_PID" >/dev/null 2>&1 || true
    wait "$HEARTBEAT_PID" >/dev/null 2>&1 || true
    HEARTBEAT_PID=
  fi
}

storage_numbers() {
  df -Pk "$BACKUP_ROOT" | awk 'NR == 2 { print $2 "|" $3 "|" $4 }'
}

check_capacity_for_household() {
  household_id=$1
  thresholds=$(psql_main -At -F '|' -c "
    SELECT \"capacityWarningPercent\", \"capacityCriticalPercent\"
    FROM backup_policies WHERE \"householdId\" = '$household_id'
  ")
  [ -n "$thresholds" ] || return 1
  old_ifs=$IFS
  IFS='|'
  set -- $thresholds
  IFS=$old_ifs
  warning=$1
  critical=$2
  numbers=$(storage_numbers)
  old_ifs=$IFS
  IFS='|'
  set -- $numbers
  IFS=$old_ifs
  total_bytes=$(($1 * 1024))
  used_bytes=$(($2 * 1024))
  available_bytes=$(($3 * 1024))
  if [ "$total_bytes" -le 0 ]; then
    return 1
  fi
  used_percent=$((used_bytes * 100 / total_bytes))
  capacity_status=ok
  if [ "$used_percent" -ge "$critical" ]; then
    capacity_status=critical
  elif [ "$used_percent" -ge "$warning" ]; then
    capacity_status=warning
  fi
  psql_main -q -c "
    UPDATE backup_policies
    SET \"lastStorageCheckedAt\" = now(),
        \"storageTotalBytes\" = $total_bytes,
        \"storageAvailableBytes\" = $available_bytes,
        \"storageUsedBytes\" = $used_bytes,
        \"capacityStatus\" = '$capacity_status',
        \"capacityNotifiedStatus\" = CASE
          WHEN '$capacity_status' = 'ok' THEN NULL
          ELSE \"capacityNotifiedStatus\" END,
        \"capacityAlertedAt\" = CASE
          WHEN '$capacity_status' = 'ok' THEN NULL
          ELSE \"capacityAlertedAt\" END,
        \"workerLastSeenAt\" = now()
    WHERE \"householdId\" = '$household_id'
  " >/dev/null
}

check_all_capacity() {
  psql_main -At -c 'SELECT "householdId" FROM backup_policies ORDER BY "createdAt"' |
  while IFS= read -r household_id; do
    if is_uuid "$household_id"; then
      check_capacity_for_household "$household_id" || true
    fi
  done
}

apply_retention() {
  household_id=$1
  current_run_id=$2
  policy=$(psql_main -At -F '|' -c "
    SELECT \"retentionDays\", \"retentionCount\"
    FROM backup_policies WHERE \"householdId\" = '$household_id'
  ")
  old_ifs=$IFS
  IFS='|'
  set -- $policy
  IFS=$old_ifs
  retention_days=$1
  retention_count=$2
  candidates=$(psql_main -At -F '|' -c "
    WITH ranked AS (
      SELECT id, \"backupLabel\", \"createdAt\",
             row_number() OVER (ORDER BY \"createdAt\" DESC) AS position
      FROM backup_runs
      WHERE \"householdId\" = '$household_id'
        AND kind = 'backup'
        AND status = 'succeeded'
        AND retained = true
    )
    SELECT id, \"backupLabel\"
    FROM ranked
    WHERE id <> '$current_run_id'
      AND (position > $retention_count OR \"createdAt\" < now() - interval '$retention_days days')
  ")
  if [ -n "$candidates" ]; then
    printf '%s\n' "$candidates" |
    while IFS='|' read -r stale_id stale_label; do
      if is_uuid "$stale_id" &&
         printf '%s' "$stale_label" | grep -Eq "^$household_id/[0-9a-f-]{36}$"; then
        stale_dir="$BACKUP_ROOT/$stale_label"
        if [ -d "$stale_dir" ]; then rm -rf "$stale_dir"; fi
        psql_main -q -c "
          UPDATE backup_runs
          SET retained = false, \"purgedAt\" = now(), \"updatedAt\" = now()
          WHERE id = '$stale_id' AND \"householdId\" = '$household_id'
        " >/dev/null
      fi
    done
  fi
  psql_main -At -c "
    SELECT count(*) FROM backup_runs
    WHERE \"householdId\" = '$household_id'
      AND kind = 'backup'
      AND retained = false
      AND \"purgedAt\" >= (SELECT \"startedAt\" FROM backup_runs WHERE id = '$current_run_id')
  "
}

create_backup() {
  run_id=$1
  household_id=$2
  is_uuid "$run_id" && is_uuid "$household_id" || return 1
  household_dir="$BACKUP_ROOT/$household_id"
  backup_dir="$household_dir/$run_id"
  [ ! -e "$backup_dir" ] || return 1
  mkdir -p "$backup_dir"
  touch "$backup_dir/.incomplete"

  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --format=custom --no-owner --no-privileges >"$backup_dir/database.dump" || return 1

  uploads_parent=$(dirname "$UPLOADS_DIR")
  uploads_name=$(basename "$UPLOADS_DIR")
  [ -d "$UPLOADS_DIR" ] || return 1
  tar -C "$uploads_parent" -czf "$backup_dir/uploads.tar.gz" "$uploads_name" || return 1

  migrations=$(psql_main -At -c \
    "SELECT COALESCE(string_agg(name, ',' ORDER BY timestamp), 'none') FROM app_migrations") || return 1
  created_at=$(date -u +%Y%m%d-%H%M%SZ)
  {
    printf 'created_at_utc=%s\n' "$created_at"
    printf 'git_commit=%s\n' "$APP_GIT_COMMIT"
    printf 'database=%s\n' "$DB_NAME"
    printf 'household_control_id=%s\n' "$household_id"
    printf 'backup_run_id=%s\n' "$run_id"
    printf 'migrations=%s\n' "$migrations"
    printf 'worker=family-app-backup-worker\n'
  } >"$backup_dir/manifest.txt"
  (
    cd "$backup_dir"
    checksum_files >checksums.sha256
  ) || return 1
  chmod 600 "$backup_dir/database.dump" "$backup_dir/uploads.tar.gz"
  rm "$backup_dir/.incomplete"

  database_bytes=$(wc -c <"$backup_dir/database.dump" | tr -d ' ')
  uploads_bytes=$(wc -c <"$backup_dir/uploads.tar.gz" | tr -d ' ')
  total_bytes=$((database_bytes + uploads_bytes))
  label="$household_id/$run_id"
  psql_main -q -c "
    UPDATE backup_runs
    SET status = 'succeeded',
        \"finishedAt\" = now(),
        \"heartbeatAt\" = now(),
        \"backupLabel\" = '$label',
        \"databaseBytes\" = $database_bytes,
        \"uploadsBytes\" = $uploads_bytes,
        \"totalBytes\" = $total_bytes,
        \"checksumVerified\" = true,
        \"resultSummary\" = 'Database, uploads, manifest, and checksums completed',
        \"updatedAt\" = now()
    WHERE id = '$run_id' AND status = 'running'
  " >/dev/null || return 1
  deleted_count=$(apply_retention "$household_id" "$run_id") || deleted_count=0
  case "$deleted_count" in ''|*[!0-9]*) deleted_count=0 ;; esac
  psql_main -q -c "
    UPDATE backup_runs SET \"retentionDeletedCount\" = $deleted_count, \"updatedAt\" = now()
    WHERE id = '$run_id'
  " >/dev/null
  check_capacity_for_household "$household_id" || true
}

cleanup_restore() {
  target_database=$1
  preview_dir=$2
  case "$target_database" in family_restore_[0-9a-f]*)
    dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$target_database" >/dev/null 2>&1 || true
    ;;
  esac
  case "$preview_dir" in "$RESTORE_WORK_ROOT"/*)
    if [ -d "$preview_dir" ]; then rm -rf "$preview_dir"; fi
    ;;
  esac
}

run_restore_drill() {
  run_id=$1
  household_id=$2
  source_label=$3
  is_uuid "$run_id" && is_uuid "$household_id" || return 1
  printf '%s' "$source_label" | grep -Eq "^$household_id/[0-9a-f-]{36}$" || return 1
  backup_dir="$BACKUP_ROOT/$source_label"
  [ -d "$backup_dir" ] && [ ! -e "$backup_dir/.incomplete" ] || return 1
  for required in database.dump uploads.tar.gz manifest.txt checksums.sha256; do
    [ -f "$backup_dir/$required" ] || return 1
  done
  (
    cd "$backup_dir"
    verify_checksums >/dev/null
  ) || return 1
  if tar -tzf "$backup_dir/uploads.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    return 1
  fi

  compact_id=$(printf '%s' "$run_id" | tr -d '-' | cut -c1-20)
  target_database="family_restore_$compact_id"
  preview_dir="$RESTORE_WORK_ROOT/$run_id"
  exists=$(psql_database postgres -At -c \
    "SELECT 1 FROM pg_database WHERE datname = '$target_database'") || return 1
  [ -z "$exists" ] || return 1
  [ ! -e "$preview_dir" ] || return 1

  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$target_database" || return 1
  pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$target_database" \
    --no-owner --no-privileges <"$backup_dir/database.dump" || {
      cleanup_restore "$target_database" "$preview_dir"
      return 1
    }
  DB_NAME="$target_database" node /app/apps/api/node_modules/typeorm/cli.js migration:run \
    -d /app/apps/api/dist/database/data-source.js >/dev/null || {
      cleanup_restore "$target_database" "$preview_dir"
      return 1
    }
  migration_count=$(psql_database "$target_database" -At -c \
    'SELECT count(*) FROM app_migrations') || {
      cleanup_restore "$target_database" "$preview_dir"
      return 1
    }
  household_count=$(psql_database "$target_database" -At -c \
    'SELECT count(*) FROM households') || {
      cleanup_restore "$target_database" "$preview_dir"
      return 1
    }
  [ "$migration_count" -gt 0 ] && [ "$household_count" -gt 0 ] || {
    cleanup_restore "$target_database" "$preview_dir"
    return 1
  }
  mkdir -p "$preview_dir"
  tar -xzf "$backup_dir/uploads.tar.gz" -C "$preview_dir" || {
    cleanup_restore "$target_database" "$preview_dir"
    return 1
  }
  find "$preview_dir" -type f -print >/dev/null || {
    cleanup_restore "$target_database" "$preview_dir"
    return 1
  }
  cleanup_restore "$target_database" "$preview_dir"
  psql_main -q -c "
    UPDATE backup_runs
    SET status = 'succeeded',
        \"finishedAt\" = now(),
        \"heartbeatAt\" = now(),
        \"checksumVerified\" = true,
        \"restoredMigrationCount\" = $migration_count,
        \"resultSummary\" = 'Checksums, database migrations, and uploads verified in an isolated environment',
        \"updatedAt\" = now()
    WHERE id = '$run_id' AND status = 'running'
  " >/dev/null
}

run_capacity_check() {
  run_id=$1
  household_id=$2
  check_capacity_for_household "$household_id" || return 1
  psql_main -q -c "
    UPDATE backup_runs
    SET status = 'succeeded',
        \"finishedAt\" = now(),
        \"heartbeatAt\" = now(),
        \"resultSummary\" = 'Backup storage capacity refreshed',
        \"updatedAt\" = now()
    WHERE id = '$run_id' AND status = 'running'
  " >/dev/null
}

process_claimed_run() {
  claimed=$1
  old_ifs=$IFS
  IFS='|'
  set -- $claimed
  IFS=$old_ifs
  run_id=$1
  household_id=$2
  kind=$3
  source_label=${4:-}
  if ! is_uuid "$run_id" || ! is_uuid "$household_id"; then
    return 1
  fi
  heartbeat_loop "$run_id" &
  HEARTBEAT_PID=$!
  result=0
  case "$kind" in
    backup) create_backup "$run_id" "$household_id" || result=$? ;;
    restore_drill) run_restore_drill "$run_id" "$household_id" "$source_label" || result=$? ;;
    capacity_check) run_capacity_check "$run_id" "$household_id" || result=$? ;;
    *) result=1 ;;
  esac
  stop_heartbeat
  if [ "$result" -ne 0 ]; then
    update_run_failed "$run_id" worker_operation_failed 'The isolated backup worker could not complete this operation'
    return "$result"
  fi
  printf 'Backup operation completed: %s (%s)\n' "$run_id" "$kind"
}

trap 'stop_heartbeat' EXIT HUP INT TERM
psql_database postgres -q -c 'SELECT 1' >/dev/null

while :; do
  update_worker_presence
  check_all_capacity
  claimed=$(claim_run)
  if [ -n "$claimed" ]; then
    process_claimed_run "$claimed" || true
  elif [ "$RUN_ONCE" = 'true' ]; then
    break
  fi
  if [ "$RUN_ONCE" = 'true' ]; then break; fi
  sleep "$POLL_SECONDS"
done
