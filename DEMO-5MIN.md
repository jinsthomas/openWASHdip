# openWASHdip — 5-Minute Demo Script

A tight, presenter-ready walkthrough: an open-source data integrator that onboards any
source with AI, standardizes it into one table, **monitors** it (incl. a predictive drought
outlook), and **serves** it via API — no API keys, self-hostable.

---

## Before you start (off-screen, ~1 min)

```bash
docker compose up -d db                      # Postgres + PostGIS
uv run uvicorn openwashdip.serve.app:app     # server
```
- Open **http://127.0.0.1:8000/** and hard-refresh (⌘⇧R).
- **Pre-warm the drought data:** open **🌵 Drought** once and click **⬇ Load drought data**
  (it pulls ~8 locations from Open-Meteo, ~15–30s) so it's instant on stage.
- Leave one catalog source *unloaded* so you can show a live **Run**.

---

## 0. The pitch (0:00 – 0:30)

> "This is **openWASHdip** — an open-source data integrator. WASH, health, hazard and climate
> data lives in dozens of incompatible APIs. Here, anyone onboards a source **without code** —
> AI helps map it — and it's standardized into **one queryable table**, kept in sync, and turned
> into dashboards, a **predictive drought monitor**, and a public API. Fully open source, **no keys**."

Gesture at the canvas: **Trigger → Source → Map → Database**, catalog on the left.

---

## 1. Catalog → standardized table (0:30 – 1:30)  · the core "wow"

1. Left sidebar → click **WPDx — Water points**. *"A verified source — the whole workflow fills in."*
2. Click **🔀 Map fields**. *"AI-proposed mapping — every column it creates, with **roles**: id,
   lat/lon, time, country. Those roles are what let every source line up together."* → **Preview 5 rows**.
3. Click **▶ Run**. Nodes light up → data lands in Postgres → the **Table** opens.
   > "Click to standardized table in seconds — same shape for *any* source."
4. Click the **Map** tab → the same rows as points.

---

## 2. Dashboard — the platform at a glance (1:30 – 2:10)

1. Top bar → **📊 Dashboard**.
   > "Every source together: total records, countries, **health** of each feed, recent sync runs —
   > including failures — plus cross-source charts and a map."
2. Click **✎ Edit layout** → drag a widget / toggle half↔full. *"Customizable, saved per user."*

---

## 3. 🌵 Drought monitor + predictive outlook (2:10 – 3:55)  · the showcase

1. Top bar → **🌵 Drought**.
   > "Same engine, focused on a real problem. This pulls daily **rainfall, evapotranspiration and
   > soil moisture** from Open-Meteo — no key — for drought-prone districts in **Madagascar and Angola**."

2. Walk the screen top-to-bottom:
   - **KPIs** → *"8 locations, all in rainfall deficit — it's the dry season — and **4 are forecast to
     worsen** this week."*
   - **Severity map** → click **Namibe** (red). *"An indicative dryness index, 0–100: soil moisture
     plus a 30-day water-balance deficit. Namibe — soil moisture 0.02, Severe."*

3. **The predictive model — the moment to land (the 🔮 Drought index forecast card):**
   - Point at the chart. *"This is a **predictive model**. The blue line is the drought index history;
     we fit a **least-squares trend** to the last 21 days and project it **14 days forward** — the dashed
     red line past the 'today' marker, with a shaded **uncertainty band** that widens with the horizon."*
   - Read the headline: *"Region index **42.8 now → projected ~50 in two weeks**, and it's forecast to
     **cross the Moderate threshold within days**."* Point at the dotted Moderate/Severe lines.
   - Use the **location selector** → pick **Toliara**. *"Per-location too — Toliara's trend is steeper,
     heading toward Severe. That's an early-warning **lead time** to pre-position water."*
   - Back up with the table's **7-day outlook** column (▲ worsening / ▼ improving) and the **alerts**
     (*"worsening → Moderate"*).

   > "Describe *and* predict — a transparent, explainable model on real forecast data, not a black box."

---

## 4. Use the output — API & CSV (3:55 – 4:30)

1. Top bar → **🔌 API**.
   > "Nothing's locked in the UI. Every source is a live REST endpoint — **JSON, GeoJSON, or CSV**, no key."
2. On the drought source row, click **⤓ Download** (CSV) — or **Open** the JSON.
   > "A health team, a notebook, or a BI tool points straight at these. Full interactive docs at `/docs`."

---

## 5. Wrap (4:30 – 5:00)

> "So: onboard any source with AI, standardize into one table, **monitor and forecast** it — drought,
> water points, hazards — and **serve** it to anyone via API. Open-source, self-hostable, **no vendor,
> no keys**, the in-browser AI keeps data local. That's openWASHdip."

---

## If you only have 2 minutes — the reliable spine
Catalog **WPDx** → **Run** → **Table** (Segment 1) → **🌵 Drought** + the **🔮 14-day forecast model**
(Segment 3). Both are pre-loaded and need no network luck.

## Fallbacks
| If… | Do this |
|-----|---------|
| A live API is slow | Use already-loaded sources — Dashboard / Drought / All-data read from Postgres, no live calls. |
| Drought view is empty | Click **⬇ Load drought data** (pre-warm before the demo to avoid the wait). |
| Canvas state gets messy | **+ New** resets the canvas without touching saved sources. |
| Map looks empty for a source | It's non-geographic — the **Table** still works. |

## One-liner to remember
> **"Onboard with AI · standardize into one table · monitor & forecast · serve via API — open, no keys."**
