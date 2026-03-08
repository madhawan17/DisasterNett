# Forecast Pipeline - Detailed Flow

## Overview

The forecast pipeline implements a **24-hour ahead flood risk prediction** using historical weather data (past 96 hours) + future weather forecast data. It returns the **peak probability** and **peak time** across all 24 future hours.

---

## Visual Pipeline Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FORECAST PIPELINE FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                         ┃   📱 CLIENT REQUEST      ┃
                         ┃  /forecast?lat=X&lon=Y   ┃
                         ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                                   │
                                   ▼
                         ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                         ┃   ⚙️  FASTAPI ROUTER     ┃
                         ┃   src/api/app.py         ┃
                         ┃   Validate coords       ┃
                         ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                                   │
                                   ▼
                         ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
                         ┃   📍 INFERENCE          ┃
                         ┃   inference_forecast.py  ┃
                         ┃   Load model & scaler   ┃
                         ┃   (singleton lru_cache) ┃
                         ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────┐
        │          🌐 WEATHER DATA FETCHER                    │
        │          weather_fetcher.py                         │
        │          fetch_forecast_window()                    │
        └──────────────────┬─────────────────────────────────┘
                           │
        ┌──────────────────┼────────────────────┐
        │                  │                    │
        ▼                  ▼                    ▼
    ┌────────────┐  ┌────────────┐      ┌────────────┐
    │📡 Archive  │  │📡 Forecast │      │📡 Elevation│
    │API: 96h    │  │API: 24h    │      │API: CNN Model │
    │Historical  │  │Forecast    │      │            │
    └────────────┘  └────────────┘      └────────────┘
        │                  │                    │
        └──────────────────┼────────────────────┘
                           │
                           ▼
            ┌─────────────────────────────────┐
            │  🧹 MERGE & VALIDATE DATA      │
            │  Combine 96h + 24h = 120 rows  │
            │  Tag is_forecast markers       │
            │  Validate row counts           │
            └──────────┬────────────────────┘
                       │
                       ▼
           ┌────────────────────────────────┐
           │  📊 FEATURE ENGINEERING        │
           │  _engineer_features()          │
           │  6 raw → 13 engineered features│
           │  - Rolling windows (3/6/12/24h)│
           │  - Interactions (Precip×Soil)  │
           │  - Lags & rates (Soil memory)  │
           │  - Temperature lag             │
           │  - Elevation scaling           │
           └──────────┬────────────────────┘
                       │
                       ▼
           ┌────────────────────────────────┐
           │  📈 NORMALIZATION              │
           │  StandardScaler.transform()    │
           │  Shape: (120, 13)              │
           │  μ=0, σ=1 normalization       │
           └──────────┬────────────────────┘
                       │
                       ▼
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  🔄 SLIDING WINDOW LOOP: i=0→23 ┃
        ┃  (Iterate 24 times)              ┃
        ┗━━━━━━━━━┬━━━━━━━━━━━━━━━━━━━━━┛
                  │
    ┌─────────────────────────────────────────────┐
    │  For each hour i in next 24 hours:          │
    ├─────────────────────────────────────────────┤
    │                                             │
    │  window_i = X_scaled[i-23:i+1]             │
    │  shape: (24, 13)                           │
    │            ↓                               │
    │        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓      │
    │        ┃  🧠 LSTM FORWARD PASS    ┃      │
    │        ┃                          ┃      │
    │        ┃  Layer 1: LSTM (128)     ┃      │
    │        ┃  Layer 2: LSTM (128)     ┃      │
    │        ┃  Dropout (0.3)           ┃      │
    │        ┃  Linear (128→1)          ┃      │
    │        ┃  Sigmoid → [0,1]         ┃      │
    │        ┗━━━━━━━┬━━━━━━━━━━━━━━━┛      │
    │                 ▼                        │
    │         prob_i ∈ [0, 1]                 │
    │         Store: (prob_i, timestamp_i)   │
    │                                         │
    └─────────────────────────────────────────────┘
                  │
                  ▼ (24 results collected)
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  📍 PEAK DETECTION         ┃
        ┃  max_prob = max(probs)     ┃
        ┃  peak_time = argmax(probs) ┃
        ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                  │
                  ▼
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  ⚖️  THRESHOLD CHECK        ┃
        ┃  max_prob >= 0.7276?       ┃
        ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼ YES               ▼ NO
    ┌────────────┐      ┌────────────┐
    │   FLOOD    │      │   SAFE     │
    │  DETECTED  │      │  STATUS    │
    └────────────┘      └────────────┘
        │                   │
        └─────────┬─────────┘
                  │
                  ▼
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  🏷️  ALERT MAPPING         ┃
        ┃                            ┃
        ┃  < 0.51  → 🟢 LOW          ┃
        ┃  0.51-72 → 🟡 MODERATE     ┃
        ┃  0.72-85 → 🟠 HIGH         ┃
        ┃  ≥ 0.85  → 🔴 CRITICAL     ┃
        ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                  │
                  ▼
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  📊 BUILD RESPONSE         ┃
        ┃  - flood_probability       ┃
        ┃  - alert_level             ┃
        ┃  - peak_time               ┃
        ┃  - confidence_score        ┃
        ┃  - all_24h_probs           ┃
        ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                  │
                  ▼
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  📤 JSON RESPONSE          ┃
        ┃  HTTP 200 OK               ┃
        ┃  Return to client          ┃
        ┗━━━━━━━━━┬━━━━━━━━━━━━━━━┛
                  │
                  ▼
        ┌─────────────────────────────┐
        │  ✅ CLIENT RECEIVES RESULT  │
        │  {                          │
        │    "latitude": 28.7041,     │
        │    "longitude": 77.1025,    │
        │    "flood_probability": 0.78│
        │    "alert_level": "HIGH",   │
        │    "peak_time": "06:00 UTC" │
        │  }                          │
        └─────────────────────────────┘


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                            DATA TRANSFORMATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  API Fetch     →    Merge     →  Engineering   →  Normalize   →  Window
  (120, 6)            (120, 6)      (120, 13)       (120, 13)    (1, 24, 13)
  [Raw weather]    [Combined]    [13 features]      [μ=0, σ=1]   [Per hour]
  
      ↓                ↓               ↓               ↓             ↓
  Elevation       Validation      Rollng wins     StandardScaler  LSTM
  Precipitation   Null checks     Interactions     fit on train    Inference
  Soil moisture   Tag forecast    Lags & rates     ×24 loops       24×1
  Temperature     Merge rows      Soil memory      Sigmoid         scalars
  Wind speed                       Temperature
  Humidity                         Elevation

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                          LSTM ARCHITECTURE (Per Window)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    Input: (1, 24, 13)
    ↓
    ┌──────────────────┐
    │  LSTM Layer 1    │  ← Learns local temporal patterns
    │  hidden=128      │  ← (1, 24, 128) output
    └─────────┬────────┘
              ↓
    ┌──────────────────┐
    │  LSTM Layer 2    │  ← Learns global context
    │  hidden=128      │  ← (1, 24, 128) output
    └─────────┬────────┘
              ↓
    ┌──────────────────┐
    │ Last Hidden State│  ← Take h_n at t=24
    │ (1, 128)         │  ← Context vector
    └─────────┬────────┘
              ↓
    ┌──────────────────┐
    │  Dropout (0.3)   │  ← Regularization (training only)
    │  (1, 128)        │  ← (1, 128) output
    └─────────┬────────┘
              ↓
    ┌──────────────────┐
    │  Linear Layer    │  ← 128 weights + bias
    │  (128 → 1)       │  ← logit = X @ W^T + b
    └─────────┬────────┘
              ↓
    ┌──────────────────┐
    │  Sigmoid         │  ← σ(x) = 1/(1+e^-x)
    │  → [0, 1]        │  ← Probability
    └─────────┬────────┘
              ↓
    Output: scalar ∈ [0, 1]
    Interpreted as P(Flood | this 24h window)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## End-to-End Request Flow

