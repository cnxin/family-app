#!/bin/sh
set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  printf 'Usage: %s BACKUP_DIR TARGET_DATABASE [UPLOAD_PREVIEW_DIR]\n' "$0" >&2
  exit 2
fi

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
ACTIVE_DB=${DB_NAME:-family_app}
BACKUP_DIR=$(CDPATH= cd -- "$1" && pwd)
TARGET_DATABASE=$2
UPLOAD_PREVIEW_DIR=${3:-"$REPO_ROOT/restore-preview/$TARGET_DATABASE"}

case "$TARGET_DATABASE" in
  ''|*[!A-Za-z0-9_]*)
    printf 'Target database may contain only letters, numbers, and underscores.\n' >&2
    exit 2
    ;;
esac

if [ "$TARGET_DATABASE" = "$ACTIVE_DB" ]; then
  printf 'Refusing to overwrite active database "%s". Use a new database name.\n' "$ACTIVE_DB" >&2
  exit 2
fi

if [ -e "$UPLOAD_PREVIEW_DIR" ]; then
  printf 'Upload preview directory already exists: %s\n' "$UPLOAD_PREVIEW_DIR" >&2
  exit 2
fi

for file in database.dump uploads.tar.gz manifest.txt checksums.sha256; do
  if [ ! -f "$BACKUP_DIR/$file" ]; then
    printf 'Missing backup file: %s\n' "$BACKUP_DIR/$file" >&2
    exit 2
  fi
done

verify_checksums() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c checksums.sha256
  else
    sha256sum -c checksums.sha256
  fi
}

(
  cd "$BACKUP_DIR"
  verify_checksums
)

if tar -tzf "$BACKUP_DIR/uploads.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  printf 'Upload archive contains an unsafe path.\n' >&2
  exit 2
fi

compose() {
  "$DOCKER_BIN" compose -f "$COMPOSE_FILE" "$@"
}

compose exec -T db pg_isready -U "$DB_USER" -d postgres >/dev/null
EXISTS=$(
  compose exec -T db psql -U "$DB_USER" -d postgres -Atc \
    "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DATABASE'"
)
if [ "$EXISTS" = "1" ]; then
  printf 'Target database already exists: %s\n' "$TARGET_DATABASE" >&2
  exit 2
fi

compose exec -T db createdb -U "$DB_USER" "$TARGET_DATABASE"
compose exec -T db pg_restore \
  -U "$DB_USER" \
  -d "$TARGET_DATABASE" \
  --no-owner \
  --no-privileges <"$BACKUP_DIR/database.dump"

compose run --rm --no-deps -T -e "DB_NAME=$TARGET_DATABASE" api \
  pnpm --filter api migration:run

mkdir -p "$UPLOAD_PREVIEW_DIR"
tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C "$UPLOAD_PREVIEW_DIR"

compose exec -T db psql -U "$DB_USER" -d "$TARGET_DATABASE" -c \
  'SELECT COUNT(*) AS migrations FROM app_migrations;'

printf 'Restore drill complete.\n'
printf 'Database: %s\n' "$TARGET_DATABASE"
printf 'Uploads: %s/uploads\n' "$UPLOAD_PREVIEW_DIR"
printf 'The active development database was not changed.\n'
