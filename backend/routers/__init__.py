"""
Routers registry for FastAPI application.
"""

from fastapi import FastAPI

from .archives import router as archives_router
from .archive_jobs import router as archive_jobs_router
from .archive_study import router as archive_study_router
from .auto_archive import router as auto_archive_router
from .competitions import router as competitions_router
from .health import router as health_router
from .kernels import router as kernels_router
from .notifications import router as notifications_router
from .simulation_monitor import router as simulation_monitor_router
from .submission_monitor import router as submission_monitor_router


def register_routers(app: FastAPI) -> None:
    """Register all modular APIRouters to the FastAPI application."""
    app.include_router(health_router)
    app.include_router(competitions_router)
    app.include_router(kernels_router)
    app.include_router(archive_jobs_router)
    app.include_router(archive_study_router)
    app.include_router(archives_router)
    app.include_router(notifications_router)
    app.include_router(auto_archive_router)
    app.include_router(submission_monitor_router)
    app.include_router(simulation_monitor_router)
