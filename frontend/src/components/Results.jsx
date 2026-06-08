import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Charts from "./Charts.jsx";

export default function Results({ source, onClose }) {
  const [tab, setTab] = useState("table");
  const [data, setData] = useState({ records: [], total: 0 });
  const mapRef = useRef(null);
  const mapObj = useRef(null);

  useEffect(() => {
    api.records(source.id, 500).then(setData).catch(() => {});
  }, [source.id]);

  useEffect(() => {
    if (tab !== "map" || !mapRef.current || !window.L) return;
    const m = window.L.map(mapRef.current).setView([20, 0], 2);
    mapObj.current = m;
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(m);
    api.geojson(source.id).then((gj) => {
      if (!gj.features.length) return;
      const layer = window.L.geoJSON(gj, {
        pointToLayer: (f, ll) => window.L.circleMarker(ll, { radius: 5, color: "#38bdf8", fillOpacity: 0.7 }),
        onEachFeature: (f, l) => l.bindPopup("<pre style='margin:0'>" + JSON.stringify(f.properties, null, 1) + "</pre>"),
      }).addTo(m);
      m.fitBounds(layer.getBounds(), { maxZoom: 8 });
    });
    return () => { m.remove(); mapObj.current = null; };
  }, [tab, source.id]);

  const cols = data.records[0] ? Object.keys(data.records[0]) : [];

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span style={{ fontSize: 20 }}>🗄</span>
          <b>{source.title}</b>
          <span className="muted">· {source.last_row_count ?? 0} rows in Postgres</span>
          <div className="tabs" style={{ marginLeft: 16 }}>
            <button className={tab === "table" ? "on" : ""} onClick={() => setTab("table")}>Table</button>
            <button className={tab === "charts" ? "on" : ""} onClick={() => setTab("charts")}>Charts</button>
            <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>Map</button>
          </div>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="mbody">
          {tab === "table" && (
            !data.records.length ? <p className="muted">No rows.</p> : (
              <table>
                <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{data.records.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmt(r[c])}</td>)}</tr>)}</tbody>
              </table>
            )
          )}
          {tab === "charts" && (
            cols.length ? <Charts sourceId={source.id} columns={cols} sample={data.records[0]} records={data.records} />
              : <p className="muted">No data to chart.</p>
          )}
          {tab === "map" && <div id="map" ref={mapRef} />}
        </div>
      </div>
    </div>
  );
}

function fmt(v) { if (v == null) return "—"; if (typeof v === "object") return JSON.stringify(v); return String(v); }
