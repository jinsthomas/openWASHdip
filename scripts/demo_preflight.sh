#!/usr/bin/env bash
# Demo preflight for openWASHdip.
#   ./scripts/demo_preflight.sh           # ensure DB + server are up
#   ./scripts/demo_preflight.sh --reset   # ...and clear all sources for a clean demo
#
# Leaves the app running at http://127.0.0.1:8000/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PY="$ROOT/.venv/bin/python"
PORT=8000

echo "▸ openWASHdip demo preflight"

# 1. Postgres + PostGIS
if ! docker ps --filter name=openwashdip-db --filter health=healthy --format '{{.Names}}' | grep -q openwashdip-db; then
  echo "  • starting Postgres+PostGIS…"
  docker compose up -d db >/dev/null
  for _ in $(seq 1 20); do
    s=$(docker inspect -f '{{.State.Health.Status}}' openwashdip-db 2>/dev/null || echo none)
    [ "$s" = healthy ] && break; sleep 2
  done
fi
echo "  ✓ database healthy"

# 2. Schema (idempotent) + API server
"$ROOT/.venv/bin/openwashdip" initdb >/dev/null 2>&1 || true
if ! curl -s "localhost:$PORT/healthz" >/dev/null 2>&1; then
  echo "  • starting API server…"
  nohup "$ROOT/.venv/bin/uvicorn" openwashdip.serve.app:app --port "$PORT" --log-level warning >/tmp/owd.log 2>&1 &
  for _ in $(seq 1 15); do curl -s "localhost:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
fi
echo "  ✓ server up — http://127.0.0.1:$PORT/"

# 3. Optional clean slate
if [ "${1:-}" = "--reset" ]; then
  ids=$(curl -s "localhost:$PORT/api/sources" | "$PY" -c "import sys,json;print(' '.join(str(s['id']) for s in json.load(sys.stdin)))" 2>/dev/null || echo "")
  for id in $ids; do curl -s -X DELETE "localhost:$PORT/api/sources/$id" >/dev/null; done
  echo "  ✓ cleared sources (clean slate)"
fi

echo "▸ ready. Open http://127.0.0.1:$PORT/ and hard-refresh (Cmd+Shift+R)."
