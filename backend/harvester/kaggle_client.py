from __future__ import annotations

import csv
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from .cache import (
    PersistentKernelMetadataCache,
    PersistentKernelScoreCache,
    PersistentSimulationEpisodeStore,
)
from .models import (
    DEFAULT_FALLBACK_COMPETITION,
    CompetitionInfo,
    CompetitionSubmission,
    EnteredCompetition,
    KernelSummary,
    ScoredKernel,
    SimulationEpisode,
    SimulationEpisodeAgent,
    SimulationMedalThresholds,
    VersionInfo,
    VersionScoreList,
    get_default_competition,
)


from .client import (
    KAGGLE_WEB_BASE,
    LIST_VERSIONS,
    UTF8_WRAPPER_NAME,
    VIEW_MODEL,
    KaggleWebServiceClient,
    archive_kernel_impl,
    competition_slug_from_ref,
    detect_score_direction_from_leaderboard,
    download_simulation_leaderboard_data,
    enrich_kernel_metadata_impl,
    enrich_kernel_summaries_impl,
    extract_current_public_score,
    extract_output_zip,
    extract_public_score,
    fetch_competition_info_impl,
    fetch_kernel_type_sdk,
    get_kernel_runtime_metadata,
    get_versions_via_cli,
    get_versions_via_web_api,
    infer_score_direction_from_metric,
    is_simulation_competition,
    list_competition_submissions_impl,
    list_entered_competitions_impl,
    list_kernels_by_score_sdk,
    list_simulation_episodes_for_submission,
    locate_utf8_wrapper,
    parse_competition_output,
    parse_competition_submission,
    parse_dataset_list_output,
    parse_kernel_list_output,
    parse_public_score,
    row_value,
    run_kaggle,
    run_kaggle_json,
)

# Re-exports for backwards compatibility
_locate_utf8_wrapper = locate_utf8_wrapper
_competition_slug_from_ref = competition_slug_from_ref
_is_simulation_competition = is_simulation_competition
_parse_public_score = parse_public_score
_row_value = row_value
_parse_competition_submission = parse_competition_submission
_extract_public_score = extract_public_score
_extract_current_public_score = extract_current_public_score
_infer_score_direction_from_metric = infer_score_direction_from_metric
_detect_score_direction_from_leaderboard = detect_score_direction_from_leaderboard


