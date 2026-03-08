"""Training — early stopping callback."""
from __future__ import annotations


class EarlyStopping:
    """Stop training when a monitored metric stops improving.

    Args:
        patience:  Number of epochs with no improvement before stopping.
        min_delta: Minimum absolute change that counts as improvement.
        mode:      ``"max"`` if higher metric is better (e.g. PR-AUC),
                   ``"min"`` if lower is better (e.g. loss).
    """

    def __init__(
        self,
        patience: int = 5,
        min_delta: float = 0.0,
        mode: str = "max",
    ) -> None:
        if mode not in ("max", "min"):
            raise ValueError(f"mode must be 'max' or 'min', got {mode!r}")
        self.patience = patience
        self.min_delta = min_delta
        self.mode = mode
        self._best: float = float("-inf") if mode == "max" else float("inf")
        self._counter: int = 0
        self.should_stop: bool = False
        self.best_epoch: int = 0

    # ------------------------------------------------------------------
    def _is_improvement(self, value: float) -> bool:
        if self.mode == "max":
            return value > self._best + self.min_delta
        return value < self._best - self.min_delta

    def step(self, metric: float, epoch: int = 0) -> bool:
        """Update state with the latest metric value.

        Args:
            metric: Current epoch's monitored metric.
            epoch:  Current epoch number (stored for reporting).

        Returns:
            ``True`` if training should stop, ``False`` otherwise.
        """
        if self._is_improvement(metric):
            self._best = metric
            self._counter = 0
            self.best_epoch = epoch
        else:
            self._counter += 1
            if self._counter >= self.patience:
                self.should_stop = True

        return self.should_stop

    # ------------------------------------------------------------------
    @property
    def best(self) -> float:
        return self._best

    def __repr__(self) -> str:
        return (
            f"EarlyStopping(patience={self.patience}, min_delta={self.min_delta}, "
            f"mode={self.mode!r}, counter={self._counter}/{self.patience}, "
            f"best={self._best:.6f})"
        )
