# Contributing to openWASHdip

Thanks for your interest. The most common contribution is **adding a data source**, so this
guide focuses on that, then covers the codebase for deeper changes. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Ways to add a data source

### 1. No code — in the app

For any public JSON API, you don't need to touch the code:

1. Open the app, click the **🌐 Source** node → paste the API URL → **Inspect with AI**.
2. Review/adjust the proposed columns in the **🔀 Map** node (set roles: id / lat / lon / time /
   country), optionally add **Query parameters** (e.g. a country/ISO filter).
3. **▶ Run**. The source is saved and re-syncs on the schedule you set.

Don't have the endpoint? Use **Find one → From a URL** (point at a docs page) or **Ask AI by
name** (matches the built-in catalog first, then suggests with the in-browser model).

### 2. As a catalog preset — a few lines of Python

To make a source a one-click **Standard source**, add an entry to `openwashdip/presets.py`. A
preset is just a verified mapping spec:

```python
{
    "id": "my-source",
    "name": "My Source — Short title",
    "category": "WASH",                 # WASH | Health | Hazard | Population | …
    "description": "What it is, where it's from.",
    "slug": "my-source",
    "keywords": ["alias", "synonyms"],  # optional — used by "Ask AI by name"
    "config": {
        "kind": "rest-points",
        "request": {"url": "https://api.example.org/things", "params": {"format": "json"}},
        "records_path": "features",     # dotted path to the array ("." = response IS the array)
        "id_path": "id",
        "lat_path": "geometry.coordinates.1",   # optional (omit for table-only sources)
        "lon_path": "geometry.coordinates.0",   # optional
        "time_path": "properties.time",         # optional
        "country_path": "properties.iso3",      # optional — fills the conformed country dim
        "property_paths": {"column_name": "dotted.path"},
        # "filters": [{"field": "mag", "op": ">", "value": "5"}],   # optional
    },
}
```

**Verify it before committing** — probe the live API, then test the mapping:

```bash
curl -s 'https://api.example.org/things' | head           # inspect the shape
# preview rows through the mapping without persisting:
curl -s -X POST localhost:8000/api/preview -H 'content-type: application/json' \
  -d '{"config": { ...your config..., "_limit": 5 }}'
```

Tips:
- **Root / wrapped arrays:** `records_path: "."` (the response is the array) or `"1"` (e.g. World
  Bank's `[metadata, [records]]`).
- **Country:** prefer ISO3. Use `country_path` if each record carries it, or `country_const` for a
  source scoped to one country.
- **Multiple countries in one source:** use `requests` (a list of sub-requests, each with its own
  `country_const`) instead of a single `request`.
- **Non-record sources:** a different `kind` (e.g. `worldpop-grid`) has its own ingestion in
  `ingest.pull()`. Adding a new kind means adding a puller and a dispatch branch.

## Codebase tour

| Path | What |
|------|------|
| `openwashdip/models.py` | The canonical schema (sources, records, sync_runs). |
| `openwashdip/ingest.py` | Spec interpreter + sync; `pull()` dispatches by source kind. |
| `openwashdip/worldpop.py` | Example of a non-`rest-points` kind (binned population grid). |
| `openwashdip/ai.py` / `discovery.py` | Mapping proposer / endpoint discovery + verify. |
| `openwashdip/presets.py` | The standard-source catalog. |
| `openwashdip/serve/app.py` | FastAPI endpoints (see ARCHITECTURE.md §8). |
| `frontend/src/` | React + React Flow UI (builds into `serve/static/`). |

## Dev setup

```bash
docker compose up -d db
uv sync
cp .env.example .env
uv run openwashdip initdb
cd frontend && npm install && npm run build && cd ..   # rebuild after UI changes
uv run uvicorn openwashdip.serve.app:app --reload
```

## Pull requests

- Keep changes focused; match the surrounding code style.
- For a new catalog source, confirm it returns data live and note any rate-limit/availability
  caveats in the PR.
- Rebuild the frontend (`npm run build`) if you changed anything under `frontend/`, since the
  built assets are committed.
- By contributing you agree your work is licensed under the project's **Apache-2.0** license.