class KaggleClient:
    """Wrapper around the Kaggle CLI for kernel research."""

    COMPETITION_SLUG = DEFAULT_FALLBACK_COMPETITION

    def __init__(
        self,
        kaggle_token: Optional[str] = None,
        competition_slug: Optional[str] = None,
        score_cache: Optional[PersistentKernelScoreCache] = None,
        metadata_cache: Optional[PersistentKernelMetadataCache] = None,
        episode_store: Optional[PersistentSimulationEpisodeStore] = None,
    ) -> None:
        self._token = kaggle_token or os.environ.get("KAGGLE_API_TOKEN", "")
        self.competition_slug = (
            competition_slug
            or os.environ.get("KAGGLE_COMPETITION", "").strip()
            or get_default_competition()
        )
        self._score_cache = score_cache
        self._metadata_cache = metadata_cache
        self._episode_store = episode_store
        self._competition_info_memory: dict[str, tuple[float, CompetitionInfo]] = {}
        self._sim_leaderboard_cache: dict[str, tuple[float, SimulationMedalThresholds, list[dict[str, Any]]]] = {}
        self._sim_episodes_cache: dict[tuple[str, int], list[SimulationEpisode]] = {}
        self._utf8_wrapper = _locate_utf8_wrapper(__file__)
        if self._token:
            os.environ["KAGGLE_API_TOKEN"] = self._token

    def readiness(self) -> dict[str, Any]:
        """返回本地运行依赖状态，不触发任何 Kaggle 网络请求。"""
        return {
            "kaggle_cli": shutil.which("kaggle") is not None,
            "token_configured": bool(self._token),
            "utf8_wrapper": str(self._utf8_wrapper),
            "utf8_wrapper_exists": self._utf8_wrapper.exists(),
            "default_competition": self.competition_slug,
        }

    def _fetch_kernel_type_sdk(self, kernel_ref: str) -> str:
        """读取单个 Kernel 的稳定运行类型，不下载源码或输出。"""
        return fetch_kernel_type_sdk(kernel_ref)

    def get_kernel_runtime_metadata(
        self, kernel_ref: str, version_number: int
    ) -> dict[str, Any]:
        """读取指定平台版本的 GPU、Internet 和机器规格。"""
        return get_kernel_runtime_metadata(kernel_ref, version_number)

    def enrich_kernel_metadata(
        self,
        kernels: list[KernelSummary] | list[ScoredKernel],
        retry_seconds: int = 3600,
    ) -> bool:
        """从永久缓存补类型，仅为新出现或退避到期的 Kernel 查询详情。"""
        return enrich_kernel_metadata_impl(
            metadata_cache=self._metadata_cache,
            kernels=kernels,
            retry_seconds=retry_seconds,
            fetch_type_fn=self._fetch_kernel_type_sdk,
        )

    # ------------------------------------------------------------------
    #  Low-level helpers
    # ------------------------------------------------------------------

    def _run_kaggle(
        self, args: list[str], timeout: int = 120
    ) -> tuple[str, str]:
        """Run a kaggle CLI command, return (stdout, stderr)."""
        return run_kaggle(
            args,
            utf8_wrapper=self._utf8_wrapper,
            token=self._token,
            timeout=timeout,
        )

    def _run_kaggle_json(
        self, args: list[str], timeout: int = 120
    ) -> list[dict]:
        """Run a kaggle CLI command and parse JSON output."""
        return run_kaggle_json(
            args,
            utf8_wrapper=self._utf8_wrapper,
            token=self._token,
            timeout=timeout,
        )

    # ------------------------------------------------------------------
    #  Competition info
    # ------------------------------------------------------------------

    def list_entered_competitions(
        self, page_size: int = 100
    ) -> list[EnteredCompetition]:
        """列出当前账号已参加的竞赛（Kaggle group=entered）。"""
        return list_entered_competitions_impl(
            run_kaggle_json_fn=self._run_kaggle_json,
            page_size=page_size,
        )

    def fetch_competition_info(
        self, competition: Optional[str] = None, refresh: bool = False
    ) -> CompetitionInfo:
        """Fetch competition overview via Kaggle CLI."""
        return fetch_competition_info_impl(
            run_kaggle_json_fn=self._run_kaggle_json,
            competition=competition,
            default_competition=self.competition_slug,
            refresh=refresh,
            memory_cache=self._competition_info_memory,
            detect_direction_fn=self._detect_score_direction_from_leaderboard,
        )

    def _detect_score_direction_from_leaderboard(
        self, competition: str
    ) -> bool | None:
        """根据公开榜单从优到劣的分数顺序判断优化方向。"""
        return detect_score_direction_from_leaderboard(competition)

    def _parse_competition_output(self, text: str) -> CompetitionInfo:
        """Parse the verbose competition list output."""
        return parse_competition_output(text, self.COMPETITION_SLUG)

    # ------------------------------------------------------------------
    #  Kernel listing
    # ------------------------------------------------------------------

    def list_kernels(
        self,
        sort_by: str = "voteCount",
        page_size: int = 100,
        max_pages: int = 10,
        competition: Optional[str] = None,
    ) -> list[KernelSummary]:
        """列出竞赛 Kernel；分数排序使用 Kaggle SDK，其他排序使用 CLI。"""
        comp = competition or self.competition_slug
        if sort_by in {"scoreAscending", "scoreDescending"}:
            return self._list_kernels_by_score_sdk(
                competition=comp,
                descending=sort_by == "scoreDescending",
                page_size=page_size,
                max_pages=max_pages,
            )

        all_kernels: list[KernelSummary] = []
        seen_refs: set[str] = set()
        page = 1

        while page <= max_pages:
            args = [
                "kernels", "list",
                "--competition", comp,
                "--sort-by", sort_by,
                "--page-size", str(page_size),
                "--page", str(page),
                "--format", "json",
            ]
            try:
                data = self._run_kaggle_json(args)
            except Exception:
                if page == 1:
                    raise
                break

            if not data:
                break
            for entry in data:
                ref = entry.get("ref", "")
                if not ref or ref in seen_refs:
                    continue
                seen_refs.add(ref)
                all_kernels.append(
                    KernelSummary(
                        ref=ref,
                        title=entry.get("title", ""),
                        author=entry.get("author", ""),
                        last_run_time=entry.get("lastRunTime"),
                        total_votes=entry.get("totalVotes", 0),
                        vote_count=entry.get("totalVotes", 0),
                        kernel_type=entry.get("kernelType", ""),
                        category=entry.get("category", ""),
                        competition=comp,
                        is_competition_kernel=True,
                    )
                )
            if len(data) < page_size:
                break
            page += 1

        return all_kernels

    def _list_kernels_by_score_sdk(
        self,
        competition: str,
        descending: bool,
        page_size: int,
        max_pages: int,
    ) -> list[KernelSummary]:
        """通过 Kaggle SDK 的公开分数顺序读取精确竞赛 Kernel。"""
        return list_kernels_by_score_sdk(
            competition=competition,
            descending=descending,
            page_size=page_size,
            max_pages=max_pages,
        )

    def _parse_kernel_list_output(
        self, text: str, competition: str
    ) -> list[KernelSummary]:
        """Parse tabular output from `kaggle kernels list -v`."""
        return parse_kernel_list_output(text, competition)

    # ------------------------------------------------------------------
    #  Kernel scores
    # ------------------------------------------------------------------

    def fetch_top_kernel_scores(
        self, sort_descending: bool = True
    ) -> list[ScoredKernel]:
        """Fetch top kernel scores using the fetch_top_kernel_scores.py logic."""
        # First get the kernel list
        kernels = self.list_kernels(
            sort_by="voteCount", page_size=100, max_pages=10
        )
        refs = [k.ref for k in kernels if k.ref]

        # Enrich with scores
        return self.enrich_scores(refs)

    def enrich_scores(
        self, kernel_refs: list[str], competition: Optional[str] = None
    ) -> list[ScoredKernel]:
        """Enrich a list of kernel refs with public LB scores.
        
        Note: Kaggle API does not expose per-kernel public scores via standard
        CLI endpoints. The scores column in the Kaggle UI comes from internal APIs.
        This method returns kernels without scores by default; scores can be
        fetched individually via the versions endpoint.
        """
        comp = competition or self.competition_slug
        return [
            ScoredKernel(
                ref=ref,
                title=ref,
                author=ref.split("/")[0] if "/" in ref else "",
                competition=comp,
                is_competition_kernel=True,
            )
            for ref in kernel_refs
        ]

    def enrich_kernel_summaries(
        self,
        summaries: list[KernelSummary],
        competition: Optional[str] = None,
        score_limit: Optional[int] = None,
        force_refresh: bool = False,
    ) -> list[ScoredKernel]:
        """为列表补充 Kernel 的最佳公开分数。

        force_refresh=True 时忽略按 last_run_time 命中的当前分数缓存，
        重新请求 Kaggle Web 接口。这样“刷新分数榜”才能拿到重算后的新分。
        返回值对齐 Kaggle 列表 Score（Best Score），不是详情页当前版本 Public Score。
        """
        ws_cls = globals().get("KaggleWebServiceClient", KaggleWebServiceClient)
        return enrich_kernel_summaries_impl(
            token=self._token,
            score_cache=self._score_cache,
            summaries=summaries,
            competition=competition or self.competition_slug,
            score_limit=score_limit,
            force_refresh=force_refresh,
            web_service_cls=ws_cls,
        )

    def get_kernel_versions(
        self, kernel_ref: str, refresh: bool = False
    ) -> VersionScoreList:
        """读取完整版本历史；已出分版本复用缓存，缺分版本重新请求。

        不能只靠本地 versions 缓存短路：历史上可能只缓存了部分版本，
        或把“完成但当时未读到分”的版本永久记成 null。
        """
        cached_versions = (
            self._score_cache.get_versions(kernel_ref)
            if self._score_cache is not None
            else []
        )
        try:
            result = self._get_versions_via_web_api(
                kernel_ref,
                cached_versions={
                    item.version_number: item
                    for item in cached_versions
                    if item.public_lb_numeric is not None
                },
            )
            if self._score_cache is not None:
                result.versions = self._score_cache.merge_versions(
                    kernel_ref, result.versions
                )
            return result
        except Exception:
            if cached_versions:
                owner, slug = kernel_ref.split("/", 1)
                return VersionScoreList(
                    owner_slug=owner,
                    kernel_slug=slug,
                    versions=cached_versions,
                )
            return self._get_versions_via_cli(kernel_ref)

    def _get_versions_via_web_api(
        self,
        kernel_ref: str,
        cached_versions: Optional[dict[int, VersionInfo]] = None,
    ) -> VersionScoreList:
        """通过 Kaggle 内部接口读取完整版本历史与公开分数。"""
        ws_cls = globals().get("KaggleWebServiceClient", KaggleWebServiceClient)
        return get_versions_via_web_api(
            token=self._token,
            kernel_ref=kernel_ref,
            cached_versions=cached_versions,
            web_service_cls=ws_cls,
        )

    def _get_versions_via_cli(self, kernel_ref: str) -> VersionScoreList:
        """Fallback: parse version info from kernel metadata."""
        return get_versions_via_cli(self._run_kaggle, kernel_ref)

    # ------------------------------------------------------------------
    #  Kernel archiving
    # ------------------------------------------------------------------

    def archive_kernel(
        self,
        kernel_ref: str,
        output_dir: str,
        version: Optional[int] = None,
        include_outputs: bool = False,
    ) -> dict:
        """通过 Kaggle 内部只读接口把指定版本保存到本地。"""
        ws_cls = globals().get("KaggleWebServiceClient", KaggleWebServiceClient)
        return archive_kernel_impl(
            token=self._token,
            kernel_ref=kernel_ref,
            output_dir=output_dir,
            version=version,
            include_outputs=include_outputs,
            web_service_cls=ws_cls,
            runtime_metadata_fn=self.get_kernel_runtime_metadata,
            extract_output_fn=self._extract_output_zip,
        )

    @staticmethod
    def _extract_output_zip(archive_bytes: bytes, output_path: Path) -> None:
        """安全解压 Kaggle 输出压缩包，禁止成员路径越出 outputs 目录。"""
        extract_output_zip(archive_bytes, output_path)

    # ------------------------------------------------------------------
    #  Competition data info
    # ------------------------------------------------------------------

    def list_competition_submissions(
        self,
        competition: Optional[str] = None,
        page_size: int = 10,
    ) -> list[CompetitionSubmission]:
        """列出当前账号在竞赛中的提交记录（含 Public Score）。"""
        return list_competition_submissions_impl(
            run_kaggle_json_fn=self._run_kaggle_json,
            competition=competition,
            default_competition=self.competition_slug,
            page_size=page_size,
        )

    def list_datasets(self, competition: Optional[str] = None) -> list[dict]:
        """List competition datasets."""
        comp = competition or self.competition_slug
        stdout, _ = self._run_kaggle(
            ["competitions", "data", "list", comp]
        )
        return self._parse_dataset_list_output(stdout)

    def _parse_dataset_list_output(self, text: str) -> list[dict]:
        """Parse tabular dataset listing."""
        return parse_dataset_list_output(text)

    def download_dataset(
        self,
        output_dir: str,
        competition: Optional[str] = None,
        file_name: Optional[str] = None,
        force: bool = False,
    ) -> Path:
        """Download competition data."""
        comp = competition or self.competition_slug
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        args = [
            "competitions",
            "data",
            "download",
            comp,
            "-p",
            str(output_path),
        ]
        if file_name:
            args.extend(["-f", file_name])
        if force:
            args.append("--force")

        self._run_kaggle(args, timeout=600)
        return output_path

    # ------------------------------------------------------------------
    #  Simulation (Agent Battles & Leaderboard)
    # ------------------------------------------------------------------

    def list_simulation_episodes(
        self,
        submission_id: int,
        competition: str = "pokemon-tcg-ai-battle",
    ) -> list[SimulationEpisode]:
        """获取指定提交的完整对局历史（含当时真实天梯分、加减变动、对手及 Replay 链接）。"""
        sub_id = int(submission_id)
        cache_key = (competition.strip(), sub_id)
        episodes = list_simulation_episodes_for_submission(
            sub_id,
            token=self._token,
            competition=competition,
        )

        if self._episode_store is not None and episodes:
            self._episode_store.upsert_episodes(episodes, competition=competition)
            merged = self._episode_store.get_episodes(sub_id, competition=competition, order="DESC")
            self._sim_episodes_cache[cache_key] = merged
            return merged

        if episodes:
            known_map = {ep.id: ep for ep in self._sim_episodes_cache.get(cache_key, [])}
            for ep in episodes:
                known_map[ep.id] = ep
            merged = sorted(known_map.values(), key=lambda x: x.create_time or "", reverse=True)
            self._sim_episodes_cache[cache_key] = merged
            return merged

        if self._episode_store is not None:
            return self._episode_store.get_episodes(sub_id, competition=competition, order="DESC")
        return list(self._sim_episodes_cache.get(cache_key, []))

    def get_simulation_episodes_cached(
        self, submission_id: int, competition: str = "pokemon-tcg-ai-battle"
    ) -> list[SimulationEpisode]:
        """返回指定提交已缓存的全部对局流水（按最新在前排序，不触发网络拉取）。"""
        sub_id = int(submission_id)
        cache_key = (competition.strip(), sub_id)
        if self._episode_store is not None:
            return self._episode_store.get_episodes(sub_id, competition=competition, order="DESC")
        return list(self._sim_episodes_cache.get(cache_key, []))

    def get_simulation_leaderboard(
        self,
        competition: str = "pokemon-tcg-ai-battle",
        bronze_percentile: float = 0.10,
        force_refresh: bool = False,
        cache_ttl_seconds: int = 300,
    ) -> tuple[SimulationMedalThresholds, list[dict[str, Any]]]:
        """下载天梯全量榜单并计算奖牌线切分点（带 5 分钟 TTL 缓存，避免每次轮询重复解压 6000+ 队伍全量榜单）。"""
        comp = competition.strip()
        now = time.time()
        if not force_refresh and comp in self._sim_leaderboard_cache:
            cached_time, cached_th, cached_rows = self._sim_leaderboard_cache[comp]
            if now - cached_time < cache_ttl_seconds:
                return cached_th, cached_rows

        try:
            thresholds, rows = download_simulation_leaderboard_data(
                competition=comp,
                bronze_percentile=bronze_percentile,
            )
            self._sim_leaderboard_cache[comp] = (now, thresholds, rows)
            return thresholds, rows
        except Exception:
            if comp in self._sim_leaderboard_cache:
                _, cached_th, cached_rows = self._sim_leaderboard_cache[comp]
                return cached_th, cached_rows
            raise
