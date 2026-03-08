"""Preprocessing — StandardScaler fit/transform + joblib persistence."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import mlflow
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

from src.pipeline.ingestion.loader import FEATURE_COLUMNS


def fit_transform(
    df: pd.DataFrame,
    train_mask: np.ndarray,
    cfg: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, StandardScaler]:
    """Fit a StandardScaler on the training rows only, then transform all rows.

    Args:
        df:         Full DataFrame (all splits).
        train_mask: Boolean mask identifying training rows.
        cfg:        Project config dict.

    Returns:
        features_scaled: float32 array [N, 20]
        labels:          float32 array [N]  (raw FloodProbability, already 0-1)
        scaler:          Fitted StandardScaler (saved to disk + MLflow artifact).
    """
    label_col = cfg["data"]["label_column"]
    feature_cols = FEATURE_COLUMNS

    X = df[feature_cols].values.astype(np.float32)
    y = df[label_col].values.astype(np.float32)

    scaler = StandardScaler()
    scaler.fit(X[train_mask])
    X_scaled = scaler.transform(X).astype(np.float32)

    # ── Persist scaler ───────────────────────────────────────────────────────
    scaler_path = Path(cfg["paths"]["scaler"])
    scaler_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, scaler_path)

    # ── MLflow logging ───────────────────────────────────────────────────────
    try:
        mlflow.log_params({
            "preprocessing.scaler": "StandardScaler",
            "preprocessing.n_features": len(feature_cols),
            "preprocessing.train_rows": int(train_mask.sum()),
        })
        mlflow.log_artifact(str(scaler_path), artifact_path="preprocessing")
    except Exception:
        pass

    print(f"[preprocessing] Scaler fitted on {int(train_mask.sum()):,} training rows.")
    print(f"[preprocessing] Scaler saved → '{scaler_path}'")

    return X_scaled, y, scaler


def load_scaler(cfg: dict[str, Any]) -> StandardScaler:
    """Load a previously saved scaler from disk."""
    path = Path(cfg["paths"]["scaler"])
    if not path.exists():
        raise FileNotFoundError(f"Scaler not found at '{path}'. Run training first.")
    return joblib.load(path)
