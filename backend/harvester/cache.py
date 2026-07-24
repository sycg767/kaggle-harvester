from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .models import CompetitionInfo, ScoredKernel, VersionInfo


@dataclass(frozen=True)
class KernelQueryCacheHit:
    data: list[ScoredKernel]
    fetched_at: float
    age_seconds: float


@dataclass(frozen=True)
class CurrentScoreCacheHit:
    public_score: Optional[float]
    public_score_display: Optional[str]


@dataclass(frozen=True)
class KernelMetadataCacheHit:
    kernel_type: str
    checked_at: float


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
    """永久保存竞赛基础信息，仅由显式刷新替换。"""

    # v2 增加了真实分数方向及其证据来源，旧快照需要重新获取一次。
    SCHEMA_VERSION = 2

    def __init__(self, harvest_root: str | Path) -> None:
        self._root = Path(harvest_root).resolve() / "_cache" / "competitions"
        self._root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, competition: str) -> Path:
        digest = hashlib.sha256(competition.encode("utf-8")).hexdigest()
        return self._root / f"{digest}.json"

    def get(self, competition: str) -> Optional[CompetitionInfo]:
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


class PersistentKernelMetadataCache:
    """永久保存 Kernel 类型；失败项按检查时间退避，避免重复请求。"""

    SCHEMA_VERSION = 1

    def __init__(self, harvest_root: str | Path) -> None:
        self._path = (
            Path(harvest_root).resolve() / "_cache" / "kernel_metadata.json"
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"schema_version": self.SCHEMA_VERSION, "kernels": {}}
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            if payload.get("schema_version") != self.SCHEMA_VERSION:
                raise ValueError("缓存 schema 不匹配")
            if not isinstance(payload.get("kernels"), dict):
                raise ValueError("缓存 kernels 字段无效")
            return payload
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return {"schema_version": self.SCHEMA_VERSION, "kernels": {}}

    def _save(self) -> None:
        temp_path = self._path.with_suffix(".tmp")
        self._data["updated_at"] = datetime.now(timezone.utc).isoformat()
        temp_path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp_path.replace(self._path)

    def get_many(self, kernel_refs: list[str]) -> dict[str, KernelMetadataCacheHit]:
        with self._lock:
            stored = self._data.get("kernels", {})
            result: dict[str, KernelMetadataCacheHit] = {}
            for ref in kernel_refs:
                entry = stored.get(ref)
                if not isinstance(entry, dict):
                    continue
                result[ref] = KernelMetadataCacheHit(
                    kernel_type=str(entry.get("kernel_type") or ""),
                    checked_at=float(entry.get("checked_at") or 0.0),
                )
            return result

    def merge_checked(self, results: dict[str, Optional[str]]) -> None:
        if not results:
            return
        now = time.time()
        changed = False
        with self._lock:
            stored = self._data.setdefault("kernels", {})
            for ref, kernel_type in results.items():
                normalized = (kernel_type or "").strip().lower()
                existing = stored.get(ref)
                if (
                    normalized
                    and isinstance(existing, dict)
                    and existing.get("kernel_type") == normalized
                ):
                    continue
                next_entry = {
                    "kernel_type": normalized,
                    "checked_at": now,
                }
                if existing != next_entry:
                    stored[ref] = next_entry
                    changed = True
            if changed:
                self._save()

    def stats(self) -> dict[str, Any]:
        with self._lock:
            kernels = self._data.get("kernels", {})
            known = sum(
                1 for entry in kernels.values()
                if isinstance(entry, dict) and entry.get("kernel_type")
            )
        return {
            "metadata_kernels": len(kernels),
            "known_kernel_types": known,
            "metadata_bytes": self._path.stat().st_size if self._path.exists() else 0,
            "metadata_path": str(self._path),
        }


