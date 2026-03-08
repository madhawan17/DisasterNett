# IMPLEMENTATION.md — FloodSense Technical Deep-Dive

---

## Overview

This document is a walkthrough of *how* every major module in FloodSense was built — the rationale behind each design decision, the exact code involved, and plain-English summaries for non-technical readers.

---

## Module 1: Configuration System

**File:** `src/config.py`

**Plain English:** A central loader that reads the project's YAML configuration file and resolves all file paths relative to the project root — regardless of where the scripts are called from.

### Implementation

```python
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "configs" / "config.yaml"

def load_config(path: str | Path) -> dict[str, Any]:
    load_dotenv(override=False)
    with Path(path).open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def resolve_config_path() -> Path:
    raw = os.getenv("PIPELINE_CONFIG_PATH", "").strip()
    if raw:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = PROJECT_ROOT / candidate
        return candidate
    return DEFAULT_CONFIG_PATH
```

**Key decisions:**
- `PROJECT_ROOT` is anchored to the location of `config.py` itself, not the current working directory. This means scripts work correctly regardless of where they are invoked from.
- `PIPELINE_CONFIG_PATH` env var allows switching to `config.smoke.yaml` for fast test runs without modifying code.
- `python-dotenv` is loaded here so all downstream modules inherit env vars from `.env` automatically.

---

## Module 2: Dataset Ingestion

**DVC Stage:** `ingest`
**Command:** `python -m src.pipeline.ingestion.run_ingest_real`

**Plain English:** Reads the raw decade-long CSV, validates its schema, engineers all 13 features, and writes the result to `data/processed/flood.csv`. Also records dataset statistics (row counts, imbalance ratio) to `artifacts/ingest_manifest.json`.

### Feature Engineering Logic (`loader.py`)

The 13 features are defined as a module-level constant:

```python
FEATURE_COLUMNS: list[str] = [
    "Precipitation_mm", "Soil_Moisture", "Temperature_C", "Elevation_m",
    "Rain_3h", "Rain_6h", "Rain_12h", "Rain_24h",
    "Precip_x_Soil", "Soil_lag1", "Soil_lag3", "Soil_rate", "Temp_lag1",
]
```

This constant is imported by **both the training pipeline and the inference API** — ensuring training and inference use identical feature sets. Any change to this list automatically propagates everywhere.

**Why these features?** Each captures a key physical aspect of flash flooding:
- `Rain_3h/6h/12h/24h` — rolling rainfall accumulation reveals sustained moisture input over multiple timescales
- `Precip_x_Soil` — the interaction term models saturation amplification: heavy rain on already-saturated soil produces dramatically more runoff than rain on dry soil
- `Soil_lag1/Soil_lag3` + `Soil_rate` — soil state lags capture how quickly the ground is absorbing or shedding moisture
- `Temp_lag1` — temperature history affects evapotranspiration and snowmelt contribution

### Ingest Manifest

The ingestion stage records key statistics that help detect data drift and validate pipeline integrity:

```json
{
  "status": "ok",
  "rows": 5808552,
  "flood_rows": 6498,
  "no_flood_rows": 5802054,
  "imbalance_ratio": 892.9
}
```

The 892.9:1 imbalance ratio is critical context: it means naive models that predict "no flood" 100% of the time achieve 99.89% accuracy — hence why standard accuracy is useless and PR-AUC is the primary metric.

---

## Module 3: Preprocessing — StandardScaler

**File:** `src/pipeline/preprocessing/normalizer.py`

**Plain English:** Standardises all 13 features to zero mean and unit variance. Important because the LSTM gradient flow is sensitive to feature magnitude differences — e.g., `Elevation_m` might be 2000m while `Precipitation_mm` is 0.5mm without scaling.

### Implementation

```python
def fit_transform(df, train_mask, cfg):
    X = df[FEATURE_COLUMNS].values.astype(np.float32)
    y = df[label_col].values.astype(np.float32)

    scaler = StandardScaler()
    scaler.fit(X[train_mask])           # FIT: only on training rows
    X_scaled = scaler.transform(X)      # TRANSFORM: applied to all rows

    joblib.dump(scaler, scaler_path)    # saved to artifacts/scaler.joblib
    mlflow.log_artifact(str(scaler_path), artifact_path="preprocessing")

    return X_scaled, y, scaler
```

