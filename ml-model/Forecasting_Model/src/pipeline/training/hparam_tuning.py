"""Hyperparameter tuning across multiple model families — tracked in MLflow.

Models tuned:
  - lstm        FloodLSTM (PyTorch)
  - xgboost     XGBRegressor
  - lightgbm    LGBMRegressor
  - ridge       Ridge regression (linear baseline)

Each model family gets its own Optuna study. Every trial is logged as a
child MLflow run nested under a parent run named "<model>_hparam_search".
The best trial for each model is re-evaluated on the test set and a final
comparison table is printed + saved to artifacts/graphs/hparam_comparison.json.

Run:
    python -m src.pipeline.training.hparam_tuning
    python -m src.pipeline.training.hparam_tuning --models lstm xgboost
    python -m src.pipeline.training.hparam_tuning --trials 30
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import optuna
import mlflow
import torch
from dotenv import load_dotenv
from sklearn.linear_model import Ridge
from sklearn.metrics import average_precision_score, mean_absolute_error, roc_auc_score
from torch import nn
from torch.utils.data import DataLoader

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path, PROJECT_ROOT
from src.pipeline.eval.metrics import evaluate
from src.pipeline.feature_engineering.sliding_window import build_datasets
from src.pipeline.ingestion.loader import FEATURE_COLUMNS, load_csv
from src.pipeline.preprocessing.normalizer import fit_transform
from src.pipeline.saving.checkpoint import save_best
from src.pipeline.training.model import build_model
from src.pipeline.training.trainer import build_optimizer, build_scheduler, train_epoch
from src.utils.mlflow_dagshub import init_mlflow

optuna.logging.set_verbosity(optuna.logging.WARNING)
warnings.filterwarnings("ignore", category=UserWarning)

ALL_MODELS = ["lstm", "xgboost", "lightgbm", "ridge"]

# ─────────────────────────────────────────────────────────────────────────────
# Data helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_data(cfg: dict) -> tuple:
    """Returns (X_train, y_train, X_val, y_val, X_test, y_test,
                train_ds, val_ds, test_ds) ready for both sklearn and torch."""
    df = load_csv(cfg)
    n = len(df)
    split = cfg["data"]["split"]
    n_train = int(n * float(split["train"]))
    n_val   = int(n * float(split["val"]))
    idx = np.arange(n)
    train_mask = np.zeros(n, dtype=bool); train_mask[idx[:n_train]] = True
    val_mask   = np.zeros(n, dtype=bool); val_mask[idx[n_train:n_train + n_val]] = True
    test_mask  = np.zeros(n, dtype=bool); test_mask[idx[n_train + n_val:]] = True

    features_scaled, labels, _ = fit_transform(df, train_mask, cfg)

    # Flat arrays for sklearn models (no window, just raw scaled features)
    X_train = features_scaled[train_mask]; y_train = labels[train_mask]
    X_val   = features_scaled[val_mask];   y_val   = labels[val_mask]
    X_test  = features_scaled[test_mask];  y_test  = labels[test_mask]

    # Sequence datasets for LSTM
    train_ds, val_ds, test_ds = build_datasets(features_scaled, labels, cfg)

    return X_train, y_train, X_val, y_val, X_test, y_test, train_ds, val_ds, test_ds


def _sklearn_metrics(y_true: np.ndarray, y_pred: np.ndarray,
                     threshold: float) -> dict[str, float]:
    binary_pred   = (y_pred   >= threshold).astype(int)
    binary_target = (y_true   >= threshold).astype(int)
    try:
        pr_auc  = float(average_precision_score(binary_target, y_pred))
        roc_auc = float(roc_auc_score(binary_target, y_pred))
    except ValueError:
        pr_auc = roc_auc = float("nan")
    mae = float(mean_absolute_error(y_true, y_pred))
    return {"pr_auc": round(pr_auc, 6), "roc_auc": round(roc_auc, 6), "mae": round(mae, 6)}


# ─────────────────────────────────────────────────────────────────────────────
# LSTM tuning
# ─────────────────────────────────────────────────────────────────────────────

def _tune_lstm(trial: optuna.Trial, cfg: dict, train_ds, val_ds,
               device: torch.device, parent_run_id: str) -> float:
    params = {
        "hidden_size": trial.suggest_categorical("hidden_size", [64, 128, 256]),
        "lstm_layers": trial.suggest_int("lstm_layers", 1, 3),
        "dropout":     trial.suggest_float("dropout", 0.1, 0.5),
        "lr":          trial.suggest_float("lr", 1e-4, 1e-2, log=True),
        "weight_decay":trial.suggest_float("weight_decay", 1e-5, 1e-2, log=True),
        "batch_size":  trial.suggest_categorical("batch_size", [128, 256, 512]),
        "optimizer":   trial.suggest_categorical("optimizer", ["adamw", "adam"]),
        "scheduler":   trial.suggest_categorical("scheduler", ["cosine", "step", "none"]),
        "epochs":      trial.suggest_int("epochs", 10, 30),
    }

    trial_cfg = json.loads(json.dumps(cfg))
    trial_cfg["model"]["hidden_size"] = params["hidden_size"]
    trial_cfg["model"]["lstm_layers"] = params["lstm_layers"]
    trial_cfg["model"]["dropout"]     = params["dropout"]
    trial_cfg["train"]["lr"]          = params["lr"]
    trial_cfg["train"]["weight_decay"]= params["weight_decay"]
    trial_cfg["train"]["batch_size"]  = params["batch_size"]
    trial_cfg["train"]["optimizer"]   = params["optimizer"]
    trial_cfg["train"]["scheduler"]   = params["scheduler"]
    trial_cfg["train"]["epochs"]      = params["epochs"]
    trial_cfg["train"]["early_stopping"]["enabled"] = True
    trial_cfg["train"]["early_stopping"]["patience"] = 3

    num_workers = int(cfg["project"]["num_workers"])
    bs = params["batch_size"]
    train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True,
                              num_workers=num_workers, pin_memory=device.type == "cuda")
    val_loader   = DataLoader(val_ds,   batch_size=bs, shuffle=False,
                              num_workers=num_workers, pin_memory=device.type == "cuda")

    model     = build_model(trial_cfg, num_features=len(FEATURE_COLUMNS)).to(device)
    criterion = nn.BCELoss() if cfg["loss"]["name"] == "bce" else nn.MSELoss()
    optimizer  = build_optimizer(model, trial_cfg)
    scheduler  = build_scheduler(optimizer, trial_cfg)
    scaler     = torch.amp.GradScaler("cuda", enabled=False)

    best_pr_auc = -1.0
    flood_threshold = float(cfg["data"]["flood_threshold"])
    patience_counter = 0

    with mlflow.start_run(run_name=f"lstm_trial_{trial.number}",
                          nested=True, tags={"parent_run_id": parent_run_id}):
        mlflow.log_params(params)
        for epoch in range(1, params["epochs"] + 1):
            train_epoch(model, train_loader, optimizer, criterion, device,
                        grad_clip=float(cfg["train"]["grad_clip"]),
                        amp_enabled=False, scaler=scaler, epoch=epoch)
            val_metrics = evaluate(model, val_loader, criterion, device,
                                   flood_threshold=flood_threshold,
                                   epoch=epoch, split="val")
            if scheduler:
                scheduler.step()
            pr_auc = val_metrics["val_pr_auc"]
            if pr_auc > best_pr_auc:
                best_pr_auc = pr_auc
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= 3:
                    break

        mlflow.log_metric("best_val_pr_auc", best_pr_auc)

    return best_pr_auc


# ─────────────────────────────────────────────────────────────────────────────
# XGBoost tuning
# ─────────────────────────────────────────────────────────────────────────────

def _tune_xgboost(trial: optuna.Trial, cfg: dict,
                  X_train, y_train, X_val, y_val,
                  parent_run_id: str) -> float:
    import xgboost as xgb

    params = {
        "n_estimators":     trial.suggest_int("n_estimators", 100, 800),
        "max_depth":        trial.suggest_int("max_depth", 3, 10),
        "learning_rate":    trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "subsample":        trial.suggest_float("subsample", 0.5, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0),
        "reg_alpha":        trial.suggest_float("reg_alpha", 1e-5, 10.0, log=True),
        "reg_lambda":       trial.suggest_float("reg_lambda", 1e-5, 10.0, log=True),
        "min_child_weight": trial.suggest_int("min_child_weight", 1, 10),
    }

    model = xgb.XGBRegressor(
        **params, objective="reg:squarederror",
        tree_method="hist", device="cpu",
        eval_metric="mae", verbosity=0, random_state=int(cfg["project"]["seed"]),
    )
    model.fit(X_train, y_train,
              eval_set=[(X_val, y_val)],
              verbose=False)

    y_pred = np.clip(model.predict(X_val), 0, 1)
    metrics = _sklearn_metrics(y_val, y_pred, float(cfg["data"]["flood_threshold"]))

    with mlflow.start_run(run_name=f"xgboost_trial_{trial.number}",
                          nested=True, tags={"parent_run_id": parent_run_id}):
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)

    return metrics["pr_auc"]


# ─────────────────────────────────────────────────────────────────────────────
# LightGBM tuning
# ─────────────────────────────────────────────────────────────────────────────

def _tune_lightgbm(trial: optuna.Trial, cfg: dict,
                   X_train, y_train, X_val, y_val,
                   parent_run_id: str) -> float:
    import lightgbm as lgb

    params = {
        "n_estimators":    trial.suggest_int("n_estimators", 100, 800),
        "max_depth":       trial.suggest_int("max_depth", 3, 12),
        "learning_rate":   trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "num_leaves":      trial.suggest_int("num_leaves", 20, 300),
        "subsample":       trial.suggest_float("subsample", 0.5, 1.0),
        "colsample_bytree":trial.suggest_float("colsample_bytree", 0.5, 1.0),
        "reg_alpha":       trial.suggest_float("reg_alpha", 1e-5, 10.0, log=True),
        "reg_lambda":      trial.suggest_float("reg_lambda", 1e-5, 10.0, log=True),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
    }

    model = lgb.LGBMRegressor(
        **params, objective="regression",
        random_state=int(cfg["project"]["seed"]), verbosity=-1,
        device="cpu",
    )
    model.fit(X_train, y_train,
              eval_set=[(X_val, y_val)])

    y_pred = np.clip(model.predict(X_val), 0, 1)
    metrics = _sklearn_metrics(y_val, y_pred, float(cfg["data"]["flood_threshold"]))

    with mlflow.start_run(run_name=f"lgbm_trial_{trial.number}",
                          nested=True, tags={"parent_run_id": parent_run_id}):
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)

    return metrics["pr_auc"]


# ─────────────────────────────────────────────────────────────────────────────
# Ridge tuning
# ─────────────────────────────────────────────────────────────────────────────

def _tune_ridge(trial: optuna.Trial, cfg: dict,
                X_train, y_train, X_val, y_val,
                parent_run_id: str) -> float:
    params = {"alpha": trial.suggest_float("alpha", 1e-3, 1e3, log=True)}
    model = Ridge(**params)
    model.fit(X_train, y_train)
    y_pred = np.clip(model.predict(X_val), 0, 1)
    metrics = _sklearn_metrics(y_val, y_pred, float(cfg["data"]["flood_threshold"]))

    with mlflow.start_run(run_name=f"ridge_trial_{trial.number}",
                          nested=True, tags={"parent_run_id": parent_run_id}):
        mlflow.log_params(params)
        mlflow.log_metrics(metrics)

    return metrics["pr_auc"]


# ─────────────────────────────────────────────────────────────────────────────
# Per-model study runner
# ─────────────────────────────────────────────────────────────────────────────

def run_study(model_name: str, n_trials: int, cfg: dict,
              X_train, y_train, X_val, y_val, X_test, y_test,
              train_ds, val_ds, test_ds,
              device: torch.device, graphs_dir: Path) -> dict[str, Any]:

    print(f"\n{'='*60}")
    print(f"  Tuning: {model_name.upper()}  ({n_trials} trials)")
    print(f"{'='*60}")

    experiment_name = f"{cfg['mlflow']['experiment_name']}-hparam-{model_name}"
    mlflow.set_experiment(experiment_name)
    flood_threshold = float(cfg["data"]["flood_threshold"])

    # End any leftover active run from a previous failed attempt
    if mlflow.active_run() is not None:
        mlflow.end_run()

    with mlflow.start_run(run_name=f"{model_name}_hparam_search") as parent_run:
        parent_run_id = parent_run.info.run_id
        mlflow.set_tag("model_family", model_name)
        mlflow.set_tag("n_trials", n_trials)

        study = optuna.create_study(direction="maximize",
                                    study_name=f"{model_name}_study",
                                    sampler=optuna.samplers.TPESampler(seed=int(cfg["project"]["seed"])))

        if model_name == "lstm":
            study.optimize(
                lambda t: _tune_lstm(t, cfg, train_ds, val_ds, device, parent_run_id),
                n_trials=n_trials, show_progress_bar=True,
            )
        elif model_name == "xgboost":
            study.optimize(
                lambda t: _tune_xgboost(t, cfg, X_train, y_train, X_val, y_val, parent_run_id),
                n_trials=n_trials, show_progress_bar=True,
            )
        elif model_name == "lightgbm":
            study.optimize(
                lambda t: _tune_lightgbm(t, cfg, X_train, y_train, X_val, y_val, parent_run_id),
                n_trials=n_trials, show_progress_bar=True,
            )
        elif model_name == "ridge":
            study.optimize(
                lambda t: _tune_ridge(t, cfg, X_train, y_train, X_val, y_val, parent_run_id),
                n_trials=n_trials, show_progress_bar=True,
            )

        best = study.best_trial
        print(f"\n  Best val PR-AUC = {best.value:.6f}  params = {best.params}")

        # ── Re-evaluate best params on test set ───────────────────────────────
        test_metrics = _eval_best_on_test(
            model_name, best.params, cfg,
            X_train, y_train, X_val, y_val, X_test, y_test,
            train_ds, val_ds, test_ds, device,
        )
        print(f"  Test  PR-AUC = {test_metrics['pr_auc']:.6f}  ROC-AUC = {test_metrics['roc_auc']:.6f}")

        mlflow.log_params({f"best_{k}": v for k, v in best.params.items()})
        mlflow.log_metrics({f"best_val_pr_auc": best.value,
                            **{f"test_{k}": v for k, v in test_metrics.items()}})

        # Save optuna importance chart
        try:
            import optuna.visualization.matplotlib as ov
            import matplotlib.pyplot as plt
            fig, axes = plt.subplots(1, 2, figsize=(14, 5))
            ov.plot_param_importances(study, ax=axes[0])
            ov.plot_optimization_history(study, ax=axes[1])
            axes[0].set_title(f"{model_name} — Param Importance")
            axes[1].set_title(f"{model_name} — Optimisation History")
            plt.tight_layout()
            chart_path = graphs_dir / f"hparam_{model_name}_optuna.png"
            fig.savefig(chart_path, dpi=120, bbox_inches="tight")
            plt.close(fig)
            mlflow.log_artifact(str(chart_path), artifact_path="graphs")
            print(f"  Chart saved → '{chart_path}'")
        except Exception as e:
            print(f"  [warn] Could not save optuna chart: {e}")

    return {
        "model": model_name,
        "best_val_pr_auc": round(best.value, 6),
        "best_params": best.params,
        "test": test_metrics,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Best-params test evaluation
# ─────────────────────────────────────────────────────────────────────────────

def _eval_best_on_test(model_name: str, params: dict, cfg: dict,
                       X_train, y_train, X_val, y_val, X_test, y_test,
                       train_ds, val_ds, test_ds,
                       device: torch.device) -> dict[str, float]:
    flood_threshold = float(cfg["data"]["flood_threshold"])

    if model_name == "xgboost":
        import xgboost as xgb
        m = xgb.XGBRegressor(**params, objective="reg:squarederror",
                              tree_method="hist", verbosity=0,
                              device="cpu",
                              random_state=int(cfg["project"]["seed"]))
        m.fit(np.vstack([X_train, X_val]), np.hstack([y_train, y_val]))
        y_pred = np.clip(m.predict(X_test), 0, 1)
        return _sklearn_metrics(y_test, y_pred, flood_threshold)

    if model_name == "lightgbm":
        import lightgbm as lgb
        m = lgb.LGBMRegressor(**params, objective="regression", verbosity=-1,
                               device="cpu",
                               random_state=int(cfg["project"]["seed"]))
        m.fit(np.vstack([X_train, X_val]), np.hstack([y_train, y_val]))
        y_pred = np.clip(m.predict(X_test), 0, 1)
        return _sklearn_metrics(y_test, y_pred, flood_threshold)

    if model_name == "ridge":
        m = Ridge(alpha=params["alpha"])
        m.fit(np.vstack([X_train, X_val]), np.hstack([y_train, y_val]))
        y_pred = np.clip(m.predict(X_test), 0, 1)
        return _sklearn_metrics(y_test, y_pred, flood_threshold)

    if model_name == "lstm":
        trial_cfg = json.loads(json.dumps(cfg))
        trial_cfg["model"]["hidden_size"]  = params.get("hidden_size", 128)
        trial_cfg["model"]["lstm_layers"]  = params.get("lstm_layers", 2)
        trial_cfg["model"]["dropout"]      = params.get("dropout", 0.3)
        trial_cfg["train"]["lr"]           = params.get("lr", 1e-3)
        trial_cfg["train"]["weight_decay"] = params.get("weight_decay", 1e-4)
        trial_cfg["train"]["batch_size"]   = params.get("batch_size", 256)
        trial_cfg["train"]["optimizer"]    = params.get("optimizer", "adamw")
        trial_cfg["train"]["scheduler"]    = params.get("scheduler", "cosine")
        trial_cfg["train"]["epochs"]       = params.get("epochs", 20)

        bs   = params.get("batch_size", 256)
        nw   = int(cfg["project"]["num_workers"])
        train_loader = DataLoader(train_ds, batch_size=bs, shuffle=True,
                                  num_workers=nw, pin_memory=device.type == "cuda")
        val_loader   = DataLoader(val_ds, batch_size=bs, shuffle=False,
                                  num_workers=nw, pin_memory=device.type == "cuda")
        test_loader  = DataLoader(test_ds, batch_size=bs, shuffle=False,
                                  num_workers=nw, pin_memory=device.type == "cuda")

        model     = build_model(trial_cfg, num_features=len(FEATURE_COLUMNS)).to(device)
        criterion = nn.BCELoss() if cfg["loss"]["name"] == "bce" else nn.MSELoss()
        optimizer  = build_optimizer(model, trial_cfg)
        scheduler  = build_scheduler(optimizer, trial_cfg)
        scaler     = torch.amp.GradScaler("cuda", enabled=False)
        best_pr_auc = -1.0
        patience_counter = 0

        for epoch in range(1, params.get("epochs", 20) + 1):
            train_epoch(model, train_loader, optimizer, criterion, device,
                        grad_clip=float(cfg["train"]["grad_clip"]),
                        amp_enabled=False, scaler=scaler, epoch=epoch)
            val_m = evaluate(model, val_loader, criterion, device,
                             flood_threshold=flood_threshold, epoch=epoch, split="val")
            if scheduler:
                scheduler.step()
            if val_m["val_pr_auc"] > best_pr_auc:
                best_pr_auc = val_m["val_pr_auc"]
                patience_counter = 0
            else:
                patience_counter += 1
                if patience_counter >= 3:
                    break

        test_m = evaluate(model, test_loader, criterion, device,
                          flood_threshold=flood_threshold, epoch=0, split="test")
        return {k.replace("test_", ""): v for k, v in test_m.items()}

    return {}


# ─────────────────────────────────────────────────────────────────────────────
# Comparison chart
# ─────────────────────────────────────────────────────────────────────────────

def _save_comparison_chart(results: list[dict], graphs_dir: Path) -> None:
    import matplotlib.pyplot as plt

    models    = [r["model"] for r in results]
    val_aucs  = [r["best_val_pr_auc"] for r in results]
    test_aucs = [r["test"].get("pr_auc", 0) for r in results]
    test_rocs = [r["test"].get("roc_auc", 0) for r in results]

    x = np.arange(len(models))
    width = 0.28

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.bar(x - width, val_aucs,  width, label="Val PR-AUC",  color="#1565C0")
    ax.bar(x,         test_aucs, width, label="Test PR-AUC", color="#2E7D32")
    ax.bar(x + width, test_rocs, width, label="Test ROC-AUC",color="#F57F17")

    ax.set_xticks(x)
    ax.set_xticklabels([m.upper() for m in models])
    ax.set_ylabel("Score")
    ax.set_ylim(0, 1.05)
    ax.set_title("Hyperparameter Tuning — Model Comparison")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)

    for i, (v, t, r) in enumerate(zip(val_aucs, test_aucs, test_rocs)):
        ax.text(i - width, v + 0.005, f"{v:.3f}", ha="center", va="bottom", fontsize=8)
        ax.text(i,         t + 0.005, f"{t:.3f}", ha="center", va="bottom", fontsize=8)
        ax.text(i + width, r + 0.005, f"{r:.3f}", ha="center", va="bottom", fontsize=8)

    path = graphs_dir / "hparam_comparison.png"
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"\n[hparam] Comparison chart saved → '{path}'")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Hyperparameter tuning across model families")
    parser.add_argument("--models",  nargs="+", choices=ALL_MODELS, default=ALL_MODELS,
                        help="Which models to tune (default: all)")
    parser.add_argument("--trials",  type=int, default=20,
                        help="Optuna trials per model (default: 20)")
    args = parser.parse_args()

    load_dotenv(dotenv_path=PROJECT_ROOT / ".env", override=True)
    cfg = load_default_config()
    for key in ("csv_raw", "csv_processed", "scaler", "ingest_manifest", "checkpoints"):
        cfg["paths"][key] = str(resolve_project_path(cfg["paths"][key]))
    cfg["paths"]["models_dir"] = str(resolve_project_path(cfg["paths"].get("models_dir", "models")))

    graphs_dir = resolve_project_path(cfg["paths"].get("hparam_dir", "artifacts/hparam"))
    graphs_dir.mkdir(parents=True, exist_ok=True)

    torch.manual_seed(cfg["project"]["seed"])
    np.random.seed(cfg["project"]["seed"])
    device = torch.device("cpu")
    print(f"[hparam] Device: {device}  |  Models: {args.models}  |  Trials: {args.trials}")

    # Init MLflow once
    try:
        init_mlflow(cfg)
    except Exception as e:
        print(f"[hparam] MLflow init failed, continuing without tracking: {e}")

    # Load data once
    (X_train, y_train, X_val, y_val, X_test, y_test,
     train_ds, val_ds, test_ds) = _load_data(cfg)

    all_results: list[dict] = []
    for model_name in args.models:
        result = run_study(
            model_name, args.trials, cfg,
            X_train, y_train, X_val, y_val, X_test, y_test,
            train_ds, val_ds, test_ds, device, graphs_dir,
        )
        all_results.append(result)

    # ── Final comparison ──────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"  {'MODEL':<12} {'VAL PR-AUC':>12} {'TEST PR-AUC':>12} {'TEST ROC-AUC':>13}")
    print("  " + "-" * 52)
    for r in sorted(all_results, key=lambda x: x["best_val_pr_auc"], reverse=True):
        print(f"  {r['model']:<12} {r['best_val_pr_auc']:>12.6f} "
              f"{r['test'].get('pr_auc', float('nan')):>12.6f} "
              f"{r['test'].get('roc_auc', float('nan')):>13.6f}")
    print("=" * 60)

    _save_comparison_chart(all_results, graphs_dir)

    out_path = graphs_dir / "hparam_comparison.json"
    out_path.write_text(json.dumps(all_results, indent=2), encoding="utf-8")
    print(f"[hparam] Full results saved → '{out_path}'")


if __name__ == "__main__":
    main()
