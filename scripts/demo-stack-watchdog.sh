#!/bin/sh
# 演示栈看门狗（Mac mini 用）：launchd 每 5 分钟跑一次。
#   健康 → 什么都不做。
#   连续两次不健康 → Docker 引擎挂了就重启 Docker Desktop；容器丢了就用 compose 从本地镜像重建（不构建、不拉取）；HA 一并拉起。
#   升级脚本在跑、或 <部署目录>/.watchdog-pause 文件存在 → 不动。
#   磁盘剩余不到 FAMILY_APP_WATCHDOG_MIN_FREE_GB（默认 5）GB → 不拉起，只通知（2026-10-27 就是磁盘满把引擎写崩的）。
# 所有动作写日志（默认 ~/Library/Logs/family-app-watchdog.log）并发 macOS 通知。
# 安装与暂停方法见 docs/deploy-c2.md §5。FAMILY_APP_WATCHDOG_DRY_RUN=1 只打印要做的事，不执行、不通知。
set -u

PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Docker.app/Contents/Resources/bin
export PATH

DEPLOY_DIR=${FAMILY_APP_DEPLOY_DIR:-$HOME/AI/family-app}
HA_DIR=${FAMILY_HA_DIR:-$HOME/family-ha}
HEALTH_URL=${FAMILY_APP_HEALTH_URL:-http://localhost:8088/api/health/ready}
STATE_DIR=${FAMILY_APP_WATCHDOG_STATE:-$HOME/Library/Application Support/family-app-watchdog}
LOG=${FAMILY_APP_WATCHDOG_LOG:-$HOME/Library/Logs/family-app-watchdog.log}
MIN_FREE_GB=${FAMILY_APP_WATCHDOG_MIN_FREE_GB:-5}
DRY_RUN=${FAMILY_APP_WATCHDOG_DRY_RUN:-0}
COMPOSE="docker compose --env-file deploy/.env.production -f docker-compose.prod.yml"

mkdir -p "$STATE_DIR" "$(dirname "$LOG")"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }
notify() {
  [ "$DRY_RUN" = 1 ] && return 0
  osascript -e "display notification \"$1\" with title \"小管家演示栈\"" >/dev/null 2>&1 || true
}
run() {
  if [ "$DRY_RUN" = 1 ]; then log "[dry-run] $*"; return 0; fi
  log "执行：$*"; "$@" >> "$LOG" 2>&1
}
# 只在状态变化时记一行，免得 5 分钟一条把日志刷满
status_changed() {
  last=$(cat "$STATE_DIR/last-status" 2>/dev/null || true)
  printf '%s' "$1" > "$STATE_DIR/last-status"
  [ "$last" != "$1" ]
}
healthy() { curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; }
wait_for() { # wait_for <秒数> <命令…>
  secs=$1; shift
  while [ "$secs" -gt 0 ]; do "$@" && return 0; sleep 5; secs=$((secs - 5)); done
  return 1
}
docker_ok() { docker info >/dev/null 2>&1; }

# 防止两次运行叠在一起
if ! mkdir "$STATE_DIR/lock" 2>/dev/null; then exit 0; fi
trap 'rmdir "$STATE_DIR/lock" 2>/dev/null' EXIT INT TERM

if [ -f "$DEPLOY_DIR/.watchdog-pause" ]; then
  status_changed paused && log "暂停中（$DEPLOY_DIR/.watchdog-pause 存在），不检查"
  exit 0
fi
if pgrep -f 'scripts/upgrade-prod.sh' >/dev/null 2>&1; then
  status_changed upgrading && log "升级脚本在跑，不动"
  exit 0
fi

if healthy; then
  rm -f "$STATE_DIR/fails"
  status_changed healthy && log "健康：$HEALTH_URL"
  exit 0
fi

fails=$(( $(cat "$STATE_DIR/fails" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$fails" > "$STATE_DIR/fails"
if [ "$fails" -lt 2 ]; then
  status_changed unhealthy-1 && log "第 1 次不健康（$HEALTH_URL），等下一轮再确认"
  exit 0
fi
status_changed recovering
log "连续 $fails 次不健康，开始处理"

free_gb=$(( $(df -k "$HOME" | awk 'NR==2{print $4}') / 1024 / 1024 ))
if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
  log "磁盘只剩 ${free_gb} GB（< ${MIN_FREE_GB}），不自动拉起"
  notify "演示栈不健康，但磁盘只剩 ${free_gb} GB，没有自动拉起，先清磁盘"
  exit 1
fi

if ! docker_ok; then
  log "Docker 引擎无响应"
  if pgrep -f com.docker.backend >/dev/null 2>&1; then
    run pkill -9 -f com.docker.backend
    sleep 3
  fi
  run open -a Docker
  if [ "$DRY_RUN" != 1 ] && ! wait_for 180 docker_ok; then
    log "Docker Desktop 3 分钟内没起来"
    notify "演示栈不健康，Docker Desktop 重启后 3 分钟内没起来，要人看"
    exit 1
  fi
fi

if [ ! -f "$DEPLOY_DIR/docker-compose.prod.yml" ]; then
  log "找不到 $DEPLOY_DIR/docker-compose.prod.yml，不知道怎么拉起"
  notify "演示栈不健康，且部署目录不对，要人看"
  exit 1
fi
cd "$DEPLOY_DIR" || exit 1
# shellcheck disable=SC2086
run $COMPOSE up -d --no-build
if [ -f "$HA_DIR/compose.yaml" ] || [ -f "$HA_DIR/docker-compose.yml" ]; then
  (cd "$HA_DIR" && run docker compose up -d)
fi

if [ "$DRY_RUN" = 1 ]; then log "[dry-run] 结束"; exit 0; fi
if wait_for 120 healthy; then
  rm -f "$STATE_DIR/fails"
  status_changed healthy
  log "已拉起，健康"
  notify "演示栈刚掉过，已自动拉起并恢复健康，日志见 $LOG"
  exit 0
fi
log "拉起后 2 分钟内仍不健康"
notify "演示栈自动拉起后仍不健康，要人看，日志见 $LOG"
exit 1
