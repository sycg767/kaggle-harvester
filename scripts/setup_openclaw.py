"""Maintain only Harvester-owned settings; never reset user sessions or memories."""
import json
import hashlib
import os
import re
import shutil
import sys
from pathlib import Path

BEGIN = "<!-- BEGIN KAGGLE-HARVESTER MANAGED -->"
END = "<!-- END KAGGLE-HARVESTER MANAGED -->"


def write_changed(path, text, uid=None, gid=None):
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    backup = path.with_name(path.name + ".pre-managed.bak")
    if path.exists() and not backup.exists():
        shutil.copy2(str(path), str(backup))
        os.chmod(str(backup), 0o600)
    temp = path.with_name(path.name + ".harvester.tmp")
    temp.write_text(text, encoding="utf-8")
    os.chmod(str(temp), 0o600)
    if uid is not None:
        os.chown(str(temp), uid, gid)
    os.replace(str(temp), str(path))
    return True


def read_env(path):
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip("'\"")
    return values


def merge_config(cfg, env):
    if not isinstance(cfg, dict):
        raise ValueError("OpenClaw 配置必须是 JSON 对象；未覆盖原文件")
    key = env.get("OPENCLAW_LLM_API_KEY", "")
    # No configured credential means keep the existing working provider/model.
    if key:
        url = env.get("OPENCLAW_LLM_BASE_URL") or "https://tokenrhythm.studio/v1"
        model = env.get("OPENCLAW_LLM_MODEL") or "deepseek-v4-flash-0731"
        provider_id = "tokenrhythm" if "tokenrhythm" in url else "custom_provider"
        providers = cfg.setdefault("models", {}).setdefault("providers", {})
        provider = providers.setdefault(provider_id, {})
        provider.update({"baseUrl": url, "apiKey": key})
        provider.setdefault("api", "openai-completions")
        models = provider.setdefault("models", [])
        if not any(item.get("id") == model for item in models):
            models.append({"id": model, "name": model, "contextWindow": 128000,
                           "maxTokens": 8192, "input": ["text"], "reasoning": False})
        defaults = cfg.setdefault("agents", {}).setdefault("defaults", {})
        defaults.setdefault("model", {})["primary"] = provider_id + "/" + model
    entries = cfg.setdefault("plugins", {}).setdefault("entries", {})
    entries.setdefault("openclaw-weixin", {}).setdefault("enabled", True)
    cfg.setdefault("gateway", {}).setdefault("mode", "local")
    return cfg


def managed_rules(script):
    return """## 微信战报规则（由 Kaggle Harvester 管理）
微信消息使用纯文本，不支持可靠的 Markdown 渲染。使用【标题】与换行，每行一个重点。
禁止 Markdown 加粗星号、反引号、代码围栏、表格；每行最多两项核心指标，用空行分组。
先说结果或异常，再给关键分数、排名和最近变化，最后才是采集时间与可选操作。
战况、战绩、最新战报：执行 python3 \"%s\"。
排名、分数：执行同一脚本，加 --ranking；奖牌线、距离银牌或金牌：加 --medals。
分析、状态怎么样、点评：加 --analysis，先返回有数据依据的简短点评。
详情、详细战报：加 --details；速览、简报、简短一点：加 --brief。
帮助、你会什么、指令：加 --help-text，不需要查询服务。
默认战报应有分组、近期胜负和有依据的鼓励，而不是只有机械指标。
查询时不发送执行说明、工具摘要、英文命令过程或文件路径，只发送最终脚本结果；失败只用中文简述。
刷新、更新战况：执行 python3 \"%s\" --refresh；只有脚本确认成功才说刷新成功。
最近对局、历史流水：执行 python3 \"%s\" --history-only。
上述查询的脚本输出已经排好版并包含适量点评，必须完整原样转发，不重复追加点评，不自行改写指标或时间。
用户追问脚本未覆盖的问题时，语气可以像并肩参赛的教练：先一句重点，再两条依据；不要堆砌口号。数据不足时直说，缓存数据不能称为实时数据。
严禁编造分数、排名、奖牌线、对局时间或预测下一场开赛时间。脚本失败如实报告。
脚本时间已经是北京时间，禁止再换算时区。
走势图、曲线、战报图：执行 python3 \"%s\" --chart。
图片成功时只返回脚本的 MEDIA:绝对路径 那一行，原样保留前缀，不加其它文字。
不要创建替代查询脚本；不要读取或发送部署配置、凭据或令牌。
""" % (script, script, script, script)


