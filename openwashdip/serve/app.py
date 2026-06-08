"""openWASHdip web app — an open-source data integrator.

The flow the UI showcases:
  paste an API URL -> AI proposes a field mapping -> you confirm -> pull -> standardized
  table (Postgres) -> schedule a recurring re-sync -> view as a table or (when geo) a map.

Endpoints
  GET  /                          -> single-page wizard UI
  POST /api/propose               -> fetch a sample of an API + propose a mapping spec
  GET  /api/sources               -> list integrated sources + sync status
  POST /api/sources               -> create a source from a confirmed mapping (+ sync now)
  POST /api/sources/{id}/sync     -> run a sync now
  PATCH /api/sources/{id}         -> set schedule (interval_minutes) / enabled
  DELETE /api/sources/{id}        -> remove a source and its rows
  GET  /api/sources/{id}/records  -> standardized rows (the Table view)
  GET  /api/sources/{id}/geojson  -> rows with geometry as GeoJSON (the Map view)
  GET  /api/sources/{id}/runs     -> sync history
  GET  /healthz
"""

from __future__ import annotations

import pathlib
import re

from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .. import ai
from ..db import get_session, init_db
from ..ingest import pull_records, sync_source
from ..models import Record, Source, SyncRun
from ..scheduler import schedule_source, start as start_scheduler, unschedule_source

STATIC_DIR = pathlib.Path(__file__).parent / "static"
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")

app = FastAPI(title="openWASHdip", description="Open-source data integrator (API -> standardized table -> views).")


@app.on_event("startup")
def _startup() -> None:
    init_db()
    start_scheduler()


@app.get("/healthz", tags=["meta"])
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/catalog", tags=["wizard"])
def api_catalog() -> list[dict]:
    """Curated standard sources — verified presets the UI loads onto the canvas."""
    from ..presets import CATALOG

    return CATALOG


# --- AI wizard: sample + propose -------------------------------------------------

@app.post("/api/propose", tags=["wizard"])
def api_propose(payload: dict = Body(...)) -> dict:
    """Fetch a sample of the API and propose a mapping spec for the user to confirm."""
    url = (payload.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url must be an http(s) URL")
    params = payload.get("params") or {}
    try:
        sample = ai.fetch_sample(url, params)
    except ValueError as exc:  # our own friendly messages (e.g. "this is a docs page")
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - surface upstream/network errors to the UI
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}")
    return {"sample": sample, "proposal": ai.propose_mapping(url, sample, params)}


@app.post("/api/discover", tags=["wizard"])
def api_discover(payload: dict = Body(...)) -> dict:
    """Heuristic (A): from a docs/base URL, find + verify candidate API endpoints."""
    from ..discovery import discover

    url = (payload.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Enter an http(s) URL or domain to search.")
    return {"candidates": discover(url)}


@app.post("/api/verify", tags=["wizard"])
def api_verify(payload: dict = Body(...)) -> dict:
    """Verify a list of candidate URLs (B): the WebLLM suggester checks its guesses here."""
    from ..discovery import verify_many

    return {"candidates": verify_many(payload.get("urls") or [])}


@app.post("/api/preview", tags=["wizard"])
def api_preview(payload: dict = Body(...)) -> dict:
    """Pull a few normalized rows for a config WITHOUT persisting — the Map preview."""
    config = payload.get("config") or {}
    limit = int(config.pop("_limit", 5) or 5)
    if not config.get("lat_path") or not config.get("lon_path"):
        # Preview still works without geometry; only records_path is essential.
        config.setdefault("lat_path", "")
        config.setdefault("lon_path", "")
    try:
        rows = pull_records(config, limit=limit)
    except Exception as exc:  # noqa: BLE001 - surface upstream errors to the UI
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}")
    records = [
        {"external_id": r["external_id"], "lat": r["lat"], "lon": r["lon"], **(r["properties"] or {})}
        for r in rows
    ]
    return {"count": len(records), "records": records}


# --- Sources CRUD ----------------------------------------------------------------

def _source_dict(s: Source) -> dict:
    return {
        "id": s.id,
        "slug": s.slug,
        "title": s.title,
        "kind": s.kind,
        "config": s.config,
        "interval_minutes": s.interval_minutes,
        "enabled": s.enabled,
        "last_synced_at": s.last_synced_at.isoformat() if s.last_synced_at else None,
        "last_status": s.last_status,
        "last_row_count": s.last_row_count,
    }


