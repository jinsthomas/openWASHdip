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
        "id": "worldpop-grid-mdg-ago",
        "name": "WorldPop — Population grid (Madagascar & Angola)",
        "category": "Population",
        "description": "WorldPop 1km population density binned to a point grid, rendered as a heatmap. Madagascar & Angola.",
        "slug": "worldpop-grid-mdg-ago",
        "keywords": ["worldpop", "population", "density", "grid", "raster", "people"],
        "config": {
            "kind": "worldpop-grid",
            "bin_deg": 0.1,
            "year": 2020,
            "render": "heatmap",
            "weight": "population",
            "countries": [
                {"iso3": "MDG", "url": "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/2020/MDG/mdg_ppp_2020_1km_ASCII_XYZ.zip"},
                {"iso3": "AGO", "url": "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/2020/AGO/ago_ppp_2020_1km_ASCII_XYZ.zip"},
            ],
        },
    },
    {
        "id": "drought-southern-africa",
        "name": "Drought — Southern Africa (Open-Meteo)",
        "category": "Drought",
        "description": "Daily precipitation, evapotranspiration and soil moisture for drought-prone districts in Madagascar & Angola (Open-Meteo, no key). Powers the 🌵 Drought view.",
        "slug": "drought-southern-africa",
        "keywords": ["drought", "precipitation", "rainfall", "soil moisture", "evapotranspiration", "spi", "dry", "water balance", "open-meteo"],
        "config": {
            "kind": "drought-openmeteo",
            "past_days": 60,
            "forecast_days": 7,
            # Drought-prone districts: Madagascar's Grand Sud + Angola's Cunene/Huíla,
            # with each capital as a wetter reference point.
            "locations": [
                {"iso3": "MDG", "name": "Ambovombe", "lat": -25.17, "lon": 46.08},
                {"iso3": "MDG", "name": "Toliara", "lat": -23.35, "lon": 43.67},
                {"iso3": "MDG", "name": "Betioky", "lat": -23.72, "lon": 44.38},
                {"iso3": "MDG", "name": "Antananarivo", "lat": -18.88, "lon": 47.51},
                {"iso3": "AGO", "name": "Ondjiva", "lat": -17.07, "lon": 15.73},
                {"iso3": "AGO", "name": "Lubango", "lat": -14.92, "lon": 13.49},
                {"iso3": "AGO", "name": "Namibe", "lat": -15.20, "lon": 12.15},
                {"iso3": "AGO", "name": "Luanda", "lat": -8.84, "lon": 13.23},
            ],
        },
    },
    {
        "id": "worldbank-population",
        "name": "World Bank — Population by country",
        "category": "Population",
        "description": "Total population by country (latest year) from the World Bank Open Data API (no key). Tabular — no map.",
        "slug": "worldbank-population",
        "keywords": ["population", "worldbank", "demographics", "people", "census"],
        "config": {
            "kind": "rest-points",
            "request": {
                "url": "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL",
                "params": {"format": "json", "per_page": "400", "date": "2022"},
            },
            "records_path": "1",  # World Bank wraps records: [metadata, [records]]
            "lat_path": "",
            "lon_path": "",
            "country_path": "countryiso3code",
            "time_path": "date",
            "property_paths": {
                "iso3": "countryiso3code",
                "year": "date",
                "population": "value",
                "country_name": "country.value",
            },
        },
    },
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
