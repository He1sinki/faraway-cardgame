#!/usr/bin/env python3
"""Phase 6.2 - Entraînement PPO custom offline (pipeline unifiée améliorée).

Améliorations vs version précédente:
 - Lecture hyperparams depuis rl/config/ppo.yaml
 - Sauvegarde état optimizer pour reprise
 - Reprise automatique dernier couple (policy, optimizer) si dimensions compatibles
 - Export métriques détaillées (policy_loss, value_loss, entropy, approx_kl, count)
 - Seed déterministe (si fourni dans config)

Entrée: data/rollouts/processed_adv/*.jsonl (champs: obs (b64 float32), action, return, advantage, mask)
Sorties: runs/ppo_policy_<ts>.pt, runs/ppo_optimizer_<ts>.pt, runs/ppo_stats_<ts>.json
"""
import os, glob, json, base64, time, struct, random
from typing import List, Tuple, Dict, Any
import yaml
import torch
import torch.nn as nn
import torch.optim as optim

ROLL_DIR = os.path.join("data", "rollouts", "processed_adv")
RUNS_DIR = "runs"
os.makedirs(RUNS_DIR, exist_ok=True)

LOGICAL_ACT_DIM = 208  # actions réelles (2R+S+NOOP)
PAD_DIM = 256  # masque/stockage (fixe pour padding binaire)
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
CONFIG_PATH = os.path.join("rl", "config", "ppo.yaml")


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
    model: nn.Module,
    old_model: nn.Module,
    optimizer: optim.Optimizer,
    obs: torch.Tensor,
    actions: torch.Tensor,
    returns: torch.Tensor,
    advs: torch.Tensor,
    masks: torch.Tensor,
    *,
    clip: float,
    vf_coef: float,
    ent_coef: float,
    vf_clip: float | None,
    batch_size: int,
    epochs: int,
) -> Dict[str, Any]:
    N = obs.size(0)
    old_model.eval()
    with torch.no_grad():
        old_logits, _old_values = old_model(obs)
        old_log_probs = (
            torch.log_softmax(old_logits, dim=-1)
            .gather(1, actions.unsqueeze(1))
            .squeeze(1)
        )
    policy_losses = []
    value_losses = []
    entropies = []
    clip_frac_acc = 0
    total_samples = 0
    for _ep in range(epochs):
        perm = torch.randperm(N, device=obs.device)
        for i in range(0, N, batch_size):
            idx = perm[i : i + batch_size]
            logits, values = model(obs[idx])
            sub_mask = masks[idx][:, :LOGICAL_ACT_DIM]
            masked_logits = logits.masked_fill(sub_mask == 0, -1e9)
            log_probs_all = torch.log_softmax(masked_logits, dim=-1)
            log_probs = log_probs_all.gather(1, actions[idx].unsqueeze(1)).squeeze(1)
            ratio = torch.exp(log_probs - old_log_probs[idx])
            surr1 = ratio * advs[idx]
            surr2 = torch.clamp(ratio, 1.0 - clip, 1.0 + clip) * advs[idx]
            policy_loss = -torch.min(surr1, surr2).mean()
            v_target = returns[idx]
            if vf_clip is not None:
                # clip value prediction around target within +/- vf_clip
                v_clipped = v_target + (values - v_target).clamp(-vf_clip, vf_clip)
                value_loss_unclipped = (values - v_target).pow(2)
                value_loss_clipped = (v_clipped - v_target).pow(2)
                value_loss = torch.max(value_loss_unclipped, value_loss_clipped).mean()
            else:
                value_loss = (values - v_target).pow(2).mean()
            entropy = -(log_probs_all * torch.exp(log_probs_all)).sum(-1).mean()
            loss = policy_loss + vf_coef * value_loss - ent_coef * entropy
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            optimizer.step()
            with torch.no_grad():
                clipped = (ratio < (1.0 - clip)) | (ratio > (1.0 + clip))
                clip_frac_acc += clipped.sum().item()
                total_samples += ratio.numel()
            policy_losses.append(policy_loss.item())
            value_losses.append(value_loss.item())
            entropies.append(entropy.item())
    with torch.no_grad():
        logits, _values_f = model(obs)
        masked_logits = logits.masked_fill(masks[:, :LOGICAL_ACT_DIM] == 0, -1e9)
        new_logp = (
            torch.log_softmax(masked_logits, dim=-1)
            .gather(1, actions.unsqueeze(1))
            .squeeze(1)
        )
        approx_kl = (old_log_probs - new_logp).mean().item()
    clip_fraction = clip_frac_acc / max(1, total_samples)
    return {
        "approx_kl": approx_kl,
        "entropy": sum(entropies) / max(1, len(entropies)),
        "policy_loss": sum(policy_losses) / max(1, len(policy_losses)),
        "value_loss": sum(value_losses) / max(1, len(value_losses)),
        "epochs": epochs,
        "batches": len(policy_losses),
        "clip_fraction": clip_fraction,
    }


