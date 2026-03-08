"""Feature Engineering — Sliding Window Dataset.

Converts a flat (N, F) feature array into overlapping sequences of shape
(W, F), each labelled with the FloodProbability at the last time step + horizon.

    horizon=0  (nowcast):  label at t             — "is there a flood right now?"
    horizon=24 (forecast): max(labels[t+1..t+24]) — "any flood in the next 24h?"

Using the MAX over the future window (instead of single label at t+H) makes the
forecast task learnable: current rainfall and soil moisture genuinely predict
near-term flooding, but not what happens to Rain_Last_3h at exactly t+24.

The sliding window treats consecutive CSV rows as time steps, capturing how
environmental conditions build up over W observations.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import torch
from torch import Tensor
from torch.utils.data import Dataset


class SlidingWindowDataset(Dataset[dict[str, Tensor]]):
    """Sliding-window view over a scaled feature array.

    Args:
        features:    float32 array of shape [N, num_features].
        labels:      float32 array of shape [N] — FloodProbability per row.
        window_size: Number of consecutive rows in each input sequence (W).
        horizon:     How many steps ahead to predict. 0 = nowcast, 24 = 24h forecast.

    Each sample ``i`` yields:
        features: Tensor[W, num_features]     — rows [i, i+W)
        label:    Tensor scalar               — labels[i+W-1]            (horizon=0)
                                             OR max(labels[i+W..i+W+H]) (horizon>0)
    """

    def __init__(
        self,
        features: np.ndarray,
        labels: np.ndarray,
        window_size: int,
        horizon: int = 0,
    ) -> None:
        min_rows = window_size + horizon
        if len(features) < min_rows:
            raise ValueError(
                f"Dataset has {len(features)} rows but window_size={window_size} "
                f"+ horizon={horizon} requires at least {min_rows} rows."
            )
        self.features    = torch.from_numpy(features)
        self.labels      = torch.from_numpy(labels)
        self.window_size = window_size
        self.horizon     = horizon
        # last `horizon` windows have no future label → exclude them
        self._len = len(features) - window_size + 1 - horizon

    def __len__(self) -> int:
        return self._len

    def __getitem__(self, idx: int) -> dict[str, Tensor]:
        x = self.features[idx : idx + self.window_size]    # [W, F]
        if self.horizon > 0:
            # "Any flood in the next H hours?" — max over strictly-future labels
            # labels[i+W : i+W+H]  →  H elements covering t+1 … t+H
            y = self.labels[idx + self.window_size : idx + self.window_size + self.horizon].max()
        else:
            y = self.labels[idx + self.window_size - 1]    # nowcast: label at t
        return {"features": x, "label": y}


def build_datasets(
    features: np.ndarray,
    labels: np.ndarray,
    cfg: dict[str, Any],
    horizon: int = 0,
) -> tuple["SlidingWindowDataset", "SlidingWindowDataset"]:
    """Split features/labels into train/test and wrap in SlidingWindowDataset.

    Args:
        horizon: Steps ahead to predict. 0 = nowcast, 24 = 24-hour forecast.

    Returns (train_ds, test_ds).
    """
    window_size = int(cfg["data"]["window_size"])
    split = cfg["data"]["split"]
    n = len(features)
    n_train = int(n * float(split["train"]))

    train_ds = SlidingWindowDataset(features[:n_train], labels[:n_train], window_size, horizon)
    test_ds  = SlidingWindowDataset(features[n_train:], labels[n_train:], window_size, horizon)

    tag = f"horizon={horizon}h" if horizon else "nowcast"
    print(
        f"[feature_engineering] Sliding window W={window_size} {tag} → "
        f"train={len(train_ds):,}  test={len(test_ds):,} samples"
    )
    return train_ds, test_ds
