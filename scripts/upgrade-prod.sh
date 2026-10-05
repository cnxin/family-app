#!/bin/sh
# 生产升级：给当前镜像打回滚标签 → 备份 → 拉代码 → 构建 → 启动 → 健康检查。
# 任一步失败立即停止，不自动回滚；回滚步骤见 docs/deploy-c2.md。
#
#   ./scripts/upgrade-prod.sh            # git pull --ff-only 后升级
#   ./scripts/upgrade-prod.sh --no-pull  # 代码已经手动 git pull 好，只做其余步骤
#                                        # （NAS 上的旧版本还没有这个脚本时，第一次升级用它）
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
BACKUP_ROOT=${FAMILY_APP_PROD_BACKUP_ROOT:-"$REPO_ROOT/backups-production"}
ENV_FILE=${FAMILY_APP_PROD_ENV:-"$REPO_ROOT/deploy/.env.production"}
HEALTH_TIMEOUT_SECONDS=${FAMILY_APP_HEALTH_TIMEOUT:-300}

PULL=1
case "${1:-}" in
  '') ;;
  --no-pull) PULL=0 ;;
  *)
    printf 'Usage: %s [--no-pull]\n' "$0" >&2
    exit 2
    ;;
esac

if [ -n "${DOCKER_BIN:-}" ]; then
  :
elif command -v docker >/dev/null 2>&1; then
  DOCKER_BIN=docker
elif [ -x /Applications/Docker.app/Contents/Resources/bin/docker ]; then
  DOCKER_BIN=/Applications/Docker.app/Contents/Resources/bin/docker
else
  printf 'Docker CLI was not found.\n' >&2
  exit 2
fi

if [ ! -f "$ENV_FILE" ]; then
  printf 'Production environment file was not found: %s\n' "$ENV_FILE" >&2
  exit 2
fi

compose() {
  "$DOCKER_BIN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

STEP='准备'
STAMP=$(date +%Y%m%d-%H%M%S)
ROLLBACK_TAG="prod-before-$STAMP"
BACKUP_DIR=''
# 升级前提交 = 正在运行的版本，在确认服务都在运行之后再取（running_commit）。
# 不用仓库的 HEAD / ORIG_HEAD：代码常常早已拉到新提交（--no-pull，或检出被别处快进过），它们说明不了跑的是哪一版。
OLD_COMMIT='未知（还没读到正在运行的版本）'

on_exit() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '\n升级在「%s」这一步失败（退出码 %s），已停止，没有自动回滚。\n' "$STEP" "$status" >&2
    printf '升级前提交：%s\n' "$OLD_COMMIT" >&2
    printf '回滚镜像标签：%s\n' "$ROLLBACK_TAG" >&2
    if [ -n "$BACKUP_DIR" ]; then
      printf '升级前备份：%s\n' "$BACKUP_DIR" >&2
    fi
    printf '回滚步骤见 docs/deploy-c2.md。\n' >&2
  fi
}
trap on_exit EXIT

step() {
  STEP=$1
  printf '\n==> %s\n' "$STEP"
}

