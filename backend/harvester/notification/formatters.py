from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from ..models import AutoArchiveCheckedItem, AutoArchiveRunLog

BEIJING_TIMEZONE = timezone(timedelta(hours=8), name="北京时间")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_beijing_time(value: str) -> str:
    """把内部保存的 ISO 时间转换为通知中使用的北京时间。"""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(BEIJING_TIMEZONE).strftime(
            "%Y-%m-%d %H:%M:%S（北京时间）"
        )
    except (TypeError, ValueError):
        return value


def format_run_message(
    log: AutoArchiveRunLog,
    items: list[AutoArchiveCheckedItem],
    competition: str,
) -> tuple[str, str]:
    title = (
        "Kaggle Harvester：自动归档有失败"
        if log.failed_count > 0 or log.outcome == "failed"
        else "Kaggle Harvester：发现并归档新 Kernel"
    )
    lines = [
        f"竞赛：{competition}",
        f"完成时间：{format_beijing_time(log.finished_at)}",
        (
            "结果："
            f"检查 {log.checked_count}，命中 {log.matched_count}，"
            f"新增 {log.archived_count}，跳过 {log.skipped_count}，"
            f"失败 {log.failed_count}"
        ),
    ]
    archived = [item for item in items if item.action == "archived"][:10]
    failed = [item for item in items if item.action == "failed"][:10]
    if archived:
        lines.append("归档明细：")
        lines.extend(
            f"- {item.ref} · {item.public_score:.4f}"
            + (f" · v{item.version_number}" if item.version_number else "")
            for item in archived
            if item.public_score is not None
        )
    if failed:
        lines.append("失败明细：")
        lines.extend(
            f"- {item.ref} · {(item.error or '未知错误')[:200]}"
            for item in failed
        )
    if log.error:
        lines.append(f"运行错误：{log.error[:500]}")
    return title, "\n".join(lines)


def format_submission_score_message(
    item: dict[str, Any],
    competition: str,
    finished: str,
) -> tuple[str, str, str]:
    ref = str(item.get("ref") or "").strip()
    score = item.get("public_score")
    score_display = str(
        item.get("public_score_display")
        or (f"{score:.6g}" if isinstance(score, (int, float)) else "")
    )
    description = str(item.get("description") or "").strip() or "（无描述）"
    title = f"Kaggle Harvester：提交已出分 {score_display}"
    lines = [
        f"竞赛：{competition}",
        f"提交 ref：{ref}",
        f"Public LB：{score_display}",
        f"描述：{description}",
        f"完成时间：{format_beijing_time(finished)}",
    ]
    if item.get("status"):
        lines.insert(3, f"状态：{item['status']}")
    if item.get("date"):
        lines.append(f"提交时间：{format_beijing_time(str(item['date']))}")
    return ref, title, "\n".join(lines)


def format_simulation_event_message(
    item: dict[str, Any],
    competition: str,
    finished: str,
) -> tuple[str, str, str] | None:
    sub_id = str(item.get("submission_id") or "").strip()
    ev_type = item.get("type")
    score = item.get("public_score")
    score_str = f"{score:.1f}" if isinstance(score, (int, float)) else "—"
    rank = item.get("rank")
    rank_str = f"第 {rank} 名" if rank is not None else "未上榜"
    gap = item.get("bronze_gap_score")
    gap_str = (
        f"+{gap:.1f}（安全垫）"
        if isinstance(gap, (int, float)) and gap >= 0
        else f"{gap:.1f}（距铜牌）"
        if isinstance(gap, (int, float))
        else "—"
    )

    agent_alias = (
        item.get("alias")
        or (
            "p46"
            if str(sub_id).endswith("55565346") or str(sub_id) == "55565346"
            else (
                "p31"
                if str(sub_id).endswith("55555162") or str(sub_id) == "55555162"
                else (f"p{str(sub_id)[-2:]}" if len(str(sub_id)) >= 2 else f"#{sub_id}")
            )
        )
    )

    if ev_type == "new_episodes":
        new_matches = item.get("new_matches", 1)
        total = item.get("total_matches", 0)
        win_rate = item.get("win_rate", 0)
        wins = item.get("wins", 0)
        losses = item.get("losses", 0)
        opp_name = item.get("opponent_name")
        opp_score = item.get("opponent_score")
        opp_str = f"vs {opp_name}" if opp_name else ""
        if opp_score is not None:
            opp_str += f" ({opp_score:.0f}分)"
        res_code = item.get("result")
        res_str = (
            "胜利"
            if res_code == "win"
            else ("战败" if res_code == "loss" else ("平局" if res_code == "tie" else ""))
        )
        delta = item.get("score_delta")
        delta_str = f"{delta:+.1f}分" if delta is not None else ""

        match_summary = f"{opp_str} {res_str} {delta_str}".strip()

        title = f"🏆 Kaggle Harvester：Agent {agent_alias} 完成 {new_matches} 场新对战"
        lines = [
            f"竞赛：{competition}",
            f"代理：Agent {agent_alias} (Sub #{sub_id})",
        ]
        if match_summary:
            lines.append(f"最新对局：{match_summary}")
        lines.extend([
            f"当前天梯：{score_str}（{rank_str}）",
            f"铜牌分差：{gap_str}",
            f"战绩统计：{wins} 胜 / {losses} 负（胜率 {win_rate:.1f}%，累计 {total} 场）",
            f"结算时间：{format_beijing_time(finished)}",
        ])
        event_id = f"sim_episodes::{competition}::{sub_id}::{total}::{finished}"
        return event_id, title, "\n".join(lines)
    elif ev_type == "medal_change":
        cur_medal = str(item.get("current_medal") or "")
        prev_medal = str(item.get("previous_medal") or "")
        medal_labels = {
            "gold": "🥇金牌区",
            "silver": "🥈银牌区",
            "bronze": "🥉铜牌区",
            "none": "未入围",
        }
        cur_label = medal_labels.get(cur_medal, cur_medal)
        prev_label = medal_labels.get(prev_medal, prev_medal)
        title = f"🎖️ Kaggle Harvester：Agent {agent_alias} 奖牌线变动 [{prev_label} ➔ {cur_label}]"
        lines = [
            f"竞赛：{competition}",
            f"代理：Agent {agent_alias} (Sub #{sub_id})",
            f"奖牌状态：从 {prev_label} 变为 {cur_label}",
            f"当前天梯：{score_str}（{rank_str}）",
            f"铜牌分差：{gap_str}",
            f"结算时间：{format_beijing_time(finished)}",
        ]
        event_id = f"sim_medal::{competition}::{sub_id}::{cur_medal}::{finished}"
        return event_id, title, "\n".join(lines)
    return None
