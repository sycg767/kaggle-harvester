import os
import sys
import json
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 确保 backend 目录加入 sys.path，支持离线回退导入
current_file = Path(__file__).resolve()
backend_dir = current_file.parent.parent
repo_dir = backend_dir.parent
for d in [backend_dir, repo_dir, Path("/opt/kaggle-harvester/backend"), Path("/home/openclaw/kaggle-harvester/backend")]:
    if d.exists() and str(d) not in sys.path:
        sys.path.insert(0, str(d))

def load_api_key():
    key = os.getenv("HARVESTER_API_KEY", "").strip()
    if key:
        return key
    search_paths = [
        Path(".env.deploy"),
        Path(".env"),
        backend_dir / ".env",
        repo_dir / ".env.deploy",
        Path("/opt/kaggle-harvester/.env.deploy"),
        Path("/home/openclaw/kaggle-harvester/.env.deploy"),
    ]
    for p in search_paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if line.startswith("HARVESTER_API_KEY="):
                            return line.split("=", 1)[1].strip().strip("'\"")
            except Exception:
                pass
    return ""

HARVESTER_API_URL = os.getenv("HARVESTER_API_URL", "http://127.0.0.1:8000/api/simulation-monitor")
HARVESTER_API_KEY = load_api_key()

def format_beijing_time(raw_time):
    if not raw_time:
        return ""
    try:
        clean = str(raw_time).strip()
        tz_offset = 0
        if "+08:00" in clean or "+0800" in clean:
            tz_offset = 8
        elif "Z" in clean or "+00:00" in clean or "+0000" in clean:
            tz_offset = 0
        else:
            tz_offset = 0
        clean = clean.replace("Z", "").replace("+08:00", "").replace("+0800", "").replace("+00:00", "").replace("+0000", "")
        if "T" in clean:
            date_part, time_part = clean.split("T", 1)
            time_hms = time_part.split(".")[0]
            dt_base = datetime.strptime(f"{date_part} {time_hms}", "%Y-%m-%d %H:%M:%S")
            dt_bj = dt_base + timedelta(hours=(8 - tz_offset))
            return dt_bj.strftime("%H:%M")
        return ""
    except Exception:
        return ""

def get_status_text(history_only=False):
    # 1. 优先尝试从运行中的 FastAPI 接口获取实时快照
    try:
        headers = {}
        if HARVESTER_API_KEY:
            headers["X-Harvester-Key"] = HARVESTER_API_KEY
        req = urllib.request.Request(HARVESTER_API_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=5.0) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                return format_message(data, history_only=history_only)
    except Exception:
        pass

    # 2. 若 HTTP 请求未通，直接调用 Python 原生模块解析
    try:
        from harvester.kaggle_client import KaggleClient
        from harvester.simulation_monitor import SimulationMonitorManager
        k = KaggleClient()
        data_dir = repo_dir / "backend" / "data" if (repo_dir / "backend" / "data").exists() else Path("data")
        mgr = SimulationMonitorManager(k, harvest_root=data_dir, default_competition="pokemon-tcg-ai-battle")
        snap = mgr.snapshot()
        return format_message(snap.model_dump(), history_only=history_only)
    except Exception as e:
        return f"战报获取失败: {str(e)[:200]}"

