# 云服务器部署教程（含微信 ClawBot）

本文面向“从私有 Git 仓库拉取代码，在 Ubuntu 云服务器上用 Docker Compose 构建并运行”
的部署方式，并补充新增加的 OpenClaw 微信 ClawBot 配置。

基础的两容器部署（`backend` + `frontend`）请先参考 [DEPLOY.md](./DEPLOY.md)。
本文只补充新功能在云端需要额外做的四件事：

1. 在 `.env.deploy` 中填写 `OPENCLAW_LLM_*` 变量；
2. 运行 `scripts/setup_openclaw.py` 生成 OpenClaw 配置；
3. 给 OpenClaw 运行环境注入 `HARVESTER_API_URL` 和 `HARVESTER_API_KEY`；
4. 可选地把宿主机 `~/.openclaw` 挂载进 `backend` 容器，让网页显示 ClawBot 状态。

## 一、架构

```text
手机微信
   │ 发消息：战况 / 分数 / 刷新
   ▼
OpenClaw（微信 ClawBot 进程，宿主机制）
   │ 调用 skill：python backend/harvester/wechat_bot.py
   ▼
HARVESTER_API_URL（HTTPS 域名或服务器内网地址）
   ▼
Caddy / Cloudflare Tunnel
   ▼
frontend(Nginx) ── /api ──► backend(FastAPI) ──► Kaggle / 本地缓存
```

关键点：`wechat_bot.py` 默认访问 `http://127.0.0.1:8000`，这只适合本地开发。
容器部署下 `backend` 没有把 `8000` 映射到宿主机，因此必须显式设置
`HARVESTER_API_URL`，建议使用公网 HTTPS 域名下的
`https://你的域名/api/simulation-monitor`。

## 二、拉取代码并准备环境文件

在服务器执行：

```bash
cd /opt/kaggle-harvester
git pull --ff-only
cp .env.deploy.example .env.deploy
chmod 600 .env.deploy
nano .env.deploy
```

除原有 `KAGGLE_API_TOKEN`、`HARVESTER_API_KEY`、`HARVESTER_ALLOWED_ORIGINS` 外，
新功能需要填写：

```dotenv
OPENCLAW_LLM_BASE_URL=https://tokenrhythm.studio/v1
OPENCLAW_LLM_API_KEY=你的大模型API密钥
OPENCLAW_LLM_MODEL=deepseek-v4-flash-0731
```

- 这些变量只被 `scripts/setup_openclaw.py` 读取，不会进入容器，因此不需要出现在
  `docker-compose.yml` 中。
- 它们会被写入 OpenClaw 用户目录下的 `~/.openclaw/openclaw.json`，属于敏感信息，
  请保持 `.env.deploy` 权限为 `600`。

## 三、构建并启动容器

```bash
cd /opt/kaggle-harvester
docker compose --env-file .env.deploy up -d --build
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy logs --tail=100 backend
```

确认两个容器均为 `running`，然后检查健康接口：

```bash
curl -I http://127.0.0.1:8080
curl http://127.0.0.1:8080/api/health
```

## 四、配置 OpenClaw 微信 ClawBot

1. 在服务器上安装并启动 OpenClaw，安装方式以 OpenClaw 官方文档为准
   （CLI、systemd 或容器均可）。微信插件绑定也按官方指引完成，通常需要手机微信扫码。
2. 在仓库根目录运行一键配置脚本：

```bash
cd /opt/kaggle-harvester
python3 scripts/setup_openclaw.py
```

脚本会自动：

- 读取 `.env.deploy` 中的 `OPENCLAW_LLM_*`；
- 写入 `~/.openclaw/openclaw.json`（模型服务商、默认模型、微信插件开关、本地网关）；
- 初始化 `~/.openclaw/workspace/` 和技能文件
  `~/.openclaw/skills/kaggle-harvester/SKILL.md`；
- 技能文件会调用 `backend/harvester/wechat_bot.py` 生成实时战报。

3. 重启 OpenClaw 进程，使新配置生效，并按提示完成微信账号绑定。

## 五、打通微信机器人与后端 API

`wechat_bot.py` 通过 HTTP 请求后端，且不会自动读取 `.env.deploy`。
必须在 OpenClaw 运行环境中注入以下两个变量：

```dotenv
HARVESTER_API_URL=https://你的域名/api/simulation-monitor
HARVESTER_API_KEY=与 .env.deploy 中相同的高强度密钥
```

- 使用 systemd 时，在 service 文件 `[Service]` 中添加：

```ini
Environment=HARVESTER_API_URL=https://你的域名/api/simulation-monitor
Environment=HARVESTER_API_KEY=你的API密钥
```

- 使用容器运行 OpenClaw 时，通过 `-e HARVESTER_API_URL=... -e HARVESTER_API_KEY=...`
  传入，或写入其容器编排的环境变量。

同时确保 OpenClaw 使用的 Python 环境已安装 `httpx`：

