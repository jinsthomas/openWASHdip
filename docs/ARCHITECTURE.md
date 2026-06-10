# openWASHdip — Architecture & Features

This document describes how openWASHdip is built and everything it currently does. For a
quick start see the [README](../README.md); for a presenter walkthrough see
[DEMO.md](../DEMO.md); to run it on a server see [DEPLOY.md](../DEPLOY.md).

---

## 1. What it is

An **open-source data integrator**. You onboard a data source by picking it from a catalog
or pasting an API URL; an AI step proposes the field mapping; the platform pulls the data
into one **standardized table** in Postgres/PostGIS, re-syncs it on a schedule, and lets you
explore everything as **tables, charts, and maps** — including a **unified cross-source view**
that slices all sources by source, country, and time.

**Design philosophy**

- **Table-first.** The canonical form is a table, not a map. Every source becomes rows of
  `{source, country, time, geometry?, …properties}`. Maps and charts are *views* over that.
- **Conformed dimensions.** `source`, `country` (ISO3), and `time` are shared across all
  sources, so they can be analyzed *together*.
- **Specs, not code.** The "AI" produces a JSON *mapping spec*, never code. One audited
  interpreter executes it — no `eval`/`exec`, safe to run on an open platform.
- **No keys, self-hostable.** Everything runs locally/self-hosted with no API keys; the
  optional in-browser AI keeps data on the user's machine.

---

## 2. Tech stack

| Layer | Technology | License |
|-------|-----------|---------|
| Backend API | FastAPI + Uvicorn | MIT/BSD |
| Database | PostgreSQL + PostGIS | PostgreSQL/GPL-compatible |
| ORM / geo | SQLAlchemy 2 + GeoAlchemy2 | MIT |
| Scheduling | APScheduler (Postgres job-store) | MIT |
| Frontend | React 18 + Vite | MIT |
| Node canvas | React Flow (`@xyflow/react`) | MIT |
| Charts | Apache ECharts | Apache-2.0 |
| Map | Leaflet | BSD-2 |
| In-browser AI | WebLLM (`@mlc-ai/web-llm`, lazy-loaded) | Apache-2.0 |
| Project license | **Apache-2.0** | |

---

## 3. Data model (`models.py`)

Three tables hold the whole system:

- **`sources`** — one integrated source: `slug`, `title`, `kind`, `config` (the mapping
  spec, JSONB), `interval_minutes` (schedule), `enabled`, and last-sync status.
- **`records`** — the standardized output, shared by every source. Columns:
  `source_id`, `external_id`, `event_time`, **`country`** (ISO3, conformed dimension),
  `geom` (PostGIS point, nullable), `properties` (JSONB). Unique on `(source_id, external_id)`.
- **`sync_runs`** — history of each pull (status, row count, error).

**Conformed dimensions:** `source` (via `source_id`), `country`, and `event_time` (→ year/month)
are the columns every source shares, enabling the unified cross-source views.

---

## 4. The connector / mapping spec

A source's `config` is a JSON spec interpreted by `ingest.py` (kind `rest-points`):

```jsonc
{
  "kind": "rest-points",
  "request": { "url": "...", "params": { "key": "value" } },  // or "requests": [ ... ] for multi-country
  "records_path": "features",        // dotted path to the array ("." = the response IS the array; "1" = element index)
  "id_path": "id",
  "lat_path": "geometry.coordinates.1",   // optional — omit for non-geographic (table-only) sources
  "lon_path": "geometry.coordinates.0",   // optional
  "time_path": "properties.time",         // optional
  "country_path": "properties.iso3",      // optional — fills the conformed country dimension
  "country_const": "MDG",                 // optional — inject a constant country (for country-scoped sources)
  "property_paths": { "column_name": "dotted.path" },
  "filters": [ { "field": "mag", "op": ">", "value": "5" } ]   // optional
}
```

