# FEATURES.md — FloodSense Feature Reference

---

## What Makes This Different

| # | Differentiator | Code Evidence |
|---|---|---|
| 1 | **Zero-config, any-location inference** — one lat/lon → full risk profile | `predict(lat, lon)` in `inference.py` |
| 2 | **Genuine 24h forecasting via NWP data** — not extrapolation but actual GFS/IFS model output | `fetch_forecast_window()` + `predict_24h()` |
| 3 | **96h feature warm-up** — multi-day rainfall captured before the forecast window | `PAST_HOURS=96` in `inference_forecast.py` |
| 4 | **Calibrated F1-optimal threshold** — alert levels anchored to real decision boundary, not arbitrary 0.5 | `optimal_threshold=0.7275628` stored in checkpoint |
| 5 | **Confidence scoring** — probability distance from decision boundary normalised to [0,1] | `confidence()` in `risk_mapper.py` |
| 6 | **Class-imbalance-aware training** — 892.9:1 non-flood:flood ratio handled via FocalLoss + WeightedRandomSampler | `FocalLoss` in `utils/losses.py` |
| 7 | **Reproducible pipeline** — DVC tracks every stage input/output, enabling full experiment replay | `dvc.yaml` |
| 8 | **Soil moisture global fallback** — forecast API only has European soil data; automatic ERA5-Land archive fallback for all other regions | `_fetch_archive_soil_moisture()` in `weather_fetcher.py` |

---

## Feature Categories

---

### 1. Weather Data Ingestion

#### 1.1 Real-Time Archive Fetch (`fetch_hourly`)

**What it does (plain English):** Retrieves the last 5 days of real, observed hourly weather for any location on Earth — precipitation, soil moisture, temperature, and elevation.

**How it works technically:**
- File: `src/api/weather_fetcher.py`, function `fetch_hourly(lat, lon)`
- Makes two sequential HTTP requests:
  1. `GET api.open-meteo.com/v1/elevation` → terrain elevation in metres
  2. `GET archive-api.open-meteo.com/v1/archive` → 5-day hourly ERA5-Land reanalysis
- Variables fetched: `precipitation`, `soil_moisture_0_to_7cm`, `temperature_2m`
- ERA5-Land is a satellite-assimilated global reanalysis product — the same source used for training via `dataset_gen.py`
- Returns a pandas DataFrame with columns: `Timestamp`, `Precipitation_mm`, `Soil_Moisture`, `Temperature_C`, `Elevation_m`
- Validates minimum 55 rows (48h needed + 7h warm-up buffer)

**Geospatial behaviour:** Elevation lookup uses a dedicated API call returning a single scalar for the coordinate. ERA5-Land has ~9km spatial resolution globally.

**Stakeholder benefit:** Any stakeholder — no data subscription or download required.

---

#### 1.2 NWP Forecast Window Fetch (`fetch_forecast_window`)

**What it does (plain English):** Fetches a combined window of historical observations and future weather model predictions for any location. The "future" data comes from the GFS (US) / IFS (European) numerical weather prediction models.

**How it works technically:**
- File: `src/api/weather_fetcher.py`, function `fetch_forecast_window(lat, lon, past_hours=96, forecast_hours=24)`
- Calls `api.open-meteo.com/v1/forecast` with `past_hours` and `forecast_hours` in a single request → 120 rows (96 + 24)
- Adds boolean column `is_forecast = timestamp >= now.floor("h")` to tag future rows
- Validates: minimum `forecast_hours − 1` future rows, minimum 12 historical rows for lag warm-up

**Soil moisture global fallback:**
- The forecast API only provides soil moisture for Europe
- For all other regions, `_fetch_archive_soil_moisture()` fetches the most recent non-null value from ERA5-Land and uses it as a constant fill
- Final fallback: `0.2` (~dry soil default)

**Geospatial behaviour:** Forecast data uses `timezone=GMT` to ensure all timestamps are UTC-aligned regardless of request location.

**Stakeholder benefit:** Emergency managers — actionable 24h warning before an event; insurers — pre-event risk scoring.

---

