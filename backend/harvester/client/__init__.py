"""
Modular client components for Kaggle CLI, web services, parsing, and simulation.
"""

from .cli import (
    UTF8_WRAPPER_NAME,
    locate_utf8_wrapper,
    run_kaggle,
    run_kaggle_json,
)
from .parser import (
    competition_slug_from_ref,
    extract_current_public_score,
    extract_public_score,
    infer_score_direction_from_metric,
    is_simulation_competition,
    parse_competition_output,
    parse_competition_submission,
    parse_dataset_list_output,
    parse_kernel_list_output,
    parse_public_score,
    row_value,
)
from .simulation import (
    download_simulation_leaderboard_data,
    list_simulation_episodes_for_submission,
)
from .web import (
    KAGGLE_WEB_BASE,
    LIST_VERSIONS,
    VIEW_MODEL,
    KaggleWebServiceClient,
)
from .archive import (
    archive_kernel_impl,
    enrich_kernel_metadata_impl,
    extract_output_zip,
    fetch_kernel_type_sdk,
    get_kernel_runtime_metadata,
)
from .versions import (
    enrich_kernel_summaries_impl,
    get_versions_via_cli,
    get_versions_via_web_api,
    list_kernels_by_score_sdk,
)

__all__ = [
    "UTF8_WRAPPER_NAME",
    "locate_utf8_wrapper",
    "run_kaggle",
    "run_kaggle_json",
    "competition_slug_from_ref",
    "extract_current_public_score",
    "extract_public_score",
    "infer_score_direction_from_metric",
    "is_simulation_competition",
    "parse_competition_output",
    "parse_competition_submission",
    "parse_dataset_list_output",
    "parse_kernel_list_output",
    "parse_public_score",
    "row_value",
    "download_simulation_leaderboard_data",
    "list_simulation_episodes_for_submission",
    "KAGGLE_WEB_BASE",
    "LIST_VERSIONS",
    "VIEW_MODEL",
    "KaggleWebServiceClient",
    "archive_kernel_impl",
    "enrich_kernel_metadata_impl",
    "extract_output_zip",
    "fetch_kernel_type_sdk",
    "get_kernel_runtime_metadata",
    "enrich_kernel_summaries_impl",
    "get_versions_via_cli",
    "get_versions_via_web_api",
    "list_kernels_by_score_sdk",
]
