"""Training — FloodLSTM model definition."""
from __future__ import annotations

from typing import Any

import torch
from torch import Tensor, nn


class FloodLSTM(nn.Module):
    """LSTM-based flood probability regressor.

    Input:  (batch, seq_len, num_features)   e.g. (B, 10, 20)
    Output: (batch,)                         scalar FloodProbability in [0, 1]
                                             (sigmoid applied at inference)

    Architecture:
        LSTM(input=num_features, hidden=hidden_size, layers=lstm_layers)
        Dropout
        Linear(hidden_size, 1)
        → squeeze to (batch,)

    Note: During training the raw linear output (logit) is returned so that
    MSELoss can be applied after sigmoid, OR you can use BCEWithLogitsLoss.
    We apply sigmoid explicitly to keep the output interpretable as probability.
    """

    def __init__(
        self,
        num_features: int = 20,
        hidden_size: int = 128,
        lstm_layers: int = 2,
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=num_features,
            hidden_size=hidden_size,
            num_layers=lstm_layers,
            batch_first=True,
            dropout=dropout if lstm_layers > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x: Tensor) -> Tensor:
        """Forward pass.

        Args:
            x: Tensor of shape (batch, seq_len, num_features)

        Returns:
            Tensor of shape (batch,) — flood probability in [0, 1].
        """
        _, (h_n, _) = self.lstm(x)       # h_n: (layers, batch, hidden)
        last_hidden = h_n[-1]            # (batch, hidden)
        dropped = self.dropout(last_hidden)
        logit = self.head(dropped).squeeze(1)  # (batch,)
        return torch.sigmoid(logit)


def build_model(cfg: dict[str, Any], num_features: int = 20) -> FloodLSTM:
    """Construct FloodLSTM from config."""
    model_cfg = cfg["model"]
    return FloodLSTM(
        num_features=num_features,
        hidden_size=int(model_cfg["hidden_size"]),
        lstm_layers=int(model_cfg["lstm_layers"]),
        dropout=float(model_cfg["dropout"]),
    )
