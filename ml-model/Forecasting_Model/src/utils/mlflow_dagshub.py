from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import mlflow
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def init_mlflow(cfg: dict[str, Any]) -> None:
    # Ensure .env is loaded before reading any env vars
    load_dotenv(dotenv_path=_ENV_PATH, override=True)

    ml_cfg = cfg["mlflow"]
    tracking_uri = os.getenv("MLFLOW_TRACKING_URI", "").strip()
    username = os.getenv("MLFLOW_TRACKING_USERNAME", "").strip()
    password = os.getenv("MLFLOW_TRACKING_PASSWORD", "").strip()

    if not tracking_uri:
        raise ValueError(
            "MLFLOW_TRACKING_URI not set. Add it to your .env file."
        )

    # DagsHub (and other HTTP remotes) require basic auth passed via env vars
    # that the MLflow client reads automatically.
    if username:
        os.environ["MLFLOW_TRACKING_USERNAME"] = username
    if password:
        os.environ["MLFLOW_TRACKING_PASSWORD"] = password

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(ml_cfg["experiment_name"])


def log_config_params(cfg: dict[str, Any]) -> None:
    flat = _flatten(cfg)
    for key, value in flat.items():
        if isinstance(value, (str, int, float, bool)):
            mlflow.log_param(key, value)


def _flatten(d: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_flatten(v, key))
        else:
            out[key] = v
    return out
