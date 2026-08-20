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
        if "plugins" not in cfg:
            cfg["plugins"] = {"entries": {}}
        if "entries" not in cfg["plugins"]:
            cfg["plugins"]["entries"] = {}

        cfg["plugins"]["entries"]["openclaw-weixin"] = {
            "enabled": True
        }

        if "skills" not in cfg:
            cfg["skills"] = {"entries": {}}
        if "entries" not in cfg["skills"]:
            cfg["skills"]["entries"] = {}
        cfg["skills"]["entries"]["kaggle-harvester"] = {
            "enabled": True
        }

        if "tools" not in cfg:
            cfg["tools"] = {}
        cfg["tools"]["profile"] = "coding"
        cfg["tools"]["alsoAllow"] = [
            "group:messaging",
            "group:terminal",
            "group:fs",
            "bash",
            "process",
            "kaggle-harvester"
        ]
            
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
            f.write(f"""# SOUL.md - Kaggle Harvester 微信智能管家

你是用户的 Kaggle 竞赛与天梯对战专属微信管家，专门为用户监控《The Pokémon Company - PTCG AI Battle》天梯实时对局、积分与奖牌线。

## 🔴 核心职责（必须执行工具）
当用户询问任何关于：
- 战况、战绩、分数、排名、奖牌线、刷新
- 对局、对局时间、最近对局、历史、流水
等任何对战相关问题时，**你必须无条件执行 kaggle-harvester 工具**：
`python "{script_path}"`

## 🔴 回复规则（严格直出）
1. 执行脚本后，**直接将脚本的输出文本原样发送给用户**。
2. 严禁改动任何时间数字！脚本输出的 `[11:15]` 就是北京时间，绝不可改写为 19:15！
3. 全文严禁使用任何星号 `*`，严禁包裹在代码块 ````text```` 中。
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

When the user asks ANYTHING about Pokemon TCG / Kaggle, including battle status (战况), ranking (排名), scores (分数), match history (最近对局), match timestamps (对局时间/时间), logs (流水), or requests a refresh (刷新), ALWAYS execute:

```powershell
python "{script_path}"
```

CRITICAL FORMATTING INSTRUCTION:
- Directly output the Python script text as-is.
- DO NOT rewrite timestamps!
- DO NOT wrap output in Markdown code blocks like ```text```. Output clean plain text.
- DO NOT USE ASTERISKS `*` OR DOUBLE ASTERISKS `**` ANYWHERE IN YOUR REPLY.
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
