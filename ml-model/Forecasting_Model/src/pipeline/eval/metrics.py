"""Eval — compute regression + binary classification metrics, log to MLflow."""
from __future__ import annotations

import mlflow
import numpy as np
import torch
from sklearn.metrics import (
    average_precision_score,
    mean_absolute_error,
    mean_squared_error,
    precision_recall_fscore_support,
    roc_auc_score,
)
from torch import nn
from torch.utils.data import DataLoader


def evaluate(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    device: torch.device,
    flood_threshold: float,
    epoch: int,
    split: str = "val",
) -> dict[str, float]:
    """Evaluate model on a DataLoader.

    Computes both regression metrics (MSE, MAE) and binary classification
    metrics (PR-AUC, ROC-AUC, F1) by thresholding predicted probabilities at
    `flood_threshold`.

    Logs all metrics to the active MLflow run at the given epoch step.

    Args:
        model:           Trained FloodLSTM in eval mode.
        loader:          DataLoader for val or test split.
        criterion:       Loss function (MSELoss).
        device:          Torch device.
        flood_threshold: Probability cutoff for binary flood/no-flood label.
        epoch:           Current epoch number (MLflow step).
        split:           "val" or "test" — used as MLflow metric prefix.

    Returns:
        Dict of metric names → float values.
    """
    model.eval()
    all_preds: list[float] = []
    all_targets: list[float] = []
    total_loss = 0.0
    steps = 0

    with torch.no_grad():
        for batch in loader:
            features = batch["features"].to(device)
            labels = batch["label"].to(device)
            preds = model(features)
            loss = criterion(preds, labels)
            total_loss += float(loss.item())
            steps += 1
            all_preds.extend(preds.cpu().numpy().tolist())
            all_targets.extend(labels.cpu().numpy().tolist())

    preds_arr = np.array(all_preds, dtype=np.float32)
    targets_arr = np.array(all_targets, dtype=np.float32)
    binary_preds = (preds_arr >= flood_threshold).astype(np.float32)
    binary_targets = (targets_arr >= flood_threshold).astype(np.float32)

    mse = float(mean_squared_error(targets_arr, preds_arr))
    mae = float(mean_absolute_error(targets_arr, preds_arr))

    try:
        pr_auc = float(average_precision_score(binary_targets, preds_arr))
    except ValueError:
        pr_auc = float("nan")

    try:
        roc_auc = float(roc_auc_score(binary_targets, preds_arr))
    except ValueError:
        roc_auc = float("nan")

    precision, recall, f1, _ = precision_recall_fscore_support(
        binary_targets, binary_preds, average="binary", zero_division=0
    )

    metrics = {
        f"{split}_loss": total_loss / max(steps, 1),
        f"{split}_mse": mse,
        f"{split}_mae": mae,
        f"{split}_pr_auc": float(pr_auc),
        f"{split}_roc_auc": float(roc_auc),
        f"{split}_f1": float(f1),
        f"{split}_precision": float(precision),
        f"{split}_recall": float(recall),
    }

    try:
        mlflow.log_metrics(metrics, step=epoch)
    except Exception:
        pass

    return metrics
