# Lifeline Engine — Flood-Aware Critical Infrastructure Accessibility Platform

> **"When roads flood, every second counts. Lifeline Engine tells you which hospitals are still reachable — before the next ambulance needs to move."**

[![Python 3.11](https://img.shields.io/badge/Python-3.11-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-green.svg)](https://fastapi.tiangolo.com/)
[![OSMnx](https://img.shields.io/badge/OSMnx-1.9+-orange.svg)](https://osmnx.readthedocs.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status: Active](https://img.shields.io/badge/Status-Active-brightgreen.svg)]()
[![Built for PS-6 COSMEON](https://img.shields.io/badge/PS--6-COSMEON-purple.svg)]()

---

## What This Project Does

**Lifeline Engine** is a flood-aware road-network accessibility analysis platform built on top of open geospatial data. Given a circular flood zone (a centre coordinate and radius in metres), the engine downloads the real road network for any city from OpenStreetMap, marks all road edges that intersect the flood polygon as blocked, and then runs a **dual-pass Dijkstra algorithm** — once on the normal graph and once on the flood-degraded "crisis" graph — to determine the true accessibility status of every critical facility (hospitals, schools, police stations, fire stations, pharmacies, and more).

Every facility receives one of three structured status labels: `FULLY_ACCESSIBLE`, `LIMITED_ACCESS`, or `CUT_OFF`. Results are serialised to a **state table** (JSON + CSV), exposed through a **REST API**, and queryable at the individual-trip or city-wide simulation level. A separate module queries the OpenStreetMap Overpass API to enumerate every piece of critical infrastructure physically located within the flood extent, outputting a GeoJSON and CSV with a `flood_risk=true` flag on every record.

Built for **Problem Statement 6 (PS-6): Satellite Data to Insight Engine for Climate Risk** by COSMEON, this solution closes the gap between flood event detection and ground-level operational response — transforming geographic extent into structured, decision-ready infrastructure risk intelligence.

---

## Table of Contents

1. [Why This Solution? (USP)](#-why-this-solution-usp)
2. [Live Demo](#live-demo)
3. [Prerequisites](#prerequisites)
4. [Installation & Local Setup](#installation--local-setup)
5. [Environment Variables](#environment-variables)
6. [Running the Application](#running-the-application)
7. [Folder Structure](#folder-structure)
8. [API Quick Reference](#api-quick-reference)
9. [Contributing](#contributing)
10. [License](#license)

---

## 🚀 Why This Solution? (USP)

### Executive Summary (Non-Technical)

Imagine a major flood has just hit a city. Emergency services need to know: *Which hospitals can still be reached? Which neighbourhoods are cut off? Where should ambulances be redirected?* Today, answering these questions takes hours of manual GIS analysis by specialists.

**Lifeline Engine answers these questions in seconds — automatically, using only open data — and delivers the answer as a structured, machine-readable report that any emergency management system, insurance platform, or government portal can consume directly.**

No satellite expertise required. No expensive proprietary data. No GIS specialist needed to interpret the results. Just a flood zone definition and an instant decision-ready risk report.

---

### Technical Framing (For Engineers)

| USP Angle | What the Code Delivers |
|---|---|
| **End-to-End Automation** | A single POST request triggers network download → UTM projection → flood masking → dual-pass Dijkstra → structured JSON/CSV output. Zero manual steps. |
| **Open Data, No Vendor Lock-in** | Entire stack runs on OpenStreetMap (OSMnx for road networks, Overpass API for infrastructure inventory). No paid satellite data, no proprietary map tiles required. |
| **Decision-Ready Output, Not Just Visualization** | Every facility gets a machine-readable `status` field (`FULLY_ACCESSIBLE` / `LIMITED_ACCESS` / `CUT_OFF`), a numeric `detour_factor`, and a `rerouted` boolean — structured for direct consumption by dispatch systems or dashboards. |
| **Dual-Pass Crisis Routing** | Unlike single-pass routers, the engine runs routing on *both* the baseline and the flood-degraded graph simultaneously, making it possible to detect rerouting, quantify detour penalties, and isolate precisely which roads caused a cut-off. |
| **API-First Design** | Four POST endpoints (`/analyze`, `/route`, `/simulate`, `/flood-infrastructure`) and a GET `/health` check. All responses are typed Pydantic models, fully documented via automatic OpenAPI/Swagger UI. |
| **Critical Infrastructure Inventory** | `/flood-infrastructure` issues 10 separate Overpass API queries across amenity and building tags, deduplicates results, computes polygon centroids via Shapely, and returns a GeoJSON FeatureCollection + CSV — directly importable into QGIS, ArcGIS, or any downstream system. |
| **Multi-Stakeholder Ready** | Governments → district-level `FULLY_ACCESSIBLE`/`CUT_OFF` summaries. Insurers → risk flags and detour factors per facility. Urban planners → infrastructure inventory GeoJSON. Emergency services → real-time nearest-reachable-facility routing. |
| **Scalable City Coverage** | Any city queryable by name via Nominatim. The graph is cached in-process (thread-safe LRU) so repeated queries for the same city cost zero additional download time. |

---

## Live Demo

> ⚠️ **Note:** A Hugging Face Spaces deployment is configured via the included `Dockerfile`. Replace the placeholder below once deployed.

```
https://<your-hf-space>.hf.space/docs
```

Interactive Swagger UI available at `/docs`. ReDoc available at `/redoc`.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Python | 3.11+ | Tested on 3.11.9 |
| pip / uv | Latest | `uv` recommended for speed |
| Internet access | — | Required for OSMnx graph downloads and Overpass API queries |
| Docker (optional) | 20.10+ | For containerised deployment |

No external databases, message brokers, or cloud storage are required. All state is held in-process (graph cache) and on local disk (state table files).

---

## Installation & Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/JayGuri/LastStraw-PS-6.git
cd LastStraw-PS-6
```

### 2. Create and activate a virtual environment

```bash
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate
```

Or using `uv`:

```bash
uv venv
source .venv/bin/activate  # or .venv\Scripts\Activate.ps1 on Windows
```

### 3. Install dependencies

**Development (includes testing tools):**
```bash
pip install -r Lifeline_Engine/requirements.txt
```

**Production only (smaller footprint, no locust/httpx):**
```bash
pip install -r Lifeline_Engine/requirements-prod.txt
```

Or with `uv`:
```bash
uv pip install -r Lifeline_Engine/requirements-prod.txt
```

### 4. Verify installation

```bash
cd Lifeline_Engine
python -c "import osmnx, fastapi, shapely, geopandas; print('All imports OK')"
```

---

## Environment Variables

All variables are optional. The system runs with sensible defaults out of the box.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` (local) / `7860` (Docker/HF) | TCP port the Uvicorn server listens on |
| `LOG_LEVEL` | `INFO` | Logging verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |
| `LOG_JSON` | `0` | Set to `1` to enable machine-readable JSON log output to `lifeline_engine_json.log` |
| `LIFELINE_PLACE` | `Navi Mumbai, India` | Default city for `python main.py` CLI runs |
| `LIFELINE_FLOOD_R` | `500` | Flood radius in metres for CLI runs |
| `LIFELINE_HUB_LAT` | `19.0330` | Hub latitude for CLI runs (Navi Mumbai centre) |
| `LIFELINE_HUB_LON` | `73.0297` | Hub longitude for CLI runs (Navi Mumbai centre) |
| `XDG_CACHE_HOME` | `~/.cache` | Overridden in Docker to `/app/.cache` (writable path for OSMnx HTTP cache) |
| `PYTHONUNBUFFERED` | `1` | Ensures log output appears immediately in container stdout |

### Example `.env` file

```env
PORT=8000
LOG_LEVEL=DEBUG
LOG_JSON=1
LIFELINE_PLACE=Mumbai, India
LIFELINE_FLOOD_R=1000
LIFELINE_HUB_LAT=19.0760
LIFELINE_HUB_LON=72.8777
```

---

## Running the Application

### Development — API server

```bash
cd Lifeline_Engine
uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000/docs` for the interactive Swagger UI.

Or run directly:

```bash
python api.py
```

### Development — CLI simulation (no API)

```bash
cd Lifeline_Engine
python main.py
```

This runs a full end-to-end mock-flood simulation for Navi Mumbai, writes `state_table.json` and `state_table.csv` to `Lifeline_Engine/`, and prints a summary table to stdout.

### Production — Docker

```bash
# Build
docker build -t lifeline-engine .

# Run
docker run -p 7860:7860 \
  -e LOG_LEVEL=INFO \
  -e PORT=7860 \
  lifeline-engine
```

### Production — Hugging Face Spaces

Push to the `main` branch of the attached HF Space repository. The `Dockerfile` is already configured with `EXPOSE 7860` and the HF-compatible non-root user (`uid=1000`).

---

## Folder Structure

```
NMIMS_Road_engine/
│
├── Dockerfile                  # Multi-stage production container (HF Spaces compatible)
├── state_table.csv             # Last CLI simulation output (CSV)
├── state_table.json            # Last CLI simulation output (JSON)
│
├── cache/                      # OSMnx HTTP + graph download cache
│   └── *.json                  # Cached graph responses
│
└── Lifeline_Engine/            # All application source code
    ├── api.py                  # FastAPI application — all endpoints and Pydantic models
    ├── engine.py               # Core analysis engine — flood masking, Dijkstra, state table
    ├── flood_infrastructure.py # Overpass API infrastructure extraction module
    ├── main.py                 # CLI entry point — standalone mock-flood simulation
    ├── utils_geo.py            # Geospatial utilities — projection, snapping, flood polygon
    ├── log_config.py           # Centralised logging configuration (file + console + JSON)
    ├── locustfile.py           # Locust load test scenarios
    ├── test_load.py            # Async endpoint smoke tests (httpx)
    ├── requirements.txt        # Full dev dependencies (includes locust, httpx)
    ├── requirements-prod.txt   # Production-only dependencies (no test tools)
    ├── state_table.json        # CLI simulation output
    └── data/                   # Optional: place custom GeoJSON facility files here
```

---

## API Quick Reference

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Liveness check; returns in-process cache status |
| `POST` | `/analyze` | Single-point dual-pass accessibility analysis |
| `POST` | `/route` | Returns road-following path geometry for globe renderers |
| `POST` | `/simulate` | City-wide mock-flood simulation; returns full state table |
| `POST` | `/flood-infrastructure` | Extract critical infrastructure within a circular flood zone |
| `DELETE` | `/cache/{place_name}` | Evict a cached road graph (forces fresh download) |

Full interactive documentation: `http://localhost:8000/docs`

---

## Contributing

1. Fork the repository and create a feature branch: `git checkout -b feature/my-feature`
2. Keep changes scoped to one concern per PR.
3. Ensure `python -m pytest` passes (or add tests for new behaviour).
4. Follow the existing code style: type hints throughout, docstrings on every public function, use `log = get_logger(__name__)` for logging.
5. Update the relevant documentation file(s) in the same PR.
6. Open a Pull Request against the `main` branch with a clear description.

---

## License

MIT License. See [LICENSE](LICENSE) for full text.

---

*Built by Team LastStraw for NMIMS Hackathon · Problem Statement 6 · COSMEON*
