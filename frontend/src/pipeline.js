// Pure helpers that translate between the visual pipeline and the backend config.

export function emptyPipeline() {
  return {
    source: { url: "", records_path: "", proposer: null, detected: null, params: {} },
    columns: [], // {include, source_path, column, role}  role: ''|id|lat|lon|time
    filter: { enabled: false, field: "", op: ">", value: "" },
    database: { slug: "", title: "", mode: "replace" },
    trigger: { interval_minutes: null },
  };
}

// AI proposal -> editable column rows.
export function proposalToColumns(p) {
  const cols = [];
  if (p.id_path) cols.push({ include: true, source_path: p.id_path, column: "external_id", role: "id" });
  if (p.lat_path) cols.push({ include: true, source_path: p.lat_path, column: "latitude", role: "lat" });
  if (p.lon_path) cols.push({ include: true, source_path: p.lon_path, column: "longitude", role: "lon" });
  if (p.time_path) cols.push({ include: true, source_path: p.time_path, column: "event_time", role: "time" });
  if (p.country_path) cols.push({ include: true, source_path: p.country_path, column: "country", role: "country" });
  for (const [name, path] of Object.entries(p.property_paths || {})) {
    cols.push({ include: true, source_path: path, column: name, role: "" });
  }
  return cols;
}

// Visual pipeline -> backend config (the shape ingest.pull_records expects).
export function buildConfig(pl) {
  const cols = pl.columns.filter((c) => c.include);
  const byRole = (r) => cols.find((c) => c.role === r);
  const props = {};
  for (const c of cols) if (!c.role) props[c.column] = c.source_path;
  const cfg = {
    kind: "rest-points",
    request: { url: pl.source.url.trim(), params: pl.source.params || {} },
    records_path: pl.source.records_path || "features",
    id_path: byRole("id")?.source_path || null,
    lat_path: byRole("lat")?.source_path || "",
    lon_path: byRole("lon")?.source_path || "",
    time_path: byRole("time")?.source_path || null,
    country_path: byRole("country")?.source_path || null,
    property_paths: props,
  };
  if (pl.source.country_const) cfg.country_const = pl.source.country_const;
  if (pl.source.requests) cfg.requests = pl.source.requests; // multi-country source
  if (pl.filter.enabled && pl.filter.field) {
    cfg.filters = [{ field: pl.filter.field, op: pl.filter.op, value: pl.filter.value }];
  }
  return cfg;
}

// Saved Source (backend) -> editable visual pipeline (reverse of buildConfig).
// Lets a previously-Run workflow be reopened on the canvas and edited.
export function sourceToPipeline(s) {
  const c = s.config || {};
  const cols = [];
  if (c.id_path) cols.push({ include: true, source_path: c.id_path, column: "external_id", role: "id" });
  if (c.lat_path) cols.push({ include: true, source_path: c.lat_path, column: "latitude", role: "lat" });
  if (c.lon_path) cols.push({ include: true, source_path: c.lon_path, column: "longitude", role: "lon" });
  if (c.time_path) cols.push({ include: true, source_path: c.time_path, column: "event_time", role: "time" });
  if (c.country_path) cols.push({ include: true, source_path: c.country_path, column: "country", role: "country" });
  for (const [name, path] of Object.entries(c.property_paths || {})) {
    cols.push({ include: true, source_path: path, column: name, role: "" });
  }
  const f = (c.filters && c.filters[0]) || null;
  return {
    source: {
      url: c.request?.url || c.requests?.[0]?.url || "", records_path: c.records_path || "",
      proposer: "saved", detected: cols.length, params: c.request?.params || {},
      country_const: c.country_const || null, requests: c.requests || null,
    },
    columns: cols,
    filter: f ? { enabled: true, field: f.field, op: f.op, value: String(f.value) } : { enabled: false, field: "", op: ">", value: "" },
    database: { slug: s.slug, title: s.title, mode: "replace" },
    trigger: { interval_minutes: s.interval_minutes ?? null },
  };
}

export function sourceHasFilter(s) {
  return !!(s.config && s.config.filters && s.config.filters.length);
}

export const ROLE_LABEL = { id: "🔑 id", lat: "📍 lat", lon: "📍 lon", time: "🕐 time", country: "🌍 country" };
