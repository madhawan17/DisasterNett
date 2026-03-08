"""Training CLI — full sliding-window LSTM pipeline with early stopping and graph saving.

Run via DVC or directly:
    python -m src.pipeline.training.run_train
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

# Fix Windows console encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import matplotlib
matplotlib.use("Agg")  # headless rendering
import matplotlib.pyplot as plt
import mlflow
import numpy as np
import torch
from torch.utils.data import DataLoader

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path
from src.pipeline.eval.feature_importance import compute_and_save_feature_importance
from src.pipeline.eval.metrics import evaluate
from src.pipeline.feature_engineering.sliding_window import build_datasets
from src.pipeline.ingestion.loader import FEATURE_COLUMNS, load_csv
from src.pipeline.preprocessing.normalizer import fit_transform
from src.pipeline.saving.checkpoint import save_best
from src.pipeline.training.early_stopping import EarlyStopping
from src.pipeline.training.model import build_model
from src.pipeline.training.trainer import build_criterion, build_optimizer, build_scheduler, train_epoch
from src.utils.mlflow_dagshub import init_mlflow


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _make_splits_mask(n: int, cfg: dict) -> tuple[np.ndarray, np.ndarray]:
    split = cfg["data"]["split"]
    n_train = int(n * float(split["train"]))
    idx = np.arange(n)
    train_mask = np.zeros(n, dtype=bool)
    train_mask[idx[:n_train]] = True
    test_mask = np.zeros(n, dtype=bool)
    test_mask[idx[n_train:]] = True
    return train_mask, test_mask


def _save_graphs(
    history: list[dict],
    graphs_dir: Path,
    mlflow_active: bool = False,
) -> None:
    """Render and save training-curve plots to ``graphs_dir``.

    Plots produced:
    - ``loss_curve.png``      — train loss + val loss per epoch
    - ``pr_auc_curve.png``    — val PR-AUC per epoch
    - ``roc_auc_curve.png``   — val ROC-AUC per epoch
    - ``mae_mse_curve.png``   — val MAE + MSE per epoch
    """
    graphs_dir.mkdir(parents=True, exist_ok=True)

    epochs = [r["epoch"] for r in history]

    def _save(fig: plt.Figure, name: str) -> None:
        path = graphs_dir / name
        fig.savefig(path, dpi=120, bbox_inches="tight")
        plt.close(fig)
        print(f"[graphs] Saved → '{path}'")
        if mlflow_active:
            try:
                mlflow.log_artifact(str(path), artifact_path="graphs")
            except Exception:
                pass

    # ── Loss curve ───────────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(epochs, [r["train_loss"] for r in history], label="train loss", marker="o", markersize=3)
    ax.plot(epochs, [r.get("test_loss", float("nan")) for r in history], label="test loss",
            marker="s", markersize=3)
    ax.set_xlabel("Epoch")
    ax.set_ylabel("MSE Loss")
    ax.set_title("Training & Validation Loss")
    ax.legend()
    ax.grid(True, alpha=0.3)
    _save(fig, "loss_curve.png")

    # ── PR-AUC curve ─────────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(epochs, [r.get("test_pr_auc", float("nan")) for r in history],
            label="test PR-AUC", color="tab:green", marker="o", markersize=3)
    ax.set_xlabel("Epoch")
    ax.set_ylabel("PR-AUC")
    ax.set_title("Validation PR-AUC")
    ax.legend()
    ax.grid(True, alpha=0.3)
    _save(fig, "pr_auc_curve.png")

    # ── ROC-AUC curve ────────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(epochs, [r.get("test_roc_auc", float("nan")) for r in history],
            label="test ROC-AUC", color="tab:orange", marker="o", markersize=3)
    ax.set_xlabel("Epoch")
    ax.set_ylabel("ROC-AUC")
    ax.set_title("Validation ROC-AUC")
    ax.legend()
    ax.grid(True, alpha=0.3)
    _save(fig, "roc_auc_curve.png")

    # ── MAE / MSE curve ───────────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(epochs, [r.get("test_mae", float("nan")) for r in history],
            label="test MAE", color="tab:red", marker="o", markersize=3)
    ax_r = ax.twinx()
    ax_r.plot(epochs, [r.get("test_mse", float("nan")) for r in history],
              label="val MSE", color="tab:purple", linestyle="--", marker="s", markersize=3)
    ax.set_xlabel("Epoch")
    ax.set_ylabel("MAE")
    ax_r.set_ylabel("MSE")
    ax.set_title("Validation MAE / MSE")
    lines_a, labels_a = ax.get_legend_handles_labels()
    lines_b, labels_b = ax_r.get_legend_handles_labels()
    ax.legend(lines_a + lines_b, labels_a + labels_b, loc="upper right")
    ax.grid(True, alpha=0.3)
    _save(fig, "mae_mse_curve.png")

    # ── LR schedule ──────────────────────────────────────────────────────────
    if any("lr" in r for r in history):
        fig, ax = plt.subplots(figsize=(8, 3))
        ax.plot(epochs, [r.get("lr", float("nan")) for r in history],
                label="learning rate", color="tab:blue", marker="o", markersize=3)
        ax.set_xlabel("Epoch")
        ax.set_ylabel("LR")
        ax.set_title("Learning Rate Schedule")
        ax.legend()
        ax.grid(True, alpha=0.3)
        _save(fig, "lr_schedule.png")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    cfg = load_default_config()

    # Resolve all paths
    for key in ("csv_raw", "csv_processed", "scaler", "ingest_manifest", "checkpoints"):
        cfg["paths"][key] = str(resolve_project_path(cfg["paths"][key]))
    cfg["paths"]["models_dir"] = str(resolve_project_path(cfg["paths"].get("models_dir", "models")))
    graphs_dir = resolve_project_path(cfg["paths"].get("graphs_dir", "artifacts/graphs"))

    torch.manual_seed(cfg["project"]["seed"])
    np.random.seed(cfg["project"]["seed"])

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_cfg = cfg["train"]
    amp_enabled = bool(train_cfg["amp"]) and device.type == "cuda"

    # ── MLflow setup ─────────────────────────────────────────────────────────
    mlflow_active = False
    if cfg["mlflow"]["enabled"]:
        try:
            init_mlflow(cfg)
            mlflow.start_run(run_name=cfg["mlflow"]["run_name"])
            mlflow.log_params({
                "model.hidden_size": cfg["model"]["hidden_size"],
                "model.lstm_layers": cfg["model"]["lstm_layers"],
                "model.dropout": cfg["model"]["dropout"],
                "data.window_size": cfg["data"]["window_size"],
                "data.flood_threshold": cfg["data"]["flood_threshold"],
                "train.epochs": train_cfg["epochs"],
                "train.batch_size": train_cfg["batch_size"],
                "train.lr": train_cfg["lr"],
                "train.grad_clip": train_cfg["grad_clip"],
                "train.optimizer": train_cfg.get("optimizer", "adamw"),
                "train.scheduler": train_cfg.get("scheduler", "cosine"),
                "train.early_stopping.patience": train_cfg.get("early_stopping", {}).get("patience", 5),
                "loss": cfg.get("loss", {}).get("name", "mse"),
                "features": ", ".join(FEATURE_COLUMNS),
            })
            mlflow_active = True
        except Exception as exc:
            print(f"[train] MLflow init failed, continuing without tracking: {exc}")

    # ── 1. Ingestion ──────────────────────────────────────────────────────────
    df = load_csv(cfg)

    # ── 2. Preprocessing ──────────────────────────────────────────────────────
    n = len(df)
    train_mask, _ = _make_splits_mask(n, cfg)
    features_scaled, labels, _ = fit_transform(df, train_mask, cfg)

    # ── 3. Feature Engineering ────────────────────────────────────────────────
    train_ds, test_ds = build_datasets(features_scaled, labels, cfg)

    num_workers = int(cfg["project"]["num_workers"])
    batch_size = int(train_cfg["batch_size"])

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=device.type == "cuda",
    )
    test_loader = DataLoader(
        test_ds, batch_size=batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=device.type == "cuda",
    )

    # ── 4. Model + optimizer + scheduler ─────────────────────────────────────
    model = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    criterion = build_criterion(cfg)
    optimizer = build_optimizer(model, cfg)
    scheduler = build_scheduler(optimizer, cfg)
    amp_scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)

    # ── 5. Early stopping ─────────────────────────────────────────────────────
    es_cfg = train_cfg.get("early_stopping", {})
    early_stopping = EarlyStopping(
        patience=int(es_cfg.get("patience", 5)),
        min_delta=float(es_cfg.get("min_delta", 0.0005)),
        mode="max",  # we monitor PR-AUC (higher = better)
    ) if bool(es_cfg.get("enabled", True)) else None

    flood_threshold = float(cfg["data"]["flood_threshold"])
    best_pr_auc = -1.0
    best_epoch = 0
    history: list[dict] = []

    # ── 6. Training loop ──────────────────────────────────────────────────────
    for epoch in range(1, int(train_cfg["epochs"]) + 1):
        train_loss = train_epoch(
            model, train_loader, optimizer, criterion, device,
            grad_clip=float(train_cfg["grad_clip"]),
            amp_enabled=amp_enabled,
            scaler=amp_scaler,
            epoch=epoch,
        )

        val_metrics = evaluate(
            model, test_loader, criterion, device,
            flood_threshold=flood_threshold, epoch=epoch, split="test",
        )

        current_lr = float(optimizer.param_groups[0]["lr"])
        if scheduler is not None:
            scheduler.step()

        try:
            mlflow.log_metric("lr", current_lr, step=epoch)
        except Exception:
            pass

        row: dict = {
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "lr": round(current_lr, 8),
            **{k: round(v, 6) for k, v in val_metrics.items()},
        }
        history.append(row)
        print(json.dumps(row))

        # ── Save best ─────────────────────────────────────────────────────────
        if val_metrics["test_pr_auc"] > best_pr_auc:
            best_pr_auc = val_metrics["test_pr_auc"]
            best_epoch = epoch
            save_best(model, cfg, epoch, val_metrics)

        # ── Early stopping check ──────────────────────────────────────────────
        if early_stopping is not None:
            if early_stopping.step(val_metrics["test_pr_auc"], epoch=epoch):
                print(
                    f"[train] Early stopping triggered at epoch {epoch} "
                    f"(no improvement for {early_stopping.patience} epochs). "
                    f"Best epoch: {early_stopping.best_epoch}, best PR-AUC: {early_stopping.best:.6f}"
                )
                break

    # ── 7. Save training graphs ────────────────────────────────────────────────
    _save_graphs(history, graphs_dir, mlflow_active=mlflow_active)

    # ── 8. Final test evaluation ───────────────────────────────────────────────
    from src.pipeline.saving.checkpoint import load_model as _load  # noqa: PLC0415
    best_model = _load(cfg, device)
    test_metrics = evaluate(
        best_model, test_loader, criterion, device,
        flood_threshold=flood_threshold, epoch=best_epoch, split="test",
    )
    print(json.dumps({"test": test_metrics}))

    # ── 9. Feature importance ─────────────────────────────────────────────────
    fi_results = compute_and_save_feature_importance(
        best_model, test_loader, FEATURE_COLUMNS, device,
        cfg=cfg, graphs_dir=graphs_dir, mlflow_active=mlflow_active,
    )

    # ── 10. Save metrics JSON ──────────────────────────────────────────────────
    ckpt_dir = Path(cfg["paths"]["checkpoints"])
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    metrics_payload = {
        "best_val_pr_auc": best_pr_auc,
        "best_epoch": best_epoch,
        "total_epochs_run": len(history),
        "early_stopped": early_stopping.should_stop if early_stopping else False,
        "optimizer": train_cfg.get("optimizer", "adamw"),
        "scheduler": train_cfg.get("scheduler", "cosine"),
        "test": test_metrics,
        "feature_importance": {
            "top5_permutation": dict(list(fi_results["permutation"].items())[:5]),
            "top5_saliency": dict(list(fi_results["saliency"].items())[:5]),
        },
    }
    metrics_path = ckpt_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics_payload, indent=2), encoding="utf-8")

    if mlflow_active:
        try:
            mlflow.log_artifact(str(metrics_path), artifact_path="eval")
            mlflow.end_run()
        except Exception:
            pass

    print(f"[train] Done. Best val PR-AUC={best_pr_auc:.6f} at epoch {best_epoch}.")


if __name__ == "__main__":
    main()
