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

    home_dir = Path.home()
    openclaw_dir = home_dir / ".openclaw"
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
        cfg["plugins"] = {"entries": {"openclaw-weixin": {"enabled": True}}}
    else:
        cfg["plugins"]["entries"]["openclaw-weixin"] = {"enabled": True}
        
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

    # 移除出厂引导文件
    bootstrap_file = workspace_dir / "BOOTSTRAP.md"
    if bootstrap_file.exists():
        bootstrap_file.unlink()

    # 写入身份设定
    with open(workspace_dir / "IDENTITY.md", "w", encoding="utf-8") as f:
        f.write("# IDENTITY.md - Kaggle Harvester Assistant\n\n- **Name:** Kaggle 战报助手\n- **Creature:** AI 竞赛与天梯对战专属管家\n- **Vibe:** 专业、敏锐、响应迅速、清晰简明\n- **Emoji:** 🏆\n")

    with open(workspace_dir / "SOUL.md", "w", encoding="utf-8") as f:
        f.write("# SOUL.md - Kaggle Harvester 智能体行为守则\n\n你是用户的 Kaggle 竞赛与天梯对战助手，专门为用户监控《The Pokémon Company - PTCG AI Battle》天梯实时对局、积分与奖牌线。\n\n## 核心职责与响应规则\n\n1. 当用户询问战况、分数、排名、对战、宝可梦、对局、胜率、刷新或任何相关问题时：\n   - 优先执行本地对战监控脚本获取实时数据并直接回复给用户。\n2. 保持回答精炼、排版整洁、突出重点数据。\n")

    # 写入技能
    skills_dir = openclaw_dir / "skills" / "kaggle-harvester"
    skills_dir.mkdir(parents=True, exist_ok=True)
    with open(skills_dir / "SKILL.md", "w", encoding="utf-8") as f:
        script_path = (Path(__file__).resolve().parent.parent / "backend" / "harvester" / "wechat_bot.py").resolve()
        f.write(f"---\nname: kaggle-harvester\ndescription: Query real-time Pokemon TCG AI Battle simulation leaderboard, match results, agent scores, ranks, and medal thresholds from Kaggle Harvester.\n---\n\n# Kaggle Harvester WeChat Assistant\n\nWhen the user asks in WeChat about Kaggle, Pokémon TCG, battle status (战况), rankings (排名), scores (分数), or requests a refresh (刷新), execute the Python helper script and return the formatted output:\n\n```powershell\npython \"{script_path}\"\n```\n")

    print(f"OpenClaw 技能与工作区初始化完成！模型: {provider_id}/{model_name}")

if __name__ == "__main__":
    setup_openclaw()