### 2. Feature Engineering

#### 2.1 13-Feature Hydrological Pipeline

**What it does (plain English):** Transforms raw hourly weather readings into 13 features that capture how water accumulates in the environment over time — the key physical drivers of flash flooding.

**How it works technically:**
- Files: `src/api/inference.py::_engineer_features()`, `src/api/inference_forecast.py::_engineer_features()`
- Both implementations are identical (deliberately duplicated to avoid cross-import complexity)

| Feature | Formula / Source | Physical Meaning |
|---|---|---|
| `Precipitation_mm` | Raw hourly rainfall | Immediate water input |
| `Soil_Moisture` | Raw (0–1 volumetric) | Current saturation state |
| `Temperature_C` | Raw 2m air temperature | Evapotranspiration proxy |
| `Elevation_m` | From elevation API | Runoff speed / terrain drainage |
| `Rain_3h` | `rolling(3).sum()` | Very short burst detection |
| `Rain_6h` | `rolling(6).sum()` | Sub-half-day accumulation |
| `Rain_12h` | `rolling(12).sum()` | Half-day accumulation |
| `Rain_24h` | `rolling(24).sum()` | Full-day accumulation |
| `Precip_x_Soil` | `Precipitation_mm × Soil_Moisture` | Saturation amplifier — rain on already-wet soil |
| `Soil_lag1` | `shift(1)` | Soil moisture 1h ago |
| `Soil_lag3` | `shift(3)` | Soil moisture 3h ago |
| `Soil_rate` | `Soil_Moisture − Soil_lag1` | Rate of soil saturation change |
| `Temp_lag1` | `shift(1)` | Temperature 1h ago |

**Geospatial behaviour:** All rolling computations use `min_periods=1` to avoid NaN at the start of windows. Final `dropna()` removes the first few rows where lag features cannot be computed.

**Stakeholder benefit:** Agricultural stakeholders — soil saturation trend; urban planners — cumulative rainfall over drainage design windows.

---

#### 2.2 Forecast Alignment Fix

**What it does (plain English):** When engineering features for the forecast window, the system carefully tracks which rows are "future" (forecast) vs "historical" so that LSTM predictions are only made on future timesteps.

**How it works technically:**
- File: `src/api/inference_forecast.py::predict_24h()`
- `is_forecast` column is stashed BEFORE calling `_engineer_features()` to prevent `dropna()` misaligning the boolean mask
- After engineering, `is_forecast_arr[n_dropped:]` is reattached using tail-alignment: `n_dropped = len(raw_df) - len(feat_df)`

---

### 3. ML Model — FloodLSTM

#### 3.1 Architecture

**What it does (plain English):** A recurrent neural network that reads 24 consecutive hours of the 13 hydrological features and outputs a single number: the probability of a flood occurring.

**How it works technically:**
- File: `src/pipeline/training/model.py`, class `FloodLSTM`
- Architecture:
  ```
  Input:  (batch, 24, 13)
  → LSTM(input=13, hidden=128, layers=2, dropout=0.3, batch_first=True)
  → Take last hidden state: h_n[-1] → (batch, 128)
  → Dropout(0.3)
  → Linear(128, 1) → squeeze → (batch,)
  → Sigmoid → probability in [0, 1]
  ```
- `build_model(cfg)` constructs from `config.yaml`: `hidden_size=128`, `lstm_layers=2`, `dropout=0.3`
- Sigmoid is applied **inside** `forward()` — do NOT wrap output with `torch.sigmoid()` externally

**Stakeholder benefit:** Governments + insurers — single-number probability with calibrated thresholds directly usable in automated alert systems.

---

#### 3.2 Training Pipeline

**What it does (plain English):** Trains the LSTM on 5.8 million historical global flood events, using techniques specifically designed to handle the extreme rarity of flood events (only 0.11% of records are actual floods).

