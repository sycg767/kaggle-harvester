from __future__ import annotations

import csv
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx

from .cache import PersistentKernelMetadataCache, PersistentKernelScoreCache
from .models import (
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


def _competition_slug_from_ref(raw: object) -> str:
    """从 Kaggle competitions list 的 ref/id 字段提取竞赛 slug。

    新版 CLI 可能返回完整 URL：
    ``https://www.kaggle.com/competitions/rogii-wellbore-geology-prediction``
    """
    value = str(raw or "").strip()
    if not value:
        return ""
    if "://" in value or value.startswith("www."):
        path = value.split("?", 1)[0].rstrip("/")
        marker = "/competitions/"
        if marker in path:
            value = path.split(marker, 1)[1]
        else:
            value = path.rsplit("/", 1)[-1]
        value = value.split("/", 1)[0]
    return value.strip()


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


def _row_value(row: dict[str, Any], *keys: str) -> Any:
    """兼容 Kaggle SDK/CLI 的 camelCase 与 snake_case 字段。"""
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def _parse_competition_submission(row: dict[str, Any]) -> CompetitionSubmission | None:
    """把 Kaggle 提交对象归一化为内部模型，并保留团队提交元数据。"""
    ref_value = _row_value(row, "ref", "id", "submissionId", "submission_id")
    if ref_value is None:
        return None

    public_display = _row_value(row, "publicScore", "public_score")
    private_display = _row_value(row, "privateScore", "private_score")
    status_raw = str(_row_value(row, "status") or "").strip()
    if status_raw.startswith("SubmissionStatus."):
        status_raw = status_raw.split(".", 1)[1]

    return CompetitionSubmission(
        ref=str(ref_value),
        file_name=str(_row_value(row, "fileName", "file_name") or ""),
        date=(
            str(_row_value(row, "date", "dateSubmitted", "date_submitted"))
            if _row_value(row, "date", "dateSubmitted", "date_submitted") is not None
            else None
        ),
        description=str(_row_value(row, "description") or ""),
        status=status_raw,
        error_description=str(
            _row_value(row, "errorDescription", "error_description") or ""
        ),
        submitted_by=str(_row_value(row, "submittedBy", "submitted_by") or ""),
        submitted_by_ref=str(
            _row_value(row, "submittedByRef", "submitted_by_ref") or ""
        ),
        team_name=str(_row_value(row, "teamName", "team_name") or ""),
        public_score=_parse_public_score(public_display),
        public_score_display=(
            str(public_display).strip() if public_display is not None else None
        ),
        private_score=_parse_public_score(private_display),
        private_score_display=(
            str(private_display).strip() if private_display is not None else None
        ),
    )


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


def _extract_current_public_score(
    view: dict[str, Any],
) -> tuple[float | None, int | None, int | None]:
    """返回榜单最佳分数、分数来源版本和当前版本。

    列表列对齐 Kaggle Code 列表的 Score / Best Score，而不是 notebook 详情里
    当前版本的 Public Score。当最新版更差或尚未出分时，仍展示历史最佳。
    """
    try:
        current_version = int(view.get("currentVersionNumber") or 0) or None
    except (TypeError, ValueError):
        current_version = None

    best_submission = view.get("bestSubmissionScore") or {}
    try:
        best_version = int(best_submission.get("kernelVersionNumber") or 0) or None
    except (TypeError, ValueError):
        best_version = None
    best_score = _parse_public_score(best_submission.get("scoreFormatted"))
    if best_score is not None:
        return best_score, best_version or current_version, current_version

    # 兼容旧响应：无 bestSubmissionScore 时再回退 kernel / submission 字段。
    score = _extract_public_score(view)
    return score, best_version or current_version, current_version


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
        self._sim_leaderboard_cache: dict[str, tuple[float, SimulationMedalThresholds, list[dict[str, Any]]]] = {}
        self._sim_episodes_cache: dict[int, list[SimulationEpisode]] = {}
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

    def get_kernel_runtime_metadata(
        self, kernel_ref: str, version_number: int
    ) -> dict[str, Any]:
        """读取指定平台版本的 GPU、Internet 和机器规格。"""
        if "/" not in kernel_ref or version_number <= 0:
            return {}
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
        request.version_label = f"v{version_number}"
        response = KernelsApiClient(KaggleHttpClient()).get_kernel(request)
        metadata = response.to_dict().get("metadata") or {}
        aliases = {
            "enableGpu": ("enableGpu", "enable_gpu", "isGpuEnabled"),
            "enableInternet": (
                "enableInternet",
                "enable_internet",
                "isInternetEnabled",
            ),
            "machineShape": ("machineShape", "machine_shape"),
        }
        result: dict[str, Any] = {}
        for target, source_names in aliases.items():
            for source_name in source_names:
                if source_name in metadata and metadata[source_name] is not None:
                    result[target] = metadata[source_name]
                    break
        if result:
            result["runtimeMetadataSource"] = "kaggle_sdk_version"
            result["runtimeMetadataVersion"] = version_number
        return result

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
        kaggle_home = Path.home() / ".kaggle"
        if kaggle_home.exists() and "KAGGLE_CONFIG_DIR" not in env:
            env["KAGGLE_CONFIG_DIR"] = str(kaggle_home)
        if self._token:
            env["KAGGLE_API_TOKEN"] = self._token
        else:
            kaggle_json = kaggle_home / "kaggle.json"
            if kaggle_json.is_file() and ("KAGGLE_USERNAME" not in env or "KAGGLE_KEY" not in env):
                try:
                    cred = json.loads(kaggle_json.read_text(encoding="utf-8"))
                    if isinstance(cred, dict):
                        if cred.get("username") and "KAGGLE_USERNAME" not in env:
                            env["KAGGLE_USERNAME"] = str(cred["username"])
                        if cred.get("key") and "KAGGLE_KEY" not in env:
                            env["KAGGLE_KEY"] = str(cred["key"])
                except Exception:
                    pass

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

    def list_entered_competitions(
        self, page_size: int = 100
    ) -> list[EnteredCompetition]:
        """列出当前账号已参加的竞赛（Kaggle group=entered）。"""
        size = max(1, min(int(page_size), 200))
        rows = self._run_kaggle_json(
            [
                "competitions",
                "list",
                "--group",
                "entered",
                "--format",
                "json",
                "--page-size",
                str(size),
            ],
            timeout=90,
        )
        results: list[EnteredCompetition] = []
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            slug = _competition_slug_from_ref(
                row.get("ref") or row.get("id") or row.get("competitionId")
            )
            if not slug or slug in seen:
                continue
            if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{2,119}", slug):
                continue
            seen.add(slug)
            team_count = row.get("teamCount")
            if team_count is None:
                team_count = row.get("team_count")
            try:
                team_count_int = int(team_count) if team_count is not None else None
            except (TypeError, ValueError):
                team_count_int = None
            raw_title = str(row.get("title") or "").strip()
            results.append(
                EnteredCompetition(
                    id=slug,
                    title=raw_title or slug,
                    category=str(row.get("category") or ""),
                    deadline=(
                        str(row.get("deadline"))
                        if row.get("deadline") not in (None, "")
                        else None
                    ),
                    reward=(
                        str(row.get("reward"))
                        if row.get("reward") not in (None, "")
                        else None
                    ),
                    team_count=team_count_int,
                )
            )
        return results

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
        force_refresh: bool = False,
    ) -> list[ScoredKernel]:
        """为列表补充 Kernel 的最佳公开分数。

        force_refresh=True 时忽略按 last_run_time 命中的当前分数缓存，
        重新请求 Kaggle Web 接口。这样“刷新分数榜”才能拿到重算后的新分。
        返回值对齐 Kaggle 列表 Score（Best Score），不是详情页当前版本 Public Score。
        """
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
            if force_refresh:
                refs_to_fetch.append(ref)
                continue
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
                        _extract_current_public_score(view)
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
                            score_version_number=score_version,
                            current_version_number=current_version,
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
                cached_hit = (
                    cached_versions.get(version_number)
                    if cached_versions
                    else None
                )
                # 只有已出分的版本才可复用缓存，避免把 null 永久短路。
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
            try:
                runtime_metadata = self.get_kernel_runtime_metadata(
                    kernel_ref, version_number
                )
            except Exception:
                runtime_metadata = {}
            if "enableGpu" not in runtime_metadata:
                gpu_enabled = kernel_run.get("isGpuEnabled")
                if gpu_enabled is not None:
                    runtime_metadata["enableGpu"] = gpu_enabled
            if "machineShape" not in runtime_metadata:
                accelerator_type = kernel_run.get("acceleratorType")
                if accelerator_type:
                    runtime_metadata["machineShape"] = accelerator_type
            if runtime_metadata and "runtimeMetadataSource" not in runtime_metadata:
                runtime_metadata["runtimeMetadataSource"] = "kernel_run"
                runtime_metadata["runtimeMetadataVersion"] = version_number
            metadata.update(runtime_metadata)
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

    def list_competition_submissions(
        self,
        competition: Optional[str] = None,
        page_size: int = 10,
    ) -> list[CompetitionSubmission]:
        """列出当前账号在竞赛中的提交记录（含 Public Score）。"""
        comp = (competition or self.competition_slug).strip()
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9-]{2,119}", comp):
            raise ValueError(f"竞赛标识无效：{comp}")
        size = max(1, min(int(page_size), 50))
        try:
            # CLI 会主动裁掉 submittedBy、teamName 和 errorDescription；SDK
            # 使用相同接口但保留完整字段，团队提交和失败原因依赖这些信息。
            from kaggle.api.kaggle_api_extended import KaggleApi

            api = KaggleApi()
            api.authenticate()
            submissions = api.competition_submissions(comp, page_size=size) or []
            rows = [item.to_dict() for item in submissions if item is not None]
        except Exception:
            # 兼容缺少新版 SDK 的环境；此路径仍可显示基本提交信息。
            rows = self._run_kaggle_json(
                [
                    "competitions",
                    "submissions",
                    comp,
                    "--format",
                    "json",
                    "--page-size",
                    str(size),
                ],
                timeout=90,
            )
        results: list[CompetitionSubmission] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            submission = _parse_competition_submission(row)
            if submission is not None:
                results.append(submission)
        return results

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

        # 1. 优先调用 Kaggle EpisodeService Web 接口获取当场真实初始分与结算变动
        try:
                # EpisodeService 是 Kaggle 内部接口，必须复用已认证的 WebService 会话；
                # 裸 httpx 请求会返回 400，随后错误回退到 SDK，丢失 initialScore/updatedScore。
                web_client = KaggleWebServiceClient(self._token)
                try:
                    data = web_client.post(
                        "competitions.EpisodeService/ListEpisodes",
                        {"submissionId": sub_id},
                    )
                finally:
                    web_client.close()
                raw_episodes = data.get("episodes", [])
                teams_map: dict[int, str] = {
                    int(t["id"]): str(t.get("teamName") or t.get("name") or "")
                    for t in data.get("teams", [])
                    if isinstance(t, dict) and "id" in t
                }

                episodes: list[SimulationEpisode] = []
                for ep in raw_episodes:
                    if not isinstance(ep, dict):
                        continue
                    ep_id = int(ep.get("id", 0))
                    if not ep_id:
                        continue
                    create_time = ep.get("createTime")
                    end_time = ep.get("endTime")
                    raw_state = str(ep.get("state", "") or "")
                    raw_type = str(ep.get("type", "") or "")

                    raw_agents = ep.get("agents", []) or []
                    agents: list[SimulationEpisodeAgent] = []
                    my_agent: SimulationEpisodeAgent | None = None
                    opponent_agent: SimulationEpisodeAgent | None = None
                    my_delta: float | None = None
                    opp_initial_score: float | None = None

                    for i, a in enumerate(raw_agents):
                        if not isinstance(a, dict):
                            continue
                        agent_sub_id = int(a.get("submissionId", 0) or 0)
                        team_id = a.get("teamId")
                        team_id_int = int(team_id) if team_id is not None else None
                        team_name = teams_map.get(team_id_int, "") if team_id_int else ""
                        reward = a.get("reward")
                        reward_val = float(reward) if reward is not None else None
                        agent_index = int(a.get("index", i) or i)
                        agent_state = str(a.get("state", "") or "")

                        sim_agent = SimulationEpisodeAgent(
                            submission_id=agent_sub_id,
                            team_id=team_id_int,
                            team_name=team_name,
                            reward=reward_val,
                            index=agent_index,
                            state=agent_state,
                        )
                        agents.append(sim_agent)

                        init_s = a.get("initialScore")
                        upd_s = a.get("updatedScore")
                        if agent_sub_id == sub_id:
                            my_agent = sim_agent
                            if init_s is not None and upd_s is not None:
                                my_delta = round(float(upd_s) - float(init_s), 1)
                        else:
                            opponent_agent = sim_agent
                            if init_s is not None:
                                opp_initial_score = round(float(init_s), 1)

                    my_idx = my_agent.index if my_agent is not None else 0
                    my_team = my_agent.team_name if my_agent is not None else ""
                    is_system_check = opponent_agent is None
                    if is_system_check:
                        opp_team = "系统自检"
                        opp_team_id = None
                        opp_sub_id = None
                        rew = None
                        outcome = "unknown"
                        my_delta = None
                    else:
                        opp_team = opponent_agent.team_name or "对手"
                        opp_team_id = opponent_agent.team_id
                        opp_sub_id = opponent_agent.submission_id
                        rew = my_agent.reward if my_agent is not None else None
                        if rew is not None:
                            if rew > 0:
                                outcome = "win"
                            elif rew < 0:
                                outcome = "loss"
                            else:
                                outcome = "tie"
                        else:
                            outcome = "unknown"

                    replay_url = f"https://www.kaggle.com/competitions/{competition}/leaderboard?dialog=episodes-episode-{ep_id}"

                    episodes.append(
                        SimulationEpisode(
                            id=ep_id,
                            create_time=create_time,
                            end_time=end_time,
                            duration_seconds=None,
                            state=raw_state,
                            type=raw_type,
                            agents=agents,
                            my_agent_index=my_idx,
                            my_submission_id=sub_id,
                            my_team_name=my_team,
                            opponent_team_name=opp_team,
                            opponent_team_id=opp_team_id,
                            opponent_submission_id=opp_sub_id,
                            result=outcome,
                            is_system_check=is_system_check,
                            reward=rew,
                            score_delta=my_delta,
                            opponent_score=opp_initial_score,
                            replay_url=replay_url,
                        )
                    )

                episodes.sort(key=lambda x: x.create_time or "", reverse=True)
                # 增量合并到内存缓存
                known_map = {ep.id: ep for ep in self._sim_episodes_cache.get(sub_id, [])}
                for ep in episodes:
                    known_map[ep.id] = ep
                merged = sorted(known_map.values(), key=lambda x: x.create_time or "", reverse=True)
                self._sim_episodes_cache[sub_id] = merged
                return merged
        except Exception:
            pass

        # 2. 回退到 Python SDK 接口
        from kaggle.api.kaggle_api_extended import KaggleApi

        api = KaggleApi()
        api.authenticate()
        raw_episodes = api.competition_list_episodes(sub_id) or []

        episodes: list[SimulationEpisode] = []
        for ep in raw_episodes:
            if ep is None:
                continue
            ep_id = int(getattr(ep, "id", 0))
            if not ep_id:
                continue
            create_time_dt = getattr(ep, "create_time", None) or getattr(ep, "createTime", None)
            end_time_dt = getattr(ep, "end_time", None) or getattr(ep, "endTime", None)
            create_time = (
                create_time_dt.isoformat()
                if hasattr(create_time_dt, "isoformat")
                else (str(create_time_dt) if create_time_dt else None)
            )
            end_time = (
                end_time_dt.isoformat()
                if hasattr(end_time_dt, "isoformat")
                else (str(end_time_dt) if end_time_dt else None)
            )
            duration_seconds = None
            if hasattr(create_time_dt, "timestamp") and hasattr(end_time_dt, "timestamp"):
                duration_seconds = max(0.0, end_time_dt.timestamp() - create_time_dt.timestamp())

            raw_state = str(getattr(ep, "state", "") or "")
            raw_type = str(getattr(ep, "type", "") or "")

            raw_agents = getattr(ep, "agents", []) or []
            agents: list[SimulationEpisodeAgent] = []
            my_agent: SimulationEpisodeAgent | None = None
            opponent_agent: SimulationEpisodeAgent | None = None

            for i, a in enumerate(raw_agents):
                agent_sub_id = int(
                    getattr(a, "submission_id", None)
                    or getattr(a, "submissionId", 0)
                    or 0
                )
                team_id = getattr(a, "team_id", None) or getattr(a, "teamId", None)
                team_name = str(
                    getattr(a, "team_name", None)
                    or getattr(a, "teamName", "")
                    or ""
                )
                reward = getattr(a, "reward", None)
                reward_val = float(reward) if reward is not None else None
                agent_index = int(getattr(a, "index", i) or i)
                agent_state = str(getattr(a, "state", "") or "")

                sim_agent = SimulationEpisodeAgent(
                    submission_id=agent_sub_id,
                    team_id=int(team_id) if team_id is not None else None,
                    team_name=team_name,
                    reward=reward_val,
                    index=agent_index,
                    state=agent_state,
                )
                agents.append(sim_agent)
                if agent_sub_id == sub_id:
                    my_agent = sim_agent
                else:
                    opponent_agent = sim_agent

            my_idx = my_agent.index if my_agent is not None else 0
            my_team = my_agent.team_name if my_agent is not None else ""
            is_system_check = opponent_agent is None
            if is_system_check:
                opp_team = "系统自检"
                opp_team_id = None
                opp_sub_id = None
                rew = None
                outcome = "unknown"
            else:
                opp_team = opponent_agent.team_name or "对手"
                opp_team_id = opponent_agent.team_id
                opp_sub_id = opponent_agent.submission_id
                rew = my_agent.reward if my_agent is not None else None
                if rew is not None:
                    if rew > 0:
                        outcome = "win"
                    elif rew < 0:
                        outcome = "loss"
                    else:
                        outcome = "tie"
                else:
                    outcome = "unknown"

            replay_url = f"https://www.kaggle.com/competitions/{competition}/leaderboard?dialog=episodes-episode-{ep_id}"

            episodes.append(
                SimulationEpisode(
                    id=ep_id,
                    create_time=create_time,
                    end_time=end_time,
                    duration_seconds=duration_seconds,
                    state=raw_state,
                    type=raw_type,
                    agents=agents,
                    my_agent_index=my_idx,
                    my_submission_id=sub_id,
                    my_team_name=my_team,
                    opponent_team_name=opp_team,
                    opponent_team_id=opp_team_id,
                    opponent_submission_id=opp_sub_id,
                    result=outcome,
                    is_system_check=is_system_check,
                    reward=rew,
                    replay_url=replay_url,
                )
            )

