"""14-Day Multi-Day Flood Forecast — District-Level Forecasting.

Extends the existing 24-hour forecast to produce **daily** flood-risk
probabilities across up to 16 days using the Open-Meteo NWP forecast API
and the same LSTM nowcast model.

Strategy
--------
1. Fetch ``past_hours`` of observed data + ``forecast_days * 24`` hours of
   NWP forecast from Open-Meteo in a single call.
2. Engineer rolling/lag features across the full window.
3. Slide the 24-row LSTM model across *every* future hourly step.
4. Aggregate hourly probabilities into per-day summaries:
   - ``max_prob`` : highest flood risk in that 24-hour period
   - ``avg_prob`` : mean probability (smoothed view)
   - ``peak_hour``: timestamp of peak risk within the day
5. Return a day-by-day timeline + overall aggregates.
"""
from __future__ import annotations

import functools
import math
from datetime import datetime, timezone
from typing import Any

import joblib
import numpy as np
import pandas as pd
import torch

from src.api.weather_fetcher import fetch_forecast_window
from src.config import load_default_config, PROJECT_ROOT
from src.pipeline.ingestion.loader import FEATURE_COLUMNS
from src.pipeline.training.model import build_model

NOWCAST_WINDOW    = 24      # LSTM window (must match training)
DEFAULT_THRESHOLD = 0.5
PAST_HOURS        = 168     # 7 days history for lag warm-up
MAX_FORECAST_DAYS = 16      # Open-Meteo limit


# ─────────────────────────────────────────────────────────────────────────────
# Alert thresholds  (shared with inference_forecast.py)
# ─────────────────────────────────────────────────────────────────────────────

def _alert_level(prob: float, threshold: float = 0.5) -> str:
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
    """Return (model, scaler, cfg, threshold) — cached after first call."""
    cfg    = load_default_config()
    device = torch.device("cpu")

    # Try forecast_24h.pt first, then best.pt
    models_dir = PROJECT_ROOT / cfg["paths"].get("models_dir", "models")
    ckpt_path  = models_dir / "forecast_24h.pt"
    if not ckpt_path.exists():
        ckpt_path = models_dir / "best.pt"
    if not ckpt_path.exists():
        raise RuntimeError(
            f"No model checkpoint found in '{models_dir}'. "
            "Run training first: python -m src.pipeline.training.run_train_forecast"
        )

    model   = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    payload = torch.load(ckpt_path, map_location=device, weights_only=True)
    model.load_state_dict(payload["model_state_dict"])
    model.eval()
    threshold = float(payload.get("optimal_threshold", DEFAULT_THRESHOLD))
    print(
        f"[multiday] Loaded model from '{ckpt_path}'  "
        f"(epoch {payload.get('epoch', '?')}  threshold={threshold:.4f})"
    )

    scaler_path = PROJECT_ROOT / cfg["paths"]["scaler"]
    if not scaler_path.exists():
        raise RuntimeError(f"Scaler not found at '{scaler_path}'.")
    scaler = joblib.load(scaler_path)

    return model, scaler, cfg, threshold


