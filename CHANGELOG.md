# Changelog

Notable changes to openWASHdip. This is a prototype; versions are informal.

## Unreleased

### Added
- **📊 Dashboard** — a customizable widget board (KPI tiles, per-source health, recent sync
  runs, cross-source charts, map); add / remove / resize / drag-reorder widgets, layout saved
  in `localStorage`. New endpoint `GET /api/runs/recent`.
- **🌵 Drought monitor** — a keyless **Open-Meteo** source (`drought-openmeteo` kind, in
  `drought.py`) pulling daily precipitation / ET0 / soil moisture for drought-prone districts in
  Madagascar & Angola. View: indicative **dryness index**, severity map, time-series, alerts.
  Endpoint `GET /api/drought/overview`.
- **🔮 Predictive drought forecast** — `GET /api/drought/forecast`: a least-squares trend model
  over the rolling drought index, projected 14 days forward with an uncertainty band and
  Moderate/Severe threshold crossings; per-location 7-day outlook (worsening / improving /
  stable). Rendered as a history + dashed-forecast chart with a shaded band.
- **🔌 API access panel + CSV export** — `?format=csv` on `/api/sources/{id}/records` and
  `/api/unified/records`; an in-app panel lists copyable JSON / GeoJSON / CSV URLs per source and
  links to the interactive `/docs`.
- **📖 In-app Guide** — built-in how-to (pipeline, AI mapping, views, dashboard, drought, API).
- **Source node "Standard data source" dropdown** — pick any catalog source (grouped by
  category) directly inside the Source node, not just the left palette.
- **Local-LLM mapping option** — `OPENWASHDIP_LLM_PROVIDER=ollama` runs the mapping proposer on
  a local Ollama model (no key, data stays on-host); falls back to the heuristic on any error.
- **Visual node canvas** (React Flow) — build pipelines as `Trigger → Source → Map → Filter →
  Database` blocks; linear or free-form.
- **AI field mapping** — heuristic proposer (no key) that maps an API's JSON to columns with
  role tags (id / lat / lon / time / country); optional LLM proposer.
- **Standard-source catalog** — verified one-click sources: OpenStreetMap (Madagascar & Angola
  health/water), WPDx, USGS, GDACS, World Bank population, WorldPop population grid.
- **WorldPop population heatmap** — 1km grid binned to a point grid (`worldpop-grid` source kind)
  and rendered as a density heatmap; no GDAL/raster server. Dense grids are kept out of the
  unified cross-source comparison.
- **Table-only (non-geographic) sources** — geometry is optional; sources like World Bank
  population land as a table with no map.
- **Source-aware "Ask AI by name"** — matches the catalog first (deterministic), then falls back
  to the in-browser model; shows unverified suggestions to try/edit.
- **Endpoint discovery** — "From a URL" (scrape + OpenAPI + probe + verify) and "Ask AI by name"
  (in-browser WebLLM, Llama-3.2-3B, with catalog-first matching).
- **Query parameters** editor (country/ISO filters, date ranges, limits).
- **Multi-country sources** — one source pulls several countries into a country-tagged dataset.
- **Conformed `country` (ISO3) dimension** + period derivation from `event_time`.
- **Scheduling** — recurring sync via APScheduler with a Postgres job-store.
- **Charts** — drag-and-drop builder: bar, line, area, pie, scatter, histogram.
- **Unified "All data" view** — cross-source table, charts, and source-colored map, filterable
  by source / country / year.
- **Save & reopen workflows**; **table-only (non-geographic) sources**.
- **Docker one-command deploy** (`docker compose up --build`), `DEPLOY.md`, `DEMO.md`,
  `docs/ARCHITECTURE.md`, README screenshots.

### Fixed
- **World Bank year & ISO3** — bare-year time strings (e.g. `"2022"`) now parse into
  `event_time`; the conformed `country` (ISO3) column is included in the per-source table view;
  added explicit `year` / `iso3` columns to the World Bank mapping.
- **Unified records count** — the `/api/unified/records` total query referenced `sources` without
  joining it (500 error that also broke the All-data Table); fixed the JOIN.
- **No-store `index.html`** — the SPA HTML is served `Cache-Control: no-store` so browsers always
  load the newest content-hashed bundle after a rebuild (no stale UI).

### Licensing
- Released under the **Apache License 2.0**.

## Roadmap
- Predictive analytics — **done (first cut):** drought-index 14-day forecast (least-squares
  trend + uncertainty band). **Next:** anomaly-based SPI from a climatology baseline; Holt's
  exponential smoothing; water-point failure-risk model when WPDx is available; access-gap
  analysis (WorldPop × health facilities → underserved areas).
- More source shapes (pagination, CSV/Parquet, auth); incremental sync.
- Filtering World Bank regional aggregates; optional full-resolution raster layers.
