import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api } from "../api.js";

const PALETTE = ["#2563eb", "#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];
const LS_KEY = "owd.dashboard.v1";

// The widget catalog — each entry knows how to render itself from shared board data
// (summary · sources · runs) plus its own per-instance options. "All three" dashboards
// in one: operational tiles/health/runs (1), analytics charts/map (2), arranged on a
// customizable, persisted board (3).
const WIDGETS = {
  kpi:    { title: "Overview KPIs",     icon: "▦", defaultW: 2, kind: "ops" },
  health: { title: "Source health",     icon: "❤", defaultW: 2, kind: "ops" },
  runs:   { title: "Recent sync runs",  icon: "⟳", defaultW: 2, kind: "ops" },
  chart:  { title: "Chart",             icon: "▥", defaultW: 1, kind: "analytics" },
  map:    { title: "Cross-source map",  icon: "🗺", defaultW: 2, kind: "analytics" },
};

const DEFAULT_LAYOUT = [
  { id: "w-kpi", type: "kpi", w: 2, opts: {} },
  { id: "w-chart-src", type: "chart", w: 1, opts: { dimension: "source", chart: "bar" } },
  { id: "w-chart-ctry", type: "chart", w: 1, opts: { dimension: "country", chart: "pie" } },
  { id: "w-health", type: "health", w: 2, opts: {} },
  { id: "w-chart-time", type: "chart", w: 2, opts: { dimension: "month", chart: "bar" } },
  { id: "w-map", type: "map", w: 2, opts: {} },
  { id: "w-runs", type: "runs", w: 2, opts: {} },
];

let _idSeq = 0;
const nextId = () => `w-${Date.now().toString(36)}-${_idSeq++}`;

function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY));
    if (Array.isArray(raw) && raw.every((w) => WIDGETS[w.type])) return raw;
  } catch { /* ignore */ }
  return DEFAULT_LAYOUT;
}

