"""Saving — checkpoint best model + scaler, log artifacts to MLflow."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import mlflow
import torch
from torch import nn


def save_best(
    model: nn.Module,
    cfg: dict[str, Any],
    epoch: int,
    metrics: dict[str, float],
) -> Path:
    """Save model checkpoint to *both* ``artifacts/checkpoints/best.pt`` and
    ``models/best.pt`` (the DVC-tracked canonical path).

    Also logs the checkpoint as an MLflow artifact.

    Args:
        model:   FloodLSTM instance (in eval mode is fine).
        cfg:     Project config dict.
        epoch:   Epoch at which this checkpoint was saved.
        metrics: Metric dict to embed in the checkpoint for traceability.

    Returns:
        Path to the canonical (models/) checkpoint file.
    """
    payload = {
        "model_state_dict": model.state_dict(),
        "config": cfg,
        "epoch": epoch,
        "metrics": metrics,
    }

    # ── 1. artifacts/checkpoints/best.pt (legacy / MLflow) ───────────────────
    ckpt_dir = Path(cfg["paths"]["checkpoints"])
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    ckpt_path = ckpt_dir / "best.pt"
    torch.save(payload, ckpt_path)

    # ── 2. models/best.pt (DVC-tracked canonical output) ─────────────────────
    models_dir = Path(cfg["paths"].get("models_dir", "models"))
    models_dir.mkdir(parents=True, exist_ok=True)
    canonical_path = models_dir / "best.pt"
    torch.save(payload, canonical_path)

    try:
        mlflow.log_artifact(str(canonical_path), artifact_path="checkpoints")
        mlflow.log_metrics(
            {f"best_{k}": v for k, v in metrics.items()},
            step=epoch,
        )
    except Exception:
        pass

    print(
        f"[saving] Checkpoint saved → '{canonical_path}'  (epoch {epoch})\n"
        f"         Mirror           → '{ckpt_path}'"
    )
    return canonical_path


def load_model(cfg: dict[str, Any], device: torch.device) -> nn.Module:
    """Load the best saved FloodLSTM checkpoint.

    Searches in order:
    1. ``models/best.pt``  (canonical DVC-tracked output)
    2. ``artifacts/checkpoints/best.pt``  (legacy fallback)

    Imports FloodLSTM lazily to avoid circular imports.
    """
    from src.pipeline.ingestion.loader import FEATURE_COLUMNS  # noqa: PLC0415
    from src.pipeline.training.model import build_model  # noqa: PLC0415

    model = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)

    candidates = [
        Path(cfg["paths"].get("models_dir", "models")) / "best.pt",
        Path(cfg["paths"]["checkpoints"]) / "best.pt",
    ]
    ckpt_path = next((p for p in candidates if p.exists()), None)

    if ckpt_path is not None:
        payload = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(payload["model_state_dict"])
        print(f"[saving] Loaded checkpoint from '{ckpt_path}' (epoch {payload.get('epoch', '?')})")
    else:
        print("[saving] No checkpoint found in models/ or artifacts/checkpoints/ — using random weights.")

    model.eval()
    return model
