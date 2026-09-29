from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..models import VersionInfo


@dataclass(frozen=True)
class CurrentScoreCacheHit:
    public_score: Optional[float]
    public_score_display: Optional[str]


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
