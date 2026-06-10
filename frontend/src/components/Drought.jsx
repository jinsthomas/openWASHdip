import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { api } from "../api.js";

// 🌵 Drought monitor — a focused view over the "drought-openmeteo" source:
// per-location dryness index (soil moisture + rainfall deficit), a region map,
// a precipitation/soil-moisture time-series, and an alert list.
const STATUS_COLOR = { Severe: "#dc2626", Moderate: "#ea580c", Watch: "#eab308", Normal: "#16a34a" };
const statusColor = (s) => STATUS_COLOR[s] || "#94a3b8";
const TREND = {
  Worsening: { arrow: "▲", color: "#dc2626" },
  Improving: { arrow: "▼", color: "#16a34a" },
  Stable: { arrow: "▬", color: "#64748b" },
};

export default function Drought({ onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const load = () => api.droughtOverview().then(setData).catch(() => setData({ source_id: null }));
  useEffect(() => { load(); }, []);

  async function loadData() {
    setErr(""); setLoading(true);
    try {
      const cat = await api.catalog();
      const entry = cat.find((c) => c.id === "drought-southern-africa");
      if (!entry) throw new Error("Drought source not in catalog.");
      try {
        await api.createSource({ slug: entry.slug, title: entry.name, config: entry.config, interval_minutes: null });
      } catch (e) { if (!String(e.message).includes("already exists")) throw e; }
      await load();
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  const s = data?.summary;
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet dash-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span style={{ fontSize: 20 }}>🌵</span>
          <b>Drought monitor</b>
          {s && <span className="muted">· {s.region} · {s.locations} locations · as of {s.as_of}</span>}
          <div className="spacer" style={{ flex: 1 }} />
          <button className="ghost" onClick={load}>↻ Refresh</button>
          <button className="x" onClick={onClose}>×</button>
        </div>

        {data && !data.source_id ? (
          <div className="droempty">
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No drought data loaded yet</p>
            <p className="muted" style={{ maxWidth: 460, textAlign: "center" }}>
              Pulls daily precipitation, evapotranspiration and soil moisture for drought-prone
              districts in Madagascar &amp; Angola from Open-Meteo (no key). Takes ~15–30s.
            </p>
            <button onClick={loadData} disabled={loading}>{loading ? "Loading… (Open-Meteo)" : "⬇ Load drought data"}</button>
            {err && <div className="msg" style={{ color: "var(--err)" }}>⚠ {err}</div>}
          </div>
        ) : !data ? (
          <div className="droempty"><p className="muted">Loading…</p></div>
        ) : (
          <div className="dash-grid">
            <div className="dash-card span-2"><div className="dash-card-head"><span className="dch-icon">▦</span><span className="dch-title">Drought overview</span></div>
              <div className="dash-card-body"><Kpis s={s} /></div></div>

            <div className="dash-card span-2"><div className="dash-card-head"><span className="dch-icon">🔮</span><span className="dch-title">Drought index forecast — 14-day model</span></div>
              <div className="dash-card-body"><ForecastCard /></div></div>

            <div className="dash-card span-1"><div className="dash-card-head"><span className="dch-icon">🗺</span><span className="dch-title">Severity map</span></div>
              <div className="dash-card-body"><DroMap locations={data.locations} /></div></div>

            <div className="dash-card span-1"><div className="dash-card-head"><span className="dch-icon">▥</span><span className="dch-title">Rainfall &amp; soil moisture (region avg)</span></div>
              <div className="dash-card-body"><DroChart series={data.series} /></div></div>

            <div className="dash-card span-2"><div className="dash-card-head"><span className="dch-icon">☰</span><span className="dch-title">Locations · dryness index</span></div>
              <div className="dash-card-body"><LocTable locations={data.locations} /></div></div>

            <div className="dash-card span-2"><div className="dash-card-head"><span className="dch-icon">⚠</span><span className="dch-title">Alerts ({data.alerts.length})</span></div>
              <div className="dash-card-body"><Alerts alerts={data.alerts} /></div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpis({ s }) {
  if (!s) return null;
  const tiles = [
    { label: "locations", value: s.locations },
    { label: "in deficit", value: s.in_deficit, tone: s.in_deficit ? "warn" : "ok" },
    { label: "alerts", value: s.alerts_count, tone: s.alerts_count ? "warn" : "ok" },
    { label: `worsening (${s.forecast_days ?? 7}d outlook)`, value: `▲ ${s.worsening ?? 0}`, color: s.worsening ? "#dc2626" : "#16a34a" },
    { label: "avg soil moisture", value: s.avg_soil_moisture ?? "—" },
    { label: "driest", value: s.driest?.location ?? "—", color: s.driest && statusColor(s.driest.status) },
  ];
  return (
    <div className="kpis">
      {tiles.map((t) => (
        <div className="kpi" key={t.label}>
          <div className={"kpi-val" + (t.tone ? " " + t.tone : "")} style={t.color ? { color: t.color, fontSize: 16 } : (typeof t.value === "string" ? { fontSize: 16 } : null)}>{t.value}</div>
          <div className="kpi-lbl">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function LocTable({ locations }) {
  return (
    <table className="dash-table">
      <thead><tr>
        <th>Location</th><th>Country</th><th>Soil moisture</th><th>Rain 7d</th><th>Water balance 30d</th>
        <th>Index (now)</th><th>Status</th><th>7-day outlook</th>
      </tr></thead>
      <tbody>
        {locations.map((d) => {
          const tr = TREND[d.trend] || TREND.Stable;
          return (
            <tr key={d.location}>
              <td>{d.location}</td>
              <td>{d.country}</td>
              <td>{d.soil_moisture ?? "—"} <span className="muted">m³/m³</span></td>
              <td>{d.precip_7d} mm</td>
              <td style={{ color: d.water_balance_30d < 0 ? "var(--err)" : "var(--ok)" }}>{d.water_balance_30d} mm</td>
              <td><b>{d.score}</b></td>
              <td><span className="dbadge" style={{ background: statusColor(d.status) }}>{d.status}</span></td>
              <td style={{ color: tr.color, fontWeight: 600, whiteSpace: "nowrap" }}>
                {tr.arrow} {d.outlook_score} <span style={{ fontWeight: 500 }}>{d.trend}</span>
                {d.outlook_delta ? <span className="muted"> ({d.outlook_delta > 0 ? "+" : ""}{d.outlook_delta})</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Alerts({ alerts }) {
  if (!alerts.length) return <p className="muted">No Moderate/Severe locations — conditions are within normal range.</p>;
  return (
    <div className="droalerts">
      {alerts.map((a) => (
        <div className="droalert" key={a.location} style={{ borderLeftColor: statusColor(a.status) }}>
          <div><b>{a.location}</b> <span className="muted">· {a.country}</span> <span className="dbadge" style={{ background: statusColor(a.status) }}>{a.status}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>{a.detail}</div>
        </div>
      ))}
    </div>
  );
}

function ForecastCard() {
  const [loc, setLoc] = useState("");
  const [fc, setFc] = useState(null);
  const elRef = useRef(null);
  const ecRef = useRef(null);

  useEffect(() => { api.droughtForecast(loc).then(setFc).catch(() => setFc(null)); }, [loc]);

  useEffect(() => {
    if (!elRef.current || !fc || !fc.forecast?.length) return;
    if (!ecRef.current) ecRef.current = echarts.init(elRef.current);
    const ec = ecRef.current;

    const hist = fc.history, fit = fc.trend_fit || [], fore = fc.forecast;
    const dates = [...hist.map((p) => p.date), ...fore.map((p) => p.date)];
    const nH = hist.length;
    const pad = (arr, lead, val = "key") => [...Array(lead).fill(null), ...arr.map((p) => (val === "key" ? p.index : p[val]))];

    // Actual index (solid), the fitted+projected trend (dashed, spans fit window → forecast),
    // and a shaded uncertainty band over the forecast only.
    const actual = [...hist.map((p) => p.index), ...Array(fore.length).fill(null)];
    const fitLead = nH - fit.length;
    const trendData = [...Array(fitLead).fill(null), ...fit.map((p) => p.index), ...fore.map((p) => p.index)];
    const loBand = [...Array(nH).fill(null), ...fore.map((p) => p.lo)];
    const rangeBand = [...Array(nH).fill(null), ...fore.map((p) => p.hi - p.lo)];

    ec.setOption({
      tooltip: { trigger: "axis" },
      legend: { data: ["Drought index", "Model + forecast"], top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 40, right: 16, top: 26, bottom: 46 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, hideOverlap: true } },
      yAxis: { type: "value", min: 0, max: 100, name: "index", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series: [
        // confidence band (lo invisible + range filled), forecast region only
        { name: "lo", type: "line", data: loBand, stack: "band", lineStyle: { opacity: 0 }, symbol: "none", silent: true, z: 1 },
        { name: "band", type: "line", data: rangeBand, stack: "band", lineStyle: { opacity: 0 }, areaStyle: { color: "rgba(220,38,38,.14)" }, symbol: "none", silent: true, z: 1 },
        { name: "Drought index", type: "line", data: actual, smooth: true, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: "#2563eb" }, z: 3 },
        { name: "Model + forecast", type: "line", data: trendData, smooth: false, showSymbol: false, lineStyle: { width: 2, type: "dashed" }, itemStyle: { color: "#dc2626" }, z: 4,
          markLine: { silent: true, symbol: "none", data: [
            { yAxis: 70, lineStyle: { color: "#dc2626", type: "dotted" }, label: { formatter: "Severe", fontSize: 9, color: "#dc2626" } },
            { yAxis: 45, lineStyle: { color: "#ea580c", type: "dotted" }, label: { formatter: "Moderate", fontSize: 9, color: "#ea580c" } },
            { xAxis: nH - 1, lineStyle: { color: "#64748b" }, label: { formatter: "today", fontSize: 9, color: "#64748b" } },
          ] } },
      ],
    }, true);
    ec.resize();
  }, [fc]);

  useEffect(() => {
    if (!elRef.current) return;
    const ro = new ResizeObserver(() => ecRef.current?.resize());
    ro.observe(elRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => { ecRef.current?.dispose(); ecRef.current = null; }, []);

  const trendColor = fc && fc.proj_index > fc.now_index ? "#dc2626" : fc && fc.proj_index < fc.now_index ? "#16a34a" : "#64748b";
  return (
    <div className="forecastw">
      <div className="forecastw-bar">
        <span className="muted">Forecast for</span>
        <select value={loc} onChange={(e) => setLoc(e.target.value)}>
          <option value="">All locations (region avg)</option>
          {(fc?.locations || []).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {fc && fc.forecast?.length > 0 && (
          <span className="forecastw-head">
            index <b>{fc.now_index}</b> now → <b style={{ color: trendColor }}>{fc.proj_index}</b> in {fc.horizon}d
            <span className="dbadge" style={{ background: statusColor(fc.proj_status), marginLeft: 6 }}>{fc.proj_status}</span>
            {fc.crosses?.Severe && <span className="muted"> · crosses Severe ~{fc.crosses.Severe}</span>}
            {!fc.crosses?.Severe && fc.crosses?.Moderate && <span className="muted"> · crosses Moderate ~{fc.crosses.Moderate}</span>}
          </span>
        )}
      </div>
      {fc && !fc.forecast?.length
        ? <p className="muted">Not enough history to fit a forecast yet.</p>
        : <div className="forecastw-canvas" ref={elRef} />}
      {fc && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Model: {fc.model} · slope {fc.slope_per_day}/day · shaded band = uncertainty (widens with horizon). Indicative, not official SPI.</div>}
    </div>
  );
}

function DroMap({ locations }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.L) return;
    const m = window.L.map(ref.current).setView([-18, 30], 3);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 18 }).addTo(m);
    const pts = locations.filter((d) => d.lat != null && d.lon != null);
    pts.forEach((d) => {
      window.L.circleMarker([d.lat, d.lon], { radius: 8, color: statusColor(d.status), fillColor: statusColor(d.status), fillOpacity: 0.8, weight: 2 })
        .bindPopup(`<b>${d.location}</b> (${d.country})<br>${d.status} · index ${d.score}<br>soil moisture ${d.soil_moisture} m³/m³<br>rain 30d ${d.precip_30d} mm · ET0 ${d.et0_30d} mm`)
        .addTo(m);
    });
    if (pts.length) m.fitBounds(pts.map((d) => [d.lat, d.lon]), { maxZoom: 6, padding: [20, 20] });
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); m.remove(); };
  }, [locations]);
  return <div className="mapw" ref={ref} />;
}

function DroChart({ series }) {
  const elRef = useRef(null);
  const ecRef = useRef(null);
  useEffect(() => {
    if (!elRef.current) return;
    if (!ecRef.current) ecRef.current = echarts.init(elRef.current);
    const ec = ecRef.current;
    const dates = series.map((p) => p.date);
    const firstFc = series.find((p) => p.forecast)?.date;
    const lastDate = dates[dates.length - 1];
    // Shade the forecast (predicted) portion so it's visually distinct from observed history.
    const markArea = firstFc ? {
      silent: true,
      itemStyle: { color: "rgba(2,132,199,0.08)" },
      label: { show: true, position: "insideTop", formatter: "forecast →", color: "#0369a1", fontSize: 10 },
      data: [[{ xAxis: firstFc }, { xAxis: lastDate }]],
    } : undefined;
    ec.setOption({
      tooltip: { trigger: "axis" },
      legend: { data: ["Rainfall (mm)", "Soil moisture"], top: 0, textStyle: { fontSize: 11 } },
      grid: { left: 44, right: 48, top: 28, bottom: 50 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10, hideOverlap: true } },
      yAxis: [
        { type: "value", name: "mm", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
        { type: "value", name: "m³/m³", min: 0, max: 0.4, position: "right", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      ],
      series: [
        { name: "Rainfall (mm)", type: "bar", data: series.map((p) => p.precip), itemStyle: { color: "#2563eb" }, barMaxWidth: 10, markArea },
        { name: "Soil moisture", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, data: series.map((p) => p.soil_moisture), itemStyle: { color: "#b45309" }, areaStyle: { color: "rgba(180,83,9,.12)" } },
      ],
    }, true);
    ec.resize();
  }, [series]);
  useEffect(() => {
    if (!elRef.current) return;
    const ro = new ResizeObserver(() => ecRef.current?.resize());
    ro.observe(elRef.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => { ecRef.current?.dispose(); ecRef.current = null; }, []);
  return <div className="chartw"><div className="chartw-canvas" ref={elRef} /></div>;
}
