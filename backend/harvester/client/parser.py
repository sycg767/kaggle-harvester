"""
Output and data parser functions for Kaggle CLI, web API, and leaderboard metrics.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from harvester.models import (
    CompetitionInfo,
    CompetitionSubmission,
    KernelSummary,
)


def competition_slug_from_ref(raw: object) -> str:
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


def is_simulation_competition(
    slug: str,
    tags: Optional[list[str]] = None,
    title: str = "",
    description: str = "",
) -> bool:
    """精准判断是否为天梯模拟对抗赛 (Simulation Arena)。"""
    slug_lower = (slug or "").lower().strip()
    # 显式排除非模拟竞赛：策略报告、医学影像、生物细胞、地质测井、安全攻击等常规/分析赛
    if any(k in slug_lower for k in ("strategy", "rsna", "biohub", "rogii", "security")):
        return False

    tags_lower = [t.lower() for t in (tags or [])]
    if any("simulation" in t for t in tags_lower):
        return True

    title_lower = (title or "").lower()
    desc_lower = (description or "").lower()
    if "simulation" in title_lower or "simulation" in desc_lower:
        return True

    # 平台已知模拟对战环境竞赛
    if slug_lower in {
        "pokemon-tcg-ai-battle",
        "kaggriculture",
        "lux-ai-season-1",
        "lux-ai-season-2",
        "lux-ai-season-3",
        "kore-2022",
        "connectx",
        "santa-2024",
        "hungry-geese",
        "halite-iv",
        "rock-paper-scissors",
        "football",
    }:
        return True

    return False


def parse_public_score(value: Any) -> float | None:
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


def row_value(row: dict[str, Any], *keys: str) -> Any:
    """兼容 Kaggle SDK/CLI 的 camelCase 与 snake_case 字段。"""
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return value
    return None


def parse_competition_submission(row: dict[str, Any]) -> CompetitionSubmission | None:
    """把 Kaggle 提交对象归一化为内部模型，并保留团队提交元数据。"""
    ref_value = row_value(row, "ref", "id", "submissionId", "submission_id")
    if ref_value is None:
        return None

    public_display = row_value(row, "publicScore", "public_score")
    private_display = row_value(row, "privateScore", "private_score")
    status_raw = str(row_value(row, "status") or "").strip()
    if status_raw.startswith("SubmissionStatus."):
        status_raw = status_raw.split(".", 1)[1]

    return CompetitionSubmission(
        ref=str(ref_value),
        file_name=str(row_value(row, "fileName", "file_name") or ""),
        date=(
            str(row_value(row, "date", "dateSubmitted", "date_submitted"))
            if row_value(row, "date", "dateSubmitted", "date_submitted") is not None
            else None
        ),
        description=str(row_value(row, "description") or ""),
        status=status_raw,
        error_description=str(
            row_value(row, "errorDescription", "error_description") or ""
        ),
        submitted_by=str(row_value(row, "submittedBy", "submitted_by") or ""),
        submitted_by_ref=str(
            row_value(row, "submittedByRef", "submitted_by_ref") or ""
        ),
        team_name=str(row_value(row, "teamName", "team_name") or ""),
        public_score=parse_public_score(public_display),
        public_score_display=(
            str(public_display).strip() if public_display is not None else None
        ),
        private_score=parse_public_score(private_display),
        private_score_display=(
            str(private_display).strip() if private_display is not None else None
        ),
    )


def extract_public_score(view: dict[str, Any]) -> float | None:
    """读取 Kaggle 列表使用的最佳公开分数，并兼容旧响应字段。"""
    candidates = (
        ((view.get("bestSubmissionScore") or {}).get("scoreFormatted")),
        ((view.get("kernel") or {}).get("bestPublicScore")),
        ((view.get("submission") or {}).get("scoreFormatted")),
    )
    for candidate in candidates:
        score = parse_public_score(candidate)
        if score is not None:
            return score
    return None


def extract_current_public_score(
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
    best_score = parse_public_score(best_submission.get("scoreFormatted"))
    if best_score is not None:
        return best_score, best_version or current_version, current_version

    # 兼容旧响应：无 bestSubmissionScore 时再回退 kernel / submission 字段。
    score = extract_public_score(view)
    return score, best_version or current_version, current_version


def infer_score_direction_from_metric(metric: str | None) -> bool | None:
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


def parse_competition_output(text: str, default_slug: str = "") -> CompetitionInfo:
    """Parse the verbose competition list output."""
    info: dict[str, object] = {
        "id": default_slug,
        "title": default_slug,
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


def parse_kernel_list_output(
    text: str, competition: str
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


def parse_dataset_list_output(text: str) -> list[dict]:
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
