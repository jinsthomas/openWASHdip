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

import csv
import io
import pathlib
import re
from datetime import datetime, timedelta, timezone

from fastapi import Body, Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
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
    # rest-points sources need a records_path; other kinds (e.g. worldpop-grid) don't.
    if config.get("kind", "rest-points") == "rest-points" and not config.get("records_path"):
        raise HTTPException(status_code=400, detail="config.records_path is required")

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

def _csv_response(rows: list[dict], filename: str) -> Response:
    """Serialize a list of dict rows as a downloadable CSV (union of keys, first-seen order)."""
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/sources/{sid}/records", tags=["views"])
def api_records(
    sid: int, limit: int = 500, offset: int = 0, format: str = "json",
    db: Session = Depends(get_session),
):
    """Standardized rows. `format=csv` returns a downloadable CSV instead of JSON."""
    source = db.get(Source, sid)
    if not source:
        raise HTTPException(status_code=404, detail="no such source")
    total = db.scalar(select(func.count()).select_from(Record).where(Record.source_id == sid))
    rows = db.execute(
        select(
            Record.external_id,
            Record.country,
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
            "country": r.country,  # conformed dimension (ISO3 when the source provides it)
            "event_time": r.event_time.isoformat() if r.event_time else None,
            "lat": r.lat,
            "lon": r.lon,
            **(r.properties or {}),
        }
        for r in rows
    ]
    if format == "csv":
        return _csv_response(records, f"{source.slug}.csv")
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


@app.get("/api/runs/recent", tags=["views"])
def api_recent_runs(limit: int = 20, db: Session = Depends(get_session)) -> list[dict]:
    """Most recent sync runs across ALL sources — powers the dashboard's run feed."""
    rows = db.execute(
        select(SyncRun, Source.title, Source.slug)
        .join(Source, Source.id == SyncRun.source_id)
        .order_by(SyncRun.id.desc())
        .limit(min(limit, 100))
    ).all()
    return [
        {
            "source_id": run.source_id,
            "source": title,
            "slug": slug,
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "finished_at": run.finished_at.isoformat() if run.finished_at else None,
            "status": run.status,
            "row_count": run.row_count,
            "error": run.error,
        }
        for run, title, slug in rows
    ]


# --- Unified cross-source views -------------------------------------------------
# The conformed dimensions every record shares: source, country, time. These let us
# query/chart/map ALL loaded sources together.

def _unified_where(source: int | None, country: str | None, year: str | None, params: dict) -> str:
    # Dense grid layers (e.g. WorldPop) are a heatmap, not comparable point records — exclude
    # them from the unified record views so they don't swamp the cross-source comparison.
    clauses = ["s.kind <> 'worldpop-grid'"]
    if source:
        clauses.append("r.source_id = :u_source")
        params["u_source"] = source
    if country:
        clauses.append("r.country = :u_country")
        params["u_country"] = country
    if year:
        clauses.append("to_char(r.event_time, 'YYYY') = :u_year")
        params["u_year"] = year
    return " WHERE " + " AND ".join(clauses)


@app.get("/api/unified/filters", tags=["unified"])
def api_unified_filters(db: Session = Depends(get_session)) -> dict:
    sources = [
        {"id": s.id, "title": s.title}
        for s in db.scalars(select(Source).where(Source.kind != "worldpop-grid").order_by(Source.title)).all()
    ]
    countries = [r[0] for r in db.execute(text(
        "SELECT DISTINCT r.country FROM records r JOIN sources s ON s.id=r.source_id "
        "WHERE r.country IS NOT NULL AND s.kind <> 'worldpop-grid' ORDER BY 1"
    )).all()]
    years = [r[0] for r in db.execute(text(
        "SELECT DISTINCT to_char(event_time,'YYYY') y FROM records WHERE event_time IS NOT NULL ORDER BY y DESC"
    )).all()]
    return {"sources": sources, "countries": countries, "years": years}


@app.get("/api/unified/summary", tags=["unified"])
def api_unified_summary(db: Session = Depends(get_session)) -> dict:
    row = db.execute(text(
        "SELECT count(*) recs, count(DISTINCT r.source_id) srcs, count(DISTINCT r.country) ctys, "
        "min(r.event_time) tmin, max(r.event_time) tmax FROM records r JOIN sources s ON s.id=r.source_id "
        "WHERE s.kind <> 'worldpop-grid'"
    )).one()
    return {
        "records": row.recs, "sources": row.srcs, "countries": row.ctys,
        "time_min": row.tmin.isoformat() if row.tmin else None,
        "time_max": row.tmax.isoformat() if row.tmax else None,
    }


