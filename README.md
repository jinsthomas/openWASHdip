# openWASHdip

**An open-source data integrator** — onboard any data source, map it with AI assistance,
and pull it into one standardized, queryable store. Build pipelines on a visual
node canvas (n8n-style), schedule re-syncs, and explore everything as tables, charts, and
maps — including a **unified cross-source view** that slices all your data by source,
country, and time.

Built for UNICEF as a showcase of how an open, self-hostable integration platform works.
The whole stack is OSI-licensed open source and runs with **no API keys required**.

```
 ⏰ Trigger → 🌐 Source → 🔀 Map → 🔎 Filter → 🗄 Database     →  Table · Charts · Map
   schedule    paste API    AI maps    optional   Postgres/PostGIS    + 🌐 All data (cross-source)
               or pick a    columns               (the standardized
               catalog src                         canonical table)
```

## Screenshots

| Visual pipeline + source catalog | AI-assisted column mapping |
|---|---|
| ![canvas](docs/screenshots/01-canvas.png) | ![mapping](docs/screenshots/02-mapping.png) |
| **Unified cross-source charts** | **Unified, source-colored map** |
| ![charts](docs/screenshots/03-unified-charts.png) | ![map](docs/screenshots/04-unified-map.png) |

## Why this shape

The canonical form is a **table**, not a map. Any source — water points, health
facilities, sensors, disaster feeds — becomes rows of
`{source, country, time, geometry?, …properties}` in Postgres. **Maps and charts are views
over that table**, and the **conformed dimensions** (source · country · time) let you
analyze every source *together*. The integration flow is the product; visualization is
downstream.

## Features

- **Visual node canvas** (React Flow) — build a pipeline as connected blocks; use the
  guided linear layout or drag nodes freely.
- **AI-assisted mapping** — paste an API URL and a built-in heuristic (no key) proposes the
  field mapping; review and edit the columns it will create, with role tags
  (id / lat / lon / time / country). Optional LLM proposer if you want it.
- **Standard-source catalog** — curated, verified presets (WPDx water points, USGS quakes,
  GDACS disasters, OpenStreetMap layers) that load a correct workflow in one click.
- **Endpoint discovery** — don't have the URL? Point it at a docs page and it scrapes +
  reads OpenAPI specs + probes + **verifies by fetching**. Or describe a source in plain
  language and an **in-browser model** (WebLLM / WebGPU, no key) suggests endpoints.
- **Query parameters** — filter at the source (country / ISO3, date ranges, limits).
- **Multi-country sources** — one source can pull several countries into a single,
  country-tagged dataset.
- **Scheduling** — re-sync on a cadence (APScheduler, persisted in Postgres, no broker).
- **Charts** — drag-and-drop builder over the data: bar, line, area, pie, scatter, histogram.
- **🌐 Unified "All data" view** — every source together, filterable by source / country /
  year, as a table, cross-source charts, and a source-colored map.
- **📊 Dashboard** — a customizable widget board: KPI tiles, per-source health, recent sync
  runs (incl. failures), cross-source charts, and a map. Add / remove / resize / drag-reorder
  widgets; layout persists in the browser.
- **🌵 Drought monitor** — a focused view over a keyless **Open-Meteo** source (daily
  precipitation, evapotranspiration, soil moisture for drought-prone districts in Madagascar &
  Angola). An indicative **dryness index**, severity map, time-series, and alerts.
- **🔮 Predictive drought forecast** — a least-squares trend model projects the drought index
  **14 days forward** with an uncertainty band and Moderate/Severe threshold crossings, plus a
  per-location 7-day outlook (worsening / improving / stable). Explainable, not a black box.
- **🔌 API access + CSV export** — every source is a live REST endpoint (JSON / GeoJSON / CSV,
  no key); an in-app panel lists copyable URLs and downloads, with interactive docs at `/docs`.
- **📖 In-app Guide** — a built-in how-to covering the pipeline, AI mapping, views, dashboard,
  drought monitor, scheduling, and the API.
