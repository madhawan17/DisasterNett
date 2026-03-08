"""24-Hour Ahead Flood Forecast Inference — Genuine Future Forecasting.

Strategy
--------
1. Fetch a 48-row window from the Open-Meteo FORECAST API:
     past_hours=24   →  real observed data (grounding lag features)
     forecast_hours=24 → NWP model output (GFS/IFS)
   The DataFrame includes an ``is_forecast`` boolean column.

2. Engineer rolling/lag features across the full 48 rows so that lag
   features at the START of the forecast window are computed from real data.

3. Load the nowcast model (models/best.pt, PR-AUC=0.9923) — this model
   sees a 24-row LSTM window and outputs "flood risk right now".

4. Slide that 24-row LSTM window across each of the 24 future rows:
     window ending at future step t  →  "flood risk at time t"

5. Return max(probabilities) — the answer to "any flood in the next 24h?"
   Also return the peak_time: when the highest risk is predicted.
"""
from __future__ import annotations

import functools
from typing import Any

import joblib
import numpy as np
import pandas as pd
import torch

from src.api.weather_fetcher import fetch_forecast_window
from src.config import load_default_config, PROJECT_ROOT
from src.pipeline.ingestion.loader import FEATURE_COLUMNS
from src.pipeline.training.model import build_model

NOWCAST_WINDOW    = 24    # must match best.pt training WINDOW=24
DEFAULT_THRESHOLD = 0.5   # fallback if not stored in checkpoint
PAST_HOURS        = 168   # 7 days of history so Rain_24h/Rain_12h features
                          # capture cumulative rainfall with full weekly context
FORECAST_HOURS    = 24    # future steps to evaluate


# ─────────────────────────────────────────────────────────────────────────────
# Alert thresholds
# ─────────────────────────────────────────────────────────────────────────────

def _alert_level(prob: float, threshold: float = 0.5) -> str:
    """Alert level anchored to the F1-optimal flood threshold.

    The model baseline for zero-signal (OOD) inputs is sigmoid(0)=0.5.
    Setting LOW boundary at threshold*0.70 (~0.509) means that uncertain
    non-events (0.500x) correctly show as LOW, not MODERATE.

      LOW      prob < threshold * 0.70   (~0.509)
      MODERATE threshold*0.70 to threshold  (0.509–0.728)
      HIGH     threshold to threshold*1.15  (0.728–0.837)
      CRITICAL prob >= threshold * 1.15     (>0.837)
    """
    if prob < threshold * 0.70:
        return "LOW"
    if prob < threshold:
        return "MODERATE"
    if prob < threshold * 1.15:
        return "HIGH"
    return "CRITICAL"


# ─────────────────────────────────────────────────────────────────────────────
# Assets — loaded once, cached
# ─────────────────────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=1)
def _load_assets() -> tuple[Any, Any, dict, float]:
    """Return (nowcast_model, scaler, cfg, threshold) — cached after first call."""
    cfg    = load_default_config()
    device = torch.device("cpu")

    # Use forecast_24h.pt — trained with Focal Loss + WeightedRandomSampler on
    # full 5.8M rows, stores calibrated optimal_threshold, PR-AUC=0.9597.
    # Both are horizon=0 nowcast models; the difference is training quality.
    ckpt_path = PROJECT_ROOT / cfg["paths"].get("models_dir", "models") / "forecast_24h.pt"
    if not ckpt_path.exists():
        raise RuntimeError(
            f"Forecast model not found at '{ckpt_path}'. "
            "Run: python -m src.pipeline.training.run_train_forecast"
        )

    model   = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    payload = torch.load(ckpt_path, map_location=device, weights_only=True)
    model.load_state_dict(payload["model_state_dict"])
    model.eval()
    threshold = float(payload.get("optimal_threshold", DEFAULT_THRESHOLD))
    print(
        f"[forecast] Loaded model from '{ckpt_path}'  "
        f"(epoch {payload.get('epoch', '?')}  threshold={threshold:.4f}  "
        f"pr_auc={payload.get('metrics', {}).get('test_pr_auc', '?')})"
    )

    scaler_path = PROJECT_ROOT / cfg["paths"]["scaler"]
    if not scaler_path.exists():
        raise RuntimeError(f"Scaler not found at '{scaler_path}'. Run 'dvc repro' first.")
    scaler = joblib.load(scaler_path)
    print(f"[forecast] Loaded scaler from '{scaler_path}'")

    return model, scaler, cfg, threshold


