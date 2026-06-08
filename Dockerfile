# syntax=docker/dockerfile:1
# Builds the web UI, then runs the FastAPI app. Use with docker-compose (which also
# starts Postgres+PostGIS). One command to a running demo: `docker compose up`.

# --- Stage 1: build the React/Vite UI (outputs into openwashdip/serve/static) ---
FROM node:20-slim AS ui
WORKDIR /app
COPY frontend/ ./frontend/
COPY openwashdip/ ./openwashdip/
RUN cd frontend && npm install && npm run build

# --- Stage 2: Python runtime ---
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY openwashdip/ ./openwashdip/
COPY --from=ui /app/openwashdip/serve/static/ ./openwashdip/serve/static/
RUN pip install --no-cache-dir .
EXPOSE 8000
# The app's startup hook enables PostGIS, creates/migrates tables, and starts the scheduler.
CMD ["uvicorn", "openwashdip.serve.app:app", "--host", "0.0.0.0", "--port", "8000"]