**Critical design decision — no data leakage:** The scaler is fitted exclusively on `X[train_mask]` (the 80% training split). The test split is transformed using the training distribution's mean and variance — exactly as would happen in production (where the model has never seen future data during training).

**At inference time**, the scaler is loaded from `artifacts/scaler.joblib` and applied to the live weather features. Since the Open-Meteo variables (precipitation in mm, soil_moisture 0–1, temperature in °C, elevation in m) use the same units as the training dataset, no additional unit conversion is needed.

---

## Module 4: Sliding Window Dataset

**File:** `src/pipeline/feature_engineering/sliding_window.py`

**Plain English:** Converts a flat time series of N observations into overlapping "clips" of 24 consecutive hours — each clip being one training example. The model learns to look at a 24-hour window and predict flood risk.

### Implementation

```python
class SlidingWindowDataset(Dataset):
    def __init__(self, features, labels, window_size, horizon=0):
        self.features    = torch.from_numpy(features)
        self.labels      = torch.from_numpy(labels)
        self.window_size = window_size
        self.horizon     = horizon
        self._len = len(features) - window_size + 1 - horizon

    def __getitem__(self, idx):
        x = self.features[idx : idx + self.window_size]  # (W, F)
        if self.horizon > 0:
            # FORECAST: "any flood in the next H hours?"
            y = self.labels[idx + self.window_size :
                            idx + self.window_size + self.horizon].max()
        else:
            # NOWCAST: "is there a flood at time t?"
            y = self.labels[idx + self.window_size - 1]
        return {"features": x, "label": y}
```

**`horizon=0` (nowcast, used for `best.pt`):** Each sample's label is the flood flag at the LAST row of its 24-hour window. The model learns "given the last 24h of conditions, is there a flood happening right now?"

**`horizon=24` (forecast, used for `forecast_24h.pt`):** Each sample's label is the MAXIMUM flood flag in the 24 hours AFTER the window ends. Using `max()` rather than a single future label makes training more learnable — the model needs to detect whether ANY deterioration is coming, not predict the exact flood minute.

**Why this matters for the 5.8M row dataset:**
- With W=24, horizon=0: generates ~5.8M overlapping samples (one per row minus boundary)
- Each sample is only 24 × 13 × 4 bytes = ~1.2 KB → full dataset fits in RAM

---

## Module 5: FloodLSTM Architecture

**File:** `src/pipeline/training/model.py`

**Plain English:** The core neural network. It reads a 24-hour sequence of 13 weather features and outputs a single probability (0 = no flood, 1 = definite flood). The LSTM architecture is specifically chosen because flood risk depends on the temporal *sequence* of events — not just what's happening right now.

### Architecture Details

```python
class FloodLSTM(nn.Module):
    def __init__(self, num_features=20, hidden_size=128,
                 lstm_layers=2, dropout=0.3):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=num_features,   # 13 features per timestep
            hidden_size=128,           # internal state dimension
            num_layers=2,              # stacked LSTM layers
            batch_first=True,          # input shape: (batch, seq, features)
            dropout=0.3,               # dropout between LSTM layers (not after last)
        )
        self.dropout = nn.Dropout(0.3)
        self.head = nn.Linear(128, 1)  # scalar output

    def forward(self, x):              # x: (batch, 24, 13)
        _, (h_n, _) = self.lstm(x)     # h_n: (2, batch, 128)
        last_hidden = h_n[-1]          # take top layer: (batch, 128)
        dropped = self.dropout(last_hidden)
        logit = self.head(dropped).squeeze(1)   # (batch,)
        return torch.sigmoid(logit)             # probability in [0,1]
```

**Why only the last hidden state?** The LSTM processes all 24 timesteps and its final hidden state `h_n[-1]` encodes a summary of the entire sequence. For flood risk this is appropriate — we want the model to integrate conditions over the full window before making a prediction.

**Sigmoid inside `forward()`** — This is a deliberate design choice. The model's output is always an interpretable probability. The consequence: **never wrap `model(tensor)` with `torch.sigmoid()` externally** — that would compute `sigmoid(sigmoid(logit))`, squashing everything towards 0.5.

