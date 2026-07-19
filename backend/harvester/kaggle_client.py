from __future__ import annotations

import json
import io
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Optional

import httpx

from .cache import PersistentKernelMetadataCache, PersistentKernelScoreCache
from .models import (
    CompetitionInfo,
    KernelSummary,
    ScoredKernel,
    VersionInfo,
    VersionScoreList,
)


# ---------------------------------------------------------------------------
#  Kaggle internal web service client (for scores)
# ---------------------------------------------------------------------------

KAGGLE_WEB_BASE = "https://www.kaggle.com/api/i"
VIEW_MODEL = "kernels.LegacyKernelsService/GetKernelViewModel"
LIST_VERSIONS = "kernels.KernelsService/ListKernelVersions"
UTF8_WRAPPER_NAME = "Invoke-KaggleUtf8.ps1"


def _locate_utf8_wrapper(module_file: str | Path) -> Path:
    """逐级查找 Windows Kaggle UTF-8 包装脚本，兼容浅层容器路径。"""
    module_path = Path(module_file).resolve()
    for parent in module_path.parents:
        candidate = parent / "scripts" / UTF8_WRAPPER_NAME
        if candidate.exists():
            return candidate
    # Linux 不使用该脚本；返回稳定的缺失路径供 readiness 展示即可。
    return module_path.parent / UTF8_WRAPPER_NAME


class KaggleWebServiceClient:
    """Calls Kaggle's internal JSON web service (``/api/i``) with XSRF auth.

    This is the only way to get per-version public LB scores, since the
    standard REST API does not expose them.
    """

    def __init__(self, token: str) -> None:
        self._token = token
        self._session = httpx.Client(
            follow_redirects=True,
            timeout=30.0,
            headers={"Authorization": f"Bearer {self._token}"},
        )
        # Seed XSRF session by visiting Kaggle
        self._session.get("https://www.kaggle.com")
        self._xsrf = dict(self._session.cookies).get("XSRF-TOKEN", "")
        if not self._xsrf:
            self._session.close()
            raise RuntimeError("Failed to obtain XSRF token from Kaggle session.")

    def post(self, service_method: str, body: dict) -> dict:
        url = f"{KAGGLE_WEB_BASE}/{service_method}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "X-XSRF-TOKEN": self._xsrf,
        }
        resp = self._session.post(url, json=body, headers=headers, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def post_text(self, service_method: str, body: dict) -> str:
        """调用返回源码文本的 Kaggle 内部接口。"""
        url = f"{KAGGLE_WEB_BASE}/{service_method}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
            "X-XSRF-TOKEN": self._xsrf,
        }
        resp = self._session.post(url, json=body, headers=headers, timeout=60)
        resp.raise_for_status()
        return resp.text

    def get_bytes(self, url: str) -> bytes:
        """下载 Kaggle 内部或签名 URL 的二进制内容。"""
        if url.startswith("/"):
            url = f"https://www.kaggle.com{url}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "X-XSRF-TOKEN": self._xsrf,
        }
        resp = self._session.get(url, headers=headers, timeout=120)
        resp.raise_for_status()
        return resp.content

    def close(self) -> None:
        self._session.close()


