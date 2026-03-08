# FloodSense — Climate Risk Intelligence Engine

> **"From global weather data to actionable flood risk in under a second."**

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![PyTorch](https://img.shields.io/badge/PyTorch-2.6-orange?logo=pytorch)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi)
![DVC](https://img.shields.io/badge/DVC-3.56-purple?logo=dvc)
![MLflow](https://img.shields.io/badge/MLflow-2.17-blue?logo=mlflow)
![License](https://img.shields.io/badge/License-MIT-lightgrey)
![Status](https://img.shields.io/badge/Status-Production--Ready-brightgreen)

---

## What This Does

FloodSense is an end-to-end climate risk intelligence engine built for Problem Statement 6: *"Satellite Data to Insight Engine for Climate Risk"* by COSMEON. Given any geographic coordinate on Earth, the system:

1. **Fetches real-time and forecast weather** from Open-Meteo (ERA5-Land reanalysis + GFS/IFS NWP models — satellite-assimilated data sources)
2. **Engineers 13 hydrological features** — rolling rainfall accumulation, soil moisture state, lag variables, and interaction terms — replicating exactly the feature pipeline used during training
3. **Runs a trained FloodLSTM** — a 2-layer LSTM trained on 5.8 million global hourly observations spanning a decade — to output a flood probability in [0, 1]
4. **Returns structured, decision-ready intelligence**: probability score, calibrated alert level (LOW / MODERATE / HIGH / CRITICAL), and a full feature snapshot
5. **Supports two modes**: nowcast (current risk right now) and 24-hour forecast (maximum risk in the next 24 hours using NWP data)

The system is served as a REST API, requires no GIS expertise, and is deployable as a single Docker container on Hugging Face Spaces or any cloud platform.

---

## Table of Contents

- [Why This Solution? (USP)](#why-this-solution-usp)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running the API](#running-the-api)
- [API Endpoints](#api-endpoints)
- [Running the Training Pipeline](#running-the-training-pipeline)
- [Folder Structure](#folder-structure)
- [Docker Deployment](#docker-deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Why This Solution? (USP)

### Executive Summary (For Non-Technical Stakeholders)

> Most flood monitoring tools require expensive satellite imagery subscriptions, teams of GIS analysts, and hours of processing time. FloodSense removes all of those barriers. A government official, insurer, or urban planner simply provides a location (latitude and longitude), and the system instantly returns: **"Is there flood risk here? How severe? What is the confidence?"** in plain structured data — directly usable by any existing software platform.
>
> The system runs 24 hours a day, covers any location on Earth, costs nothing to operate (all data sources are free), and its forecasting capability shifts it from a reactive reporting tool to a **proactive early-warning engine**.

### Technical Framing (For Engineers)

| USP Angle | Implementation Evidence |
|---|---|
| **End-to-End Automation** | DVC pipeline: `ingest  train  risk_map`. One POST request triggers: Open-Meteo fetch  13-feature engineering  StandardScaler transform  LSTM forward pass  JSON response. Zero manual steps at any stage. |
| **Open Data, No Vendor Lock-in** | All weather from Open-Meteo (ERA5-Land + GFS/IFS). No API keys. Training data: decade-long global flash flood CSV (5.8M rows). |
| **Decision-Ready Output** | Returns `alert_level`, `flood_probability`, `threshold_used`, `peak_flood_time`, `features_snapshot`. Not a raster to interpret — structured JSON consumable by any system. |
| **Temporal Forecasting** | `/forecast` fetches 96h history (feature warmup) + 24h NWP future. LSTM slides over each future hour. Returns `peak_flood_time` and `max(probabilities)` across all 24 steps. |
| **Confidence Scoring** | `confidence = abs(prob  0.5)  2.0`. In `risk_mapper.py`. Near-0.5  low confidence; near-0 or near-1  high confidence. |
| **Multi-Stakeholder Ready** | Governments  `alert_level` for emergency management. Insurers  `flood_probability` + `threshold_used` for actuarial triggers. Urban planners  elevation + soil saturation features. Farmers  soil moisture trends. |
| **Predictive, Not Just Reactive** | `forecast_24h.pt` trained with Focal Loss + WeightedRandomSampler on full 5.8M rows. PAST_HOURS=96 captures multi-day cumulative rainfall before the forecast window. |
| **API-First Design** | FastAPI with Swagger UI at `/docs`. `GET` and `POST` variants for both `/predict` and `/forecast`. Standard JSON + HTTP status codes for drop-in integration. |

---

## Prerequisites

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip
- Git
- Docker (for containerised deployment only)

No GPU required — inference runs on CPU.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/JayGuri/LastStraw-PS-6.git
cd LastStraw-PS-6
git checkout harshil
```

### 2. Create and activate virtual environment

```bash
# Windows PowerShell
uv venv --python 3.11
.venv\Scripts\Activate.ps1

# Linux / macOS
uv venv --python 3.11
source .venv/bin/activate
```

### 3. Install dependencies

```bash
# Serving only (API + inference — recommended for most users)
pip install -r requirements-serve.txt
pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu

# Full install (training + serving)
pip install -r requirements.txt
pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cpu
```

### 4. Environment variables (training only)

```bash
cp .env.example .env   # then edit with your DagsHub credentials
```

---

## Environment Variables

These are only required to **train** the model. The API works without them.

| Variable | Description | Example |
|---|---|---|
| `MLFLOW_TRACKING_URI` | MLflow / DagsHub experiment tracking server | `https://dagshub.com/user/repo.mlflow` |
| `MLFLOW_TRACKING_USERNAME` | DagsHub username | `your_username` |
| `MLFLOW_TRACKING_PASSWORD` | DagsHub access token | `your_token` |
| `PIPELINE_CONFIG_PATH` | Override default `configs/config.yaml` | `configs/config.smoke.yaml` |

```dotenv
# .env
MLFLOW_TRACKING_URI=https://dagshub.com/JayGuri/LastStraw-PS-6.mlflow
MLFLOW_TRACKING_USERNAME=your_username
MLFLOW_TRACKING_PASSWORD=your_token
```

---

## Running the API

### Development

```bash
uvicorn src.api.app:app --reload --port 8000
```

Open [http://localhost:8000/docs](http://localhost:8000/docs) for interactive Swagger UI.

### Production

```bash
uvicorn src.api.app:app --host 0.0.0.0 --port 8000 --workers 2
```

---

## API Endpoints

### `GET /health`

```json
{ "status": "ok" }
```

### `GET /predict?lat=18.96&lon=72.82`  `POST /predict`

Nowcast — current flood risk from the last 72h of observed weather.

```json
{
  "lat": 18.96, "lon": 72.82,
  "flood_probability": 0.0023,
  "alert_level": "LOW",
  "window_hours": 24,
  "latest_timestamp": "2026-03-01 10:00:00",
  "features_snapshot": {
    "Precipitation_mm": 0.0, "Soil_Moisture": 0.18, "Temperature_C": 28.4,
    "Elevation_m": 14.0, "Rain_3h": 0.0, "Rain_6h": 0.0,
    "Rain_12h": 2.1, "Rain_24h": 5.3, "Precip_x_Soil": 0.0,
    "Soil_lag1": 0.18, "Soil_lag3": 0.17, "Soil_rate": 0.0, "Temp_lag1": 28.1
  }
}
```

### `GET /forecast?lat=18.96&lon=72.82`  `POST /forecast`

24-hour forecast — maximum flood risk in next 24h using NWP model data.

```json
{
  "lat": 18.96, "lon": 72.82,
  "flood_probability": 0.000223,
  "alert_level": "LOW",
  "forecast_horizon_hours": 24,
  "based_on_data_until": "2026-03-02 03:00:00",
  "peak_flood_time": "2026-03-01 18:00:00+00:00",
  "features_snapshot": { "...": "..." },
  "threshold_used": 0.7275628
}
```

#### Alert Level Thresholds

| Level | Nowcast | Forecast (relative to F1-optimal threshold ~0.7276) |
|---|---|---|
| LOW | `prob < 0.51` | `prob < threshold  0.70` |
| MODERATE | `0.51 – 0.72` | `threshold0.70 – threshold` |
| HIGH | `0.72 – 0.85` | `threshold – threshold1.15` |
| CRITICAL | ` 0.85` | ` threshold  1.15` |

---

## Running the Training Pipeline

```bash
# Full pipeline (requires DVC + training data)
dvc repro

# Individual stages
python -m src.pipeline.ingestion.run_ingest_real     #  data/processed/flood.csv
python -m src.pipeline.training.run_train            #  models/best.pt
python -m src.pipeline.training.run_train_forecast   #  models/forecast_24h.pt

# Standalone risk report
python -m src.risk_mapper
```

---

## Folder Structure

```
LastStraw-PS-6/
 configs/
    config.yaml             Main config (model, training, paths)
    config.smoke.yaml       Smoke-test config (fast validation runs)

 src/
    config.py               Config loader + PROJECT_ROOT resolution
    risk_mapper.py          Batch risk report generator (JSON output)
   
    api/                    REST API serving layer
       app.py              FastAPI application + Pydantic schemas
       inference.py        /predict (nowcast) inference logic
       inference_forecast.py  /forecast (24h ahead) logic
       weather_fetcher.py  Open-Meteo archive + forecast API clients
   
    pipeline/               DVC ML pipeline
       ingestion/loader.py    FEATURE_COLUMNS + CSV loader
       preprocessing/normalizer.py  StandardScaler fit + save
       feature_engineering/sliding_window.py  SlidingWindowDataset
       training/model.py       FloodLSTM architecture
       training/trainer.py     Training loop + optimizer/scheduler
       eval/metrics.py         PR-AUC, ROC-AUC, F1, MSE + MLflow
       saving/checkpoint.py    Model save/load (dual-path)
   
    utils/
        geo.py              Terrain slope from DEM (numpy)
        losses.py           FocalLoss (binary focal loss on logits)
        mlflow_dagshub.py   MLflow/DagsHub init + param logging

 models/
    best.pt                 Nowcast model (used by /predict)
    forecast_24h.pt         Forecast model (used by /forecast, threshold=0.7276)

 artifacts/
    scaler.joblib           Fitted StandardScaler (required at inference)
    ingest_manifest.json    Dataset statistics (5.8M rows, 892.9:1 imbalance)
    checkpoints/            Legacy checkpoint copies

 data/
    raw/flood.csv           Source dataset
    processed/flood.csv     Feature-engineered dataset

 tests/                      pytest suite
 dvc.yaml                    DVC pipeline definition
 Dockerfile                  Docker image (HF Spaces compatible, port 7860)
 requirements.txt            Full training + serving dependencies
 requirements-serve.txt      Slim serving-only dependencies
```

---

## Docker Deployment

### Build and run locally

```bash
docker build -t flood-api .
docker run -p 7860:7860 flood-api
# Open: http://localhost:7860/docs
```

### Deploy to Hugging Face Spaces

1. Create a new Space  **SDK: Docker**
2. Push to the Space remote:
   ```bash
   git remote add hf https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE
   git push hf harshil:main
   ```
3. HF Spaces builds automatically. Live at `https://YOUR_USERNAME-YOUR_SPACE.hf.space/docs`.

>  CPU-only PyTorch is used to keep the image under 1 GB. GPU is not required for inference.

---

## Contributing

1. Fork and create a feature branch: `git checkout -b feature/your-feature`
2. Install dev dependencies: `pip install -r requirements-dev.txt`
3. Run tests: `pytest tests/ -v`
4. Ensure API starts: `uvicorn src.api.app:app --port 8000`
5. Submit a pull request to the `harshil` branch

---

## License

MIT License.
