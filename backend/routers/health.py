from __future__ import annotations

import os
from fastapi import APIRouter, Request, Response

from harvester.archiver import Archiver
from harvester.auto_archive import AutoArchiveManager
from harvester.cache import (
    PersistentActiveCompetitionStore,
    PersistentCompetitionCache,
    PersistentEnteredCompetitionsCache,
    PersistentKernelMetadataCache,
    PersistentKernelQueryCache,
    PersistentKernelScoreCache,
    resolve_active_competition,
)
from harvester.kaggle_client import KaggleClient
from harvester.notifications import NotificationManager
from harvester.simulation_monitor import SimulationMonitorManager
from harvester.submission_monitor import SubmissionMonitorManager

router = APIRouter(tags=["System"])


@router.get("/api/health")
def health(request: Request, response: Response):
    """Dashboard readiness; local filesystem work runs in FastAPI's thread pool."""
    response.headers["Cache-Control"] = "no-store"
    app = request.app
    client: KaggleClient = app.state.kaggle_client
    archiver: Archiver = app.state.archiver
    query_cache: PersistentKernelQueryCache = app.state.kernel_query_cache
    score_cache: PersistentKernelScoreCache = app.state.kernel_score_cache
    metadata_cache: PersistentKernelMetadataCache = app.state.kernel_metadata_cache
    competition_cache: PersistentCompetitionCache = app.state.competition_cache
    entered_cache: PersistentEnteredCompetitionsCache = (
        app.state.entered_competitions_cache
    )
    auto_archive: AutoArchiveManager = app.state.auto_archive
    submission_monitor: SubmissionMonitorManager = app.state.submission_monitor
    simulation_monitor: SimulationMonitorManager = app.state.simulation_monitor
    notifications: NotificationManager = app.state.notifications
    active_store: PersistentActiveCompetitionStore = app.state.active_competition_store

    current_slug, current_source = resolve_active_competition(
        store=active_store,
        entered_cache=entered_cache,
        env_default=os.environ.get("KAGGLE_COMPETITION"),
    )
    readiness = client.readiness()
    readiness["default_competition"] = current_slug
    ready = bool(
        readiness["kaggle_cli"]
        and (os.name != "nt" or readiness["utf8_wrapper_exists"])
    )
    return {
        "status": "ok" if ready else "degraded",
        "service": "kaggle-harvester",
        "version": app.version,
        "ready": ready,
        **readiness,
        "active_competition": {
            "competition": current_slug,
            "source": current_source,
            "is_pinned": current_source == "pinned",
            "pinned_competition": active_store.get(),
        },
        "archive": archiver.get_stats(),
        "cache": {
            **query_cache.stats(),
            **score_cache.stats(),
            **metadata_cache.stats(),
            **competition_cache.stats(),
            **entered_cache.stats(),
        },
        "auto_archive": auto_archive.health_status(),
        "submission_monitor": submission_monitor.health_status(),
        "simulation_monitor": simulation_monitor.health_status(),
        "notifications": notifications.health_status(),
    }


@router.get("/api/live")
async def live(response: Response):
    """Authenticated process liveness, independent of disk and external services."""
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok", "service": "kaggle-harvester"}
