from __future__ import annotations

import json
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .kaggle_client import KaggleClient
from .models import ArchiveEntry, ArchiveResult, ArchiverConfig


class Archiver:
    """Manages local archiving of harvested kernels."""

    def __init__(
        self,
        kaggle_client: KaggleClient,
        config: Optional[ArchiverConfig] = None,
    ) -> None:
        self._kaggle = kaggle_client
        self._config = config or ArchiverConfig()
        self._harvest_root = Path(self._config.harvest_root).resolve()
        self._archive_index_path = self._harvest_root / "_archive_index.json"
        self._archive_index_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._index = self._load_index()

    # ------------------------------------------------------------------
    #  Archive index management
    # ------------------------------------------------------------------

    def _load_index(self) -> dict[str, ArchiveEntry]:
        """Load the archive index from disk."""
        if self._archive_index_path.exists():
            try:
                data = json.loads(
                    self._archive_index_path.read_text(encoding="utf-8")
                )
                return {
                    k: ArchiveEntry(**v) for k, v in data.get("entries", {}).items()
                }
            except (json.JSONDecodeError, KeyError, ValueError):
                pass
        return {}

    def _save_index(self) -> None:
        """Persist the archive index to disk."""
        data = {
            "version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "entries": {
                k: v.model_dump() for k, v in self._index.items()
            },
        }
        temp_path = self._archive_index_path.with_suffix(".tmp")
        temp_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        temp_path.replace(self._archive_index_path)

    def _safe_archive_path(self, value: str | Path) -> Path:
        """确保归档文件操作不会越过配置的归档根目录。"""
        path = Path(value).resolve()
        try:
            path.relative_to(self._harvest_root)
        except ValueError as exc:
            raise ValueError(f"归档路径越界：{path}") from exc
        return path

    @staticmethod
    def _find_source_file(path: Path) -> Optional[Path]:
        for suffix in (".ipynb", ".py", ".R", ".r"):
            match = next(path.glob(f"*{suffix}"), None)
            if match is not None:
                return match
        return None

    @staticmethod
    def _directory_stats(path: Path) -> tuple[int, int]:
        files = [item for item in path.rglob("*") if item.is_file()]
        return len(files), sum(item.stat().st_size for item in files)

    # ------------------------------------------------------------------
    #  Archive operations
    # ------------------------------------------------------------------

    def archive_kernel(
        self,
        kernel_ref: str,
        version: Optional[int] = None,
        score_direction: str = "auto",
        include_outputs: bool = False,
        competition: Optional[str] = None,
        overwrite: bool = False,
    ) -> ArchiveResult:
        """Archive a kernel's best or specified version."""
        ref_parts = kernel_ref.split("/")
        if (
            len(ref_parts) != 2
            or any(part in {"", ".", ".."} for part in ref_parts)
            or any(Path(part).name != part for part in ref_parts)
        ):
            raise ValueError(f"Kernel 标识无效：{kernel_ref}")
        owner, slug = ref_parts

        # Determine target version
        target_version = version
        if target_version is None:
            target_version = self._find_best_version(
                kernel_ref, score_direction
            )

        if target_version is not None:
            known_id = f"{owner}__{slug}__v{target_version}"
            existing = self._index.get(known_id)
            if existing and Path(existing.path).exists() and not overwrite:
                return self._result_from_entry(existing, already_existed=True)

        staging_dir = self._safe_archive_path(
            self._harvest_root / ".staging" / uuid.uuid4().hex
        )
        staging_dir.mkdir(parents=True, exist_ok=False)
        try:
            result = self._kaggle.archive_kernel(
                kernel_ref=kernel_ref,
                output_dir=str(staging_dir),
                version=target_version,
                include_outputs=include_outputs,
            )
            actual_version = int(result.get("selected_version") or target_version or 0)
            if actual_version <= 0:
                raise RuntimeError("Kaggle 未返回有效版本号，归档未登记。")

            archive_id = f"{owner}__{slug}__v{actual_version}"
            with self._lock:
                existing = self._index.get(archive_id)
                if existing and Path(existing.path).exists() and not overwrite:
                    shutil.rmtree(staging_dir)
                    return self._result_from_entry(existing, already_existed=True)

                output_dir = self._safe_archive_path(
                    self._harvest_root / owner / slug / f"v{actual_version}"
                )
                if output_dir.exists():
                    if not overwrite:
                        raise FileExistsError(
                            f"目标目录已存在但未登记：{output_dir}。请先检查文件或选择覆盖。"
                        )
                    shutil.rmtree(output_dir)

                self._save_inputs_metadata(kernel_ref, staging_dir)
                output_dir.parent.mkdir(parents=True, exist_ok=True)
                staging_dir.replace(output_dir)

                source_file = self._find_source_file(output_dir)
                file_count, size_bytes = self._directory_stats(output_dir)
                entry = ArchiveEntry(
                    id=archive_id,
                    ref=kernel_ref,
                    title=result.get("metadata", {}).get("title", slug),
                    author=owner,
                    archived_at=datetime.now(timezone.utc).isoformat(),
                    path=str(output_dir),
                    version_number=actual_version,
                    public_score=None,
                    competition=competition or self._kaggle.competition_slug,
                    source_file=str(source_file) if source_file else None,
                    file_count=file_count,
                    size_bytes=size_bytes,
                    include_outputs=include_outputs,
                )
                self._index[archive_id] = entry
                self._save_index()

            return ArchiveResult(
                owner_slug=owner,
                kernel_slug=slug,
                selected_version=actual_version,
                script_version_id=int(result.get("script_version_id") or 0),
                source_path=str(source_file) if source_file else "",
                metadata=result.get("metadata", {}),
            )
        except Exception:
            if staging_dir.exists():
                shutil.rmtree(staging_dir, ignore_errors=True)
            raise

    def _result_from_entry(
        self, entry: ArchiveEntry, already_existed: bool
    ) -> ArchiveResult:
        archive_path = self._safe_archive_path(entry.path)
        metadata: dict = {}
        metadata_path = archive_path / "kernel-metadata.json"
        if metadata_path.exists():
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        source_file = (
            Path(entry.source_file)
            if entry.source_file and Path(entry.source_file).exists()
            else self._find_source_file(archive_path)
        )
        return ArchiveResult(
            owner_slug=entry.author,
            kernel_slug=entry.ref.split("/", 1)[-1],
            selected_version=entry.version_number,
            script_version_id=int(metadata.get("scriptVersionId") or 0),
            source_path=str(source_file) if source_file else "",
            metadata=metadata,
            public_score=entry.public_score,
            already_existed=already_existed,
        )

    def _find_best_version(
        self, kernel_ref: str, score_direction: str
    ) -> Optional[int]:
        """Find the best-scoring version of a kernel."""
        try:
            versions = self._kaggle.get_kernel_versions(kernel_ref, refresh=True)
        except Exception:
            return None

        available_versions = [v for v in versions.versions if v.version_number > 0]
        scored_versions = [
            v for v in versions.versions if v.public_lb_numeric is not None
        ]
        if not scored_versions:
            return max(
                (v.version_number for v in available_versions),
                default=None,
            )

        if score_direction in {"auto", "minimize"}:
            best = min(scored_versions, key=lambda v: v.public_lb_numeric)  # type: ignore[arg-type]
        else:
            best = max(scored_versions, key=lambda v: v.public_lb_numeric)  # type: ignore[arg-type]

        return best.version_number

    def _save_inputs_metadata(
        self, kernel_ref: str, output_dir: Path
    ) -> None:
        """Save input data sources metadata for a kernel."""
        metadata_path = output_dir / "kernel-metadata.json"
        if not metadata_path.exists():
            return

        try:
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            inputs = {
                "dataset_sources": meta.get(
                    "dataset_sources", meta.get("datasetSources", [])
                ),
                "kernel_sources": meta.get(
                    "kernel_sources", meta.get("kernelSources", [])
                ),
                "competition_sources": meta.get(
                    "competition_sources", meta.get("competitionSources", [])
                ),
            }
            inputs_path = output_dir / "input_sources.json"
            inputs_path.write_text(
                json.dumps(inputs, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass

    # ------------------------------------------------------------------
    #  Query archived kernels
    # ------------------------------------------------------------------

    def list_archives(
        self, competition: Optional[str] = None
    ) -> list[ArchiveEntry]:
        """List all archived kernels, optionally filtered by competition."""
        entries = list(self._index.values())
        if competition:
            entries = [e for e in entries if e.competition == competition]
        entries.sort(key=lambda e: e.archived_at, reverse=True)
        return entries

    def get_archive(self, archive_id: str) -> Optional[ArchiveEntry]:
        """Get a specific archive entry."""
        return self._index.get(archive_id)

    def get_archive_path(self, archive_id: str) -> Path:
        entry = self._index.get(archive_id)
        if entry is None:
            raise KeyError(archive_id)
        return self._safe_archive_path(entry.path)

    def get_archive_source_path(self, archive_id: str) -> Optional[Path]:
        entry = self._index.get(archive_id)
        if entry is None:
            raise KeyError(archive_id)
        archive_path = self._safe_archive_path(entry.path)
        if entry.source_file:
            source_path = self._safe_archive_path(entry.source_file)
            if source_path.exists() and source_path.is_file():
                return source_path
        return self._find_source_file(archive_path)

    def update_public_score(self, archive_id: str, score: Optional[float]) -> None:
        with self._lock:
            entry = self._index.get(archive_id)
            if entry is None or score is None:
                return
            entry.public_score = score
            self._save_index()

    def list_archive_files(self, archive_id: str) -> list[dict]:
        entry = self._index.get(archive_id)
        if entry is None:
            raise KeyError(archive_id)
        archive_path = self.get_archive_path(archive_id)
        if not archive_path.exists():
            raise FileNotFoundError(archive_path)
        return [
            {
                "name": str(path.relative_to(archive_path)).replace("\\", "/"),
                "size_bytes": path.stat().st_size,
                "type": path.suffix.lower().lstrip(".") or "file",
            }
            for path in sorted(archive_path.rglob("*"))
            if path.is_file()
        ]

    def delete_archive(self, archive_id: str) -> bool:
        """Delete an archive entry and its files."""
        entry = self._index.get(archive_id)
        if entry is None:
            return False

        # Remove files
        archive_path = self._safe_archive_path(entry.path)
        if archive_path.exists():
            shutil.rmtree(archive_path)

        # Remove from index
        del self._index[archive_id]
        self._save_index()
        return True

    def get_stats(self) -> dict:
        """Get archive statistics."""
        entries = list(self._index.values())
        comp_count = len(set(e.competition for e in entries if e.competition))
        return {
            "total_archives": len(entries),
            "unique_competitions": comp_count,
            "unique_kernels": len(set(e.ref for e in entries)),
            "harvest_root": self._config.harvest_root,
            "total_size_bytes": sum(e.size_bytes for e in entries),
        }