- **WorldPop population heatmap** — 1km population grid binned to a point grid and rendered as a
  density heatmap (no GDAL/tile server), alongside tabular national totals from the World Bank.

## Quickstart

### One command (Docker)

Requires Docker only. Builds the UI, starts Postgres+PostGIS and the app:

```bash
docker compose up --build
# open http://127.0.0.1:8000/
```

### Local development

Requires Python 3.11+, [uv](https://docs.astral.sh/uv/), Docker, and Node 18+ (to build the UI).

```bash
# 1. Standalone Postgres + PostGIS (local). Swap DATABASE_URL for a remote DB anytime.
docker compose up -d db

# 2. Python deps + schema
uv sync
cp .env.example .env            # DATABASE_URL — local Docker default works as-is
uv run openwashdip initdb       # PostGIS extension + tables

# 3. Build the web UI (outputs into the package's static dir)
cd frontend && npm install && npm run build && cd ..

# 4. Run
uv run uvicorn openwashdip.serve.app:app
# open http://127.0.0.1:8000/
```

In the UI: pick a **Standard source** (or paste an API URL → **Inspect with AI**), review
the **Map** node's columns, then **▶ Run**. Click a source to see its **Table / Charts /
Map**, or **🌐 All data** for the cross-source view.

See **[DEMO.md](DEMO.md)** for a full presenter walkthrough, and
`scripts/demo_preflight.sh` to bring everything up (`--reset` for a clean slate).

To run it on a server, see **[DEPLOY.md](DEPLOY.md)**.

## Architecture

For the full design, data model, API reference, and feature list, see
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

- **`db.py`** — engine/session; reads `DATABASE_URL` (one line to point at a remote Postgres).
- **`models.py`** — canonical schema: `Source`, `Record` (conformed `country` + `event_time`,
  PostGIS point, JSONB properties), `SyncRun`.
- **`ingest.py`** — the trusted, spec-driven interpreter: fetch → normalize → upsert. No
  `eval`/`exec`, so AI-produced *specs* (not code) are safe to run.
- **`worldpop.py`** — ingests WorldPop's 1km population grid as a binned point grid (heatmap).
- **`drought.py`** — ingests Open-Meteo daily precipitation / ET0 / soil moisture per location
  (`drought-openmeteo` source kind) — one record per location-day, powering the drought monitor.
- **`ai.py`** — fetch a sample of an API and propose a mapping (heuristic, or optional
  cloud **Anthropic** / local **Ollama** LLM — selected via `OPENWASHDIP_LLM_PROVIDER`).
- **`discovery.py`** — find + verify candidate endpoints from a docs page or a name.
- **`presets.py`** — the curated standard-source catalog.
- **`scheduler.py`** — APScheduler with a Postgres job-store.
- **`serve/app.py`** — FastAPI: wizard, sources, views, unified cross-source endpoints,
  CSV export, and the drought overview + forecast model (`/api/drought/*`).
- **`frontend/`** — Vite + React + React Flow + ECharts UI (builds into `serve/static/`).
  Modal views: `Dashboard.jsx`, `Drought.jsx`, `Unified.jsx`, `ApiAccess.jsx`, `Help.jsx`.

## Deploying against a remote Postgres

Create a Postgres (v14+) with PostGIS, then set in `.env`:

```
DATABASE_URL=postgresql+psycopg://user:password@host:5432/openwashdip?sslmode=require
```

Run `uv run openwashdip initdb` once. Nothing else changes.

## Status

Prototype / showcase. The connector contract, catalog, scheduling, charts, unified view,
dashboard, drought monitor, and REST/CSV API are functional. **Predictive analytics** have a
first implementation — the drought-index 14-day forecast (least-squares trend with an
uncertainty band). Next: anomaly-based SPI from a climatology baseline, and a water-point
failure-risk model when WPDx data is available.

A condensed presenter walkthrough is in **[DEMO-5MIN.md](DEMO-5MIN.md)**.

## License

[Apache License 2.0](LICENSE) © 2026 openWASHdip authors.