@app.get("/api/unified/records", tags=["unified"])
def api_unified_records(
    source: int | None = None, country: str | None = None, year: str | None = None,
    limit: int = 500, offset: int = 0, format: str = "json",
    db: Session = Depends(get_session),
):
    """Conformed cross-source table: source · country · time · location · id.

    `format=csv` returns a downloadable CSV instead of JSON.
    """
    params: dict = {"lim": min(limit, 5000), "off": offset}
    where = _unified_where(source, country, year, params)
    total = db.execute(text(
        f"SELECT count(*) FROM records r JOIN sources s ON s.id = r.source_id{where}"
    ), params).scalar()
    rows = db.execute(text(
        "SELECT s.title AS source, r.country, r.event_time, r.external_id, "
        "ST_Y(r.geom) AS lat, ST_X(r.geom) AS lon "
        f"FROM records r JOIN sources s ON s.id = r.source_id{where} "
        "ORDER BY r.event_time DESC NULLS LAST, r.id DESC LIMIT :lim OFFSET :off"
    ), params).all()
    records = [
        {"source": r.source, "country": r.country,
         "event_time": r.event_time.isoformat() if r.event_time else None,
         "external_id": r.external_id, "lat": r.lat, "lon": r.lon}
        for r in rows
    ]
    if format == "csv":
        return _csv_response(records, "openwashdip-all-data.csv")
    return {"total": total, "records": records}


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


# --- Drought monitoring -----------------------------------------------------------
# A focused view over a "drought-openmeteo" source: per-location latest soil moisture +
# recent rainfall vs evapotranspiration, distilled into an indicative dryness index.

def _drought_status(score: int) -> str:
    if score >= 70:
        return "Severe"
    if score >= 45:
        return "Moderate"
    if score >= 25:
        return "Watch"
    return "Normal"


def _clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def _dryness_index(window: list[dict]) -> tuple[int, float | None]:
    """Indicative dryness index (0-100) over a window of daily records: 60% topsoil-moisture
    dryness + 40% water-balance deficit (ET0 - precipitation). Returns (score, latest soil)."""
    soil_vals = [p["soil_moisture"] for p in window if p.get("soil_moisture") is not None]
    soil = soil_vals[-1] if soil_vals else None
    precip = sum((p.get("precipitation_mm") or 0) for p in window)
    et0 = sum((p.get("et0_mm") or 0) for p in window)
    sm_score = _clamp01((0.30 - soil) / 0.30) if soil is not None else 0.0
    deficit_score = _clamp01((et0 - precip) / 120.0)
    return round(100 * (0.6 * sm_score + 0.4 * deficit_score)), soil


