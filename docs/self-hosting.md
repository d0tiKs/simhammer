# Self-Hosting

## Docker (recommended)

```bash
docker run -p 8000:8000 \
  -e SIMC_ENABLED_BRANCHES=weekly,nightly \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

Visit **http://localhost:8000** — everything runs from a single container.

Use `SIMC_ENABLED_BRANCHES=weekly` or `SIMC_ENABLED_BRANCHES=nightly` to install only one branch. If omitted, it defaults to `weekly`.

Set `ADMIN_PASSWORD` to enable `/admin` for SimC version management and server
limits. SimC binaries are cached; game data is downloaded and compacted on every
startup, even with volumes. The database volume preserves history when replacing
the container. Stopping and starting the same container retains its writable layer.

### PostgreSQL

The published standalone image is built without PostgreSQL support. Setting
`DATABASE_URL` alone does not enable it. For the PostgreSQL-backed local setup:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

This builds the server with `CARGO_FEATURES=postgres`, starts PostgreSQL, and
serves the frontend at http://localhost:3000 and the API at http://localhost:8000.
The Compose file contains local development credentials.

For a custom server image connected to an existing PostgreSQL database:

```bash
docker build -f backend/server/Dockerfile \
  --build-arg CARGO_FEATURES=postgres -t simhammer-server-postgres backend
docker run -p 8000:8000 \
  -e DATABASE_URL=postgres://user:pass@host/simhammer \
  simhammer-server-postgres
```

This image serves the API only; deploy the frontend separately. The server
auto-detects the database type from the URL prefix, but its build must include
the corresponding feature.

## Podman with Quadlet

Run as the rootless container owner from the repository root. Requires Linux,
systemd, and Podman with Quadlet.

```bash
install -d -m 700 "$HOME/.config/simhammer"
install -Dm600 deploy/podman/simhammer.env.example "$HOME/.config/simhammer/simhammer.env"
install -Dm644 deploy/podman/simhammer.container "$HOME/.config/containers/systemd/simhammer.container"
```

Edit `~/.config/simhammer/simhammer.env` to choose SimC branches and optionally
set `ADMIN_PASSWORD`. The [template](../deploy/podman/simhammer.container) uses the
upstream image, binds to `127.0.0.1:8000`, and reuses the four `simhammer-*` volumes
shown above. Stop any existing container named `simhammer` or service on that port.

To run this checkout, build an image and set
`Image=localhost/simhammer:latest` in the installed `.container` file:

```bash
podman build -f Dockerfile.standalone -t localhost/simhammer:latest .
```

Start and inspect the service:

```bash
systemctl --user daemon-reload
systemctl --user start simhammer.service
journalctl --user -u simhammer.service -f
```

Wait for `HTTP server started`, then check http://localhost:8000 or `/health`.
Quadlet's `[Install]` section handles startup; do not run `systemctl enable`.
To start at boot without an active login, run `loginctl enable-linger "$USER"`.

For [direct Blizzard imports](#exact-armory-equipment-stats), set the client ID
and secret-file path in the private environment file and uncomment the matching
read-only `Volume=` line. Create the host secret file with mode 600. The mount's
`Z` option applies a private SELinux label.

After editing the Quadlet file, run `systemctl --user daemon-reload`. Restart
with `systemctl --user restart simhammer.service` after any configuration change.
For image updates, rebuild the local image or pull
`ghcr.io/sortbek/simcraft:latest`, then restart.

To remove the service while retaining configuration and volumes:

```bash
systemctl --user stop simhammer.service
rm "$HOME/.config/containers/systemd/simhammer.container"
systemctl --user daemon-reload
```

See [Podman's Quadlet reference](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
for service lifecycle details.

## Exact Armory equipment stats

Midnight catalyst gear can retain its source item's secondary stats, which item
and bonus IDs cannot reconstruct. SimHammer preserves explicit equipment stats
when the import supplies them. The public proxy currently omits them; the UI
warns when equipped stats are unverified. A fresh in-game SimulationCraft addon
export may include `redirected_base_stats=`; an Armory-generated export may not.

To fetch equipment directly from Blizzard, configure a Battle.net developer app:

| Variable | Purpose |
|----------|---------|
| `BLIZZARD_CLIENT_ID` | Server-side client ID |
| `BLIZZARD_CLIENT_SECRET_FILE` | Container path to a read-only mounted secret file, preferred |
| `BLIZZARD_CLIENT_SECRET` | Alternative when no secret file is configured |

Keep credentials server-side. No individual user login is required. With
credentials set, authentication or equipment failures are reported without a
fallback to unverified stats. If proxy gear differs from current Blizzard gear,
retry after its cache refreshes; stats from different items are not combined.

A proxy can avoid the credential requirement by forwarding each `gear.items[]`
entry's Blizzard `stats` array unchanged, including `type.type`, `value`, and
`is_negated`, plus `modified_crafting_stat`. Do not add gems, enchants, or
character-wide totals to those values.

Imported equipped amounts remain exact. Upgrading explicit stats uses SimC's
approximate manual-stat scaling. Alternative drops use their own item data.

## Build and deploy this fork

Use the standalone image so the UI and API share one origin. From the repository
root, build and start this fork with persistent volumes:

```bash
docker build -f Dockerfile.standalone -t simhammer:local .
docker run -d --name simhammer --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v simhammer-data:/app/resources/data \
  -v simhammer-data-full:/app/resources/data_full \
  -v simhammer-simc:/app/resources/simc \
  -v simhammer-db:/app/db \
  simhammer:local
