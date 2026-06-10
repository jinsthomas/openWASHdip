"""Pull a source's API and normalize its records into the standardized `records` table.

This is the trusted, spec-driven interpreter — the AI never produces code, only a
mapping `config` (dotted paths into the API's JSON), which this one audited function
executes. No eval/exec, so no arbitrary-code-execution risk on an open platform.

Supported `kind`: "rest-points" — an HTTP GET returning a JSON array of records, each
carrying a lat/lon (directly or via a dotted path). Records become standardized rows;
those with coordinates also get a PostGIS point, which is what the Map view reads.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

import requests
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models import Record, Source, SyncRun


def _dig(obj, path: str):
    """Resolve a dotted path with list-index support, e.g. 'geometry.coordinates.1'."""
    cur = obj
    for part in str(path).split("."):
        if cur is None:
            return None
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _norm_country(value) -> Optional[str]:
    """Normalize a country value: ISO3-ish codes upper-cased, names left as-is."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s.upper() if len(s) <= 3 else s[:8]


def _coerce_time(value) -> Optional[datetime]:
    """Best-effort parse of a record's time field (ISO string or epoch ms/seconds)."""
    if value is None:
        return None
    try:
        s = str(value).strip()
        # Bare 4-digit year (e.g. World Bank's "2022") -> Jan 1 of that year, so annual
        # datasets get a real event_time and the time dimension/charts work.
        if len(s) == 4 and s.isdigit() and 1500 <= int(s) <= 2500:
            return datetime(int(s), 1, 1, tzinfo=timezone.utc)
        if isinstance(value, (int, float)):
            secs = value / 1000.0 if value > 1e11 else float(value)
            return datetime.fromtimestamp(secs, tz=timezone.utc)
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, OSError, OverflowError):
        return None


def _passes(props: dict, flt: dict) -> bool:
    """Apply one filter {field, op, value} to a record's properties."""
    left = props.get(flt.get("field"))
    if left is None:
        return False
    op, raw = flt.get("op"), flt.get("value")
    if op == "contains":
        return str(raw).lower() in str(left).lower()
    try:  # numeric comparison when both sides parse as numbers, else string
        a, b = float(left), float(raw)
    except (TypeError, ValueError):
        a, b = str(left), str(raw)
    return {">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b, "==": a == b}.get(op, True)


_UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 openWASHdip/0.2",
    "Accept": "application/json, */*",
}


def _fetch_raw(sess: requests.Session, config: dict, request: dict) -> list:
    """GET one request and resolve its records array via the shared records_path."""
    headers = {**_UA, **dict(request.get("headers") or {})}
    r = sess.get(request["url"], params=dict(request.get("params") or {}), headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json()
    rp = config.get("records_path") or "."
    raw = data if rp in (".", "") else (_dig(data, rp) or [])  # "." = the response IS the array
    return raw if isinstance(raw, list) else []


def _map_records(config: dict, raw: list, country_const: Optional[str], limit: Optional[int]) -> list[dict]:
    """Map raw records to normalized rows using the shared field mapping."""
    filters = config.get("filters") or []
    time_path = config.get("time_path")
    country_path = config.get("country_path")
    out: list[dict] = []
    for i, rec in enumerate(raw):
        props = {k: _dig(rec, p) for k, p in (config.get("property_paths") or {}).items()}
        if filters and not all(_passes(props, f) for f in filters):
            continue
        lat = _dig(rec, config["lat_path"])
        lon = _dig(rec, config["lon_path"])
        ext_id = _dig(rec, config["id_path"]) if config.get("id_path") else i
        country = country_const or (_norm_country(_dig(rec, country_path)) if country_path else None)
        out.append({
            "external_id": str(ext_id),
            "lat": float(lat) if lat is not None else None,
            "lon": float(lon) if lon is not None else None,
            "event_time": _coerce_time(_dig(rec, time_path)) if time_path else None,
            "country": country,
            "properties": props,
        })
        if limit and len(out) >= limit:
            break
    return out


def pull_records(
    config: dict, session: Optional[requests.Session] = None, limit: Optional[int] = None
) -> list[dict]:
    """Fetch the API(s) and map each record to a normalized dict (no DB writes here).

    A source is usually one `config["request"]`. A multi-country source instead lists
    several `config["requests"]`, each with its own `country_const` — they all share the
    same field mapping and merge into one country-tagged dataset. Honors `config["filters"]`
    and an optional `limit` (used by the preview endpoint).
    """
    sess = session or requests.Session()
    requests_list = config.get("requests")

    if requests_list:
        out: list[dict] = []
        for j, request in enumerate(requests_list):
            if j:
                time.sleep(1.0)  # be gentle on shared public APIs (e.g. Overpass)
            cc = request.get("country_const") or config.get("country_const")
            remaining = (limit - len(out)) if limit else None
            raw = _fetch_raw(sess, config, request)
            out.extend(_map_records(config, raw, _norm_country(cc) if cc else None, remaining))
            if limit and len(out) >= limit:
                break
        return out

    cc = config.get("country_const")
    raw = _fetch_raw(sess, config, config.get("request", {}))
    return _map_records(config, raw, _norm_country(cc) if cc else None, limit)


def pull(config: dict, session: Optional[requests.Session] = None, limit: Optional[int] = None) -> list[dict]:
    """Dispatch to the right puller based on the source kind."""
    if config.get("kind") == "worldpop-grid":
        from .worldpop import pull_worldpop_grid

        return pull_worldpop_grid(config, limit=limit)
    if config.get("kind") == "drought-openmeteo":
        from .drought import pull_drought

        return pull_drought(config, limit=limit)
    return pull_records(config, session=session, limit=limit)


def sync_source(db: Session, source: Source) -> SyncRun:
    """Run one full sync: pull, replace this source's rows, update status + history."""
    run = SyncRun(source_id=source.id, status="running")
    db.add(run)
    db.commit()

    try:
        rows = pull(source.config)
        # Replace strategy: clear prior rows for this source, then insert the fresh pull.
        db.execute(delete(Record).where(Record.source_id == source.id))
        for row in rows:
            geom = None
            if row["lat"] is not None and row["lon"] is not None:
                geom = f"SRID=4326;POINT({row['lon']} {row['lat']})"
            db.add(
                Record(
                    source_id=source.id,
                    external_id=row["external_id"],
                    event_time=row["event_time"],
                    country=row.get("country"),
                    geom=geom,
                    properties=row["properties"],
                )
            )
        run.status = "ok"
        run.row_count = len(rows)
        run.finished_at = datetime.now(timezone.utc)
        source.last_status = "ok"
        source.last_row_count = len(rows)
        source.last_synced_at = run.finished_at
        db.commit()
    except Exception as exc:  # noqa: BLE001 - surface upstream/network errors as run state
        db.rollback()
        run = db.get(SyncRun, run.id)
        run.status = "error"
        run.error = f"{type(exc).__name__}: {exc}"
        run.finished_at = datetime.now(timezone.utc)
        source.last_status = "error"
        source.last_synced_at = run.finished_at
        db.commit()
    return run
