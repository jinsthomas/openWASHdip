# Changelog

Notable changes to openWASHdip. This is a prototype; versions are informal.

## Unreleased

### Added
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

### Licensing
- Released under the **Apache License 2.0**.

## Roadmap
- Predictive/prescriptive analytics (access-gap: WorldPop × health facilities → underserved
  areas; or a water-point failure-risk model when WPDx is available) — *in progress*.
- More source shapes (pagination, CSV/Parquet, auth); incremental sync.
- Filtering World Bank regional aggregates; optional full-resolution raster layers.
