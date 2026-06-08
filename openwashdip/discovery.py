"""Endpoint discovery — turn a name/docs-page/domain into working API endpoints.

Two callers use the same verification core:
  * /api/discover {url}  — heuristic: scrape the page for API-looking URLs, read any
    OpenAPI/Swagger spec, probe common paths, then VERIFY each by fetching.
  * /api/verify {urls}   — used by the in-browser WebLLM suggester: it proposes candidate
    URLs from a source name, and we verify them the same way.

Verification is the safety net: a candidate is only ever surfaced if it actually returns a
JSON array of records. We never show a guessed URL we haven't fetched.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse

import requests

from .ai import BROWSER_HEADERS, _find_record_arrays

URL_RE = re.compile(r"https?://[^\s\"'<>)\]}]+")
API_HINTS = ("api", "rest", ".json", "/v1", "/v2", "geojson", "query", "resource", "data")
COMMON_PATHS = ["/api", "/api/v1", "/api/v2", "/rest", "/openapi.json", "/swagger.json", "/api-docs"]


def verify_endpoint(url: str, params: dict | None = None, timeout: int = 7) -> dict | None:
    """Fetch `url`; if it returns a JSON array of records, describe it. Else None.

    Short timeout: discovery probes many candidates, so a slow/dead one must fail fast.
    """
    try:
        r = requests.get(url, params=params or {}, headers=BROWSER_HEADERS, timeout=timeout)
        r.raise_for_status()
        data = r.json()
    except Exception:  # noqa: BLE001 - any failure simply means "not a usable endpoint"
        return None
    arrays = _find_record_arrays(data)
    if not arrays:
        return None
    path, arr = arrays[0]
    rec = arr[0] if arr and isinstance(arr[0], dict) else {}
    return {
        "url": url,
        "records_path": path,
        "count": len(arr),
        "fields": list(rec.keys())[:14],
    }


def _openapi_endpoints(spec_url: str) -> list[str]:
    """If `spec_url` is an OpenAPI/Swagger doc, build GET endpoint URLs from it."""
    try:
        r = requests.get(spec_url, headers=BROWSER_HEADERS, timeout=8)
        spec = r.json()
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(spec, dict) or "paths" not in spec:
        return []
    servers = spec.get("servers") or [{"url": "/"}]
    base = servers[0].get("url", "/")
    if base.startswith("/"):
        base = urljoin(spec_url, base)
    out = []
    for path, ops in (spec.get("paths") or {}).items():
        if isinstance(ops, dict) and "get" in ops and "{" not in path:  # skip templated paths
            out.append(base.rstrip("/") + "/" + path.lstrip("/"))
    return out[:12]


def discover(url: str) -> list[dict]:
    """Find candidate endpoints around `url` and return the ones that verify."""
    seen: set[str] = set()
    candidates: list[str] = []

    def add(u: str) -> None:
        u = (u or "").rstrip(".,);")
        if u.startswith(("http://", "https://")) and u not in seen:
            seen.add(u)
            candidates.append(u)

    add(url)
    if not url.endswith(".json"):
        add(url.rstrip("/") + ".json")

    html = ""
    try:
        resp = requests.get(url, headers=BROWSER_HEADERS, timeout=8)
        html = resp.text or ""
    except Exception:  # noqa: BLE001
        html = ""

    # URLs that look API-ish, found anywhere on the page (links, code samples, text).
    for m in URL_RE.findall(html)[:300]:
        if any(h in m.lower() for h in API_HINTS):
            add(m)

    # OpenAPI/Swagger spec references (relative or absolute) -> expand to endpoints.
    for spec in re.findall(r"""["'(]([^"'()]*(?:openapi|swagger)[^"'()]*\.json)["')]""", html, re.I):
        spec_url = spec if spec.startswith("http") else urljoin(url, spec)
        for ep in _openapi_endpoints(spec_url):
            add(ep)

    # Probe conventional paths on the origin (and read OpenAPI specs they may expose).
    parts = urlparse(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    for path in COMMON_PATHS:
        cand = origin + path
        add(cand)
        if cand.endswith(".json"):
            for ep in _openapi_endpoints(cand):
                add(ep)

    # Verify candidates concurrently so the whole search finishes in ~one timeout window,
    # not (count × timeout) — otherwise the UI sits "busy" for minutes on a big site.
    return _verify_concurrent(candidates[:16], limit=6)


def _verify_concurrent(urls: list[str], limit: int) -> list[dict]:
    if not urls:
        return []
    with ThreadPoolExecutor(max_workers=8) as ex:
        verified = list(ex.map(verify_endpoint, urls))
    return [v for v in verified if v][:limit]


def verify_many(urls: list[str]) -> list[dict]:
    """Verify a list of candidate URLs (used by the WebLLM suggester)."""
    return _verify_concurrent((urls or [])[:10], limit=10)
