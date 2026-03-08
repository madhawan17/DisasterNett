"""Risk Mapper CLI — produce a flood risk report from a trained FloodLSTM.

Run via DVC or directly:
    python -m src.pipeline.risk.run_risk_mapper
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path
from src.pipeline.saving.checkpoint import load_model


def risk_class(prob: float) -> str:
    if prob < 0.30:
        return "Low"
    if prob <= 0.70:
        return "Moderate"
    return "High"


def confidence(prob: float) -> float:
    return abs(prob - 0.5) * 2.0


def _make_tabular_stub(cfg: dict[str, Any], device: torch.device) -> torch.Tensor:
    """Return a (possibly real) input tensor for demo inference.

    Shape: (1, window_size, 20).
    """
    from src.pipeline.ingestion.loader import FEATURE_COLUMNS  # noqa: PLC0415

    window_size = int(cfg["data"]["window_size"])
    num_features = len(FEATURE_COLUMNS)

    feature_path_str = str(cfg.get("inference", {}).get("default_features") or "")
    if feature_path_str:
        feat_path = resolve_project_path(feature_path_str)
        if feat_path.exists():
            raw = json.loads(feat_path.read_text(encoding="utf-8"))
            row = np.array(
                [float(raw.get(col, 0.0)) for col in FEATURE_COLUMNS],
                dtype=np.float32,
            )
            seq = np.tile(row, (window_size, 1))
            return torch.from_numpy(seq).unsqueeze(0).to(device)

    rng = np.random.default_rng(int(cfg["project"]["seed"]))
    seq = rng.standard_normal((window_size, num_features)).astype(np.float32)
    return torch.from_numpy(seq).unsqueeze(0).to(device)


def main() -> None:
    cfg = load_default_config()

    for key in ("scaler", "checkpoints", "insight_reports"):
        cfg["paths"][key] = str(resolve_project_path(cfg["paths"][key]))
    cfg["paths"]["models_dir"] = str(resolve_project_path(cfg["paths"].get("models_dir", "models")))

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model(cfg, device)

    features = _make_tabular_stub(cfg, device)
    with torch.no_grad():
        prob = float(model(features).item())

    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "probability": round(prob, 6),
        "risk_class": risk_class(prob),
        "confidence": round(confidence(prob), 6),
        "model_version": cfg["project"]["name"],
        "window_size": cfg["data"]["window_size"],
        "flood_threshold": cfg["data"]["flood_threshold"],
        "data_provenance": {
            "dataset": "flood.csv (Kaggle GFD tabular)",
            "features": 20,
            "label": "FloodProbability (regression)",
        },
    }

    infer_cfg = cfg.get("inference", {})
    output_str = str(infer_cfg.get("output_path", "")).strip()
    if output_str:
        output = resolve_project_path(output_str)
    else:
        output = (
            resolve_project_path(cfg["paths"]["insight_reports"])
            / f"risk_report_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
