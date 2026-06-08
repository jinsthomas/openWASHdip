import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { api } from "../api.js";

const CHART_TYPES = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "pie", label: "Pie" },
  { id: "scatter", label: "Scatter" },
  { id: "histogram", label: "Histogram" },
];
const NUMERIC_AGGS = ["sum", "avg", "min", "max"];
const AGG_CHARTS = new Set(["bar", "line", "area", "pie"]); // server-aggregated
const PALETTE = ["#2563eb", "#6366f1", "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];

const num = (v) => { const n = Number(v); return v != null && v !== "" && isFinite(n) ? n : null; };

function colType(name, sample) {
  if (name === "event_time") return "time";
  if (name === "lat" || name === "lon") return "num";
  const v = sample?.[name];
  return v != null && v !== "" && !isNaN(Number(v)) ? "num" : "cat";
}
const ICON = { num: "#", cat: "A", time: "🕐" };

function histo(vals, n = 12) {
  const min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) return [{ label: String(min), count: vals.length }];
  const w = (max - min) / n;
  const bins = Array.from({ length: n }, (_, i) => ({ lo: min + i * w, hi: min + (i + 1) * w, count: 0 }));
  vals.forEach((v) => { let i = Math.floor((v - min) / w); i = Math.max(0, Math.min(n - 1, i)); bins[i].count++; });
  const f = (x) => (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100);
  return bins.map((b) => ({ label: `${f(b.lo)}–${f(b.hi)}`, count: b.count }));
}

