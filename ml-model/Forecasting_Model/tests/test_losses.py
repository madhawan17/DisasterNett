import torch

from src.utils.losses import FocalLoss


def test_focal_loss_backward() -> None:
    loss_fn = FocalLoss(alpha=0.25, gamma=2.0)
    logits = torch.randn(8, requires_grad=True)
    targets = torch.randint(low=0, high=2, size=(8,)).float()
    loss = loss_fn(logits, targets)
    loss.backward()
    assert loss.item() >= 0.0
    assert logits.grad is not None