**How it works technically:**
- Files: `src/pipeline/training/trainer.py`, `src/utils/losses.py`
- Dataset: 5,808,552 rows, 6,498 flood events (imbalance ratio 892.9:1)
- Loss functions available: `WeightedBCE` (pos_weight=200) or `FocalLoss` (α=0.25, γ=2.0)
- `forecast_24h.pt` trained with `FocalLoss` + `WeightedRandomSampler`
- Optimizer: AdamW (lr=0.001, weight_decay=0.0001)
- Scheduler: CosineAnnealingLR
- Early stopping: patience=15, metric=PR-AUC
- Mixed precision training (AMP): configurable, default off

---

#### 3.3 Two Trained Models

| Model File | Use Case | PR-AUC | Threshold | Training Notes |
|---|---|---|---|---|
| `models/best.pt` | `/predict` (nowcast) | ~0.99 | 0.5 (fixed) | Standard BCE + pos_weight |
| `models/forecast_24h.pt` | `/forecast` (24h ahead) | 0.9597 | 0.7275628 (F1-optimal, stored in checkpoint) | Focal Loss + WeightedRandomSampler on full 5.8M rows |

> ⚠️ Note: Both models have `horizon=0` in their `SlidingWindowDataset` training config. Genuine forecasting is implemented in the **serving layer** (sliding LSTM over future rows), not baked into the model weights.

---

#### 3.4 Sliding Window Dataset

**What it does (plain English):** Converts the flat time-series into overlapping 24-hour snapshots, each with a flood label. For the forecast model, the label is the MAXIMUM flood risk within the next H hours.

**How it works technically:**
- File: `src/pipeline/feature_engineering/sliding_window.py`
- `SlidingWindowDataset(features, labels, window_size=24, horizon=0)`
- `horizon=0` (nowcast): label = `labels[i + W − 1]` — risk at current timestep
- `horizon=24` (forecast): label = `max(labels[i+W : i+W+24])` — worst-case in next 24h
- Dataset length: `len(features) − window_size + 1 − horizon`

---

### 4. Preprocessing

#### 4.1 StandardScaler Normalisation

**What it does (plain English):** Scales all 13 features to have zero mean and unit variance, so the LSTM isn't dominated by large-magnitude features like elevation.

**How it works technically:**
- File: `src/pipeline/preprocessing/normalizer.py`
- `fit_transform(df, train_mask, cfg)` — scaler fitted on training rows only (no data leakage)
- Saved to `artifacts/scaler.joblib` via joblib
- Logged to MLflow as an artifact at path `preprocessing/`
- At inference time, loaded once via `functools.lru_cache(maxsize=1)` and reused for all requests

---

### 5. Risk Classification & Confidence Scoring

#### 5.1 Alert Level Assignment

**What it does (plain English):** Translates the raw probability number into an actionable categorical warning level.

**How it works technically:**
- `/predict` (nowcast): Fixed thresholds — LOW < 0.51, MODERATE 0.51–0.72, HIGH 0.72–0.85, CRITICAL ≥ 0.85
- `/forecast`: Thresholds relative to the F1-optimal decision boundary stored in the checkpoint
  - LOW: `prob < threshold × 0.70`
  - MODERATE: `threshold × 0.70 ≤ prob < threshold`
  - HIGH: `threshold ≤ prob < threshold × 1.15`
  - CRITICAL: `prob ≥ threshold × 1.15`
- Design rationale: The model's zero-signal baseline (random/OOD inputs) produces sigmoid(0)=0.5. Setting the LOW/MODERATE boundary at `threshold×0.70 ≈ 0.509` ensures uncertain inputs (0.500x) correctly appear as LOW, not MODERATE.

**Stakeholder benefit:** Emergency management — simple traffic-light system for automated alert routing; insurers — programmable trigger levels.

---

#### 5.2 Confidence Scoring

**What it does (plain English):** Alongside the risk category, the system reports how *certain* it is about that classification. A probability near the boundary (e.g., 0.51) carries low confidence; a probability near 0 or 1 carries high confidence.

**How it works technically:**
- File: `src/risk_mapper.py`, function `confidence(prob: float) -> float`
- Formula: `abs(prob − 0.5) × 2.0` → normalised to [0, 1]
- E.g., prob=0.98 → confidence=0.96 (very certain HIGH/CRITICAL); prob=0.51 → confidence=0.02 (borderline LOW/MODERATE)
- Included in batch JSON reports generated by `risk_mapper.py`