**Parameter count:** With `hidden_size=128`, `lstm_layers=2`, `num_features=13`:
- LSTM params ≈ 4 × (13×128 + 128×128 + 128) × 2 ≈ ~270,000 parameters
- Linear head: 128×1 + 1 = 129 parameters
- Total: ~270K parameters → 0.79 MB checkpoint file

---

## Module 6: Training Loop

**File:** `src/pipeline/training/trainer.py`

**Plain English:** Runs one training epoch — feeds data through the model in batches, computes the loss, and adjusts model weights via backpropagation.

### Loss Functions

#### Weighted BCE (used in `best.pt`)

```python
class _WeightedBCE(nn.Module):
    def __init__(self, w: float):
        super().__init__()
        self.w = w
    def forward(self, pred, target):
        weights = torch.where(target >= 0.5,
                              torch.full_like(target, self.w),  # flood: 200×
                              torch.ones_like(target))           # no-flood: 1×
        return nn.functional.binary_cross_entropy(pred, target, weight=weights)
```

With `pos_weight=200.0`, each flood sample contributes 200× more to the loss than a non-flood sample — compensating for the 892.9:1 imbalance.

#### Focal Loss (used in `forecast_24h.pt`)

```python
class FocalLoss(nn.Module):
    def __init__(self, alpha=0.25, gamma=2.0):
        ...
    def forward(self, logits, targets):
        bce  = F.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        probs = torch.sigmoid(logits)
        pt   = probs * targets + (1.0 - probs) * (1.0 - targets)
        alpha_factor = self.alpha * targets + (1.0 - self.alpha) * (1.0 - targets)
        focal = alpha_factor * (1.0 - pt).pow(self.gamma) * bce
        return focal.mean()
```

Focal Loss down-weights easy (high-confidence) examples and focuses training on hard (borderline) cases. With `gamma=2`, examples where `pt=0.9` contribute only `(0.1)^2 = 0.01` of their base BCE loss. This further combats imbalance and improves calibration.

> ⚠️ Note: `FocalLoss` operates on **logits** (raw linear output before sigmoid), unlike `_WeightedBCE` which takes probabilities. When using `FocalLoss` in training, the model's `forward()` should not apply sigmoid. The current `forecast_24h.pt` training script handles this correctly.

### Training Epoch

```python
def train_epoch(model, loader, optimizer, criterion, device,
                grad_clip, amp_enabled, scaler, epoch):
    model.train()
    for batch in loader:
        features = batch["features"].to(device)  # (B, 24, 13)
        labels   = batch["label"].to(device)     # (B,)

        optimizer.zero_grad(set_to_none=True)    # clear gradients efficiently
        with torch.amp.autocast("cuda", enabled=amp_enabled):
            preds = model(features)
            loss  = criterion(preds, labels)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=grad_clip)
        scaler.step(optimizer)
        scaler.update()
```

**Gradient clipping** (`grad_clip=1.0`): Prevents exploding gradients which are common in RNNs when processing long sequences or handling extreme loss values from heavily-weighted flood samples.

**AMP (Automatic Mixed Precision)**: Configured but disabled by default (`train.amp: false`). Can be enabled for GPU training to reduce memory and speed up computation.

---

## Module 7: Evaluation Metrics

**File:** `src/pipeline/eval/metrics.py`

**Plain English:** After each epoch, runs the model on unseen test data and computes a comprehensive scorecard — not just accuracy, but metrics that specifically capture whether the model finds floods.

### Why PR-AUC, Not Accuracy

With 892.9:1 imbalance, accuracy is misleading. A model that predicts "no flood" always achieves 99.89% accuracy. PR-AUC (area under the Precision-Recall curve) specifically measures performance on the minority (flood) class:
- **Precision**: Of all rows the model flagged as floods, what fraction were real floods?
- **Recall**: Of all real floods, what fraction did the model catch?
- **PR-AUC**: Average precision across all possible decision thresholds

### F1-Optimal Threshold Selection

The `optimal_threshold` stored in `forecast_24h.pt` (0.7275628) is computed by searching all possible decision thresholds and selecting the one that maximises F1 score on the test set. This approach:
- Accounts for the imbalance in setting the operating point
- Produces the threshold at which the classifier's precision/recall tradeoff is globally optimal
- Is stored in the checkpoint so inference uses the exact threshold the evaluation validated

---

## Module 8: Model Checkpoint Saving

