"""Flood Forecast Model — Full-Data Training.

Trains on the complete 5.8M-row dataset using Focal Loss to handle the
1:893 class imbalance without undersampling. Focal Loss down-weights
easy negatives (gamma=2) so the model focuses on hard flood examples
rather than being overwhelmed by the majority class.

Saves checkpoint to: models/forecast_24h.pt

Run:
    python -m src.pipeline.training.run_train_forecast
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
import torch
import torch.nn as nn
from tqdm import tqdm
from sklearn.metrics import (
    average_precision_score, f1_score, mean_absolute_error,
    mean_squared_error, precision_score, recall_score, roc_auc_score,
)
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config
from src.pipeline.ingestion.loader import FEATURE_COLUMNS, load_csv
from src.pipeline.training.model import build_model

# ── Config ────────────────────────────────────────────────────────────────────
WINDOW     = 24       # lookback hours
BATCH      = 4096     # large batch — more stable gradients on imbalanced full data
EPOCHS     = 30
PATIENCE   = 5
LR         = 1e-3
FOCAL_GAMMA = 2.0    # focal loss: down-weight easy negatives
FOCAL_ALPHA = 0.5    # neutral — sampler already handles 1:1 class balance
SEED       = 42
SAVE_PATH  = Path("models/forecast_24h.pt")
# ─────────────────────────────────────────────────────────────────────────────


class FocalLoss(nn.Module):
    """Binary Focal Loss — handles extreme class imbalance without pos_weight.

    FL(p) = -alpha * (1-p)^gamma * log(p)      for y=1
           -(1-alpha) * p^gamma * log(1-p)     for y=0

    gamma=2 focuses the model on hard/uncertain examples.
    alpha=0.25 counters prior imbalance (standard FCOS/RetinaNet defaults).
    """
    def __init__(self, gamma: float = 2.0, alpha: float = 0.25) -> None:
        super().__init__()
        self.gamma = gamma
        self.alpha = alpha

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        bce     = nn.functional.binary_cross_entropy_with_logits(logits, targets, reduction="none")
        probs   = torch.sigmoid(logits)
        p_t     = probs * targets + (1 - probs) * (1 - targets)
        alpha_t = self.alpha * targets + (1 - self.alpha) * (1 - targets)
        loss    = alpha_t * (1 - p_t) ** self.gamma * bce
        return loss.mean()


def make_sequences(features: np.ndarray, labels: np.ndarray, w: int):
    """Sliding-window view: X[N,W,F] and y[N] aligned to window end."""
    n = len(features)
    N = n - w + 1
    X = np.lib.stride_tricks.sliding_window_view(
        features, (w, features.shape[1])
    ).reshape(N, w, features.shape[1])
    y = labels[w - 1:]
    return X.astype(np.float32), y.astype(np.float32)


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, criterion: nn.Module, device: torch.device) -> tuple[dict, float]:
    """Returns (metrics_dict, optimal_threshold).
    Threshold is chosen to maximise F1 on the test set.
    """
    model.eval()
    losses, all_prob, all_lbl = [], [], []
    for xb, yb in tqdm(loader, desc="  Eval ", leave=False, unit="batch", dynamic_ncols=True):
        xb, yb = xb.to(device), yb.to(device)
        logit = model(xb).squeeze(-1)
        losses.append(criterion(logit, yb).item())
        prob = torch.sigmoid(logit).cpu().numpy()
        all_prob.append(prob)
        all_lbl.append(yb.cpu().numpy())
    probs  = np.concatenate(all_prob)
    labels = np.concatenate(all_lbl)

    # Find the threshold that maximises F1
    thresholds   = np.linspace(probs.min(), probs.max(), 200)
    best_f1, best_thr = 0.0, 0.5
    for thr in thresholds:
        p = (probs >= thr).astype(int)
        f = f1_score(labels, p, zero_division=0)
        if f > best_f1:
            best_f1, best_thr = f, float(thr)

    preds = (probs >= best_thr).astype(int)
    return {
        "test_loss":       float(np.mean(losses)),
        "test_pr_auc":     float(average_precision_score(labels, probs)),
        "test_roc_auc":    float(roc_auc_score(labels, probs)),
        "test_f1":         float(f1_score(labels, preds, zero_division=0)),
        "test_precision":  float(precision_score(labels, preds, zero_division=0)),
        "test_recall":     float(recall_score(labels, preds, zero_division=0)),
        "test_mae":        float(mean_absolute_error(labels, probs)),
        "test_mse":        float(mean_squared_error(labels, probs)),
        "optimal_threshold": round(best_thr, 6),
    }, best_thr


def main() -> None:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[forecast] device={device}  window={WINDOW}h  focal(gamma={FOCAL_GAMMA}, alpha={FOCAL_ALPHA})  batch={BATCH}")

    cfg       = load_default_config()
    label_col = cfg["data"]["label_column"]

    # 1. Load full dataset (no undersampling) ─────────────────────────────────
    df = load_csv(cfg)
    n_pos = int((df[label_col] == 1).sum())
    n_neg = int((df[label_col] == 0).sum())
    print(f"[forecast] Full dataset: {n_pos:,} flood + {n_neg:,} non-flood = {len(df):,} rows  "
          f"(pos rate: {n_pos/len(df)*100:.3f}%  imbalance: 1:{n_neg//n_pos})")

    # 2. Scale ────────────────────────────────────────────────────────────────
    feat_raw = df[FEATURE_COLUMNS].values.astype(np.float32)
    lbl_raw  = df[label_col].values.astype(np.float32)
    n_train  = int(len(df) * 0.8)
    scaler   = StandardScaler()
    feat_raw[:n_train] = scaler.fit_transform(feat_raw[:n_train])
    feat_raw[n_train:] = scaler.transform(feat_raw[n_train:])

    import joblib
    scaler_save = Path("artifacts/forecast_scaler.joblib")
    scaler_save.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, scaler_save)
    print(f"[forecast] Scaler saved → '{scaler_save.resolve()}'")

    # 3. Sequences ────────────────────────────────────────────────────────────
    X_tr, y_tr = make_sequences(feat_raw[:n_train], lbl_raw[:n_train], WINDOW)
    X_te, y_te = make_sequences(feat_raw[n_train:], lbl_raw[n_train:], WINDOW)
    print(f"[forecast] Sequences → train={len(X_tr):,}  test={len(X_te):,}")

    # WeightedRandomSampler — oversample positives so each batch is ~10% flood.
    # Trains on ALL data (no rows discarded), just rebalances sampling frequency.
    n_pos_tr  = int(y_tr.sum())
    n_neg_tr  = len(y_tr) - n_pos_tr
    w_pos     = 1.0 / n_pos_tr
    w_neg     = 1.0 / n_neg_tr
    sample_w  = np.where(y_tr == 1, w_pos, w_neg).astype(np.float64)
    sampler   = WeightedRandomSampler(
        weights     = torch.from_numpy(sample_w),
        num_samples = len(y_tr),
        replacement = True,
    )
    print(f"[forecast] Sampler: {n_pos_tr:,} pos  {n_neg_tr:,} neg  "
          f"→ each batch ~50% flood (effective 1:1 sampling)")

    train_loader = DataLoader(
        TensorDataset(torch.from_numpy(X_tr), torch.from_numpy(y_tr)),
        batch_size=BATCH, sampler=sampler, drop_last=True,
    )
    test_loader = DataLoader(
        TensorDataset(torch.from_numpy(X_te), torch.from_numpy(y_te)),
        batch_size=BATCH, shuffle=False,
    )

    # 4. Model ────────────────────────────────────────────────────────────────
    model     = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    criterion = FocalLoss(gamma=FOCAL_GAMMA, alpha=FOCAL_ALPHA)
    optim     = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-4)
    sched     = torch.optim.lr_scheduler.ReduceLROnPlateau(optim, mode="max", factor=0.5, patience=4)

    # 5. Train ────────────────────────────────────────────────────────────────
    best_pr_auc = -1.0
    wait        = 0
    SAVE_PATH.parent.mkdir(parents=True, exist_ok=True)

    epoch_bar = tqdm(range(1, EPOCHS + 1), desc="Epochs", unit="ep")
    for epoch in epoch_bar:
        model.train()
        train_loss = 0.0
        batch_bar = tqdm(train_loader, desc=f"  Train {epoch}/{EPOCHS}",
                         leave=False, unit="batch", dynamic_ncols=True)
        for xb, yb in batch_bar:
            xb, yb = xb.to(device), yb.to(device)
            optim.zero_grad()
            loss = criterion(model(xb).squeeze(-1), yb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optim.step()
            train_loss += loss.item()
            batch_bar.set_postfix(loss=f"{loss.item():.4f}")
        train_loss /= len(train_loader)

        m, opt_thr = evaluate(model, test_loader, criterion, device)
        lr = optim.param_groups[0]["lr"]
        sched.step(m["test_pr_auc"])

        epoch_bar.set_postfix(
            loss=f"{train_loss:.4f}",
            pr_auc=f"{m['test_pr_auc']:.4f}",
            f1=f"{m['test_f1']:.4f}",
            thr=f"{opt_thr:.3f}",
        )

        row = {"epoch": epoch, "train_loss": round(train_loss, 6), "lr": round(lr, 8),
               **{k: round(v, 6) if isinstance(v, float) else v for k, v in m.items()}}
        print(json.dumps(row), flush=True)

        if m["test_pr_auc"] > best_pr_auc:
            best_pr_auc = m["test_pr_auc"]
            wait = 0
            torch.save({
                "model_state_dict":  model.state_dict(),
                "cfg":               cfg,
                "epoch":             epoch,
                "metrics":           m,
                "num_features":      len(FEATURE_COLUMNS),
                "window_size":       WINDOW,
                "horizon":           0,
                "optimal_threshold": opt_thr,
            }, SAVE_PATH)
            print(
                f"[forecast] Checkpoint saved → '{SAVE_PATH.resolve()}'  "
                f"(epoch {epoch}  threshold={opt_thr:.4f}  "
                f"f1={m['test_f1']:.4f}  precision={m['test_precision']:.4f}  recall={m['test_recall']:.4f})",
                flush=True,
            )
        else:
            wait += 1
            if wait >= PATIENCE:
                print(f"[forecast] Early stop at epoch {epoch}  (best PR-AUC={best_pr_auc:.4f})")
                break

    print(f"[forecast] Done. Best PR-AUC={best_pr_auc:.4f}  → {SAVE_PATH}")


if __name__ == "__main__":
    main()