**Stakeholder benefit:** Governments and insurers — can filter for high-confidence detections and deprioritise borderline cases without needing to interpret raw probabilities.

---

### 6. API Layer

#### 6.1 FastAPI REST Endpoints

**What it does (plain English):** Exposes the inference engine as a web service that any external system can call with a location and receive a risk assessment.

**How it works technically:**
- File: `src/api/app.py`
- Framework: FastAPI 0.115+ with CORS middleware (all origins allowed)
- Pydantic v2 models for request validation and response serialisation
- Both GET (query params) and POST (JSON body) variants for each inference endpoint
- Errors mapped to HTTP status codes: 422 (validation error), 503 (model not loaded), 500 (unexpected failure)

**Endpoints summary:**

| Method | Path | Handler | Description |
|---|---|---|---|
| `GET` | `/health` | `health()` | Liveness probe |
| `GET` | `/predict` | `predict_get()` | Nowcast via query params |
| `POST` | `/predict` | `predict_post()` | Nowcast via JSON body |
| `GET` | `/forecast` | `forecast_get()` | 24h forecast via query params |
| `POST` | `/forecast` | `forecast_post()` | 24h forecast via JSON body |

---

#### 6.2 Model Caching

**What it does (plain English):** The model and scaler are loaded from disk once when the first request arrives, then kept in memory for all subsequent requests — avoiding repeated expensive disk I/O.

**How it works technically:**
- `@functools.lru_cache(maxsize=1)` on `_load_assets()` in both `inference.py` and `inference_forecast.py`
- Both the FloodLSTM weights and the StandardScaler are cached per-process
- Device: always CPU (no CUDA dependency at inference time)

---

### 7. Structured Output & Batch Reporting

#### 7.1 Risk Mapper (`risk_mapper.py`)

**What it does (plain English):** A standalone script that generates a complete risk assessment report as a JSON file — suitable for archiving, logging, or feeding into district-level summaries.

**How it works technically:**
- File: `src/risk_mapper.py`
- Loads model from `models/best.pt` via `load_model()`
- Either uses a feature values JSON file (configurable via `inference.default_features`) or a random stub for demo purposes
- Outputs JSON to `artifacts/insight_reports/risk_report_<timestamp>.json`

**Report schema:**
```json
{
  "timestamp_utc": "2026-03-01T12:00:00+00:00",
  "probability": 0.823456,
  "risk_class": "High",
  "confidence": 0.646912,
  "model_version": "flood-risk-lstm-v1",
  "window_size": 24,
  "flood_threshold": 0.5,
  "data_provenance": {
    "dataset": "flood.csv (Kaggle GFD tabular)",
    "features": 20,
    "label": "FloodProbability (regression)"
  }
}
```

**Risk class thresholds (risk_mapper.py):**
- Low: `prob < 0.30`
- Moderate: `0.30 ≤ prob ≤ 0.70`
- High: `prob > 0.70`

> ⚠️ Note: These thresholds differ from the API alert level thresholds. The risk mapper uses a simpler three-band classification suited for batch reports; the API uses a four-band calibrated classification suited for real-time alerting.

**Stakeholder benefit:** Governments — timestamped, auditable risk records for every location assessed; insurance companies — structured data for actuarial databases.

---

### 8. Training Evaluation & Metrics

#### 8.1 Model Evaluation Suite

**What it does (plain English):** After each training epoch, the system computes multiple accuracy metrics that measure both how well the model ranks flood risk (AUC scores) and how well it classifies binary flood/no-flood events (F1, precision, recall).

**How it works technically:**
- File: `src/pipeline/eval/metrics.py`, function `evaluate()`
- Metrics computed per epoch:
  - `pr_auc` — Precision-Recall AUC (primary metric; robust to class imbalance)
  - `roc_auc` — ROC-AUC
  - `f1`, `precision`, `recall` — binary classification at `flood_threshold`
  - `mse`, `mae` — regression quality of probability output
  - `loss` — epoch loss value
