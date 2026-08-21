#!/usr/bin/env bash
set -Eeuo pipefail

# 服务器上的仓库目录，可通过环境变量覆盖。
REPO_DIR="${KAGGLE_HARVESTER_REPO_DIR:-$HOME/kaggle-harvester}"
OPENCLAW_USER="${OPENCLAW_USER:-openclaw}"
OPENCLAW_REPO_DIR="${OPENCLAW_REPO_DIR:-/home/${OPENCLAW_USER}/kaggle-harvester}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.deploy}"
OPENCLAW_RUNTIME_ENV="/home/${OPENCLAW_USER}/.openclaw/kaggle-harvester.env"
OPENCLAW_LAUNCHER="/home/${OPENCLAW_USER}/.openclaw/start-kaggle-gateway.sh"
TARGET_SCRIPT="/home/${OPENCLAW_USER}/kaggle-harvester/backend/harvester/wechat_bot.py"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*"
}

fail() {
  printf '更新失败：%s\n' "$*" >&2
  exit 1
}

read_dotenv_value() {
  local name="$1"
  local file="$2"
  local value
  value="$(sed -n "s/^${name}=//p" "$file" | head -n 1)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
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

if [[ -f "$REPO_DIR/scripts/update-kaggle-harvester.sh" && -d "/usr/local/sbin" ]]; then
  cp -f "$REPO_DIR/scripts/update-kaggle-harvester.sh" "/usr/local/sbin/update-kaggle-harvester" 2>/dev/null || true
  chmod 755 "/usr/local/sbin/update-kaggle-harvester" 2>/dev/null || true
fi

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
install -d -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 755 "$OPENCLAW_REPO_DIR/backend/harvester"
cp -r "$REPO_DIR/backend/harvester/"* "$OPENCLAW_REPO_DIR/backend/harvester/"
chown -R "$OPENCLAW_USER:$OPENCLAW_USER" "$OPENCLAW_REPO_DIR/backend/harvester"

if [[ -f "$REPO_DIR/scripts/setup_openclaw.py" ]]; then
  python3 "$REPO_DIR/scripts/setup_openclaw.py"
fi

# 只向 OpenClaw 暴露战报脚本所需的两个变量，不复制完整部署密钥文件。
HARVESTER_API_KEY_VALUE="${HARVESTER_API_KEY:-$(read_dotenv_value HARVESTER_API_KEY "$REPO_DIR/$COMPOSE_ENV_FILE")}"
HARVESTER_API_URL_VALUE="${HARVESTER_API_URL:-$(read_dotenv_value HARVESTER_API_URL "$REPO_DIR/$COMPOSE_ENV_FILE")}"
if [[ -z "$HARVESTER_API_URL_VALUE" ]]; then
  APP_PORT_VALUE="${APP_PORT:-$(read_dotenv_value APP_PORT "$REPO_DIR/$COMPOSE_ENV_FILE")}"
  APP_PORT_VALUE="${APP_PORT_VALUE:-8080}"
  HARVESTER_API_URL_VALUE="http://127.0.0.1:${APP_PORT_VALUE}/api/simulation-monitor"
fi
[[ -n "$HARVESTER_API_KEY_VALUE" ]] || fail 'HARVESTER_API_KEY 未配置。'

RUNTIME_ENV_TMP="$(mktemp /tmp/kaggle-harvester-env.XXXXXX)"
{
  printf 'HARVESTER_API_URL=%q\n' "$HARVESTER_API_URL_VALUE"
  printf 'HARVESTER_API_KEY=%q\n' "$HARVESTER_API_KEY_VALUE"
} > "$RUNTIME_ENV_TMP"
install -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 600 \
  "$RUNTIME_ENV_TMP" "$OPENCLAW_RUNTIME_ENV"
rm -f "$RUNTIME_ENV_TMP"

NODE_BIN="$(command -v node || echo '/usr/local/lib/nodejs/node-v24.19.0-linux-x64/bin/node')"
OPENCLAW_JS="/usr/local/lib/nodejs/node-v24.19.0-linux-x64/lib/node_modules/openclaw/dist/index.js"

# 自动修复并对齐 OpenClaw 配置；使用绝对路径避免登录 shell 缺少 /usr/local/bin。
if [[ -f "$OPENCLAW_JS" ]]; then
  su - "$OPENCLAW_USER" -c "env TZ=Asia/Shanghai '$NODE_BIN' '$OPENCLAW_JS' doctor --fix" 2>/dev/null || true
elif command -v openclaw >/dev/null 2>&1; then
  su - "$OPENCLAW_USER" -c "env TZ=Asia/Shanghai '$(command -v openclaw)' doctor --fix" 2>/dev/null || true
fi

log '重启 OpenClaw 进程以热加载最新配置与提示词'
pkill -u "$OPENCLAW_USER" -f openclaw || true
for _ in {1..10}; do
  if ! pgrep -u "$OPENCLAW_USER" -f "openclaw.*dist/index.js" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# OpenClaw 的真实会话位于 agents/main/sessions。停机后移入备份，避免模型继续
# 执行旧会话中自行创建的临时脚本；使用移动而非删除，便于需要时审计恢复。
OPENCLAW_SESSION_DIR="/home/${OPENCLAW_USER}/.openclaw/agents/main/sessions"
OPENCLAW_SESSION_BACKUP="/home/${OPENCLAW_USER}/.openclaw/session-backups/$(date '+%Y%m%d-%H%M%S')"
if [[ -d "$OPENCLAW_SESSION_DIR" ]] && \
   find "$OPENCLAW_SESSION_DIR" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  install -d -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 700 "$OPENCLAW_SESSION_BACKUP"
  find "$OPENCLAW_SESSION_DIR" -mindepth 1 -maxdepth 1 \
    -exec mv -t "$OPENCLAW_SESSION_BACKUP" -- {} +
fi

if [[ -f /tmp/recent.py ]]; then
  install -d -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 700 "$OPENCLAW_SESSION_BACKUP"
  mv /tmp/recent.py "$OPENCLAW_SESSION_BACKUP/generated-recent.py"
  chown "$OPENCLAW_USER:$OPENCLAW_USER" "$OPENCLAW_SESSION_BACKUP/generated-recent.py"
fi

if [[ -f "$OPENCLAW_JS" ]]; then
  LAUNCHER_TMP="$(mktemp /tmp/kaggle-harvester-launcher.XXXXXX)"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -a\n'
    printf '. %q\n' "$OPENCLAW_RUNTIME_ENV"
    printf 'set +a\n'
    printf 'exec env TZ=Asia/Shanghai %q %q gateway --port 18789\n' "$NODE_BIN" "$OPENCLAW_JS"
  } > "$LAUNCHER_TMP"
  install -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 700 \
    "$LAUNCHER_TMP" "$OPENCLAW_LAUNCHER"
  rm -f "$LAUNCHER_TMP"
  su - "$OPENCLAW_USER" -c "nohup '$OPENCLAW_LAUNCHER' > ~/.openclaw/gateway.log 2>&1 &"
elif command -v openclaw >/dev/null 2>&1; then
  OPENCLAW_BIN="$(command -v openclaw)"
  LAUNCHER_TMP="$(mktemp /tmp/kaggle-harvester-launcher.XXXXXX)"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -a\n'
    printf '. %q\n' "$OPENCLAW_RUNTIME_ENV"
    printf 'set +a\n'
    printf 'exec env TZ=Asia/Shanghai %q gateway --port 18789\n' "$OPENCLAW_BIN"
  } > "$LAUNCHER_TMP"
  install -o "$OPENCLAW_USER" -g "$OPENCLAW_USER" -m 700 \
    "$LAUNCHER_TMP" "$OPENCLAW_LAUNCHER"
  rm -f "$LAUNCHER_TMP"
  su - "$OPENCLAW_USER" -c "nohup '$OPENCLAW_LAUNCHER' > ~/.openclaw/gateway.log 2>&1 &"
fi

log '部署完成'
docker compose --env-file "$COMPOSE_ENV_FILE" ps
printf 'OpenClaw 辅助脚本：%s\n' "$TARGET_SCRIPT"
