"""
Kaggle CLI execution helpers with UTF-8 wrapping and credential support.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

UTF8_WRAPPER_NAME = "Invoke-KaggleUtf8.ps1"


def locate_utf8_wrapper(module_file: str | Path) -> Path:
    """逐级查找 Windows Kaggle UTF-8 包装脚本，兼容浅层容器路径。"""
    module_path = Path(module_file).resolve()
    for parent in module_path.parents:
        candidate = parent / "scripts" / UTF8_WRAPPER_NAME
        if candidate.exists():
            return candidate
    # Linux 不使用该脚本；返回稳定的缺失路径供 readiness 展示即可。
    return module_path.parent / UTF8_WRAPPER_NAME


def run_kaggle(
    args: list[str],
    *,
    utf8_wrapper: Path,
    token: str = "",
    timeout: int = 120,
) -> tuple[str, str]:
    """Run a kaggle CLI command, return (stdout, stderr)."""
    if shutil.which("kaggle") is None:
        raise RuntimeError("未找到 Kaggle CLI，请先安装 kaggle Python 包。")

    if os.name == "nt":
        if not utf8_wrapper.exists():
            raise RuntimeError(
                f"缺少 UTF-8 Kaggle 包装脚本：{utf8_wrapper}"
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
            str(utf8_wrapper),
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
    if token:
        env["KAGGLE_API_TOKEN"] = token
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


def run_kaggle_json(
    args: list[str],
    *,
    utf8_wrapper: Path,
    token: str = "",
    timeout: int = 120,
) -> list[dict]:
    """Run a kaggle CLI command and parse JSON output."""
    stdout, _ = run_kaggle(
        args,
        utf8_wrapper=utf8_wrapper,
        token=token,
        timeout=timeout,
    )
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
