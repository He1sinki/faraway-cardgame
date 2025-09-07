#!/usr/bin/env python3
"""Phase 3.5 - Entraînement simple offline (classification action) sur rollouts exportés.
Ce n'est pas PPO encore: on entraîne un MLP (policy imitation) sur les transitions avec action>=0.
Résultat: policy_<timestamp>.pt et policy_meta.json.
"""
import os, json, glob, base64, time, math, struct
from typing import List, Tuple

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
except ImportError:
    raise SystemExit(
        "PyTorch non installé. Ajoutez-le dans rl/requirements.txt puis installez l'environnement."
    )

ROLL_DIR = os.path.join("data", "rollouts", "processed_adv")
MODEL_DIR = "runs"
os.makedirs(MODEL_DIR, exist_ok=True)

ACT_DIM = 256


class PolicyNet(nn.Module):
    def __init__(self, obs_dim: int, act_dim: int = ACT_DIM):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(obs_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, act_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def decode_obs_struct(b64: str) -> List[float]:
    buf = base64.b64decode(b64)
    return list(struct.unpack("<" + "f" * (len(buf) // 4), buf))


def load_data(limit: int = 50000) -> Tuple[torch.Tensor, torch.Tensor, int]:
    files = sorted(glob.glob(os.path.join(ROLL_DIR, "episode_*.jsonl")))
    X: List[List[float]] = []
    Y: List[int] = []
    for f in files:
        with open(f, "r") as fh:
            for line in fh:
                if len(X) >= limit:
                    break
                obj = json.loads(line)
                a = obj["action"]
                if a < 0:  # ignore no-action steps
                    continue
                obs = decode_obs_struct(obj["obs"])
                X.append(obs)
                Y.append(a)
        if len(X) >= limit:
            break
    if not X:
        raise SystemExit("No data for training")
    obs_dim = len(X[0])
    return (
        torch.tensor(X, dtype=torch.float32),
        torch.tensor(Y, dtype=torch.long),
        obs_dim,
    )


def train():
    X, Y, obs_dim = load_data()
    model = PolicyNet(obs_dim)
    opt = optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    epochs = int(os.environ.get("EPOCHS", "5"))
    batch = int(os.environ.get("BATCH", "2048"))
    n = X.size(0)
    for ep in range(1, epochs + 1):
        perm = torch.randperm(n)
        tot_loss = 0.0
        correct = 0
        for i in range(0, n, batch):
            idx = perm[i : i + batch]
            logits = model(X[idx])
            loss = loss_fn(logits, Y[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot_loss += loss.item() * idx.size(0)
            correct += (logits.argmax(1) == Y[idx]).sum().item()
        epoch_loss = tot_loss / n
        acc = correct / n
        print(f"[offline] epoch={ep} loss={epoch_loss:.4f} acc={acc:.4f}")
    ts = int(time.time())
    out_path = os.path.join(MODEL_DIR, f"policy_{ts}.pt")
    torch.save(model.state_dict(), out_path)
    meta = {"timestamp": ts, "obs_dim": obs_dim, "act_dim": ACT_DIM}
    with open(os.path.join(MODEL_DIR, "policy_meta.json"), "w") as f:
        json.dump(meta, f)
    print("[offline] saved", out_path)


if __name__ == "__main__":
    train()
