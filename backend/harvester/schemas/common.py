from __future__ import annotations

import re
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class SortBy(str, Enum):
    """Sort options for kernel listing."""
    SCORE_ASCENDING = "scoreAscending"
    SCORE_DESCENDING = "scoreDescending"
    HOTNESS = "hotness"
    DATE_CREATED = "dateCreated"
    DATE_RUN = "dateRun"
    VOTE_COUNT = "voteCount"


class ScoreDirection(str, Enum):
    """Direction for best-score selection."""
    AUTO = "auto"
    MINIMIZE = "minimize"
    MAXIMIZE = "maximize"


COMPETITION_SLUG_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9-]{2,119}$"


def _normalize_competition_slugs(values: list[Any]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in values:
        slug = str(raw or "").strip()
        if not slug or slug in seen:
            continue
        if not re.fullmatch(COMPETITION_SLUG_PATTERN, slug):
            raise ValueError(f"竞赛标识无效：{slug}")
        seen.add(slug)
        cleaned.append(slug)
    return cleaned


class SetActiveCompetitionRequest(BaseModel):
    """设置全站默认主攻竞赛请求。"""

    competition: Optional[str] = Field(default=None, max_length=120)


class ActiveCompetitionInfo(BaseModel):
    """当前主攻竞赛信息。"""

    competition: str
    source: str  # 'pinned', 'auto', 'env', 'fallback'
    is_pinned: bool = False
    pinned_competition: Optional[str] = None
