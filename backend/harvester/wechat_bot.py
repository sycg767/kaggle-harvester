import sys
import json
import httpx
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def get_status_text() -> str:
    # 尝试从本地运行中的 FastAPI 接口获取
    try:
        r = httpx.get("http://127.0.0.1:8000/api/simulation-monitor", timeout=3.0)
        if r.status_code == 200:
            data = r.json()
            return format_message(data)
    except Exception:
        pass

    # 若本地服务未启动，直接调用 Python 监控管理器快速生成
    try:
        from harvester.kaggle_client import KaggleClient
        from harvester.simulation_monitor import SimulationMonitorManager
        k = KaggleClient()
        mgr = SimulationMonitorManager(k, harvest_root=Path("data"), default_competition="pokemon-tcg-ai-battle")
        snap = mgr.snapshot()
        return format_message(snap.model_dump())
    except Exception as e:
        return f"战报获取失败: {str(e)[:200]}"

def format_message(data: dict) -> str:
    status = data.get("status", {})
    agents = status.get("agents", [])
    thresholds = status.get("thresholds") or status.get("medal_thresholds") or {}
    
    total_teams = thresholds.get("total_teams", 6807)
    gold_score = thresholds.get("gold_cutoff_score", 1131.9)
    silver_score = thresholds.get("silver_cutoff_score", 917.4)
    bronze_score = thresholds.get("bronze_cutoff_score", 839.1)
    gold_rank = thresholds.get("gold_cutoff_rank", 23)
    silver_rank = thresholds.get("silver_cutoff_rank", 340)
    bronze_rank = thresholds.get("bronze_cutoff_rank", 680)

    lines = ["【Pokemon TCG AI 对战实时战报】", ""]

    for idx, a in enumerate(agents):
        sub_id = a.get("submission_id")
        label = "p46" if sub_id == 55565346 else ("p31" if sub_id == 55555162 else f"Agent #{sub_id}")
        score = a.get("score") or a.get("public_score") or 0.0
        rank = a.get("rank") or "—"
        tier = a.get("medal_tier", "none")
        tier_label = "金牌线内" if tier == "gold" else ("银牌线内" if tier == "silver" else ("铜牌线内" if tier == "bronze" else "暂无奖牌"))
        gap = a.get("bronze_gap_score")
        gap_str = f"高于铜牌线 +{gap}分" if (gap is not None and gap >= 0) else (f"距铜牌线还差 {gap}分" if gap is not None else "")
        
        wins = a.get("wins", 0)
        losses = a.get("losses", 0)
        win_rate = a.get("win_rate", 0.0)
        
        eps = a.get("recent_episodes", [])
        last_ep_str = ""
        if eps:
            latest = eps[0]
            opp = latest.get("opponent_team_name") or "对手"
            opp_score = latest.get("opponent_score")
            opp_score_str = f" ({opp_score:.0f}分)" if opp_score else ""
            delta = latest.get("score_delta")
            res = "胜利" if latest.get("result") == "win" else ("战败" if latest.get("result") == "loss" else "平局")
            delta_str = f"{delta:+.1f}分" if delta is not None else ""
            last_ep_str = f"最新战况: vs {opp}{opp_score_str} {res} {delta_str}"

        lines.append(f"Agent {label} (Sub #{sub_id})")
        lines.append(f"• 天梯积分: {score:.1f} 分 (第 {rank} 名 | {tier_label})")
        if gap_str:
            lines.append(f"• 铜牌安全垫: {gap_str}")
        lines.append(f"• 战绩胜率: {win_rate:.1f}% ({wins}胜 / {losses}负)")
        if last_ep_str:
            lines.append(f"• {last_ep_str}")
        lines.append("")

    lines.append(f"奖牌线切分（总参赛队伍: {total_teams} 队）")
    lines.append(f"• 金牌线: {gold_score:.1f} 分 (Top {gold_rank})")
    lines.append(f"• 银牌线: {silver_score:.1f} 分 (Top {silver_rank})")
    lines.append(f"• 铜牌线: {bronze_score:.1f} 分 (Top {bronze_rank})")
    
    return "\n".join(lines)

if __name__ == "__main__":
    print(get_status_text())
