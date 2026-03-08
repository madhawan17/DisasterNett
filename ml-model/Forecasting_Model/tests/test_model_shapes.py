"""Test FloodLSTM output shape."""
import torch

from src.pipeline.training.model import FloodLSTM


def test_flood_lstm_output_shape() -> None:
    model = FloodLSTM(num_features=20, hidden_size=64, lstm_layers=1, dropout=0.0)
    x = torch.randn(4, 10, 20)   # (batch=4, seq_len=10, features=20)
    out = model(x)
    assert out.shape == (4,), f"Expected (4,), got {out.shape}"
    # Output should be probabilities in [0, 1]
    assert out.min() >= 0.0 and out.max() <= 1.0
