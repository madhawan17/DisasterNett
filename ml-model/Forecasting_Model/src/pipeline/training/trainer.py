"""Training — epoch-level training loop, optimizer / scheduler factories."""
from __future__ import annotations

from typing import Any

import mlflow
import torch
from torch import nn
from torch.utils.data import DataLoader


# ──────────────────────────────────────────────────────────────────────────────
# Factories
# ──────────────────────────────────────────────────────────────────────────────

def build_optimizer(
    model: nn.Module,
    cfg: dict[str, Any],
) -> torch.optim.Optimizer:
    """Construct the optimizer from config.

    Supported values for ``train.optimizer``:
    - ``adamw``  (default)
    - ``adam``
    - ``sgd``
    """
    train_cfg = cfg["train"]
    name = str(train_cfg.get("optimizer", "adamw")).lower()
    lr = float(train_cfg["lr"])
    wd = float(train_cfg["weight_decay"])

    if name == "adamw":
        return torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=wd)
    if name == "adam":
        return torch.optim.Adam(model.parameters(), lr=lr, weight_decay=wd)
    if name == "sgd":
        return torch.optim.SGD(
            model.parameters(), lr=lr, weight_decay=wd, momentum=0.9, nesterov=True
        )
    raise ValueError(f"Unknown optimizer '{name}'. Choose: adamw | adam | sgd")


def build_criterion(cfg: dict[str, Any]) -> nn.Module:
    """Construct the loss function from config.

    Supported values for ``loss.name``:
    - ``mse`` — MSELoss for regression.
    - ``bce`` — BCELoss. If ``loss.pos_weight`` is set, flood samples
                (target >= 0.5) are upweighted by that factor to handle
                class imbalance without removing sigmoid from the model.
    """
    loss_cfg = cfg.get("loss", {})
    name = str(loss_cfg.get("name", "bce")).lower()
    if name == "mse":
        return nn.MSELoss()
    if name == "bce":
        pw = loss_cfg.get("pos_weight", None)
        if pw is not None:
            # Weighted BCE: keeps model sigmoid, upweights flood class
            class _WeightedBCE(nn.Module):
                def __init__(self, w: float):
                    super().__init__()
                    self.w = w
                def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
                    weights = torch.where(target >= 0.5,
                                          torch.full_like(target, self.w),
                                          torch.ones_like(target))
                    return nn.functional.binary_cross_entropy(pred, target, weight=weights)
            return _WeightedBCE(float(pw))
        return nn.BCELoss()
    raise ValueError(f"Unknown loss '{name}'. Choose: mse | bce")


def build_scheduler(
    optimizer: torch.optim.Optimizer,
    cfg: dict[str, Any],
) -> torch.optim.lr_scheduler.LRScheduler | None:
    """Construct the LR scheduler from config.

    Supported values for ``train.scheduler``:
    - ``cosine``  — CosineAnnealingLR for ``train.epochs`` steps
    - ``step``    — StepLR with ``train.scheduler_step_size`` / ``train.scheduler_gamma``
    - ``none``    — no scheduler (returns ``None``)
    """
    train_cfg = cfg["train"]
    name = str(train_cfg.get("scheduler", "cosine")).lower()
    epochs = int(train_cfg["epochs"])

    if name == "cosine":
        return torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    if name == "step":
        step = int(train_cfg.get("scheduler_step_size", 10))
        gamma = float(train_cfg.get("scheduler_gamma", 0.5))
        return torch.optim.lr_scheduler.StepLR(optimizer, step_size=step, gamma=gamma)
    if name == "none":
        return None
    raise ValueError(f"Unknown scheduler '{name}'. Choose: cosine | step | none")


# ──────────────────────────────────────────────────────────────────────────────
# Training loop
# ──────────────────────────────────────────────────────────────────────────────

def train_epoch(
    model: nn.Module,
    loader: DataLoader,
    optimizer: torch.optim.Optimizer,
    criterion: nn.Module,
    device: torch.device,
    grad_clip: float,
    amp_enabled: bool,
    scaler: torch.amp.GradScaler,
    epoch: int,
) -> float:
    """Run one training epoch.

    Logs ``train_loss`` to the active MLflow run at the given step (epoch).

    Returns:
        Mean training loss for the epoch.
    """
    model.train()
    total_loss = 0.0
    steps = 0

    for batch in loader:
        features = batch["features"].to(device, non_blocking=True)  # (B, W, F)
        labels = batch["label"].to(device, non_blocking=True)       # (B,)

        optimizer.zero_grad(set_to_none=True)
        with torch.amp.autocast("cuda", enabled=amp_enabled):
            preds = model(features)           # (B,) probabilities
            loss = criterion(preds, labels)

        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=grad_clip)
        scaler.step(optimizer)
        scaler.update()

        total_loss += float(loss.item())
        steps += 1

    mean_loss = total_loss / max(steps, 1)

    try:
        mlflow.log_metric("train_loss", mean_loss, step=epoch)
    except Exception:
        pass

    return mean_loss