# 正在运行的版本：优先读 api 容器的镜像标签 org.opencontainers.image.revision（本脚本构建时写入）；
# 镜像是加标签之前建的、或手动 build 没带提交号时，退回最近一份完整备份的 manifest.txt 里的 git_commit。
running_commit() {
  container=$(compose ps -q api)
  revision=$("$DOCKER_BIN" inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container" 2>/dev/null || true)
  case "$revision" in
    ''|unknown|'<no value>') ;;
    *)
      printf '%s（取自运行中 api 镜像的 revision 标签）' "$revision"
      return
      ;;
  esac
  latest=''
  for dir in "$BACKUP_ROOT"/*/; do
    [ -f "${dir}manifest.txt" ] && [ ! -e "${dir}.incomplete" ] && latest=$dir
  done
  if [ -n "$latest" ]; then
    commit=$(sed -n 's/^git_commit=//p' "${latest}manifest.txt")
    printf '%s（镜像没有 revision 标签，取自最近一份备份 %s 的清单：那次备份时仓库的 HEAD，以 git reflog 核对）' "${commit:-unknown}" "$latest"
    return
  fi
  printf 'unknown（镜像没有 revision 标签，也没有找到备份清单，以 git reflog 为准）'
}

step '检查工作区与运行状态'
if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
  printf '仓库里有未提交的改动，先处理干净再升级。\n' >&2
  exit 1
fi
for service in db api web backup-worker; do
  if [ -z "$(compose ps -q "$service")" ]; then
    printf '服务 %s 没有在运行；升级脚本只用于已上线的环境（备份需要它们）。\n' "$service" >&2
    exit 1
  fi
done
OLD_COMMIT=$(running_commit)
printf '正在运行的版本：%s\n' "$OLD_COMMIT"

step "给当前镜像打回滚标签 $ROLLBACK_TAG"
for service in api web backup-worker; do
  container=$(compose ps -q "$service")
  image_id=$("$DOCKER_BIN" inspect -f '{{.Image}}' "$container")
  "$DOCKER_BIN" tag "$image_id" "family-app-$service:$ROLLBACK_TAG"
  printf '%s -> family-app-%s:%s\n' "$image_id" "$service" "$ROLLBACK_TAG"
done

step '备份数据库与附件'
BACKUP_OUTPUT=$("$SCRIPT_DIR/backup-prod.sh")
printf '%s\n' "$BACKUP_OUTPUT"
BACKUP_DIR=$(printf '%s\n' "$BACKUP_OUTPUT" | sed -n 's/^Production backup complete: //p')
if [ -z "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/database.dump" ]; then
  printf '没有找到本次备份目录。\n' >&2
  exit 1
fi

if [ "$PULL" -eq 1 ]; then
  step '拉取代码'
  git -C "$REPO_ROOT" pull --ff-only
fi
NEW_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD)
printf '提交：%s -> %s\n' "$OLD_COMMIT" "$NEW_COMMIT"

step '构建镜像'
FAMILY_APP_COMMIT=$NEW_COMMIT
export FAMILY_APP_COMMIT
compose build

step '启动（API 启动时自动执行新迁移）'
# --wait 让依赖起不来时按时失败退出；不加的话 API 反复重启会让 up 一直挂着。需要 Compose ≥ 2.20。
if ! compose up -d --wait --wait-timeout "$HEALTH_TIMEOUT_SECONDS"; then
  compose logs --tail 50 api >&2
  exit 1
fi

step '健康检查'
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
for service in db api web; do
  container=$(compose ps -q "$service")
  while :; do
    health=$("$DOCKER_BIN" inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
    [ "$health" = healthy ] && break
    if [ "$health" = unhealthy ] || [ "$(date +%s)" -ge "$deadline" ]; then
      printf '服务 %s 健康状态：%s。最近日志：\n' "$service" "$health" >&2
      compose logs --tail 50 "$service" >&2
      exit 1
    fi
    sleep 5
  done
  printf '%s: healthy\n' "$service"
done
if [ "$("$DOCKER_BIN" inspect -f '{{.State.Running}}' "$(compose ps -q backup-worker)")" != true ]; then
  printf 'backup-worker 没有在运行。\n' >&2
  compose logs --tail 50 backup-worker >&2
  exit 1
fi
printf 'backup-worker: running\n'

DB_USER=$(compose exec -T db sh -c 'printf %s "$POSTGRES_USER"')
DB_NAME=$(compose exec -T db sh -c 'printf %s "$POSTGRES_DB"')
printf '最近三个迁移：\n'
compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -Atc \
  'SELECT name FROM app_migrations ORDER BY timestamp DESC LIMIT 3'

STEP='完成'
printf '\n升级完成：%s -> %s\n' "$OLD_COMMIT" "$NEW_COMMIT"
printf '回滚镜像标签：%s；升级前备份：%s\n' "$ROLLBACK_TAG" "$BACKUP_DIR"
printf '接着按 docs/deploy-c2.md「升级后确认」过一遍。\n'
