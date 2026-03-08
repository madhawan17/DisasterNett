"""Ingestion — load and validate flood.csv, log metadata to MLflow."""
from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import mlflow
    _HAS_MLFLOW = True
except ImportError:
    mlflow = None  # type: ignore[assignment]
    _HAS_MLFLOW = False

import pandas as pd


# 13 engineered features from real hourly weather data (global_flash_flood_data_decade.csv)
FEATURE_COLUMNS: list[str] = [
    # ── Base meteorological ─────────────────────────────────────
    "Precipitation_mm",   # hourly rainfall — primary flood trigger
    "Soil_Moisture",      # volumetric soil water content (0–1)
    "Temperature_C",      # 2m air temperature — affects evaporation
    "Elevation_m",        # terrain elevation — controls runoff speed
    # ── Rolling rainfall accumulation ───────────────────────────
    "Rain_3h",            # 3-hour cumulative precipitation
    "Rain_6h",            # 6-hour cumulative precipitation
    "Rain_12h",           # 12-hour cumulative precipitation
    "Rain_24h",           # 24-hour cumulative precipitation (= window)
    # ── Interaction & lag features ──────────────────────────────
    "Precip_x_Soil",      # rainfall × soil saturation (amplifier)
    "Soil_lag1",          # soil moisture 1 h ago
    "Soil_lag3",          # soil moisture 3 h ago
    "Soil_rate",          # Soil_Moisture − Soil_lag1  (delta)
    "Temp_lag1",          # temperature 1 h ago
]


def load_csv(cfg: dict[str, Any]) -> pd.DataFrame:
    """Load the processed flood CSV (already feature-engineered by ingestion stage).

    Falls back to raw CSV if processed doesn't exist yet.
    Validates that all FEATURE_COLUMNS and the label column are present.
    """
    processed_path = Path(cfg["paths"]["csv_processed"])
    raw_path = Path(cfg["paths"]["csv_raw"])

    if processed_path.exists():
        read_path = processed_path
    elif raw_path.exists():
        read_path = raw_path
    else:
        raise FileNotFoundError(
            f"Neither processed CSV '{processed_path}' nor raw CSV '{raw_path}' found. "
            "Run the ingest stage first."
        )

    df = pd.read_csv(read_path)

    # Schema validation
    label_col = cfg["data"]["label_column"]
    missing_features = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing_features:
        raise ValueError(f"CSV missing expected feature columns: {missing_features}")
    if label_col not in df.columns:
        raise ValueError(f"CSV missing label column '{label_col}'.")

    # ── MLflow logging ───────────────────────────────────────────────────────
    try:
        mlflow.log_params({
            "ingestion.rows": len(df),
            "ingestion.columns": len(df.columns),
            "ingestion.source": str(read_path),
            "ingestion.label_column": label_col,
            "ingestion.missing_values": int(df.isnull().sum().sum()),
        })
        mlflow.set_tags({
            "ingestion.status": "ok",
            "ingestion.feature_count": str(len(FEATURE_COLUMNS)),
        })
    except Exception:
        pass  # MLflow not active

    print(f"[ingestion] Loaded {len(df):,} rows x {len(df.columns)} cols from '{read_path}'")

    return df
