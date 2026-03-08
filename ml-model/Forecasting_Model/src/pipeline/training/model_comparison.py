"""Compare multiple model families on the flood dataset — tracked in MLflow.

Models:
  - lstm        FloodLSTM (PyTorch)
  - xgboost     XGBRegressor
  - lightgbm    LGBMRegressor
  - ridge       Ridge regression (linear baseline)

Each model is trained once with fixed sensible defaults,
evaluated on the held-out test set, results printed + saved.

Run:
    python -m src.pipeline.training.model_comparison
    python -m src.pipeline.training.model_comparison --models xgboost lightgbm ridge
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import warnings
from pathlib import Path
from typing import Any

# Fix Windows console encoding without needing -X utf8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
import mlflow
import torch
from dotenv import load_dotenv
from sklearn.linear_model import Ridge
from sklearn.metrics import average_precision_score, mean_absolute_error, roc_auc_score, mean_squared_error
from torch import nn
from torch.utils.data import DataLoader

warnings.filterwarnings("ignore")

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path, PROJECT_ROOT
from src.pipeline.eval.metrics import evaluate
from src.pipeline.feature_engineering.sliding_window import build_datasets
from src.pipeline.ingestion.loader import FEATURE_COLUMNS, load_csv
from src.pipeline.preprocessing.normalizer import fit_transform
from src.pipeline.training.model import build_model
from src.pipeline.training.trainer import build_optimizer, build_scheduler, build_criterion, train_epoch
from src.pipeline.training.early_stopping import EarlyStopping
from src.utils.mlflow_dagshub import init_mlflow

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _sklearn_metrics(y_true, y_pred, threshold: float) -> dict[str, float]:
    y_bin = (y_pred >= threshold).astype(int)
    return {
        "pr_auc":  float(average_precision_score(y_true >= threshold, y_pred)),
        "roc_auc": float(roc_auc_score(y_true >= threshold, y_pred)),
        "mae":     float(mean_absolute_error(y_true, y_pred)),
        "mse":     float(mean_squared_error(y_true, y_pred)),
    }


def _load_data(cfg: dict):
    df = load_csv(cfg)
    n = len(df)

    split = cfg["data"]["split"]
    train_end = int(n * float(split["train"]))

    train_mask = np.zeros(n, dtype=bool); train_mask[:train_end] = True
    test_mask  = np.zeros(n, dtype=bool); test_mask[train_end:] = True

    features_scaled, labels, _ = fit_transform(df, train_mask, cfg)

    X_train, y_train = features_scaled[train_mask], labels[train_mask]
    X_test,  y_test  = features_scaled[test_mask],  labels[test_mask]

    train_ds, test_ds = build_datasets(features_scaled, labels, cfg)

    return X_train, y_train, X_test, y_test, train_ds, test_ds


# ─────────────────────────────────────────────────────────────────────────────
# LSTM
# ─────────────────────────────────────────────────────────────────────────────

def run_lstm(cfg: dict, train_ds, test_ds, device: torch.device) -> dict[str, Any]:
    print("\n[compare] Training LSTM ...")
    tcfg = cfg["train"]
    batch_size = int(tcfg.get("batch_size", 512))
    epochs     = int(tcfg.get("epochs", 30))
    num_workers = 0

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,  num_workers=num_workers)
    test_loader  = DataLoader(test_ds,  batch_size=batch_size, shuffle=False, num_workers=num_workers)

    model     = build_model(cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    criterion = build_criterion(cfg)
    optimizer = build_optimizer(model, cfg)
    scheduler = build_scheduler(optimizer, cfg)
    scaler    = torch.amp.GradScaler("cpu", enabled=False)
    es_cfg    = cfg["train"].get("early_stopping", {})
    stopper   = EarlyStopping(
        patience  = int(es_cfg.get("patience", 5)),
        min_delta = float(es_cfg.get("min_delta", 0.0)),
        mode      = "max",
    )

    flood_threshold = float(cfg["data"]["flood_threshold"])

    if mlflow.active_run():
        mlflow.end_run()
    with mlflow.start_run(run_name="lstm_comparison", tags={"model": "lstm"}):
        mlflow.log_param("model", "lstm")
        mlflow.log_param("epochs", epochs)
        mlflow.log_param("batch_size", batch_size)

        for epoch in range(1, epochs + 1):
            grad_clip   = float(tcfg.get("grad_clip", 1.0))
            amp_enabled = bool(tcfg.get("amp", False))
            train_loss = train_epoch(model, train_loader, optimizer, criterion,
                                     device, grad_clip, amp_enabled, scaler, epoch)
            test_metrics_epoch = evaluate(model, test_loader, criterion, device,
                                          flood_threshold, epoch, split="test")

            if scheduler is not None:
                scheduler.step()

            mlflow.log_metric("train_loss",   train_loss, step=epoch)
            mlflow.log_metric("test_pr_auc",  test_metrics_epoch["test_pr_auc"],  step=epoch)
            mlflow.log_metric("test_roc_auc", test_metrics_epoch["test_roc_auc"], step=epoch)

            if stopper.step(test_metrics_epoch["test_pr_auc"], epoch):
                print(f"  Early stop at epoch {epoch} (best={stopper.best:.6f} @ epoch {stopper.best_epoch})")
                break

            print(f"  Epoch {epoch:03d}/{epochs}  loss={train_loss:.5f}  test_pr_auc={test_metrics_epoch['test_pr_auc']:.4f}")

    print(f"  LSTM test PR-AUC={test_metrics_epoch['test_pr_auc']:.4f}  ROC-AUC={test_metrics_epoch['test_roc_auc']:.4f}")
    return {"model": "lstm", "pr_auc": test_metrics_epoch["test_pr_auc"], "roc_auc": test_metrics_epoch["test_roc_auc"],
            "mae": test_metrics_epoch["test_mae"], "mse": test_metrics_epoch["test_mse"]}


# ─────────────────────────────────────────────────────────────────────────────
# XGBoost
# ─────────────────────────────────────────────────────────────────────────────

def run_xgboost(cfg: dict, X_train, y_train, X_test, y_test) -> dict[str, Any]:
    import xgboost as xgb
    print("\n[compare] Training XGBoost ...")
    flood_threshold = float(cfg["data"]["flood_threshold"])

    params = dict(
        n_estimators=400, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=1.0, min_child_weight=3,
        objective="reg:logistic", tree_method="hist",
        device="cpu", eval_metric="logloss", verbosity=0,
        random_state=int(cfg["project"]["seed"]),
    )
    model = xgb.XGBRegressor(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    y_pred = np.clip(model.predict(X_test), 0, 1)
    metrics = _sklearn_metrics(y_test, y_pred, flood_threshold)

    if mlflow.active_run():
        mlflow.end_run()
    with mlflow.start_run(run_name="xgboost_comparison", tags={"model": "xgboost"}):
        mlflow.log_params(params)
        mlflow.log_metrics({f"test_{k}": v for k, v in metrics.items()})

    print(f"  XGBoost test PR-AUC={metrics['pr_auc']:.4f}  ROC-AUC={metrics['roc_auc']:.4f}")
    return {"model": "xgboost", **metrics}


# ─────────────────────────────────────────────────────────────────────────────
# LightGBM
# ─────────────────────────────────────────────────────────────────────────────

def run_lightgbm(cfg: dict, X_train, y_train, X_test, y_test) -> dict[str, Any]:
    import lightgbm as lgb
    print("\n[compare] Training LightGBM ...")
    flood_threshold = float(cfg["data"]["flood_threshold"])

    params = dict(
        n_estimators=400, max_depth=6, learning_rate=0.05,
        num_leaves=63, subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=1.0, min_child_samples=20,
        objective="cross_entropy", device="cpu", verbosity=-1,
        random_state=int(cfg["project"]["seed"]),
    )
    model = lgb.LGBMRegressor(**params)
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)])

    y_pred = np.clip(model.predict(X_test), 0, 1)
    metrics = _sklearn_metrics(y_test, y_pred, flood_threshold)

    if mlflow.active_run():
        mlflow.end_run()
    with mlflow.start_run(run_name="lightgbm_comparison", tags={"model": "lightgbm"}):
        mlflow.log_params(params)
        mlflow.log_metrics({f"test_{k}": v for k, v in metrics.items()})

    print(f"  LightGBM test PR-AUC={metrics['pr_auc']:.4f}  ROC-AUC={metrics['roc_auc']:.4f}")
    return {"model": "lightgbm", **metrics}


# ─────────────────────────────────────────────────────────────────────────────
# Ridge (baseline)
# ─────────────────────────────────────────────────────────────────────────────

def run_ridge(cfg: dict, X_train, y_train, X_test, y_test) -> dict[str, Any]:
    print("\n[compare] Training Ridge (baseline) ...")
    flood_threshold = float(cfg["data"]["flood_threshold"])

    model = Ridge(alpha=1.0)
    model.fit(X_train, y_train)

    y_pred = np.clip(model.predict(X_test), 0, 1)
    metrics = _sklearn_metrics(y_test, y_pred, flood_threshold)

    if mlflow.active_run():
        mlflow.end_run()
    with mlflow.start_run(run_name="ridge_comparison", tags={"model": "ridge"}):
        mlflow.log_param("alpha", 1.0)
        mlflow.log_metrics({f"test_{k}": v for k, v in metrics.items()})

    print(f"  Ridge    test PR-AUC={metrics['pr_auc']:.4f}  ROC-AUC={metrics['roc_auc']:.4f}")
    return {"model": "ridge", **metrics}


# ─────────────────────────────────────────────────────────────────────────────
# Comparison chart
# ─────────────────────────────────────────────────────────────────────────────

def _save_comparison_chart(results: list[dict], out_dir: Path) -> None:
    models   = [r["model"]   for r in results]
    pr_aucs  = [r["pr_auc"]  for r in results]
    roc_aucs = [r["roc_auc"] for r in results]

    x = np.arange(len(models))
    fig, ax = plt.subplots(figsize=(8, 5))
    bars1 = ax.bar(x - 0.2, pr_aucs,  0.35, label="PR-AUC")
    bars2 = ax.bar(x + 0.2, roc_aucs, 0.35, label="ROC-AUC")
    ax.set_xticks(x); ax.set_xticklabels(models)
    ax.set_ylim(0, 1); ax.set_ylabel("Score")
    ax.set_title("Model Comparison — Test Set")
    ax.legend()
    for bar in list(bars1) + list(bars2):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                f"{bar.get_height():.3f}", ha="center", va="bottom", fontsize=8)
    plt.tight_layout()
    path = out_dir / "model_comparison.png"
    fig.savefig(path, dpi=120)
    plt.close(fig)
    print(f"\n[compare] Chart saved -> '{path}'")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

ALL_MODELS = ["lstm", "xgboost", "lightgbm", "ridge"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare model families on flood dataset")
    parser.add_argument("--models", nargs="+", default=ALL_MODELS,
                        choices=ALL_MODELS, help="Models to compare")
    args = parser.parse_args()

    load_dotenv(dotenv_path=PROJECT_ROOT / ".env", override=True)
    cfg = load_default_config()
    for key in ("csv_raw", "csv_processed", "scaler", "ingest_manifest", "checkpoints"):
        cfg["paths"][key] = str(resolve_project_path(cfg["paths"][key]))
    cfg["paths"]["models_dir"] = str(resolve_project_path(cfg["paths"].get("models_dir", "models")))

    out_dir = resolve_project_path(cfg["paths"].get("hparam_dir", "artifacts/hparam"))
    out_dir.mkdir(parents=True, exist_ok=True)

    device = torch.device("cpu")
    print(f"[compare] Models: {args.models}")

    # Init MLflow (experiment per comparison run)
    try:
        init_mlflow(cfg)
        mlflow.set_experiment(cfg["mlflow"]["experiment_name"] + "-model-compare")
    except Exception as e:
        print(f"[compare] MLflow init failed, continuing without tracking: {e}")

    # Load data once
    (X_train, y_train, X_test, y_test,
     train_ds, test_ds) = _load_data(cfg)

    all_results: list[dict] = []
    for model_name in args.models:
        if model_name == "lstm":
            r = run_lstm(cfg, train_ds, test_ds, device)
        elif model_name == "xgboost":
            r = run_xgboost(cfg, X_train, y_train, X_test, y_test)
        elif model_name == "lightgbm":
            r = run_lightgbm(cfg, X_train, y_train, X_test, y_test)
        elif model_name == "ridge":
            r = run_ridge(cfg, X_train, y_train, X_test, y_test)
        all_results.append(r)

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 56)
    print(f"  {'MODEL':<12} {'PR-AUC':>10} {'ROC-AUC':>10} {'MAE':>8}")
    print("  " + "-" * 44)
    for r in sorted(all_results, key=lambda x: x["pr_auc"], reverse=True):
        print(f"  {r['model']:<12} {r['pr_auc']:>10.6f} {r['roc_auc']:>10.6f} {r['mae']:>8.6f}")
    print("=" * 56)

    _save_comparison_chart(all_results, out_dir)

    out_path = out_dir / "model_comparison.json"
    out_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
    print(f"[compare] Results saved -> '{out_path}'")


if __name__ == "__main__":
    main()
