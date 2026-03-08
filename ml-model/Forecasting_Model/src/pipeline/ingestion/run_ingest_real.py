"""Ingestion + Feature Engineering for real hourly weather data.

Source: global_flash_flood_data_decade.csv  (produced by dataset_gen.py)
Output: data/processed/flood.csv  (enriched, ready for training)

Features engineered (per-city rolling windows on sorted hourly data):

  Base:
    Precipitation_mm   — hourly rainfall (mm)
    Soil_Moisture      — volumetric soil water content (m³/m³)
    Temperature_C      — 2m air temperature (°C)
    Elevation_m        — terrain elevation (m)  [static per city]

  Engineered:
    Rain_3h            — 3-hour rolling sum of precipitation
    Rain_6h            — 6-hour rolling sum
    Rain_12h           — 12-hour rolling sum
    Rain_24h           — 24-hour rolling sum  (matches seq window)
    Precip_x_Soil      — interaction: rain × soil moisture (saturation amplifier)
    Soil_lag1          — soil moisture 1 h ago  (rate of change signal)
    Soil_lag3          — soil moisture 3 h ago
    Soil_rate          — Soil_Moisture − Soil_lag1  (delta, signed)
    Temp_lag1          — temperature 1 h ago

  Total: 13 features

Target: Flash_Flood_Risk  (binary 0/1 — already computed in dataset_gen.py)
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pandas as pd
import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path, PROJECT_ROOT


# ─────────────────────────────────────────────────────────────────────────────
# Feature engineering
# ─────────────────────────────────────────────────────────────────────────────

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add rolling-window and lag features per city group.

    Must be called BEFORE dropping any rows — lags need contiguous rows.
    """
    required = {"City", "Precipitation_mm", "Soil_Moisture", "Temperature_C",
                "Elevation_m", "Flash_Flood_Risk"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Raw CSV missing columns: {missing}")

    groups = []
    for city, grp in df.groupby("City", sort=False):
        grp = grp.copy().reset_index(drop=True)
        p = grp["Precipitation_mm"]
        sm = grp["Soil_Moisture"]
        t  = grp["Temperature_C"]

        # Rolling rain accumulation
        grp["Rain_3h"]  = p.rolling(window=3,  min_periods=1).sum()
        grp["Rain_6h"]  = p.rolling(window=6,  min_periods=1).sum()
        grp["Rain_12h"] = p.rolling(window=12, min_periods=1).sum()
        grp["Rain_24h"] = p.rolling(window=24, min_periods=1).sum()

        # Interaction: precipitation × soil saturation
        grp["Precip_x_Soil"] = p * sm

        # Soil moisture lags (memory of past wetness)
        grp["Soil_lag1"] = sm.shift(1).fillna(sm.iloc[0] if len(sm) else 0.0)
        grp["Soil_lag3"] = sm.shift(3).fillna(sm.iloc[0] if len(sm) else 0.0)

        # Soil rate of change (positive = saturating, negative = drying)
        grp["Soil_rate"] = sm - grp["Soil_lag1"]

        # Temperature lag
        grp["Temp_lag1"] = t.shift(1).fillna(t.iloc[0] if len(t) else 0.0)

        groups.append(grp)

    enriched = pd.concat(groups, ignore_index=True)
    enriched = enriched.dropna().reset_index(drop=True)
    return enriched


FEATURE_COLUMNS_REAL: list[str] = [
    "Precipitation_mm",
    "Soil_Moisture",
    "Temperature_C",
    "Elevation_m",
    "Rain_3h",
    "Rain_6h",
    "Rain_12h",
    "Rain_24h",
    "Precip_x_Soil",
    "Soil_lag1",
    "Soil_lag3",
    "Soil_rate",
    "Temp_lag1",
]


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    cfg = load_default_config()

    # Source: project root or data/raw
    raw_name = "global_flash_flood_data_decade.csv"
    candidates = [
        PROJECT_ROOT / "data" / "raw" / raw_name,
        PROJECT_ROOT / raw_name,
    ]
    raw_path = next((p for p in candidates if p.exists()), None)
    if raw_path is None:
        raise FileNotFoundError(
            f"'{raw_name}' not found. Run dataset_gen.py first, then place "
            f"the CSV in data/raw/ or the project root."
        )

    processed_path = resolve_project_path(cfg["paths"]["csv_processed"])
    processed_path.parent.mkdir(parents=True, exist_ok=True)

    # Also ensure a copy lands in data/raw for DVC tracking
    raw_dest = resolve_project_path("data/raw/" + raw_name)
    raw_dest.parent.mkdir(parents=True, exist_ok=True)
    if raw_path != raw_dest and not raw_dest.exists():
        import shutil
        shutil.copy2(raw_path, raw_dest)
        print(f"[ingestion] Copied source -> '{raw_dest}'")

    print(f"[ingestion] Loading '{raw_path}' ...")
    df = pd.read_csv(raw_path)
    print(f"[ingestion] Loaded {len(df):,} rows x {len(df.columns)} cols")

    # Basic sanity / clean-up
    df = df.dropna(subset=["Precipitation_mm", "Soil_Moisture",
                            "Temperature_C", "Elevation_m", "Flash_Flood_Risk"])
    df["Soil_Moisture"] = df["Soil_Moisture"].clip(0.0, 1.0)
    df["Precipitation_mm"] = df["Precipitation_mm"].clip(lower=0.0)

    # Feature engineering (per city)
    print("[ingestion] Engineering features ...")
    df = engineer_features(df)

    # Keep only model columns + label
    label_col = "Flash_Flood_Risk"
    keep_cols = FEATURE_COLUMNS_REAL + [label_col]
    # City column retained for grouping during split later if needed
    if "City" in df.columns:
        keep_cols = ["City"] + keep_cols
    df = df[keep_cols]

    # Class balance report
    n_flood    = int(df[label_col].sum())
    n_no_flood = len(df) - n_flood
    ratio      = n_no_flood / max(n_flood, 1)
    print(f"[ingestion] Class balance: {n_flood:,} flood  /  {n_no_flood:,} no-flood  "
          f"(ratio 1:{ratio:.1f})")

    df.to_csv(processed_path, index=False)
    print(f"[ingestion] Processed CSV saved -> '{processed_path}'  "
          f"({len(df):,} rows, {len(FEATURE_COLUMNS_REAL)} features + label)")

    # Manifest
    manifest = {
        "status": "ok",
        "source": str(raw_path),
        "destination": str(processed_path),
        "rows": len(df),
        "feature_columns": FEATURE_COLUMNS_REAL,
        "label_column": label_col,
        "flood_rows": n_flood,
        "no_flood_rows": n_no_flood,
        "imbalance_ratio": round(ratio, 2),
    }
    manifest_path = resolve_project_path(cfg["paths"]["ingest_manifest"])
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