def merge_soul(old, rules):
    section = BEGIN + "\n" + rules + END
    if BEGIN in old:
        if old.count(BEGIN) != 1 or old.count(END) != 1:
            raise ValueError("SOUL.md 管理边界损坏；未覆盖原文件")
        before, rest = old.split(BEGIN, 1)
        _, after = rest.split(END, 1)
        return before + section + after
    # Migrate the exact old generated document only; custom text remains intact.
    normalized = re.sub(r'(?<=")[^"\n]*backend[/\\]harvester[/\\]wechat_bot\.py(?=")', '{SCRIPT}', old)
    if hashlib.sha256(normalized.strip().encode("utf-8")).hexdigest() == "c5dfcfd157fdde75b6f1537d7a2077a8a1862a21b244ac2389a46816a661287e":
        old = "# Kaggle Harvester 微信助手\n"
    return old.rstrip() + "\n\n" + section + "\n"


def setup_openclaw(home=None, repo=None, env=None, uid=None, gid=None):
    env = dict(os.environ) if env is None else env
    if home is None:
        import pwd
        account = pwd.getpwnam(env.get("OPENCLAW_USER", "openclaw"))
        home, uid, gid = Path(account.pw_dir), account.pw_uid, account.pw_gid
    home = Path(home)
    repo = Path(repo or env.get("OPENCLAW_REPO_DIR") or str(home / "kaggle-harvester"))
    env_path = Path(env.get("COMPOSE_ENV_FILE") or ".env.deploy")
    values = read_env(env_path)
    values.update(env)
    root = home / ".openclaw"
    config = root / "openclaw.json"
    # Parse before making any changes. A corrupt file is never replaced with defaults.
    cfg = json.loads(config.read_text(encoding="utf-8")) if config.exists() else {}
    cfg = merge_config(cfg, values)
    format_dir = repo / 'openclaw' / 'harvester-format'
    plugins = cfg.setdefault('plugins', {})
    paths = plugins.setdefault('load', {}).setdefault('paths', [])
    if str(format_dir) not in paths:
        paths.append(str(format_dir))
    plugins.setdefault('entries', {}).setdefault('harvester-wechat-format', {})['enabled'] = True
    if 'allow' in plugins and 'harvester-wechat-format' not in plugins['allow']:
        plugins['allow'].append('harvester-wechat-format')
    workspace = Path(cfg.get("agents", {}).get("defaults", {}).get("workspace") or str(root / "workspace"))
    rules = managed_rules(repo / "backend" / "harvester" / "wechat_bot.py")
    soul = workspace / "SOUL.md"
    old = soul.read_text(encoding="utf-8") if soul.exists() else ""
    soul_text = merge_soul(old, rules)
    changed = False
    paths = []
    source_dir = Path(__file__).resolve().parent.parent / 'openclaw' / 'harvester-format'
    for name in ('package.json', 'openclaw.plugin.json', 'index.mjs'):
        paths.append((format_dir / name, (source_dir / name).read_text(encoding='utf-8')))
    paths.extend([(config, json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"), (soul, soul_text)])
    for base in (root / "skills", workspace / "skills"):
        paths.append((base / "kaggle-harvester" / "SKILL.md",
                      "---\nname: kaggle-harvester\ndescription: Query Kaggle Harvester battle reports, refresh data and render charts.\n---\n\n" + rules))
    for path, text in paths:
        new_dirs = []
        parent = path.parent
        while not parent.exists():
            new_dirs.append(parent)
            parent = parent.parent
        changed = write_changed(path, text, uid, gid) or changed
        if uid is not None:
            for directory in new_dirs:
                os.chown(str(directory), uid, gid)
    print("OPENCLAW_CHANGED=" + ("1" if changed else "0"))
    return changed


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    setup_openclaw()