export default function Charts({ sourceId, columns, sample, records = [] }) {
  const [dimension, setDimension] = useState(null);
  const [measure, setMeasure] = useState(null);
  const [agg, setAgg] = useState("count");
  const [chart, setChart] = useState("bar");
  const [bucket, setBucket] = useState("month");
  const [agData, setAgData] = useState(null); // server-aggregated [{key,value}]
  const [msg, setMsg] = useState("");
  const elRef = useRef(null);
  const chartRef = useRef(null);

  const isAgg = AGG_CHARTS.has(chart);
  const types = useMemo(() => Object.fromEntries(columns.map((c) => [c, colType(c, sample)])), [columns, sample]);

  // Server aggregation for bar/line/area/pie.
  useEffect(() => {
    if (!isAgg) return;
    if (!dimension) { setAgData(null); return; }
    if (agg !== "count" && !measure) { setMsg("Drop a numeric column on Measure, or set aggregation to Count."); return; }
    setMsg("");
    api.aggregate(sourceId, {
      dimension, agg, measure: agg === "count" ? null : measure,
      bucket: types[dimension] === "time" ? bucket : null, limit: chart === "pie" ? 8 : 30,
    }).then((r) => setAgData(r.data)).catch((e) => setMsg(e.message));
  }, [sourceId, dimension, measure, agg, chart, bucket, types, isAgg]);

  // Render (aggregated types use agData; scatter/histogram compute from loaded rows).
  useEffect(() => {
    if (!elRef.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(elRef.current);
    const ec = chartRef.current;
    const base = { color: PALETTE, tooltip: {}, grid: { left: 52, right: 20, top: 30, bottom: 72 } };
    let option = null;

    if (chart === "scatter") {
      setMsg(dimension && measure ? "" : "Drop a numeric column on X and another on Y.");
      const pts = records.map((r) => [num(r[dimension]), num(r[measure])]).filter((p) => p[0] != null && p[1] != null).slice(0, 2000);
      if (dimension && measure) option = {
        ...base, xAxis: { type: "value", name: dimension, scale: true }, yAxis: { type: "value", name: measure, scale: true },
        series: [{ type: "scatter", symbolSize: 7, itemStyle: { opacity: 0.65 }, data: pts }],
      };
    } else if (chart === "histogram") {
      setMsg(dimension ? "" : "Drop a numeric column on Value to see its distribution.");
      const vals = records.map((r) => num(r[dimension])).filter((v) => v != null);
      if (!dimension) option = null;
      else if (!vals.length) setMsg(`“${dimension}” has no numeric values to bin.`);
      else { const bins = histo(vals, 12); option = {
        ...base, xAxis: { type: "category", data: bins.map((b) => b.label), axisLabel: { rotate: 35, interval: 0, hideOverlap: true } },
        yAxis: { type: "value", name: "count" }, series: [{ type: "bar", data: bins.map((b) => b.count), barMaxWidth: 40 }],
      }; }
    } else {
      // bar / line / area / pie
      if (!agData || !agData.length) { ec.clear(); return; }
      const keys = agData.map((d) => String(d.key)), vals = agData.map((d) => d.value);
      if (chart === "pie") option = { ...base, series: [{ type: "pie", radius: ["35%", "70%"], data: agData.map((d) => ({ name: String(d.key), value: d.value })) }] };
      else option = {
        ...base, xAxis: { type: "category", data: keys, axisLabel: { rotate: keys.length > 6 ? 35 : 0, interval: 0, hideOverlap: true } },
        yAxis: { type: "value", name: agg === "count" ? "count" : `${agg} of ${measure}` },
        series: [{ type: chart === "area" ? "line" : chart, areaStyle: chart === "area" ? {} : undefined, smooth: chart !== "bar", data: vals, barMaxWidth: 40 }],
      };
    }

    if (option) { ec.setOption(option, true); ec.resize(); } else ec.clear();
  }, [agData, chart, agg, measure, dimension, records]);

  useEffect(() => {
    const r = () => chartRef.current?.resize();
    window.addEventListener("resize", r);
    return () => { window.removeEventListener("resize", r); chartRef.current?.dispose(); chartRef.current = null; };
  }, []);

  const onDrop = (setter) => (e) => { e.preventDefault(); const c = e.dataTransfer.getData("col"); if (c) setter(c); };
  const allow = (e) => e.preventDefault();

  // Shelf labels adapt to the chart type.
  const xLabel = chart === "scatter" ? "X (numeric)" : chart === "histogram" ? "Value (numeric)" : "Group by (X)";
  const showY = chart !== "histogram" && chart !== "pie" ? true : chart === "pie";

  return (
    <div className="charts">
      <div className="chart-cols">
        <div className="lbl">Columns — drag onto a shelf</div>
        {columns.map((c) => (
          <div key={c} className="colchip" draggable onDragStart={(e) => e.dataTransfer.setData("col", c)}>
            <span className="ci">{ICON[types[c]]}</span>{c}
          </div>
        ))}
      </div>

      <div className="chart-main">
        <div className="shelves">
          <div className="shelf" onDrop={onDrop(setDimension)} onDragOver={allow}>
            <span className="slbl">{xLabel}</span>
            <span className="sval">{dimension || "drop a column"}</span>
            {dimension && <button className="sx" onClick={() => setDimension(null)}>×</button>}
            {dimension && isAgg && types[dimension] === "time" && (
              <select value={bucket} onChange={(e) => setBucket(e.target.value)} onClick={(e) => e.stopPropagation()}>
                {["day", "week", "month", "quarter", "year"].map((b) => <option key={b}>{b}</option>)}
              </select>
            )}
          </div>

          {chart !== "histogram" && (
            <div className="shelf" onDrop={onDrop((c) => { setMeasure(c); if (isAgg && agg === "count") setAgg("sum"); })} onDragOver={allow}>
              <span className="slbl">{chart === "scatter" ? "Y (numeric)" : "Measure (Y)"}</span>
              {isAgg && (
                <select value={agg} onChange={(e) => setAgg(e.target.value)}>
                  <option value="count">count of rows</option>
                  {NUMERIC_AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              )}
              {(!isAgg || agg !== "count") && <span className="sval">{measure || "drop a numeric column"}</span>}
              {(!isAgg || agg !== "count") && measure && <button className="sx" onClick={() => setMeasure(null)}>×</button>}
            </div>
          )}

          <div className="shelf types">
            {CHART_TYPES.map((t) => (
              <button key={t.id} className={"tbtn" + (chart === t.id ? " on" : "")} onClick={() => setChart(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>

        {msg && <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>{msg}</div>}
        {!dimension && !msg && <div className="muted" style={{ fontSize: 12, padding: "4px 0" }}>Drag a column onto the first shelf to start. Try <b>status</b>, <b>country</b>, or <b>install_year</b>.</div>}
        <div className="chart-canvas" ref={elRef} />
      </div>
    </div>
  );
}
