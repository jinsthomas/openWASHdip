"""Drought monitoring via Open-Meteo (keyless, no API key).

For each configured location we pull daily precipitation, reference evapotranspiration
(ET0), max temperature, and (hourly, averaged to daily) topsoil moisture. Each (location,
day) becomes one standard record with a real `event_time`, so it fits the canonical table
+ map model and supports time-series. These are the core meteorological drought indicators:
a rainfall deficit against atmospheric demand (ET0), plus how wet the soil actually is.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import requests

from .ai import BROWSER_HEADERS

API = "https://api.open-meteo.com/v1/forecast"


def _daily_soil_moisture(hourly: dict) -> dict:
    """Average hourly soil_moisture_0_to_7cm into a per-day mean keyed by YYYY-MM-DD."""
    times = (hourly or {}).get("time") or []
    vals = (hourly or {}).get("soil_moisture_0_to_7cm") or []
    acc: dict = {}
    for t, v in zip(times, vals):
        if v is None:
            continue
        acc.setdefault(t[:10], []).append(v)
    return {day: round(sum(xs) / len(xs), 3) for day, xs in acc.items() if xs}


def _pull_location(loc: dict, past_days: int, forecast_days: int) -> list[dict]:
    params = {
        "latitude": loc["lat"],
        "longitude": loc["lon"],
        "daily": "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max",
        "hourly": "soil_moisture_0_to_7cm",
        "past_days": past_days,
        "forecast_days": forecast_days,
        "timezone": "auto",
    }
    r = requests.get(API, params=params, headers=BROWSER_HEADERS, timeout=60)
    r.raise_for_status()
    d = r.json()
    daily = d.get("daily") or {}
    days = daily.get("time") or []
    precip = daily.get("precipitation_sum") or []
    et0 = daily.get("et0_fao_evapotranspiration") or []
    tmax = daily.get("temperature_2m_max") or []
    soil = _daily_soil_moisture(d.get("hourly"))
    iso3, name = loc["iso3"], loc["name"]

    out: list[dict] = []
    for i, day in enumerate(days):
        p = precip[i] if i < len(precip) else None
        e = et0[i] if i < len(et0) else None
        water_balance = round(p - e, 2) if (p is not None and e is not None) else None
        out.append({
            "external_id": f"{iso3}-{name}-{day}".replace(" ", "_"),
            "lat": loc["lat"],
            "lon": loc["lon"],
            "event_time": datetime.fromisoformat(day).replace(tzinfo=timezone.utc),
            "country": iso3,
            "properties": {
                "location": name,
                "date": day,
                "precipitation_mm": p,
                "et0_mm": e,
                "water_balance_mm": water_balance,
                "soil_moisture": soil.get(day),
                "temp_max_c": tmax[i] if i < len(tmax) else None,
            },
        })
    return out


def pull_drought(config: dict, limit: Optional[int] = None) -> list[dict]:
    """One Open-Meteo call per location; emit a record per (location, day)."""
    past = int(config.get("past_days", 60))
    forecast = int(config.get("forecast_days", 7))
    out: list[dict] = []
    for loc in config.get("locations", []):
        out.extend(_pull_location(loc, past, forecast))
        if limit and len(out) >= limit:
            break
    return out[:limit] if limit else out