### 1. **Client Request**
```
GET /forecast?lat=X&lon=Y
POST /forecast { "latitude": X, "longitude": Y }
```

**Input Validation (Pydantic):**
- `latitude` ∈ [-90, 90]
- `longitude` ∈ [-180, 180]

---

### 2. **FastAPI Router**
**File:** `src/api/app.py`

- Receives request at `GET /forecast`
- Validates coordinates using Pydantic
- Delegates to `inference_forecast.py`: `_run_forecast(lat, lon)`

---

### 3. **Load Model & Scaler (Singleton)**
**File:** `inference_forecast.py`

```python
@lru_cache(maxsize=1)
def _load_assets():
    model = build_model(config)  # FloodLSTM architecture
    model.load_state_dict(torch.load('models/forecast_24h.pt'))
    model.eval()
    
    scaler = joblib.load('artifacts/scaler.joblib')
    config = model_checkpoint['config']
    optimal_threshold = model_checkpoint['optimal_threshold']  # 0.7276
    
    return model, scaler, config, optimal_threshold
```

**First Request:** Cache MISS → Load from disk (~50-100ms)  
**Subsequent Requests:** Cache HIT → Immediate reuse

---

### 4. **Weather Data Fetcher**
**File:** `weather_fetcher.py` → `fetch_forecast_window(lat, lon)`

