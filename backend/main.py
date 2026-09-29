from __future__ import annotations

import asyncio
import hmac
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Add parent to path for local imports
sys.path.insert(0, str(Path(__file__).parent))

from harvester.archiver import Archiver
from harvester.auto_archive import AutoArchiveManager
from harvester.cache import (
    PersistentActiveCompetitionStore,
    PersistentCompetitionCache,
    PersistentEnteredCompetitionsCache,
    PersistentKernelMetadataCache,
    PersistentKernelQueryCache,
    PersistentKernelScoreCache,
    PersistentSimulationEpisodeStore,
    resolve_active_competition,
)
from harvester.kaggle_client import KaggleClient
from harvester.models import ArchiverConfig
from harvester.notifications import NotificationManager
from harvester.simulation_monitor import SimulationMonitorManager
from harvester.submission_monitor import SubmissionMonitorManager
from routers import register_routers

# Re-exports for test and module backwards compatibility
from routers.kernels import (
    SCORE_INDEX_REFRESH_SECONDS,
    _build_kernel_snapshot,
    _redact_runtime_metadata,
    _refresh_kernel_snapshot_in_background,
    _schedule_kernel_snapshot_refresh,
    list_kernels,
)

LOGGER = logging.getLogger("kaggle-harvester")


class ApiKeyMiddleware(BaseHTTPMiddleware):
    """在显式配置访问密钥后保护全部 API 接口。"""

    def __init__(self, app, api_key: str = "") -> None:
        super().__init__(app)
        self.api_key = api_key.strip()

    async def dispatch(self, request: Request, call_next):
        if (
            self.api_key
            and request.url.path.startswith("/api")
            and not request.url.path.endswith("/chart.png")
            and not request.url.path.endswith("/trajectory-chart.png")
        ):
            supplied = request.headers.get("X-Harvester-Key", "")
            if not hmac.compare_digest(supplied, self.api_key):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "访问密钥无效或未提供。"},
                    headers={"X-Harvester-Auth": "required"},
                )
        return await call_next(request)


def _allowed_origins() -> list[str]:
    configured = os.environ.get("HARVESTER_ALLOWED_ORIGINS", "")
    if configured.strip():
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://127.0.0.1:5173", "http://localhost:5173"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load .env file
    load_dotenv(Path(__file__).parent / ".env")

    harvest_root = os.environ.get("HARVEST_ROOT", "harvested_kernels")
    app.state.active_competition_store = PersistentActiveCompetitionStore(harvest_root)
    app.state.entered_competitions_cache = PersistentEnteredCompetitionsCache(
        harvest_root
    )
    competition_slug, _ = resolve_active_competition(
        store=app.state.active_competition_store,
        entered_cache=app.state.entered_competitions_cache,
        env_default=os.environ.get("KAGGLE_COMPETITION"),
    )
    app.state.simulation_episode_store = PersistentSimulationEpisodeStore(harvest_root)
    app.state.kaggle_client = KaggleClient(
        competition_slug=competition_slug,
        episode_store=app.state.simulation_episode_store,
    )
    app.state.kernel_query_cache = PersistentKernelQueryCache(harvest_root)
    app.state.kernel_score_cache = PersistentKernelScoreCache(harvest_root)
    app.state.kernel_metadata_cache = PersistentKernelMetadataCache(harvest_root)
    app.state.competition_cache = PersistentCompetitionCache(harvest_root)
    app.state.kernel_refresh_tasks = {}
    config = ArchiverConfig(
        harvest_root=harvest_root,
        min_free_bytes=int(
            os.environ.get("HARVESTER_MIN_FREE_BYTES", str(2 * 1024 * 1024 * 1024))
        ),
    )
    app.state.archiver = Archiver(app.state.kaggle_client, config=config)
    app.state.notifications = NotificationManager(harvest_root)
    app.state.auto_archive = AutoArchiveManager(
        app.state.kaggle_client,
        app.state.archiver,
        harvest_root=harvest_root,
        default_competition=competition_slug,
        notification_manager=app.state.notifications,
    )
    app.state.submission_monitor = SubmissionMonitorManager(
        app.state.kaggle_client,
        harvest_root=harvest_root,
        default_competition=competition_slug,
        notification_manager=app.state.notifications,
    )
    app.state.simulation_monitor = SimulationMonitorManager(
        app.state.kaggle_client,
        harvest_root=harvest_root,
        default_competition=competition_slug or "pokemon-tcg-ai-battle",
        notification_manager=app.state.notifications,
        episode_store=app.state.simulation_episode_store,
    )
    await app.state.notifications.start()
    await app.state.auto_archive.start()
    await app.state.submission_monitor.start()
    await app.state.simulation_monitor.start()
    try:
        yield
    finally:
        refresh_tasks = list(app.state.kernel_refresh_tasks.values())
        for task in refresh_tasks:
            task.cancel()
        if refresh_tasks:
            await asyncio.gather(*refresh_tasks, return_exceptions=True)
        await app.state.simulation_monitor.stop()
        await app.state.submission_monitor.stop()
        await app.state.auto_archive.stop()
        await app.state.notifications.stop()


app = FastAPI(
    title="Kaggle Open Kernel Harvester",
    description="Scrape, browse, and archive open-source Kaggle kernels with scores.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    ApiKeyMiddleware,
    api_key=os.environ.get("HARVESTER_API_KEY", ""),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Harvester-Key"],
)

# Register modular routers
register_routers(app)


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    host = os.environ.get("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=False)
