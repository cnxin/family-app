#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/docker-compose.dev.yml"
if [ -n "${DOCKER_BIN:-}" ]; then
  :
elif command -v docker >/dev/null 2>&1; then
  DOCKER_BIN=docker
elif [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then
  DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
else
  printf 'Docker CLI was not found. Start Docker Desktop first.\n' >&2
  exit 2
fi
DB_USER=${DB_USER:-family}
DB_NAME=${DB_NAME:-family_app}
BACKUP_ROOT=${1:-${FAMILY_APP_BACKUP_ROOT:-"$REPO_ROOT/backups"}}
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

umask 077
if [ -e "$BACKUP_DIR" ]; then
  printf 'Backup directory already exists: %s\n' "$BACKUP_DIR" >&2
  exit 2
fi
mkdir -p "$BACKUP_DIR"
touch "$BACKUP_DIR/.incomplete"

compose() {
  "$DOCKER_BIN" compose -f "$COMPOSE_FILE" "$@"
}

checksum_files() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 database.dump uploads.tar.gz manifest.txt
  else
    sha256sum database.dump uploads.tar.gz manifest.txt
  fi
}

compose exec -T db pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null
compose exec -T db pg_dump \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-privileges >"$BACKUP_DIR/database.dump"

compose run --rm --no-deps -T api \
  tar -C /app/apps/api -czf - uploads >"$BACKUP_DIR/uploads.tar.gz"

GIT_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || printf 'unknown')
MIGRATIONS=$(
  compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -Atc \
    "SELECT COALESCE(string_agg(name, ',' ORDER BY timestamp), 'none') FROM app_migrations"
)

{
  printf 'created_at_utc=%s\n' "$STAMP"
  printf 'git_commit=%s\n' "$GIT_COMMIT"
  printf 'database=%s\n' "$DB_NAME"
  printf 'migrations=%s\n' "$MIGRATIONS"
  printf 'compose_file=docker-compose.dev.yml\n'
} >"$BACKUP_DIR/manifest.txt"

(
  cd "$BACKUP_DIR"
  checksum_files >checksums.sha256
)

chmod 600 "$BACKUP_DIR/database.dump" "$BACKUP_DIR/uploads.tar.gz"
rm "$BACKUP_DIR/.incomplete"

printf 'Backup complete: %s\n' "$BACKUP_DIR"
printf 'Keep at least one copy outside this computer.\n'