```

Configure nginx for your hostname, with TLS configured for that hostname, and
proxy all application paths to the standalone container:

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The standalone build uses relative API URLs. Default `docker compose up` instead
starts separate frontend and API services on ports 3000 and 8000. That setup
needs both services routed and a browser-reachable `NEXT_PUBLIC_API_URL` supplied
at frontend build time; its default `http://localhost:8000` is for local use.

## Server configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SIMC_ENABLED_BRANCHES` | `weekly` | Comma-separated SimC branches to install and expose, e.g. `weekly,nightly` |
| `SIMC_CHECK_INTERVAL` | `3600` | Seconds between automatic SimC update checks |
| `SIMC_DIR` | _(unset)_ | Directory of installed SimC versions; takes precedence over `SIMC_PATH`. Container images set this to `/app/resources/simc` |
| `SIMC_PATH` | `/usr/local/bin/simc` | Path to SimulationCraft binary |
| `SIMC_THREADS` | _(all cores)_ | Max threads per sim. SimC runs at low priority, so the default rarely needs lowering |
| `DATA_DIR` | `./resources/data` | Path to game data JSON files |
| `DATABASE_URL` | `simhammer.db` | SQLite path or `postgres://` URL |
| `DB_BACKEND` | _(auto)_ | Force `sqlite` or `postgres` (normally detected from `DATABASE_URL` scheme) |
| `PORT` | `8000` | Server port |
| `BIND_HOST` | `0.0.0.0` | Server bind address |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL (frontend build-time) |
| `FRONTEND_DIR` | _(unset)_ | Path to static frontend files (standalone mode) |
| `ADMIN_PASSWORD` | _(unset)_ | Password to access the admin panel at `/admin`. Panel is disabled if not set |
| `MAX_JOBS` | `50` / `200` | Max retained terminal jobs, desktop-feature build / web; active jobs are excluded |
| `MAX_COMBINATIONS` | `0` | Max gear combinations, `0` means unlimited; default Compose overrides this to `2`. Configurable via admin panel |
| `MAX_SCENARIOS` | `10` | Max scenarios per batch, `0` to disable; default Compose sets `0`. Configurable via admin panel |

Defaults above are server defaults unless stated otherwise. Persisted admin
settings for combination and scenario limits override the environment at startup.
