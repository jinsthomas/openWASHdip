import { useState } from "react";
import { api } from "../api.js";
import { buildConfig, proposalToColumns } from "../pipeline.js";
import { suggestEndpoints, webgpuAvailable } from "../webllm.js";

const ICONS = { trigger: "⏰", source: "🌐", map: "🔀", filter: "🔎", database: "🗄" };
const TITLES = { trigger: "Trigger", source: "Source", map: "Map fields", filter: "Filter", database: "Database" };

export default function Drawer({ nodeId, pipeline, setPipeline, onClose }) {
  return (
    <div className="drawer">
      <div className="dhead">
        <span className="ic">{ICONS[nodeId]}</span>
        <h2>{TITLES[nodeId]}</h2>
        <button className="x" onClick={onClose}>×</button>
      </div>
      <div className="dbody">
        {nodeId === "trigger" && <TriggerCfg pipeline={pipeline} setPipeline={setPipeline} />}
        {nodeId === "source" && <SourceCfg pipeline={pipeline} setPipeline={setPipeline} />}
        {nodeId === "map" && <MapCfg pipeline={pipeline} setPipeline={setPipeline} />}
        {nodeId === "filter" && <FilterCfg pipeline={pipeline} setPipeline={setPipeline} />}
        {nodeId === "database" && <DatabaseCfg pipeline={pipeline} setPipeline={setPipeline} />}
      </div>
    </div>
  );
}

function TriggerCfg({ pipeline, setPipeline }) {
  const v = pipeline.trigger.interval_minutes ?? "";
  return (
    <>
      <label>Run schedule</label>
      <select value={v} onChange={(e) => setPipeline({ ...pipeline, trigger: { interval_minutes: e.target.value ? Number(e.target.value) : null } })}>
        <option value="">Manual only</option>
        <option value="60">Every hour</option>
        <option value="360">Every 6 hours</option>
        <option value="1440">Daily</option>
      </select>
      <p className="muted" style={{ marginTop: 12 }}>
        Scheduled syncs persist in Postgres and keep running even after a restart.
      </p>
    </>
  );
}

