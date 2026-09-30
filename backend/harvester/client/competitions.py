from __future__ import annotations

import re
import time
from typing import Any, Callable, Optional

from ..schemas import (
    CompetitionInfo,
    CompetitionSubmission,
    EnteredCompetition,
    get_default_competition,
)
from .parser import (
    competition_slug_from_ref,
    infer_score_direction_from_metric,
    is_simulation_competition,
    parse_competition_submission,
    parse_public_score,
)


def normalize_iso_utc(val: Any) -> Optional[str]:
    """确保 Kaggle 截止时间带有明确的 UTC 时区标识，避免前端被当成本地时间解析。"""
    if val in (None, ""):
        return None
    s = str(val).strip()
    if not s:
        return None
    if not re.search(r"([Zz]|[+-]\d{2}:?\d{2})$", s):
        s = f"{s}Z"
    return s


def detect_score_direction_from_leaderboard(competition: str) -> bool | None:
    """根据公开榜单从优到劣的分数顺序判断优化方向。"""
    try:
        from kagglesdk.competitions.services.competition_api_service import (
            CompetitionApiClient,
        )
        from kagglesdk.competitions.types.competition_api_service import (
            ApiGetLeaderboardRequest,
        )
        from kagglesdk.kaggle_http_client import KaggleHttpClient

        request = ApiGetLeaderboardRequest()
        request.competition_name = competition
        request.override_public = True
        request.page_size = 20
        response = CompetitionApiClient(KaggleHttpClient()).get_leaderboard(
            request
        )
        scores = [
            score
            for score in (
                parse_public_score(item.score)
                for item in (response.submissions or [])
            )
            if score is not None
        ]
        if len(scores) < 2:
            return None
        best = scores[0]
        comparison = next(
            (score for score in scores[1:] if abs(score - best) > 1e-12),
            None,
        )
        if comparison is None:
            return None
        return best < comparison
    except Exception:
        return None


def fetch_competition_info_impl(
    run_kaggle_json_fn: Callable[..., Any],
    competition: Optional[str] = None,
    default_competition: Optional[str] = None,
    refresh: bool = False,
    memory_cache: Optional[dict[str, tuple[float, CompetitionInfo]]] = None,
    detect_direction_fn: Optional[Callable[[str], bool | None]] = None,
) -> CompetitionInfo:
    """Fetch competition overview via Kaggle CLI / SDK."""
    comp = competition or default_competition or get_default_competition()
    now = time.monotonic()
    cache = memory_cache if memory_cache is not None else {}
    if not refresh and comp in cache:
        cached_at, cached_info = cache[comp]
        if now - cached_at < 3600.0:
            return cached_info.model_copy(deep=True)
    try:
        result = run_kaggle_json_fn(
            ["competitions", "list", "--search", comp, "--format", "json"]
        )
        data = next(
            (
                item
                for item in result
                if item.get("ref") == comp or item.get("id") == comp
            ),
            result[0] if result else None,
        )
        if data:
            raw_direction = next(
                (
                    data.get(key)
                    for key in (
                        "isLowerBetter",
                        "isLowerIsBetter",
                        "lowerIsBetter",
                    )
                    if data.get(key) is not None
                ),
                None,
            )
            source = "api"
            if isinstance(raw_direction, str):
                lowered = raw_direction.strip().lower()
                raw_direction = (
                    True
                    if lowered in {"true", "1", "yes"}
                    else False
                    if lowered in {"false", "0", "no"}
                    else None
                )
            is_lower_better = (
                raw_direction if isinstance(raw_direction, bool) else None
            )
            if is_lower_better is None:
                detector = detect_direction_fn or detect_score_direction_from_leaderboard
                is_lower_better = detector(comp)
                source = "leaderboard"
            evaluation_metric = (
                data.get("evaluationMetric")
                or data.get("evaluation")
                or data.get("evaluationMetricName")
            )
            if is_lower_better is None:
                is_lower_better = infer_score_direction_from_metric(
                    str(evaluation_metric or "")
                )
                source = "metric"
            if is_lower_better is None:
                is_lower_better = True
                source = "fallback"

            tags_list = [
                t.get("name", "").lower()
                for t in (data.get("tags") or [])
                if isinstance(t, dict) and t.get("name")
            ]
            desc_text = str(data.get("description") or "")
            raw_title_info = str(data.get("title") or comp)
            is_sim = is_simulation_competition(
                comp, tags=tags_list, title=raw_title_info, description=desc_text
            )

            info = CompetitionInfo(
                id=comp,
                title=raw_title_info,
                category=data.get("category", ""),
                deadline=normalize_iso_utc(data.get("deadline")),
                reward=data.get("reward"),
                team_count=data.get("teamCount"),
                kernel_count=data.get("kernelCount"),
                evaluation_metric=evaluation_metric,
                description=desc_text or None,
                is_lower_better=is_lower_better,
                score_direction_source=source,
                is_simulation=is_sim,
                tags=tags_list,
            )
            cache[comp] = (now, info)
            return info.model_copy(deep=True)
    except Exception as exc:
        fallback_comp = default_competition or get_default_competition()
        if competition and competition != fallback_comp:
            raise RuntimeError(f"无法读取竞赛 {comp}：{exc}") from exc

    info = CompetitionInfo(
        id=comp,
        title=comp.replace("-", " ").title() if "-" in comp else comp,
        is_lower_better=True,
        score_direction_source="fallback",
    )
    cache[comp] = (now, info)
    return info.model_copy(deep=True)


