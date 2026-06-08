# openWASHdip — Demo Script

A ~8-minute walkthrough showing an **open-source data integrator**: onboard any data
source, map it with AI assistance, pull it into a standardized table, schedule it, and
view it. Tabular-first; maps are a secondary view. Everything is open-source and runs
self-hosted with no API keys.

---

## 0. Before the demo (1 min, off-screen)

```bash
./scripts/demo_preflight.sh --reset      # DB + server up, clean slate
```
Open **http://127.0.0.1:8000/** and hard-refresh (Cmd+Shift+R).

**Optional but recommended** if you'll show the in-browser AI (Segment 7): in **Chrome
or Edge**, click the Source node → **✨ Ask AI by name** → run one query *before* the
demo so the ~0.9 GB model downloads and caches (otherwise the first run is slow on stage).

---

## 1. The one-line pitch (30 sec)

> "This is openWASHdip — an open-source data integrator. The problem: WASH and hazard
> data lives in dozens of incompatible APIs. Here, anyone can onboard a source without
> code — describe it, the platform standardizes it into one table, keeps it in sync, and
> makes it usable. Think of it as an n8n-style pipeline, but purpose-built for
> standardizing data, and fully open source — no vendor, no API keys."

Gesture at the canvas: **Trigger → Source → Map → Database**, with a **Standard sources**
catalog on the left.

---

## 2. The 90-second "wow" — catalog → table (tabular focus)

1. In the left sidebar, click **WPDx — Water points** (the WASH one).
   - The whole workflow fills in automatically — a verified, ready-to-run source.
2. Click the **🔀 Map fields** node.
   - *Say:* "This is the AI-proposed mapping — every column it will create from the API,
     with roles: id, location, time. You see exactly what lands in the table."
   - Click **Preview 5 rows** → real rows appear before pulling anything.
3. Click **▶ Run** (top right).
   - The nodes light up in sequence, edges animate — data flows into Postgres.
4. The results open on the **Table** tab: **500 water points**, columns for water source,
   technology, status, country, admin levels, install year.
   - *Say:* "That's the canonical output — a standardized table, regardless of the source's
     original shape."
5. Click the **Map** tab → the same rows as points (secondary view).

> Key line: **"From click to standardized table in seconds — no code, no key."**

---

## 3. Parameters / country filter (1 min)

1. Click the **🌐 Source** node → find **Query parameters**.
2. Add a line:
   ```
   clean_country_id=KEN
   ```
   *Say:* "Most APIs filter by country — here WPDx uses an ISO3 code."
3. Click **▶ Run** again → now the table + map show **only Kenya's** water points.

> Line: **"Same workflow, parameterized — country, date range, limits."**

---

## 4. Filtering on the canvas — the free-form node (1 min)

1. From the left palette, **drag the 🔎 Filter node** onto the canvas.
   - It wires itself between Map and Database — *"this is the free-form side; the linear
     flow is the guided default."*
2. Click the Filter node → e.g. `status` **=** `Yes` (only functional water points).
3. **▶ Run** → fewer rows; only the matching records.

---

## 5. Schedule + save/reopen (1 min)

1. Click the **⏰ Trigger** node → set **Every 6 hours**. *"Now it re-syncs on its own —
   the schedule persists in Postgres, survives restarts, no extra services."*
2. **▶ Run** to save it.
3. Reload the page (show it resets). Then top bar → **📂 Open saved workflow** → pick it.
   - The whole workflow rebuilds on the canvas — editable. Click **📊 Data** to see its table.

> Line: **"Workflows are saved and reopenable — like any automation platform, but open."**

---

## 6. Onboard an *unknown* API with AI mapping (1 min)

1. Top bar **+ New**.
2. Click **🌐 Source** → paste any public JSON API, e.g.:
   ```
   https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=100&minmagnitude=4
   ```
   (or click **Load example**).
3. Click **Inspect with AI →** — *"the platform fetches a sample and proposes the mapping
   automatically."* Open the Map node to show the detected columns.
4. **▶ Run** → table of earthquakes.

> Line: **"It's not just the curated sources — point it at anything that returns JSON."**

---

## 7. "I don't even have the endpoint" — AI finds it (1–2 min)

In the **🌐 Source** node, under **Don't have the endpoint? Find one**:

**A — From a URL (no key, always works):**
1. Paste a docs/landing page, e.g. `https://www.worldpop.org/sdi/introapi/`.
2. Click **🔎 From a URL** → **Search endpoints**.
   - *Say:* "It scrapes the page, reads any OpenAPI spec, probes common paths — then
     **verifies each by actually fetching it.** Only working endpoints show up."
3. It lists real endpoints (e.g. `worldpop.org/rest/data`). Click **Use** → it maps.

**B — Ask AI by name (in-browser, open-source, Chrome/Edge):**
1. Click **✨ Ask AI by name**, type e.g. `water points in Kenya`.
2. **Suggest with in-browser AI**.
   - *Say:* "A small open model runs **in your browser** via WebGPU — no API key, no data
     leaves the machine. It proposes endpoints; we verify each by fetching before showing
     them."
3. Click **Use** on a verified result.

> Closing line: **"Propose, then verify by fetching — we never trust a guessed URL blindly."**

---

## 8. Wrap-up talking points (30 sec)

- **Open source, no lock-in:** Postgres/PostGIS + FastAPI + React Flow — all OSI-licensed.
  No API keys required; the in-browser AI keeps data local.
- **Standardized output:** every source becomes one queryable table (+ geometry when present).
- **Self-hostable:** one Postgres (local Docker or a remote DB — one line to switch).
- **Extensible:** curated catalog for known sources, AI for the long tail, a node for each step.

---

## Troubleshooting / fallbacks

| If… | Do this |
|-----|---------|
| A search seems stuck | Discovery takes ~10s; or hit **+ New** to reset. |
| In-browser AI is slow / no suggestions | First run downloads the model — pre-warm it before the demo. If the laptop has no WebGPU, skip Segment 7B and show 7A only. |
| A live API is down/slow | Fall back to the **catalog** sources (WPDx/USGS/GDACS) and the **Load example** button — those are the most reliable. |
| Map looks empty | The source has no lat/lon (non-geographic) — that's expected; the **Table** still works. |
| Want a clean slate mid-demo | Re-run `./scripts/demo_preflight.sh --reset` and refresh. |

## The reliable spine (if you only have 2 minutes)
Catalog **WPDx** → **Run** → **Table** → **Map**. That path is fully verified and needs no
network luck beyond the WPDx API.