# ─────────────────────────────────────────────────────────────────────────────
# Feature engineering
# ─────────────────────────────────────────────────────────────────────────────

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Compute rolling / lag features — same as inference_forecast.py."""
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
# Core: multi-day prediction for a single coordinate
# ─────────────────────────────────────────────────────────────────────────────

def predict_multiday(lat: float, lon: float, forecast_days: int = 14) -> dict:
    """Produce day-by-day flood risk across up to 16 days for a coordinate.

    Args:
        lat: Latitude (-90 to 90)
        lon: Longitude (-180 to 180)
        forecast_days: Number of days to forecast (1..16, default 14)

    Returns:
        dict with:
            lat, lon, forecast_days,
            daily_forecasts: [{day, date, max_prob, avg_prob, alert_level, peak_hour}],
            overall_max_prob, overall_alert_level, peak_day, peak_date,
            threshold_used
    """
    forecast_days = max(1, min(forecast_days, MAX_FORECAST_DAYS))
    forecast_hours = forecast_days * 24

    model, scaler, cfg, threshold = _load_assets()
    device = torch.device("cpu")

    # ── 1. Fetch weather ──────────────────────────────────────────────────────
    raw_df = fetch_forecast_window(
        lat, lon,
        past_hours=PAST_HOURS,
        forecast_hours=forecast_hours,
    )

    # ── 2. Engineer features ──────────────────────────────────────────────────
    is_forecast_arr = raw_df["is_forecast"].values.copy()
    timestamps_arr  = raw_df["Timestamp"].values.copy()

    weather_df = raw_df.drop(columns=["is_forecast"])
    feat_df    = _engineer_features(weather_df)

    n_dropped = len(raw_df) - len(feat_df)
    feat_df = feat_df.copy()
    feat_df["is_forecast"] = is_forecast_arr[n_dropped:]
    feat_df["Timestamp"]   = pd.to_datetime(timestamps_arr[n_dropped:])

    # ── 3. Identify future rows ───────────────────────────────────────────────
    future_mask    = feat_df["is_forecast"].astype(bool)
    future_indices = feat_df.index[future_mask].tolist()

    if not future_indices:
        raise ValueError("No future rows returned by the forecast API.")

    # ── 4. Scale features ─────────────────────────────────────────────────────
    X_all    = feat_df[FEATURE_COLUMNS].values.astype(np.float32)
    X_scaled = scaler.transform(X_all).astype(np.float32)

    # ── 5. Slide LSTM window across all future steps ──────────────────────────
    W = NOWCAST_WINDOW
    hourly_probs: list[tuple[float, str]] = []

    model.eval()
    with torch.no_grad():
        for idx in future_indices:
            start = max(0, idx - W + 1)
            window = X_scaled[start: idx + 1]

            if len(window) < W:
                pad    = np.repeat(window[:1], W - len(window), axis=0)
                window = np.concatenate([pad, window], axis=0)

            tensor   = torch.from_numpy(window).unsqueeze(0).to(device)
            prob_val = float(model(tensor).item())
            ts_str   = str(feat_df["Timestamp"].iloc[idx])
            hourly_probs.append((prob_val, ts_str))

    # ── 6. Aggregate into daily buckets ───────────────────────────────────────
    daily_forecasts = []
    hours_per_day   = 24

    for day_num in range(forecast_days):
        start_idx = day_num * hours_per_day
        end_idx   = min(start_idx + hours_per_day, len(hourly_probs))

        if start_idx >= len(hourly_probs):
            break

        day_probs = hourly_probs[start_idx:end_idx]
        if not day_probs:
            continue

        probs_only = [p for p, _ in day_probs]
        max_prob   = max(probs_only)
        avg_prob   = sum(probs_only) / len(probs_only)
        peak_idx   = probs_only.index(max_prob)
        peak_hour  = day_probs[peak_idx][1]

        # Extract the date from the first timestamp in this day bucket
        try:
            day_date = pd.Timestamp(day_probs[0][1]).strftime("%Y-%m-%d")
        except Exception:
            day_date = f"Day {day_num + 1}"

        daily_forecasts.append({
            "day":         day_num + 1,
            "date":        day_date,
            "max_prob":    round(max_prob, 6),
            "avg_prob":    round(avg_prob, 6),
            "alert_level": _alert_level(max_prob, threshold),
            "peak_hour":   peak_hour,
        })

    # ── 7. Overall aggregates ─────────────────────────────────────────────────
    if daily_forecasts:
        overall_max   = max(d["max_prob"] for d in daily_forecasts)
        peak_day_data = max(daily_forecasts, key=lambda d: d["max_prob"])
    else:
        overall_max   = 0.0
        peak_day_data = {"day": 0, "date": "N/A"}

    return {
        "lat":               lat,
        "lon":               lon,
        "forecast_days":     forecast_days,
        "daily_forecasts":   daily_forecasts,
        "overall_max_prob":  round(overall_max, 6),
        "overall_alert_level": _alert_level(overall_max, threshold),
        "peak_day":          peak_day_data["day"],
        "peak_date":         peak_day_data["date"],
        "threshold_used":    threshold,
    }


# ─────────────────────────────────────────────────────────────────────────────
# District-level batch: forecast for multiple points across a bbox
# ─────────────────────────────────────────────────────────────────────────────

def predict_districts(
    bbox: list[float],
    forecast_days: int = 14,
    max_districts: int = 9,
) -> dict:
    """Run multi-day forecasts for a grid of points across a bounding box.

    Rather than relying on GEE (heavy dependency), this samples a grid of
    points across the bbox and names them by cardinal position. This makes
    the endpoint self-contained with no GEE requirement.

    Args:
        bbox: [west, south, east, north]
        forecast_days: 1..16
        max_districts: grid density (4=2x2, 9=3x3, 16=4x4)

    Returns:
        dict with districts array ranked by overall_max_prob descending
    """
    west, south, east, north = bbox
    forecast_days = max(1, min(forecast_days, MAX_FORECAST_DAYS))

    # Determine grid dimensions
    grid_size = max(2, int(math.sqrt(max_districts)))
    lat_step  = (north - south) / grid_size
    lon_step  = (east - west)   / grid_size

    # Grid labels
    ns_labels = ["South", "Central", "North"] if grid_size == 3 else [
        f"Row-{i+1}" for i in range(grid_size)
    ]
    ew_labels = ["West", "Central", "East"] if grid_size == 3 else [
        f"Col-{j+1}" for j in range(grid_size)
    ]

    # Sample points at cell centers
    sample_points = []
    for i in range(grid_size):
        for j in range(grid_size):
            lat = south + (i + 0.5) * lat_step
            lon = west  + (j + 0.5) * lon_step

            ns = ns_labels[min(i, len(ns_labels) - 1)]
            ew = ew_labels[min(j, len(ew_labels) - 1)]
            name = f"District {ns}-{ew}" if ns != ew else f"District {ns}"

            sample_points.append({"name": name, "lat": round(lat, 4), "lon": round(lon, 4)})

    # Run forecasts for each point
    districts = []
    for pt in sample_points:
        try:
            result = predict_multiday(pt["lat"], pt["lon"], forecast_days)
            districts.append({
                "name":               pt["name"],
                "lat":                pt["lat"],
                "lon":                pt["lon"],
                "overall_max_prob":   result["overall_max_prob"],
                "overall_alert_level": result["overall_alert_level"],
                "peak_day":           result["peak_day"],
                "peak_date":          result["peak_date"],
                "daily_forecasts":    result["daily_forecasts"],
                "threshold_used":     result["threshold_used"],
            })
        except Exception as exc:
            print(f"[multiday] Forecast failed for {pt['name']} ({pt['lat']}, {pt['lon']}): {exc}")
            districts.append({
                "name":               pt["name"],
                "lat":                pt["lat"],
                "lon":                pt["lon"],
                "overall_max_prob":   0.0,
                "overall_alert_level": "LOW",
                "peak_day":           0,
                "peak_date":          "N/A",
                "daily_forecasts":    [],
                "threshold_used":     DEFAULT_THRESHOLD,
                "error":              str(exc),
            })

    # Sort by overall risk (highest first)
    districts.sort(key=lambda d: d["overall_max_prob"], reverse=True)

    return {
        "bbox":           bbox,
        "forecast_days":  forecast_days,
        "grid_size":      grid_size,
        "total_districts": len(districts),
        "districts":      districts,
    }
