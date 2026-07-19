# Docker 上线手册

本文按一台 Ubuntu 云服务器、一个私有 Git 仓库、一个域名来说明。
当前部署包含两个容器：

- `backend`：FastAPI、Kaggle CLI、自动归档调度器、通知 worker；
- `frontend`：Nginx 静态页面，把 `/api` 反向代理到 `backend`。

`harvested_kernels/` 是运行数据，不进入 Git，也不打进镜像。它通过 Docker 卷挂载到宿主机，包含归档 notebook、分数缓存、自动归档配置和运行日志。

## 一、第一次在本地初始化 Git

在本目录执行。Git 仓库只包含工具源码和部署配置，不包含竞赛工作区、历史归档、Token、邮件密码、`node_modules` 或构建产物。

```powershell
cd C:\Users\X\Desktop\grad_workspace\competitions\rogii-wellbore-geology-prediction\workspace\tools\kaggle-harvester
git init -b main
git add .
git status
git commit -m "chore: 初始化 Kaggle Harvester"
```

提交前确认 `git status` 中没有以下内容：

- `harvested_kernels/`；
- `backend/.env` 或 `.env.deploy`；
- `*.log`；
- `frontend/node_modules/` 和 `frontend/dist/`。

本地仓库初始化后，再在 GitHub、GitLab 或 Gitee 创建**私有**空仓库并绑定远端：

```powershell
git remote add origin <你的私有仓库地址>
git push -u origin main
```

不要把 Kaggle Token、Webhook 地址或 SMTP 授权码写进 Git。远端仓库必须设为私有。

## 二、云服务器准备

建议使用 Ubuntu 22.04/24.04，配置至少 2 vCPU、4 GB 内存、40 GB 系统盘，并另准备足够存放归档的磁盘空间。

SSH 登录服务器后安装 Docker、Compose 和 Git：

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

如果系统仓库没有 `docker-compose-plugin`，应按 Docker 官方仓库安装 Compose 插件，不要下载来路不明的二进制文件。

防火墙建议只放行：

- `22/tcp`：SSH，最好限制为自己的固定 IP；
- `80/tcp`、`443/tcp`：仅在使用 Caddy/Nginx 直接接收公网 HTTPS 时开放。

不要开放后端 `8000/tcp`，也不要把 Docker 的 `8080` 直接暴露到公网。

## 三、服务器目录

先创建空的源码目录并把权限交给部署用户。此时不要提前创建子目录，否则 Git 无法克隆到非空目录：

```bash
sudo mkdir -p /opt/kaggle-harvester
sudo chown "$USER":"$USER" /opt/kaggle-harvester
cd /opt/kaggle-harvester
```

最终目录结构如下：

```text
/opt/kaggle-harvester/
├── backend/
├── frontend/
├── docker-compose.yml
├── .env.deploy                 # 仅服务器存在，权限 600
└── harvested_kernels/          # 运行数据，不进 Git
    └── _cache/
```

## 四、从私有 Git 仓库拉取

推荐使用服务器上的 SSH Deploy Key，避免在命令行里输入 Git 密码：

```bash
git clone <你的私有仓库地址> /opt/kaggle-harvester
cd /opt/kaggle-harvester
mkdir -p harvested_kernels
```

如果仓库使用 HTTPS，也可以先用 HTTPS 克隆，但不要把访问 Token 写入远端 URL 或 shell 历史。

如果要迁移本地已有归档，在本地执行：

```powershell
scp -r .\harvested_kernels\* <服务器用户>@<服务器地址>:/opt/kaggle-harvester/harvested_kernels/
```

不要使用 `--delete`，避免误删服务器上已经产生的新归档。

## 五、创建服务器环境文件

```bash
cd /opt/kaggle-harvester
cp .env.deploy.example .env.deploy
chmod 600 .env.deploy
nano .env.deploy
```

至少填写：

```dotenv
KAGGLE_API_TOKEN=你的_Kaggle_Token
KAGGLE_COMPETITION=rogii-wellbore-geology-prediction
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=8080
```

如果启用通知，再填写：

```dotenv
HARVESTER_NOTIFICATION_WEBHOOK_URL=https://...
HARVESTER_NOTIFICATION_SMTP_PASSWORD=邮箱授权码或应用专用密码
```

SMTP 密码必须是授权码/应用密码，不是邮箱登录密码。Linux 容器不支持 Windows DPAPI，因此通知密钥应使用环境变量注入；不要只在界面临时填写后依赖容器重启保留。

检查 Compose 展开结果，但不要把输出贴到公开位置：

```bash
docker compose --env-file .env.deploy config
```

## 六、构建并启动

```bash
cd /opt/kaggle-harvester
docker compose --env-file .env.deploy up -d --build
docker compose --env-file .env.deploy ps
docker compose --env-file .env.deploy logs --tail=100 backend
```

看到 `backend` 和 `frontend` 均为 `running` 后，在服务器本机检查：

```bash
curl -I http://127.0.0.1:8080
curl http://127.0.0.1:8080/api/health
```

健康检查需要确认 Kaggle CLI、Token 和归档目录状态。首次启动不要立刻打开自动归档，先手动检查一次 Kaggle 查询和本地归档。

## 七、绑定域名和 HTTPS

当前容器只监听 `127.0.0.1:8080`，推荐使用 Caddy 或 Cloudflare Tunnel 接收域名请求：

```text
浏览器 → HTTPS 域名 → Caddy/Cloudflare → 127.0.0.1:8080 → frontend → backend:8000
```

若使用 Caddy，反向代理核心配置类似：

```text
kaggle.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

若使用 Cloudflare，建议开启 Access 登录保护；当前 API 没有内置用户认证，不能直接把管理界面裸露到公网。Cloudflare 只负责 DNS、HTTPS、Access/WAF，不承载当前的 FastAPI 调度进程。

## 八、日常更新

```bash
cd /opt/kaggle-harvester
git pull --ff-only
docker compose --env-file .env.deploy up -d --build
docker compose --env-file .env.deploy ps
```

只更新前端或后端时也可以重建整套 Compose；运行数据不会因为重建丢失。不要执行 `docker compose down -v`，否则可能删除卷。

## 九、备份和回滚

定期备份运行数据：

```bash
sudo tar -czf /var/backups/kaggle-harvester-$(date +%F).tar.gz \
  -C /opt/kaggle-harvester harvested_kernels
```

回滚源码：

```bash
git log --oneline -10
git checkout <已验证的提交号>
docker compose --env-file .env.deploy up -d --build
```

回滚时不要覆盖 `harvested_kernels/`，除非同时恢复了对应的数据备份。

## 十、上线验收清单

1. `/api/health` 返回 200，Kaggle CLI 和 Token 已配置；
2. 发现页能读取公开 Kernel 和分数；
3. 手动归档能在 `harvested_kernels/` 生成文件；
4. 自动归档状态显示调度器在线；
5. 通知测试成功，容器重启后配置仍符合预期；
6. 域名通过 HTTPS 访问，并有 Cloudflare Access 或其他鉴权；
7. 服务器安全组没有开放 `8000` 和未经保护的 `8080`；
8. 已配置 `harvested_kernels/` 的定期备份。
