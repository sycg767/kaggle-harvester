from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

from ..models import (
    CompetitionSubmission,
    SubmissionFailureEvent,
    SubmissionMonitorConfig,
    SubmissionMonitorItem,
    SubmissionMonitorStatus,
    SubmissionScoreEvent,
)

if TYPE_CHECKING:
    from ..kaggle_client import KaggleClient


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def matches_description_prefix(
    submission: CompetitionSubmission, prefix: str
) -> bool:
    if not prefix:
        return True
    return (submission.description or "").startswith(prefix)


def resolve_submission_score(
    submission: CompetitionSubmission,
    score_source: str = "auto",
    is_ended: bool = False,
) -> tuple[float | None, str | None, Literal["public", "private"]]:
    """计算当前提交用于跟踪的有效分数、格式化展示和类型。

    策略规则：
    1. 'private': 强制使用 private_score（无 private_score 时回退 public_score）
    2. 'public': 强制使用 public_score（无 public_score 时回退 private_score）
    3. 'auto'（默认）：
       - 若比赛已完赛 (is_ended=True) 且存在 private_score，优先使用 private_score
       - 若 public_score 为 0.0 (或 None) 且存在 private_score，优先使用 private_score
       - 否则优先使用 public_score
    """
    mode = (score_source or "auto").strip().lower()

    if mode == "private":
        if submission.private_score is not None:
            return (
                submission.private_score,
                submission.private_score_display or f"{submission.private_score:.4f}",
                "private",
            )
        if submission.public_score is not None:
            return (
                submission.public_score,
                submission.public_score_display or f"{submission.public_score:.4f}",
                "public",
            )
        return (None, None, "private")

    if mode == "public":
        if submission.public_score is not None:
            return (
                submission.public_score,
                submission.public_score_display or f"{submission.public_score:.4f}",
                "public",
            )
        if submission.private_score is not None:
            return (
                submission.private_score,
                submission.private_score_display or f"{submission.private_score:.4f}",
                "private",
            )
        return (None, None, "public")

    # mode == "auto"
    has_private = submission.private_score is not None
    has_public = submission.public_score is not None

    if has_private and (is_ended or submission.public_score == 0.0 or not has_public):
        return (
            submission.private_score,
            submission.private_score_display or f"{submission.private_score:.4f}",
            "private",
        )

    if has_public:
        return (
            submission.public_score,
            submission.public_score_display or f"{submission.public_score:.4f}",
            "public",
        )

    if has_private:
        return (
            submission.private_score,
            submission.private_score_display or f"{submission.private_score:.4f}",
            "private",
        )

    return (None, None, "public")


def classify_submission_state(
    submission: CompetitionSubmission,
    effective_score: float | None = None,
) -> Literal["pending", "scored", "failed"]:
    """依据 Kaggle 提交状态分类，避免把失败提交误报为待出分。"""
    normalized = (submission.status or "").strip().lower()
    if normalized in {
        "error",
        "failed",
        "failure",
        "cancelled",
        "canceled",
        "invalid",
    }:
        return "failed"
    if submission.error_description.strip():
        return "failed"
    score_to_check = (
        effective_score
        if effective_score is not None
        else (
            submission.public_score
            if submission.public_score is not None
            else submission.private_score
        )
    )
    if score_to_check is not None:
        return "scored"
    return "pending"


def check_competition_ended_sync(kaggle_client: Any, competition: str) -> bool:
    """检查比赛是否已完赛截止。"""
    try:
        fetch_fn = getattr(kaggle_client, "fetch_competition_info", None)
        if callable(fetch_fn):
            info = fetch_fn(competition)
            if info and getattr(info, "deadline", None):
                norm = str(info.deadline).strip()
                if not norm.endswith("Z") and not ("+" in norm or "-" in norm[-6:]):
                    norm += "Z"
                dt = datetime.fromisoformat(norm)
                return dt < datetime.now(timezone.utc)
    except Exception:
        pass
    return False