#### 4a. **Elevation API Call**
```http
GET https://api.open-meteo.com/v1/elevation?latitude=X&longitude=Y
```
Returns: `elevation` (meters above sea level)

#### 4b. **Forecast API Call (Parallel)**
```http
GET https://api.open-meteo.com/v1/forecast?
    latitude=X
    &longitude=Y
    &past_hours=96
    &forecast_hours=24
    &hourly=precipitation,soil_moisture,temperature,wind_speed,relative_humidity
```

**Returns:** DataFrame with **120 rows** (96 historical + 24 forecast)

**Columns:**
- `timestamp` (datetime, hourly)
- `precipitation_mm` (float)
- `soil_moisture_percent` (float)
- `temperature_c` (float)
- `wind_speed_kmh` (float)
- `relative_humidity_percent` (float)

#### 4c. **Soil Moisture Fallback (if NULL)**
```python
if all_soil_moisture_nulls:
    soil_moisture = fetch_archive_soil_moisture(lat, lon)  # ERA5-Land
```

#### 4d. **Data Validation**
- Must have ≥23 future rows (forecast)
- Must have ≥12 historical rows (context)
- Validate ≥120 total rows expected

#### 4e. **Tag Forecast vs Historical**
```python
is_forecast_mask = (timestamp >= now.floor('1h'))
```

---

### 5. **Feature Engineering**
**File:** `inference_forecast.py` → `_engineer_features(weather_df)`

**Input:** 6 raw meteorological columns

**Output:** 13 engineered features

#### Feature Engineering Steps:

| Group | Feature | Calculation |
|-------|---------|-------------|
| **Base (1)** | `Precipitation_mm` | Raw precipitation |
| **Rolling Windows (4)** | `Rain_3h` | Sum of last 3 hours |
| | `Rain_6h` | Sum of last 6 hours |
| | `Rain_12h` | Sum of last 12 hours |
| | `Rain_24h` | Sum of last 24 hours |
| **Interaction (1)** | `Precip_x_Soil` | Precipitation × Soil_Moisture |
| **Lags (2)** | `Soil_lag1` | Soil moisture from 1 hour ago |
| | `Soil_lag3` | Soil moisture from 3 hours ago |
| **Rate (1)** | `Soil_rate` | (Current soil - Soil_lag1) |
| **Temperature Lag (1)** | `Temp_lag1` | Temperature from 1 hour ago |
| **Elevation (1)** | `Elevation_m` | Terrain height (constant per location) |
| **Soil Moisture (1)** | `Soil_Moisture` | Current soil moisture |
| **Temperature (1)** | `Temperature_C` | Current temperature |

**Result:** 13-column DataFrame with 120 rows (may drop 1-2 leading rows if engineering requires history)

---

### 6. **Data Normalization**
**File:** `inference_forecast.py` → Scaler applied

```python
X_scaled = scaler.transform(feat_df[FEATURE_COLUMNS])
# Shape: (120, 13) float32
# μ = 0, σ = 1 for each feature
# Scaler fitted on training data only → no leakage
```

**Important:** Scaler was fitted on **80% training split** during model training, saved to `artifacts/scaler.joblib`

---

### 7. **Sliding Window Loop - LSTM Inference (24 iterations)**
**File:** `inference_forecast.py` → Main prediction loop

```python
probs_list = []  # (prob, timestamp) tuples

for i in range(24):  # For each future hour
    # Extract 24-hour window ending at hour i
    window_start = max(0, i - 23)
    window = X_scaled[window_start:i+1]  # shape: (≤24, 13)
    
    # Pad if < 24 rows (shouldn't happen with 120 input rows)
    if len(window) < 24:
        window = pad_sequence(window, target_len=24)
    
    # Convert to tensor: (24, 13) → (1, 24, 13)
    window_tensor = torch.from_numpy(window).unsqueeze(0).float()
    # Shape: (1, 24, 13)
    
    # LSTM forward pass
    prob_val = model(window_tensor).item()  # float in [0, 1]
    timestamp_str = future_timestamps[i]
    
    probs_list.append((prob_val, timestamp_str))
```

