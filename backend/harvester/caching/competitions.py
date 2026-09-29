from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..models import EnteredCompetition, get_default_competition
from .queries import PersistentEnteredCompetitionsCache


class PersistentActiveCompetitionStore:
    """全站默认/主攻竞赛持久化存储。"""

    SCHEMA_VERSION = 1

    def __init__(self, harvest_root: str | Path) -> None:
        self._path = Path(harvest_root).resolve() / "active_competition.json"
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def get(self) -> Optional[str]:
        if not self._path.exists():
            return None
        try:
            with self._lock:
                payload = json.loads(self._path.read_text(encoding="utf-8"))
            slug = payload.get("competition")
            if isinstance(slug, str) and slug.strip():
                return slug.strip()
            return None
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return None

    def set(self, slug: str) -> None:
        cleaned = slug.strip()
        payload = {
            "schema_version": self.SCHEMA_VERSION,
            "competition": cleaned,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        temp_path = self._path.with_suffix(".tmp")
        with self._lock:
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(self._path)

    def clear(self) -> None:
        with self._lock:
            if self._path.exists():
                try:
                    self._path.unlink(missing_ok=True)
                except OSError:
                    pass

    def stats(self) -> dict[str, Any]:
        pinned = self.get()
        return {
            "active_competition_pinned": pinned is not None,
            "pinned_competition": pinned,
        }


def resolve_active_competition(
    store: Optional[PersistentActiveCompetitionStore],
    entered_cache: Optional[PersistentEnteredCompetitionsCache] = None,
    env_default: Optional[str] = None,
) -> tuple[str, str]:
    """解析当前主攻/默认竞赛标识与来源。

    优先级：
    1. pinned: 用户在界面显式设定的全站主攻赛事（持久化在 active_competition.json）
    2. auto: 自动识别已参赛列表中正在进行（未截止）的常规赛，优先选取距离截止最近的活跃竞赛
    3. auto: 若无活跃常规赛，选取正在进行的模拟赛
    4. auto: 若所有参赛竞赛均已完赛，选取最近完赛的竞赛
    5. env: 环境变量 KAGGLE_COMPETITION（若配置）
    6. fallback: 兜底预设
    """
    if store is not None:
        pinned = store.get()
        if pinned:
            return pinned, "pinned"

    if entered_cache is not None:
        items = entered_cache.get(allow_stale=True) or []
        if items:
            now = datetime.now(timezone.utc)

            def _parse_deadline(item: EnteredCompetition) -> Optional[datetime]:
                if not item.deadline:
                    return None
                try:
                    raw = item.deadline.replace("Z", "+00:00")
                    dt = datetime.fromisoformat(raw)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt
                except Exception:
                    return None

            ongoing_regular: list[tuple[datetime, EnteredCompetition]] = []
            ongoing_simulation: list[tuple[datetime, EnteredCompetition]] = []
            for item in items:
                dl = _parse_deadline(item)
                if dl is None or dl > now:
                    sort_key = dl or datetime.max.replace(tzinfo=timezone.utc)
                    if not item.is_simulation:
                        ongoing_regular.append((sort_key, item))
                    else:
                        ongoing_simulation.append((sort_key, item))

            if ongoing_regular:
                ongoing_regular.sort(key=lambda x: x[0])
                return ongoing_regular[0][1].id, "auto"

            if ongoing_simulation:
                ongoing_simulation.sort(key=lambda x: x[0])
                return ongoing_simulation[0][1].id, "auto"

            ended_items: list[tuple[datetime, EnteredCompetition]] = []
            for item in items:
                dl = _parse_deadline(item)
                if dl is not None:
                    ended_items.append((dl, item))
            if ended_items:
                ended_items.sort(key=lambda x: x[0], reverse=True)
                return ended_items[0][1].id, "auto"

    if env_default and env_default.strip():
        return env_default.strip(), "env"

    return get_default_competition(), "fallback"
