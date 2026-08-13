from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from main import ApiKeyMiddleware


def _build_client(api_key: str) -> TestClient:
    app = FastAPI()
    app.add_middleware(ApiKeyMiddleware, api_key=api_key)

    @app.get("/api/example")
    async def example():
        return {"ok": True}

    @app.get("/public")
    async def public():
        return {"ok": True}

    return TestClient(app)


class ApiKeyMiddlewareTests(unittest.TestCase):
    def test_unconfigured_key_keeps_local_api_compatible(self) -> None:
        response = _build_client("").get("/api/example")
        self.assertEqual(response.status_code, 200)

    def test_missing_or_wrong_key_is_rejected(self) -> None:
        client = _build_client("expected")
        missing = client.get("/api/example")
        wrong = client.get("/api/example", headers={"X-Harvester-Key": "wrong"})
        self.assertEqual(missing.status_code, 401)
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(missing.headers["X-Harvester-Auth"], "required")

    def test_correct_key_and_non_api_route_are_allowed(self) -> None:
        client = _build_client("expected")
        protected = client.get(
            "/api/example", headers={"X-Harvester-Key": "expected"}
        )
        public = client.get("/public")
        self.assertEqual(protected.status_code, 200)
        self.assertEqual(public.status_code, 200)


if __name__ == "__main__":
    unittest.main()
