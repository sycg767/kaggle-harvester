from __future__ import annotations

import json
import os
import socket
import time
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

    _clawbot_status_cache: tuple[float, SimulationClawbotStatus] | None = None

    @staticmethod
    def probe_gateway(host: str, port: int, timeout: float = 0.05) -> bool:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            return False

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
        now = time.time()
        if not force and cls._clawbot_status_cache is not None:
            cached_time, cached_status = cls._clawbot_status_cache
            if now - cached_time < 30.0:
                return cached_status

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
                    break
                except Exception:
                    pass

        # 2. 提取配置信息
        provider_name = None
        base_url = os.getenv("OPENCLAW_LLM_BASE_URL")
        model_name = os.getenv("OPENCLAW_LLM_MODEL")
        updated_at = None
        gateway_port = int(os.getenv("OPENCLAW_GATEWAY_PORT", "18789"))
        gateway_url = os.getenv("OPENCLAW_GATEWAY_URL")
        configured = bool(os.getenv("OPENCLAW_LLM_API_KEY") or cfg_data)

        if cfg_data:
            providers = cfg_data.get("models", {}).get("providers", {})
            if providers:
                provider_name = next(iter(providers.keys()))
                if not base_url:
                    base_url = providers.get(provider_name, {}).get("baseUrl")
            primary_model = cfg_data.get("agents", {}).get("defaults", {}).get("model", {}).get("primary")
            if primary_model and not model_name:
                model_name = primary_model.split("/")[-1]
            updated_at = cfg_data.get("meta", {}).get("lastTouchedAt")
            gw = cfg_data.get("gateway", {})
            if "port" in gw and not os.getenv("OPENCLAW_GATEWAY_PORT"):
                try:
                    gateway_port = int(gw["port"])
                except (ValueError, TypeError):
                    pass

        if not provider_name:
            if base_url and "tokenrhythm" in base_url.lower():
                provider_name = "TokenRhythm Studio"
            elif base_url:
                provider_name = "Custom Provider"

        if not model_name and configured:
            model_name = "deepseek-v4-flash-0731"

        # 3. 真实在线探测
        is_online = False
        active_gateway = None

        if gateway_url:
            try:
                parsed = urllib.parse.urlparse(gateway_url)
                host = parsed.hostname or "127.0.0.1"
                port = parsed.port or gateway_port
                if cls.probe_gateway(host, port):
                    is_online = True
                    active_gateway = gateway_url
            except Exception:
                pass

        if not is_online:
            candidate_hosts = ["127.0.0.1", "localhost", "host.docker.internal", "172.17.0.1"]
            docker_host = cls.get_docker_host_ip()
            if docker_host and docker_host not in candidate_hosts:
                candidate_hosts.append(docker_host)

            for host in candidate_hosts:
                if cls.probe_gateway(host, gateway_port):
                    is_online = True
                    active_gateway = f"http://{host}:{gateway_port}"
                    break

        res = SimulationClawbotStatus(
            enabled=is_online,
            is_online=is_online,
            configured=configured,
            provider=provider_name,
            model=model_name,
            base_url=base_url,
            gateway_url=active_gateway or (gateway_url or f"http://127.0.0.1:{gateway_port}"),
            updated_at=updated_at,
        )
        cls._clawbot_status_cache = (now, res)
        return res

    @classmethod
    def test_gateway(cls) -> SimulationClawbotTestResult:
        status = cls.get_status()
        gateway_port = int(os.getenv("OPENCLAW_GATEWAY_PORT", "18789"))
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
            f"成功连接至 OpenClaw 网关 ({first_success_url})，微信长连接已就绪！"
            if success
            else "未能连接至任何候选 OpenClaw 网关 (端口 18789)。请确认 OpenClaw 网关是否已在宿主机或容器中运行 (openclaw gateway run)。"
        )

        return SimulationClawbotTestResult(
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