@app.get("/api/sources", tags=["sources"])
def api_list_sources(db: Session = Depends(get_session)) -> list[dict]:
    return [_source_dict(s) for s in db.scalars(select(Source).order_by(Source.id)).all()]


@app.post("/api/sources", tags=["sources"])
def api_create_source(payload: dict = Body(...), db: Session = Depends(get_session)) -> dict:
    """Create a source from a confirmed mapping, schedule it, and run an initial sync."""
    slug = (payload.get("slug") or "").strip().lower()
    if not _SLUG.match(slug):
        raise HTTPException(status_code=400, detail="slug must be a lowercase slug (a-z, 0-9, '-')")
    if db.scalar(select(Source).where(Source.slug == slug)):
        raise HTTPException(status_code=409, detail=f"source '{slug}' already exists")
    config = payload.get("config") or {}
    for field in ("records_path", "lat_path", "lon_path"):
        if not config.get(field):
            raise HTTPException(status_code=400, detail=f"config.{field} is required")

    source = Source(
        slug=slug,
        title=payload.get("title") or slug,
        kind=config.get("kind", "rest-points"),
        config=config,
        interval_minutes=payload.get("interval_minutes"),
        enabled=True,
    )
    db.add(source)
    db.commit()
    schedule_source(source)
    sync_source(db, source)  # initial pull so the user sees data immediately
    return _source_dict(db.get(Source, source.id))


@app.patch("/api/sources/{sid}", tags=["sources"])
def api_update_source(sid: int, payload: dict = Body(...), db: Session = Depends(get_session)) -> dict:
    source = db.get(Source, sid)
    if not source:
        raise HTTPException(status_code=404, detail="no such source")
    if "interval_minutes" in payload:
        source.interval_minutes = payload["interval_minutes"] or None
    if "enabled" in payload:
        source.enabled = bool(payload["enabled"])
    db.commit()
    schedule_source(source)
    return _source_dict(source)


@app.post("/api/sources/{sid}/sync", tags=["sources"])
def api_sync_now(sid: int, db: Session = Depends(get_session)) -> dict:
    source = db.get(Source, sid)
    if not source:
        raise HTTPException(status_code=404, detail="no such source")
    run = sync_source(db, source)
    return {"status": run.status, "row_count": run.row_count, "error": run.error}


@app.delete("/api/sources/{sid}", tags=["sources"])
def api_delete_source(sid: int, db: Session = Depends(get_session)) -> dict:
    source = db.get(Source, sid)
    if not source:
        return {"deleted": False}
    unschedule_source(sid)
    db.delete(source)
    db.commit()
    return {"deleted": True}


# --- Views: table + map ----------------------------------------------------------

@app.get("/api/sources/{sid}/records", tags=["views"])
def api_records(sid: int, limit: int = 500, offset: int = 0, db: Session = Depends(get_session)) -> dict:
    source = db.get(Source, sid)
    if not source:
        raise HTTPException(status_code=404, detail="no such source")
    total = db.scalar(select(func.count()).select_from(Record).where(Record.source_id == sid))
    rows = db.execute(
        select(
            Record.external_id,
            Record.event_time,
            Record.properties,
            func.ST_Y(Record.geom).label("lat"),
            func.ST_X(Record.geom).label("lon"),
        )
        .where(Record.source_id == sid)
        .order_by(Record.id)
        .limit(min(limit, 5000))
        .offset(offset)
    ).all()
    records = [
        {
            "external_id": r.external_id,
            "event_time": r.event_time.isoformat() if r.event_time else None,
            "lat": r.lat,
            "lon": r.lon,
            **(r.properties or {}),
        }
        for r in rows
    ]
    return {"total": total, "count": len(records), "records": records}


