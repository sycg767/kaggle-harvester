from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from ..models import (
    AutoArchiveCheckedItem,
    AutoArchiveConfig,
    AutoArchiveItemResult,
    AutoArchiveStatus,
    ScoreDirection,
)

if TYPE_CHECKING:
    from ..archiver import Archiver
    from ..kaggle_client import KaggleClient

SCOREBOARD_PAGE_SIZE = 50


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def run_auto_archive_for_competition(
    kaggle_client: KaggleClient,
    archiver: Archiver,
    config: AutoArchiveConfig,
    competition: str,
    threshold: float,
    processed_runs: dict[str, dict[str, object]],
    page_size: int = SCOREBOARD_PAGE_SIZE,
) -> tuple[
    list[AutoArchiveItemResult],
    list[AutoArchiveCheckedItem],
    str,
    str,
]:
    configured_direction = config.score_direction
    direction_source = "manual"
    if configured_direction == ScoreDirection.AUTO:
        competition_info = kaggle_client.fetch_competition_info(competition)
        if competition_info.score_direction_source == "fallback":
            raise ValueError(
                f"竞赛 {competition} 的分数方向无法可靠识别，请在自动归档中明确选择越低或越高越好。"
            )
        effective_direction = (
            ScoreDirection.MINIMIZE
            if competition_info.is_lower_better
            else ScoreDirection.MAXIMIZE
        )
        direction_source = competition_info.score_direction_source
    else:
        effective_direction = configured_direction

    kernels = kaggle_client.list_kernels(
        sort_by=(
            "scoreAscending"
            if effective_direction == ScoreDirection.MINIMIZE
            else "scoreDescending"
        ),
        page_size=page_size,
        max_pages=1,
        competition=competition,
    )
    scored = kaggle_client.enrich_kernel_summaries(
        kernels,
        competition=competition,
        score_limit=page_size,
    )
    if effective_direction == ScoreDirection.MINIMIZE:
        matched = [
            kernel
            for kernel in scored
            if kernel.public_score is not None
            and kernel.public_score < threshold
        ]
    else:
        matched = [
            kernel
            for kernel in scored
            if kernel.public_score is not None
            and kernel.public_score > threshold
        ]

    results: list[AutoArchiveItemResult] = []
    for kernel in matched:
        score = float(kernel.public_score)
        processed_key = f"{competition}::{kernel.ref}"
        processed = processed_runs.get(processed_key, {})
        processed_version = processed.get("version_number")
        archive_exists = False
        if isinstance(processed_version, int) and "/" in kernel.ref:
            owner, slug = kernel.ref.split("/", 1)
            entry = archiver.get_archive(
                f"{owner}__{slug}__v{processed_version}"
            )
            archive_exists = bool(entry and Path(entry.path).exists())

        if (
            kernel.last_run_time
            and processed.get("last_run_time") == kernel.last_run_time
            and archive_exists
        ):
            results.append(
                AutoArchiveItemResult(
                    competition=competition,
                    ref=kernel.ref,
                    public_score=score,
                    status="skipped",
                    version_number=processed_version
                    if isinstance(processed_version, int)
                    else None,
                )
            )
            continue

        try:
            archived = archiver.archive_kernel(
                kernel_ref=kernel.ref,
                score_direction=effective_direction.value,
                include_outputs=config.include_outputs,
                competition=competition,
            )
            selected_score = score
            try:
                versions = kaggle_client.get_kernel_versions(kernel.ref)
                selected = next(
                    (
                        version
                        for version in versions.versions
                        if version.version_number == archived.selected_version
                    ),
                    None,
                )
                if selected and selected.public_lb_numeric is not None:
                    selected_score = selected.public_lb_numeric
            except Exception:
                pass
            archiver.update_public_score(
                (
                    f"{archived.owner_slug}__{archived.kernel_slug}__"
                    f"v{archived.selected_version}"
                ),
                selected_score,
            )
            if kernel.last_run_time:
                processed_runs[processed_key] = {
                    "last_run_time": kernel.last_run_time,
                    "version_number": archived.selected_version,
                }
            results.append(
                AutoArchiveItemResult(
                    competition=competition,
                    ref=kernel.ref,
                    public_score=score,
                    status=(
                        "skipped" if archived.already_existed else "archived"
                    ),
                    version_number=archived.selected_version,
                )
            )
        except Exception as exc:
            results.append(
                AutoArchiveItemResult(
                    competition=competition,
                    ref=kernel.ref,
                    public_score=score,
                    status="failed",
                    error=str(exc)[:500],
                )
            )

    result_by_ref = {item.ref: item for item in results}
    checked_items: list[AutoArchiveCheckedItem] = []
    for kernel in scored:
        result = result_by_ref.get(kernel.ref)
        checked_items.append(
            AutoArchiveCheckedItem(
                competition=competition,
                ref=kernel.ref,
                title=kernel.title,
                author=kernel.author,
                public_score=kernel.public_score,
                last_run_time=kernel.last_run_time,
                matched=result is not None,
                action=result.status if result is not None else "not_matched",
                version_number=(
                    result.version_number if result is not None else None
                ),
                error=result.error if result is not None else None,
            )
        )
    return (
        results,
        checked_items,
        effective_direction.value,
        direction_source,
    )