export default function Dashboard({ onClose, onOpenSource }) {
  const [layout, setLayout] = useState(loadLayout);
  const [editing, setEditing] = useState(false);
  const [data, setData] = useState({ summary: null, sources: [], runs: [] });
  const dragIdx = useRef(null);

  const refresh = useCallback(() => {
    Promise.all([
      api.unifiedSummary().catch(() => null),
      api.listSources().catch(() => []),
      api.recentRuns(12).catch(() => []),
    ]).then(([summary, sources, runs]) => setData({ summary, sources, runs }));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(layout)); }, [layout]);

  const addWidget = (type) =>
    setLayout((l) => [...l, { id: nextId(), type, w: WIDGETS[type].defaultW, opts: defaultOpts(type) }]);
  const removeWidget = (id) => setLayout((l) => l.filter((w) => w.id !== id));
  const toggleW = (id) => setLayout((l) => l.map((w) => (w.id === id ? { ...w, w: w.w === 2 ? 1 : 2 } : w)));
  const setOpts = (id, opts) => setLayout((l) => l.map((w) => (w.id === id ? { ...w, opts: { ...w.opts, ...opts } } : w)));

  const onDrop = (overIdx) => {
    const from = dragIdx.current;
    dragIdx.current = null;
    if (from == null || from === overIdx) return;
    setLayout((l) => {
      const next = [...l];
      const [moved] = next.splice(from, 1);
      next.splice(overIdx, 0, moved);
      return next;
    });
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet dash-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span style={{ fontSize: 20 }}>📊</span>
          <b>Dashboard</b>
          {data.summary && (
            <span className="muted">
              · {fmtNum(data.summary.records)} records · {data.summary.sources} sources · {data.summary.countries} countries
            </span>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          <button className="ghost" onClick={refresh} title="Reload data">↻ Refresh</button>
          <button className={editing ? "" : "ghost"} onClick={() => setEditing((v) => !v)}>
            {editing ? "✓ Done" : "✎ Edit layout"}
          </button>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {editing && (
          <div className="dash-edit">
            <span className="muted">Add widget:</span>
            {Object.entries(WIDGETS).map(([type, m]) => (
              <button key={type} className="ghost sm" onClick={() => addWidget(type)}>{m.icon} {m.title}</button>
            ))}
            <div style={{ flex: 1 }} />
            <button className="ghost sm" onClick={() => setLayout(DEFAULT_LAYOUT)}>↺ Reset to default</button>
          </div>
        )}

        <div className="dash-grid">
          {layout.map((w, i) => (
            <div
              key={w.id}
              className={"dash-card span-" + w.w + (editing ? " editing" : "")}
              draggable={editing}
              onDragStart={() => { dragIdx.current = i; }}
              onDragOver={(e) => { if (editing) e.preventDefault(); }}
              onDrop={() => onDrop(i)}
            >
              <div className="dash-card-head">
                <span className="dch-icon">{WIDGETS[w.type].icon}</span>
                <span className="dch-title">{WIDGETS[w.type].title}</span>
                {editing && (
                  <span className="dch-tools">
                    <button className="iconbtn" title={w.w === 2 ? "Make half width" : "Make full width"} onClick={() => toggleW(w.id)}>
                      {w.w === 2 ? "▭" : "▢"}
                    </button>
                    <button className="iconbtn" title="Remove" onClick={() => removeWidget(w.id)}>✕</button>
                  </span>
                )}
              </div>
              <div className="dash-card-body">
                <Widget w={w} data={data} setOpts={(o) => setOpts(w.id, o)} onOpenSource={onOpenSource} />
              </div>
            </div>
          ))}
          {layout.length === 0 && (
            <div className="muted" style={{ padding: 24 }}>
              No widgets. Click <b>✎ Edit layout</b> to add some.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function defaultOpts(type) {
  if (type === "chart") return { dimension: "source", chart: "bar" };
  return {};
}

function Widget({ w, data, setOpts, onOpenSource }) {
  switch (w.type) {
    case "kpi": return <KpiWidget data={data} />;
    case "health": return <HealthWidget sources={data.sources} onOpenSource={onOpenSource} />;
    case "runs": return <RunsWidget runs={data.runs} onOpenSource={onOpenSource} />;
    case "chart": return <ChartWidget opts={w.opts} setOpts={setOpts} />;
    case "map": return <MapWidget />;
    default: return null;
  }
}

// ── Operational widgets ──────────────────────────────────────────────────────

function KpiWidget({ data }) {
  const { summary, sources } = data;
  const scheduled = sources.filter((s) => s.interval_minutes && s.enabled).length;
  const ok = sources.filter((s) => s.last_status === "ok").length;
  const bad = sources.filter((s) => s.last_status && s.last_status !== "ok").length;
  const span = summary && summary.time_min && summary.time_max
    ? `${summary.time_min.slice(0, 4)}–${summary.time_max.slice(0, 4)}` : "—";
  const tiles = [
    { label: "records", value: summary ? fmtNum(summary.records) : "—" },
    { label: "sources", value: summary ? summary.sources : sources.length },
    { label: "countries", value: summary ? summary.countries : "—" },
    { label: "time span", value: span },
    { label: "scheduled", value: scheduled },
    { label: "healthy", value: `${ok}${bad ? " / " + bad + "⚠" : ""}`, tone: bad ? "warn" : "ok" },
  ];
  return (
    <div className="kpis">
      {tiles.map((t) => (
        <div className="kpi" key={t.label}>
          <div className={"kpi-val" + (t.tone ? " " + t.tone : "")}>{t.value}</div>
          <div className="kpi-lbl">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function HealthWidget({ sources, onOpenSource }) {
  if (!sources.length) return <p className="muted">No sources yet.</p>;
  return (
    <table className="dash-table">
      <thead><tr><th>Source</th><th>Status</th><th>Rows</th><th>Last synced</th><th>Schedule</th></tr></thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.id} className="rowlink" onClick={() => onOpenSource?.(s.id)} title="Open this source's data">
            <td>{s.title}</td>
            <td><StatusDot status={s.last_status} /></td>
            <td>{s.last_row_count ?? "—"}</td>
            <td>{rel(s.last_synced_at)}</td>
            <td>{s.interval_minutes ? `every ${s.interval_minutes}m` : <span className="muted">manual</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunsWidget({ runs, onOpenSource }) {
  if (!runs.length) return <p className="muted">No sync runs recorded yet.</p>;
  return (
    <table className="dash-table">
      <thead><tr><th>Source</th><th>Status</th><th>Rows</th><th>When</th></tr></thead>
      <tbody>
        {runs.map((r, i) => (
          <tr key={i} className="rowlink" onClick={() => onOpenSource?.(r.source_id)} title={r.error || "Open source"}>
            <td>{r.source}</td>
            <td><StatusDot status={r.status} /></td>
            <td>{r.row_count ?? "—"}</td>
            <td>{rel(r.finished_at || r.started_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusDot({ status }) {
  const tone = status === "ok" ? "ok" : status === "running" ? "run" : status ? "err" : "";
  return <span className="sdot-wrap"><span className={"sdot " + tone} />{status || "—"}</span>;
}

// ── Analytics widgets ────────────────────────────────────────────────────────

function ChartWidget({ opts, setOpts }) {
  const { dimension = "source", chart = "bar" } = opts;
  const [rows, setRows] = useState([]);
  const elRef = useRef(null);
  const ecRef = useRef(null);

  useEffect(() => {
    api.unifiedAggregate({ dimension, limit: chart === "pie" ? 10 : 30 })
      .then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [dimension, chart]);

  useEffect(() => {
    if (!elRef.current) return;
    if (!ecRef.current) ecRef.current = echarts.init(elRef.current);
    const ec = ecRef.current;
    if (!rows.length) { ec.clear(); return; }
    const base = { color: PALETTE, tooltip: {}, grid: { left: 48, right: 16, top: 16, bottom: 64 } };
    const opt = chart === "pie"
      ? { ...base, series: [{ type: "pie", radius: ["38%", "70%"], data: rows.map((d) => ({ name: String(d.key), value: d.value })) }] }
      : { ...base,
          xAxis: { type: "category", data: rows.map((d) => String(d.key)), axisLabel: { rotate: rows.length > 6 ? 35 : 0, interval: 0, hideOverlap: true } },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: rows.map((d) => d.value), barMaxWidth: 36 }] };
    ec.setOption(opt, true); ec.resize();
  }, [rows, chart]);

  // Keep the chart fitted as the card is resized / reflowed.
  useEffect(() => {
    if (!elRef.current) return;
    const ro = new ResizeObserver(() => ecRef.current?.resize());
    ro.observe(elRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => { ecRef.current?.dispose(); ecRef.current = null; }, []);

  return (
    <div className="chartw">
      <div className="chartw-bar">
        <span className="muted">by</span>
        <select value={dimension} onChange={(e) => setOpts({ dimension: e.target.value })}>
          {["source", "country", "year", "month"].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {["bar", "pie"].map((t) => (
          <button key={t} className={"tbtn" + (chart === t ? " on" : "")} onClick={() => setOpts({ chart: t })}>{t}</button>
        ))}
      </div>
      <div className="chartw-canvas" ref={elRef} />
    </div>
  );
}

function MapWidget() {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.L) return;
    const m = window.L.map(ref.current).setView([10, 20], 2);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 18 }).addTo(m);
    api.unifiedGeojson({}).then((gj) => {
      if (!gj.features?.length) return;
      const srcs = [...new Set(gj.features.map((f) => f.properties.source))];
      const color = (s) => PALETTE[srcs.indexOf(s) % PALETTE.length];
      const layer = window.L.geoJSON(gj, {
        pointToLayer: (f, ll) => window.L.circleMarker(ll, { radius: 4, color: color(f.properties.source), fillOpacity: 0.7, weight: 1 }),
        onEachFeature: (f, l) => l.bindPopup(`<b>${f.properties.source}</b><br>${f.properties.country || ""}`),
      }).addTo(m);
      try { m.fitBounds(layer.getBounds(), { maxZoom: 6 }); } catch { /* no bounds */ }
    }).catch(() => {});
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); m.remove(); };
  }, []);
  return <div className="mapw" ref={ref} />;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n) { return n == null ? "—" : Number(n).toLocaleString(); }

function rel(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
