import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api } from "../api.js";

const PALETTE = ["#2563eb", "#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];

// A cross-source view over the conformed dimensions (source · country · time).
export default function Unified({ onClose }) {
  const [filters, setFilters] = useState({ sources: [], countries: [], years: [] });
  const [sel, setSel] = useState({ source: "", country: "", year: "" });
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState("table");

  useEffect(() => {
    api.unifiedFilters().then(setFilters).catch(() => {});
    api.unifiedSummary().then(setSummary).catch(() => {});
  }, []);

  const q = useMemo(() => ({ source: sel.source || null, country: sel.country || null, year: sel.year || null }), [sel]);
  const set = (k) => (e) => setSel((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span style={{ fontSize: 20 }}>🌐</span>
          <b>All data</b>
          {summary && <span className="muted">· {summary.records} records · {summary.sources} sources · {summary.countries} countries</span>}
          <div className="tabs" style={{ marginLeft: 16 }}>
            <button className={tab === "table" ? "on" : ""} onClick={() => setTab("table")}>Table</button>
            <button className={tab === "charts" ? "on" : ""} onClick={() => setTab("charts")}>Charts</button>
            <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>Map</button>
          </div>
          <button className="x" onClick={onClose}>×</button>
        </div>

        <div className="ufilters">
          <span className="muted">Filter:</span>
          <select value={sel.source} onChange={set("source")}>
            <option value="">All sources</option>
            {filters.sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          <select value={sel.country} onChange={set("country")}>
            <option value="">All countries</option>
            {filters.countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sel.year} onChange={set("year")}>
            <option value="">All years</option>
            {filters.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          {(sel.source || sel.country || sel.year) && (
            <button className="ghost" onClick={() => setSel({ source: "", country: "", year: "" })}>Clear</button>
          )}
        </div>

        <div className="mbody">
          {tab === "table" && <UTable q={q} />}
          {tab === "charts" && <UCharts q={q} />}
          {tab === "map" && <UMap q={q} />}
        </div>
      </div>
    </div>
  );
}

function UTable({ q }) {
  const [data, setData] = useState({ total: 0, records: [] });
  useEffect(() => { api.unifiedRecords({ ...q, limit: 500 }).then(setData).catch(() => {}); }, [q]);
  if (!data.records.length) return <p className="muted">No records for this filter.</p>;
  const cols = ["source", "country", "event_time", "external_id", "lat", "lon"];
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>{data.total} records (showing {data.records.length})</p>
      <table>
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{data.records.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmt(r[c])}</td>)}</tr>)}</tbody>
      </table>
    </>
  );
}

function UCharts({ q }) {
  const [dimension, setDimension] = useState("source");
  const [chart, setChart] = useState("bar");
  const [data, setData] = useState([]);
  const elRef = useRef(null);
  const ecRef = useRef(null);

  useEffect(() => { api.unifiedAggregate({ ...q, dimension, limit: chart === "pie" ? 10 : 30 }).then((r) => setData(r.data)).catch(() => {}); }, [q, dimension, chart]);

  useEffect(() => {
    if (!elRef.current) return;
    if (!ecRef.current) ecRef.current = echarts.init(elRef.current);
    const ec = ecRef.current;
    if (!data.length) { ec.clear(); return; }
    const base = { color: PALETTE, tooltip: {}, grid: { left: 52, right: 20, top: 24, bottom: 78 } };
    const opt = chart === "pie"
      ? { ...base, series: [{ type: "pie", radius: ["35%", "70%"], data: data.map((d) => ({ name: String(d.key), value: d.value })) }] }
      : { ...base, xAxis: { type: "category", data: data.map((d) => String(d.key)), axisLabel: { rotate: data.length > 6 ? 35 : 0, interval: 0, hideOverlap: true } },
          yAxis: { type: "value", name: "records" }, series: [{ type: "bar", data: data.map((d) => d.value), barMaxWidth: 40 }] };
    ec.setOption(opt, true); ec.resize();
  }, [data, chart]);

  useEffect(() => () => { ecRef.current?.dispose(); ecRef.current = null; }, []);

  return (
    <>
      <div className="ucbar">
        <span className="muted">Records by</span>
        <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
          <option value="source">source</option>
          <option value="country">country</option>
          <option value="year">year</option>
          <option value="month">month</option>
        </select>
        {["bar", "pie"].map((t) => <button key={t} className={"tbtn" + (chart === t ? " on" : "")} onClick={() => setChart(t)}>{t}</button>)}
      </div>
      <div className="chart-canvas" ref={elRef} />
    </>
  );
}

function UMap({ q }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.L) return;
    const m = window.L.map(ref.current).setView([10, 20], 2);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(m);
    api.unifiedGeojson(q).then((gj) => {
      const sources = [...new Set(gj.features.map((f) => f.properties.source))];
      const color = (s) => PALETTE[sources.indexOf(s) % PALETTE.length];
      if (!gj.features.length) return;
      const layer = window.L.geoJSON(gj, {
        pointToLayer: (f, ll) => window.L.circleMarker(ll, { radius: 5, color: color(f.properties.source), fillOpacity: 0.7, weight: 1 }),
        onEachFeature: (f, l) => l.bindPopup(`<b>${f.properties.source}</b><br>${f.properties.country || ""}`),
      }).addTo(m);
      m.fitBounds(layer.getBounds(), { maxZoom: 6 });
      const legend = window.L.control({ position: "bottomright" });
      legend.onAdd = () => {
        const d = window.L.DomUtil.create("div", "maplegend");
        d.innerHTML = sources.map((s) => `<div><i style="background:${color(s)}"></i>${s}</div>`).join("");
        return d;
      };
      legend.addTo(m);
    });
    return () => m.remove();
  }, [q]);
  return <div id="map" ref={ref} />;
}

function fmt(v) { if (v == null) return "—"; if (typeof v === "object") return JSON.stringify(v); return String(v); }