**File:** `src/pipeline/saving/checkpoint.py`

**Plain English:** Saves the model to two locations so it can be tracked both by DVC (for reproducibility) and MLflow (for experiment comparison), and provides a loader that gracefully handles missing checkpoints.

### Dual-Path Save

```python
def save_best(model, cfg, epoch, metrics):
    payload = {
        "model_state_dict": model.state_dict(),
        "config": cfg,
        "epoch": epoch,
        "metrics": metrics,
    }
    # 1. artifacts/checkpoints/best.pt  (legacy, MLflow artifact target)
    torch.save(payload, ckpt_dir / "best.pt")

    # 2. models/best.pt  (DVC-tracked canonical output)
    torch.save(payload, canonical_path)

    mlflow.log_artifact(str(canonical_path), artifact_path="checkpoints")
```

The duplication ensures:
- DVC's dependency tracking (`dvc.yaml` declares `models/best.pt` as the output) works correctly
- MLflow's artifact browser can also show the checkpoint independently

---

## Module 9: Weather Fetching

**File:** `src/api/weather_fetcher.py`

### Archive API Fetch (`fetch_hourly`)

**Plain English:** Gets the last 5 days of real observed weather for any coordinate in the world — the same ERA5-Land data source used to build the training dataset.

```python
def fetch_hourly(lat, lon):
    # 1. Elevation
    elev = httpx.get(ELEVATION_URL, params={"latitude":lat,"longitude":lon}).json()
    elevation = float(elev.get("elevation", [0])[0])

    # 2. Archive weather
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=5)
    resp = httpx.get(ARCHIVE_URL, params={
        "latitude": lat, "longitude": lon,
        "start_date": str(start), "end_date": str(today),
        "hourly": "precipitation,soil_moisture_0_to_7cm,temperature_2m",
        "timezone": "GMT",
    })
    data = resp.json()

    # 3. Build DataFrame
    df = pd.DataFrame({
        "Timestamp":        pd.to_datetime(hourly["time"]),
        "Precipitation_mm": hourly["precipitation"],
        "Soil_Moisture":    hourly["soil_moisture_0_to_7cm"],
        "Temperature_C":    hourly["temperature_2m"],
    })
    df["Elevation_m"] = elevation  # scalar broadcast

    # 4. Fill soil moisture gaps
    df["Soil_Moisture"] = (
        df["Soil_Moisture"].astype("float64").ffill().bfill().fillna(0.2)
    )
    # ... dropna, validate ≥55 rows
```

**Why cast to `float64` before `ffill()`?** The Open-Meteo JSON response can contain `None` values, which pandas infers as object dtype. Using `.ffill()` on object dtype raises a `FutureWarning` in pandas 2.x+. Explicit `.astype("float64")` converts `None` to `np.nan` first, allowing proper numeric fill operations.

**Why validate ≥ 55 rows?** The inference pipeline needs at minimum 24 rows for the LSTM window + 24 rows for `Rain_24h` rolling feature warmup + 7 rows buffer for feature engineering dropna. A 5-day request typically returns 72-96 valid rows well above this threshold.

### Forecast API Fetch (`fetch_forecast_window`)

```python
def fetch_forecast_window(lat, lon, past_hours=96, forecast_hours=24):
    resp = httpx.get(FORECAST_URL, params={
        "latitude": lat, "longitude": lon,
        "hourly": "precipitation,soil_moisture_0_to_7cm,temperature_2m",
        "past_hours": past_hours,
        "forecast_hours": forecast_hours,
        "timezone": "GMT",
    })
    timestamps = pd.to_datetime(hourly["time"], utc=True)
    now_floor  = pd.Timestamp.now(tz="UTC").floor("h")

    df["is_forecast"] = timestamps >= now_floor
```

**Why `timestamps >= now_floor` instead of `> now`?** The boundary condition: when `past_hours=96`, the API returns exactly `now.floor("h")` as the first future timestamp. Using strict `>` would exclude the current hour, producing only 23 future rows instead of 24. The floor-boundary comparison ensures the current hour is included.

### Soil Moisture Fallback for Non-European Locations