---

### 8. **LSTM Model Architecture (Single Forward Pass)**

```
Input Tensor: (1, 24, 13)
       ↓
LSTM Layer 1:
  - Input: (1, 24, 13)
  - Hidden size: 128
  - Output: (1, 24, 128)  [all 24 timesteps]
       ↓
LSTM Layer 2:
  - Input: (1, 24, 128)
  - Hidden size: 128
  - Output: (1, 24, 128)
       ↓
Take Last Hidden State:
  - h_n at t=24: (1, 128)
       ↓
Dropout (0.3):
  - Randomly zero 30% of activations (training mode)
  - No dropout applied at inference
  - Output: (1, 128)
       ↓
Linear Head:
  - Input: (1, 128)
  - Weight matrix: (128, 1)  [learned during training]
  - Bias: scalar
  - Output: (1, 1)
       ↓
Sigmoid Activation:
  - σ(x) = 1 / (1 + e^-x)
  - Converts logit to probability [0, 1]
  - Output: (1, 1)
       ↓
Extract Scalar:
  - prob_val = output.item()  [float in [0, 1]]
```

**Total Inference Time:** ~1ms per window (on CPU)

---

### 9. **Peak Detection**
**File:** `inference_forecast.py` → Peak extraction

```python
# Sort probs_list and find maximum
max_idx = argmax([prob for prob, _ in probs_list])
max_prob = probs_list[max_idx][0]
peak_time = probs_list[max_idx][1]

# Output:
# max_prob ∈ [0, 1] — highest predicted flood probability in next 24h
# peak_time — UTC timestamp when peak is predicted
```

**Example:**
- Hour 3: prob = 0.45
- Hour 6: prob = 0.78  ← **Peak**
- Hour 9: prob = 0.32
- Result: `max_prob=0.78, peak_time="2026-03-01T06:00:00Z"`

---

### 10. **Threshold Comparison**
**File:** `inference_forecast.py` → `_alert_level(prob, threshold=0.7276)`

```python
optimal_threshold = 0.7276

if max_prob >= optimal_threshold:
    flood_detected = True
else:
    flood_detected = False
```

**Why 0.7276?**
- F1-score grid search over 200 thresholds on test set (1.2M samples)
- Threshold that maximizes F1-score
- Balances precision (87%) + recall (91%)
- Saves overfitting to low thresholds with high false positives

---

### 11. **Alert Level Mapping**
**File:** `inference_forecast.py` → Alert classification

```python
def _alert_level(prob, threshold=0.7276):
    if prob < 0.51:
        return "LOW"
    elif prob < 0.72:
        return "MODERATE"
    elif prob < 0.85:
        return "HIGH"
    else:
        return "CRITICAL"
```

**Alert Levels:**

| Level | Probability Range | Interpretation |
|-------|-------------------|-----------------|
| **LOW** | < 0.51 | Low flood risk, no action |
| **MODERATE** | 0.51 - 0.72 | Heightened risk, monitor conditions |
| **HIGH** | 0.72 - 0.85 | Significant risk, begin preparations |
| **CRITICAL** | ≥ 0.85 | Imminent risk, evacuate/alert |

---

### 12. **Confidence Score Calculation**
**File:** `inference_forecast.py`

```python
confidence = abs(max_prob - 0.5) * 2.0

# Reasoning:
# - Confidence = how far away from indecision point (0.5)
# - If prob = 0.5 → confidence = 0 (maximum uncertainty)
# - If prob = 0.0 or 1.0 → confidence = 1.0 (maximum certainty)
# - Range: [0, 1]
```

**Example:**
- `max_prob = 0.78` → `confidence = |0.78 - 0.5| * 2 = 0.56`
- `max_prob = 0.95` → `confidence = |0.95 - 0.5| * 2 = 0.90`

---

### 13. **JSON Response Construction**
**File:** `src/api/app.py` → Response model

```json
{
  "latitude": 28.7041,
  "longitude": 77.1025,
  "flood_probability": 0.7847,
  "alert_level": "HIGH",
  "peak_time": "2026-03-01T06:00:00Z",
  "confidence": 0.5694,
  "all_24h_probabilities": [
    {
      "timestamp": "2026-03-01T01:00:00Z",
      "probability": 0.3421,
      "alert_level": "LOW"
    },
    {
      "timestamp": "2026-03-01T02:00:00Z",
      "probability": 0.4556,
      "alert_level": "LOW"
    },
    {
      "timestamp": "2026-03-01T06:00:00Z",
      "probability": 0.7847,
      "alert_level": "HIGH"
    },
    ...
  ],
  "model_version": "forecast_24h",
  "model_threshold": 0.7276,
  "data_sources": [
    "open-meteo-archive-api",
    "open-meteo-forecast-api",
    "open-meteo-elevation-api"
  ],
  "timestamp_generated_utc": "2026-03-01T00:15:00Z",
  "request_latency_ms": 742
}
```

