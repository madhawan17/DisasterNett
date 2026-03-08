"""Smoke test for the full tabular flood pipeline.

Generates a synthetic flood.csv (200 rows, 21 columns) in tmp_path,
then runs ingest → train → risk_mapper end-to-end.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml


_FEATURE_COLS = [
    "MonsoonIntensity", "TopographyDrainage", "RiverManagement",
    "Deforestation", "Urbanization", "ClimateChange", "DamsQuality",
    "Siltation", "AgriculturalPractices", "Encroachments",
    "IneffectiveDisasterPreparedness", "DrainageSystems",
    "CoastalVulnerability", "Landslides", "Watersheds",
    "DeterioratingInfrastructure", "PopulationScore", "WetlandLoss",
    "InadequatePlanning", "PoliticalFactors",
]


def _make_synthetic_csv(path: Path, n: int = 200) -> None:
    rng = np.random.default_rng(42)
    data = {col: rng.integers(1, 10, size=n).tolist() for col in _FEATURE_COLS}
    data["FloodProbability"] = rng.uniform(0.0, 1.0, size=n).tolist()
    pd.DataFrame(data).to_csv(path, index=False)


def test_pipeline_smoke(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    cfg_path = root / "configs" / "config.yaml"
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))

    # Paths
    csv_raw = tmp_path / "flood.csv"
    _make_synthetic_csv(csv_raw, n=200)

    cfg["paths"]["csv_raw"] = str(csv_raw)
    cfg["paths"]["csv_processed"] = str(tmp_path / "flood_processed.csv")
    cfg["paths"]["scaler"] = str(tmp_path / "scaler.joblib")
    cfg["paths"]["ingest_manifest"] = str(tmp_path / "ingest_manifest.json")
    cfg["paths"]["checkpoints"] = str(tmp_path / "checkpoints")
    cfg["paths"]["insight_reports"] = str(tmp_path / "reports")

    # Small model and fast training
    cfg["train"]["epochs"] = 2
    cfg["train"]["batch_size"] = 32
    cfg["data"]["window_size"] = 5
    cfg["model"]["hidden_size"] = 16
    cfg["model"]["lstm_layers"] = 1
    cfg["mlflow"]["enabled"] = False
    cfg["project"]["num_workers"] = 0

    report_path = str(tmp_path / "report.json")
    cfg["inference"]["output_path"] = report_path

    test_cfg = tmp_path / "config.yaml"
    test_cfg.write_text(yaml.safe_dump(cfg), encoding="utf-8")

    def run(*args: str) -> None:
        env = os.environ.copy()
        env["PIPELINE_CONFIG_PATH"] = str(test_cfg)
        subprocess.run(
            [sys.executable, "-m", *args],
            cwd=root,
            check=True,
            env=env,
        )

    run("src.ingest")
    run("src.train")
    run("src.risk_mapper")

    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    assert "probability" in report
    assert report["risk_class"] in {"Low", "Moderate", "High"}
    assert 0.0 <= report["confidence"] <= 1.0
