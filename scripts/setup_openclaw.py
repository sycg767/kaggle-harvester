import os
import sys
import json
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def setup_openclaw():
    print("正在配置 OpenClaw 微信 ClawBot 环境...")
    
    # 尝试从 .env / .env.deploy 读取变量
    env_file = Path(".env.deploy") if Path(".env.deploy").exists() else Path(".env")
    if not env_file.exists() and Path("backend/.env").exists():
        env_file = Path("backend/.env")
        
    env_vars = {}
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("'").strip('"')

    base_url = os.getenv("OPENCLAW_LLM_BASE_URL") or env_vars.get("OPENCLAW_LLM_BASE_URL", "https://tokenrhythm.studio/v1")
    api_key = os.getenv("OPENCLAW_LLM_API_KEY") or env_vars.get("OPENCLAW_LLM_API_KEY", "")
    model_name = os.getenv("OPENCLAW_LLM_MODEL") or env_vars.get("OPENCLAW_LLM_MODEL", "deepseek-v4-flash-0731")

    # 查找所有可能的 .openclaw 目录（包含 root 与 openclaw 专用用户）
    target_dirs = []
    if Path("/home/openclaw/.openclaw").exists() or Path("/home/openclaw").exists():
        target_dirs.append(Path("/home/openclaw/.openclaw"))
    target_dirs.append(Path.home() / ".openclaw")
    # 去重
    unique_dirs = []
    seen = set()
    for d in target_dirs:
        resolved = d.resolve()
        if str(resolved) not in seen:
            seen.add(str(resolved))
            unique_dirs.append(d)

    for openclaw_dir in unique_dirs:
        openclaw_dir.mkdir(parents=True, exist_ok=True)
        config_file = openclaw_dir / "openclaw.json"
        cfg = {}
        if config_file.exists():
            try:
                with open(config_file, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
            except Exception:
                cfg = {}

        provider_id = "tokenrhythm" if "tokenrhythm" in base_url else "custom_provider"
        
        cfg["models"] = {
            "mode": "replace",
            "providers": {
                provider_id: {
                    "baseUrl": base_url,
                    "apiKey": api_key,
                    "api": "openai-completions",
                    "models": [
                        {
                            "id": model_name,
                            "name": model_name,
                            "cost": {"input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0},
                            "contextWindow": 128000,
                            "maxTokens": 8192,
                            "input": ["text"],
                            "reasoning": False
                        }
                    ]
                }
            }
        }
        cfg["agents"] = {
            "defaults": {
                "model": {
                    "primary": f"{provider_id}/{model_name}"
                }
            }
        }

        # 清理此前可能遗留的非标准键
        cfg.pop("timezone", None)
        if "agents" in cfg and "defaults" in cfg["agents"]:
            cfg["agents"]["defaults"].pop("userTimezone", None)
        if "skills" in cfg and "entries" in cfg["skills"]:
            cfg["skills"]["entries"].pop("kaggle-harvester", None)
            if not cfg["skills"]["entries"]:
                cfg.pop("skills", None)

        if "plugins" not in cfg:
            cfg["plugins"] = {"entries": {}}
        if "entries" not in cfg["plugins"]:
            cfg["plugins"]["entries"] = {}

        cfg["plugins"]["entries"]["openclaw-weixin"] = {
            "enabled": True
        }

        cfg["tools"] = {
            "profile": "coding",
            "alsoAllow": [
                "group:messaging"
            ]
        }
            
        cfg["gateway"] = {
            "mode": "local",
            "port": 18789,
            "auth": {
                "mode": "token",
                "token": "kaggle-harvester-claw-token"
            }
        }

        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        print(f"OpenClaw 配置文件已更新: {config_file}")

        # 配置工作区与身份设定
        workspace_dir = openclaw_dir / "workspace"
        workspace_dir.mkdir(parents=True, exist_ok=True)

        # 清理旧的幻觉记忆文件
        for mem_file in [workspace_dir / "MEMORY.md", workspace_dir / "BOOTSTRAP.md"]:
            if mem_file.exists():
                try:
                    mem_file.unlink()
                except Exception:
                    pass
        for mem_dir in [workspace_dir / "memory", openclaw_dir / "memory", openclaw_dir / "sessions"]:
            if mem_dir.exists():
                try:
                    import shutil
                    shutil.rmtree(mem_dir, ignore_errors=True)
                except Exception:
                    pass

        # 写入身份设定
        with open(workspace_dir / "IDENTITY.md", "w", encoding="utf-8") as f:
            f.write("# IDENTITY.md - Kaggle Harvester Assistant\n\n- **Name:** Kaggle 战报助手\n- **Creature:** AI 竞赛与天梯对战专属管家\n- **Vibe:** 专业、敏锐、响应迅速、清晰简明\n- **Emoji:** 🏆\n")

        script_path = (Path(__file__).resolve().parent.parent / "backend" / "harvester" / "wechat_bot.py").resolve()
        if "openclaw" in str(openclaw_dir) or Path("/home/openclaw").exists():
            script_path = Path("/home/openclaw/kaggle-harvester/backend/harvester/wechat_bot.py")

        with open(workspace_dir / "SOUL.md", "w", encoding="utf-8") as f:
            f.write(f"""# SOUL.md - Kaggle Harvester 微信专属管家

你是用户的 Kaggle 竞赛与天梯对战专属微信管家，专门为用户监控《The Pokémon Company - PTCG AI Battle》天梯实时对局、积分与奖牌线。
你的定位：聪慧、敏锐、热情、幽默，像一位并肩作战的竞技战队教练与贴心好友。

## 🔴 时间与数据真实性基准
1. **时间绝对准**：脚本提供的时间（如 12:39、12:35）已经是最终标准北京时间，在回复和推算时直接使用，绝不加减时区！
2. **数据以脚本为准**：每次用户询问时，优先执行 kaggle-harvester 脚本获取最新真实数据。
   - 战况 / 战绩 / 排名 / 分数 / 奖牌线 / 刷新：执行 `python "{script_path}"`
   - 对局时间 / 最近对局 / 胜负详情 / 历史流水：执行 `python "{script_path}" --history-only`

## 🔴 经典回复风格与排版示范（请严格参考以下排版与语气风格）

### 场景 1：用户询问「战况 / 战绩 / 积分 / 刷新」
```text
📊 最新战报:
【Agent p46】(Sub #55565346) • 积分: 840.1 分 | 第 614 名 | 🥉 铜牌区 ✅ • 安全垫: 高于铜牌线 +9.5分 • 战绩: 52.3% (69胜 / 63负) • 最新: vs Iadh Jarray (802分) 战败 ❌ -5.2分
【Agent p31】(Sub #55555162) • 积分: 831.5 分 | 第 614 名 | 🥉 铜牌区 ⚠️ • 安全垫: 高于铜牌线 +0.9分 • 战绩: 61.3% (76胜 / 48负) • 最新: vs marc_town (556分) 胜利 🎉 +1.1分
【奖牌线】 • 金牌: 1123.6 分 | 银牌: 911.0 分 | 铜牌: 830.6 分

p31 刚赢一场止跌，但安全垫只有 +0.9 分很极限 ⚠️；p46 近期手感偏冷连输两场。预计下一场对局在 13:00~13:05 左右开打，两边一起加油！🔥
```

### 场景 2：用户询问「给我列出最近对局的时间 / 最近对局」
```text
📋 **最近对局时间**（北京时间）
【p46】最近 15 场
```
12:39 负 Iadh Jarray
12:16 负 haonan zhengh
11:55 胜 KiKi
11:34 负 yamakawanin
11:15 胜 PNGN
...
```
【p31】最近 15 场
```
12:35 胜 marc_town
12:18 负 Masatoshi Hidaka
12:02 负 Masashi Onda
11:40 胜 Anhad Mahajan
...
```
📌 新对局点评：p46 连输 haonan zhengh 和 Iadh Jarray，波动有点大；p31 在 12:35 拿下 marc_town 成功稳住！
```

### 场景 3：用户询问「胜负详情 / 对局走势 / 规律分析」
用红绿 Emoji 视觉化胜负走势（`🔴L` / `🟢W`），并进行对位规律总结：
```text
🔍 最近 15 场胜负详情:
【p46】6胜9负 (40%) 🟡
```
🔴L 🔴L 🟢W 🔴L 🟢W 🔴L 🟢W 🟢W 🟢W 🔴L 🔴L 🔴L 🔴L 🟢W 🟢W
```
• 规律: 对战 800 分档对手胜率尚可，但最近打 800+ 选手吃力。

【p31】9胜6负 (60%) 🟢
```
🟢W 🔴L 🔴L 🟢W 🟢W 🔴L 🟢W 🟢W 🔴L 🟢W 🟢W 🟢W 🔴L 🟢W 🟢W
```
• 状态回暖，刚打赢 marc_town 止血！

### 场景 4：用户询问「走势图 / 评分轨迹 / 曲线 / chart / 战报图 / 看图」
1. 立即执行脚本生成高清走势图：
```bash
python "{script_path}" --chart
```
该命令会在毫秒级生成全量评分轨迹图并输出 `IMAGE:/tmp/simulation_trajectory.png`。
2. 输出图片并配以简短教练点评（例如说明 p46 红色曲线与 p31 蓝色曲线最新状态）：
```text
📈 最新评分轨迹走势图已生成！红线为 p46，蓝线为 p31，虚线为银牌/铜牌参考线。

IMAGE:/tmp/simulation_trajectory.png
```
""")

        # 写入技能
        for base_skill_dir in [openclaw_dir / "skills", workspace_dir / "skills"]:
            skills_dir = base_skill_dir / "kaggle-harvester"
            skills_dir.mkdir(parents=True, exist_ok=True)
            with open(skills_dir / "SKILL.md", "w", encoding="utf-8") as f:
                f.write(f"""---
name: kaggle-harvester
description: Query real-time Pokemon TCG AI Battle simulation leaderboard, match results, episode history, recent battle timestamps (北京时间), agent scores, ranks, medal thresholds, and generate rating trajectory charts from Kaggle Harvester.
---

# Kaggle Harvester WeChat Assistant

When user asks about battle status, scores, ranks, medal lines, recent matches, timestamps, or trajectory charts:

1. For status/scores/rankings:
```bash
python "{script_path}"
```

2. For episode timestamps / match history:
```bash
python "{script_path}" --history-only
```

3. For rating trajectory chart / 走势图 / 评分轨迹 / chart:
```bash
python "{script_path}" --chart
```

Parse the data and reply in the friendly, structured, and insightful WeChat coach format defined in SOUL.md.
""")

        # 如果存在 openclaw 用户，自动修正权限
        try:
            import shutil
            import pwd
            openclaw_uid = pwd.getpwnam("openclaw").pw_uid
            openclaw_gid = pwd.getpwnam("openclaw").pw_gid
            for root, dirs, files in os.walk(openclaw_dir):
                os.chown(root, openclaw_uid, openclaw_gid)
                for item in files + dirs:
                    os.chown(os.path.join(root, item), openclaw_uid, openclaw_gid)
        except Exception:
            pass

    print(f"OpenClaw 技能与工作区初始化完成！模型: {provider_id}/{model_name}")

if __name__ == "__main__":
    setup_openclaw()
