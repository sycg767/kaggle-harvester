from __future__ import annotations

import json
import os
import socket
import time
import threading
from datetime import datetime, timezone
import urllib.parse
from pathlib import Path
from typing import Any

from ..models import (
    SimulationClawbotStatus,
    SimulationClawbotTestCandidate,
    SimulationClawbotTestResult,
)


class ClawbotService:
    """WeChat ClawBot gateway diagnostic and probing helper."""


    @staticmethod
    def probe_gateway(host: str, port: int, timeout: float = 0.05) -> bool:
        # socket timeout excludes DNS resolution. Bound the whole manual probe;
        # daemon workers cannot prevent process shutdown if the resolver hangs.
        result = [False]
        def connect():
            try:
                with socket.create_connection((host, port), timeout=timeout):
                    result[0] = True
            except (socket.timeout, ConnectionRefusedError, OSError):
                pass
        worker = threading.Thread(target=connect, daemon=True)
        worker.start()
        worker.join(timeout)
        return result[0] if not worker.is_alive() else False

    @staticmethod
    def get_docker_host_ip() -> str | None:
        try:
            with open("/proc/net/route", "r", encoding="utf-8") as f:
                for line in f:
                    fields = line.strip().split()
                    if len(fields) >= 3 and fields[1] == "00000000":
                        val = int(fields[2], 16)
                        return f"{val & 0xFF}.{(val >> 8) & 0xFF}.{(val >> 16) & 0xFF}.{(val >> 24) & 0xFF}"
        except Exception:
            pass
        return None

    @classmethod
    def get_status(cls, force: bool = False) -> SimulationClawbotStatus:
        # 1. 尝试定位 openclaw.json 配置文件
        possible_paths: list[Path] = []
        custom_cfg = os.getenv("OPENCLAW_CONFIG_PATH")
        if custom_cfg:
            possible_paths.append(Path(custom_cfg))
        openclaw_home = os.getenv("OPENCLAW_HOME")
        if openclaw_home:
            possible_paths.append(Path(openclaw_home) / "openclaw.json")
        try:
            possible_paths.append(Path.home() / ".openclaw" / "openclaw.json")
        except Exception:
            pass
        possible_paths.extend([
            Path("/root/.openclaw/openclaw.json"),
            Path("/app/.openclaw/openclaw.json"),
            Path("data/.openclaw/openclaw.json"),
        ])

        cfg_data: dict[str, Any] | None = None
        for p in possible_paths:
            if p.is_file():
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        cfg_data = json.load(f)
                    if not isinstance(cfg_data, dict):
                        cfg_data = None
                        continue
                    break
                except Exception:
                    pass

        # 2. 提取配置信息
        provider_name = None
        base_url = os.getenv("OPENCLAW_LLM_BASE_URL")
        model_name = os.getenv("OPENCLAW_LLM_MODEL")
        updated_at = None
        try:
            gateway_port = int(os.getenv("OPENCLAW_GATEWAY_PORT", "18789"))
        except ValueError:
            gateway_port = 18789
        gateway_url = os.getenv("OPENCLAW_GATEWAY_URL")
        configured = bool(os.getenv("OPENCLAW_LLM_API_KEY") or cfg_data)

        def mapping(value):
            return value if isinstance(value, dict) else {}

        if cfg_data:
            providers = mapping(mapping(cfg_data.get("models")).get("providers"))
            if providers:
                provider_name = next(iter(providers.keys()))
                if not base_url:
                    base_url = mapping(providers.get(provider_name)).get("baseUrl")
            primary_model = mapping(mapping(mapping(cfg_data.get("agents")).get("defaults")).get("model")).get("primary")
            if isinstance(primary_model, str) and not model_name:
                model_name = primary_model.split("/")[-1]
            updated_at = mapping(cfg_data.get("meta")).get("lastTouchedAt")
            gw = mapping(cfg_data.get("gateway"))
            if "port" in gw and not os.getenv("OPENCLAW_GATEWAY_PORT"):
                try:
                    gateway_port = int(gw["port"])
                except (ValueError, TypeError):
                    pass

        base_url = base_url if isinstance(base_url, str) else None
        updated_at = updated_at if isinstance(updated_at, str) else None
        if not provider_name:
            if base_url and "tokenrhythm" in base_url.lower():
                provider_name = "TokenRhythm Studio"
            elif base_url:
                provider_name = "Custom Provider"

        snapshot, source, snapshot_error = cls.read_host_snapshot()
        fresh = source == "host_snapshot"
        def observed(key):
            value = snapshot.get(key)
            return value if fresh and type(value) is bool else None
        gateway_ok = observed("gateway_ok")
        snapshot_model = snapshot.get("model")
        if fresh and isinstance(snapshot_model, str) and snapshot_model.strip():
            model_name = snapshot_model[:200]

        res = SimulationClawbotStatus(
            enabled=gateway_ok is True,
            is_online=gateway_ok is True,
            gateway_ok=gateway_ok,
            wechat_configured=observed("wechat_configured"),
            wechat_running=observed("wechat_running"),
            business_api_ok=observed("business_api_ok"),
            delivery_configured=observed("delivery_configured"),
            checked_at=snapshot.get("checked_at") if isinstance(snapshot.get("checked_at"), str) else None,
            status_source=source,
            error=snapshot_error or (str(snapshot["error"])[:300] if snapshot.get("error") else None),
            configured=configured,
            provider=provider_name,
            model=model_name,
            base_url=base_url,
            gateway_url=gateway_url or f"http://127.0.0.1:{gateway_port}",
            updated_at=updated_at,
        )
        return res

    @staticmethod
    def read_host_snapshot():
        root = Path(os.getenv("HARVEST_ROOT", "harvested_kernels")).resolve()
        path = root / "_cache" / "clawbot_health.json"
        try:
            if not path.resolve().is_relative_to(root):
                return {}, "unknown", "宿主机状态文件路径无效"
            with path.open("rb") as handle:
                raw = handle.read(16385)
            if len(raw) > 16384:
                raise ValueError("snapshot too large")
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise ValueError("invalid snapshot")
            checked = datetime.fromisoformat(data["checked_at"].replace("Z", "+00:00"))
            if checked.tzinfo is None:
                raise ValueError("missing timezone")
            age = (datetime.now(timezone.utc) - checked).total_seconds()
            if not 0 <= age <= 90:
                return data, "stale", "宿主机状态已过期，微信状态未验证"
            return data, "host_snapshot", None
        except FileNotFoundError:
            return {}, "unknown", "尚无宿主机状态快照，微信状态未验证"
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            return {}, "unknown", "宿主机状态快照不可读，微信状态未验证"

    @classmethod
    def test_gateway(cls) -> SimulationClawbotTestResult:
        try:
            gateway_port = int(os.getenv("OPENCLAW_GATEWAY_PORT", "18789"))
        except ValueError:
            gateway_port = 18789
        gateway_url = os.getenv("OPENCLAW_GATEWAY_URL")

        targets: list[tuple[str, str, int]] = []
        if gateway_url:
            try:
                parsed = urllib.parse.urlparse(gateway_url)
                targets.append((gateway_url, parsed.hostname or "127.0.0.1", parsed.port or gateway_port))
            except Exception:
                pass

        targets.extend([
            (f"http://127.0.0.1:{gateway_port}", "127.0.0.1", gateway_port),
            (f"http://localhost:{gateway_port}", "localhost", gateway_port),
            (f"http://host.docker.internal:{gateway_port}", "host.docker.internal", gateway_port),
            (f"http://172.17.0.1:{gateway_port}", "172.17.0.1", gateway_port),
        ])

        docker_host = cls.get_docker_host_ip()
        if docker_host and docker_host not in ["127.0.0.1", "172.17.0.1"]:
            targets.append((f"http://{docker_host}:{gateway_port}", docker_host, gateway_port))

        candidates: list[SimulationClawbotTestCandidate] = []
        first_success_url: str | None = None
        first_latency: float | None = None

        seen_targets = set()
        for display_url, host, port in targets:
            if display_url in seen_targets:
                continue
            seen_targets.add(display_url)

            start = time.perf_counter()
            reachable = cls.probe_gateway(host, port, timeout=0.5)
            latency = round((time.perf_counter() - start) * 1000, 1)

            if reachable:
                detail = f"TCP 端口 {port} 握手成功 ({latency}ms)"
                if not first_success_url:
                    first_success_url = display_url
                    first_latency = latency
            else:
                detail = "连接失败 (Connection Refused 或超时)"

            candidates.append(
                SimulationClawbotTestCandidate(
                    target=display_url,
                    reachable=reachable,
                    latency_ms=latency if reachable else None,
                    detail=detail,
                )
            )

        success = bool(first_success_url)
        message = (
            f"网关 TCP 可达 ({first_success_url})；此结果不验证微信插件或消息投递。"
            if success
            else "应用到网关 TCP 不可达；网关仅监听宿主机本地时属于正常隔离，请以上方宿主机和微信插件状态为准。"
        )

        status = cls.get_status(force=True).model_copy(update={"gateway_reachable": success})
        return SimulationClawbotTestResult(
            status=status,
            success=success,
            message=message,
            active_url=first_success_url,
            latency_ms=first_latency,
            configured=status.configured,
            config_file_found=os.getenv("OPENCLAW_CONFIG_PATH") or (str(Path.home() / ".openclaw" / "openclaw.json") if (Path.home() / ".openclaw" / "openclaw.json").exists() else None),
            model=status.model,
            provider=status.provider,
            candidates=candidates,
        )