@app.get("/api/sources/{sid}/geojson", tags=["views"])
def api_geojson(sid: int, db: Session = Depends(get_session)) -> dict:
    rows = db.execute(
        select(
            Record.external_id,
            Record.properties,
            func.ST_AsGeoJSON(Record.geom).label("g"),
        ).where(Record.source_id == sid, Record.geom.isnot(None))
    ).all()
    import json

    features = [
        {
            "type": "Feature",
            "id": r.external_id,
            "geometry": json.loads(r.g),
            "properties": r.properties or {},
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


_AGGS = {"count", "sum", "avg", "min", "max"}
_BUCKETS = {"hour", "day", "week", "month", "quarter", "year"}
_FIXED = {  # built-in record columns -> SQL expression for grouping (text key)
    "external_id": "external_id",
    "event_time": "to_char(event_time, 'YYYY-MM-DD')",
    "lat": "round(ST_Y(geom)::numeric, 3)::text",
    "lon": "round(ST_X(geom)::numeric, 3)::text",
}


def _measure_expr(measure: str, params: dict) -> str:
    """Numeric SQL expression for a measure column (safe: property keys are bound params)."""
    if measure == "lat":
        return "ST_Y(geom)"
    if measure == "lon":
        return "ST_X(geom)"
    # JSONB property: only cast values that look numeric, so mixed columns don't error.
    params["meas"] = measure
    return "CASE WHEN (properties ->> :meas) ~ '^-?[0-9.]+$' THEN (properties ->> :meas)::double precision END"


@app.get("/api/sources/{sid}/aggregate", tags=["views"])
def api_aggregate(
    sid: int,
    dimension: str,
    agg: str = "count",
    measure: str | None = None,
    bucket: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_session),
) -> dict:
    """GROUP BY for the Charts tab. Aggregate `measure` (or row count) by `dimension`."""
    if agg not in _AGGS:
        raise HTTPException(status_code=400, detail=f"agg must be one of {sorted(_AGGS)}")
    params: dict = {"sid": sid, "limit": max(1, min(int(limit), 200))}

    # Dimension (the category / X axis).
    if dimension == "event_time" and bucket in _BUCKETS:
        dim_sql = f"to_char(date_trunc('{bucket}', event_time), 'YYYY-MM-DD')"
        order_sql = "key ASC"
    elif dimension in _FIXED:
        dim_sql = _FIXED[dimension]
        order_sql = "key ASC" if dimension == "event_time" else "value DESC"
    else:
        params["dim"] = dimension
        dim_sql = "(properties ->> :dim)"
        order_sql = "value DESC"

    # Value (the measure / Y axis).
    if agg == "count":
        val_sql = "COUNT(*)"
    else:
        if not measure:
            raise HTTPException(status_code=400, detail="measure is required for sum/avg/min/max")
        val_sql = f"{agg.upper()}({_measure_expr(measure, params)})"

    sql = text(
        f"SELECT {dim_sql} AS key, {val_sql} AS value FROM records "
        f"WHERE source_id = :sid GROUP BY 1 ORDER BY {order_sql} LIMIT :limit"
    )
    rows = db.execute(sql, params).all()
    data = [
        {"key": (r.key if r.key is not None else "—"), "value": float(r.value) if r.value is not None else 0.0}
        for r in rows
    ]
    return {"dimension": dimension, "agg": agg, "measure": measure, "data": data}


@app.get("/api/sources/{sid}/runs", tags=["views"])
def api_runs(sid: int, limit: int = 20, db: Session = Depends(get_session)) -> list[dict]:
    runs = db.scalars(
        select(SyncRun).where(SyncRun.source_id == sid).order_by(SyncRun.id.desc()).limit(limit)
    ).all()
    return [
        {
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "status": r.status,
            "row_count": r.row_count,
            "error": r.error,
        }
        for r in runs
    ]


# --- Unified cross-source views -------------------------------------------------
# The conformed dimensions every record shares: source, country, time. These let us
# query/chart/map ALL loaded sources together.

def _unified_where(source: int | None, country: str | None, year: str | None, params: dict) -> str:
    clauses = []
    if source:
        clauses.append("r.source_id = :u_source")
        params["u_source"] = source
    if country:
        clauses.append("r.country = :u_country")
        params["u_country"] = country
    if year:
        clauses.append("to_char(r.event_time, 'YYYY') = :u_year")
        params["u_year"] = year
    return (" WHERE " + " AND ".join(clauses)) if clauses else ""


@app.get("/api/unified/filters", tags=["unified"])
def api_unified_filters(db: Session = Depends(get_session)) -> dict:
    sources = [{"id": s.id, "title": s.title} for s in db.scalars(select(Source).order_by(Source.title)).all()]
    countries = [r[0] for r in db.execute(text("SELECT DISTINCT country FROM records WHERE country IS NOT NULL ORDER BY 1")).all()]
    years = [r[0] for r in db.execute(text(
        "SELECT DISTINCT to_char(event_time,'YYYY') y FROM records WHERE event_time IS NOT NULL ORDER BY y DESC"
    )).all()]
    return {"sources": sources, "countries": countries, "years": years}


@app.get("/api/unified/summary", tags=["unified"])
def api_unified_summary(db: Session = Depends(get_session)) -> dict:
    row = db.execute(text(
        "SELECT count(*) recs, count(DISTINCT source_id) srcs, count(DISTINCT country) ctys, "
        "min(event_time) tmin, max(event_time) tmax FROM records"
    )).one()
    return {
        "records": row.recs, "sources": row.srcs, "countries": row.ctys,
        "time_min": row.tmin.isoformat() if row.tmin else None,
        "time_max": row.tmax.isoformat() if row.tmax else None,
    }


@app.get("/api/unified/records", tags=["unified"])
def api_unified_records(
    source: int | None = None, country: str | None = None, year: str | None = None,
    limit: int = 500, offset: int = 0, db: Session = Depends(get_session),
) -> dict:
    """Conformed cross-source table: source · country · time · location · id."""
    params: dict = {"lim": min(limit, 5000), "off": offset}
    where = _unified_where(source, country, year, params)
    total = db.execute(text(f"SELECT count(*) FROM records r{where}"), params).scalar()
    rows = db.execute(text(
        "SELECT s.title AS source, r.country, r.event_time, r.external_id, "
        "ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon "
        f"FROM records r JOIN sources s ON s.id = r.source_id{where} "
        "ORDER BY r.event_time DESC NULLS LAST, r.id DESC LIMIT :lim OFFSET :off"
    ), params).all()
    return {"total": total, "records": [
        {"source": r.source, "country": r.country,
         "event_time": r.event_time.isoformat() if r.event_time else None,
         "external_id": r.external_id, "lat": r.lat, "lon": r.lon}
        for r in rows
    ]}


_UNIFIED_DIMS = {
    "source": "s.title", "country": "r.country",
    "year": "to_char(r.event_time, 'YYYY')", "month": "to_char(r.event_time, 'YYYY-MM')",
}


@app.get("/api/unified/aggregate", tags=["unified"])
def api_unified_aggregate(
    dimension: str = "source", source: int | None = None, country: str | None = None,
    year: str | None = None, limit: int = 30, db: Session = Depends(get_session),
) -> dict:
    """Count records across all sources, grouped by a conformed dimension."""
    if dimension not in _UNIFIED_DIMS:
        raise HTTPException(status_code=400, detail=f"dimension must be one of {sorted(_UNIFIED_DIMS)}")
    params: dict = {"lim": min(limit, 100)}
    where = _unified_where(source, country, year, params)
    expr = _UNIFIED_DIMS[dimension]
    order = "key ASC" if dimension in ("year", "month") else "value DESC"
    rows = db.execute(text(
        f"SELECT {expr} AS key, count(*) AS value FROM records r JOIN sources s ON s.id = r.source_id"
        f"{where} GROUP BY 1 ORDER BY {order} LIMIT :lim"
    ), params).all()
    return {"dimension": dimension, "data": [
        {"key": r.key if r.key is not None else "—", "value": int(r.value)} for r in rows
    ]}


@app.get("/api/unified/geojson", tags=["unified"])
def api_unified_geojson(
    source: int | None = None, country: str | None = None, year: str | None = None,
    db: Session = Depends(get_session),
) -> dict:
    import json

    params: dict = {}
    where = _unified_where(source, country, year, params)
    geom_clause = " AND r.geom IS NOT NULL" if where else " WHERE r.geom IS NOT NULL"
    rows = db.execute(text(
        "SELECT s.title AS source, r.country, ST_AsGeoJSON(r.geom) AS g "
        f"FROM records r JOIN sources s ON s.id = r.source_id{where}{geom_clause} LIMIT 5000"
    ), params).all()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": json.loads(r.g), "properties": {"source": r.source, "country": r.country}}
        for r in rows
    ]}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


# Built Vite assets (index-*.js / *.css). check_dir=False: dir appears after the first build.
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets", check_dir=False), name="assets")
