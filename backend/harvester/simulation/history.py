from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from ..schemas.simulation import SimulationMonitorRunDetail, SimulationMonitorRunLog


class SimulationHistoryReader:
    """Index immutable run headers without loading thousands of episode histories."""

    def __init__(self, root: Path) -> None:
        self._root = root
        self._lock = threading.RLock()
        self._index: dict[str, dict[str, datetime]] | None = None
        self._index_warning: str | None = None
        self._cache: dict[str, tuple[int, int, SimulationMonitorRunDetail]] = {}

    @staticmethod
    def _timestamp(value: str) -> datetime:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed

    @staticmethod
    def _read_header(path: Path) -> SimulationMonitorRunLog:
        # Our run writer places `log` first. Decode only that object, before the
        # potentially large `agents` array; never infer competition from filenames.
        decoder = json.JSONDecoder()
        prefix = ""
        with path.open(encoding="utf-8") as stream:
            for _ in range(64):
                chunk = stream.read(4096)
                prefix += chunk
                match = re.match(r'\s*\{\s*"log"\s*:\s*', prefix)
                if not match:
                    raise ValueError("Run header is missing")
                try:
                    raw, _ = decoder.raw_decode(prefix, match.end())
                except json.JSONDecodeError:
                    if chunk:
                        continue
                    raise
                if not isinstance(raw, dict) or not raw.get("competition"):
                    raise ValueError("Run competition is missing")
                return SimulationMonitorRunLog.model_validate(raw)
        raise ValueError("Run header exceeds the size limit")

    def _add(self, log: SimulationMonitorRunLog) -> None:
        if log.agent_count > 0:
            assert self._index is not None
            self._index.setdefault(log.competition, {})[log.id] = self._timestamp(log.finished_at)

    def remember(self, log: SimulationMonitorRunLog) -> None:
        """Called only after the run detail's atomic write has succeeded."""
        with self._lock:
            if self._index is not None:
                self._add(log)

    def latest(self, competition: str) -> tuple[SimulationMonitorRunDetail | None, str | None]:
        with self._lock:
            if self._index is None:
                self._index = {}
                try:
                    for path in self._root.iterdir():
                        if not re.fullmatch(r"[0-9a-f]{32}\.json", path.name) or path.is_symlink():
                            continue
                        try:
                            log = self._read_header(path)
                            if log.id != path.stem:
                                raise ValueError("Run ID does not match its file")
                            self._add(log)
                        except (OSError, ValueError, TypeError):
                            self._index_warning = "部分历史记录无法读取，正在显示可读取的采集结果。"
                except OSError:
                    self._index = None
                    raise

            warning = self._index_warning
            candidates = sorted(self._index.get(competition, {}).items(), key=lambda item: item[1], reverse=True)
            for log_id, _ in candidates:
                path = self._root / f"{log_id}.json"
                try:
                    if path.is_symlink():
                        raise ValueError("Run file cannot be a symlink")
                    stat = path.stat()
                    cached = self._cache.get(competition)
                    if cached and cached[:2] == (stat.st_mtime_ns, stat.st_size) and cached[2].log.id == log_id:
                        return cached[2].model_copy(deep=True), warning
                    detail = SimulationMonitorRunDetail.model_validate_json(path.read_text(encoding="utf-8"))
                    if detail.log.id != log_id or detail.log.competition != competition or not detail.agents:
                        raise ValueError("Run detail does not match the requested competition")
                    self._cache[competition] = (stat.st_mtime_ns, stat.st_size, detail)
                    return detail.model_copy(deep=True), warning
                except (OSError, ValueError, TypeError):
                    warning = "最近的历史记录无法读取，正在查找更早的可用快照。"
            return None, warning
