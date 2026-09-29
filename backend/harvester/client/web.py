"""
Kaggle internal web service client for RPCs under /api/i.
"""

from __future__ import annotations

import httpx

KAGGLE_WEB_BASE = "https://www.kaggle.com/api/i"
VIEW_MODEL = "kernels.LegacyKernelsService/GetKernelViewModel"
LIST_VERSIONS = "kernels.KernelsService/ListKernelVersions"


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