```bash
python3 -m pip install httpx
```

否则 `wechat_bot.py` 请求 API 时会失败，并回退到本地 `harvester` 导入逻辑，
云服务器上的 OpenClaw 环境一般不具备该依赖和仓库路径。

## 六、让网页显示 ClawBot 状态（可选但推荐）

后端在快照中读取 `Path.home()/.openclaw/openclaw.json` 来报告 ClawBot 状态。
容器内 `HOME=/root`，而配置生成在宿主机用户目录，因此默认会显示“未检测到本地配置”。

在 `docker-compose.yml` 的 `backend.volumes` 中追加一行（或使用 override 文件），
然后重新构建：

```yaml
services:
  backend:
    volumes:
      - ~/.openclaw:/root/.openclaw:ro
```

```bash
docker compose --env-file .env.deploy up -d --build
```

只读挂载不会让容器修改 OpenClaw 配置，也能让页面显示“微信 ClawBot 已就绪”。

## 七、验证

1. 打开网页，进入“Pokemon TCG 对战监控”，确认仿真监控调度器在线；
2. 配置目标 `submission_id` 并手动运行一次，确认能读到积分、排名和奖牌线；
3. 页面 ClawBot 徽章为“已就绪”，弹窗中的模型和服务商信息正确；
4. 手机微信向机器人发送“战况”，应收到包含双 Agent 积分、排名、胜率和最新一局对战的战报；
5. 微信发送“刷新”，观察后端日志确认触发了一次 `POST /api/simulation-monitor/run`。

## 八、日常更新

首次在服务器建立动态软链接（永久动态生效，仓库更新后命令自动更新）：

```bash
cd /opt/kaggle-harvester || cd ~/kaggle-harvester
sudo ln -sf "$(pwd)/scripts/update-kaggle-harvester.sh" /usr/local/sbin/update-kaggle-harvester
sudo chmod +x "$(pwd)/scripts/update-kaggle-harvester.sh"
```

以后本地完成 `commit` 和 `push` 后，服务器只需无脑执行：

```bash
sudo /usr/local/sbin/update-kaggle-harvester
```

脚本会依次执行 `git pull --ff-only`、Docker Compose 构建与启动、同步 `wechat_bot.py`、更新 OpenClaw 提示词并热重启 OpenClaw 进程。

如果服务器仓库不在 `~/kaggle-harvester`，可以在安装前指定：

```bash
sudo install -o root -g root -m 750 \
  scripts/update-kaggle-harvester.sh \
  /usr/local/sbin/update-kaggle-harvester

sudo KAGGLE_HARVESTER_REPO_DIR=/opt/kaggle-harvester \
  /usr/local/sbin/update-kaggle-harvester
```

脚本默认假设 OpenClaw 用户为 `openclaw`，辅助仓库目录为
`/home/openclaw/kaggle-harvester`。如果实际路径不同，可以在执行时覆盖：

```bash
sudo OPENCLAW_REPO_DIR=/实际路径 \
  /usr/local/sbin/update-kaggle-harvester
```

不建议再手动拆开执行更新命令；如需排查问题，可以分别运行：

```bash
cd /opt/kaggle-harvester
git pull --ff-only
docker compose --env-file .env.deploy up -d --build
```

不要再次运行 `scripts/setup_openclaw.py`，它会覆盖已经运行中的 OpenClaw 配置。

OpenClaw 侧修改配置后同样需要重启其进程。不要执行 `docker compose down -v`，
避免删除 `harvested_kernels` 卷数据。

## 九、常见问题

- 微信收到“战报获取失败”且提示连接错误：检查 `HARVESTER_API_URL` 是否可公网访问、
  `HARVESTER_API_KEY` 是否与 `.env.deploy` 一致、`httpx` 是否已安装。
- 页面 ClawBot 显示“未检测到本地配置”：确认 `~/.openclaw/openclaw.json` 存在，
  并已按第六节挂载进 `backend` 容器。
- 页面显示“已配置但未开启插件”：运行 `setup_openclaw.py` 后重启 OpenClaw，
  确认 `openclaw-weixin` 插件处于启用状态。
- 微信能收到战报但数据为空：先在网页中启用仿真监控并手动运行一次，
  确认目标 `submission_id` 和奖牌线已正常读取。
- 防火墙：不需要开放 OpenClaw 网关端口 `18789`、后端 `8000` 和未经反向代理保护的
  `8080`；公网入口只保留 `80/443`（Caddy/Cloudflare）。

## 十、安全提示

- 私有仓库中不应包含 `.env.deploy`、Token、API Key、SMTP 密码和日志文件。
- `HARVESTER_API_KEY` 应使用高强度随机值，仅通过环境变量注入。
- 生产环境必须使用 HTTPS 和至少一层额外访问控制（如 Cloudflare Access）。
- 定期备份 `harvested_kernels/`，回滚时不要覆盖运行数据。