class PersistentKernelScoreCache:
    """按 Kernel 当前运行标识和不可变版本号保存分数。"""

    SCHEMA_VERSION = 1
    NEGATIVE_SCORE_TTL_SECONDS = 300

    def __init__(self, harvest_root: str | Path) -> None:
        self._path = (
            Path(harvest_root).resolve() / "_cache" / "kernel_scores.json"
        )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        if not self._path.exists():
            return {"schema_version": self.SCHEMA_VERSION, "kernels": {}}
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            if payload.get("schema_version") != self.SCHEMA_VERSION:
                raise ValueError("缓存 schema 不匹配")
            if not isinstance(payload.get("kernels"), dict):
                raise ValueError("缓存 kernels 字段无效")
            return payload
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return {"schema_version": self.SCHEMA_VERSION, "kernels": {}}

    def _save(self) -> None:
        temp_path = self._path.with_suffix(".tmp")
        self._data["updated_at"] = datetime.now(timezone.utc).isoformat()
        temp_path.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temp_path.replace(self._path)

    def get_current(
        self, kernel_ref: str, last_run_time: Optional[str]
    ) -> Optional[CurrentScoreCacheHit]:
        with self._lock:
            current = (
                self._data.get("kernels", {})
                .get(kernel_ref, {})
                .get("current")
            )
            if not current or current.get("last_run_time") != last_run_time:
                return None
            # 旧版本缓存没有记录当前版本与分数来源版本，首次升级时强制刷新。
            if (
                "score_version_number" not in current
                or "current_version_number" not in current
            ):
                return None
            # 列表分数是 Best Score，允许 score_version != current_version。
            # 仅无分，或未解析到版本号时，才按 TTL 重新检查。
            score_pending = (
                current.get("public_score") is None
                or current.get("score_version_number") is None
                or current.get("current_version_number") is None
            )
            if score_pending:
                try:
                    checked_at = datetime.fromisoformat(
                        str(current.get("checked_at") or "")
                    )
                    if checked_at.tzinfo is None:
                        checked_at = checked_at.replace(tzinfo=timezone.utc)
                    age_seconds = (
                        datetime.now(timezone.utc) - checked_at
                    ).total_seconds()
                except (TypeError, ValueError):
                    return None
                if age_seconds >= self.NEGATIVE_SCORE_TTL_SECONDS:
                    return None
            return CurrentScoreCacheHit(
                public_score=current.get("public_score"),
                public_score_display=current.get("public_score_display"),
            )

    def set_current(
        self,
        kernel_ref: str,
        last_run_time: Optional[str],
        public_score: Optional[float],
        public_score_display: Optional[str],
        score_version_number: Optional[int] = None,
        current_version_number: Optional[int] = None,
    ) -> None:
        with self._lock:
            kernel = self._data.setdefault("kernels", {}).setdefault(
                kernel_ref, {"versions": {}}
            )
            kernel["current"] = {
                "last_run_time": last_run_time,
                "public_score": public_score,
                "public_score_display": public_score_display,
                "score_version_number": score_version_number,
                "current_version_number": current_version_number,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            }
            self._save()

    def get_versions(self, kernel_ref: str) -> list[VersionInfo]:
        with self._lock:
            raw = (
                self._data.get("kernels", {})
                .get(kernel_ref, {})
                .get("versions", {})
            )
            versions = []
            for item in raw.values():
                if not isinstance(item, dict):
                    continue
                # 历史脏数据：complete 但无分，不再当作可靠缓存返回。
                if (
                    str(item.get("status") or "").lower() == "complete"
                    and item.get("public_lb_numeric") is None
                ):
                    continue
                versions.append(VersionInfo(**item))
        versions.sort(key=lambda item: item.version_number, reverse=True)
        return versions

    def merge_versions(
        self, kernel_ref: str, versions: list[VersionInfo]
    ) -> list[VersionInfo]:
        with self._lock:
            kernel = self._data.setdefault("kernels", {}).setdefault(
                kernel_ref, {"versions": {}}
            )
            stored = kernel.setdefault("versions", {})
            changed = False
            # 清理历史写入的“完成但无分”脏缓存。
            for key, existing in list(stored.items()):
                if (
                    isinstance(existing, dict)
                    and str(existing.get("status") or "").lower() == "complete"
                    and existing.get("public_lb_numeric") is None
                ):
                    del stored[key]
                    changed = True
            transient: list[VersionInfo] = []
            for version in versions:
                if version.status.lower() != "complete":
                    transient.append(version)
                    continue
                key = str(version.version_number)
                existing = stored.get(key)
                # 只永久保存已出分的完成版本；无分数项可能只是暂时读失败，
                # 不能写进缓存后短路后续补分。
                if version.public_lb_numeric is None:
                    if existing is not None and existing.get("public_lb_numeric") is not None:
                        # 保留已有分数，避免被空结果覆盖。
                        continue
                    transient.append(version)
                    continue
                if existing is None:
                    stored[key] = version.model_dump(mode="json")
                    changed = True
                elif (
                    existing.get("public_lb_numeric") is None
                    and version.public_lb_numeric is not None
                ):
                    stored[key] = version.model_dump(mode="json")
                    changed = True
                # 已有公开分的版本视为不可变，避免后续空读或错误分覆盖。
            if changed:
                self._save()
            merged = [VersionInfo(**item) for item in stored.values()]
            merged.extend(transient)
        merged.sort(key=lambda item: item.version_number, reverse=True)
        return merged

    def stats(self) -> dict[str, Any]:
        with self._lock:
            kernels = self._data.get("kernels", {})
            version_count = sum(
                len(entry.get("versions", {})) for entry in kernels.values()
            )
            current_count = sum(
                1 for entry in kernels.values() if entry.get("current") is not None
            )
        return {
            "score_kernels": len(kernels),
            "current_scores": current_count,
            "immutable_versions": version_count,
            "score_bytes": self._path.stat().st_size if self._path.exists() else 0,
            "score_path": str(self._path),
        }