function SourceCfg({ pipeline, setPipeline }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tool, setTool] = useState(null); // null | 'discover' | 'ai'
  const [find, setFind] = useState("");
  const [progress, setProgress] = useState("");
  const [cands, setCands] = useState([]);
  const EXAMPLE = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=50&minmagnitude=4";

  async function inspect(url) {
    const target = (url ?? pipeline.source.url).trim();
    setBusy(true); setMsg("Fetching a sample and proposing a mapping…");
    try {
      const { proposal } = await api.propose(target, pipeline.source.params);
      const cols = proposalToColumns(proposal);
      setPipeline({
        ...pipeline,
        source: { ...pipeline.source, url: target, records_path: proposal.records_path, proposer: proposal._proposer, detected: cols.length },
        columns: cols,
        database: { ...pipeline.database, slug: pipeline.database.slug || guessSlug(target), title: pipeline.database.title || guessSlug(target) },
      });
      setMsg(`AI mapped ${cols.length} columns (${proposal._proposer}). Open the Map node to review.`);
    } catch (e) { setMsg(""); setErr(setMsg, e); }
    setBusy(false);
  }

  async function runDiscover() {
    setBusy(true); setCands([]); setMsg("Searching for working API endpoints…");
    try {
      const { candidates } = await api.discover((find || pipeline.source.url).trim());
      setCands(candidates);
      setMsg(candidates.length ? `Found ${candidates.length} working endpoint(s).` : "No working endpoints found here — try the source's API docs page.");
    } catch (e) { setMsg(""); setErr(setMsg, e); }
    setBusy(false);
  }

  async function runAI() {
    if (!webgpuAvailable()) { setMsg("⚠ This browser has no WebGPU. Use Chrome/Edge, or try “Suggest from URL.”"); return; }
    setBusy(true); setCands([]); setProgress(""); setMsg("");
    try {
      const urls = await suggestEndpoints(find.trim(), (t) => setProgress(t));
      setProgress("");
      if (!urls.length) { setMsg("The model didn't return any URLs — try rephrasing."); setBusy(false); return; }
      setMsg(`AI proposed ${urls.length} URL(s) — verifying…`);
      const { candidates } = await api.verify(urls);
      // Show ALL the model's suggestions: verified ones first, then the rest (try/edit).
      const vmap = new Map(candidates.map((c) => [c.url, c]));
      const merged = urls.map((u) => vmap.get(u) || { url: u, unverified: true });
      merged.sort((a, b) => (a.unverified ? 1 : 0) - (b.unverified ? 1 : 0));
      setCands(merged);
      setMsg(candidates.length
        ? `${candidates.length} of ${urls.length} returned data ✓`
        : `${urls.length} suggested, none returned data directly — try or edit one below.`);
    } catch (e) { setProgress(""); setMsg(""); setErr(setMsg, e); }
    setBusy(false);
  }

  return (
    <>
      <label>Data source API URL</label>
      <input value={pipeline.source.url} placeholder={EXAMPLE}
        onChange={(e) => setPipeline({ ...pipeline, source: { ...pipeline.source, url: e.target.value } })} />
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={() => inspect()} disabled={busy || !pipeline.source.url.trim()}>Inspect with AI →</button>
        <button className="ghost" onClick={() => setPipeline({ ...pipeline, source: { ...pipeline.source, url: EXAMPLE } })}>Load example</button>
      </div>
      <div className={"msg" + (msg.startsWith("AI mapped") ? " ok" : "")}>{msg}</div>

      <label style={{ marginTop: 18 }}>Query parameters (one <code>key=value</code> per line)</label>
      <textarea style={{ minHeight: 64 }} placeholder={"clean_country_id=KEN\n$limit=500"}
        value={paramsToText(pipeline.source.params)}
        onChange={(e) => setPipeline({ ...pipeline, source: { ...pipeline.source, params: textToParams(e.target.value) } })} />
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        Sent with every request — use for country / ISO codes, date ranges, limits. Re-<b>Inspect</b> or <b>Run</b> after editing.
      </div>

      <label style={{ marginTop: 18 }}>Don't have the endpoint? Find one</label>
      <div className="row">
        <button className={"ghost" + (tool === "discover" ? " on" : "")} onClick={() => { setTool("discover"); setCands([]); setFind(pipeline.source.url); }}>🔎 From a URL</button>
        <button className={"ghost" + (tool === "ai" ? " on" : "")} onClick={() => { setTool("ai"); setCands([]); setFind(""); }}>✨ Ask AI by name</button>
      </div>

      {tool === "discover" && (
        <div style={{ marginTop: 8 }}>
          <input value={find} placeholder="https://example.org/api-docs or a domain" onChange={(e) => setFind(e.target.value)} />
          <button style={{ marginTop: 8 }} onClick={runDiscover} disabled={busy || !find.trim()}>Search endpoints</button>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Scrapes the page + OpenAPI specs, probes common paths, and verifies each by fetching.</div>
        </div>
      )}
      {tool === "ai" && (
        <div style={{ marginTop: 8 }}>
          <input value={find} placeholder="e.g. water points in Kenya, air quality sensors" onChange={(e) => setFind(e.target.value)} />
          <button style={{ marginTop: 8 }} onClick={runAI} disabled={busy || !find.trim()}>Suggest with in-browser AI</button>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Runs an open model (Llama-3.2-3B) in your browser (WebGPU, no key). First use downloads ~2 GB, then cached.</div>
          {progress && <div className="msg">⏳ {progress}</div>}
        </div>
      )}

      {cands.length > 0 && (
        <div className="cands">
          {cands.map((c, i) => (
            <div className={"cand" + (c.unverified ? " unverified" : "")} key={i}>
              <div className="crow"><span className="curl" title={c.url}>{c.url}</span>
                <button onClick={() => { const u = c.url; setTool(null); setCands([]); setPipeline((p) => ({ ...p, source: { ...p.source, url: u } })); inspect(u); }}>
                  {c.unverified ? "Try" : "Use"}</button></div>
              <div className="cmeta">
                {c.unverified ? "AI suggested — didn't return data directly; try it or edit the URL" : `${c.count} records · ${(c.fields || []).slice(0, 6).join(", ")}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MapCfg({ pipeline, setPipeline }) {
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState("");
  const cols = pipeline.columns;

  function setCol(i, patch) {
    const next = cols.map((c, j) => (j === i ? { ...c, ...patch } : c));
    setPipeline({ ...pipeline, columns: next });
  }

  async function preview() {
    setMsg("Pulling a 5-row preview…"); setRows(null);
    try {
      const { records } = await api.preview({ ...buildConfig(pipeline), _limit: 5 });
      setRows(records); setMsg("");
    } catch (e) { setErr(setMsg, e); }
  }

  if (!cols.length) return <p className="muted">Configure the Source and click <b>Inspect with AI</b> first — the proposed columns appear here.</p>;

  return (
    <>
      <label>Columns this source will create</label>
      <div className="mapper">
        <div className="mrow hdr"><span></span><span>source field</span><span>→ column</span><span>role</span></div>
        {cols.map((c, i) => (
          <div className="mrow" key={i}>
            <input type="checkbox" checked={c.include} onChange={(e) => setCol(i, { include: e.target.checked })} />
            <span className="src" title={c.source_path}>{c.source_path}</span>
            <input value={c.column} onChange={(e) => setCol(i, { column: e.target.value })} />
            <select value={c.role} onChange={(e) => setCol(i, { role: e.target.value })}>
              <option value="">—</option>
              <option value="id">id</option>
              <option value="lat">lat</option>
              <option value="lon">lon</option>
              <option value="time">time</option>
              <option value="country">country</option>
            </select>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="ghost" onClick={preview}>Preview 5 rows ▾</button>
      </div>
      <div className="msg">{msg}</div>
      {rows && rows.length > 0 && (
        <div className="ptable" style={{ marginTop: 10 }}>
          <table>
            <thead><tr>{Object.keys(rows[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{Object.keys(rows[0]).map((k) => <td key={k}>{fmt(r[k])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FilterCfg({ pipeline, setPipeline }) {
  const f = pipeline.filter;
  const fields = pipeline.columns.filter((c) => c.include && !c.role).map((c) => c.column);
  const set = (patch) => setPipeline({ ...pipeline, filter: { ...f, ...patch } });
  return (
    <>
      <label><input type="checkbox" style={{ width: "auto", marginRight: 8 }} checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Filter enabled</label>
      <label>Column</label>
      <select value={f.field} onChange={(e) => set({ field: e.target.value })}>
        <option value="">Choose a column…</option>
        {fields.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label>Condition</label>
      <div className="row">
        <select value={f.op} style={{ width: 90 }} onChange={(e) => set({ op: e.target.value })}>
          <option value=">">&gt;</option><option value=">=">&ge;</option>
          <option value="<">&lt;</option><option value="<=">&le;</option>
          <option value="==">=</option><option value="contains">contains</option>
        </select>
        <input value={f.value} placeholder="value" onChange={(e) => set({ value: e.target.value })} />
      </div>
      <p className="muted" style={{ marginTop: 12 }}>Keeps only rows where the column meets the condition (applied during the pull).</p>
    </>
  );
}

function DatabaseCfg({ pipeline, setPipeline }) {
  const d = pipeline.database;
  const set = (patch) => setPipeline({ ...pipeline, database: { ...d, ...patch } });
  return (
    <>
      <label>Table name</label>
      <input value={d.slug} placeholder="usgs-quakes" onChange={(e) => set({ slug: e.target.value })} />
      <label>Display title</label>
      <input value={d.title} placeholder="USGS earthquakes" onChange={(e) => set({ title: e.target.value })} />
      <label>Write mode</label>
      <select value={d.mode} onChange={(e) => set({ mode: e.target.value })}>
        <option value="replace">Replace (refresh all rows each run)</option>
        <option value="append" disabled>Append (coming soon)</option>
        <option value="upsert" disabled>Upsert by id (coming soon)</option>
      </select>
      <p className="muted" style={{ marginTop: 12 }}>Rows land in Postgres / PostGIS. Geographic rows also get a spatial point for the Map view.</p>
    </>
  );
}

function paramsToText(p) {
  return Object.entries(p || {}).map(([k, v]) => `${k}=${v}`).join("\n");
}
function textToParams(t) {
  const o = {};
  t.split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => {
    const i = l.indexOf("=");
    if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  return o;
}
function guessSlug(u) {
  try { return (new URL(u).hostname.split(".").slice(-2, -1)[0] || "source").replace(/[^a-z0-9-]/g, ""); }
  catch { return "source"; }
}
function fmt(v) { if (v == null) return "—"; if (typeof v === "object") return JSON.stringify(v); return String(v); }
function setErr(setMsg, e) { setMsg("⚠ " + e.message); }
