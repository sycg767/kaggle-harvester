from __future__ import annotations

import json
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Optional

from ..cache import PersistentKernelScoreCache
from ..models import (
    KernelSummary,
    ScoredKernel,
    VersionInfo,
    VersionScoreList,
)
from .parser import extract_current_public_score, parse_public_score
from .web import KaggleWebServiceClient, LIST_VERSIONS, VIEW_MODEL


def list_kernels_by_score_sdk(
    competition: str,
    descending: bool,
    page_size: int,
    max_pages: int,
) -> list[KernelSummary]:
    """通过 Kaggle SDK 的公开分数顺序读取精确竞赛 Kernel。"""
    from kagglesdk.kaggle_http_client import KaggleHttpClient
    from kagglesdk.kernels.services.kernels_api_service import (
        KernelsApiClient,
    )
    from kagglesdk.kernels.types.kernels_api_service import (
        ApiListKernelsRequest,
        KernelsListSortType,
    )

    client = KernelsApiClient(KaggleHttpClient())
    sdk_sort = (
        KernelsListSortType.SCORE_DESCENDING
        if descending
        else KernelsListSortType.SCORE_ASCENDING
    )
    requested_page_size = min(max(page_size, 1), 100)
    results: list[KernelSummary] = []
    seen_refs: set[str] = set()
    page_token = ""

    for page in range(1, max_pages + 1):
        request = ApiListKernelsRequest()
        request.competition = competition
        request.sort_by = sdk_sort
        request.page_size = requested_page_size
        request.page = page
        if page_token:
            request.page_token = page_token

        response = client.list_kernels(request)
        rows = response.kernels or []
        added = 0
        for row in rows:
            data = row.to_dict()
            ref = data.get("ref", "")
            if not ref or ref in seen_refs:
                continue
            seen_refs.add(ref)
            added += 1
            results.append(
                KernelSummary(
                    ref=ref,
                    title=data.get("title", ""),
                    author=data.get("author", ""),
                    last_run_time=data.get("lastRunTime"),
                    total_votes=data.get("totalVotes", 0) or 0,
                    vote_count=data.get("totalVotes", 0) or 0,
                    kernel_type=data.get("kernelType", ""),
                    category=data.get("category", ""),
                    competition=competition,
                    is_competition_kernel=True,
                )
            )

        page_token = response.next_page_token or ""
        if not rows or not added or (
            not page_token and len(rows) < requested_page_size
        ):
            break

    return results


def enrich_kernel_summaries_impl(
    token: str,
    score_cache: Optional[PersistentKernelScoreCache],
    summaries: list[KernelSummary],
    competition: str,
    score_limit: Optional[int] = None,
    force_refresh: bool = False,
    web_service_cls: Any = KaggleWebServiceClient,
) -> list[ScoredKernel]:
    """为列表补充 Kernel 的最佳公开分数。"""
    base = {
        s.ref: ScoredKernel(
            ref=s.ref,
            title=s.title,
            author=s.author,
            vote_count=s.total_votes,
            total_votes=s.total_votes,
            kernel_type=s.kernel_type,
            category=s.category,
            last_run_time=s.last_run_time,
            competition=competition,
            is_competition_kernel=s.is_competition_kernel,
        )
        for s in summaries
    }

    summary_by_ref = {summary.ref: summary for summary in summaries}
    refs_to_enrich = list(base)
    if score_limit is not None:
        refs_to_enrich = refs_to_enrich[: max(score_limit, 0)]

    refs_to_fetch: list[str] = []
    for ref in refs_to_enrich:
        summary = summary_by_ref[ref]
        if force_refresh:
            refs_to_fetch.append(ref)
            continue
        cached = (
            score_cache.get_current(ref, summary.last_run_time)
            if score_cache is not None
            else None
        )
        if cached is None:
            refs_to_fetch.append(ref)
            continue
        base[ref].public_score = cached.public_score
        base[ref].public_score_display = cached.public_score_display

    refs_to_enrich = refs_to_fetch
    if not token or not refs_to_enrich:
        return list(base.values())

    ws: KaggleWebServiceClient | None = None
    try:
        ws = web_service_cls(token)

        def fetch_current_score(
            ref: str,
        ) -> tuple[
            str,
            Optional[float],
            bool,
            Optional[int],
            Optional[int],
        ]:
            if "/" not in ref:
                return ref, None, False, None, None
            owner, slug = ref.split("/", 1)
            try:
                view = ws.post(VIEW_MODEL, {
                    "authorUserName": owner,
                    "kernelSlug": slug,
                    "tab": "output",
                })
                score, score_version, current_version = (
                    extract_current_public_score(view)
                )
                return ref, score, True, score_version, current_version
            except Exception:
                return ref, None, False, None, None

        worker_count = min(4, len(refs_to_enrich))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(fetch_current_score, ref): ref
                for ref in refs_to_enrich
            }
            for future in as_completed(futures):
                (
                    ref,
                    current_score,
                    fetch_succeeded,
                    score_version,
                    current_version,
                ) = future.result()
                if current_score is not None:
                    base[ref].public_score = current_score
                    base[ref].public_score_display = f"{current_score:.4f}"
                if score_cache is not None and fetch_succeeded:
                    summary = summary_by_ref[ref]
                    score_cache.set_current(
                        ref,
                        summary.last_run_time,
                        current_score,
                        (
                            f"{current_score:.4f}"
                            if current_score is not None
                            else None
                        ),
                        score_version_number=score_version,
                        current_version_number=current_version,
                    )
    except Exception:
        pass
    finally:
        if ws is not None:
            ws.close()

    return list(base.values())


