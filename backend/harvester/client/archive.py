from __future__ import annotations

import io
import json
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Optional

from ..cache import PersistentKernelMetadataCache
from ..models import KernelSummary, ScoredKernel
from .web import KaggleWebServiceClient, LIST_VERSIONS, VIEW_MODEL


def extract_output_zip(archive_bytes: bytes, output_path: Path) -> None:
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


def fetch_kernel_type_sdk(kernel_ref: str) -> str:
    """读取单个 Kernel 的稳定运行类型，不下载源码或输出。"""
    if "/" not in kernel_ref:
        return ""
    owner, slug = kernel_ref.split("/", 1)
    from kagglesdk.kaggle_http_client import KaggleHttpClient
    from kagglesdk.kernels.services.kernels_api_service import KernelsApiClient
    from kagglesdk.kernels.types.kernels_api_service import ApiGetKernelRequest

    request = ApiGetKernelRequest()
    request.user_name = owner
    request.kernel_slug = slug
    response = KernelsApiClient(KaggleHttpClient()).get_kernel(request)
    data = response.to_dict()
    metadata = data.get("metadata") or {}
    blob = data.get("blob") or {}
    return str(
        metadata.get("kernelType") or blob.get("kernelType") or ""
    ).strip().lower()


def get_kernel_runtime_metadata(
    kernel_ref: str, version_number: int
) -> dict[str, Any]:
    """读取指定平台版本的 GPU、Internet 和机器规格。"""
    if "/" not in kernel_ref or version_number <= 0:
        return {}
    owner, slug = kernel_ref.split("/", 1)
    from kagglesdk.kaggle_http_client import KaggleHttpClient
    from kagglesdk.kernels.services.kernels_api_service import KernelsApiClient
    from kagglesdk.kernels.types.kernels_api_service import ApiGetKernelRequest

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


def enrich_kernel_metadata_impl(
    metadata_cache: Optional[PersistentKernelMetadataCache],
    kernels: list[KernelSummary] | list[ScoredKernel],
    retry_seconds: int = 3600,
    fetch_type_fn: Optional[Callable[[str], str]] = None,
) -> bool:
    """从永久缓存补类型，仅为新出现或退避到期的 Kernel 查询详情。"""
    if metadata_cache is None or not kernels:
        return False

    refs = [item.ref for item in kernels]
    cached = metadata_cache.get_many(refs)
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
        fetch_worker = fetch_type_fn or fetch_kernel_type_sdk
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(fetch_worker, ref): ref
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

    metadata_cache.merge_checked({**known, **fetched})
    return changed


def archive_kernel_impl(
    token: str,
    kernel_ref: str,
    output_dir: str,
    version: Optional[int] = None,
    include_outputs: bool = False,
    web_service_cls: Any = KaggleWebServiceClient,
    runtime_metadata_fn: Optional[Callable[[str, int], dict[str, Any]]] = None,
    extract_output_fn: Optional[Callable[[bytes, Path], None]] = None,
) -> dict:
    """通过 Kaggle 内部只读接口把指定版本保存到本地。"""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    if not token:
        raise RuntimeError("KAGGLE_API_TOKEN 未配置，无法读取 Kernel 源码。")
    owner, slug = kernel_ref.split("/", 1)
    ws = web_service_cls(token)
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
        metadata_fetcher = runtime_metadata_fn or get_kernel_runtime_metadata
        try:
            runtime_metadata = metadata_fetcher(
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
                output_extractor = extract_output_fn or extract_output_zip
                output_extractor(archive_bytes, outputs_path)

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
