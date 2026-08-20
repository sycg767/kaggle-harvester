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

        script_path = (Path(__file__).resolve().parent.parent / "backend" / "harvester" / "wechat_bot.py").resolve()
        if "openclaw" in str(openclaw_dir) or Path("/home/openclaw").exists():
            script_path = Path("/home/openclaw/kaggle-harvester/backend/harvester/wechat_bot.py")

        with open(workspace_dir / "SOUL.md", "w", encoding="utf-8") as f:
            f.write(f"""# SOUL.md - Kaggle Harvester 微信智能管家

你是用户的 Kaggle 竞赛与天梯对战专属微信管家，专门为用户监控《The Pokémon Company - PTCG AI Battle》天梯实时对局、积分与奖牌线。

## 🔴 时间直出铁律（严禁做任何计算或修改）
当你执行脚本后获得诸如：
• 11:10 胜 PNGN
• 11:14 负 sbite0138
• 10:50 负 vvhan
• 10:30 胜 jjamppongmandu

你必须在回复中 100% 原样保留这串文字（包含 11:10, 11:14, 10:50, 10:30）！
- 严禁把 11:10 改写为 19:10！
- 严禁把 11:14 改写为 19:14！
- 严禁把 10:50 改写为 18:50！
- 严禁把 10:30 改写为 18:30！
- 严禁把任何时间额外加 8 小时或减 8 小时！脚本输出的时间已经是最终标准北京时间！
- 必须直接原封不动复制脚本的标准输出（STDOUT）回复给用户，不要重写任何一行！

## 🔴 格式要求
1. **全文严禁出现任何星号 `*` 与代码块**：
   - 手机微信不支持 Markdown 代码块或加粗，任何 `**文字**` 或 ```text``` 都会在手机端变成乱码。
   - 必须直接输出纯文本配合 Emoji。
2. **移动端视觉美化规范**：
   - 仅使用 Emoji（🏆 🎖️ 🥇 🥈 🥉 📊 ✅ ⚠️ 📈 ⚔️ 🎉 🚀）和中文标点（【】、·、|、：）组织视觉层次。

## 核心职责
- 当用户询问“战况、分数、排名、对战、刷新”时：优先执行 `python "{script_path}"` 获取实时战报。
- 当用户询问“对局时间、最近对局、历史对战、流水、时间”时：执行 `python "{script_path}" --history` 获取流水清单。
- 每次获取到脚本输出后，直接如实作为纯文本回复给用户。
""")

        # 写入技能
        skills_dir = openclaw_dir / "skills" / "kaggle-harvester"
        skills_dir.mkdir(parents=True, exist_ok=True)
        with open(skills_dir / "SKILL.md", "w", encoding="utf-8") as f:
            f.write(f"""---
name: kaggle-harvester
description: Query real-time Pokemon TCG AI Battle simulation leaderboard, match results, agent scores, ranks, and medal thresholds from Kaggle Harvester.
---

# Kaggle Harvester WeChat Assistant

1. When the user asks about overall battle status (战况), ranking (排名), scores (分数), or requests a refresh (刷新), execute:
```powershell
python "{script_path}"
```

2. When the user asks for match history (最近对局), match timestamps (对局时间), history (历史), or logs (流水), execute:
```powershell
python "{script_path} --history"
```

CRITICAL FORMATTING INSTRUCTION:
- Directly output the Python script text as-is.
- DO NOT rewrite timestamps! If the script says `11:10` or `10:50`, output `11:10` or `10:50` (NEVER output `19:10` or `18:50`).
- DO NOT wrap output in Markdown code blocks like ```text```. Output clean plain text.
- DO NOT USE ASTERISKS `*` OR DOUBLE ASTERISKS `**` ANYWHERE IN YOUR REPLY.
- Output numbers and scores directly as `857.3 分`, NEVER as `**857.3 分**`.
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
