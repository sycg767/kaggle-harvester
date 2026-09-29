from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


@dataclass(frozen=True)
class KernelMetadataCacheHit:
    kernel_type: str
    checked_at: float


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
