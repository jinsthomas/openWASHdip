"""Curated catalog of standard data sources.

Each entry is a verified, ready-to-run mapping spec for a public, no-key JSON API that
returns records with coordinates. Picking one in the UI pre-fills the whole workflow
correctly — deterministic, no AI guessing — which is the reliable path for the known
WASH / hazard sources. The AI proposer remains for arbitrary long-tail APIs.

Field paths here were confirmed against each live API. `records_path: "."` means the
HTTP response itself is the array of records (e.g. Socrata).
"""

from __future__ import annotations

def _osm_preset(pid, name, country_name, iso3, area_code, osm_filters, category, kind_label):
    """Build an OpenStreetMap (Overpass) catalog entry scoped to one country.

    `osm_filters` are Overpass `node[...]` selectors; results are point features. The
    country isn't a field on each node, so we inject it as a constant (country_const).
    """
    nodes = "".join(f'node{f}(area.a);' for f in osm_filters)
    query = f'[out:json][timeout:90];area["ISO3166-1"="{area_code}"]->.a;({nodes});out center 500;'
    return {
        "id": pid,
        "name": name,
        "category": category,
        "description": f"OpenStreetMap {kind_label} in {country_name}, via the Overpass API (no key).",
        "slug": pid,
        "config": {
            "kind": "rest-points",
            "request": {"url": "https://overpass-api.de/api/interpreter", "params": {"data": query}},
            "records_path": "elements",
            "id_path": "id",
            "lat_path": "lat",
            "lon_path": "lon",
            "country_const": iso3,
            "property_paths": {
                "name": "tags.name", "amenity": "tags.amenity", "healthcare": "tags.healthcare",
                "man_made": "tags.man_made", "operator": "tags.operator",
            },
        },
    }


_WATER = ['["amenity"="drinking_water"]', '["man_made"="water_well"]', '["amenity"="water_point"]', '["man_made"="borehole"]']
_HEALTH = ['["amenity"="clinic"]', '["amenity"="hospital"]', '["amenity"="doctors"]', '["healthcare"~"hospital|clinic|centre|doctor|health"]']


def _osm_query(area_code: str, osm_filters: list[str]) -> str:
    nodes = "".join(f'node{f}(area.a);' for f in osm_filters)
    return f'[out:json][timeout:90];area["ISO3166-1"="{area_code}"]->.a;({nodes});out center 500;'


def _osm_multi_preset(pid, name, description, category, countries, osm_filters):
    """One source that pulls the same OSM layer for several countries, each country-tagged."""
    return {
        "id": pid, "name": name, "category": category, "description": description, "slug": pid,
        "config": {
            "kind": "rest-points",
            "requests": [
                {"url": "https://overpass-api.de/api/interpreter",
                 "params": {"data": _osm_query(area, osm_filters)}, "country_const": iso3}
                for iso3, area in countries
            ],
            "records_path": "elements", "id_path": "id", "lat_path": "lat", "lon_path": "lon",
            "property_paths": {
                "name": "tags.name", "amenity": "tags.amenity", "healthcare": "tags.healthcare",
                "man_made": "tags.man_made", "operator": "tags.operator",
            },
        },
    }


CATALOG: list[dict] = [
    _osm_multi_preset(
        "health-mdg-ago-osm", "Health facilities — Madagascar & Angola",
        "OpenStreetMap health facilities across Madagascar and Angola in one country-tagged dataset (Overpass, no key).",
        "Health", [("MDG", "MG"), ("AGO", "AO")], _HEALTH,
    ),
    _osm_multi_preset(
        "water-mdg-ago-osm", "Water points — Madagascar & Angola",
        "OpenStreetMap water points across Madagascar and Angola in one country-tagged dataset (Overpass, no key).",
        "WASH", [("MDG", "MG"), ("AGO", "AO")], _WATER,
    ),
    _osm_preset("mdg-water-osm", "Madagascar — Water points", "Madagascar", "MDG", "MG", _WATER, "WASH", "water points"),
    _osm_preset("mdg-health-osm", "Madagascar — Health facilities", "Madagascar", "MDG", "MG", _HEALTH, "Health", "health facilities"),
    _osm_preset("ago-health-osm", "Angola — Health facilities", "Angola", "AGO", "AO", _HEALTH, "Health", "health facilities"),
    {
        "id": "wpdx-water-points",
        "name": "WPDx — Water points",
        "category": "WASH",
        "description": "Water Point Data Exchange (WPdx+): water points with source type, technology, status and admin location.",
        "slug": "wpdx-water-points",
        "config": {
            "kind": "rest-points",
            "request": {
                "url": "https://data.waterpointdata.org/resource/eqje-vguj.json",
                "params": {"$limit": "500", "$order": "report_date DESC"},
            },
            "records_path": ".",
            "id_path": "row_id",
            "lat_path": "lat_deg",
            "lon_path": "lon_deg",
            "time_path": "report_date",
            "country_path": "clean_country_id",
            "property_paths": {
                "water_source": "water_source_clean",
                "category": "water_source_category",
                "technology": "water_tech_clean",
                "facility_type": "facility_type",
                "status": "status_id",
                "country": "clean_country_name",
                "adm1": "clean_adm1",
                "adm2": "clean_adm2",
                "install_year": "install_year",
            },
        },
    },
    {
        "id": "usgs-earthquakes",
        "name": "USGS — Earthquakes (M4+)",
        "category": "Hazard",
        "description": "USGS recent earthquakes, magnitude 4 and above, with location, magnitude and time.",
        "slug": "usgs-earthquakes",
        "config": {
            "kind": "rest-points",
            "request": {
                "url": "https://earthquake.usgs.gov/fdsnws/event/1/query",
                "params": {"format": "geojson", "limit": "200", "minmagnitude": "4"},
            },
            "records_path": "features",
            "id_path": "id",
            "lat_path": "geometry.coordinates.1",
            "lon_path": "geometry.coordinates.0",
            "time_path": "properties.time",
            "property_paths": {
                "magnitude": "properties.mag",
                "place": "properties.place",
                "type": "properties.type",
                "tsunami": "properties.tsunami",
            },
        },
    },
    {
        "id": "gdacs-disasters",
        "name": "GDACS — Disaster alerts",
        "category": "Hazard",
        "description": "Global Disaster Alert & Coordination System: current events (quakes, floods, cyclones) with alert level and country.",
        "slug": "gdacs-disasters",
        "config": {
            "kind": "rest-points",
            "request": {
                "url": "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP",
                "params": {},
            },
            "records_path": "features",
            "id_path": "properties.eventid",
            "lat_path": "geometry.coordinates.1",
            "lon_path": "geometry.coordinates.0",
            "time_path": "properties.fromdate",
            "country_path": "properties.iso3",
            "property_paths": {
                "event_type": "properties.eventtype",
                "name": "properties.name",
                "alert_level": "properties.alertlevel",
                "country": "properties.country",
                "iso3": "properties.iso3",
                "from_date": "properties.fromdate",
            },
        },
    },
]