# ─────────────────────────────────────────────────────────────────────────────
# Feature engineering (shared with inference.py)
# ─────────────────────────────────────────────────────────────────────────────

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute rolling / lag features.  Preserves ``is_forecast`` if present."""
    df = df.copy().reset_index(drop=True)
    p  = df["Precipitation_mm"]
    sm = df["Soil_Moisture"]
    t  = df["Temperature_C"]

    df["Rain_3h"]       = p.rolling(window=3,  min_periods=1).sum()
    df["Rain_6h"]       = p.rolling(window=6,  min_periods=1).sum()
    df["Rain_12h"]      = p.rolling(window=12, min_periods=1).sum()
    df["Rain_24h"]      = p.rolling(window=24, min_periods=1).sum()
    df["Precip_x_Soil"] = p * sm
    df["Soil_lag1"]     = sm.shift(1).fillna(sm.iloc[0])
    df["Soil_lag3"]     = sm.shift(3).fillna(sm.iloc[0])
    df["Soil_rate"]     = sm - df["Soil_lag1"]
    df["Temp_lag1"]     = t.shift(1).fillna(t.iloc[0])

    return df.dropna().reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# Public function
# ─────────────────────────────────────────────────────────────────────────────

def predict_24h(lat: float, lon: float) -> dict:
    """Predict flood risk across the next 24 hours for a geographic coordinate.

    Fetches real observed data (past 24h) + NWP forecast (next 24h) from
    Open-Meteo, engineers features across the full 48-row window so lag
    features are grounded in reality, then slides the nowcast LSTM over
    each future timestep.

    Returns the MAXIMUM probability seen across all 24 future steps — i.e.
    "what is the chance of flooding at any point in the next 24 hours?"

    Args:
        lat: Latitude  (-90 to 90)
        lon: Longitude (-180 to 180)

    Returns:
        dict with keys:
            lat, lon, flood_probability, alert_level,
            forecast_horizon_hours, based_on_data_until,
            peak_flood_time, features_snapshot, threshold_used
    """
    model, scaler, cfg, threshold = _load_assets()
    device = torch.device("cpu")

    # ── 1. Fetch 24h history + 24h future in one call ─────────────────────────
    raw_df = fetch_forecast_window(lat, lon,
                                   past_hours=PAST_HOURS,
                                   forecast_hours=FORECAST_HOURS)

    # ── 2. Engineer features across ALL 48 rows ───────────────────────────────
    # Stash is_forecast and Timestamp BEFORE engineering so they are not
    # affected by dropna or any other transformation inside _engineer_features.
    is_forecast_arr = raw_df["is_forecast"].values.copy()   # bool[N]
    timestamps_arr  = raw_df["Timestamp"].values.copy()     # datetime[N]

    # Pass only weather columns (no is_forecast) to avoid confusion
    weather_df = raw_df.drop(columns=["is_forecast"])
    feat_df    = _engineer_features(weather_df)

    # _engineer_features may drop leading rows (dropna) — align by tail
    n_dropped = len(raw_df) - len(feat_df)
    feat_df = feat_df.copy()
    feat_df["is_forecast"] = is_forecast_arr[n_dropped:]
    feat_df["Timestamp"]   = pd.to_datetime(timestamps_arr[n_dropped:])

    # ── 3. Identify future rows ───────────────────────────────────────────────
    future_mask    = feat_df["is_forecast"].astype(bool)
    future_indices = feat_df.index[future_mask].tolist()

    if not future_indices:
        raise ValueError("No future rows returned by the forecast API.")

    # ── 4. Scale the full feature matrix ─────────────────────────────────────
    X_all    = feat_df[FEATURE_COLUMNS].values.astype(np.float32)
    X_scaled = scaler.transform(X_all).astype(np.float32)

    # ── 5. Slide LSTM window over each future step ────────────────────────────
    # Window ending at future row i  →  X_scaled[i-W+1 : i+1]
    # If i < W-1 we'd need rows before the start of feat_df — skip those.
    W = NOWCAST_WINDOW
    probs: list[tuple[float, str]] = []   # (probability, timestamp_str)

    model.eval()
    with torch.no_grad():
        timestamps = feat_df["Timestamp"].astype(str).tolist() if "Timestamp" in feat_df.columns else [
            str(raw_df["Timestamp"].iloc[idx]) if idx < len(raw_df) else f"t+{i+1}h"
            for i, idx in enumerate(future_indices)
        ]

        for idx in future_indices:
            start = idx - W + 1
            if start < 0:
                start = 0   # pad from start of available data (first row repeated conceptually)
            window = X_scaled[start: idx + 1]

            # Pad with first row if window is shorter than W (edge case)
            if len(window) < W:
                pad      = np.repeat(window[:1], W - len(window), axis=0)
                window   = np.concatenate([pad, window], axis=0)

            tensor   = torch.from_numpy(window).unsqueeze(0).to(device)  # (1, W, F)
            prob_val = float(model(tensor).item())  # model applies sigmoid internally
            ts_str   = str(feat_df["Timestamp"].iloc[idx]) if "Timestamp" in feat_df.columns else f"t+{idx}h"
            probs.append((prob_val, ts_str))

    # ── 6. Aggregate ──────────────────────────────────────────────────────────
    max_prob, peak_time = max(probs, key=lambda x: x[0])

    # threshold_used stays in the original [0,1] model probability space

    # ── 7. Feature snapshot — last future row ─────────────────────────────────
    last_future_idx   = future_indices[-1]
    last_row          = feat_df.iloc[last_future_idx]
    features_snapshot = {col: round(float(last_row[col]), 4) for col in FEATURE_COLUMNS}

    data_until = str(raw_df["Timestamp"].iloc[-1]) if "Timestamp" in raw_df.columns else "unknown"

    return {
        "lat":                    lat,
        "lon":                    lon,
        "flood_probability":      round(max_prob, 6),
        "alert_level":            _alert_level(max_prob, threshold),
        "forecast_horizon_hours": FORECAST_HOURS,
        "based_on_data_until":    data_until,
        "peak_flood_time":        peak_time,
        "features_snapshot":      features_snapshot,
        "threshold_used":         threshold,
    }
