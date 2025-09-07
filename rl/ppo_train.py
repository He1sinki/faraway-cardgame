#!/usr/bin/env python3
"""Phase 3.6 - Entraînement PPO minimal custom sur rollouts offline.
Lit data/rollouts/processed_adv/*.jsonl et entraîne une policy + value.
Cette version n'effectue PAS encore de sampling masqué; elle suppose actions déjà légales.
"""
import os, glob, json, base64, math, time, struct
from typing import List, Tuple
import torch
import torch.nn as nn
import torch.optim as optim

ROLL_DIR = os.path.join("data", "rollouts", "processed_adv")
RUNS_DIR = "runs"
os.makedirs(RUNS_DIR, exist_ok=True)

LOGICAL_ACT_DIM = 208  # actions réelles (2R+S+NOOP)
PAD_DIM = 256  # masque/stockage
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def decode_obs(b64: str) -> List[float]:
    buf = base64.b64decode(b64)
    return list(struct.unpack("<" + "f" * (len(buf) // 4), buf))


def decode_mask(b64: str) -> List[int]:
    raw = base64.b64decode(b64)
    return list(raw[:PAD_DIM])


class PolicyValueNet(nn.Module):
    def __init__(self, obs_dim: int, act_dim: int = LOGICAL_ACT_DIM):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(obs_dim, 256), nn.ReLU(), nn.Linear(256, 256), nn.ReLU()
        )
        self.pi_head = nn.Linear(256, act_dim)
        self.v_head = nn.Linear(256, 1)

    def forward(self, x: torch.Tensor):
        h = self.shared(x)
        return self.pi_head(h), self.v_head(h).squeeze(-1)


class RolloutBuffer:
    def __init__(self):
        self.obs = []
        self.actions = []
        self.returns = []
        self.advs = []
        self.masks = []

    def add(self, o, a, R, adv, mask):
        self.obs.append(o)
        self.actions.append(a)
        self.returns.append(R)
        self.advs.append(adv)
        self.masks.append(mask)

    def build(self):
        obs = torch.tensor(self.obs, dtype=torch.float32, device=DEVICE)
        actions = torch.tensor(self.actions, dtype=torch.long, device=DEVICE)
        returns = torch.tensor(self.returns, dtype=torch.float32, device=DEVICE)
        advs = torch.tensor(self.advs, dtype=torch.float32, device=DEVICE)
        masks = torch.tensor(self.masks, dtype=torch.float32, device=DEVICE)
        # normalize advantages
        advs = (advs - advs.mean()) / (advs.std() + 1e-8)
        return obs, actions, returns, advs, masks


def load_buffer(limit_files: int = 200) -> Tuple[RolloutBuffer, int]:
    files = sorted(glob.glob(os.path.join(ROLL_DIR, "episode_*.jsonl")))[-limit_files:]
    buf = RolloutBuffer()
    obs_dim = None
    skipped_mismatch = 0
    total = 0
    for f in files:
        for line in open(f, "r"):
            if not line.strip():
                continue
            total += 1
            o = json.loads(line)
            act = int(o["action"])
            if act < 0:
                continue
            obs_vec = decode_obs(o["obs"])
            if obs_dim is None:
                obs_dim = len(obs_vec)
            if len(obs_vec) != obs_dim:
                skipped_mismatch += 1
                continue
            ret = float(o.get("return", o["reward"]))
            adv = float(o.get("advantage", ret))
            mask = decode_mask(o["mask"])
            buf.add(obs_vec, act, ret, adv, mask)
    if skipped_mismatch:
        print(
            f"[ppo] skipped {skipped_mismatch} transitions with mismatched obs dim out of {total}"
        )
    if obs_dim is None:
        raise SystemExit("No data found for PPO.")
    return buf, obs_dim


def ppo_update(
    model,
    old_model,
    optimizer,
    obs,
    actions,
    returns,
    advs,
    masks,
    clip=0.2,
    vf_coef=0.5,
    ent_coef=0.01,
    batch_size=256,
    epochs=3,
):
    N = obs.size(0)
    old_model.eval()
    with torch.no_grad():
        old_logits, old_values = old_model(obs)
        old_log_probs = (
            torch.log_softmax(old_logits, dim=-1)
            .gather(1, actions.unsqueeze(1))
            .squeeze(1)
        )
    for ep in range(epochs):
        perm = torch.randperm(N, device=obs.device)
        for i in range(0, N, batch_size):
            idx = perm[i : i + batch_size]
            logits, values = model(obs[idx])
            # Appliquer masque (seules premières LOGICAL_ACT_DIM colonnes concernées)
            sub_mask = masks[idx][:, :LOGICAL_ACT_DIM]
            masked_logits = logits.masked_fill(sub_mask == 0, -1e9)
            log_probs_all = torch.log_softmax(masked_logits, dim=-1)
            log_probs = log_probs_all.gather(1, actions[idx].unsqueeze(1)).squeeze(1)
            ratio = torch.exp(log_probs - old_log_probs[idx])
            surr1 = ratio * advs[idx]
            surr2 = torch.clamp(ratio, 1.0 - clip, 1.0 + clip) * advs[idx]
            policy_loss = -torch.min(surr1, surr2).mean()
            # value loss
            v_pred = values
            v_target = returns[idx]
            value_loss = (v_pred - v_target).pow(2).mean()
            # entropy
            entropy = -(log_probs_all * torch.exp(log_probs_all)).sum(-1).mean()
            loss = policy_loss + vf_coef * value_loss - ent_coef * entropy
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            optimizer.step()
    # compute diagnostics
    with torch.no_grad():
        logits, values = model(obs)
        masked_logits = logits.masked_fill(masks[:, :LOGICAL_ACT_DIM] == 0, -1e9)
        logp = (
            torch.log_softmax(masked_logits, dim=-1)
            .gather(1, actions.unsqueeze(1))
            .squeeze(1)
        )
        approx_kl = (old_log_probs - logp).mean().item()
        probs = torch.softmax(masked_logits, dim=-1)
        entropy_final = (
            -(torch.log_softmax(masked_logits, dim=-1) * probs).sum(-1).mean().item()
        )
    return {"approx_kl": approx_kl, "entropy": entropy_final}


def main():
    buf, obs_dim = load_buffer()
    obs, actions, returns, advs, masks = buf.build()
    model = PolicyValueNet(obs_dim).to(DEVICE)
    # init from offline imitation if exists
    meta_path = os.path.join(RUNS_DIR, "policy_meta.json")
    if os.path.exists(meta_path):
        latest = None
        # load latest policy_*.pt
        pts = [p for p in glob.glob(os.path.join(RUNS_DIR, "policy_*.pt"))]
        if pts:
            latest = max(pts, key=os.path.getmtime)
        if latest:
            try:
                state = torch.load(latest, map_location=DEVICE)
                # les poids value head seront ignorés (absents)
                model.load_state_dict({**model.state_dict(), **state}, strict=False)
                print("[ppo] initialisé depuis", latest)
            except Exception as e:
                print("[ppo] init offline échouée:", e)
    old_model = PolicyValueNet(obs_dim).to(DEVICE)
    old_model.load_state_dict(model.state_dict())
    optimizer = optim.Adam(model.parameters(), lr=3e-4)
    metrics = ppo_update(
        model, old_model, optimizer, obs, actions, returns, advs, masks
    )
    ts = int(time.time())
    outp = os.path.join(RUNS_DIR, f"ppo_policy_{ts}.pt")
    torch.save(model.state_dict(), outp)
    with open(os.path.join(RUNS_DIR, f"ppo_stats_{ts}.json"), "w") as f:
        json.dump(
            {
                "obs_dim": obs_dim,
                "logical_act_dim": LOGICAL_ACT_DIM,
                "pad_dim": PAD_DIM,
                "metrics": metrics,
                "count": obs.size(0),
            },
            f,
        )
    print("[ppo] saved", outp, metrics)


if __name__ == "__main__":
    main()