def _parse_public_score(value: Any) -> float | None:
    """Parse a leaderboard score string into a float, or None if not numeric."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"-", "na", "n/a", "nan", "none", "null"}:
        return None
    match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _extract_public_score(view: dict[str, Any]) -> float | None:
    """读取 Kaggle 列表使用的最佳公开分数，并兼容旧响应字段。"""
    candidates = (
        ((view.get("bestSubmissionScore") or {}).get("scoreFormatted")),
        ((view.get("kernel") or {}).get("bestPublicScore")),
        ((view.get("submission") or {}).get("scoreFormatted")),
    )
    for candidate in candidates:
        score = _parse_public_score(candidate)
        if score is not None:
            return score
    return None


def _infer_score_direction_from_metric(metric: str | None) -> bool | None:
    """根据常见评估指标名称推断是否为越低越好。"""
    normalized = re.sub(r"[^a-z0-9]+", " ", (metric or "").lower()).strip()
    if not normalized:
        return None

    lower_better_markers = (
        "loss",
        "error",
        "rmse",
        "rmsle",
        "mae",
        "mse",
        "logloss",
        "log loss",
        "cross entropy",
        "distance",
        "deviance",
        "crps",
        "wer",
        "mean columnwise root mean squared error",
    )
    higher_better_markers = (
        "accuracy",
        "auc",
        "f1",
        "average precision",
        "map",
        "ndcg",
        "correlation",
        "pearson",
        "spearman",
        "dice",
        "jaccard",
        "intersection over union",
        "iou",
        "r2",
    )
    if any(marker in normalized for marker in lower_better_markers):
        return True
    if any(marker in normalized for marker in higher_better_markers):
        return False
    return None


class KaggleClient:
    """Wrapper around the Kaggle CLI for kernel research."""

    COMPETITION_SLUG = "rogii-wellbore-geology-prediction"

    def __init__(
        self,
        kaggle_token: Optional[str] = None,
        competition_slug: Optional[str] = None,
        score_cache: Optional[PersistentKernelScoreCache] = None,
        metadata_cache: Optional[PersistentKernelMetadataCache] = None,
    ) -> None:
        self._token = kaggle_token or os.environ.get("KAGGLE_API_TOKEN", "")
        self.competition_slug = competition_slug or self.COMPETITION_SLUG
        self._score_cache = score_cache
        self._metadata_cache = metadata_cache
        self._competition_info_memory: dict[str, CompetitionInfo] = {}
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
        if "/" not in kernel_ref:
            return ""
        owner, slug = kernel_ref.split("/", 1)
        from kagglesdk.kaggle_http_client import KaggleHttpClient
        from kagglesdk.kernels.services.kernels_api_service import (
            KernelsApiClient,
        )
        from kagglesdk.kernels.types.kernels_api_service import (
            ApiGetKernelRequest,
        )

        request = ApiGetKernelRequest()
        request.user_name = owner
        request.kernel_slug = slug
        response = KernelsApiClient(KaggleHttpClient()).get_kernel(request)
        data = response.to_dict()
        metadata = data.get("metadata") or {}
        blob = data.get("blob") or {}
        return str(
            metadata.get("kernelType")
            or blob.get("kernelType")
            or ""
        ).strip().lower()

    def enrich_kernel_metadata(
        self,
        kernels: list[KernelSummary] | list[ScoredKernel],
        retry_seconds: int = 3600,
    ) -> bool:
        """从永久缓存补类型，仅为新出现或退避到期的 Kernel 查询详情。"""
        if self._metadata_cache is None or not kernels:
            return False

        refs = [item.ref for item in kernels]
        cached = self._metadata_cache.get_many(refs)
        now = time.time()
        missing: list[str] = []
        known: dict[str, Optional[str]] = {}
        changed = False
        by_ref = {item.ref: item for item in kernels}

        for item in kernels:
            hit = cached.get(item.ref)
            current = (item.kernel_type or "").strip().lower()
            if current:
                if hit is None or hit.kernel_type != current:
                    known[item.ref] = current
                continue
            if hit and hit.kernel_type:
                item.kernel_type = hit.kernel_type
                changed = True
                continue
            if hit is None or now - hit.checked_at >= retry_seconds:
                missing.append(item.ref)

        fetched: dict[str, Optional[str]] = {}
        if missing:
            worker_count = min(4, len(missing))
            with ThreadPoolExecutor(max_workers=worker_count) as executor:
                futures = {
                    executor.submit(self._fetch_kernel_type_sdk, ref): ref
                    for ref in missing
                }
                for future in as_completed(futures):
                    ref = futures[future]
                    try:
                        kernel_type = future.result()
                    except Exception:
                        kernel_type = ""
                    fetched[ref] = kernel_type or None
                    if kernel_type:
                        by_ref[ref].kernel_type = kernel_type
                        changed = True

        self._metadata_cache.merge_checked({**known, **fetched})
        return changed

    # ------------------------------------------------------------------
    #  Low-level helpers
    # ------------------------------------------------------------------

    def _run_kaggle(
        self, args: list[str], timeout: int = 120
    ) -> tuple[str, str]:
        """Run a kaggle CLI command, return (stdout, stderr)."""
        if shutil.which("kaggle") is None:
            raise RuntimeError("未找到 Kaggle CLI，请先安装 kaggle Python 包。")

        if os.name == "nt":
            if not self._utf8_wrapper.exists():
                raise RuntimeError(
                    f"缺少 UTF-8 Kaggle 包装脚本：{self._utf8_wrapper}"
                )
            powershell = shutil.which("powershell.exe") or shutil.which("powershell")
            if powershell is None:
                raise RuntimeError("未找到 PowerShell，无法安全调用 Kaggle CLI。")
            cmd = [
                powershell,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(self._utf8_wrapper),
                *args,
            ]
        else:
            cmd = ["kaggle", *args]

        env = {
            **os.environ,
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        if self._token:
            env["KAGGLE_API_TOKEN"] = self._token

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
        if proc.returncode != 0:
            detail = proc.stderr.strip() or proc.stdout.strip()
            raise RuntimeError(
                f"Kaggle CLI 执行失败（退出码 {proc.returncode}）："
                f"{detail or '未返回错误详情'}"
            )
        return proc.stdout.strip(), proc.stderr.strip()

    def _run_kaggle_json(
        self, args: list[str], timeout: int = 120
    ) -> list[dict]:
        """Run a kaggle CLI command and parse JSON output."""
        stdout, _ = self._run_kaggle(args, timeout=timeout)
        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            # fallback: try to extract JSON from otherwise noisy output
            match = re.search(r"\[.*\]", stdout, re.DOTALL)
            if match:
                data = json.loads(match.group())
            else:
                raise
        return data if isinstance(data, list) else [data]

    # ------------------------------------------------------------------
    #  Competition info
    # ------------------------------------------------------------------

    def fetch_competition_info(
        self, competition: Optional[str] = None, refresh: bool = False
    ) -> CompetitionInfo:
        """Fetch competition overview via Kaggle CLI."""
        comp = competition or self.competition_slug
        if not refresh and comp in self._competition_info_memory:
            return self._competition_info_memory[comp].model_copy(deep=True)
        try:
            result = self._run_kaggle_json(
                ["competitions", "list", "--search", comp, "--format", "json"]
            )
            data = next(
                (
                    item
                    for item in result
                    if item.get("ref") == comp or item.get("id") == comp
                ),
                result[0] if result else None,
            )
            if data:
                raw_direction = next(
                    (
                        data.get(key)
                        for key in (
                            "isLowerBetter",
                            "isLowerIsBetter",
                            "lowerIsBetter",
                        )
                        if data.get(key) is not None
                    ),
                    None,
                )
                source = "api"
                if isinstance(raw_direction, str):
                    lowered = raw_direction.strip().lower()
                    raw_direction = (
                        True if lowered in {"true", "1", "yes"}
                        else False if lowered in {"false", "0", "no"}
                        else None
                    )
                is_lower_better = (
                    raw_direction if isinstance(raw_direction, bool) else None
                )
                if is_lower_better is None:
                    is_lower_better = self._detect_score_direction_from_leaderboard(comp)
                    source = "leaderboard"
                evaluation_metric = (
                    data.get("evaluationMetric")
                    or data.get("evaluation")
                    or data.get("evaluationMetricName")
                )
                if is_lower_better is None:
                    is_lower_better = _infer_score_direction_from_metric(
                        str(evaluation_metric or "")
                    )
                    source = "metric"
                if is_lower_better is None:
                    # 无法从平台证据推断时保持兼容默认值，并通过 source 明确标记。
                    is_lower_better = True
                    source = "fallback"
                info = CompetitionInfo(
                    id=comp,
                    title=data.get("title", comp),
                    category=data.get("category", ""),
                    deadline=data.get("deadline"),
                    reward=data.get("reward"),
                    team_count=data.get("teamCount"),
                    kernel_count=data.get("kernelCount"),
                    evaluation_metric=evaluation_metric,
                    is_lower_better=is_lower_better,
                    score_direction_source=source,
                )
                self._competition_info_memory[comp] = info
                return info.model_copy(deep=True)
        except Exception as exc:
            if competition and competition != self.competition_slug:
                raise RuntimeError(f"无法读取竞赛 {comp}：{exc}") from exc

        # 默认竞赛在离线时仍可展示基础身份。
        info = CompetitionInfo(
            id=comp,
            title=(
                "ROGII Wellbore Geology Prediction"
                if comp == self.COMPETITION_SLUG
                else comp
            ),
            is_lower_better=True,
            score_direction_source="fallback",
        )
        self._competition_info_memory[comp] = info
        return info.model_copy(deep=True)

    def _detect_score_direction_from_leaderboard(
        self, competition: str
    ) -> bool | None:
        """根据公开榜单从优到劣的分数顺序判断优化方向。"""
        try:
            from kagglesdk.competitions.services.competition_api_service import (
                CompetitionApiClient,
            )
            from kagglesdk.competitions.types.competition_api_service import (
                ApiGetLeaderboardRequest,
            )
            from kagglesdk.kaggle_http_client import KaggleHttpClient

            request = ApiGetLeaderboardRequest()
            request.competition_name = competition
            request.override_public = True
            request.page_size = 20
            response = CompetitionApiClient(KaggleHttpClient()).get_leaderboard(
                request
            )
            scores = [
                score
                for score in (
                    _parse_public_score(item.score)
                    for item in (response.submissions or [])
                )
                if score is not None
            ]
            if len(scores) < 2:
                return None
            best = scores[0]
            comparison = next(
                (score for score in scores[1:] if abs(score - best) > 1e-12),
                None,
            )
            if comparison is None:
                return None
            return best < comparison
        except Exception:
            return None

    def _parse_competition_output(self, text: str) -> CompetitionInfo:
        """Parse the verbose competition list output."""
        info: dict[str, object] = {
            "id": self.COMPETITION_SLUG,
            "title": self.COMPETITION_SLUG,
            "category": "",
            "is_lower_better": True,
        }
        for line in text.splitlines():
            line = line.strip()
            if ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip().lower()
            value = value.strip()
            if key == "title":
                info["title"] = value
            elif key == "category":
                info["category"] = value
            elif key == "deadline":
                info["deadline"] = value
            elif key == "reward":
                info["reward"] = value
            elif key == "teamcount":
                try:
                    info["team_count"] = int(value)
                except ValueError:
                    pass
            elif key == "evaluation":
                info["evaluation_metric"] = value
            elif key == "description":
                info["description"] = value
        return CompetitionInfo(**info)  # type: ignore[arg-type]

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

    def _parse_kernel_list_output(
        self, text: str, competition: str
    ) -> list[KernelSummary]:
        """Parse tabular output from `kaggle kernels list -v`."""
        kernels: list[KernelSummary] = []
        lines = text.splitlines()

        # Skip header and separator lines, find the data rows
        data_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("ref") or stripped.startswith("---"):
                continue
            # The verbose output format is pipe-delimited-ish:
            # ref | title | author | lastRunTime | totalVotes | ... | type | category
            if "|" in stripped:
                data_lines.append(stripped)

        for line in data_lines:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 4:
                continue
            ref = parts[0]
            title = parts[1] if len(parts) > 1 else ""
            author = parts[2] if len(parts) > 2 else ""
            last_run_time = parts[3] if len(parts) > 3 else None
            total_votes_str = parts[4] if len(parts) > 4 else "0"
            kernel_type = parts[5] if len(parts) > 5 else ""
            category = parts[6] if len(parts) > 6 else ""

            try:
                total_votes = int(total_votes_str.replace(",", ""))
            except ValueError:
                total_votes = 0

            kernels.append(
                KernelSummary(
                    ref=ref,
                    title=title,
                    author=author,
                    last_run_time=last_run_time,
                    total_votes=total_votes,
                    vote_count=total_votes,
                    kernel_type=kernel_type,
                    category=category,
                    competition=competition,
                    is_competition_kernel=True,
                )
            )

        return kernels

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
    ) -> list[ScoredKernel]:
        """为列表补充当前 Kernel 版本的公开分数。"""
        comp = competition or self.competition_slug

        # Build base entries from summaries
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
                competition=comp,
                is_competition_kernel=s.is_competition_kernel,
            )
            for s in summaries
        }

        # 分数接口成本较高，仅处理调用方明确要求的前 N 条。
        summary_by_ref = {summary.ref: summary for summary in summaries}
        refs_to_enrich = list(base)
        if score_limit is not None:
            refs_to_enrich = refs_to_enrich[: max(score_limit, 0)]

        refs_to_fetch: list[str] = []
        for ref in refs_to_enrich:
            summary = summary_by_ref[ref]
            cached = (
                self._score_cache.get_current(ref, summary.last_run_time)
                if self._score_cache is not None
                else None
            )
            if cached is None:
                refs_to_fetch.append(ref)
                continue
            base[ref].public_score = cached.public_score
            base[ref].public_score_display = cached.public_score_display

        refs_to_enrich = refs_to_fetch
        if not self._token or not refs_to_enrich:
            return list(base.values())

        ws: KaggleWebServiceClient | None = None
        try:
            ws = KaggleWebServiceClient(self._token)

            def fetch_current_score(
                ref: str,
            ) -> tuple[str, Optional[float], bool]:
                if "/" not in ref:
                    return ref, None, False
                owner, slug = ref.split("/", 1)
                try:
                    view = ws.post(VIEW_MODEL, {
                        "authorUserName": owner,
                        "kernelSlug": slug,
                        "tab": "output",
                    })
                    return ref, _extract_public_score(view), True
                except Exception:
                    return ref, None, False

            worker_count = min(4, len(refs_to_enrich))
            with ThreadPoolExecutor(max_workers=worker_count) as executor:
                futures = {
                    executor.submit(fetch_current_score, ref): ref
                    for ref in refs_to_enrich
                }
                for future in as_completed(futures):
                    ref, current_score, fetch_succeeded = future.result()
                    if current_score is not None:
                        base[ref].public_score = current_score
                        base[ref].public_score_display = f"{current_score:.4f}"
                    if self._score_cache is not None and fetch_succeeded:
                        summary = summary_by_ref[ref]
                        self._score_cache.set_current(
                            ref,
                            summary.last_run_time,
                            current_score,
                            (
                                f"{current_score:.4f}"
                                if current_score is not None
                                else None
                            ),
                        )
        except Exception:
            pass
        finally:
            if ws is not None:
                ws.close()

        return list(base.values())

    def get_kernel_versions(
        self, kernel_ref: str, refresh: bool = False
    ) -> VersionScoreList:
        """Get all versions with scores for a kernel via Kaggle web API."""
        cached_versions = (
            self._score_cache.get_versions(kernel_ref)
            if self._score_cache is not None
            else []
        )
        if cached_versions and not refresh:
            owner, slug = kernel_ref.split("/", 1)
            return VersionScoreList(
                owner_slug=owner,
                kernel_slug=slug,
                versions=cached_versions,
            )
        try:
            result = self._get_versions_via_web_api(
                kernel_ref,
                cached_versions={
                    item.version_number: item for item in cached_versions
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
        ref_parts = kernel_ref.split("/")
        if len(ref_parts) != 2:
            raise ValueError(f"Invalid kernel ref: {kernel_ref}")
        owner, slug = ref_parts
        if not self._token:
            raise RuntimeError("KAGGLE_API_TOKEN 未配置，无法读取版本分数。")

        ws = KaggleWebServiceClient(self._token)
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
                if cached_versions and version_number in cached_versions:
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
                        score_numeric = _parse_public_score(
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

    def _get_versions_via_cli(self, kernel_ref: str) -> VersionScoreList:
        """Fallback: parse version info from kernel metadata."""
        ref_parts = kernel_ref.split("/")
        if len(ref_parts) != 2:
            raise ValueError(f"Invalid kernel ref: {kernel_ref}")
        owner, slug = ref_parts

        # Pull the kernel metadata
        with tempfile.TemporaryDirectory() as tmpdir:
            self._run_kaggle(
                ["kernels", "pull", kernel_ref, "-p", tmpdir, "-m"]
            )
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
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        if not self._token:
            raise RuntimeError("KAGGLE_API_TOKEN 未配置，无法读取 Kernel 源码。")
        owner, slug = kernel_ref.split("/", 1)
        ws = KaggleWebServiceClient(self._token)
        try:
            initial = ws.post(VIEW_MODEL, {
                "authorUserName": owner,
                "kernelSlug": slug,
                "tab": "output",
            })
            kernel = initial.get("kernel") or {}
            kernel_id = int(kernel.get("id") or 0)
            if not kernel_id:
                raise RuntimeError(f"Kaggle 未返回 Kernel ID：{kernel_ref}")

            total = int(initial.get("totalVersionCount") or 0)
            version_data = ws.post(LIST_VERSIONS, {
                "kernelId": kernel_id,
                "sortOption": "VERSION_ID",
                "pageSize": max(total, 200),
            })
            version_items = version_data.get("items") or []
            selected_item = next(
                (
                    item for item in version_items
                    if int((item.get("version") or {}).get("versionNumber") or 0) == version
                ),
                None,
            ) if version is not None else None
            if selected_item is None:
                if version is None:
                    raise RuntimeError("未指定可下载的 Kernel 版本。")
                raise RuntimeError(f"Kaggle 未找到版本 v{version}：{kernel_ref}")

            version_info = selected_item.get("version") or {}
            run_info = selected_item.get("run") or {}
            version_number = int(version_info.get("versionNumber") or version)
            session_id = int(run_info.get("id") or 0)
            if not session_id:
                raise RuntimeError(f"Kaggle 未返回版本 v{version_number} 的运行会话。")

            view = ws.post(VIEW_MODEL, {
                "authorUserName": owner,
                "kernelSlug": slug,
                "tab": "output",
                "versionNumber": version_number,
            })
            kernel_run = view.get("kernelRun") or {}
            source_text = ws.post_text(
                "kernels.KernelsService/GetKernelSessionSource",
                {
                    "kernelSessionId": session_id,
                    "includeOutputIfAvailable": include_outputs,
                },
            )

            try:
                parsed_source = json.loads(source_text)
            except json.JSONDecodeError:
                parsed_source = None
            if isinstance(parsed_source, dict) and isinstance(parsed_source.get("cells"), list):
                extension = ".ipynb"
            else:
                language = str(kernel_run.get("language") or "").lower()
                extension = ".r" if language == "r" or "language_r" in language else ".py"
            source_path = output_path / f"{slug}{extension}"
            source_path.write_text(source_text, encoding="utf-8")

            data_sources = view.get("dataSources") or []
            dataset_sources = [
                str(item.get("mountSlug") or "").removeprefix("datasets/")
                for item in data_sources
                if str(item.get("mountSlug") or "").startswith("datasets/")
            ]
            competition_sources = [
                str(item.get("mountSlug") or "").removeprefix("competitions/")
                for item in data_sources
                if str(item.get("mountSlug") or "").startswith("competitions/")
            ]
            metadata = {
                "title": version_info.get("versionName") or kernel.get("title") or slug,
                "versionNumber": version_number,
                "scriptVersionId": int(version_info.get("id") or 0),
                "kernelSessionId": session_id,
                "status": str(run_info.get("status") or "").lower(),
                "creationDate": run_info.get("dateCreated") or "",
                "language": kernel_run.get("language") or "",
                "kernelType": kernel_run.get("kernelVersionType") or "",
                "datasetSources": dataset_sources,
                "competitionSources": competition_sources,
            }
            (output_path / "kernel-metadata.json").write_text(
                json.dumps(metadata, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            if include_outputs:
                download_url = view.get("downloadAllFilesUrl")
                if download_url:
                    outputs_path = output_path / "outputs"
                    outputs_path.mkdir(parents=True, exist_ok=True)
                    archive_bytes = ws.get_bytes(str(download_url))
                    self._extract_output_zip(archive_bytes, outputs_path)

            return {
                "owner_slug": owner,
                "kernel_slug": slug,
                "selected_version": version_number,
                "script_version_id": int(version_info.get("id") or 0),
                "source_path": str(source_path),
                "metadata": metadata,
            }
        finally:
            ws.close()

    @staticmethod
    def _extract_output_zip(archive_bytes: bytes, output_path: Path) -> None:
        """安全解压 Kaggle 输出压缩包，禁止成员路径越出 outputs 目录。"""
        root = output_path.resolve()
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            for member in archive.infolist():
                target = (root / member.filename).resolve()
                try:
                    target.relative_to(root)
                except ValueError as exc:
                    raise RuntimeError(
                        f"Kaggle 输出压缩包包含越界路径：{member.filename}"
                    ) from exc
            archive.extractall(root)

    # ------------------------------------------------------------------
    #  Competition data info
    # ------------------------------------------------------------------

    def list_datasets(self) -> list[dict]:
        """List competition datasets."""
        stdout, _ = self._run_kaggle(
            ["competitions", "data", "list", self.COMPETITION_SLUG]
        )
        return self._parse_dataset_list_output(stdout)

    def _parse_dataset_list_output(self, text: str) -> list[dict]:
        """Parse tabular dataset listing."""
        datasets: list[dict] = []
        lines = text.strip().splitlines()
        for line in lines[2:]:  # skip header + separator
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 5:
                datasets.append(
                    {
                        "name": parts[0],
                        "size": parts[1],
                        "type": parts[2],
                        "columns": parts[3] if len(parts) > 3 else "",
                        "description": " ".join(parts[4:]),
                    }
                )
        return datasets

    def download_dataset(
        self,
        output_dir: str,
        file_name: Optional[str] = None,
        force: bool = False,
    ) -> Path:
        """Download competition data."""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        args = [
            "competitions",
            "data",
            "download",
            self.COMPETITION_SLUG,
            "-p",
            str(output_path),
        ]
        if file_name:
            args.extend(["-f", file_name])
        if force:
            args.append("--force")

        self._run_kaggle(args, timeout=600)
        return output_path
