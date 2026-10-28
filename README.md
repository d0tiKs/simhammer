# SimHammer

SimulationCraft made simple. Run sims from your browser or download the desktop app — no command line needed.

**[Try the Demo](https://simhammer.com)** · **[Download Desktop App](https://github.com/sortbek/simcraft/releases/latest)** · **[Documentation](docs/)**

---

<p align="center">
  <img src="docs/images/QuickSim.png" alt="Quick Sim" width="32%">
  <img src="docs/images/TopGear.png" alt="Top Gear" width="32%">
  <img src="docs/images/DropFinder.png" alt="Drop Finder" width="32%">
</p>
<p align="center">
  <img src="docs/images/TopGearResult.png" alt="Top Gear Result" width="32%">
  <img src="docs/images/DropFinderResult.png" alt="Drop Finder Result" width="32%">
  <img src="docs/images/History.png" alt="Simulation History" width="32%">
</p>

## Sim Types

| | Description |
|---|---|
| **Quick Sim** | DPS, ability breakdown, and stat weights |
| **Top Gear** | Find the best gear combination from your bags and vault |
| **Drop Finder** | Sim raid and dungeon loot to find upgrades |
| **Crest Upgrades** | Find the best Dawncrest upgrade path within your budget |

## Quick Start

### Desktop

Download the installer from [Releases](https://github.com/sortbek/simcraft/releases/latest). Available for Windows, macOS, and Linux. Runs locally using all CPU cores.

### Self-host

See [Self-hosting](docs/self-hosting.md) for Docker, Podman, and source builds.
The demo and desktop downloads above are upstream releases. Build from this
checkout to run this fork's changes.

## Documentation

| | |
|---|---|
| **[Architecture](docs/architecture.md)** | System design, storage, deployment modes |
| **[Development](docs/development.md)** | Local setup, web + desktop dev, building |
| **[Self-Hosting](docs/self-hosting.md)** | Docker, PostgreSQL, VPS deploy, environment variables |
| **[Local refinement](docs/local-refinement.md)** | Refine comparison results and configure automatic refinement |
| **[Calibration](backend/calibration/README.md)** | Capture Top Gear requests and run the supported triage grid |
| **[Contributing](CONTRIBUTING.md)** | Code style, PRs, CI pipeline |

## License

Private repository. All rights reserved.