def list_entered_competitions_impl(
    run_kaggle_json_fn: Callable[..., Any],
    page_size: int = 100,
) -> list[EnteredCompetition]:
    """列出当前账号已参加的全部竞赛（用于快速切换与主攻选择）。"""
    size = max(1, min(int(page_size), 200))
    rows = run_kaggle_json_fn(
        [
            "competitions",
            "list",
            "--group",
            "entered",
            "--page-size",
            str(size),
            "--format",
            "json",
        ],
        timeout=90,
    )
    tags_by_slug: dict[str, list[str]] = {}
    title_by_slug: dict[str, str] = {}
    desc_by_slug: dict[str, str] = {}
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi

        api = KaggleApi()
        api.authenticate()
        resp = api.competitions_list(group="entered", page_size=size)
        for c in getattr(resp, "competitions", []) or []:
            c_slug = competition_slug_from_ref(
                getattr(c, "ref", None) or getattr(c, "id", None)
            )
            if c_slug:
                tags_by_slug[c_slug] = [
                    t.name.lower()
                    for t in (getattr(c, "tags", []) or [])
                    if getattr(t, "name", None)
                ]
                if getattr(c, "title", None):
                    title_by_slug[c_slug] = str(c.title).strip()
                if getattr(c, "description", None):
                    desc_by_slug[c_slug] = str(c.description).strip()
    except Exception:
        pass

    results: list[EnteredCompetition] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        slug = competition_slug_from_ref(
            row.get("ref") or row.get("id") or row.get("competitionId")
        )
        if not slug or slug in seen:
            continue
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{2,119}", slug):
            continue
        seen.add(slug)
        team_count = row.get("teamCount")
        if team_count is None:
            team_count = row.get("team_count")
        try:
            team_count_int = int(team_count) if team_count is not None else None
        except (TypeError, ValueError):
            team_count_int = None

        raw_title = str(row.get("title") or "").strip()
        if not raw_title and slug in title_by_slug:
            raw_title = title_by_slug[slug]

        tags = tags_by_slug.get(slug, [])
        desc = desc_by_slug.get(slug, "")
        is_sim = is_simulation_competition(
            slug, tags=tags, title=raw_title, description=desc
        )

        results.append(
            EnteredCompetition(
                id=slug,
                title=raw_title or slug,
                category=str(row.get("category") or ""),
                deadline=normalize_iso_utc(row.get("deadline")),
                reward=(
                    str(row.get("reward"))
                    if row.get("reward") not in (None, "")
                    else None
                ),
                team_count=team_count_int,
                is_simulation=is_sim,
                tags=tags,
            )
        )
    return results


def list_competition_submissions_impl(
    run_kaggle_json_fn: Callable[..., Any],
    competition: Optional[str] = None,
    default_competition: Optional[str] = None,
    page_size: int = 10,
) -> list[CompetitionSubmission]:
    """列出当前账号在竞赛中的提交记录（含 Public Score）。"""
    comp = (competition or default_competition or get_default_competition()).strip()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{2,119}", comp):
        raise ValueError(f"竞赛标识无效：{comp}")
    size = max(1, min(int(page_size), 50))
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi

        api = KaggleApi()
        api.authenticate()
        submissions = api.competition_submissions(comp, page_size=size) or []
        rows = [item.to_dict() for item in submissions if item is not None]
    except Exception:
        rows = run_kaggle_json_fn(
            [
                "competitions",
                "submissions",
                comp,
                "--format",
                "json",
                "--page-size",
                str(size),
            ],
            timeout=90,
        )
    results: list[CompetitionSubmission] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        submission = parse_competition_submission(row)
        if submission is not None:
            results.append(submission)
    return results
