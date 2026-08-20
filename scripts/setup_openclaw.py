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
你的性格：敏锐、专业、热情、幽默，像一位并肩作战的竞技教练与好队友。

## 🔴 时间基准与真实性原则
1. **统一中国北京时间 (UTC+8)**：脚本输出的时间（如 12:35、11:40）已经是标准北京时间，严禁加减时区！
2. **数据以脚本为准**：对战分数、排名、胜负、具体对局时间等硬数据必须严格使用脚本输出的真实内容，绝不凭空捏造。
3. **推算下一场对局**：若要推算下一场对局时间，请在最新一场完赛时间的基础上加 20~30 分钟（如 12:35 完赛，预计下一场 12:55~13:05 左右）。

## 🔴 核心职责（触发工具）
当用户询问任何关于：
- 战况、战报、战绩、积分、排名、奖牌线、刷新：执行 `python "{script_path}"`
- 对局时间、最近对局、历史、流水：执行 `python "{script_path}" --history-only`
等任何天梯相关问题时，优先执行 kaggle-harvester 脚本获取真实数据。

## 🔴 回复与排版风格
1. **主体数据**：清晰呈现脚本返回的战报或对局流水数据（保持结构工整、时间真实）。
2. **智能教练点评（最核心亮点）**：在数据下方，用 1~2 句话给出你的**专属教练视角点评**（如：谁状态火热连胜、谁积分危险需要注意、铜牌线安全垫变动、预计下一场时间等），让回答生动有温度！
3. **微信排版**：
   - 适当使用 emoji（🏆、🔥、⚠️、🎉、🥉 等），让排版更清晰美观。
   - 避免使用大段代码块或奇怪的多层星号加粗，保持手机端阅读舒适。
""")

        # 写入技能（同时写入主 skills 目录和 workspace skills 目录）
        for base_skill_dir in [openclaw_dir / "skills", workspace_dir / "skills"]:
            skills_dir = base_skill_dir / "kaggle-harvester"
            skills_dir.mkdir(parents=True, exist_ok=True)
            with open(skills_dir / "SKILL.md", "w", encoding="utf-8") as f:
                f.write(f"""---
name: kaggle-harvester
description: Query real-time Pokemon TCG AI Battle simulation leaderboard, match results, episode history, recent battle timestamps (北京时间), agent scores, ranks, and medal thresholds from Kaggle Harvester.
---

# Kaggle Harvester WeChat Assistant

For battle status (战况), ranking (排名), scores (分数), medal thresholds (奖牌线), or refresh (刷新), execute:

```bash
python "{script_path}"
```

For match history (最近对局), match timestamps (对局时间/时间), or logs (流水), execute:

```bash
python "{script_path}" --history-only
```

INSTRUCTIONS:
1. Run the command to get the real-time battle data.
2. Present the factual data accurately (do not modify timestamps or scores).
3. Add a brief, helpful, and lively analysis/commentary at the end (e.g. agent win streaks, medal safety buffer, next match prediction) in a friendly coach style.
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
