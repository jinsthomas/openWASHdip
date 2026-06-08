# Changelog

Notable changes to openWASHdip. This is a prototype; versions are informal.

## Unreleased

### Added
- **Visual node canvas** (React Flow) — build pipelines as `Trigger → Source → Map → Filter →
  Database` blocks; linear or free-form.
- **AI field mapping** — heuristic proposer (no key) that maps an API's JSON to columns with
  role tags (id / lat / lon / time / country); optional LLM proposer.
- **Standard-source catalog** — verified one-click sources: OpenStreetMap (Madagascar & Angola
  health/water), WPDx, USGS, GDACS, World Bank population.
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
- Predictive analytics (water-point failure-risk model, time-series forecasts).
- WorldPop raster population-density layer (1km, client-side).
- More source shapes (pagination, CSV/Parquet, auth); incremental sync.
