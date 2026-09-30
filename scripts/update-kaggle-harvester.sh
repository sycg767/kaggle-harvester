#!/usr/bin/env bash
set -Eeuo pipefail
REPO_DIR="${KAGGLE_HARVESTER_REPO_DIR:-$HOME/kaggle-harvester}"
OPENCLAW_USER="${OPENCLAW_USER:-openclaw}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.deploy}"
log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
fail() { printf '更新失败：%s\n' "$*" >&2; exit 1; }
read_dotenv_value() {
  local value
  value="$(sed -n "s/^${1}=//p" "$2" | head -n 1)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" || "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}
[[ "$(id -u)" -eq 0 ]] || fail '请使用 root 执行此脚本。'
[[ -d "$REPO_DIR/.git" ]] || fail "不是 Git 仓库：$REPO_DIR"
for tool in git docker python3 systemctl runuser; do command -v "$tool" >/dev/null || fail "未找到 $tool"; done
id "$OPENCLAW_USER" >/dev/null 2>&1 || fail "用户不存在：$OPENCLAW_USER"
OPENCLAW_HOME="$(getent passwd "$OPENCLAW_USER" | cut -d: -f6)"
OPENCLAW_GROUP="$(id -gn "$OPENCLAW_USER")"
OPENCLAW_REPO_DIR="${OPENCLAW_REPO_DIR:-$OPENCLAW_HOME/kaggle-harvester}"
OPENCLAW_DIR="$OPENCLAW_HOME/.openclaw"
OPENCLAW_RUNTIME_ENV="$OPENCLAW_DIR/kaggle-harvester.env"
OPENCLAW_LAUNCHER="$OPENCLAW_DIR/start-kaggle-gateway.sh"
SERVICE="kaggle-harvester-openclaw.service"
cd "$REPO_DIR"
[[ "$COMPOSE_ENV_FILE" = /* ]] || COMPOSE_ENV_FILE="$REPO_DIR/$COMPOSE_ENV_FILE"
[[ -f "$COMPOSE_ENV_FILE" ]] || fail "环境文件不存在：$COMPOSE_ENV_FILE"
[[ -z "$(git status --porcelain)" ]] || fail '仓库存在未提交改动，请先核对来源并备份；未覆盖任何文件。'
log '拉取最新代码'
git pull --ff-only origin main
# Execute the newly fetched script so migration fixes take effect in this very deployment.
if [[ "${HARVESTER_UPDATED_SCRIPT:-0}" != 1 ]]; then
  install -m 755 "$REPO_DIR/scripts/update-kaggle-harvester.sh" /usr/local/sbin/update-kaggle-harvester
  export HARVESTER_UPDATED_SCRIPT=1 KAGGLE_HARVESTER_REPO_DIR="$REPO_DIR" OPENCLAW_USER OPENCLAW_REPO_DIR COMPOSE_ENV_FILE
  exec bash /usr/local/sbin/update-kaggle-harvester
fi
log '合并 OpenClaw 配置（保留登录、记忆和会话）'
setup_result="$(OPENCLAW_USER="$OPENCLAW_USER" OPENCLAW_REPO_DIR="$OPENCLAW_REPO_DIR" COMPOSE_ENV_FILE="$COMPOSE_ENV_FILE" python3 scripts/setup_openclaw.py)"
changed=0
[[ "$setup_result" != *OPENCLAW_CHANGED=1* ]] || changed=1
# Update only managed files, with backups before the first replacement.
install_changed() {
  local src="$1" dst="$2" mode="$3" owner="$4" group="$5"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then return; fi
  if [[ -e "$dst" && ! -e "$dst.pre-managed.bak" ]]; then
    cp -p "$dst" "$dst.pre-managed.bak"
    chmod 600 "$dst.pre-managed.bak"
  fi
  install -o "$owner" -g "$group" -m "$mode" "$src" "$dst"
  changed=1
}
log '同步微信辅助脚本'
while IFS= read -r -d '' source; do
  relative="${source#"$REPO_DIR/backend/harvester/"}"
  destination="$OPENCLAW_REPO_DIR/backend/harvester/$relative"
  install -d -o "$OPENCLAW_USER" -g "$OPENCLAW_GROUP" -m 755 "$(dirname "$destination")"
  # Script contents are loaded per request; do not restart the gateway for a Python edit.
  before="$changed"
  install_changed "$source" "$destination" 644 "$OPENCLAW_USER" "$OPENCLAW_GROUP"
  changed="$before"
done < <(find "$REPO_DIR/backend/harvester" -type f -name '*.py' -print0)
HARVESTER_API_KEY_VALUE="${HARVESTER_API_KEY:-$(read_dotenv_value HARVESTER_API_KEY "$COMPOSE_ENV_FILE")}"
HARVESTER_API_URL_VALUE="${HARVESTER_API_URL:-$(read_dotenv_value HARVESTER_API_URL "$COMPOSE_ENV_FILE")}"
APP_PORT_VALUE="${APP_PORT:-$(read_dotenv_value APP_PORT "$COMPOSE_ENV_FILE")}"
HARVESTER_API_URL_VALUE="${HARVESTER_API_URL_VALUE:-http://127.0.0.1:${APP_PORT_VALUE:-8080}/api/simulation-monitor}"
[[ -n "$HARVESTER_API_KEY_VALUE" ]] || fail 'HARVESTER_API_KEY 未配置。'
TEMP_DIR="$(mktemp -d /tmp/harvester-openclaw.XXXXXX)"
trap 'rm -f "$TEMP_DIR/env" "$TEMP_DIR/launcher" "$TEMP_DIR/service" "$TEMP_DIR/bridge"; rmdir "$TEMP_DIR"' EXIT
{
  printf 'HARVESTER_API_URL=%q\n' "$HARVESTER_API_URL_VALUE"
  printf 'HARVESTER_API_KEY=%q\n' "$HARVESTER_API_KEY_VALUE"
} > "$TEMP_DIR/env"
install_changed "$TEMP_DIR/env" "$OPENCLAW_RUNTIME_ENV" 600 "$OPENCLAW_USER" "$OPENCLAW_GROUP"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[[ -n "$NODE_BIN" ]] || NODE_BIN=/usr/local/lib/nodejs/node-v24.19.0-linux-x64/bin/node
OPENCLAW_BIN="$(command -v openclaw || true)"
OPENCLAW_JS="${OPENCLAW_JS:-/usr/local/lib/nodejs/node-v24.19.0-linux-x64/lib/node_modules/openclaw/dist/index.js}"
if [[ -x "$NODE_BIN" && -f "$OPENCLAW_JS" ]]; then
  CLI=("$NODE_BIN" "$OPENCLAW_JS")
else fail '未找到 OpenClaw Node CLI；请配置 NODE_BIN 与 OPENCLAW_JS。'; fi
{
  printf '#!/usr/bin/env bash\nset -Eeuo pipefail\nset -a\n'
  printf '. %q\n' "$OPENCLAW_RUNTIME_ENV"
  printf 'set +a\nexec env TZ=Asia/Shanghai '
  printf '%q ' "${CLI[@]}"
  printf 'gateway\n'
} > "$TEMP_DIR/launcher"
install_changed "$TEMP_DIR/launcher" "$OPENCLAW_LAUNCHER" 700 "$OPENCLAW_USER" "$OPENCLAW_GROUP"
cat > "$TEMP_DIR/service" <<UNIT
[Unit]
Description=Kaggle Harvester OpenClaw gateway
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$OPENCLAW_USER
Group=$OPENCLAW_GROUP
WorkingDirectory=$OPENCLAW_HOME
Environment=HOME=$OPENCLAW_HOME
Environment=TZ=Asia/Shanghai
Environment=PATH=$(dirname "${CLI[0]}"):/usr/local/bin:/usr/bin:/bin
ExecStart=$OPENCLAW_LAUNCHER
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=control-group
[Install]
WantedBy=multi-user.target
UNIT
first_migration=0
[[ -f "$OPENCLAW_DIR/.harvester-systemd-migrated" ]] || first_migration=1
install_changed "$TEMP_DIR/service" "/etc/systemd/system/$SERVICE" 644 root root
[[ "$changed" == 0 ]] || touch "$OPENCLAW_DIR/.harvester-gateway-restart-required"
log '构建并启动 Docker Compose 服务'
docker compose --env-file "$COMPOSE_ENV_FILE" up -d --build
for _ in {1..30}; do
  running="$(docker compose --env-file "$COMPOSE_ENV_FILE" ps --status running --services)"
  if grep -qx backend <<< "$running" && grep -qx frontend <<< "$running"; then break; fi
  sleep 2
done
grep -qx backend <<< "$running" && grep -qx frontend <<< "$running" || fail '应用容器没有全部进入 running 状态。'
if [[ "$first_migration" == 1 ]]; then
  log '将旧的手动网关进程迁移到 systemd（保留会话）'
  systemctl stop "$SERVICE" 2>/dev/null || true
  # Match only this user's gateway, not unrelated OpenClaw commands or root's process.
  old_pids="$(pgrep -u "$OPENCLAW_USER" -f '(^openclaw-gateway$|openclaw.*[ /]gateway([ ]|$))' || true)"
  if [[ -n "$old_pids" ]]; then
    kill $old_pids
    for _ in {1..30}; do
      alive=0
      for pid in $old_pids; do kill -0 "$pid" 2>/dev/null && alive=1; done
      [[ "$alive" == 1 ]] || break
      sleep 1
    done
    [[ "$alive" == 0 ]] || fail '旧网关未退出；为避免双实例，未启动新网关。'
  fi
fi
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
if [[ -f "$OPENCLAW_DIR/.harvester-gateway-restart-required" || "$first_migration" == 1 ]]; then
  log '配置变更，重启网关；保留登录、记忆和会话'
  systemctl restart "$SERVICE"
else systemctl start "$SERVICE"; fi
healthy=0
for _ in {1..12}; do
  if runuser -u "$OPENCLAW_USER" -- env HOME="$OPENCLAW_HOME" TZ=Asia/Shanghai PATH="$(dirname "${CLI[0]}"):$PATH" "${CLI[@]}" health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
[[ "$healthy" == 1 ]] || fail 'OpenClaw CLI 健康检查未通过，请检查 systemd 日志。'
touch "$OPENCLAW_DIR/.harvester-systemd-migrated"
rm -f "$OPENCLAW_DIR/.harvester-gateway-restart-required"
log '更新宿主机微信状态与投递桥接（不开放网关端口）'
cat > "$TEMP_DIR/bridge" <<UNIT
[Unit]
Description=Kaggle Harvester WeChat status and delivery bridge
After=network-online.target $SERVICE
Wants=network-online.target
[Service]
Type=simple
User=root
WorkingDirectory=$REPO_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 $REPO_DIR/scripts/wechat_bridge.py --repo $REPO_DIR --home $OPENCLAW_HOME --user $OPENCLAW_USER --node $NODE_BIN --cli $OPENCLAW_JS --env-file $COMPOSE_ENV_FILE --api-url $HARVESTER_API_URL_VALUE
Restart=on-failure
RestartSec=5
TimeoutStopSec=25
[Install]
WantedBy=multi-user.target
UNIT
install_changed "$TEMP_DIR/bridge" /etc/systemd/system/kaggle-harvester-wechat-bridge.service 644 root root
systemctl daemon-reload
systemctl stop kaggle-harvester-wechat-bridge.service 2>/dev/null || true
python3 "$REPO_DIR/scripts/wechat_bridge.py" --repo "$REPO_DIR" --home "$OPENCLAW_HOME" --user "$OPENCLAW_USER" --node "$NODE_BIN" --cli "$OPENCLAW_JS" --env-file "$COMPOSE_ENV_FILE" --api-url "$HARVESTER_API_URL_VALUE" --health-only
systemctl enable --now kaggle-harvester-wechat-bridge.service >/dev/null
systemctl is-active --quiet kaggle-harvester-wechat-bridge.service || fail '微信桥接服务未启动'
log '部署完成：应用运行，OpenClaw 健康检查通过'
docker compose --env-file "$COMPOSE_ENV_FILE" ps
