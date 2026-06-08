"""Propose a field mapping for a pasted API URL — the interactive "AI" step.

Flow the UI drives:
  1. user pastes an API URL
  2. `fetch_sample()` does a GET and returns a small slice of the JSON
  3. `propose_mapping()` inspects that sample and proposes the mapping spec
     (records_path, id/lat/lon/time paths, property_paths) for the user to confirm/edit
  4. the confirmed spec becomes a Source.config and feeds ingest.pull_records()

Two proposers, same output shape:
  * heuristic — pure-Python pattern matching; no key, no network beyond the sample.
    Always available, so the demo works offline / fully open-source.
  * llm — optional; if OPENWASHDIP_LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY are set,
    asks Claude to fill the same schema. Pluggable: swap for any model / self-hosted.
"""

from __future__ import annotations

import json
import os
import re
from typing import Optional

import requests

# Many public APIs reject the bare python-requests UA with 403; present a browser-like one.
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 openWASHdip/0.2",
    "Accept": "application/json, */*",
}

# Field-name hints for the heuristic proposer.
_LAT_KEYS = ("lat", "latitude", "y")
_LON_KEYS = ("lon", "lng", "long", "longitude", "x")
_ID_KEYS = ("id", "uid", "code", "key", "name")
_TIME_KEYS = ("time", "date", "timestamp", "datetime", "updated", "created")
_COUNTRY_KEYS = ("iso3", "iso_a3", "adm0_a3", "gid_0", "country_id", "country_code", "countrycode", "iso", "country", "admin0", "nation")


def fetch_sample(url: str, params: Optional[dict] = None, max_records: int = 3) -> dict:
    """GET the URL and return {full(trimmed), candidates} for proposing + preview."""
    r = requests.get(url, params=params or {}, headers=BROWSER_HEADERS, timeout=30)
    r.raise_for_status()
    try:
        data = r.json()
    except ValueError:
        ctype = r.headers.get("content-type", "")
        raise ValueError(
            f"This URL returned {ctype or 'non-JSON'} — looks like a web/docs page, not a data API. "
            "Paste the actual API endpoint that returns JSON records (not a documentation page)."
        )
    arrays = _find_record_arrays(data)
    preview = {path: arr[:max_records] for path, arr in arrays}
    return {"record_arrays": [p for p, _ in arrays], "preview": preview}


def _find_record_arrays(data, prefix: str = "", out=None):
    """Locate arrays-of-objects in the JSON; their dotted paths are records_path candidates."""
    if out is None:
        out = []
    if isinstance(data, list):
        if data and isinstance(data[0], dict):
            out.append((prefix or ".", data))
    elif isinstance(data, dict):
        for k, v in data.items():
            _find_record_arrays(v, f"{prefix}.{k}" if prefix else k, out)
    return out


def _flatten_keys(obj, prefix="", out=None):
    """Dotted paths to every leaf in a sample record (lists index into [0])."""
    if out is None:
        out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            _flatten_keys(v, f"{prefix}.{k}" if prefix else k, out)
    elif isinstance(obj, list):
        if obj:
            _flatten_keys(obj[0], f"{prefix}.0" if prefix else "0", out)
    else:
        out[prefix] = obj
    return out


def _match(paths: list[str], keys: tuple[str, ...]) -> Optional[str]:
    for key in keys:
        for p in paths:
            leaf = p.split(".")[-1].lower()
            if leaf == key:
                return p
    for key in keys:  # looser contains-match as a fallback
        for p in paths:
            if key in p.split(".")[-1].lower():
                return p
    return None


def propose_mapping(url: str, sample: dict, params: Optional[dict] = None) -> dict:
    """Return a proposed mapping spec. Uses the LLM if configured, else the heuristic."""
    arrays = sample.get("record_arrays") or []
    records_path = arrays[0] if arrays else "."
    example = (sample.get("preview") or {}).get(records_path) or []
    record = example[0] if example else {}
    paths = list(_flatten_keys(record).keys())

    if os.environ.get("OPENWASHDIP_LLM_PROVIDER") == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return _propose_llm(url, sample, params)
        except Exception:  # noqa: BLE001 - fall back to heuristic if the LLM call fails
            pass

    lat = _match(paths, _LAT_KEYS)
    lon = _match(paths, _LON_KEYS)
    # GeoJSON convention: geometry.coordinates = [lon, lat].
    coord = next((p for p in paths if p.endswith("coordinates.0")), None)
    if coord and not lon:
        lon = coord
        lat = coord[:-1] + "1"
    country = _match(paths, _COUNTRY_KEYS)

    return {
        "kind": "rest-points",
        "request": {"url": url, "params": params or {}},
        "records_path": records_path,
        "id_path": _match(paths, _ID_KEYS),
        "lat_path": lat,
        "lon_path": lon,
        "time_path": _match(paths, _TIME_KEYS),
        "country_path": country,
        "property_paths": {
            p.split(".")[-1]: p for p in paths if p not in {lat, lon, country} and "coordinates" not in p
        },
        "_proposer": "heuristic",
        "_field_candidates": paths,
    }


def _propose_llm(url: str, sample: dict, params: Optional[dict]) -> dict:
    """Ask Claude to fill the mapping schema from the sample record."""
    import anthropic

    model = os.environ.get("OPENWASHDIP_LLM_MODEL", "claude-sonnet-4-6")
    client = anthropic.Anthropic()
    schema_hint = {
        "records_path": "dotted path to the array of records",
        "id_path": "dotted path to a stable unique id (or null)",
        "lat_path": "dotted path to latitude",
        "lon_path": "dotted path to longitude",
        "time_path": "dotted path to a timestamp (or null)",
        "property_paths": {"<column_name>": "<dotted path>"},
    }
    prompt = (
        "You map an API's JSON into a flat table. Dotted paths may index lists, e.g. "
        "'geometry.coordinates.1'. Given this sample, return ONLY a JSON object with keys: "
        f"{list(schema_hint)}. Sample:\n{json.dumps(sample.get('preview'), default=str)[:6000]}"
    )
    msg = client.messages.create(
        model=model, max_tokens=1024, messages=[{"role": "user", "content": prompt}]
    )
    txt = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
    spec = json.loads(re.search(r"\{.*\}", txt, re.S).group(0))
    spec.update({"kind": "rest-points", "request": {"url": url, "params": params or {}}, "_proposer": "llm"})
    return spec
