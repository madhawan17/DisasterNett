"""Raw-Feature Flood Prediction — No Open-Meteo, No Coordinates.

Accepts the 5 base meteorological feature values directly and returns
a flood probability.  The 9 remaining engineered features (rolling sums,
lags, interaction) are computed automatically assuming the provided values
represent steady-state conditions over 24 hours.

Usage:
    POST /predict_raw
    {
        "precipitation_mm": 25.0,
        "soil_moisture": 0.42,
        "temperature_c": 22.5,
        "elevation_m": 50.0,
        "wind_speed_kmh": 15.0   # optional — not used by LSTM but kept for parity
    }
"""
from __future__ import annotations

import numpy as np
import torch

from src.api.inference_forecast import _load_assets, _alert_level
from src.pipeline.ingestion.loader import FEATURE_COLUMNS

WINDOW = 24  # LSTM window size (hours)


def predict_from_raw(
    precipitation_mm: float,
    soil_moisture: float,
    temperature_c: float,
    elevation_m: float,
) -> dict:
    """Run flood prediction from raw feature values.

    Simulates a 24-hour window of constant conditions, engineers the
    13 features the LSTM expects, scales them, and returns a probability.

    Args:
        precipitation_mm: Hourly rainfall in mm (e.g. 25.0)
        soil_moisture:    Volumetric soil water content 0–1 (e.g. 0.42)
        temperature_c:    2 m air temperature in °C (e.g. 22.5)
        elevation_m:      Terrain elevation in metres (e.g. 50.0)

    Returns:
        dict with flood_probability, alert_level, features_snapshot, etc.
    """
    model, scaler, _cfg, threshold = _load_assets()
    device = torch.device("cpu")

    # ── 1. Build a 24-row DataFrame of constant conditions ────────────────
    #    This lets rolling windows (3h, 6h, …) accumulate naturally.
    rows = []
    for _ in range(WINDOW):
        rows.append({
            "Precipitation_mm": precipitation_mm,
            "Soil_Moisture":    soil_moisture,
            "Temperature_C":    temperature_c,
            "Elevation_m":      elevation_m,
        })

    # ── 2. Engineer the 9 derived features ────────────────────────────────
    import pandas as pd
    df = pd.DataFrame(rows)

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

    # ── 3. Extract the 13 feature columns in model order ──────────────────
    X = df[FEATURE_COLUMNS].values.astype(np.float32)  # (24, 13)

    # ── 4. Scale with the fitted scaler ───────────────────────────────────
    X_scaled = scaler.transform(X).astype(np.float32)

    # ── 5. Run LSTM ──────────────────────────────────────────────────────
    tensor = torch.from_numpy(X_scaled).unsqueeze(0).to(device)  # (1, 24, 13)
    model.eval()
    with torch.no_grad():
        prob = float(model(tensor).item())

    # ── 6. Feature snapshot (last row — fully accumulated) ────────────────
    last_row = df.iloc[-1]
    features_snapshot = {col: round(float(last_row[col]), 4) for col in FEATURE_COLUMNS}

    return {
        "flood_probability": round(prob, 6),
        "alert_level":       _alert_level(prob, threshold),
        "threshold_used":    threshold,
        "window_hours":      WINDOW,
        "input_features": {
            "Precipitation_mm": precipitation_mm,
            "Soil_Moisture":    soil_moisture,
            "Temperature_C":    temperature_c,
            "Elevation_m":      elevation_m,
        },
        "engineered_features": features_snapshot,
    }
