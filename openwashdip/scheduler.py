"""Recurring sync — APScheduler backed by the same Postgres.

Jobs persist in a Postgres job-store, so schedules survive app restarts (no Redis /
Celery broker needed). Each source with `interval_minutes` set gets one job that calls
`run_sync_job(source_id)` on that cadence. Changing or clearing the interval reschedules
or removes the job. "Run now" from the UI calls `run_sync_job` directly.
"""

from __future__ import annotations

from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.schedulers.background import BackgroundScheduler

from .db import DATABASE_URL, SessionLocal
from .ingest import sync_source
from .models import Source

# APScheduler's SQLAlchemy job-store uses a sync driver; psycopg3 works as "postgresql+psycopg".
scheduler = BackgroundScheduler(
    jobstores={"default": SQLAlchemyJobStore(url=DATABASE_URL)},
    job_defaults={"coalesce": True, "max_instances": 1, "misfire_grace_time": 300},
)


def _job_id(source_id: int) -> str:
    return f"sync-source-{source_id}"


def run_sync_job(source_id: int) -> None:
    """Module-level entry point referenced by persisted jobs; opens its own session."""
    db = SessionLocal()
    try:
        source = db.get(Source, source_id)
        if source and source.enabled:
            sync_source(db, source)
    finally:
        db.close()


def schedule_source(source: Source) -> None:
    """Create/replace this source's recurring job, or remove it if no interval is set."""
    jid = _job_id(source.id)
    if source.interval_minutes and source.enabled:
        scheduler.add_job(
            run_sync_job,
            trigger="interval",
            minutes=int(source.interval_minutes),
            args=[source.id],
            id=jid,
            replace_existing=True,
        )
    else:
        unschedule_source(source.id)


def unschedule_source(source_id: int) -> None:
    if scheduler.get_job(_job_id(source_id)):
        scheduler.remove_job(_job_id(source_id))


def start() -> None:
    if not scheduler.running:
        scheduler.start()
