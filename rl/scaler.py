"""Running mean / variance scaler (Phase 6.6 persistence state).
Inspired by common RL utilities. Stores count, mean, var for incremental normalization.
"""

from __future__ import annotations
import torch
from dataclasses import dataclass, asdict


@dataclass
class RMSState:
    count: float
    mean: torch.Tensor
    var: torch.Tensor


class RunningMeanStd:
    def __init__(self, shape, device=None, epsilon: float = 1e-4):
        self.device = device or torch.device("cpu")
        self.mean = torch.zeros(shape, device=self.device)
        self.var = torch.ones(shape, device=self.device)
        self.count = epsilon

    def update(self, x: torch.Tensor):
        if x.ndim == 1:
            x = x.unsqueeze(0)
        batch_mean = torch.mean(x, dim=0)
        batch_var = torch.var(x, dim=0, unbiased=False)
        batch_count = x.shape[0]
        self._update_from_moments(batch_mean, batch_var, batch_count)

    def _update_from_moments(self, batch_mean, batch_var, batch_count):
        delta = batch_mean - self.mean
        total_count = self.count + batch_count
        new_mean = self.mean + delta * batch_count / total_count
        m_a = self.var * self.count
        m_b = batch_var * batch_count
        M2 = m_a + m_b + delta.pow(2) * self.count * batch_count / total_count
        new_var = M2 / total_count
        self.mean = new_mean
        self.var = new_var.clamp_min(1e-8)
        self.count = total_count

    def normalize(self, x: torch.Tensor) -> torch.Tensor:
        return (x - self.mean) / torch.sqrt(self.var + 1e-8)

    def state_dict(self):
        return {
            "count": self.count,
            "mean": self.mean.detach().cpu(),
            "var": self.var.detach().cpu(),
        }

    def load_state_dict(self, state):
        self.count = float(state["count"])
        self.mean = state["mean"].to(self.device)
        self.var = state["var"].to(self.device)