**Source kinds.** Most sources are `rest-points` (the JSON-record flow above). A second kind,
`worldpop-grid`, ingests WorldPop's 1km population grid: it downloads the ASCII-XYZ file per
country, **bins it to a coarser point grid** (default ~0.1° summing population), and stores the
cells as country-tagged point records — rendered as a **heatmap** (`render: "heatmap"`,
`weight: "population"`). New kinds are dispatched by `ingest.pull()`. Dense grid sources are
excluded from the unified cross-source views (they'd swamp the point sources).

Notable capabilities:

- **Dotted paths** with list indices (`geometry.coordinates.1`).
- **Root / wrapped arrays** — `records_path: "."` (Socrata) or `"1"` (World Bank's `[meta, [records]]`).
- **Geometry optional** — non-geographic sources (population, indicators) are valid; they land
  in the table with an empty map.
- **Filters** — keep only rows meeting a condition (`>`, `>=`, `<`, `<=`, `==`, `contains`).
- **Multi-country sources** — `requests` is a list of sub-requests, each with its own
  `country_const`; they share one mapping and merge into a single country-tagged dataset.

---

## 5. Standard-source catalog (`presets.py`)

Curated, verified, no-key sources that load a correct workflow in one click:

| Source | Category | Notes |
|--------|----------|-------|
| Health facilities — Madagascar & Angola | Health | OpenStreetMap (Overpass), one multi-country source |
| Water points — Madagascar & Angola | WASH | OpenStreetMap (Overpass), multi-country |
| Madagascar / Angola — single-country layers | WASH/Health | OpenStreetMap per country |
| World Bank — Population by country | Population | Tabular population by country/year (no map) |
| WorldPop — Population grid (Madagascar & Angola) | Population | 1km population binned to a point grid, rendered as a heatmap |
| WPDx — Water points | WASH | Water Point Data Exchange (Socrata) |
| USGS — Earthquakes (M4+) | Hazard | GeoJSON event feed |
| GDACS — Disaster alerts | Hazard | Global disaster events |

Catalog entries can carry `keywords` used by the AI name-search.

---

## 6. AI features

All optional and keyless by default:

- **AI field mapping** (`ai.py`) — fetches a sample of an API and proposes the mapping
  (records path, id/lat/lon/time/country roles, properties) with a pure-Python heuristic.
  An optional LLM proposer can be enabled with `OPENWASHDIP_LLM_PROVIDER=anthropic` (cloud
  Claude) or `=ollama` (a **local** model, no key, data stays on-host). Any LLM error falls
  back to the heuristic, so mapping always works.
- **Endpoint discovery — "From a URL"** (`discovery.py`) — given a docs page or domain, it
  scrapes API-looking links, reads any OpenAPI/Swagger spec, probes common paths, and
  **verifies each candidate by fetching it** (concurrently). Only working endpoints are shown.
- **Endpoint suggestion — "Ask AI by name"** (`webllm.js`) — runs an open model
  (Llama-3.2-3B) **in the browser** (WebGPU, no key) to suggest endpoints, then verifies them
  server-side. It **matches the catalog first**, so typing a known source name (e.g.
  "population", "earthquakes") resolves deterministically to that source.
- **Safety net:** suggested URLs are only surfaced after a real fetch confirms they return a
  JSON record array. Guesses that don't are shown separately as "try/edit" rather than hidden.

---

## 7. Frontend (`frontend/`)

A single-page app built with Vite (compiles into `openwashdip/serve/static/`).

- **Node canvas** (`App.jsx`, `nodes/nodes.jsx`) — the pipeline as connected blocks:
  `⏰ Trigger → 🌐 Source → 🔀 Map → 🔎 Filter → 🗄 Database`. Linear by default; drag nodes
  freely; drag a Filter from the palette. "Run" cascades the nodes and streams data into Postgres.
- **Config drawer** (`components/Drawer.jsx`) — per-node settings: Source (URL, params,
  find-endpoint tools), Map (the **column mapper** with role tags + live preview), Filter,
  Database, Trigger (schedule).
- **Results** (`components/Results.jsx`) — per-source **Table / Charts / Map** tabs.
- **Charts** (`components/Charts.jsx`) — drag-and-drop builder over the data: bar, line, area,
  pie, scatter, histogram, with aggregations and time bucketing.
- **Unified "All data"** (`components/Unified.jsx`) — every source together, filtered by
  source / country / year, as a table, cross-source charts, and a source-colored map.
- **Dashboard** (`components/Dashboard.jsx`) — a customizable widget board (KPIs, source health,
  recent runs, charts, map); add / remove / resize / drag-reorder widgets, layout in `localStorage`.
- **Drought monitor** (`components/Drought.jsx`) — dryness-index KPIs, a **14-day forecast model**
  chart (history + dashed projection + uncertainty band + thresholds, per-location selector),
  severity map, region time-series, locations table with a 7-day outlook, and alerts.
- **API access** (`components/ApiAccess.jsx`) — copyable JSON / GeoJSON / CSV endpoint URLs per
  source + a curl example, linking to the interactive `/docs`.
- **Guide** (`components/Help.jsx`) — an in-app how-to with a section table-of-contents.

Charts and the maps use **ECharts** and **Leaflet** (loaded globally); the canvas uses **React Flow**.

---

## 8. HTTP API

Served by FastAPI (`serve/app.py`); interactive docs at `/docs`.

**Wizard**
- `POST /api/propose` — fetch a sample + propose a mapping.
- `POST /api/preview` — pull a few normalized rows for a config (no persist).
- `POST /api/discover` — find + verify endpoints from a docs/base URL.
- `POST /api/verify` — verify a list of candidate URLs.
- `GET  /api/catalog` — the standard-source catalog.

**Sources**
- `GET /api/sources` · `POST /api/sources` · `PATCH /api/sources/{id}` · `DELETE /api/sources/{id}`
- `POST /api/sources/{id}/sync` — run a sync now.

**Per-source views**
- `GET /api/sources/{id}/records` — the standardized table (`?format=csv` for a CSV download;
  includes the conformed `country` column).
- `GET /api/sources/{id}/aggregate` — GROUP BY for charts.
- `GET /api/sources/{id}/geojson` — geometry for the map.
- `GET /api/sources/{id}/runs` — sync history.

**Unified (cross-source)**
- `GET /api/unified/summary` · `/filters` · `/records` (`?format=csv`) · `/aggregate` · `/geojson`
  (all filterable by source / country / year).

**Dashboard & drought**
- `GET /api/runs/recent` — most recent sync runs across all sources (dashboard feed).
- `GET /api/drought/overview` — per-location dryness index, region series, alerts, 7-day outlook.
- `GET /api/drought/forecast?location=` — least-squares trend model: index history +
  `trend_fit` + a 14-day `forecast` with `lo`/`hi` band, plus Moderate/Severe crossing dates.

`GET /healthz` for liveness; `GET /` serves the SPA (with `Cache-Control: no-store`).

---

## 9. Scheduling (`scheduler.py`)

APScheduler with a **Postgres job-store**: each source with `interval_minutes` gets a
recurring sync job that persists across restarts — no Redis/Celery broker. "Run now" triggers
a sync immediately.

---

## 10. Running it

- **One command:** `docker compose up --build` (db + app). See [DEPLOY.md](../DEPLOY.md).
- **Local dev:** `docker compose up -d db`, `uv sync`, `npm run build` (in `frontend/`),
  `uv run openwashdip initdb`, `uv run uvicorn openwashdip.serve.app:app`.
- **CLI:** `openwashdip initdb | list | sync <slug>`.

The schema auto-creates/migrates on startup (`db.init_db` enables PostGIS, creates tables, and
adds new columns idempotently).

---

## 11. Record sources vs. raster sources

This platform is built for **record/point/tabular** sources (water points, facilities, events,
country indicators). True **raster** data (satellite imagery, high-resolution grids) is a different
shape — pixels, not rows — and is not ingested into the records table; the original prototype
handled that via COG + tile serving, which the current table-first redesign removed.

The **WorldPop** source bridges the gap pragmatically: rather than serve a raster, it **bins the
1km grid into a coarse point grid** and stores it as ordinary records, then renders it as a
**heatmap**. This keeps the table-first model (no GDAL/tile server) while still giving a
population-density map. Full-resolution raster *layers* remain a possible future addition.

---

## 12. Roadmap

- **Predictive analytics** — *first cut shipped:* the **drought-index 14-day forecast**
  (`/api/drought/forecast`) — a least-squares trend over the rolling index with an uncertainty
  band and threshold crossings. *Next:* anomaly-based **SPI** from a climatology baseline,
  Holt's exponential smoothing, a water-point **failure-risk** model (when WPDx is available),
  and an **access-gap analysis** combining WorldPop population with health facilities (PostGIS
  nearest-neighbor) to surface underserved high-population areas.
- **More source shapes** — pagination, CSV/Parquet, authenticated APIs.
- **Incremental sync** — upsert by `external_id` instead of full replace.
- **Filtering World Bank regional aggregates** to actual countries.
- **Full-resolution raster layers** (optional) — server-side tiles for 100m WorldPop, etc.