```python
def _fetch_archive_soil_moisture(lat, lon):
    resp = httpx.get(ARCHIVE_URL, params={
        "latitude": lat, "longitude": lon,
        "start_date": str(today - timedelta(days=5)),
        "end_date": str(today),
        "hourly": "soil_moisture_0_to_7cm",
    })
    values   = resp.json()["hourly"]["soil_moisture_0_to_7cm"]
    non_null = [v for v in values if v is not None]
    return float(non_null[-1]) if non_null else 0.2
```

This is called when `sm_series.isna().all()` — i.e., the forecast API returned `None` for all 120 soil moisture rows. This happens consistently for locations outside Europe. The fallback uses the most recent non-null value from ERA5-Land (which has global coverage), providing a realistic constant soil saturation value rather than zero.

---

## Module 10: Inference — Nowcast (`/predict`)

**File:** `src/api/inference.py`

**Plain English:** Given a location, fetches recent weather, engineers features, scales them, runs the LSTM, and returns the current flood risk.

### Feature Engineering at Inference

```python
def _engineer_features(df):
    df = df.copy().reset_index(drop=True)
    p, sm, t = df["Precipitation_mm"], df["Soil_Moisture"], df["Temperature_C"]

    df["Rain_3h"]  = p.rolling(window=3,  min_periods=1).sum()
    df["Rain_6h"]  = p.rolling(window=6,  min_periods=1).sum()
    df["Rain_12h"] = p.rolling(window=12, min_periods=1).sum()
    df["Rain_24h"] = p.rolling(window=24, min_periods=1).sum()
    df["Precip_x_Soil"] = p * sm
    df["Soil_lag1"] = sm.shift(1).fillna(sm.iloc[0])
    df["Soil_lag3"] = sm.shift(3).fillna(sm.iloc[0])
    df["Soil_rate"] = sm - df["Soil_lag1"]
    df["Temp_lag1"] = t.shift(1).fillna(t.iloc[0])

    return df.dropna().reset_index(drop=True)
```

This is a mirror of what the training ingestion pipeline does to the CSV. The critical invariant: **training and inference feature engineering must be bit-for-bit identical**. Any divergence causes distribution shift and degrades model performance.

### The Inference Call

```python
def predict(lat, lon):
    model, scaler, cfg = _load_assets()       # lru_cache: loaded once only
    raw_df   = fetch_hourly(lat, lon)
    feat_df  = _engineer_features(raw_df)

    window_df = feat_df.tail(24)              # most recent 24 hours
    X         = window_df[FEATURE_COLUMNS].values.astype(np.float32)
    X_scaled  = scaler.transform(X)           # (24, 13)

    tensor = torch.from_numpy(X_scaled).unsqueeze(0)  # (1, 24, 13)
    with torch.no_grad():
        prob = float(model(tensor).item())    # sigmoid inside model

    return {
        "flood_probability": prob,
        "alert_level": _alert_level(prob),
        "features_snapshot": {col: round(float(window_df.iloc[-1][col]), 4)
                               for col in FEATURE_COLUMNS},
        ...
    }
```

---

## Module 11: Inference — 24h Forecast (`/forecast`)

**File:** `src/api/inference_forecast.py`

**Plain English:** Slides the LSTM over each of the next 24 hours of forecast data, collecting a probability for each, then returns the maximum probability and the time when risk is highest.

### The `is_forecast` Alignment Problem and Fix

This was the most subtle bug in the system. When `_engineer_features()` calls `.dropna()`, it removes the first few rows. If `is_forecast` is inside the DataFrame during engineering, the dropped rows misalign the boolean mask.

**Fix — stash before, reattach after:**

```python
# BEFORE engineering: save arrays
is_forecast_arr = raw_df["is_forecast"].values.copy()   # [N]
timestamps_arr  = raw_df["Timestamp"].values.copy()

# Drop is_forecast from engineering input
weather_df = raw_df.drop(columns=["is_forecast"])
feat_df    = _engineer_features(weather_df)

# Re-attach by tail-alignment (align to end of array, not start)
n_dropped = len(raw_df) - len(feat_df)
feat_df["is_forecast"] = is_forecast_arr[n_dropped:]
feat_df["Timestamp"]   = pd.to_datetime(timestamps_arr[n_dropped:])
```

`n_dropped` tells us how many rows `dropna()` removed from the front. Slicing `[n_dropped:]` from the original arrays gives us the correct aligned suffix.

### Sliding LSTM Over Future Steps