def run_auto_archive_sync(
    kaggle_client: KaggleClient,
    archiver: Archiver,
    config: AutoArchiveConfig,
    processed_runs_snapshot: dict[str, dict[str, object]],
    page_size: int = SCOREBOARD_PAGE_SIZE,
    run_for_competition_fn: object | None = None,
) -> tuple[
    AutoArchiveStatus,
    dict[str, dict[str, object]],
    list[AutoArchiveCheckedItem],
]:
    processed_runs = {
        key: dict(value) for key, value in processed_runs_snapshot.items()
    }

    all_results: list[AutoArchiveItemResult] = []
    all_checked: list[AutoArchiveCheckedItem] = []
    competitions_checked: list[str] = []
    errors: list[str] = []
    last_direction: str | None = None
    last_direction_source: str | None = None

    for competition in config.competitions:
        threshold = config.threshold_for(competition)
        if threshold is None:
            errors.append(f"{competition}: 缺少分数阈值")
            continue
        competitions_checked.append(competition)
        try:
            if callable(run_for_competition_fn):
                results, checked, direction, source = run_for_competition_fn(
                    config, competition, threshold, processed_runs
                )
            else:
                results, checked, direction, source = run_auto_archive_for_competition(
                    kaggle_client=kaggle_client,
                    archiver=archiver,
                    config=config,
                    competition=competition,
                    threshold=threshold,
                    processed_runs=processed_runs,
                    page_size=page_size,
                )
        except Exception as exc:
            errors.append(f"{competition}: {str(exc)[:200]}")
            continue
        all_results.extend(results)
        all_checked.extend(checked)
        last_direction = direction
        last_direction_source = source

    failed = [item for item in all_results if item.status == "failed"]
    error_parts = list(errors)
    if failed:
        error_parts.append(f"{len(failed)} 个 Kernel 归档失败，请查看最近结果。")
    status = AutoArchiveStatus(
        last_checked_at=utc_now().isoformat(),
        last_error="；".join(error_parts) if error_parts else None,
        checked_count=len(all_checked),
        matched_count=len(all_results),
        archived_count=sum(item.status == "archived" for item in all_results),
        skipped_count=sum(item.status == "skipped" for item in all_results),
        failed_count=len(failed),
        competitions_checked=competitions_checked,
        effective_score_direction=last_direction,  # type: ignore[arg-type]
        score_direction_source=last_direction_source,
        recent_results=all_results,
    )
    if not all_checked and errors:
        raise RuntimeError(status.last_error or "自动归档检查失败。")
    return status, processed_runs, all_checked