def _linfit(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Ordinary least-squares fit y = slope*x + intercept."""
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denom = n * sxx - sx * sx
    if denom == 0:
        return 0.0, (sy / n if n else 0.0)
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def _daily_index_series(by_loc: dict, window: int) -> dict:
    """For each date, the region-average dryness index computed over a trailing window."""
    per_date: dict = {}
    for days in by_loc.values():
        for i in range(len(days)):
            w = days[max(0, i - window + 1):i + 1]
            idx, _ = _dryness_index(w)
            d = days[i].get("date")
            if d:
                per_date.setdefault(d, []).append(idx)
    return {d: sum(v) / len(v) for d, v in per_date.items() if v}


@app.get("/api/drought/forecast", tags=["drought"])
def api_drought_forecast(
    location: str | None = None, horizon: int = 14, window: int = 14,
    db: Session = Depends(get_session),
) -> dict:
    """Fit a least-squares trend to the rolling drought index and project it forward.

    Returns the index history + a `horizon`-day forecast with an uncertainty band and the
    dates it is projected to cross Moderate (45) / Severe (70). A transparent, explainable
    model — not a black box — suitable for an early-warning lead time.
    """
    src = db.scalars(
        select(Source).where(Source.kind == "drought-openmeteo").order_by(Source.id.desc())
    ).first()
    if not src:
        return {"source_id": None, "history": [], "forecast": [], "locations": []}

    rows = db.execute(text(
        "SELECT properties FROM records WHERE source_id = :sid ORDER BY event_time"
    ), {"sid": src.id}).all()
    by_loc: dict = {}
    for (props,) in rows:
        if location and props.get("location") != location:
            continue
        by_loc.setdefault(props.get("location") or "—", []).append(props)
    for days in by_loc.values():
        days.sort(key=lambda p: p.get("date") or "")

    daily = _daily_index_series(by_loc, window)
    today = datetime.now(timezone.utc).date().isoformat()
    series = sorted(daily.items())
    history = [(d, round(v, 1)) for d, v in series if d <= today]
    loc_names = [l["name"] for l in (src.config.get("locations") or [])]

    if len(history) < 5:
        return {"source_id": src.id, "history": [{"date": d, "index": v} for d, v in history],
                "forecast": [], "locations": loc_names,
                "location": location or "All locations (region avg)"}

    fit = history[-min(21, len(history)):]
    xs = [float(i) for i in range(len(fit))]
    ys = [v for _, v in fit]
    slope, intercept = _linfit(xs, ys)
    resid = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    sd = (sum(r * r for r in resid) / max(1, len(resid) - 2)) ** 0.5

    # The fitted trend over the fit window, so the dashed forecast visibly continues the fit.
    trend_fit = [
        {"date": fit[i][0], "index": round(min(100.0, max(0.0, intercept + slope * xs[i])), 1)}
        for i in range(len(fit))
    ]

    last_date = datetime.fromisoformat(history[-1][0])
    last_x = xs[-1]
    forecast = []
    for h in range(1, horizon + 1):
        yhat = min(100.0, max(0.0, intercept + slope * (last_x + h)))
        band = 1.5 * sd + 0.8 * h  # widen with horizon
        forecast.append({
            "date": (last_date + timedelta(days=h)).date().isoformat(),
            "index": round(yhat, 1),
            "lo": round(max(0.0, yhat - band), 1),
            "hi": round(min(100.0, yhat + band), 1),
        })

    def _first_cross(thr: int):
        if history[-1][1] >= thr:
            return None  # already there
        for f in forecast:
            if f["index"] >= thr:
                return f["date"]
        return None

    proj = forecast[-1]["index"] if forecast else history[-1][1]
    return {
        "source_id": src.id,
        "location": location or "All locations (region avg)",
        "locations": loc_names,
        "today": today, "window": window, "horizon": horizon,
        "model": "Least-squares linear trend on the trailing 21-day drought index",
        "slope_per_day": round(slope, 2),
        "now_index": history[-1][1],
        "proj_index": proj,
        "proj_status": _drought_status(round(proj)),
        "crosses": {"Moderate": _first_cross(45), "Severe": _first_cross(70)},
        "history": [{"date": d, "index": v} for d, v in history],
        "trend_fit": trend_fit,
        "forecast": forecast,
    }


@app.get("/api/drought/overview", tags=["drought"])
def api_drought_overview(db: Session = Depends(get_session)) -> dict:
    """Compute the drought dashboard from the latest 'drought-openmeteo' source's records.

    Indicative index (0-100), NOT an official SPI: 60% topsoil-moisture dryness + 40%
    30-day water-balance deficit (ET0 − precipitation).
    """
    src = db.scalars(
        select(Source).where(Source.kind == "drought-openmeteo").order_by(Source.id.desc())
    ).first()
    if not src:
        return {"source_id": None, "locations": [], "series": [], "alerts": [], "summary": None}

    rows = db.execute(text(
        "SELECT event_time, properties FROM records WHERE source_id = :sid ORDER BY event_time"
    ), {"sid": src.id}).all()

    today = datetime.now(timezone.utc).date().isoformat()

    by_loc: dict = {}
    series_acc: dict = {}
    for event_time, props in rows:
        loc = props.get("location") or "—"
        by_loc.setdefault(loc, []).append((event_time, props))
        day = props.get("date") or (event_time.date().isoformat() if event_time else None)
        if day:
            s = series_acc.setdefault(day, {"precip": [], "soil": []})
            if props.get("precipitation_mm") is not None:
                s["precip"].append(props["precipitation_mm"])
            if props.get("soil_moisture") is not None:
                s["soil"].append(props["soil_moisture"])

    locations = []
    for loc, items in by_loc.items():
        items.sort(key=lambda x: x[0] or datetime.min.replace(tzinfo=timezone.utc))
        days = [p for _, p in items]
        observed = [p for p in days if (p.get("date") or "") <= today] or days
        last7 = observed[-7:]

        # "Now" — current conditions from the last 30 OBSERVED days.
        cur30 = observed[-30:]
        score, soil = _dryness_index(cur30)
        precip_7d = round(sum((p.get("precipitation_mm") or 0) for p in last7), 1)
        precip_30d = round(sum((p.get("precipitation_mm") or 0) for p in cur30), 1)
        et0_30d = round(sum((p.get("et0_mm") or 0) for p in cur30), 1)
        wb_30d = round(precip_30d - et0_30d, 1)

        # Outlook — re-run the index over a 30-day window that rolls in the 7-day FORECAST
        # (Open-Meteo) and drops the oldest observed days. The delta is the predicted trend.
        out30 = days[-30:]
        outlook_score, _ = _dryness_index(out30)
        delta = outlook_score - score
        trend = "Worsening" if delta >= 5 else "Improving" if delta <= -5 else "Stable"
        fc = [p for p in days if (p.get("date") or "") > today]
        forecast_precip_7d = round(sum((p.get("precipitation_mm") or 0) for p in fc), 1)

        locations.append({
            "location": loc,
            "country": None,  # filled from the source config below (lat/lon/iso3)
            "lat": None, "lon": None,
            "soil_moisture": soil,
            "precip_7d": precip_7d,
            "precip_30d": precip_30d,
            "et0_30d": et0_30d,
            "water_balance_30d": wb_30d,
            "score": score,
            "status": _drought_status(score),
            # Predictive outlook
            "outlook_score": outlook_score,
            "outlook_status": _drought_status(outlook_score),
            "outlook_delta": delta,
            "trend": trend,
            "forecast_precip_7d": forecast_precip_7d,
        })

    # lat/lon/country aren't in properties uniformly — pull them from the source config.
    cfg_locs = {l["name"]: l for l in (src.config.get("locations") or [])}
    for d in locations:
        cl = cfg_locs.get(d["location"])
        if cl:
            d["lat"], d["lon"], d["country"] = cl["lat"], cl["lon"], cl["iso3"]

    locations.sort(key=lambda d: d["score"], reverse=True)
    series = [
        {"date": day,
         "precip": round(sum(v["precip"]) / len(v["precip"]), 2) if v["precip"] else 0,
         "soil_moisture": round(sum(v["soil"]) / len(v["soil"]), 3) if v["soil"] else None,
         "forecast": day > today}
        for day, v in sorted(series_acc.items())
    ]

    soils = [d["soil_moisture"] for d in locations if d["soil_moisture"] is not None]
    summary = {
        "locations": len(locations),
        "region": "Madagascar & Angola",
        "as_of": today,
        "forecast_days": sum(1 for p in series if p["forecast"]),
        "driest": locations[0] if locations else None,
        "avg_soil_moisture": round(sum(soils) / len(soils), 3) if soils else None,
        "in_deficit": sum(1 for d in locations if d["water_balance_30d"] < 0),
        "alerts_count": sum(1 for d in locations if d["status"] in ("Severe", "Moderate")),
        "worsening": sum(1 for d in locations if d["trend"] == "Worsening"),
        "improving": sum(1 for d in locations if d["trend"] == "Improving"),
    }
    alerts = [
        {"location": d["location"], "country": d["country"], "status": d["status"],
         "trend": d["trend"], "outlook_status": d["outlook_status"],
         "detail": f"soil moisture {d['soil_moisture']} m³/m³ · 30-day balance {d['water_balance_30d']} mm · "
                   f"7-day outlook: {d['trend'].lower()}"
                   + (f" → {d['outlook_status']}" if d["outlook_status"] != d["status"] else "")}
        for d in locations if d["status"] in ("Severe", "Moderate") or d["trend"] == "Worsening"
    ]
    return {"source_id": src.id, "summary": summary, "locations": locations,
            "series": series, "alerts": alerts}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    # The Vite asset filenames are content-hashed (safe to cache forever), but index.html
    # points at them — it must NOT be cached, or browsers keep loading a stale bundle after
    # a rebuild. no-store guarantees you always get HTML referencing the newest assets.
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store, must-revalidate"},
    )


# Built Vite assets (index-*.js / *.css). check_dir=False: dir appears after the first build.
app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets", check_dir=False), name="assets")
