"""Inference pipeline — coordinates → flood risk probability.

Flow:
    1. Fetch last 72 h of hourly weather from Open-Meteo  (weather_fetcher)
    2. Engineer the same 13 features as the training ingestion stage
    3. Apply the saved StandardScaler (fit on training data only)
    4. Slice the last window_size (24) rows → tensor (1, 24, 13)
    5. Run FloodLSTM → sigmoid probability in [0, 1]
    6. Map to alert level  LOW / MODERATE / HIGH / CRITICAL

Model and scaler are loaded once at startup and cached.
"""
from __future__ import annotations

import functools
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import torch

from src.api.weather_fetcher import fetch_hourly
from src.config import load_default_config, PROJECT_ROOT
from src.pipeline.ingestion.loader import FEATURE_COLUMNS
from src.pipeline.training.model import build_model


# ─────────────────────────────────────────────────────────────────────────────
# Alert thresholds
# ─────────────────────────────────────────────────────────────────────────────

def _alert_level(prob: float) -> str:
    """Alert level for nowcast. Baseline for zero-signal inputs is ~0.5;
    LOW boundary at 0.51 ensures uncertain OOD inputs show as LOW.

      LOW      prob < 0.51
      MODERATE 0.51 – 0.72
      HIGH     0.72 – 0.85
      CRITICAL >= 0.85
    """
    if prob < 0.51:
        return "LOW"
    if prob < 0.72:
        return "MODERATE"
    if prob < 0.85:
        return "HIGH"
    return "CRITICAL"


# ─────────────────────────────────────────────────────────────────────────────
# Model + scaler — loaded once, cached for the lifetime of the process
# ─────────────────────────────────────────────────────────────────────────────

@functools.lru_cache(maxsize=1)
def _load_assets() -> tuple[Any, Any, dict]:
    """Return (model, scaler, cfg) — cached after first call."""
    cfg = load_default_config()
    device = torch.device("cpu")

    # ── Model ─────────────────────────────────────────────────────────────────
    ckpt_candidates = [
        PROJECT_ROOT / cfg["paths"].get("models_dir", "models") / "best.pt",
        PROJECT_ROOT / cfg["paths"]["checkpoints"] / "best.pt",
    ]
    ckpt_path = next((p for p in ckpt_candidates if p.exists()), None)

    model = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    if ckpt_path is not None:
        payload = torch.load(ckpt_path, map_location=device, weights_only=True)
        model.load_state_dict(payload["model_state_dict"])
        print(f"[inference] Loaded model from '{ckpt_path}'  (epoch {payload.get('epoch', '?')})")
    else:
        print("[inference] WARNING: No checkpoint found. Using random weights — run 'dvc repro' first.")

    model.eval()

    # ── Scaler ────────────────────────────────────────────────────────────────
    scaler_path = PROJECT_ROOT / cfg["paths"]["scaler"]
    if not scaler_path.exists():
        raise RuntimeError(
            f"Scaler not found at '{scaler_path}'. Run 'dvc repro' (train stage) first."
        )
    scaler = joblib.load(scaler_path)
    print(f"[inference] Loaded scaler from '{scaler_path}'")

    return model, scaler, cfg


# ─────────────────────────────────────────────────────────────────────────────
# Feature engineering  (mirrors run_ingest_real.py but for a single location)
# ─────────────────────────────────────────────────────────────────────────────

def _engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Apply the same 13-feature engineering as the ingestion stage.

    Input df must have columns:
        Precipitation_mm, Soil_Moisture, Temperature_C, Elevation_m, Timestamp
    """
    df = df.copy().reset_index(drop=True)
    p  = df["Precipitation_mm"]
    sm = df["Soil_Moisture"]
    t  = df["Temperature_C"]

    # Rolling rain accumulation
    df["Rain_3h"]  = p.rolling(window=3,  min_periods=1).sum()
    df["Rain_6h"]  = p.rolling(window=6,  min_periods=1).sum()
    df["Rain_12h"] = p.rolling(window=12, min_periods=1).sum()
    df["Rain_24h"] = p.rolling(window=24, min_periods=1).sum()

    # Interaction: precipitation × soil saturation
    df["Precip_x_Soil"] = p * sm

    # Soil moisture lags
    df["Soil_lag1"] = sm.shift(1).fillna(sm.iloc[0])
    df["Soil_lag3"] = sm.shift(3).fillna(sm.iloc[0])

    # Soil rate of change
    df["Soil_rate"] = sm - df["Soil_lag1"]

    # Temperature lag
    df["Temp_lag1"] = t.shift(1).fillna(t.iloc[0])

    return df.dropna().reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# Public inference function
# ─────────────────────────────────────────────────────────────────────────────

def predict(lat: float, lon: float) -> dict:
    """Run the full inference pipeline for a geographic coordinate.

    Args:
        lat: Latitude  (-90 to 90)
        lon: Longitude (-180 to 180)

    Returns:
        dict with keys:
            lat, lon, flood_probability, alert_level,
            window_hours, latest_timestamp, features_snapshot
    """
    model, scaler, cfg = _load_assets()
    window_size = int(cfg["data"]["window_size"])  # 24
    device = torch.device("cpu")

    # ── 1. Fetch weather ──────────────────────────────────────────────────────
    raw_df = fetch_hourly(lat, lon)

    # ── 2. Engineer features ──────────────────────────────────────────────────
    feat_df = _engineer_features(raw_df)

    if len(feat_df) < window_size:
        raise ValueError(
            f"After feature engineering only {len(feat_df)} rows available; "
            f"need at least {window_size}."
        )

    # Take the most recent window_size rows
    window_df = feat_df.tail(window_size).reset_index(drop=True)
    latest_ts = str(raw_df["Timestamp"].iloc[-1])

    # ── 3. Scale ──────────────────────────────────────────────────────────────
    X = window_df[FEATURE_COLUMNS].values.astype(np.float32)   # (24, 13)
    X_scaled = scaler.transform(X).astype(np.float32)           # (24, 13)

    # ── 4. Inference ──────────────────────────────────────────────────────────
    tensor = torch.from_numpy(X_scaled).unsqueeze(0).to(device)  # (1, 24, 13)

    with torch.no_grad():
        prob: float = float(model(tensor).item())

    # ── 5. Feature snapshot (last row — most recent hour) ─────────────────────
    last_row = window_df.iloc[-1]
    features_snapshot = {col: round(float(last_row[col]), 4) for col in FEATURE_COLUMNS}

    return {
        "lat": lat,
        "lon": lon,
        "flood_probability": prob,
        "alert_level": _alert_level(prob),
        "window_hours": window_size,
        "latest_timestamp": latest_ts,
        "features_snapshot": features_snapshot,
    }
