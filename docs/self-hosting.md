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

### Admin Panel

Set the `ADMIN_PASSWORD` environment variable to enable the admin panel at `/admin`:

```bash
docker run -p 8000:8000 \
  -e ADMIN_PASSWORD=your-secret-password \
  -v simhammer-db:/app/db \
  ghcr.io/sortbek/simcraft:latest
```

The admin panel lets you:
- View and manage installed SimC versions (install, update, remove)
- Check for new SimC releases
- Configure server limits (max combinations, max scenarios)

On startup, the container automatically:
1. Fetches the latest SimC binaries from GitHub Releases
2. Downloads game data from Raidbots
3. Fetches instance images and season data from simhammer.com
4. Compacts game data for production use

All fetched data is cached in volumes so subsequent starts are fast.

### Persistent Volumes

| Volume | Contents | Without it |
|--------|----------|------------|
| `simhammer-data` | Compacted game data + instance images | Re-downloaded on every start |
| `simhammer-data-full` | Raw Raidbots downloads | Re-downloaded on every start |
| `simhammer-simc` | Cached SimC branch binaries | Re-downloaded on every start |
| `simhammer-db` | SQLite job history | Lost on every restart |

### PostgreSQL

```bash
docker run -p 8000:8000 \
  -e DATABASE_URL=postgres://user:pass@host/simhammer \
  ghcr.io/sortbek/simcraft:latest
```

The server auto-detects the database type from the URL prefix.

## Exact Armory equipment stats

Midnight catalyst items keep the source item's secondary stats. Item IDs and
bonus IDs alone cannot reconstruct that allocation. SimHammer emits explicit
`stats=` values when the Armory response includes Blizzard's equipment `stats`
array, and preserves those values through gear and gem/enchant comparisons.

The public `simhammer.com` proxy currently omits these values. Without them,
the import screen warns that the equipped stats are unverified. A fresh export
from the in-game SimulationCraft addon can carry `redirected_base_stats=` for
catalyst gear. An Armory-generated export is not the same thing and may omit it.

Self-hosted servers can fetch the missing equipment data directly from Blizzard
with a Battle.net developer application's client credentials:

| Variable | Purpose |
|----------|---------|
| `BLIZZARD_CLIENT_ID` | Server-side Battle.net developer client ID |
| `BLIZZARD_CLIENT_SECRET_FILE` | Path inside the container to a mounted secret file, preferred |
| `BLIZZARD_CLIENT_SECRET` | Alternative server environment variable when no secret file is set |

Mount the secret file read-only and pass its container path. Keep credentials
out of frontend build variables, profile text, and source control. No individual
user login is needed. With credentials configured, an equipment/authentication
failure is reported instead of silently falling back to unverified stats. If
the proxy's cached gear differs from Blizzard's current gear, retry after the
cached profile refreshes; stats from different items are never combined.

No credentials are needed if the proxy is updated to forward equipment stats.
Its `gear.items[]` entries should preserve Blizzard's `stats` array unchanged
(`type.type`, `value`, `is_negated`) and `modified_crafting_stat` entries. Do not
substitute character-wide totals or add gems/enchants into the item stat values.

When explicitly specified stats are upgraded, SimHammer uses SimC's manual-stat
scaling fallback, which is approximate. A newly imported equipped item retains
its exact reported amounts. Alternative drops continue to use SimC's item data;
the equipped item's snapshot is never copied onto a different drop.

## Build from Source

```bash
git clone https://github.com/sortbek/simcraft.git
cd simcraft
docker compose -f docker-compose.dev.yml up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000

## VPS Deploy

1. Clone the repo on your server
2. Run `docker compose up -d --build`
3. Set up nginx as reverse proxy (port 80 → 8000)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIMC_ENABLED_BRANCHES` | `weekly` | Comma-separated SimC branches to install and expose, e.g. `weekly,nightly` |
| `SIMC_CHECK_INTERVAL` | `3600` | Seconds between automatic SimC update checks |
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
| `MAX_JOBS` | `50` / `200` | Max retained jobs (desktop / web) |
| `MAX_COMBINATIONS` | `500` | Max gear combinations for Top Gear sims (configurable via admin panel) |
| `MAX_SCENARIOS` | `10` | Max scenarios per batch, `0` to disable (configurable via admin panel) |
