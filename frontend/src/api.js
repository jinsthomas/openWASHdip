// Thin API client for the FastAPI backend.
const qs = (o) =>
  new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ""))).toString();

async function call(url, opts) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || `${r.status}`);
  return j;
}

export const api = {
  propose: (url, params) =>
    call("/api/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, params: params || {} }),
    }),
  preview: (config) =>
    call("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    }),
  catalog: () => call("/api/catalog"),
  discover: (url) =>
    call("/api/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  verify: (urls) =>
    call("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls }),
    }),
  listSources: () => call("/api/sources"),
  createSource: (body) =>
    call("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  syncSource: (id) => call(`/api/sources/${id}/sync`, { method: "POST" }),
  deleteSource: (id) => call(`/api/sources/${id}`, { method: "DELETE" }),
  records: (id, limit = 500) => call(`/api/sources/${id}/records?limit=${limit}`),
  aggregate: (id, q) => {
    const p = Object.fromEntries(Object.entries(q).filter(([, v]) => v != null && v !== ""));
    return call(`/api/sources/${id}/aggregate?` + new URLSearchParams(p).toString());
  },
  geojson: (id) => call(`/api/sources/${id}/geojson`),
  recentRuns: (limit = 20) => call(`/api/runs/recent?limit=${limit}`),
  droughtOverview: () => call("/api/drought/overview"),
  droughtForecast: (location) => call("/api/drought/forecast" + (location ? `?location=${encodeURIComponent(location)}` : "")),
  unifiedSummary: () => call("/api/unified/summary"),
  unifiedFilters: () => call("/api/unified/filters"),
  unifiedRecords: (q) => call("/api/unified/records?" + qs(q)),
  unifiedAggregate: (q) => call("/api/unified/aggregate?" + qs(q)),
  unifiedGeojson: (q) => call("/api/unified/geojson?" + qs(q)),
};
