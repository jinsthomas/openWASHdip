"""Canonical schema — the standardized form every integrated source lands in.

Three tables tell the whole story of the platform:

  Source   — one integrated data source: the API to call + the AI-confirmed mapping
             that turns its records into standardized rows, plus its sync schedule.
  Record   — the standardized output. Every source, however shaped upstream, becomes
             rows of {external_id, time, geometry?, properties(JSONB)}. This *is* the
             "standardized table"; the Table view reads it directly and the Map view is
             just the rows whose geom is non-null.
  SyncRun  — one execution of a source's pull (for history / status in the UI).
"""

from __future__ import annotations

from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(256))
    kind: Mapped[str] = mapped_column(String(32), default="rest-points")
    # The AI-confirmed mapping spec: request{url,params,headers}, records_path,
    # id_path, lat_path, lon_path, property_paths{name->path}.
    config: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Schedule: an APScheduler interval in minutes (None = manual only).
    interval_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    records: Mapped[list["Record"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", passive_deletes=True
    )
    runs: Mapped[list["SyncRun"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", passive_deletes=True
    )


class Record(Base):
    __tablename__ = "records"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_record_source_external"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    external_id: Mapped[str] = mapped_column(String(256))
    event_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Conformed dimension: ISO3 (or code/name) so records can be sliced across sources.
    country: Mapped[str | None] = mapped_column(String(8), nullable=True, index=True)
    # PostGIS point in EPSG:4326; null for non-spatial sources (still shown in the table).
    geom: Mapped[object | None] = mapped_column(
        Geometry(geometry_type="POINT", srid=4326), nullable=True
    )
    properties: Mapped[dict] = mapped_column(JSONB, default=dict)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    source: Mapped["Source"] = relationship(back_populates="records")


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    source: Mapped["Source"] = relationship(back_populates="runs")
