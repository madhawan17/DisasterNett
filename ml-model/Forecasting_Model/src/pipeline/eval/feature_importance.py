"""Eval — feature importance for the FloodLSTM.

Two methods are provided:

1. **Permutation importance** (model-agnostic, most interpretable)
   For each feature column, shuffle its values across all timesteps in the
   test set and measure the drop in PR-AUC.  A large drop → important feature.

2. **Gradient saliency** (gradient-based, fast)
   Compute the mean absolute gradient of the output w.r.t. every input feature
   across the test set, then average across the time dimension.
   High mean |grad| → feature strongly drives the model output.

Both methods return a dict ``{feature_name: importance_score}`` sorted
descending by score.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mlflow
import numpy as np
import torch
from sklearn.metrics import average_precision_score
from torch import nn
from torch.utils.data import DataLoader


# ─────────────────────────────────────────────────────────────────────────────
# Permutation importance
# ─────────────────────────────────────────────────────────────────────────────

def permutation_importance(
    model: nn.Module,
    loader: DataLoader,
    feature_names: list[str],
    device: torch.device,
    flood_threshold: float,
    n_repeats: int = 3,
    seed: int = 42,
) -> dict[str, float]:
    """Estimate feature importance by permutation on the test DataLoader.

    For each feature index *f*:
      - Replace the feature column (across all timesteps) with a shuffled copy.
      - Run inference → compute PR-AUC.
      - importance = baseline_pr_auc - shuffled_pr_auc   (higher = more important)

    Average over ``n_repeats`` shuffles to reduce variance.

    Args:
        model:          Trained model in eval mode.
        loader:         Test DataLoader (``batch["features"]`` shape B×W×F).
        feature_names:  List of F feature names (length must equal F).
        device:         Torch device.
        flood_threshold: Probability cutoff for binary labels.
        n_repeats:      Number of random shuffles per feature.
        seed:           RNG seed for reproducibility.

    Returns:
        Dict mapping feature name → mean importance score, sorted descending.
    """
    model.eval()
    rng = np.random.default_rng(seed)

    # ── Collect full test set as one numpy array ──────────────────────────────
    all_features: list[np.ndarray] = []
    all_labels: list[float] = []
    with torch.no_grad():
        for batch in loader:
            all_features.append(batch["features"].cpu().numpy())   # (B, W, F)
            all_labels.extend(batch["label"].cpu().numpy().tolist())

    X = np.concatenate(all_features, axis=0)  # (N, W, F)
    y_true = (np.array(all_labels) >= flood_threshold).astype(np.float32)

    def _pr_auc(feats: np.ndarray) -> float:
        preds: list[float] = []
        for start in range(0, len(feats), 512):
            chunk = torch.from_numpy(feats[start : start + 512]).to(device)
            with torch.no_grad():
                preds.extend(model(chunk).cpu().numpy().tolist())
        try:
            return float(average_precision_score(y_true, np.array(preds, dtype=np.float32)))
        except ValueError:
            return float("nan")

    baseline = _pr_auc(X)
    print(f"[feature_importance] Baseline PR-AUC = {baseline:.6f}")

    scores: dict[str, float] = {}
    n_features = X.shape[2]

    for f_idx, fname in enumerate(feature_names):
        drop_sum = 0.0
        for _ in range(n_repeats):
            X_perm = X.copy()
            perm_idx = rng.permutation(X_perm.shape[0])
            X_perm[:, :, f_idx] = X_perm[perm_idx, :, f_idx]
            drop_sum += baseline - _pr_auc(X_perm)
        scores[fname] = round(drop_sum / n_repeats, 8)
        print(f"[feature_importance] {fname:40s} Δ PR-AUC = {scores[fname]:+.6f}")

    return dict(sorted(scores.items(), key=lambda x: x[1], reverse=True))


# ─────────────────────────────────────────────────────────────────────────────
# Gradient saliency
# ─────────────────────────────────────────────────────────────────────────────

def gradient_saliency(
    model: nn.Module,
    loader: DataLoader,
    feature_names: list[str],
    device: torch.device,
) -> dict[str, float]:
    """Compute mean |∂output/∂input| per feature across the test set.

    The gradient is taken w.r.t. the raw input tensor; we average over the
    time (window) dimension so each feature gets one scalar score.

    Note: cuDNN LSTM backward requires training mode, so the model is
    temporarily switched to train() for this computation only.

    Args:
        model:         Trained model.
        loader:        Test DataLoader.
        feature_names: List of F feature names.
        device:        Torch device.

    Returns:
        Dict mapping feature name → mean saliency score, sorted descending.
    """
    # cuDNN RNN backward only works in training mode — switch temporarily
    was_training = model.training
    model.train()

    n_features = len(feature_names)
    accum = np.zeros(n_features, dtype=np.float64)
    count = 0

    try:
        for batch in loader:
            feats = batch["features"].to(device).float()  # (B, W, F)
            feats.requires_grad_(True)

            preds = model(feats)                          # (B,)
            loss = preds.sum()
            loss.backward()

            # |grad|: (B, W, F) → mean over B and W → (F,)
            saliency = feats.grad.abs().mean(dim=(0, 1)).detach().cpu().numpy()
            accum += saliency
            count += 1
    finally:
        # Always restore original mode
        model.train(was_training)
        if not was_training:
            model.eval()

    mean_saliency = accum / max(count, 1)
    scores = {
        fname: round(float(mean_saliency[i]), 8)
        for i, fname in enumerate(feature_names)
    }
    return dict(sorted(scores.items(), key=lambda x: x[1], reverse=True))


# ─────────────────────────────────────────────────────────────────────────────
# Graph + persist
# ─────────────────────────────────────────────────────────────────────────────

def save_importance_chart(
    scores: dict[str, float],
    title: str,
    save_path,
    mlflow_active: bool = False,
    color: str = "steelblue",
) -> None:
    """Save a horizontal bar chart of feature importance scores.

    Args:
        scores:       ``{feature: score}`` (already sorted descending).
        title:        Chart title string.
        save_path:    ``pathlib.Path`` where the PNG is written.
        mlflow_active: If True, log the chart as an MLflow artifact.
        color:        Bar colour.
    """
    from pathlib import Path  # lazy import to keep module lightweight
    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)

    names = list(scores.keys())[::-1]   # reverse so highest is at top
    values = list(scores.values())[::-1]

    # Normalise to [0, 1] for a cleaner chart (sign-aware for permutation)
    abs_max = max(abs(v) for v in values) if values else 1.0
    if abs_max == 0:
        abs_max = 1.0

    fig, ax = plt.subplots(figsize=(9, max(4, len(names) * 0.35)))
    colors = ["tab:red" if v < 0 else color for v in values]
    ax.barh(names, [v / abs_max for v in values], color=colors, edgecolor="white")
    ax.set_xlabel("Normalised Importance Score")
    ax.set_title(title)
    ax.axvline(0, color="black", linewidth=0.8)
    ax.grid(axis="x", alpha=0.3)
    plt.tight_layout()

    fig.savefig(save_path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"[feature_importance] Chart saved → '{save_path}'")

    if mlflow_active:
        try:
            mlflow.log_artifact(str(save_path), artifact_path="graphs")
        except Exception:
            pass


def compute_and_save_feature_importance(
    model: nn.Module,
    test_loader: DataLoader,
    feature_names: list[str],
    device: torch.device,
    cfg: dict[str, Any],
    graphs_dir,
    mlflow_active: bool = False,
) -> dict[str, Any]:
    """Run both importance methods, save charts + JSON, return combined result dict.

    Saves:
    - ``<graphs_dir>/feature_importance_permutation.png``
    - ``<graphs_dir>/feature_importance_saliency.png``
    - ``<graphs_dir>/feature_importance.json``

    Returns:
        ``{"permutation": {...}, "saliency": {...}}``
    """
    import json
    from pathlib import Path

    graphs_dir = Path(graphs_dir)
    flood_threshold = float(cfg["data"]["flood_threshold"])
    seed = int(cfg["project"]["seed"])

    print("[feature_importance] Computing permutation importance …")
    perm_scores = permutation_importance(
        model, test_loader, feature_names, device,
        flood_threshold=flood_threshold, seed=seed,
    )

    print("[feature_importance] Computing gradient saliency …")
    grad_scores = gradient_saliency(model, test_loader, feature_names, device)

    # Charts
    save_importance_chart(
        perm_scores,
        title="Permutation Feature Importance (Δ PR-AUC)",
        save_path=graphs_dir / "feature_importance_permutation.png",
        mlflow_active=mlflow_active,
        color="steelblue",
    )
    save_importance_chart(
        grad_scores,
        title="Gradient Saliency (mean |∂output/∂input|)",
        save_path=graphs_dir / "feature_importance_saliency.png",
        mlflow_active=mlflow_active,
        color="darkorange",
    )

    # Combined JSON
    result = {"permutation": perm_scores, "saliency": grad_scores}
    json_path = graphs_dir / "feature_importance.json"
    json_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"[feature_importance] JSON saved → '{json_path}'")

    if mlflow_active:
        try:
            mlflow.log_artifact(str(json_path), artifact_path="eval")
            # Log top-5 permutation scores as MLflow metrics for easy comparison
            for i, (fname, score) in enumerate(list(perm_scores.items())[:5]):
                mlflow.log_metric(f"fi_perm_{fname}", score)
        except Exception:
            pass

    return result
