import { useState } from "react";

// In-app user guide. Content mirrors the real features/wording (see DEMO.md / README).
// Tabbed: a table-of-contents on the left, one section rendered on the right.
const SECTIONS = [
  {
    id: "overview",
    title: "What is openWASHdip?",
    body: (
      <>
        <p>
          openWASHdip is an <b>open-source data integrator</b>. WASH, health, hazard and
          population data lives in dozens of incompatible APIs. Here you onboard any source —
          with AI assistance, no code — and the platform standardizes it into <b>one queryable
          table</b> in Postgres/PostGIS, keeps it in sync, and lets you explore it.
        </p>
        <p className="gnote">
          The canonical form is a <b>table</b>, not a map. Every source becomes rows of
          <code> source · country · time · geometry? · …properties</code>. Charts and maps are
          views over that table, and the conformed dimensions let you analyze every source together.
        </p>
        <div className="gflow">⏰ Trigger → 🌐 Source → 🔀 Map → 🔎 Filter → 🗄 Database → Table · Charts · Map</div>
        <p>No API keys are required; an optional in-browser AI keeps data on your machine.</p>
      </>
    ),
  },
  {
    id: "quickstart",
    title: "Quick start",
    body: (
      <>
        <p>From nothing to a standardized table in three steps:</p>
        <ol className="gsteps">
          <li>
            <b>Pick a source.</b> In the left <b>Standard sources</b> list — or the <b>Standard data
            source</b> dropdown inside the <b>🌐 Source</b> node — choose a curated source (e.g.
            <i> WPDx — Water points</i>). The whole workflow fills in, ready to run.
          </li>
          <li>
            <b>Review the mapping.</b> Click the <b>🔀 Map fields</b> node to see every column the
            source will create, with role tags (id / lat / lon / time / country). Click
            <b> Preview 5 rows</b> to see real data before pulling.
          </li>
          <li>
            <b>Run it.</b> Click <b>▶ Run</b> (top right). The nodes light up in sequence and the
            rows land in Postgres. The results open on the <b>Table</b> tab.
          </li>
        </ol>
        <p className="gnote">No URL? Paste any JSON API into the Source node and click <b>Inspect with AI →</b> instead (see “Add a custom source”).</p>
      </>
    ),
  },
  {
    id: "pipeline",
    title: "The pipeline nodes",
    body: (
      <>
        <p>A workflow is a chain of nodes. Click any node to configure it in the side drawer.</p>
        <ul className="gdefs">
          <li><b>⏰ Trigger</b> — manual, or a re-sync schedule (hourly / 6-hourly / daily). Schedules persist in Postgres.</li>
          <li><b>🌐 Source</b> — where the data comes from: pick a standard source from the dropdown, or paste an API URL. Holds query parameters (country / ISO codes, date ranges, limits).</li>
          <li><b>🔀 Map fields</b> — the columns the source creates. Toggle which to include, rename them, and tag roles (id / lat / lon / time / country). Preview rows here.</li>
          <li><b>🔎 Filter</b> — optional. Drag it from the left palette onto the canvas to keep only rows matching a condition (applied during the pull).</li>
          <li><b>🗄 Database</b> — the destination table name + title. Rows land in Postgres/PostGIS; geographic rows also get a spatial point for the Map view.</li>
        </ul>
        <p className="gnote"><b>Linear vs free:</b> click nodes to configure in the guided order, or drag nodes around the canvas. <b>↹ Tidy</b> re-lines them up.</p>
      </>
    ),
  },
  {
    id: "custom",
    title: "Add a custom source (AI)",
    body: (
      <>
        <p>Not in the catalog? Three ways to onboard, in the <b>🌐 Source</b> node:</p>
        <ul className="gdefs">
          <li><b>Paste a URL → Inspect with AI.</b> Any public JSON API. The platform fetches a sample and proposes the field mapping automatically (a built-in heuristic — no key). Review it in the Map node.</li>
          <li><b>From a URL (discovery).</b> Don’t have the endpoint? Point it at a docs/landing page. It scrapes the page, reads OpenAPI specs, probes common paths, and <b>verifies each by actually fetching it</b> — only working endpoints show.</li>
          <li><b>Ask AI by name.</b> Describe a source in plain language (e.g. “water points in Kenya”). A small open model runs <b>in your browser</b> via WebGPU (Chrome/Edge, no key, data stays local) and suggests endpoints, which are then verified by fetching.</li>
        </ul>
        <p className="gnote">Principle: <b>propose, then verify by fetching</b> — a guessed URL is never trusted blindly.</p>
      </>
    ),
  },
  {
    id: "views",
    title: "Viewing your data",
    body: (
      <>
        <p>Click <b>📊 Data</b> (or a source in <b>📂 Open saved workflow</b>) to open a source’s views:</p>
        <ul className="gdefs">
          <li><b>Table</b> — the standardized rows, including the conformed <code>country</code> column (ISO3 when the source provides it).</li>
          <li><b>Charts</b> — a drag-and-drop builder over the data: bar, line, area, pie, scatter, histogram.</li>
          <li><b>Map</b> — geographic rows as points (or a density heatmap for grid sources like WorldPop). Non-geographic sources have an empty map — the Table still works.</li>
        </ul>
        <p>
          <b>🌐 All data</b> is the unified cross-source view: every source together, filterable by
          source / country / year, as a table, cross-source charts, and a source-colored map.
        </p>
      </>
    ),
  },
  {
    id: "api",
    title: "Using the output (API)",
    body: (
      <>
        <p>
          The standardized data isn’t locked in the UI — every source is a <b>live REST endpoint</b>,
          so other tools and people can consume it. Open <b>🔌 API</b> in the top bar to browse and copy them.
        </p>
        <ul className="gdefs">
          <li><b>JSON</b> — <code>/api/sources/&#123;id&#125;/records</code> (per source) and <code>/api/unified/records</code> (all sources).</li>
          <li><b>CSV</b> — add <code>?format=csv</code> to either records endpoint for a download (great for Excel / pandas).</li>
          <li><b>GeoJSON</b> — <code>/api/sources/&#123;id&#125;/geojson</code> or <code>/api/unified/geojson</code>, for GIS tools (QGIS) and maps.</li>
          <li><b>Aggregates</b> — <code>/api/unified/aggregate?dimension=source|country|year|month</code> for counts.</li>
        </ul>
        <p className="gnote">
          No API key or auth. Filter the unified endpoints with <code>?source=&amp;country=&amp;year=</code>, page with
          <code> limit</code>/<code>offset</code>. Full interactive reference (try it in the browser) lives at <code>/docs</code>.
        </p>
      </>
    ),
  },
  {
    id: "dashboard",
    title: "Dashboard",
    body: (
      <>
        <p><b>📊 Dashboard</b> is a customizable widget board — your platform at a glance.</p>
        <ul className="gdefs">
          <li><b>Overview KPIs</b> — total records, sources, countries, time span, scheduled count, health.</li>
          <li><b>Source health</b> &amp; <b>Recent sync runs</b> — status, row counts, last-synced, schedule, and the latest runs (with errors). Click a row to open that source.</li>
          <li><b>Charts</b> — records by source / country / year / month, bar or pie.</li>
          <li><b>Cross-source map</b> — all geographic records, colored by source.</li>
        </ul>
        <p className="gnote">
          Click <b>✎ Edit layout</b> to add, remove, resize (half ↔ full) and drag-reorder widgets.
          Your layout is saved in the browser. <b>↺ Reset to default</b> restores it.
        </p>
      </>
    ),
  },
  {
    id: "drought",
    title: "Drought monitor",
    body: (
      <>
        <p>
          <b>🌵 Drought</b> is a focused monitoring view for drought-prone districts (currently
          Madagascar &amp; Angola). It’s built on the same integrator — a curated <b>Open-Meteo</b>
          source (no key) pulls daily <b>precipitation</b>, <b>evapotranspiration (ET0)</b>, and
          topsoil <b>soil moisture</b> per location; the view distills them into an indicative index.
        </p>
        <ul className="gdefs">
          <li><b>Dryness index (0–100)</b> — 60% topsoil-moisture dryness + 40% 30-day water-balance deficit (ET0 − rainfall). Status: Normal / Watch / Moderate / Severe. <i>Indicative, not official SPI.</i></li>
          <li><b>Severity map</b> — each location colored by status; click for soil moisture, rainfall and ET0.</li>
          <li><b>Rainfall &amp; soil moisture</b> — region-averaged daily time-series (rain bars + soil-moisture line).</li>
          <li><b>Locations table &amp; Alerts</b> — per-location 7-/30-day rainfall, water balance, and the Moderate/Severe alerts.</li>
          <li><b>🔮 Forecast model (predictive)</b> — fits a least-squares trend to the trailing drought index and projects it <b>14 days forward</b> with an uncertainty band and Moderate/Severe threshold crossings. Pick any location from the selector. A transparent, explainable model — indicative, not official SPI.</li>
          <li><b>7-day outlook</b> — per-location ▲ Worsening / ▼ Improving / ▬ Stable, with the projected index and status change (e.g. <i>Watch → Moderate</i>).</li>
        </ul>
        <p className="gnote">
          First open offers <b>⬇ Load drought data</b> (pulls ~8 locations from Open-Meteo, ~15–30s).
          It’s an ordinary source underneath, so it’s also in the catalog, the API, and can be scheduled.
        </p>
      </>
    ),
  },
  {
    id: "schedule",
    title: "Scheduling & saving",
    body: (
      <>
        <p>
          Set a cadence in the <b>⏰ Trigger</b> node, then <b>▶ Run</b> to save. The source now
          re-syncs on its own — schedules are stored in Postgres (APScheduler, no broker) and
          survive restarts.
        </p>
        <p>
          <b>Where does my workflow get saved?</b> When you click <b>▶ Run</b>, the workflow is stored
          as a row in <b>Postgres</b> (the <code>sources</code> table) — the whole mapping/config lives in a
          JSONB column, and the pulled data lands in <code>records</code>. There’s no separate file: a
          “saved workflow” <i>is</i> that source. So it persists across restarts and is the same thing the
          API and Dashboard read.
        </p>
        <p>
          Reopen one any time from the top bar → <b>📂 Open saved workflow</b>; the whole pipeline rebuilds
          on the canvas, fully editable. Re-running with <b>Replace</b> mode refreshes all rows.
        </p>
        <p className="gnote">
          See scheduled jobs in the <b>Dashboard</b> KPIs / Source-health (the <i>Schedule</i> column).
          The <b>Dashboard</b> layout itself is the one thing saved in your browser (localStorage), not Postgres.
        </p>
      </>
    ),
  },
  {
    id: "tips",
    title: "Tips & troubleshooting",
    body: (
      <>
        <ul className="gdefs">
          <li><b>Map looks empty?</b> The source has no lat/lon (non-geographic) — expected. The Table still works.</li>
          <li><b>Most reliable path:</b> catalog <i>WPDx</i> → Run → Table → Map. Needs no network luck beyond the WPDx API.</li>
          <li><b>In-browser AI slow / no suggestions?</b> The first run downloads the model (~1–2 GB, then cached). Needs WebGPU (Chrome/Edge).</li>
          <li><b>Clean slate:</b> <b>+ New</b> resets the canvas without touching saved sources.</li>
          <li><b>Filter at the source</b> with query parameters (country / ISO, date ranges, limits) to pull less; re-<b>Inspect</b> or <b>Run</b> after editing.</li>
        </ul>
        <p className="gnote">Fully open source (Postgres/PostGIS + FastAPI + React Flow), self-hostable, no vendor lock-in, no API keys required.</p>
      </>
    ),
  },
];

export default function Help({ onClose }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const sec = SECTIONS.find((s) => s.id === active) || SECTIONS[0];
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span style={{ fontSize: 20 }}>📖</span>
          <b>Guide</b>
          <span className="muted">· how to use openWASHdip</span>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="ghelp">
          <nav className="gtoc">
            {SECTIONS.map((s) => (
              <button key={s.id} className={"gtoc-item" + (s.id === active ? " on" : "")} onClick={() => setActive(s.id)}>
                {s.title}
              </button>
            ))}
          </nav>
          <article className="gcontent">
            <h2>{sec.title}</h2>
            {sec.body}
          </article>
        </div>
      </div>
    </div>
  );
}