def format_message(data, history_only=False):
    status = data.get("status", {})
    agents = status.get("agents", [])
    thresholds = status.get("thresholds") or status.get("medal_thresholds") or {}
    
    total_teams = thresholds.get("total_teams", 6807)
    gold_score = thresholds.get("gold_cutoff_score", 1131.9)
    silver_score = thresholds.get("silver_cutoff_score", 917.4)
    bronze_score = thresholds.get("bronze_cutoff_score", 839.1)

    try:
        now_bj = datetime.now(timezone(timedelta(hours=8))).strftime("%H:%M")
    except Exception:
        try:
            now_bj = (datetime.utcnow() + timedelta(hours=8)).strftime("%H:%M")
        except Exception:
            now_bj = datetime.now().strftime("%H:%M")

    if history_only:
        lines = [f"📋 最近对局流水时间一览 (北京时间 {now_bj})", ""]
        for a in agents:
            sub_id = a.get("submission_id")
            label = "p46" if sub_id == 55565346 else ("p31" if sub_id == 55555162 else f"Agent #{sub_id}")
            eps = a.get("recent_episodes", [])[:15]
            lines.append(f"【{label}】最近 {len(eps)} 场对局 (最新在上):")
            for ep in eps:
                opp = ep.get("opponent_team_name") or "对手"
                delta = ep.get("score_delta")
                res = "胜" if ep.get("result") == "win" else ("负" if ep.get("result") == "loss" else "平")
                delta_str = f" {delta:+.1f}分" if delta is not None else ""
                ep_time_raw = ep.get("end_time") or ep.get("create_time")
                ep_time_bj = format_beijing_time(ep_time_raw) or "--:--"
                lines.append(f"• {ep_time_bj} {res} {opp}{delta_str}")
            lines.append("")
        return "\n".join(lines)

    lines = [f"📊 Pokemon TCG AI 实时战报 ({now_bj} 北京时间)", ""]

    for idx, a in enumerate(agents):
        sub_id = a.get("submission_id")
        label = "p46" if sub_id == 55565346 else ("p31" if sub_id == 55555162 else f"Agent #{sub_id}")
        score = a.get("score") or a.get("public_score") or 0.0
        rank = a.get("rank") or "—"
        tier = a.get("medal_tier", "none")
        tier_icon = "🥇" if tier == "gold" else ("🥈" if tier == "silver" else ("🥉" if tier == "bronze" else "⚪"))
        tier_label = "金牌区" if tier == "gold" else ("银牌区" if tier == "silver" else ("铜牌区" if tier == "bronze" else "暂无奖牌"))
        gap = a.get("bronze_gap_score")
        gap_str = f"高于铜牌线 +{gap:.1f}分" if (gap is not None and gap >= 0) else (f"距铜牌线还差 {gap:.1f}分" if gap is not None else "")
        
        wins = a.get("wins", 0)
        losses = a.get("losses", 0)
        win_rate = a.get("win_rate", 0.0)
        
        eps = a.get("recent_episodes", [])

        lines.append(f"【Agent {label}】(Sub #{sub_id})")
        lines.append(f"• 积分: {score:.1f} 分 | 第 {rank} 名 | {tier_icon} {tier_label}")
        if gap_str:
            lines.append(f"• 安全垫: {gap_str}")
        lines.append(f"• 战绩: {win_rate:.1f}% ({wins}胜 / {losses}负)")
        
        if eps:
            lines.append("• 近期对局 (北京时间):")
            for ep in eps[:5]:
                opp = ep.get("opponent_team_name") or "对手"
                opp_score = ep.get("opponent_score")
                opp_score_str = f"({opp_score:.0f}分)" if opp_score else ""
                delta = ep.get("score_delta")
                res = "胜" if ep.get("result") == "win" else ("负" if ep.get("result") == "loss" else "平")
                delta_str = f"{delta:+.1f}分" if delta is not None else ""
                ep_time_raw = ep.get("end_time") or ep.get("create_time")
                ep_time_bj = format_beijing_time(ep_time_raw) or "--:--"
                lines.append(f"  - [{ep_time_bj}] {res} vs {opp} {opp_score_str} {delta_str}".rstrip())

        lines.append("")

    lines.append(f"【奖牌线】(总参赛 {total_teams} 队)")
    lines.append(f"• 金牌: {gold_score:.1f} 分 | 银牌: {silver_score:.1f} 分 | 铜牌: {bronze_score:.1f} 分")
    
    return "\n".join(lines)

if __name__ == "__main__":
    is_history_only = any(arg in sys.argv for arg in ["--history-only", "--only-history"])
    print(get_status_text(history_only=is_history_only))
