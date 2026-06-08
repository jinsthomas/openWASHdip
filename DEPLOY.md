# Deploying openWASHdip on a server

The whole app (web UI + API + Postgres/PostGIS) ships as Docker containers, so any
Linux server with Docker can run it with one command. Below is a fresh-server walkthrough,
then production notes.

## Requirements

- A Linux server (Ubuntu 22.04+ / Debian 12+ recommended) with **SSH access** and **~2 GB RAM**.
- **Outbound internet** (the app fetches data from public APIs like OpenStreetMap, USGS, GDACS).
- A port reachable from where you'll use it (default **8000**).

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # then log out and back in (run docker without sudo)
docker version                     # verify
```

## 2. Get the code

```bash
git clone https://github.com/jinsthomas/openWASHdip.git
cd openWASHdip
```

## 3. Set a database password (recommended)

Create a `.env` file next to `docker-compose.yml`:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" > .env
# optional: change the public port, e.g. APP_PORT=80
```

`docker compose` reads this automatically. (Skip this and it falls back to a default
password — fine for a private/test box, not for anything internet-facing.)

## 4. Build and run

```bash
docker compose up --build -d        # build images, start db + app in the background
docker compose ps                   # both should be "running"/"healthy"
docker compose logs -f app          # watch startup (Ctrl-C to stop watching)
```

Open **`http://YOUR_SERVER_IP:8000/`**. The app creates its schema on first start.

## 5. Open the firewall (if needed)

```bash
sudo ufw allow 8000/tcp             # or your chosen APP_PORT
```

Cloud VMs (AWS/GCP/Azure/DigitalOcean) also need the port opened in the provider's
security group / firewall rules.

## Day-2 operations

```bash
# Update to the latest code
git pull && docker compose up --build -d

# Stop (data is kept in the named volume)
docker compose down

# Stop AND wipe all data
docker compose down -v

# Back up the database
docker exec openwashdip-db pg_dump -U openwashdip openwashdip > backup.sql
```

Data persists in the `openwashdip_pgdata` Docker volume across restarts and rebuilds.

## Production hardening

- **Change the DB password** — step 3 above.
- **There is no built-in authentication.** Anyone who can reach the port can use it. Restrict
  access via the firewall (allow only known IPs / a VPN), or front it with a reverse proxy that
  adds auth.
- **HTTPS + a domain** — put it behind **Caddy** (automatic TLS) or Nginx. Minimal Caddy example
  (`Caddyfile`), assuming the app is on `127.0.0.1:8000`:
  ```
  wash.example.org {
      reverse_proxy 127.0.0.1:8000
  }
  ```
  Then bind the app to localhost only by setting `APP_PORT` and a proxy in front, or keep 8000
  internal and expose 80/443 via the proxy.

## Alternative: use an external managed Postgres

If you already run Postgres+PostGIS elsewhere (a managed DB, or the one you mentioned setting up):

1. In `docker-compose.yml`, you can drop the `db` service and the `depends_on` block.
2. Point the app at your DB by setting `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL=postgresql+psycopg://user:password@db-host:5432/openwashdip?sslmode=require
   ```
   (and reference it in the `app` service's `environment` instead of the built-in one).
3. Ensure PostGIS is enabled on that database (`CREATE EXTENSION IF NOT EXISTS postgis;` — the
   app also attempts this on startup).

## Without Docker (manual)

See the **Local development** section of the [README](README.md): `uv sync`, `npm run build`,
`openwashdip initdb`, then `uvicorn openwashdip.serve.app:app`.
