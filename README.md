# Kaggle Harvester

本地运行的 Kaggle 公开 Kernel 检索与归档工具。默认竞赛为
`rogii-wellbore-geology-prediction`，也可在发现页输入其他竞赛 slug。

## 主要能力

- 按 Kaggle 投票、热度、创建时间或运行时间检索公开 Kernel。
- 快速列表与公开分数补充解耦，可限制昂贵的分数读取数量。
- 查看 Kernel 版本历史，归档最佳、最新或指定版本。
- 支持批量归档、可选输出文件、重复归档检测和实际进度反馈。
- 支持按分数阈值定时检查，并把命中的最佳历史版本自动归档到本地。
- 查看本地归档的元数据、输入依赖和文件清单。
- 支持打开归档目录、下载源文件、批量删除和导出 CSV 清单。
- Windows 上的 Kaggle CLI 统一经仓库 UTF-8 包装脚本调用。

## 缓存策略

普通打开不会重新拉取 Kaggle：Kernel 查询快照、竞赛信息和已读取分数都会
持久化到 `harvested_kernels/_cache/`，服务重启后仍然有效。

- 页面始终先显示最近一次成功快照；分数榜索引超过检查间隔后在后台刷新，
  不会把列表清空或阻塞页面。
- 后台刷新按查询条件去重；页面会显示“后台更新中”，完成后自动替换为新榜单。
- 点击“强制刷新”会等待本次刷新结果；失败时仍回退到最近一次成功快照。
- 已完成版本的分数按 `Kernel ref + version_number` 永久保存，不会重复读取。
- 强制刷新只检查 Kernel 列表和是否出现新版本；已有版本分数不会重算。
- 版本弹窗的“检查新版本”会更新版本目录，只读取新增版本的分数。

## 自动归档

在 Kernel 浏览页点击“自动归档”，可设置监控竞赛、分数阈值、刷新间隔和
是否包含输出。任务会从竞赛信息和公开榜单自动判断“越低越好”或“越高越好”，
每次读取对应方向的公开分数榜前 50 条，并对阈值执行严格比较；同一版本已存在
时直接跳过，后续出现更优的新版本时会新增归档。
支持 1、2 分钟高频检查；已成功处理的 Kernel 会记录 `last_run_time`，未变化
时不再请求其历史版本，因此稳定状态下每轮只刷新一次榜单索引。

配置和最近运行结果持久化在
`harvested_kernels/_cache/auto_archive.json`。定时任务由后端进程执行，关闭
浏览器页面不会中断；停止本工具后任务暂停，下次启动会按持久化计划立即补做
已到期的检查。设置弹窗会展示调度器在线状态、服务启动时间和最近心跳。
自动归档默认关闭，不会在未配置阈值时主动访问 Kaggle。
设置弹窗会显示最近 500 次持久化运行记录，包括定时/手动触发、完成时间、
耗时、检查数、命中数、归档、跳过和失败数量；点击一条记录可查看当次全部
Kernel，并按 Kernel、作者或处理结果筛选。明细独立保存在
`harvested_kernels/_cache/auto_archive_runs/`，不会把 Token 或请求头写入日志。
打开弹窗时每 5 秒读取一次本地状态，不会额外访问 Kaggle。

### 通知

自动归档设置中可启用通用 Webhook 或 SMTP 邮件通知。Webhook 兼容通用 JSON、
飞书、钉钉、企业微信、Slack 和 ntfy。默认只在新增归档或检查失败时发送；普通
检查没有新增且没有失败时保持静默。每个运行日志作为一个通知事件，后台发送
失败会重试最多 3 次并在服务重启后继续处理，不会改变已经完成的归档结果。

通知非敏感配置保存在 `harvested_kernels/_cache/notifications.json`。Windows 下
Webhook 地址和 SMTP 密码使用当前用户 DPAPI 加密后单独保存到
`harvested_kernels/_cache/notification_secrets.dat`，API 和界面只返回“是否已经
配置”，不会回显凭据。也可通过环境变量
`HARVESTER_NOTIFICATION_WEBHOOK_URL` 和
`HARVESTER_NOTIFICATION_SMTP_PASSWORD` 提供凭据，环境变量优先。

## 启动

需要 Python 3.11+、Node.js 18+、npm 和 Kaggle CLI。

```powershell
.\start.ps1
```

首次启动会按需安装依赖并自动打开浏览器。常用参数：

```powershell
.\start.ps1 -SkipInstall -NoBrowser
.\start.ps1 -BackendPort 8010 -FrontendPort 5180
```

默认地址：

- 应用：`http://127.0.0.1:5173`
- API 文档：`http://127.0.0.1:8000/docs`
- 本地归档：`harvested_kernels/`

### 登录后持续运行（可选）

如需让定时归档在关闭终端后仍长期运行，可为当前 Windows 用户安装登录自启动
任务。任务异常退出后会在一分钟后自动重启：

```powershell
.\install-autostart.ps1
```

移除自启动任务：

```powershell
.\install-autostart.ps1 -Uninstall
```

## 配置

可在当前 PowerShell 会话设置环境变量，也可创建 `backend/.env`：

```dotenv
KAGGLE_API_TOKEN=your_token
KAGGLE_COMPETITION=rogii-wellbore-geology-prediction
```

`KAGGLE_API_TOKEN` 不会显示在界面或日志中。未配置 Token 时，Kaggle CLI
若已有本机凭据仍可能读取列表，但内部公开分数接口不可用。

## 验证

```powershell
python -m unittest discover -s backend/tests -v
Push-Location frontend
npm test
npm run test:e2e
npm run build
Pop-Location
```

出现问题时先查看顶部“运行状态”，再检查 `backend-error.log` 与
`frontend-error.log`。所有 Kaggle 操作均为读取或本地归档；本工具不会推送
Kernel、上传数据集或提交竞赛结果。