```python
W = 24  # NOWCAST_WINDOW
probs = []

model.eval()
with torch.no_grad():
    for idx in future_indices:             # each future row index
        start  = max(0, idx - W + 1)
        window = X_scaled[start : idx + 1]  # (≤24, 13)

        if len(window) < W:
            # Pad with first row if near the start of data
            pad    = np.repeat(window[:1], W - len(window), axis=0)
            window = np.concatenate([pad, window], axis=0)

        tensor   = torch.from_numpy(window).unsqueeze(0)  # (1, 24, 13)
        prob_val = float(model(tensor).item())             # sigmoid inside model
        probs.append((prob_val, timestamp_str))

max_prob, peak_time = max(probs, key=lambda x: x[0])
```

**Why not re-train with horizon=24?** The LSTM's weights encode "given 24h of conditions, what is the risk now?" By sliding this window over each future timestep, we effectively ask "given 24h of conditions ending at future hour T, what is the risk at T?" This is equivalent to asking "what would the current-risk model have said if we were at hour T?" — which is a valid proxy for future flood risk.

**Why 96h past_hours (not 24)?** The `Rain_24h` feature requires 24 rows of past precipitation to be valid. The `Rain_12h` feature requires 12. If we only fetched 24h of history, the first rows of the forecast window would have severely underestimated rolling rainfall values. 96h (4 days) ensures all rolling features are fully computed before the forecast window begins — capturing even multi-day rainfall events.

---

## Module 12: API Layer

**File:** `src/api/app.py`

### Pydantic Schemas

```python
class PredictRequest(BaseModel):
    lat: float = Field(..., ge=-90,  le=90)
    lon: float = Field(..., ge=-180, le=180)

class PredictResponse(BaseModel):
    lat:               float
    lon:               float
    flood_probability: float   # raw float precision — not rounded
    alert_level:       str     # LOW | MODERATE | HIGH | CRITICAL
    window_hours:      int     # 24
    latest_timestamp:  str
    features_snapshot: dict    # 13 feature values at most recent hour

class ForecastResponse(BaseModel):
    lat:                    float
    lon:                    float
    flood_probability:      float
    alert_level:            str
    forecast_horizon_hours: int          # 24
    based_on_data_until:    str
    peak_flood_time:        str | None
    features_snapshot:      dict
    threshold_used:         float        # calibrated F1-optimal threshold
```

### Error Handling Pattern

```python
def _run_predict(lat, lon):
    try:
        result = predict(lat, lon)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc
    return PredictResponse(**result)
```

Error hierarchy:
- `ValueError` (e.g., too few weather rows, no future data found) → **422** (client can do nothing about it — location has no data)
- `RuntimeError` (e.g., model file missing) → **503** (server-side issue, model not deployed correctly)
- Any other exception → **500** (unexpected)

### CORS Configuration

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```

Wildcard CORS allows any frontend (browser, mobile app, dashboard) to call the API directly. Appropriate for hackathon/demo contexts; should be restricted in production.

---

## Module 13: Risk Mapper (Batch Reports)

**File:** `src/risk_mapper.py`

**Plain English:** A standalone script that generates a complete risk report JSON for a single location — suitable for batch processing multiple locations, archiving assessments, or feeding district-level summaries.

### Confidence Scoring

```python
def confidence(prob: float) -> float:
    """Distance from the decision boundary, normalised to [0, 1]."""
    return abs(prob - 0.5) * 2.0
```

Examples:
- `prob = 0.98` → `confidence = 0.96` (model is very certain this is a flood)
- `prob = 0.51` → `confidence = 0.02` (right on the boundary — very uncertain)
- `prob = 0.02` → `confidence = 0.96` (model is very certain this is NOT a flood)

This metric is output alongside `risk_class` in every JSON report, allowing consuming systems to filter or weight assessments by certainty.

### Report Output Path

Reports are saved to `artifacts/insight_reports/risk_report_<timestamp>.json`. The timestamp format `%Y%m%dT%H%M%S` ensures lexicographic sorting == chronological order.

---

## Module 14: Utilities

### FocalLoss (`src/utils/losses.py`)

```python
class FocalLoss(nn.Module):
    def __init__(self, alpha=0.25, gamma=2.0):
        ...
    def forward(self, logits, targets):
        bce          = F.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        probs        = torch.sigmoid(logits)
        pt           = probs * targets + (1 - probs) * (1 - targets)   # p_t
        alpha_factor = self.alpha * targets + (1 - self.alpha) * (1 - targets)
        focal        = alpha_factor * (1 - pt).pow(self.gamma) * bce
        return focal.mean()
