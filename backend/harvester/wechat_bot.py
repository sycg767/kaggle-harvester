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

def load_config_value(name):
    value = os.getenv(name, "").strip()
    if value:
        return value
    search_paths = [
        Path("/home/openclaw/.openclaw/kaggle-harvester.env"),
        Path("/home/openclaw/.openclaw/runtime.env"),
        Path(".env.deploy"),
        Path(".env"),
        backend_dir / ".env",
        repo_dir / ".env.deploy",
        Path("/root/kaggle-harvester/.env.deploy"),
        Path("/opt/kaggle-harvester/.env.deploy"),
        Path("/home/openclaw/kaggle-harvester/.env.deploy"),
    ]
    for p in search_paths:
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith(name + "="):
                        return line.split("=", 1)[1].strip().strip("'\"")
        except (IOError, OSError):
            continue
    return ""

CONFIGURED_API_URL = load_config_value("HARVESTER_API_URL")
HARVESTER_API_KEY = load_config_value("HARVESTER_API_KEY")

def _resolve_api_url():
    if CONFIGURED_API_URL:
        return CONFIGURED_API_URL
    app_port = load_config_value("APP_PORT")
    if app_port:
        return f"http://127.0.0.1:{app_port}/api/simulation-monitor"
    # 默认候选端口列表 (按常用优先级)
    candidates = [
        "http://127.0.0.1:8080/api/simulation-monitor",
        "http://127.0.0.1:8000/api/simulation-monitor",
        "http://127.0.0.1:80/api/simulation-monitor",
    ]
    for url in candidates:
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=0.8) as resp:
                if resp.status == 200:
                    return url
        except Exception:
            continue
    return candidates[0]

HARVESTER_API_URL = _resolve_api_url()

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
            # 无时区字符串没有足够信息进行换算，保持上游给出的钟表时间。
            tz_offset = 8
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
    api_error = None
    try:
        headers = {}
        if HARVESTER_API_KEY:
            headers["X-Harvester-Key"] = HARVESTER_API_KEY
        req = urllib.request.Request(HARVESTER_API_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=5.0) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                return format_message(data, history_only=history_only)
    except Exception as exc:
        api_error = exc

    # 2. 若 HTTP 请求未通，直接调用 Python 原生模块解析
    try:
        from harvester.kaggle_client import KaggleClient
        from harvester.simulation_monitor import SimulationMonitorManager
        k = KaggleClient()
        data_dir = repo_dir / "backend" / "data" if (repo_dir / "backend" / "data").exists() else Path("data")
        mgr = SimulationMonitorManager(k, harvest_root=data_dir, default_competition="pokemon-tcg-ai-battle")
        snap = mgr.snapshot()
        return format_message(snap.model_dump(), history_only=history_only)
    except Exception as fallback_error:
        api_detail = str(api_error)[:160] if api_error is not None else "未知错误"
        fallback_detail = str(fallback_error)[:160]
        raise RuntimeError(
            "战报获取失败；API 请求失败: {0}；本地回退失败: {1}".format(
                api_detail,
                fallback_detail,
            )
        )

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


def get_chart_image(output_path=None):
    """生成评分轨迹图并返回保存的图片文件绝对路径。"""
    import tempfile

    if not output_path:
        output_path = Path(tempfile.gettempdir()) / "simulation_trajectory.png"
    else:
        output_path = Path(output_path)

    # 1. 优先尝试直接从运行中的 FastAPI 接口下载已渲染好的 chart.png (毫秒级响应)
    candidate_urls = []
    base_url = HARVESTER_API_URL.rstrip("/")
    if base_url.endswith("/simulation-monitor"):
        candidate_urls.append(base_url + "/chart.png")
    else:
        candidate_urls.append(base_url + "/api/simulation-monitor/chart.png")

    app_port = load_config_value("APP_PORT") or "8000"
    candidate_urls.extend([
        f"http://127.0.0.1:{app_port}/api/simulation-monitor/chart.png",
        "http://127.0.0.1:8000/api/simulation-monitor/chart.png",
        "http://127.0.0.1:8080/api/simulation-monitor/chart.png",
        "http://127.0.0.1:80/api/simulation-monitor/chart.png",
    ])

    seen_urls = set()
    deduped_urls = []
    for u in candidate_urls:
        if u not in seen_urls:
            seen_urls.add(u)
            deduped_urls.append(u)

    for url in deduped_urls:
        try:
            headers = {"User-Agent": "KaggleHarvesterWechatBot/1.0"}
            if HARVESTER_API_KEY:
                headers["X-Harvester-Key"] = HARVESTER_API_KEY
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=4.0) as response:
                if response.status == 200:
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_bytes(response.read())
                    return str(output_path.resolve())
        except Exception:
            continue

    # 2. 回退本地 Python 渲染 (若宿主机环境安装了 matplotlib)
    try:
        from harvester.chart_renderer import render_trajectory_chart
        snap_data = None
        for u in [HARVESTER_API_URL, f"http://127.0.0.1:{app_port}/api/simulation-monitor", "http://127.0.0.1:8000/api/simulation-monitor"]:
            try:
                headers = {}
                if HARVESTER_API_KEY:
                    headers["X-Harvester-Key"] = HARVESTER_API_KEY
                req = urllib.request.Request(u, headers=headers)
                with urllib.request.urlopen(req, timeout=3.0) as resp:
                    if resp.status == 200:
                        snap_data = json.loads(resp.read().decode("utf-8"))
                        break
            except Exception:
                continue

        if not snap_data:
            from harvester.kaggle_client import KaggleClient
            from harvester.simulation_monitor import SimulationMonitorManager
            k = KaggleClient()
            data_dir = repo_dir / "backend" / "data" if (repo_dir / "backend" / "data").exists() else Path("data")
            mgr = SimulationMonitorManager(k, harvest_root=data_dir, default_competition="pokemon-tcg-ai-battle")
            snap_data = mgr.snapshot().model_dump()

        render_trajectory_chart(snap_data, output_path=output_path)
        return str(output_path.resolve())
    except ImportError as ie:
        raise RuntimeError(
            f"走势图获取失败：后端 API 请求未能连接，且宿主机 Python 环境未安装绘图库 ({ie})。请检查 Docker 后端服务状态。"
        )


if __name__ == "__main__":
    args = sys.argv[1:]
    is_chart_only = any(arg in args for arg in ["--chart", "--image", "-c", "--pic", "chart", "image", "pic", "图", "走势", "轨迹", "曲线"])
    is_with_chart = any(arg in args for arg in ["--with-chart", "--with-image"])
    is_history_only = any(arg in args for arg in ["--history-only", "--only-history"])

    try:
        if is_chart_only:
            chart_path = get_chart_image()
            print(f"MEDIA:{chart_path}")
        elif is_with_chart:
            text = get_status_text(history_only=is_history_only)
            chart_path = get_chart_image()
            print(f"{text}\n\nMEDIA:{chart_path}")
        else:
            print(get_status_text(history_only=is_history_only))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
