from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Literal

from ..models import (
    CompetitionSubmission,
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


def classify_submission_state(
    submission: CompetitionSubmission,
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
    if submission.public_score is not None:
        return "scored"
    return "pending"


def run_submission_monitor_sync(
    kaggle_client: KaggleClient,
    config: SubmissionMonitorConfig,
    known_scores_snapshot: dict[str, float | None],
    known_scored_at_snapshot: dict[str, str],
    baselines_snapshot: dict[str, bool],
    matches_prefix_fn: object | None = None,
    submission_state_fn: object | None = None,
) -> tuple[
    SubmissionMonitorStatus,
    dict[str, float | None],
    dict[str, str],
    dict[str, bool],
    list[SubmissionScoreEvent],
]:
    known_scores = dict(known_scores_snapshot)
    known_scored_at = dict(known_scored_at_snapshot)
    baselines = dict(baselines_snapshot)

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

    prefix = (config.description_prefix or "").strip()
    new_events: list[SubmissionScoreEvent] = []
    recent_items: list[SubmissionMonitorItem] = []
    pending_count = 0
    scored_count = 0
    failed_count = 0
    competitions_checked: list[str] = []
    errors: list[str] = []

    for competition in config.competitions:
        competitions_checked.append(competition)
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

        for submission in watched:
            score = submission.public_score
            submission_state = state_classifier(submission)
            key = f"{competition}::{submission.ref}"
            previous = known_scores.get(key, ...)
            newly_scored = False
            scored_at = known_scored_at.get(key)

            if submission_state == "pending":
                pending_count += 1
            elif submission_state == "scored":
                scored_count += 1
            else:
                failed_count += 1

            if seed_baseline:
                known_scores[key] = score
            elif previous is ...:
                if score is not None:
                    newly_scored = True
                known_scores[key] = score
            else:
                prev_score = previous
                if prev_score is None and score is not None:
                    newly_scored = True
                known_scores[key] = score

            if score is not None and not scored_at:
                scored_at = utc_now().isoformat()
                known_scored_at[key] = scored_at

            if newly_scored and score is not None:
                previous_public = (
                    None if previous is ... else previous
                )
                if not isinstance(previous_public, (int, float)):
                    previous_public = None
                event = SubmissionScoreEvent(
                    competition=competition,
                    ref=submission.ref,
                    description=submission.description,
                    public_score=float(score),
                    public_score_display=(
                        submission.public_score_display
                        or f"{float(score):.6g}"
                    ),
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
                )
                comp_new_events.append(event)

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
                    public_score=score,
                    public_score_display=submission.public_score_display,
                    date=submission.date,
                    scored_at=scored_at,
                    state=submission_state,
                    watched=True,
                    newly_scored=newly_scored and not seed_baseline,
                )
            )

        if seed_baseline:
            baselines[competition] = True
        else:
            new_events.extend(comp_new_events)
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
        recent_items=recent_items[:100],
    )
    return status, known_scores, known_scored_at, baselines, new_events
