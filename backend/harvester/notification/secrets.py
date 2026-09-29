from __future__ import annotations

import base64
import ctypes
import ctypes.wintypes
import json
import os
import threading
from pathlib import Path
from typing import Optional


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _dpapi_transform(data: bytes, protect: bool) -> bytes:
    if os.name != "nt":
        raise RuntimeError("当前系统不支持 Windows DPAPI。")
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    input_blob = _DataBlob(
        len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
    )
    output_blob = _DataBlob()
    flags = 0x01  # CRYPTPROTECT_UI_FORBIDDEN
    if protect:
        success = ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(input_blob),
            "Kaggle Harvester Notifications",
            None,
            None,
            None,
            flags,
            ctypes.byref(output_blob),
        )
    else:
        success = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(input_blob),
            None,
            None,
            None,
            None,
            flags,
            ctypes.byref(output_blob),
        )
    if not success:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(output_blob.pbData)


class NotificationSecretStore:
    """在 Windows 上使用当前用户 DPAPI 保存通知凭据。"""

    ENVIRONMENT_KEYS = {
        "webhook_url": "HARVESTER_NOTIFICATION_WEBHOOK_URL",
        "smtp_password": "HARVESTER_NOTIFICATION_SMTP_PASSWORD",
    }

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()
        self._values: dict[str, str] = {}
        self._load()

    @property
    def storage_mode(self) -> str:
        if any(os.environ.get(name) for name in self.ENVIRONMENT_KEYS.values()):
            return "environment"
        return "windows_dpapi" if os.name == "nt" else "file"

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = base64.b64decode(self._path.read_bytes(), validate=True)
            if os.name == "nt":
                payload = json.loads(_dpapi_transform(raw, False))
            else:
                payload = json.loads(raw.decode("utf-8"))
            if isinstance(payload, dict):
                self._values = {
                    str(key): str(value)
                    for key, value in payload.items()
                    if value
                }
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            self._values = {}

    def get(self, key: str) -> str:
        environment_name = self.ENVIRONMENT_KEYS.get(key)
        if environment_name and os.environ.get(environment_name):
            return os.environ[environment_name]
        with self._lock:
            return self._values.get(key, "")

    def update(self, values: dict[str, Optional[str]]) -> None:
        with self._lock:
            for key, value in values.items():
                if value:
                    self._values[key] = value
                else:
                    self._values.pop(key, None)
            self._path.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps(self._values, ensure_ascii=False).encode("utf-8")
            if os.name == "nt":
                blob = base64.b64encode(_dpapi_transform(payload, True))
            else:
                # Linux/容器无法使用 DPAPI；至少落盘，避免容器重启丢凭据。
                # 生产环境仍推荐用环境变量注入。
                blob = base64.b64encode(payload)
            temp_path = self._path.with_suffix(".tmp")
            temp_path.write_bytes(blob)
            try:
                os.chmod(temp_path, 0o600)
            except OSError:
                pass
            temp_path.replace(self._path)
