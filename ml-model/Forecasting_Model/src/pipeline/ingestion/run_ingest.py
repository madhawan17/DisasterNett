"""Ingestion CLI — validate flood.csv, write processed copy + manifest.

Run via DVC or directly:
    python -m src.pipeline.ingestion.run_ingest
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

if __package__ is None or __package__ == "":
    sys.path.append(str(Path(__file__).resolve().parents[4]))

from src.config import load_default_config, resolve_project_path
from src.pipeline.ingestion.loader import FEATURE_COLUMNS, load_csv


def main() -> None:
    cfg = load_default_config()

    cfg["paths"]["csv_raw"] = str(resolve_project_path(cfg["paths"]["csv_raw"]))
    cfg["paths"]["csv_processed"] = str(resolve_project_path(cfg["paths"]["csv_processed"]))
    cfg["paths"]["scaler"] = str(resolve_project_path(cfg["paths"]["scaler"]))

    manifest_path = resolve_project_path(cfg["paths"]["ingest_manifest"])
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    # Ensure processed data directory exists and copy/validate CSV
    processed_path = Path(cfg["paths"]["csv_processed"])
    processed_path.parent.mkdir(parents=True, exist_ok=True)

    df = load_csv(cfg)

    # Copy raw → processed if they are different files
    import shutil
    raw_path = Path(cfg["paths"]["csv_raw"])
    if raw_path.resolve() != processed_path.resolve():
        shutil.copy2(raw_path, processed_path)

    label_col = cfg["data"]["label_column"]
    manifest = {
        "status": "ok",
        "source": cfg["paths"]["csv_raw"],
        "destination": cfg["paths"]["csv_processed"],
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "feature_columns": FEATURE_COLUMNS,
        "label_column": label_col,
        "label_stats": {
            "min": float(df[label_col].min()),
            "max": float(df[label_col].max()),
            "mean": float(df[label_col].mean()),
            "std": float(df[label_col].std()),
        },
        "missing_values": int(df.isnull().sum().sum()),
    }

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
