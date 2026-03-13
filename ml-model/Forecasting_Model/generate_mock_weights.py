import os
import torch
import joblib
from pathlib import Path
from sklearn.preprocessing import StandardScaler
import numpy as np
from src.pipeline.training.model import build_model
from src.config import load_default_config
from src.pipeline.ingestion.loader import FEATURE_COLUMNS

cfg = load_default_config()
models_dir = Path("models")
models_dir.mkdir(parents=True, exist_ok=True)

print("Creating mock model best.pt...")
model = build_model(cfg, num_features=len(FEATURE_COLUMNS))
torch.save({
    "model_state_dict": model.state_dict(),
    "epoch": 10,
    "optimal_threshold": 0.5,
}, models_dir / "best.pt")

print("Creating mock scaler.pkl...")
scaler = StandardScaler()
# Fit on some dummy data so it's initialized
dummy_data = np.random.rand(100, len(FEATURE_COLUMNS))
scaler.fit(dummy_data)
# Ensure the parent directory exists
scaler_path = Path(cfg["paths"]["scaler"])
scaler_path.parent.mkdir(parents=True, exist_ok=True)

joblib.dump(scaler, scaler_path)
print("Done creating mocks.")