def get_versions_via_web_api(
    token: str,
    kernel_ref: str,
    cached_versions: Optional[dict[int, VersionInfo]] = None,
    web_service_cls: Any = KaggleWebServiceClient,
) -> VersionScoreList:
    """通过 Kaggle 内部接口读取完整版本历史与公开分数。"""
    ref_parts = kernel_ref.split("/")
    if len(ref_parts) != 2:
        raise ValueError(f"Invalid kernel ref: {kernel_ref}")
    owner, slug = ref_parts
    if not token:
        raise RuntimeError("KAGGLE_API_TOKEN 未配置，无法读取版本分数。")

    ws = web_service_cls(token)
    try:
        view = ws.post(VIEW_MODEL, {
            "authorUserName": owner,
            "kernelSlug": slug,
            "tab": "output",
        })
        kernel_id = (view.get("kernel") or {}).get("id")
        if not kernel_id:
            raise RuntimeError(f"Kaggle 未返回 Kernel ID：{kernel_ref}")

        total = int(view.get("totalVersionCount") or 0)
        data = ws.post(LIST_VERSIONS, {
            "kernelId": int(kernel_id),
            "sortOption": "VERSION_ID",
            "pageSize": max(total, 200),
        })
        items = data.get("items") or []
        if not isinstance(items, list):
            items = []

        def build_version(item: dict) -> VersionInfo:
            version = item.get("version") or {}
            run = item.get("run") or {}
            blob = item.get("blob") or {}
            version_number = int(version.get("versionNumber") or 0)
            cached_hit = (
                cached_versions.get(version_number)
                if cached_versions
                else None
            )
            if cached_hit is not None and cached_hit.public_lb_numeric is not None:
                return cached_versions[version_number]
            score_numeric: Optional[float] = None
            if version_number > 0:
                try:
                    version_view = ws.post(VIEW_MODEL, {
                        "authorUserName": owner,
                        "kernelSlug": slug,
                        "tab": "output",
                        "versionNumber": version_number,
                    })
                    submission = version_view.get("submission") or {}
                    score_numeric = parse_public_score(
                        submission.get("scoreFormatted")
                    )
                except Exception:
                    pass
            return VersionInfo(
                version_number=version_number,
                title=version.get("versionName") or run.get("title") or "",
                status=str(run.get("status") or "").lower(),
                date_created=blob.get("dateCreated") or run.get("dateCreated") or "",
                public_lb=(
                    str(score_numeric) if score_numeric is not None else None
                ),
                public_lb_numeric=score_numeric,
                script_version_id=version.get("id"),
            )

        versions: list[VersionInfo] = []
        worker_count = min(4, max(len(items), 1))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(build_version, item) for item in items]
            for future in as_completed(futures):
                versions.append(future.result())
        versions.sort(key=lambda item: item.version_number, reverse=True)
        return VersionScoreList(
            owner_slug=owner,
            kernel_slug=slug,
            versions=versions,
        )
    finally:
        ws.close()


def get_versions_via_cli(
    kernel_runner: Callable[[list[str]], tuple[str, str]],
    kernel_ref: str,
) -> VersionScoreList:
    """Fallback: parse version info from kernel metadata via CLI."""
    ref_parts = kernel_ref.split("/")
    if len(ref_parts) != 2:
        raise ValueError(f"Invalid kernel ref: {kernel_ref}")
    owner, slug = ref_parts

    with tempfile.TemporaryDirectory() as tmpdir:
        kernel_runner(["kernels", "pull", kernel_ref, "-p", tmpdir, "-m"])
        metadata_path = Path(tmpdir) / "kernel-metadata.json"
        if metadata_path.exists():
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            version = VersionInfo(
                version_number=meta.get("versionNumber", 0),
                title=meta.get("title", ""),
                status=meta.get("status", ""),
                date_created=meta.get("creationDate", ""),
            )
            return VersionScoreList(
                owner_slug=owner,
                kernel_slug=slug,
                versions=[version] if version.version_number else [],
            )

    return VersionScoreList(owner_slug=owner, kernel_slug=slug, versions=[])