def run_submission_monitor_sync(
    kaggle_client: KaggleClient,
    config: SubmissionMonitorConfig,
    known_scores_snapshot: dict[str, float | None],
    known_scored_at_snapshot: dict[str, str],
    baselines_snapshot: dict[str, bool],
    known_statuses_snapshot: dict[str, str] | None = None,
    matches_prefix_fn: object | None = None,
    submission_state_fn: object | None = None,
    is_ended_fn: object | None = None,
) -> tuple[
    SubmissionMonitorStatus,
    dict[str, float | None],
    dict[str, str],
    dict[str, bool],
    dict[str, str],
    list[SubmissionScoreEvent],
    list[SubmissionFailureEvent],
]:
    known_scores = dict(known_scores_snapshot)
    known_scored_at = dict(known_scored_at_snapshot)
    baselines = dict(baselines_snapshot)
    known_statuses = dict(known_statuses_snapshot or {})

    prefix_checker = (
        matches_prefix_fn
        if callable(matches_prefix_fn)
        else matches_description_prefix
    )
    state_classifier = (
        submission_state_fn
        if callable(submission_state_fn)
        else classify_submission_state
    )
    ended_checker = (
        is_ended_fn
        if callable(is_ended_fn)
        else check_competition_ended_sync
    )

    prefix = (config.description_prefix or "").strip()
    score_source = getattr(config, "score_source", "auto")
    new_events: list[SubmissionScoreEvent] = []
    new_failure_events: list[SubmissionFailureEvent] = []
    recent_items: list[SubmissionMonitorItem] = []
    pending_count = 0
    scored_count = 0
    failed_count = 0
    competitions_checked: list[str] = []
    errors: list[str] = []

    for competition in config.competitions:
        competitions_checked.append(competition)
        is_ended = ended_checker(kaggle_client, competition)

        try:
            submissions = kaggle_client.list_competition_submissions(
                competition=competition,
                page_size=config.page_size,
            )
        except Exception as exc:
            errors.append(f"{competition}: {str(exc)[:200]}")
            continue

        watched = [
            item for item in submissions if prefix_checker(item, prefix)
        ]
        seed_baseline = not baselines.get(competition, False)
        comp_new_events: list[SubmissionScoreEvent] = []
        comp_new_failure_events: list[SubmissionFailureEvent] = []

        for submission in watched:
            score, score_display, score_type = resolve_submission_score(
                submission,
                score_source=score_source,
                is_ended=is_ended,
            )
            try:
                submission_state = state_classifier(submission, effective_score=score)
            except TypeError:
                submission_state = state_classifier(submission)
            key = f"{competition}::{submission.ref}"
            previous_score = known_scores.get(key, ...)
            previous_status = known_statuses.get(key)
            newly_scored = False
            newly_failed = False
            scored_at = known_scored_at.get(key)

            if submission_state == "pending":
                pending_count += 1
            elif submission_state == "scored":
                scored_count += 1
            else:
                failed_count += 1

            if seed_baseline:
                known_scores[key] = score
                known_statuses[key] = submission_state
            else:
                if submission_state == "failed":
                    if previous_status != "failed":
                        newly_failed = True
                    known_statuses[key] = "failed"
                elif submission_state == "scored":
                    if previous_score is ...:
                        if score is not None:
                            newly_scored = True
                        known_scores[key] = score
                    else:
                        if previous_score is None and score is not None:
                            newly_scored = True
                        known_scores[key] = score
                    known_statuses[key] = "scored"
                else:
                    known_statuses[key] = "pending"

            if score is not None and not scored_at:
                scored_at = utc_now().isoformat()
                known_scored_at[key] = scored_at

            if newly_scored and score is not None:
                previous_public = (
                    None if previous_score is ... else previous_score
                )
                if not isinstance(previous_public, (int, float)):
                    previous_public = None

                display_text = score_display or f"{float(score):.6g}"
                if score_type == "private" and not display_text.endswith("(Private)"):
                    display_text = f"{display_text} (Private)"

                event = SubmissionScoreEvent(
                    competition=competition,
                    ref=submission.ref,
                    description=submission.description,
                    public_score=float(score),
                    public_score_display=display_text,
                    status=submission.status,
                    date=submission.date,
                    scored_at=scored_at,
                    submitted_by=submission.submitted_by,
                    submitted_by_ref=submission.submitted_by_ref,
                    team_name=submission.team_name,
                    previous_public_score=(
                        float(previous_public)
                        if previous_public is not None
                        else None
                    ),
                    score_type=score_type,
                    private_score=submission.private_score,
                    private_score_display=submission.private_score_display,
                )
                comp_new_events.append(event)

            if newly_failed:
                fail_event = SubmissionFailureEvent(
                    competition=competition,
                    ref=submission.ref,
                    description=submission.description,
                    status=submission.status or "FAILED",
                    error_description=submission.error_description,
                    date=submission.date,
                    failed_at=utc_now().isoformat(),
                    submitted_by=submission.submitted_by,
                    submitted_by_ref=submission.submitted_by_ref,
                    team_name=submission.team_name,
                )
                comp_new_failure_events.append(fail_event)

            recent_items.append(
                SubmissionMonitorItem(
                    competition=competition,
                    ref=submission.ref,
                    description=submission.description,
                    status=submission.status,
                    error_description=submission.error_description,
                    submitted_by=submission.submitted_by,
                    submitted_by_ref=submission.submitted_by_ref,
                    team_name=submission.team_name,
                    public_score=submission.public_score,
                    public_score_display=submission.public_score_display,
                    private_score=submission.private_score,
                    private_score_display=submission.private_score_display,
                    score_type=score_type,
                    date=submission.date,
                    scored_at=scored_at,
                    state=submission_state,
                    watched=True,
                    newly_scored=newly_scored and not seed_baseline,
                    newly_failed=newly_failed and not seed_baseline,
                )
            )

        if seed_baseline:
            baselines[competition] = True
        else:
            new_events.extend(comp_new_events)
            new_failure_events.extend(comp_new_failure_events)
            baselines[competition] = True

    if not competitions_checked and errors:
        raise RuntimeError("；".join(errors))

    status = SubmissionMonitorStatus(
        last_checked_at=utc_now().isoformat(),
        last_error="；".join(errors) if errors else None,
        checked_count=len(recent_items),
        pending_count=pending_count,
        scored_count=scored_count,
        failed_count=failed_count,
        newly_scored_count=len(new_events),
        competitions_checked=competitions_checked,
        recent_events=new_events,
        recent_failure_events=new_failure_events,
        recent_items=recent_items[:100],
    )
    return (
        status,
        known_scores,
        known_scored_at,
        baselines,
        known_statuses,
        new_events,
        new_failure_events,
    )
