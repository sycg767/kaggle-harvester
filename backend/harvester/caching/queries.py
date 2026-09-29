from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..models import CompetitionInfo, EnteredCompetition, ScoredKernel


@dataclass(frozen=True)
class KernelQueryCacheHit:
    data: list[ScoredKernel]
    fetched_at: float
    age_seconds: float


class PersistentKernelQueryCache:
    """永久保存查询快照，仅由显式刷新替换。"""

    SCHEMA_VERSION = 1

    def __init__(self, harvest_root: str | Path) -> None:
        self._root = Path(harvest_root).resolve() / "_cache" / "kernel_queries"
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    @staticmethod
    def _canonical_params(params: dict[str, Any]) -> dict[str, Any]:
        return {key: params[key] for key in sorted(params)}

    def _path(self, params: dict[str, Any]) -> Path:
        encoded = json.dumps(
            self._canonical_params(params),
            ensure_ascii=True,
            separators=(",", ":"),
        ).encode("utf-8")
        digest = hashlib.sha256(encoded).hexdigest()
        return self._root / f"{digest}.json"

    def get(self, params: dict[str, Any]) -> Optional[KernelQueryCacheHit]:
        path = self._path(params)
        if not path.exists():
            return None
        try:
            with self._lock:
                payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("schema_version") != self.SCHEMA_VERSION:
                return None
            if payload.get("params") != self._canonical_params(params):
                return None
            fetched_at = float(payload["fetched_at"])
            return KernelQueryCacheHit(
                data=[ScoredKernel(**item) for item in payload.get("items", [])],
                fetched_at=fetched_at,
                age_seconds=max(time.time() - fetched_at, 0.0),
            )
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None

    def set(self, params: dict[str, Any], data: list[ScoredKernel]) -> None:
        path = self._path(params)
        now = time.time()
        payload = {
            "schema_version": self.SCHEMA_VERSION,
            "fetched_at": now,
            "fetched_at_iso": datetime.now(timezone.utc).isoformat(),
            "params": self._canonical_params(params),
            "items": [item.model_dump(mode="json") for item in data],
        }
        self._atomic_write(path, payload)

    def _atomic_write(self, path: Path, payload: dict[str, Any]) -> None:
        temp_path = path.with_suffix(".tmp")
        with self._lock:
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(path)

    def stats(self) -> dict[str, Any]:
        files = list(self._root.glob("*.json"))
        return {
            "query_snapshots": len(files),
            "query_bytes": sum(path.stat().st_size for path in files),
            "query_root": str(self._root),
        }


class PersistentCompetitionCache:
    """保存竞赛基础信息；默认 1 小时 TTL，过期后重新请求以获取动态参赛人数/截止时间，支持降级回退。"""

    # v2 增加了真实分数方向及其证据来源，旧快照需要重新获取一次。
    SCHEMA_VERSION = 2
    DEFAULT_TTL_SECONDS = 3600.0

    def __init__(
        self,
        harvest_root: str | Path,
        default_ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._root = Path(harvest_root).resolve() / "_cache" / "competitions"
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.default_ttl_seconds = default_ttl_seconds

    def _path(self, competition: str) -> Path:
        digest = hashlib.sha256(competition.encode("utf-8")).hexdigest()
        return self._root / f"{digest}.json"

    def get(
        self,
        competition: str,
        max_age_seconds: Optional[float] = DEFAULT_TTL_SECONDS,
        allow_stale: bool = False,
    ) -> Optional[CompetitionInfo]:
        path = self._path(competition)
        if not path.exists():
            return None
        try:
            with self._lock:
                payload = json.loads(path.read_text(encoding="utf-8"))
            if payload.get("schema_version") != self.SCHEMA_VERSION:
                return None
            if payload.get("competition") != competition:
                return None
            if not allow_stale and max_age_seconds is not None:
                updated_at_str = payload.get("updated_at")
                if not updated_at_str:
                    return None
                try:
                    updated_at = datetime.fromisoformat(updated_at_str)
                    if updated_at.tzinfo is None:
                        updated_at = updated_at.replace(tzinfo=timezone.utc)
                    age = (datetime.now(timezone.utc) - updated_at).total_seconds()
                    if age > max_age_seconds:
                        return None
                except Exception:
                    return None
            return CompetitionInfo(**payload["data"])
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None

    def set(self, competition: str, data: CompetitionInfo) -> None:
        path = self._path(competition)
        payload = {
            "schema_version": self.SCHEMA_VERSION,
            "competition": competition,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "data": data.model_dump(mode="json"),
        }
        temp_path = path.with_suffix(".tmp")
        with self._lock:
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(path)

    def stats(self) -> dict[str, Any]:
        files = list(self._root.glob("*.json"))
        return {
            "competition_snapshots": len(files),
            "competition_bytes": sum(path.stat().st_size for path in files),
        }


class PersistentEnteredCompetitionsCache:
    """已参加竞赛列表缓存；默认 1 小时 TTL，支持过期重新拉取和网络异常降级。"""

    SCHEMA_VERSION = 2
    DEFAULT_TTL_SECONDS = 3600.0

    def __init__(
        self,
        harvest_root: str | Path,
        default_ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._path = (
            Path(harvest_root).resolve() / "_cache" / "entered_competitions.json"
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.default_ttl_seconds = default_ttl_seconds

    def get(
        self,
        max_age_seconds: Optional[float] = DEFAULT_TTL_SECONDS,
        allow_stale: bool = False,
    ) -> Optional[list[EnteredCompetition]]:
        if not self._path.exists():
            return None
        try:
            with self._lock:
                payload = json.loads(self._path.read_text(encoding="utf-8"))
            if payload.get("schema_version") != self.SCHEMA_VERSION:
                return None
            if not allow_stale and max_age_seconds is not None:
                updated_at_str = payload.get("updated_at")
                if not updated_at_str:
                    return None
                try:
                    updated_at = datetime.fromisoformat(updated_at_str)
                    if updated_at.tzinfo is None:
                        updated_at = updated_at.replace(tzinfo=timezone.utc)
                    age = (datetime.now(timezone.utc) - updated_at).total_seconds()
                    if age > max_age_seconds:
                        return None
                except Exception:
                    return None
            items = payload.get("items")
            if not isinstance(items, list):
                return None
            return [EnteredCompetition(**item) for item in items]
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None

    def set(self, items: list[EnteredCompetition]) -> None:
        payload = {
            "schema_version": self.SCHEMA_VERSION,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "items": [item.model_dump(mode="json") for item in items],
        }
        temp_path = self._path.with_suffix(".tmp")
        with self._lock:
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(self._path)

    def stats(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"entered_competitions_cached": 0, "entered_competitions_bytes": 0}
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            count = len(payload.get("items") or [])
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            count = 0
        return {
            "entered_competitions_cached": count,
            "entered_competitions_bytes": self._path.stat().st_size,
        }
