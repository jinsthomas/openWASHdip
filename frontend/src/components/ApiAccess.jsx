import { useEffect, useState } from "react";
import { api } from "../api.js";

// "Use the output" panel: every source is a live REST endpoint (JSON / GeoJSON / CSV).
// Lists copyable URLs + a curl example, and links to the interactive OpenAPI docs.
export default function ApiAccess({ onClose }) {
  const [sources, setSources] = useState([]);
  const origin = window.location.origin;
  useEffect(() => { api.listSources().then(setSources).catch(() => {}); }, []);

  const firstId = sources[0]?.id;
  const curl = `curl "${origin}/api/sources/${firstId ?? "{id}"}/records?limit=100"`;

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <span style={{ fontSize: 20 }}>🔌</span>
          <b>API access</b>
          <span className="muted">· use the standardized data from anywhere</span>
          <div className="spacer" style={{ flex: 1 }} />
          <a className="ghost btnlink" href={`${origin}/docs`} target="_blank" rel="noreferrer">Open interactive docs ↗</a>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="mbody apipanel">
          <p style={{ marginTop: 0 }}>
            Every integrated source is a live <b>REST endpoint</b> — as <b>JSON</b>, <b>GeoJSON</b>, or
            <b> CSV</b>. No key, no auth. Point a notebook, BI tool, GIS, or another service at these URLs;
            re-syncs keep them current. Full interactive reference at <code>{origin}/docs</code>.
          </p>

          <h3 className="apih">🌐 All data — cross-source</h3>
          <p className="muted apidesc">Every source together (conformed source · country · time · location). Filter with <code>?source=&amp;country=&amp;year=</code>.</p>
          <EndpointRow method="GET" url={`${origin}/api/unified/records`} origin={origin} />
          <EndpointRow method="GET" url={`${origin}/api/unified/records?format=csv`} origin={origin} download />
          <EndpointRow method="GET" url={`${origin}/api/unified/geojson`} origin={origin} />
          <EndpointRow method="GET" url={`${origin}/api/unified/aggregate?dimension=source`} origin={origin} />

          <h3 className="apih">🗄 Per source</h3>
          {!sources.length && <p className="muted">No sources yet — run a workflow first.</p>}
          {sources.map((s) => (
            <div className="apisrc" key={s.id}>
              <div className="apisrc-head">
                <b>{s.title}</b>
                <span className="muted">· id {s.id} · {s.last_row_count ?? 0} rows</span>
              </div>
              <EndpointRow method="GET" url={`${origin}/api/sources/${s.id}/records`} origin={origin} />
              <EndpointRow method="GET" url={`${origin}/api/sources/${s.id}/records?format=csv`} origin={origin} download />
              <EndpointRow method="GET" url={`${origin}/api/sources/${s.id}/geojson`} origin={origin} />
            </div>
          ))}

          <h3 className="apih">⌨ Use it from code</h3>
          <pre className="apicode">{curl}</pre>
          <p className="muted apidesc">
            Same URLs work from Python (<code>pandas.read_csv("…?format=csv")</code>), JS <code>fetch()</code>,
            QGIS (add GeoJSON layer), or any HTTP client. Common params: <code>limit</code>, <code>offset</code>,
            <code> format=csv</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

function EndpointRow({ method, url, origin, download }) {
  const [copied, setCopied] = useState(false);
  const path = url.replace(origin, "");
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="apirow">
      <span className="apimethod">{method}</span>
      <code className="apiurl" title={url}>{path}</code>
      <div className="apirow-actions">
        {download && <a className="apibtn" href={url} download>⤓ Download</a>}
        <button className="apibtn" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
        <a className="apibtn" href={url} target="_blank" rel="noreferrer">Open ↗</a>
      </div>
    </div>
  );
}
