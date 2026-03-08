# SYSTEM_ARCHITECTURE.md — FloodSense

---

## High-Level Overview

FloodSense is a **serving-first ML system** with a reproducible offline training pipeline. At a high level it has three independent subsystems:

1. **Offline Training Pipeline** — DVC-orchestrated, MLflow-tracked, runs once to produce model artifacts
2. **Online Serving API** — FastAPI application, stateless, loads artifacts at startup, handles real-time requests
3. **Batch Risk Mapper** — standalone script, produces JSON reports for archival and district-level summaries

The online serving path has zero dependency on the training pipeline at runtime — it only needs two files: `models/forecast_24h.pt` (or `models/best.pt`) and `artifacts/scaler.joblib`.

---

## System Data Flow Diagram (ASCII)

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TRAINING PATH (offline, DVC-managed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 data/raw/                          ┌─────────────────────┐
 global_flash_flood_data_decade.csv │   INGEST STAGE      │
 (5.8M rows, decade-long global     │   run_ingest_real.py│
  flash flood observations)        │                     │
        │                           │  - Feature engineer │
        ▼                           │  - Validate schema  │
 data/processed/flood.csv ─────────►│  - Log to MLflow    │
 artifacts/ingest_manifest.json     └──────────┬──────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │   TRAIN STAGE       │
                                    │   run_train.py /    │
                                    │   run_train_        │
                                    │   forecast.py       │
                                    │                     │
                                    │ - StandardScaler    │
                                    │ - SlidingWindow W=24│
                                    │ - FloodLSTM 2-layer │
                                    │ - FocalLoss         │
                                    │ - AdamW + Cosine LR │
                                    │ - Early stopping    │
                                    │ - PR-AUC evaluation │
                                    │ - MLflow tracking   │
                                    └──────────┬──────────┘
                                               │
                              ┌────────────────┼──────────────────┐
                              ▼                ▼                  ▼
                      models/best.pt   models/forecast_24h.pt   artifacts/
                      (nowcast)        (forecast, thresh=0.7276) scaler.joblib


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SERVING PATH (online, FastAPI, stateless)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 Client / External System
      │
      │  GET /predict?lat=X&lon=Y
      │  POST /forecast { "lat": X, "lon": Y }
      │
      ▼
 ┌──────────────────────────────────────────────────────┐
 │  FastAPI (src/api/app.py)                            │
 │  - CORS middleware (all origins)                     │
 │  - Pydantic request validation                       │
 │  - Route → handler delegation                        │
 └──────────────┬───────────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
 /predict              /forecast
 inference.py          inference_forecast.py
        │                │
        │                │
        ▼                ▼
 weather_fetcher.py    weather_fetcher.py
 fetch_hourly()        fetch_forecast_window()
        │                │
        │  HTTP           │  HTTP
        ▼                ▼
 archive-api.          api.open-meteo.com
 open-meteo.com        /v1/forecast
 /v1/archive           past_hours=96
 (ERA5-Land)           forecast_hours=24
        │                │
        │                │  + _fetch_archive_soil_moisture()
        │                │    (ERA5-Land fallback for non-Europe)
        │                │
        ▼                ▼
 _engineer_features()  _engineer_features()
 (13 features)         (13 features, is_forecast tag)
        │                │
        ▼                ▼
 scaler.transform()    scaler.transform()
 (lru_cache)           (lru_cache)
        │                │
        ▼                ▼
 FloodLSTM.forward()   FloodLSTM.forward() × 24 steps
 window=(1,24,13)      sliding window over future rows
 → prob ∈ [0,1]        → max(probs), peak_time
        │                │
        ▼                ▼
 _alert_level()        _alert_level(threshold=0.7276)
        │                │
        └───────┬────────┘
                ▼
        JSON Response
        (lat, lon, flood_probability, alert_level, ...)
```

---

## Component Deep-Dives

---

### Training Pipeline

#### Data Ingestion Stage

**Source data:** `data/raw/global_flash_flood_data_decade.csv` — a decade-long global flash flood observations dataset (Kaggle Global Flash Flood Dataset). Contains 5,808,552 rows with pre-computed hourly weather variables and a `Flash_Flood_Risk` binary label. The dataset is derived from ERA5-Land reanalysis (satellite-assimilated model output) combined with historical flood event records.

**DVC stage command:** `python -m src.pipeline.ingestion.run_ingest_real`

**Outputs:**
- `data/processed/flood.csv` — feature-engineered dataset
- `artifacts/ingest_manifest.json` — dataset statistics including imbalance ratio

**Manifest example:**
```json
{
  "rows": 5808552,
  "flood_rows": 6498,
  "no_flood_rows": 5802054,
  "imbalance_ratio": 892.9
}
```

#### Preprocessing & Feature Engineering

- `StandardScaler` fitted on training split only (80%) → saved to `artifacts/scaler.joblib`
- Feature matrix: 13 columns × N rows → `float32` numpy array
- `SlidingWindowDataset` creates overlapping (W=24, F=13) inputs with scalar labels

#### Training Stage

**DVC stage command:** `python -m src.pipeline.training.run_train`

**Key training parameters (from `config.yaml`):**

| Parameter | Value |
|---|---|
| `model.hidden_size` | 128 |
| `model.lstm_layers` | 2 |
| `model.dropout` | 0.3 |
| `train.epochs` | 50 |
| `train.batch_size` | 256 |
| `train.lr` | 0.001 |
| `train.optimizer` | AdamW |
| `train.scheduler` | CosineAnnealingLR |
| `train.grad_clip` | 1.0 |
| `early_stopping.patience` | 15 |
| `loss.name` | bce (nowcast) / focal (forecast) |
| `loss.pos_weight` | 200.0 |

**Model checkpoint format (`.pt` file):**
```python
{
    "model_state_dict": OrderedDict,  # PyTorch state dict
    "config": dict,                    # Full config.yaml contents
    "epoch": int,                      # Epoch at which best PR-AUC was achieved
    "metrics": dict,                   # All evaluation metrics at best epoch
    # forecast_24h.pt only:
    "optimal_threshold": float,        # F1-optimal decision boundary (0.7275628)
}
```

#### Risk Map Stage

**DVC stage command:** `python -m src.pipeline.risk.run_risk_mapper`

- Takes AOI from `tests/fixtures/sample_aoi.geojson`
- Outputs timestamped JSON reports to `artifacts/insight_reports/`

---

### Serving API Architecture

#### Startup & Model Loading

The API uses Python's `functools.lru_cache(maxsize=1)` to implement singleton model loading:

```
Process starts
    ↓
First request arrives
    ↓
_load_assets() called (cache MISS)
    ↓
torch.load(ckpt_path)
joblib.load(scaler_path)
model.eval()
    ↓
Assets stored in LRU cache
    ↓
All subsequent requests → cache HIT (no disk I/O)
```

Both `inference.py` and `inference_forecast.py` have independent `_load_assets()` functions — each caches its own model. First request to `/predict` loads `best.pt`; first request to `/forecast` loads `forecast_24h.pt`. Both share `scaler.joblib`.

#### Request Lifecycle — `/predict`

```
1. FastAPI receives GET /predict?lat=X&lon=Y
2. Pydantic validates: lat ∈ [-90,90], lon ∈ [-180,180]
3. _run_predict(lat, lon) → predict(lat, lon)
4. fetch_hourly(lat, lon):
   a. GET elevation API → elevation scalar
   b. GET archive API → 5-day hourly DataFrame (96+ rows)
   c. Fill soil moisture gaps (ffill/bfill/0.2)
   d. Validate ≥55 rows
5. _engineer_features(raw_df) → 13-feature DataFrame
6. Validate ≥24 rows after engineering
7. Take tail(24) → window_df
8. StandardScaler.transform(window_df[FEATUREColumns]) → (24,13) float32
9. torch.from_numpy → unsqueeze(0) → (1,24,13) tensor
10. model(tensor).item() → float in [0,1]
11. _alert_level(prob) → "LOW"|"MODERATE"|"HIGH"|"CRITICAL"
12. Return PredictResponse JSON
```

#### Request Lifecycle — `/forecast`

```
1. FastAPI receives GET /forecast?lat=X&lon=Y
2. Pydantic validates coordinates
3. _run_forecast(lat, lon) → predict_24h(lat, lon)
4. fetch_forecast_window(lat, lon, past_hours=96, forecast_hours=24):
   a. GET elevation API
   b. GET forecast API with past_hours=96, forecast_hours=24 → 120 rows
   c. Tag is_forecast = timestamp >= now.floor("h")
   d. Soil moisture fallback: if all-null → ERA5-Land archive fetch
   e. Validate ≥23 future rows, ≥12 historical rows
5. Stash is_forecast_arr and timestamps_arr before engineering
6. _engineer_features(weather_df) → feat_df (may drop some leading rows)
7. Re-attach: feat_df["is_forecast"] = is_forecast_arr[n_dropped:]
8. StandardScaler.transform(feat_df[FEATURE_COLUMNS]) → X_scaled (120,13)
9. For each future row index i in [0..23]:
   a. window = X_scaled[i-23:i+1]  (pad with first row if needed)
   b. tensor = window.unsqueeze(0) → (1,24,13)
   c. prob_val = model(tensor).item()
   d. Append (prob_val, timestamp_str) to probs list
10. max_prob, peak_time = max(probs, key=lambda x: x[0])
11. _alert_level(max_prob, threshold=0.7276) → alert level
12. Return ForecastResponse JSON
```

---

### External Integrations

| Service | URL | What it provides | Used in |
|---|---|---|---|
| Open-Meteo Archive API | `archive-api.open-meteo.com/v1/archive` | ERA5-Land reanalysis (past 5 days, hourly) | `/predict` nowcast |
| Open-Meteo Forecast API | `api.open-meteo.com/v1/forecast` | GFS/IFS NWP forecast (past 96h + future 24h) | `/forecast` |
| Open-Meteo Elevation API | `api.open-meteo.com/v1/elevation` | Terrain elevation for any lat/lon | Both endpoints |
| DagsHub / MLflow | `dagshub.com/<user>/<repo>.mlflow` | Experiment tracking, artifact storage | Training only |

All external calls use `httpx` with a 30-second timeout. No API keys required for Open-Meteo.

---

### Data Store Design

FloodSense does not use a database — it is a stateless inference API. The "state" is captured in:

| Artifact | Format | Location | Updated By |
|---|---|---|---|
| Trained model | PyTorch checkpoint (`.pt`) | `models/best.pt`, `models/forecast_24h.pt` | `run_train.py` / `run_train_forecast.py` |
| Feature scaler | joblib pickle | `artifacts/scaler.joblib` | `normalizer.py` (training) |
| Ingest manifest | JSON | `artifacts/ingest_manifest.json` | `run_ingest_real.py` |
| Risk reports | JSON (timestamped) | `artifacts/insight_reports/` | `risk_mapper.py` |
| Training metrics | JSON | `artifacts/checkpoints/metrics.json` | `run_train.py` |
| MLflow runs | Remote (DagsHub) | `mlruns/` (local mirror) | All training stages |

#### Risk Report Schema

```json
{
  "timestamp_utc": "ISO-8601 string",
  "probability": "float [0,1]",
  "risk_class": "Low | Moderate | High",
  "confidence": "float [0,1] — abs(prob-0.5)*2",
  "model_version": "string (from config.project.name)",
  "window_size": "int (24)",
  "flood_threshold": "float (0.5)",
  "data_provenance": {
    "dataset": "string",
    "features": "int",
    "label": "string"
  }
}
```

---

### Frontend / Dashboard

> ⚠️ Note: FloodSense does not include a built-in web frontend. The interactive interface is FastAPI's auto-generated **Swagger UI** at `/docs` (Redoc at `/redoc`). A frontend integration is left to consuming systems.

The Swagger UI provides:
- Interactive form for all endpoints (fill lat/lon, click Execute)
- Full request/response schema documentation
- Example response bodies

---

### Backend Architecture

```
uvicorn (ASGI server)
    └── FastAPI application (src/api/app.py)
        ├── CORSMiddleware (allow all origins)
        ├── Route: GET/POST /predict → inference.py
        ├── Route: GET/POST /forecast → inference_forecast.py
        └── Route: GET /health

inference.py
    ├── _load_assets() [lru_cache]
    │   ├── build_model(cfg) → FloodLSTM
    │   ├── torch.load(best.pt) → model.load_state_dict()
    │   └── joblib.load(scaler.joblib)
    ├── _engineer_features(df) → 13-col DataFrame
    └── predict(lat, lon) → dict

inference_forecast.py
    ├── _load_assets() [lru_cache]
    │   ├── build_model(cfg) → FloodLSTM
    │   ├── torch.load(forecast_24h.pt) → threshold=0.7276
    │   └── joblib.load(scaler.joblib)
    ├── _engineer_features(df) → 13-col DataFrame
    └── predict_24h(lat, lon) → dict

weather_fetcher.py
    ├── fetch_hourly(lat, lon) → DataFrame [72-120 rows]
    ├── fetch_forecast_window(lat, lon, ...) → DataFrame [120 rows + is_forecast]
    └── _fetch_archive_soil_moisture(lat, lon) → float (fallback)
```

---

### Deployment Architecture

#### Local Development

```
Developer machine
└── uvicorn src.api.app:app --reload --port 8000
    └── http://localhost:8000/docs
```

#### Docker / Hugging Face Spaces

```
Dockerfile
├── FROM python:3.11-slim
├── pip install torch (CPU, ~220 MB)
├── pip install requirements-serve.txt
├── COPY src/ configs/ artifacts/scaler.joblib models/
└── CMD uvicorn src.api.app:app --host 0.0.0.0 --port 7860

Hugging Face Spaces (free tier)
├── 2 vCPU, 16 GB RAM
├── Port 7860 exposed as HTTPS endpoint
└── https://<user>-<space>.hf.space/docs
```

#### Environment Variables at Runtime

The API requires no environment variables to run. All configuration is baked into `configs/config.yaml` and the model checkpoints.

---

### Security Considerations

| Concern | Current Status | Recommendation |
|---|---|---|
| Authentication | None — all endpoints are public | Add API key middleware or OAuth2 before public production deployment |
| CORS | Wildcard `allow_origins=["*"]` | Restrict to known frontend domains in production |
| Input validation | Pydantic enforces lat ∈ [-90,90], lon ∈ [-180,180] | ✓ Sufficient |
| Model file integrity | No checksum verification on `.pt` load | Add SHA256 verification of checkpoint files at startup |
| Rate limiting | None | Add per-IP rate limiting to prevent API abuse |
| Secrets | Training credentials in `.env`, not committed | ✓ Correct — `.env` should be in `.gitignore` |

---

### Performance Considerations

| Factor | Detail |
|---|---|
| Inference latency | Dominated by two HTTP calls to Open-Meteo (~300-800ms). LSTM forward pass ~1ms on CPU. Total: ~500ms-1.5s per request. |
| Model size | `forecast_24h.pt` = 0.79 MB. Loads in ~50ms. |
| Concurrency | `uvicorn` is async but `httpx` calls in `weather_fetcher.py` are synchronous (`httpx.get()`). Use `httpx.AsyncClient` and `async def` endpoints for high-concurrency production deployments. |
| Memory | Model + scaler loaded once (~10 MB RAM). Pandas DataFrames per request (~500 KB). No persistent memory growth. |
| Caching | `lru_cache(maxsize=1)` prevents repeated disk I/O. No response caching (each location/time gets fresh data). |
| Scaling | Stateless — can run multiple replicas behind a load balancer with no shared state required. |

> ⚠️ Note: For very high concurrency (>100 req/s), the synchronous `httpx.get()` calls in `weather_fetcher.py` should be migrated to `httpx.AsyncClient` with `await` to avoid blocking the event loop.
