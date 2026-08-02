#!/bin/sh
set -eu

mkdir -p "${BACKUP_ROOT:-/backups}" "${RESTORE_WORK_ROOT:-/restore-work}"
chown node:node "${BACKUP_ROOT:-/backups}" "${RESTORE_WORK_ROOT:-/restore-work}"
exec su-exec node "$@"
