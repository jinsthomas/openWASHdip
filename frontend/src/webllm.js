// In-browser AI endpoint suggester (B). Runs a small open model via WebGPU — no API key,
// no server, fully open-source. The model only *proposes* candidate URLs; the backend
// (/api/verify) confirms each actually returns records before any are shown.

let enginePromise = null;
const MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC"; // ~0.9 GB, cached after first load

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function suggestEndpoints(query, onProgress) {
  // Lazy-load from CDN so it never bloats the main bundle and only downloads on use.
  const webllm = await import(/* @vite-ignore */ "https://esm.run/@mlc-ai/web-llm");
  if (!enginePromise) {
    enginePromise = webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (r) => onProgress?.(r.text || `${Math.round((r.progress || 0) * 100)}%`),
    });
  }
  const engine = await enginePromise;
  const prompt =
    `You suggest public data APIs. For the data source: "${query}", list up to 5 real, ` +
    `publicly accessible, no-authentication HTTPS JSON API endpoints (full URLs including any ` +
    `query parameters) that return an array of records — ideally each record having a latitude ` +
    `and longitude. Reply with ONLY a JSON array of URL strings and nothing else.`;
  const res = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 400,
  });
  const txt = res.choices?.[0]?.message?.content || "";
  const m = txt.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return JSON.parse(m[0]).filter((u) => typeof u === "string" && u.startsWith("http"));
  } catch {
    return [];
  }
}
