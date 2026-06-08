import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  useNodesState, useEdgesState, useReactFlow, MarkerType,
} from "@xyflow/react";
import { nodeTypes } from "./nodes/nodes.jsx";
import { api } from "./api.js";
import { emptyPipeline, buildConfig, sourceToPipeline, sourceHasFilter, ROLE_LABEL } from "./pipeline.js";
import Drawer from "./components/Drawer.jsx";
import Results from "./components/Results.jsx";
import Unified from "./components/Unified.jsx";

const ORDER_BASE = ["trigger", "source", "map", "database"];
const X0 = 60, DX = 250, Y = 150;
const META = {
  trigger: { icon: "⏰", title: "Trigger" }, source: { icon: "🌐", title: "Source" },
  map: { icon: "🔀", title: "Map fields" }, filter: { icon: "🔎", title: "Filter" },
  database: { icon: "🗄", title: "Database" },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function order(hasFilter) {
  return hasFilter ? ["trigger", "source", "map", "filter", "database"] : ORDER_BASE;
}
function layout(ids) {
  return ids.map((id, i) => ({ id, type: id, position: { x: X0 + i * DX, y: Y }, data: {} }));
}
function edgesFor(ids) {
  const e = [];
  for (let i = 0; i < ids.length - 1; i++)
    e.push({ id: `e-${ids[i]}-${ids[i + 1]}`, source: ids[i], target: ids[i + 1], markerEnd: { type: MarkerType.ArrowClosed } });
  return e;
}

function Flow() {
  const [pipeline, setPipeline] = useState(emptyPipeline);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState({});
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");
  const [results, setResults] = useState(null);
  const [sources, setSources] = useState([]);
  const [hasFilter, setHasFilter] = useState(false);
  const [currentSourceId, setCurrentSourceId] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [showUnified, setShowUnified] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState(layout(ORDER_BASE));
  const [edges, setEdges, onEdgesChange] = useEdgesState(edgesFor(ORDER_BASE));
  const { screenToFlowPosition, fitView } = useReactFlow();
  const wrapRef = useRef(null);

  const refreshSources = useCallback(() => api.listSources().then(setSources).catch(() => {}), []);
  useEffect(() => { refreshSources(); }, [refreshSources]);
  useEffect(() => { api.catalog().then(setCatalog).catch(() => {}); }, []);

  // Build the summary shown inside each node from the current pipeline + status.
  const makeData = useCallback((id) => {
    const m = META[id]; const st = status[id] || "";
    const base = { icon: m.icon, title: m.title, status: st, selected: selected === id, onOpen: () => setSelected(id) };
    if (id === "trigger") {
      const iv = pipeline.trigger.interval_minutes;
      return { ...base, lines: [{ text: iv ? `every ${iv} min` : "manual" }] };
    }
    if (id === "source") {
      let host = "no URL set";
      try { host = pipeline.source.url ? new URL(pipeline.source.url).hostname : "no URL set"; } catch {}
      const lines = [{ text: host }];
      if (pipeline.source.detected != null) lines.push({ text: `${pipeline.source.detected} fields detected`, metric: true });
      return { ...base, lines };
    }
    if (id === "map") {
      const inc = pipeline.columns.filter((c) => c.include);
      const chips = inc.map((c) => ({ label: c.role ? ROLE_LABEL[c.role] : c.column, role: !!c.role }));
      return { ...base, lines: [{ text: inc.length ? `${inc.length} columns` : "not mapped yet", metric: inc.length > 0 }], chips };
    }
    if (id === "filter") {
      const f = pipeline.filter;
      return { ...base, lines: [{ text: f.enabled && f.field ? `${f.field} ${f.op} ${f.value}` : "disabled" }] };
    }
    if (id === "database") {
      return { ...base, lines: [{ text: pipeline.database.slug || "unnamed table", metric: !!pipeline.database.slug }, { text: pipeline.database.mode }] };
    }
    return base;
  }, [pipeline, status, selected]);

  // Re-render node data whenever pipeline/status/selection changes.
  useEffect(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, data: makeData(n.id) })));
  }, [makeData, setNodes]);

  function newIntegration() {
    setPipeline(emptyPipeline()); setStatus({}); setSelected(null); setHasFilter(false);
    setCurrentSourceId(null);
    setNodes(layout(ORDER_BASE)); setEdges(edgesFor(ORDER_BASE));
    setTimeout(() => fitView({ duration: 300 }), 50);
  }

  // Special sources (e.g. WorldPop grid) aren't editable point-mappings — create + show directly.
  async function createSpecial(entry) {
    setToast(`Loading “${entry.name}” … (downloading & binning, may take ~30–60s)`);
    try {
      const s = await api.createSource({ slug: entry.slug, title: entry.name, config: entry.config, interval_minutes: null });
      await refreshSources(); setCurrentSourceId(s.id); setResults(s); setToast("");
    } catch (e) {
      if (String(e.message).includes("already exists")) {
        const ex = (await api.listSources()).find((x) => x.slug === entry.slug);
        if (ex) { setResults(ex); setToast(""); return; }
      }
      setToast("⚠ " + e.message);
    }
  }

  // Load a curated catalog source (verified preset) onto the canvas, ready to Run.
  function openPreset(entry) {
    if ((entry.config?.kind || "rest-points") !== "rest-points") { createSpecial(entry); return; }
    setPipeline(sourceToPipeline({ config: entry.config, slug: entry.slug, title: entry.name, interval_minutes: null }));
    setHasFilter(false);
    setStatus({});
    setCurrentSourceId(null);
    setNodes(layout(ORDER_BASE));
    setEdges(edgesFor(ORDER_BASE));
    setSelected("map");
    setToast(`Loaded “${entry.name}” — review the Map node, then ▶ Run to pull the table.`);
    setTimeout(() => fitView({ duration: 300 }), 60);
  }

  // Reopen a previously-saved (Run) workflow onto the canvas, fully editable.
  function openWorkflow(s) {
    const hf = sourceHasFilter(s);
    const ids = order(hf);
    setPipeline(sourceToPipeline(s));
    setHasFilter(hf);
    setStatus(Object.fromEntries(ids.map((id) => [id, "ok"])));
    setNodes(layout(ids));
    setEdges(edgesFor(ids));
    setCurrentSourceId(s.id);
    setSelected(null);
    setToast(`Opened workflow “${s.title}” — edit, Run to re-sync, or View data.`);
    setTimeout(() => fitView({ duration: 300 }), 60);
  }

  function tidy() {
    const ids = order(hasFilter);
    setNodes((nds) => ids.map((id, i) => ({ ...(nds.find((n) => n.id === id) || { id, type: id }), position: { x: X0 + i * DX, y: Y }, data: makeData(id) })));
    setEdges(edgesFor(ids));
    setTimeout(() => fitView({ duration: 300 }), 50);
  }

  // Drag a node from the palette onto the canvas (free-canvas mode).
  function onDrop(ev) {
    ev.preventDefault();
    const kind = ev.dataTransfer.getData("application/rf");
    if (kind !== "filter" || hasFilter) { if (kind && kind !== "filter") setToast("This node is already in the flow."); return; }
    const pos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
    setHasFilter(true);
    setNodes((nds) => [...nds, { id: "filter", type: "filter", position: pos, data: makeData("filter") }]);
    setEdges((eds) => [
      ...eds.filter((e) => e.id !== "e-map-database"),
      { id: "e-map-filter", source: "map", target: "filter", markerEnd: { type: MarkerType.ArrowClosed } },
      { id: "e-filter-database", source: "filter", target: "database", markerEnd: { type: MarkerType.ArrowClosed } },
    ]);
    setPipeline((pl) => ({ ...pl, filter: { ...pl.filter, enabled: true } }));
    setSelected("filter");
  }

  async function run() {
    const pl = pipeline;
    if (!pl.source.url.trim()) return fail("Set the Source API URL first.", "source");
    const hasLatLon = pl.columns.some((c) => c.role === "lat") && pl.columns.some((c) => c.role === "lon");
    if (!pl.columns.length) return fail("Inspect the source with AI to map columns.", "map");
    if (!pl.database.slug.trim()) return fail("Name the destination table (Database node).", "database");

    setRunning(true); setToast(""); setSelected(null);
    setEdges((eds) => eds.map((e) => ({ ...e, animated: true })));
    const ids = order(hasFilter);
    try {
      // Visual cascade: light up each stage in order.
      setStatus({ trigger: "ok" }); await sleep(250);
      for (const id of ids.slice(1, -1)) { setStatus((s) => ({ ...s, [id]: "run" })); await sleep(350); setStatus((s) => ({ ...s, [id]: "ok" })); }
      setStatus((s) => ({ ...s, database: "run" }));
      const body = {
        slug: pl.database.slug.trim(), title: pl.database.title.trim() || pl.database.slug.trim(),
        config: buildConfig(pl), interval_minutes: pl.trigger.interval_minutes,
      };
      let src;
      try { src = await api.createSource(body); }
      catch (e) {
        if (String(e.message).includes("already exists")) {
          const existing = (await api.listSources()).find((s) => s.slug === body.slug);
          await api.syncSource(existing.id); src = (await api.listSources()).find((s) => s.id === existing.id);
        } else throw e;
      }
      setStatus((s) => ({ ...s, database: "ok" }));
      if (!hasLatLon) setToast("Pulled — note: no lat/lon mapped, so the Map view will be empty (table still works).");
      setCurrentSourceId(src.id);
      await refreshSources();
      setResults(src);
    } catch (e) {
      setStatus((s) => ({ ...s, database: "err" }));
      setToast("⚠ " + e.message);
    } finally {
      setRunning(false);
      setEdges((eds) => eds.map((e) => ({ ...e, animated: false })));
    }
  }
  function fail(msg, node) { setToast("⚠ " + msg); setSelected(node); }

  return (
    <div className="app">
      <div className="topbar">
        <h1>openWASHdip</h1>
        <span className="tag">open-source data integrator</span>
        <div className="spacer" />
        {toast && <span className="muted" style={{ fontSize: 12 }}>{toast}</span>}
        <div className="sources-bar">
          {sources.length > 0 && (
            <select value="" onChange={(e) => { const s = sources.find((x) => x.id === Number(e.target.value)); if (s) openWorkflow(s); e.target.value = ""; }}>
              <option value="">📂 Open saved workflow ({sources.length})…</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.last_row_count ?? 0} rows</option>)}
            </select>
          )}
          <button className="ghost" disabled={!currentSourceId} title="View the data this workflow pulled"
            onClick={() => { const s = sources.find((x) => x.id === currentSourceId); if (s) setResults(s); }}>📊 Data</button>
          <button className="ghost" onClick={() => setShowUnified(true)}>🌐 All data</button>
          <button className="ghost" onClick={tidy}>↹ Tidy</button>
          <button className="ghost" onClick={newIntegration}>+ New</button>
          <button className="run" onClick={run} disabled={running}>{running ? "Running…" : "▶ Run"}</button>
        </div>
      </div>

      <div className="body">
        <div className="palette">
          <h3>Standard sources</h3>
          {catalog.map((e) => (
            <div key={e.id} className="catitem" onClick={() => openPreset(e)} title={e.description}>
              <div className="catrow"><span className="cname">{e.name}</span><span className={"cat " + e.category.toLowerCase()}>{e.category}</span></div>
              <div className="cdesc">{e.description}</div>
            </div>
          ))}
          {catalog.length === 0 && <div className="muted" style={{ fontSize: 11, marginBottom: 12 }}>Loading catalog…</div>}

          <h3 style={{ marginTop: 18 }}>Nodes</h3>
          {["trigger", "source", "map", "filter", "database"].map((k) => (
            <div key={k} className="pnode" draggable={k === "filter"}
              onDragStart={(e) => e.dataTransfer.setData("application/rf", k)}
              title={k === "filter" ? "Drag onto the canvas" : "Already in the flow"}>
              <span className="ic">{META[k].icon}</span>{META[k].title}
              {k === "filter" && <span className="muted" style={{ marginLeft: "auto", fontSize: 10 }}>drag →</span>}
            </div>
          ))}
          <div className="hint">
            <b>Linear:</b> click each node to configure, then <b>Run</b>.<br /><br />
            <b>Free:</b> drag nodes to rearrange, or drag <b>Filter</b> onto the canvas.
          </div>
        </div>

        <div className="canvas-wrap" ref={wrapRef} onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            fitView proOptions={{ hideAttribution: true }} minZoom={0.4}>
            <Background color="#c3cee0" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {selected && <Drawer nodeId={selected} pipeline={pipeline} setPipeline={setPipeline} catalog={catalog} onLoadPreset={openPreset} onClose={() => setSelected(null)} />}
        </div>
      </div>

      {results && <Results source={results} onClose={() => setResults(null)} />}
      {showUnified && <Unified onClose={() => setShowUnified(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
