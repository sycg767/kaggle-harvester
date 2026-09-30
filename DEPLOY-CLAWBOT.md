# 微信助手部署与诊断

当前生产项目为 `/root/kaggle-harvester`，OpenClaw 用户为 `openclaw`。
此文替代旧的“复制凭据到容器、猜测 HTTP 消息端点”方式。

## 更新

日常只运行 `update-kaggle-harvester`。第一次从旧版脚本升级时，需要先从 Git 更新脚本入口，避免旧脚本继续执行清理会话逻辑：

```bash
cd /root/kaggle-harvester
git pull --ff-only
install -m 755 scripts/update-kaggle-harvester.sh /usr/local/sbin/update-kaggle-harvester
update-kaggle-harvester
```

脚本尊重 `KAGGLE_HARVESTER_REPO_DIR`、`OPENCLAW_USER`、`OPENCLAW_REPO_DIR`、`COMPOSE_ENV_FILE`、`NODE_BIN` 与 `OPENCLAW_JS`。
目标用户和已登录微信账号必须已存在；脚本不重新扫码、不清除记忆或会话。
OpenClaw 的模型配置按显式环境变量合并，缺少密钥时保留既有配置。修改前保留 `.pre-managed.bak`。
网关配置实际变化时才重启。Python 战报脚本更新不需要清空聊天上下文。

## 两个宿主机服务

- `kaggle-harvester-openclaw.service`：以专用用户运行网关。保留 loopback 监听，不开放 18789 到公网。
- `kaggle-harvester-wechat-bridge.service`：宿主机状态与发送桥接。没有 HTTP 监听端口；通过现有持久化目录交换请求和回执。

状态快照每约 30 秒写入 `harvested_kernels/_cache/clawbot_health.json`，不包含凭据或微信用户标识，超过 90 秒显示未验证。
网页分别显示宿主机网关、微信插件、业务 API 和收件配置。容器 TCP 测试失败不代表微信离线。

主动推送仅支持当前唯一已登录、已建立上下文的二维码绑定用户，不猜测“最后活跃用户”。
桥接使用已安装腾讯微信插件 2.4.6 的 iLink `sendmessage` 协议，凭据仅在宿主机读取；
只有 HTTP 成功且平台 `ret=0` 才记录平台受理回执，这不代表用户已经阅读。
平台错误、超时或结果不明不再记为成功。发送中断的请求不会盲目重发，以避免重复消息。
若上下文失效，先在微信给机器人发消息；有多个账号时需先明确目标，不自动选择。

请求和回执位于 `_cache/wechat_outbox/`，事件标识保持幂等。
健康 CLI、桥接本身均不发测试消息。已有自动通知按用户原来开启的事件规则执行。

## 微信排版与指令

`openclaw/harvester-format` 插件只对 `openclaw-weixin` 的发送内容做纯文本处理，去掉 Markdown 加粗、反引号、围栏和表格标记。
脚本战报要求原样转发，避免模型重新组织出错误格式；需要分析时才进行简短解释，不能编造下一场开赛时间。

- 战况、分数、排名：调用 `python3 backend/harvester/wechat_bot.py`，重点在前，每个 Agent 显示关键指标和最近一局。
- 刷新：加 `--refresh`，真实调用后台检查；失败明确报告，不改自动监控开关。
- 流水：加 `--history-only`，默认每 Agent 5 场，可用 `--limit 15` 增加。
- 走势图：加 `--chart`，保留 `MEDIA:` 图片返回方式。

战报使用实际采集时间，保留停用、失败和过期提示，不把旧快照称作实时数据。

## 验证

```bash
systemctl status kaggle-harvester-openclaw kaggle-harvester-wechat-bridge
journalctl -u kaggle-harvester-wechat-bridge -n 30
```

不要公开粘贴完整网关日志、账号配置或运行环境文件。
源码与部署修改仍遵循先本地测试、Git 推送，再服务器一键更新；不直接覆盖生产仓库。
