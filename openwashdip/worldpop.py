"""Ingest WorldPop 1km population grids as a coarse point grid (no raster/GDAL deps).

WorldPop's 1km product is an ASCII XYZ CSV (lon, lat, population per 1km cell), shipped
as a zip. We download it, bin it to a coarser grid (default ~0.1° ≈ 11 km) summing
population, and emit point records — so it fits the standard table + map model and renders
as a population heatmap. One sub-entry per country (each country-tagged).
"""

from __future__ import annotations

import csv
import io
import os
import zipfile
from typing import Optional

import requests

from .ai import BROWSER_HEADERS

CACHE = os.environ.get("OPENWASHDIP_CACHE", "/tmp/openwashdip-cache")


def _download(url: str) -> bytes:
    """Download (and cache) the WorldPop zip — they're a few MB and reused on re-sync."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.rsplit("/", 1)[-1])
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, "rb") as fh:
            return fh.read()
    r = requests.get(url, headers=BROWSER_HEADERS, timeout=180)
    r.raise_for_status()
    with open(path, "wb") as fh:
        fh.write(r.content)
    return r.content


def _bin_country(zip_bytes: bytes, iso3: str, year, bin_deg: float) -> list[dict]:
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    cells: dict[tuple, float] = {}
    with z.open(z.namelist()[0]) as f:
        reader = csv.reader(io.TextIOWrapper(f, encoding="utf-8"))
        next(reader, None)  # header: X,Y,Z
        for row in reader:
            if len(row) < 3:
                continue
            try:
                lon, lat, val = float(row[0]), float(row[1]), float(row[2])
            except ValueError:
                continue
            if val <= 0:
                continue
            key = (round(round(lon / bin_deg) * bin_deg, 4), round(round(lat / bin_deg) * bin_deg, 4))
            cells[key] = cells.get(key, 0.0) + val
    return [
        {
            "external_id": f"{iso3}-{lon}-{lat}",
            "lat": lat,
            "lon": lon,
            "event_time": None,
            "country": iso3,
            "properties": {"population": round(pop), "year": year},
        }
        for (lon, lat), pop in cells.items()
    ]


def pull_worldpop_grid(config: dict, limit: Optional[int] = None) -> list[dict]:
    """Download + bin each country's 1km grid into population point-cells."""
    bin_deg = float(config.get("bin_deg", 0.1))
    year = config.get("year")
    out: list[dict] = []
    for c in config.get("countries", []):
        out.extend(_bin_country(_download(c["url"]), c["iso3"], year, bin_deg))
        if limit and len(out) >= limit:
            break
    return out[:limit] if limit else out