def load_config(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return yaml.safe_load(f) or {}


def set_seed(seed: int):
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def find_latest(pattern: str) -> str | None:
    pts = glob.glob(pattern)
    return max(pts, key=os.path.getmtime) if pts else None


def try_resume(model: nn.Module) -> tuple[int, str | None]:
    latest_policy = find_latest(os.path.join(RUNS_DIR, "ppo_policy_*.pt"))
    loaded = 0
    if latest_policy:
        try:
            state = torch.load(latest_policy, map_location=DEVICE)
            model.load_state_dict(state)
            loaded = 1
            print(f"[ppo] reprise policy depuis {latest_policy}")
        except Exception as e:
            print(f"[ppo] reprise ignorée: {e}")
    return loaded, latest_policy


def try_resume_optimizer(optimizer: optim.Optimizer, latest_policy_path: str | None):
    if not latest_policy_path:
        return 0
    ts = latest_policy_path.split("_")[-1].split(".")[0]
    opt_path = os.path.join(RUNS_DIR, f"ppo_optimizer_{ts}.pt")
    if os.path.exists(opt_path):
        try:
            state = torch.load(opt_path, map_location=DEVICE)
            optimizer.load_state_dict(state)
            print(f"[ppo] optimizer repris depuis {opt_path}")
            return 1
        except Exception as e:
            print(f"[ppo] optimizer reprise échouée: {e}")
    return 0


def main():
    cfg = load_config(CONFIG_PATH)
    lr = float(cfg.get("learning_rate", 3e-4))
    batch_size = int(cfg.get("batch_size", 256))
    n_epochs = int(cfg.get("n_epochs", cfg.get("epochs", 3)))
    clip = float(cfg.get("clip_range", 0.2))
    ent_coef = float(cfg.get("entropy_coef", 0.01))
    vf_coef = float(cfg.get("value_coef", 0.5))
    vf_clip_cfg = cfg.get("vf_clip")
    vf_clip_range = cfg.get("vf_clip_range")
    vf_clip = None
    if isinstance(vf_clip_cfg, (int, float)):
        vf_clip = float(vf_clip_cfg)
    elif isinstance(vf_clip_range, (int, float)):
        vf_clip = float(vf_clip_range)
    seed = cfg.get("seed")
    if seed is not None:
        set_seed(int(seed))
    buf, obs_dim = load_buffer()
    obs, actions, returns, advs, masks = buf.build()
    model = PolicyValueNet(obs_dim).to(DEVICE)
    resumed_flag, latest_policy = try_resume(model)
    old_model = PolicyValueNet(obs_dim).to(DEVICE)
    old_model.load_state_dict(model.state_dict())
    optimizer = optim.Adam(model.parameters(), lr=lr)
    try_resume_optimizer(optimizer, latest_policy)
    metrics = ppo_update(
        model,
        old_model,
        optimizer,
        obs,
        actions,
        returns,
        advs,
        masks,
        clip=clip,
        vf_coef=vf_coef,
        ent_coef=ent_coef,
        batch_size=batch_size,
        epochs=n_epochs,
        vf_clip=vf_clip,
    )
    ts = int(time.time())
    policy_path = os.path.join(RUNS_DIR, f"ppo_policy_{ts}.pt")
    torch.save(model.state_dict(), policy_path)
    opt_path = os.path.join(RUNS_DIR, f"ppo_optimizer_{ts}.pt")
    torch.save(optimizer.state_dict(), opt_path)
    stats = {
        "obs_dim": obs_dim,
        "logical_act_dim": LOGICAL_ACT_DIM,
        "pad_dim": PAD_DIM,
        "metrics": metrics,
        "count": obs.size(0),
        "config_used": {
            "learning_rate": lr,
            "batch_size": batch_size,
            "n_epochs": n_epochs,
            "clip_range": clip,
            "entropy_coef": ent_coef,
            "value_coef": vf_coef,
            "seed": seed,
        },
        "resumed": bool(resumed_flag),
        "timestamp": ts,
    }
    stats_path = os.path.join(RUNS_DIR, f"ppo_stats_{ts}.json")
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)
    print("[ppo] saved", policy_path, "metrics=", metrics)


if __name__ == "__main__":
    main()
