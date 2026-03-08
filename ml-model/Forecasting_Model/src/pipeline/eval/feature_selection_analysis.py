"""Feature selection analysis — combine permutation + saliency scores,
compute rank correlation, and produce selection recommendations.

Run directly:
    python -m src.pipeline.eval.feature_selection_analysis
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np
from scipy.stats import spearmanr

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path


# ─────────────────────────────────────────────────────────────────────────────
# Analysis
# ─────────────────────────────────────────────────────────────────────────────

def analyse(fi_path: Path, graphs_dir: Path) -> dict:
    data = json.loads(fi_path.read_text(encoding="utf-8"))
    perm: dict[str, float] = data["permutation"]
    sal:  dict[str, float] = data["saliency"]

    features = list(perm.keys())  # already sorted by permutation score desc

    perm_scores = np.array([perm[f] for f in features])
    sal_scores  = np.array([sal[f]  for f in features])

    # ── Rank-normalise both methods to [0, 1] ─────────────────────────────────
    def rank_norm(arr: np.ndarray) -> np.ndarray:
        ranks = arr.argsort().argsort().astype(float)
        return ranks / (len(ranks) - 1)

    perm_norm = rank_norm(perm_scores)
    sal_norm  = rank_norm(sal_scores)

    # ── Ensemble score (equal weight average of normalised ranks) ─────────────
    ensemble = (perm_norm + sal_norm) / 2.0
    ensemble_order = np.argsort(ensemble)[::-1]  # descending
    features_ranked = [features[i] for i in ensemble_order]
    ensemble_ranked = ensemble[ensemble_order]

    # ── Spearman rank correlation between methods ─────────────────────────────
    rho, pval = spearmanr(perm_scores, sal_scores)

    # ── Tier classification ───────────────────────────────────────────────────
    n = len(features_ranked)
    top_n    = max(1, round(n * 0.30))   # top 30 % → keep
    bottom_n = max(1, round(n * 0.25))   # bottom 25 % → candidates for removal

    top_features    = features_ranked[:top_n]
    middle_features = features_ranked[top_n: n - bottom_n]
    bottom_features = features_ranked[n - bottom_n:]

    result = {
        "spearman_rho": round(float(rho), 4),
        "spearman_pval": round(float(pval), 6),
        "agreement_note": _agreement_note(rho),
        "ensemble_ranking": {f: round(float(s), 6) for f, s in zip(features_ranked, ensemble_ranked)},
        "tiers": {
            "top_keep":     {"features": top_features,    "count": len(top_features)},
            "middle_watch": {"features": middle_features, "count": len(middle_features)},
            "bottom_drop_candidates": {"features": bottom_features, "count": len(bottom_features)},
        },
        "recommendation": _recommendation(top_features, bottom_features, rho),
    }

    # ── Plots ──────────────────────────────────────────────────────────────────
    graphs_dir.mkdir(parents=True, exist_ok=True)
    _plot_combined(features, perm_scores, sal_scores, ensemble,
                   ensemble_order, top_n, bottom_n, rho, graphs_dir)
    _plot_scatter(features, perm_scores, sal_scores, rho, pval, graphs_dir)

    # ── Save JSON ──────────────────────────────────────────────────────────────
    out_path = graphs_dir / "feature_selection_analysis.json"
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\n[analysis] Saved → '{out_path}'")

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _agreement_note(rho: float) -> str:
    if rho >= 0.85:
        return "Strong agreement — both methods rank features consistently."
    if rho >= 0.60:
        return "Moderate agreement — ensemble score is reliable."
    return "Low agreement — treat rankings with caution; run more repeats."


def _recommendation(top: list[str], bottom: list[str], rho: float) -> str:
    top_str    = ", ".join(top)
    bottom_str = ", ".join(bottom)
    caveat = (
        " Note: scores are very close — this dataset may not benefit much from "
        "feature dropping; retrain with the reduced set to confirm."
        if rho > 0.9 else ""
    )
    return (
        f"KEEP (highest combined importance): {top_str}. "
        f"CONSIDER DROPPING (lowest combined importance): {bottom_str}.{caveat}"
    )


def _plot_combined(features, perm_scores, sal_scores, ensemble,
                   ensemble_order, top_n, bottom_n, rho, graphs_dir):
    n = len(features)
    fig = plt.figure(figsize=(16, 10))
    gs  = gridspec.GridSpec(1, 3, figure=fig, wspace=0.45)

    # ── Left: Permutation ─────────────────────────────────────────────────────
    ax1 = fig.add_subplot(gs[0])
    feats_p = list(perm_scores.argsort()[::-1])
    colors_p = ["#2196F3"] * n
    for i in range(top_n): colors_p[feats_p[i]] = "#4CAF50"
    for i in range(1, bottom_n + 1): colors_p[feats_p[-i]] = "#F44336"
    ax1.barh([features[i] for i in feats_p][::-1],
             [perm_scores[i] for i in feats_p][::-1],
             color=[colors_p[i] for i in feats_p][::-1])
    ax1.set_title("Permutation\n(Δ PR-AUC)", fontsize=11)
    ax1.set_xlabel("Score")
    ax1.tick_params(axis="y", labelsize=8)
    ax1.grid(axis="x", alpha=0.3)

    # ── Middle: Saliency ──────────────────────────────────────────────────────
    ax2 = fig.add_subplot(gs[1])
    feats_s = list(sal_scores.argsort()[::-1])
    colors_s = ["#2196F3"] * n
    for i in range(top_n): colors_s[feats_s[i]] = "#4CAF50"
    for i in range(1, bottom_n + 1): colors_s[feats_s[-i]] = "#F44336"
    ax2.barh([features[i] for i in feats_s][::-1],
             [sal_scores[i] for i in feats_s][::-1],
             color=[colors_s[i] for i in feats_s][::-1])
    ax2.set_title("Gradient Saliency\n(mean |∂out/∂in|)", fontsize=11)
    ax2.set_xlabel("Score")
    ax2.tick_params(axis="y", labelsize=8)
    ax2.grid(axis="x", alpha=0.3)

    # ── Right: Ensemble ───────────────────────────────────────────────────────
    ax3 = fig.add_subplot(gs[2])
    colors_e = []
    for i, idx in enumerate(ensemble_order):
        if i < top_n:           colors_e.append("#4CAF50")
        elif i >= n - bottom_n: colors_e.append("#F44336")
        else:                   colors_e.append("#2196F3")
    ax3.barh([features[i] for i in ensemble_order][::-1],
             ensemble[ensemble_order][::-1],
             color=colors_e[::-1])
    ax3.set_title("Ensemble Score\n(rank-normalised avg)", fontsize=11)
    ax3.set_xlabel("Score [0–1]")
    ax3.tick_params(axis="y", labelsize=8)
    ax3.grid(axis="x", alpha=0.3)

    # Legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor="#4CAF50", label=f"Top {top_n} — Keep"),
        Patch(facecolor="#2196F3", label="Middle — Watch"),
        Patch(facecolor="#F44336", label=f"Bottom {bottom_n} — Drop candidates"),
    ]
    fig.legend(handles=legend_elements, loc="lower center", ncol=3,
               fontsize=9, bbox_to_anchor=(0.5, -0.02))

    fig.suptitle(f"Feature Importance Analysis  |  Spearman ρ = {rho:.3f}", fontsize=13)
    path = graphs_dir / "feature_selection_combined.png"
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"[analysis] Chart saved → '{path}'")


def _plot_scatter(features, perm_scores, sal_scores, rho, pval, graphs_dir):
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.scatter(perm_scores, sal_scores, s=60, color="#1565C0", zorder=3)

    for i, f in enumerate(features):
        ax.annotate(f, (perm_scores[i], sal_scores[i]),
                    fontsize=6.5, xytext=(4, 2), textcoords="offset points")

    # Trend line
    m, b = np.polyfit(perm_scores, sal_scores, 1)
    x_range = np.linspace(perm_scores.min(), perm_scores.max(), 100)
    ax.plot(x_range, m * x_range + b, color="#E53935", linewidth=1.5,
            linestyle="--", label=f"trend (ρ={rho:.3f}, p={pval:.4f})")

    ax.set_xlabel("Permutation Importance (Δ PR-AUC)")
    ax.set_ylabel("Gradient Saliency (mean |∂/∂x|)")
    ax.set_title("Method Agreement — Permutation vs Saliency")
    ax.legend(fontsize=9)
    ax.grid(alpha=0.3)

    path = graphs_dir / "feature_selection_scatter.png"
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"[analysis] Chart saved → '{path}'")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    cfg = load_default_config()
    graphs_dir = resolve_project_path(cfg["paths"].get("graphs_dir", "artifacts/graphs"))
    fi_path    = graphs_dir / "feature_importance.json"

    if not fi_path.exists():
        print(f"[analysis] ERROR: '{fi_path}' not found. Run dvc repro (train stage) first.")
        sys.exit(1)

    result = analyse(fi_path, graphs_dir)

    print("\n" + "=" * 70)
    print(f"  Spearman ρ between methods : {result['spearman_rho']}  ({result['agreement_note']})")
    print("=" * 70)
    print("\n  ENSEMBLE RANKING (best → worst):")
    for rank, (feat, score) in enumerate(result["ensemble_ranking"].items(), 1):
        tier = ("✅ KEEP  " if feat in result["tiers"]["top_keep"]["features"]
                else "❌ DROP? " if feat in result["tiers"]["bottom_drop_candidates"]["features"]
                else "   ·    ")
        print(f"  {rank:>2}. {tier}  {feat:<42}  {score:.4f}")

    print("\n" + "=" * 70)
    print("  RECOMMENDATION:")
    print(f"  {result['recommendation']}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
