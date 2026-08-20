#!/usr/bin/env bash
set -Eeuo pipefail

# 服务器上的仓库目录，可通过环境变量覆盖。
REPO_DIR="${KAGGLE_HARVESTER_REPO_DIR:-$HOME/kaggle-harvester}"
OPENCLAW_USER="${OPENCLAW_USER:-openclaw}"
OPENCLAW_REPO_DIR="${OPENCLAW_REPO_DIR:-/home/${OPENCLAW_USER}/kaggle-harvester}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.deploy}"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

fail() {
  printf '更新失败：%s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail '请使用 root 执行此脚本。'
[[ -d "$REPO_DIR/.git" ]] || fail "仓库目录不存在或不是 Git 仓库：$REPO_DIR"
[[ -f "$REPO_DIR/$COMPOSE_ENV_FILE" ]] || fail "环境文件不存在：$REPO_DIR/$COMPOSE_ENV_FILE"
command -v git >/dev/null 2>&1 || fail '未找到 git。'
command -v docker >/dev/null 2>&1 || fail '未找到 docker。'
id "$OPENCLAW_USER" >/dev/null 2>&1 || fail "用户不存在：$OPENCLAW_USER"

cd "$REPO_DIR"

log '拉取最新代码'
git checkout -f scripts/update-kaggle-harvester.sh 2>/dev/null || true
git pull origin main

log '构建并启动 Docker Compose 服务'
docker compose --env-file "$COMPOSE_ENV_FILE" up -d --build

log '等待服务状态稳定'
for _ in {1..30}; do
  running_services="$(docker compose --env-file "$COMPOSE_ENV_FILE" ps --status running --services)"
  if grep -qE '(^|[[:space:]])(backend|frontend)($|[[:space:]])' <<< "$running_services"; then
    break
  fi
  sleep 2
done

running_services="$(docker compose --env-file "$COMPOSE_ENV_FILE" ps --status running --services)"

if ! grep -qE '(^|[[:space:]])backend($|[[:space:]])' <<< "$running_services"; then
  docker compose --env-file "$COMPOSE_ENV_FILE" ps >&2
  fail 'backend 容器没有进入 running 状态。'
fi

if ! grep -qE '(^|[[:space:]])frontend($|[[:space:]])' <<< "$running_services"; then
  docker compose --env-file "$COMPOSE_ENV_FILE" ps >&2
  fail 'frontend 容器没有进入 running 状态。'
fi

log '同步 OpenClaw 使用的微信辅助脚本与配置'
TARGET_SCRIPT="$OPENCLAW_REPO_DIR/backend/harvester/wechat_bot.py"
install -d -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 755 "$(dirname "$TARGET_SCRIPT")"
install -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 644 \
  "$REPO_DIR/backend/harvester/wechat_bot.py" \
  "$TARGET_SCRIPT"

if [[ -f "$REPO_DIR/scripts/setup_openclaw.py" ]]; then
  python3 "$REPO_DIR/scripts/setup_openclaw.py" || true
fi

log '重启 OpenClaw 进程以热加载最新配置与提示词'
pkill -u "$OPENCLAW_USER" -f openclaw || true
for _ in {1..10}; do
  if ! pgrep -u "$OPENCLAW_USER" -f "openclaw.*dist/index.js" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

NODE_BIN="$(command -v node || echo '/usr/local/lib/nodejs/node-v24.19.0-linux-x64/bin/node')"
OPENCLAW_JS="/usr/local/lib/nodejs/node-v24.19.0-linux-x64/lib/node_modules/openclaw/dist/index.js"
if [[ -f "$OPENCLAW_JS" ]]; then
  su - "$OPENCLAW_USER" -c "nohup $NODE_BIN $OPENCLAW_JS gateway --port 18789 > ~/.openclaw/gateway.log 2>&1 &"
elif command -v openclaw >/dev/null 2>&1; then
  su - "$OPENCLAW_USER" -c "nohup openclaw gateway --port 18789 > ~/.openclaw/gateway.log 2>&1 &"
fi

log '部署完成'
docker compose --env-file "$COMPOSE_ENV_FILE" ps
printf 'OpenClaw 辅助脚本：%s\n' "$TARGET_SCRIPT"