---

### 14. **Return to Client**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "latitude": 28.7041,
  "longitude": 77.1025,
  "flood_probability": 0.7847,
  "alert_level": "HIGH",
  "peak_time": "2026-03-01T06:00:00Z",
  ...
}
```

---

## Data Transformations Summary

| Stage | Input Shape | Output Shape | Operation |
|-------|------------|--------------|-----------|
| **Raw Weather** | (120, 6) | (120, 6) | API fetch for past 96h + future 24h |
| **Feature Engineering** | (120, 6) | (120, 13) | Rolling windows, lags, interactions, elevation |
| **Normalization** | (120, 13) | (120, 13) | StandardScaler (μ=0, σ=1) |
| **LSTM Loop (24x)** | (1, 24, 13) | (1,) scalar | Window extraction → LSTM → Sigmoid |
| **Peak Aggregation** | 24 scalars | 2 scalars | max(probs), argmax(probs) → (prob, time) |
| **Alert Mapping** | 1 scalar | 1 string | Classify prob into {LOW, MOD, HIGH, CRIT} |
| **JSON Response** | All above | JSON | Serialize all results for API response |

---

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| **API Latency** | 500 - 1500 ms | Dominated by 2 HTTP calls to Open-Meteo |
| **LSTM Inference** | 1 ms × 24 | Total LSTM compute: ~24ms |
| **Feature Engineering** | ~50 ms | Pandas operations |
| **Normalization** | ~10 ms | Vectorized scaler transform |
| **Model Load Time** | ~50 ms | First request only (then cached) |
| **Memory Per Request** | ~500 KB | Single 120×13 DataFrame in memory |

---

## Caching & Optimization

### Model Loading (Singleton)
```python
@lru_cache(maxsize=1)
def _load_assets():
    # Load model, scaler, config
    # Called once on first /forecast request
    # Subsequent requests reuse cached objects
```

**Impact:** Eliminates repeated disk I/O after first request

### Scaler Caching
- `artifacts/scaler.joblib` loaded once
- Reused across all requests
- Same scaler as used during training (no new fitting)

### No Response Caching
- Each request fetches fresh weather data from Open-Meteo
- No historical caching of results
- Each location/time produces new predictions

---

## Error Handling & Validation

| Error | HTTP Status | Cause |
|-------|------------|-------|
| Invalid lat/lon | 400 Bad Request | Coordinates out of valid range |
| API Unreachable | 503 Service Unavailable | Open-Meteo APIs offline |
| Insufficient Data | 400 Bad Request | < 23 future rows or < 12 historical rows |
| Model Load Failure | 500 Internal Server Error | Checkpoint file corrupted or missing |
| Timeout | 504 Gateway Timeout | Open-Meteo API response > 30 seconds |

---

## Model Metrics (forecast_24h.pt)

Trained on 4.6M samples, validated on 1.2M test samples. **Stopped at epoch 7/30** due to early stopping.

| Metric | Value | Interpretation |
|--------|-------|-----------------|
| **PR-AUC** | 0.9597 | 96.97% precision-recall balance |
| **ROC-AUC** | 1.0000 | Perfect discrimination between classes |
| **F1-Score** | 0.8906 | 89.06% balanced performance |
| **Precision** | 0.8686 | 86.86% of alerts valid |
| **Recall** | 0.9138 | 91.38% of actual floods caught |
| **Test Loss** | 0.0868 | Focal Loss, very low |
| **Threshold** | 0.7276 | F1-optimized decision boundary |

---

## Next Steps for Production

1. **Add Authentication** → API key or OAuth2
2. **Restrict CORS** → Known frontend domains only
3. **Add Rate Limiting** → Per-IP request throttling
4. **Async HTTP Calls** → Use `httpx.AsyncClient` for >100 req/s
5. **Telemetry & Logging** → Track latencies, errors, request volumes
6. **Model Versioning** → Support multiple model checkpoints
7. **Database** → Optional: log predictions for audit trail
