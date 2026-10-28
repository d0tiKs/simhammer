# Architecture

## Deployment modes

The shared Next.js frontend talks to one Rust/Actix API. Standalone serves both
on port 8000; separate web services use frontend port 3000 and API port 8000;
Electron runs a local backend on 17384. SQLite is available in every build.
PostgreSQL requires the `postgres` build feature.

See [Self-hosting](self-hosting.md) for deployment and [Development](development.md)
for local setup.

## Project Structure

```
frontend/                Next.js app (shared by web + desktop)
backend/                 Cargo workspace (Rust)
  core/                  simhammer-core library (API, simc runner, game data)
  server/                simhammer-server binary (--desktop flag for desktop mode)
  resources/             Runtime resources (data/, simc/, frontend/) — gitignored
desktop/                 Electron app (main process, preload, build scripts)
docker-compose.dev.yml   Web dev setup (frontend + backend + postgres)
Dockerfile.standalone    Single-image build (frontend + backend)
```

## Rust Backend

The core library (`simhammer-core`) provides:

- **Actix-web routes** — all API endpoints
- **Addon parser** — parses SimC addon export strings
- **Gear resolver** — resolves items with enrichment from the item DB
- **Profileset generator** — builds SimC profileset input for Top Gear, Droptimizer, Upgrade Compare
- **Result parser** — extracts DPS, abilities, stat weights from SimC JSON output
- **SimC runner** — spawns simc as a subprocess with staged execution
- **Game data** — loads Raidbots JSON files (items, enchants, bonuses, instances, upgrade tracks)
- **Storage** — Repository pattern with sqlx: `JobRepo`, `CharacterRepo`, `RouteRepo`, `SettingsRepo`. Supports SQLite and, when compiled with the `postgres` feature, PostgreSQL. The backend is detected from the `DATABASE_URL` scheme or set explicitly via `DB_BACKEND`.

### Key Patterns

- Frontend shared between web and desktop via `lib/api.ts` (auto-detects API URL via `window.electronAPI`)
- Desktop detection: `window.electronAPI` in frontend, `html[data-desktop]` CSS attribute
- All item/enchant/gem/bonus data from local JSON files, no external API calls at runtime
- Wowhead tooltips loaded client-side (hover popups only)
- Single Rust backend serves identical API shape for both web and desktop
- Asset caching: instance images and faction crests downloaded during compaction, at image build time or standalone container startup

### Job Retention

Jobs are automatically garbage collected on insert. Default retention limits
are 50 terminal jobs for builds with the `desktop` feature and 200 for web builds.
Set `MAX_JOBS` to override the limit. Pending, running, and paused jobs are
excluded from the cap.

## Blizzard API Integration

SimHammer uses `simhammer.com` as a caching proxy for Blizzard API data:

| Endpoint | Purpose | Cache |
|----------|---------|-------|
| `/api/blizzard/season` | M+ rotation, season info | 7 days |
| `/api/blizzard/instances` | Expansion dungeons + raids with tile images | 7 days |
| `/api/blizzard/character/{region}/{realm}/{name}/media/{type}` | Character render/avatar/inset (302 redirect) | 1 hour |
| `/api/blizzard/character/{region}/{realm}/{name}/profile` | Character summary with faction | 15 min |

Instance images and faction assets are fetched during data compaction and served
locally. The standalone container fetches data and compacts it at startup; the
separate backend image compacts data during its build. Character renders and
Wowhead tooltips still use external services at runtime.

## CI/CD

- **Lint** — Prettier, ESLint, cargo fmt, Clippy on every PR
- **Desktop** — GitHub Actions builds Windows, macOS (code signing + notarization), Linux installers on tagged releases
- **Docker** — Published to `ghcr.io/sortbek/simcraft` on `v*` tags or manual workflow dispatch (linux/amd64 and linux/arm64)