- All metrics logged to active MLflow run via `mlflow.log_metrics()`

---

### 9. Experiment Tracking (MLflow + DagsHub)

**What it does (plain English):** Every training run is automatically logged to DagsHub — a GitHub-like platform for ML experiments — so the team can compare runs, track model versions, and reproduce any past result.

**How it works technically:**
- File: `src/utils/mlflow_dagshub.py`
- `init_mlflow(cfg)` reads `MLFLOW_TRACKING_URI`, `MLFLOW_TRACKING_USERNAME`, `MLFLOW_TRACKING_PASSWORD` from `.env`
- `log_config_params(cfg)` flattens the YAML config to scalar params and logs all of them
- Scaler artifact logged to MLflow at `preprocessing/scaler.joblib`
- Model checkpoint logged at `checkpoints/best.pt`
- Every epoch: `train_loss`, `val_loss`, all evaluation metrics

---

### 10. Reproducible Pipeline (DVC)

**What it does (plain English):** DVC (Data Version Control) tracks every stage of the pipeline — which scripts, data files, and configs produced which outputs — so any result can be reproduced exactly.

**How it works technically:**
- File: `dvc.yaml`
- Three stages:
  1. `ingest`: `run_ingest_real.py` → `data/processed/flood.csv` + `artifacts/ingest_manifest.json`
  2. `train`: `run_train.py` → `models/best.pt` + `artifacts/checkpoints/metrics.json` + `artifacts/graphs/`
  3. `risk_map`: `run_risk_mapper.py` → `artifacts/insight_reports/`
- `dvc repro` re-runs only stages whose inputs have changed

---

### 11. Terrain Analysis Utility

**What it does:** Computes approximate terrain slope in degrees from a digital elevation model (DEM) grid.

**How it works technically:**
- File: `src/utils/geo.py`, function `slope_from_dem_numpy(dem, pixel_size_m=10.0)`
- Uses numpy `np.gradient()` to compute first-order finite differences in x and y
- Returns slope in degrees: `degrees(arctan(sqrt(dz_dx² + dz_dy²)))`

> ⚠️ Note: This function exists in the codebase but is not currently called by the inference pipeline. It is scaffolded for future integration with DEM-based spatial risk mapping.

---

### 12. Containerised Deployment

**What it does (plain English):** The entire API — model, scaler, and source code — is packaged into a single Docker container that can run on any cloud platform without installation steps.

**How it works technically:**
- File: `Dockerfile`
- Base: `python:3.11-slim`
- CPU-only PyTorch installed from `https://download.pytorch.org/whl/cpu` (~220 MB vs ~2.5 GB CUDA)
- Files included: `src/`, `configs/`, `models/best.pt`, `models/forecast_24h.pt`, `artifacts/scaler.joblib`
- Port: 7860 (Hugging Face Spaces default)
- Estimated final image size: ~800 MB

---

## Limitations & Known Edge Cases

| Issue | Location | Detail |
|---|---|---|
| Soil moisture null outside Europe | `weather_fetcher.py` | Forecast API only has soil data for Europe. Archive fallback provides a single constant value — no temporal variation for non-European forecasts. |
| ERA5-Land archive lag | `fetch_hourly()` | Archive API has 1–2 day lag; only ~72–96h of data survives from a 5-day request window. |
| `risk_mapper.py` uses random stub by default | `risk_mapper.py` | Unless `inference.default_features` config points to a real JSON file, reports are generated from random weights — for demo only. |
| No satellite imagery processing | Architecture | The current implementation uses tabular ERA5-Land reanalysis data. Direct Sentinel / Landsat band processing (change detection on raw rasters) is scaffolded (`geo.py`, torchgeo in requirements) but not yet implemented. |
| DEM slope not used in inference | `utils/geo.py` | Terrain slope function exists but is not integrated into the feature pipeline. Elevation is used (flat scalar per coordinate) but not slope. |
| API has no authentication | `app.py` | CORS is fully open (`allow_origins=["*"]`). No API key or rate limiting. Suitable for hackathon / internal use; add auth before public production deployment. |