# 增量合并到内存缓存
        known_map = {ep.id: ep for ep in self._sim_episodes_cache.get(sub_id, [])}
        for ep in episodes:
            known_map[ep.id] = ep
        merged = sorted(known_map.values(), key=lambda x: x.create_time or "", reverse=True)
        self._sim_episodes_cache[sub_id] = merged
        return merged

    def get_simulation_episodes_cached(
        self, submission_id: int
    ) -> list[SimulationEpisode]:
        """返回指定提交已缓存的全部对局流水（按最新在前排序，不触发网络拉取）。

        缓存由 list_simulation_episodes 在每次轮询时全量刷新，因此这里能拿到完整历史。
        """
        sub_id = int(submission_id)
        return list(self._sim_episodes_cache.get(sub_id, []))

    def get_simulation_leaderboard(
        self,
        competition: str = "pokemon-tcg-ai-battle",
        bronze_percentile: float = 0.10,
        force_refresh: bool = False,
        cache_ttl_seconds: int = 300,
    ) -> tuple[SimulationMedalThresholds, list[dict[str, Any]]]:
        """下载天梯全量榜单并计算奖牌线切分点（带 5 分钟 TTL 缓存，避免每次轮询重复解压 6000+ 队伍全量榜单）。"""
        comp = competition.strip()
        import time

        now = time.time()
        if not force_refresh and comp in self._sim_leaderboard_cache:
            cached_time, cached_th, cached_rows = self._sim_leaderboard_cache[comp]
            if now - cached_time < cache_ttl_seconds:
                return cached_th, cached_rows

        try:
            from kaggle.api.kaggle_api_extended import KaggleApi

            api = KaggleApi()
            api.authenticate()
            with tempfile.TemporaryDirectory() as temp_dir:
                api.competition_leaderboard_download(comp, path=temp_dir)
                for item in Path(temp_dir).iterdir():
                    if item.suffix.lower() == ".zip":
                        with zipfile.ZipFile(item) as z:
                            z.extractall(temp_dir)
                csv_path: Path | None = None
                for item in Path(temp_dir).iterdir():
                    if item.suffix.lower() == ".csv":
                        csv_path = item
                        break

                if csv_path is None or not csv_path.exists():
                    raise RuntimeError(f"未能下载竞赛 {comp} 的天梯排行榜。")

                rows: list[dict[str, Any]] = []
                with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        cleaned_row: dict[str, Any] = {}
                        for k, v in r.items():
                            norm_key = k.lstrip("\ufeff").strip() if k else ""
                            cleaned_row[norm_key] = v
                        rows.append(cleaned_row)
        except Exception as exc:
            if comp in self._sim_leaderboard_cache:
                _, cached_th, cached_rows = self._sim_leaderboard_cache[comp]
                return cached_th, cached_rows
            raise exc

        total_teams = len(rows)
        if total_teams == 0:
            thresholds_empty = SimulationMedalThresholds(
                total_teams=0,
                bronze_percentile=bronze_percentile,
                updated_at=datetime.now(timezone.utc).isoformat(),
            )
            self._sim_leaderboard_cache[comp] = (now, thresholds_empty, [])
            return thresholds_empty, []

        gold_rank = max(1, min(total_teams, int(10 + total_teams * 0.002)))
        silver_rank = max(1, min(total_teams, int(total_teams * 0.05)))
        bronze_rank = max(1, min(total_teams, int(total_teams * bronze_percentile)))

        def _get_score_at_rank(target_rank: int) -> float | None:
            if 1 <= target_rank <= len(rows):
                raw_score = rows[target_rank - 1].get("Score")
                return _parse_public_score(raw_score)
            return None

        gold_score = _get_score_at_rank(gold_rank)
        silver_score = _get_score_at_rank(silver_rank)
        bronze_score = _get_score_at_rank(bronze_rank)

        thresholds = SimulationMedalThresholds(
            total_teams=total_teams,
            gold_cutoff_rank=gold_rank,
            gold_cutoff_score=gold_score,
            silver_cutoff_rank=silver_rank,
            silver_cutoff_score=silver_score,
            bronze_cutoff_rank=bronze_rank,
            bronze_cutoff_score=bronze_score,
            bronze_percentile=bronze_percentile,
            updated_at=datetime.now(timezone.utc).isoformat(),
        )
        self._sim_leaderboard_cache[comp] = (now, thresholds, rows)
        return thresholds, rows
