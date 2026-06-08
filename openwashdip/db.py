"""Database engine, session factory, and schema bootstrap.

A single standalone Postgres (with PostGIS) is the canonical store. The app reads
DATABASE_URL from the environment (.env), so pointing at a remote Postgres later is a
one-line change. PostGIS gives us a real geometry type + spatial index, so the "map"
view is just a query over the same standardized tables — not a separate pipeline.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://openwashdip:openwashdip@localhost:5432/openwashdip",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    """Enable PostGIS and create tables. Idempotent — safe to call on every startup."""
    from .models import Base  # imported here to avoid a circular import at module load

    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
    Base.metadata.create_all(engine)
    # Lightweight migration: add columns introduced after a DB was first created.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE records ADD COLUMN IF NOT EXISTS country varchar(8)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_records_country ON records (country)"))


def get_session():
    """FastAPI dependency: yield a session, always close it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