```

`(1 - pt)^gamma` is the modulating factor. For well-classified examples (`pt→1`), this approaches 0 — the loss is effectively down-weighted to near-zero. For misclassified examples (`pt→0`), it preserves full BCE loss. This focuses training attention on hard examples (borderline flood/no-flood cases) which is exactly where spatial precision is most needed for the highly imbalanced dataset.

### Terrain Slope (`src/utils/geo.py`)

```python
def slope_from_dem_numpy(dem: np.ndarray, pixel_size_m: float = 10.0) -> np.ndarray:
    dz_dy, dz_dx = np.gradient(dem, pixel_size_m, pixel_size_m)
    slope_rad    = np.arctan(np.sqrt(dz_dx**2 + dz_dy**2))
    return np.degrees(slope_rad).astype(np.float32)
```

Terrain slope is a key determinant of runoff velocity — steep slopes drain faster (lower flood risk) while flat terrain accumulates water (higher flood risk). This function is implemented but not yet integrated into the inference pipeline.

> ⚠️ TODO: Integrate `slope_from_dem_numpy` into the feature engineering pipeline using a DEM data source (e.g., NASA SRTM via Open-Meteo elevation API or direct raster tiles).

### MLflow / DagsHub init (`src/utils/mlflow_dagshub.py`)

```python
def init_mlflow(cfg):
    load_dotenv(dotenv_path=_ENV_PATH, override=True)
    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", "").strip()
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(cfg["mlflow"]["experiment_name"])

def log_config_params(cfg):
    flat = _flatten(cfg)    # recursively flattens nested YAML to dotted keys
    for key, value in flat.items():
        if isinstance(value, (str, int, float, bool)):
            mlflow.log_param(key, value)
```

The `_flatten()` helper converts nested YAML like `model.hidden_size: 128` to a flat `{"model.hidden_size": 128}` — all params are logged to MLflow for experiment comparison.

---

## Technical Debt & Known TODOs

| Location | Issue | Detail |
|---|---|---|
| `src/utils/geo.py` | Slope not integrated | `slope_from_dem_numpy()` exists but is unused in inference/training |
| `src/api/weather_fetcher.py` | Synchronous HTTP | `httpx.get()` blocks the asyncio event loop. Migrate to `httpx.AsyncClient` + `async def` for production concurrency |
| `src/api/app.py` | No authentication | CORS wildcard + no API key. Add before public deployment |
| `src/risk_mapper.py` | Random stub default | Without `inference.default_features` config, reports use random weights → meaningless output |
| `src/pipeline/training/trainer.py` | MLflow import at top-level | `import mlflow` in `trainer.py` means mlflow must be installed even for inference-only environments. Should be lazy-imported like `loader.py` was fixed |
| `configs/config.yaml` | `data.flood_threshold: 0.5` | This threshold is used in metrics evaluation but not at inference time. The calibrated threshold from `forecast_24h.pt` (0.7276) supersedes it for the forecast endpoint. The nowcast endpoint uses separate hardcoded thresholds. Could cause confusion. |
| Satellite imagery | Scaffolded but not implemented | `torchgeo` and `rasterio` are in `requirements.txt`; `geo.py` has DEM utilities. Direct Sentinel/Landsat raster processing is not yet implemented. Current implementation uses tabular ERA5-Land data via API. |

---

## Test Suite

**Directory:** `tests/`

| Test File | What It Tests |
|---|---|
| `test_model_shapes.py` | `FloodLSTM` output shape `(B,)` and range `[0,1]` for arbitrary batch sizes |
| `test_losses.py` | `FocalLoss` forward pass, numerical correctness, reduction modes |
| `test_risk_mapper.py` | `risk_class()`, `confidence()` boundary conditions |
| `test_integration_smoke.py` | Full pipeline smoke test with `config.smoke.yaml` (fast, reduced epochs) |

Run with:
```bash
pytest tests/ -v
pytest tests/ -v -k "not smoke"   # skip slow integration test
```
