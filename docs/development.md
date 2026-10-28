# Development

## Requirements

- Rust via rustup. `backend/rust-toolchain.toml` pins the compiler, rustfmt, and Clippy.
- Node.js 20+ and npm.
- Docker Compose for the container setup.

## Web with Docker

From the repository root:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This builds the frontend and backend, starts PostgreSQL, and fetches game data
and SimC. Open http://localhost:3000; the API listens on port 8000.

## Web without Docker

Fetch game data from the repository root:

```bash
bash backend/resources/data/fetch-data.sh backend/resources/data
```

Install a compatible binary from [SimC builds](https://github.com/sortbek/simc-builds/releases)
or build [SimulationCraft](https://github.com/simulationcraft/simc).

Create `frontend/.env.local` before starting the frontend:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Run these in separate terminals, starting each from the repository root:

```bash
cd backend
SIMC_PATH=/absolute/path/to/simc cargo run -p simhammer-server
```

```bash
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. Replace the example SimC path with your installed
binary. For a multi-version installation, use `SIMC_DIR` instead. Without either
variable, the server looks for `/usr/local/bin/simc`.

## Desktop

From the repository root:

```bash
npm ci --prefix frontend
npm ci --prefix desktop
npm run desktop:dev
```

The launcher fetches missing game data and a prebuilt SimC binary under
`backend/resources/`, then starts the backend on 17384, Next.js on 3000, and
Electron. To refresh data after a patch, delete `backend/resources/data/` and/or
`backend/resources/simc/` before relaunching.

Build an installer with `npm run desktop:build`. Output is in `desktop/dist/`.

## Checks

See [Contributing](../CONTRIBUTING.md#checks) for the verification gate and CI checks.
For deployment and server settings, see [Self-hosting](self-hosting.md).
