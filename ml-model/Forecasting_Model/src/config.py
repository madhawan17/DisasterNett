from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "configs" / "config.yaml"


def load_config(path: str | Path) -> dict[str, Any]:
    load_dotenv(override=False)
    cfg_path = Path(path)
    with cfg_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_config_path() -> Path:
    load_dotenv(override=False)
    raw = os.getenv("PIPELINE_CONFIG_PATH", "").strip()
    if raw:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = PROJECT_ROOT / candidate
        return candidate
    return DEFAULT_CONFIG_PATH


def load_default_config() -> dict[str, Any]:
    return load_config(resolve_config_path())


def resolve_project_path(path_value: str | Path) -> Path:
    p = Path(path_value)
    if p.is_absolute():
        return p
    return PROJECT_ROOT / p
