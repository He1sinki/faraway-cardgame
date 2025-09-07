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
import os, glob, json, base64, time, struct, random, sys
from typing import List, Tuple, Dict, Any
import yaml
import torch
import torch.nn as nn
import torch.optim as optim

if __name__ == "__main__":
    # Assure inclusion racine projet pour import relatif (phase 6.6 persistence)
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    if root not in sys.path:
        sys.path.insert(0, root)
try:  # essaye import package
    from rl.scaler import RunningMeanStd  # type: ignore
except ModuleNotFoundError:  # fallback relatif
    from scaler import RunningMeanStd  # type: ignore

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
        advs_raw = torch.tensor(self.advs, dtype=torch.float32, device=DEVICE)
        masks = torch.tensor(self.masks, dtype=torch.float32, device=DEVICE)
        # Stats avant normalisation
        print(
            f"[diag] returns: mean={returns.mean():.4f} std={returns.std():.4f} min={returns.min():.4f} max={returns.max():.4f}"
        )
        print(
            f"[diag] adv_raw: mean={advs_raw.mean():.4f} std={advs_raw.std():.4f} min={advs_raw.min():.4f} max={advs_raw.max():.4f}"
        )
        advs = (advs_raw - advs_raw.mean()) / (advs_raw.std() + 1e-8)
        print(
            f"[diag] adv_norm: mean={advs.mean():.4f} std={advs.std():.4f} min={advs.min():.4f} max={advs.max():.4f}"
        )
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
    mask_fill: float,
    ratio_cap: float,
) -> Dict[str, Any]:
    # N initial (peut changer après filtrage invalides)
    N = obs.size(0)
    old_model.eval()

    def restricted_log_softmax(all_logits: torch.Tensor, mask_valid: torch.Tensor):
        # all_logits: (B, A) mask_valid: (B, A) (0/1)
        # returns log_probs_all with -inf on invalid, probs_all (invalid=0), entropy_per_sample
        # Shift for stability
        shifted = all_logits - all_logits.max(dim=-1, keepdim=True).values
        shifted = shifted.masked_fill(mask_valid == 0, float("-inf"))
        logZ = torch.logsumexp(shifted, dim=-1, keepdim=True)
        log_probs = shifted - logZ
        probs = torch.exp(log_probs)
        probs = probs * mask_valid  # ensure invalid exactly 0
        # Entropy only over valid actions
        entropy = -(probs * log_probs.masked_fill(mask_valid == 0, 0.0)).sum(-1)
        return log_probs, probs, entropy

    with torch.no_grad():
        old_logits, _old_values = old_model(obs)
        sub_mask_all = masks[:, :LOGICAL_ACT_DIM]
        invalid_action_mask = sub_mask_all[torch.arange(N), actions] == 0
        dropped_invalid = int(invalid_action_mask.sum().item())
        if dropped_invalid:
            print(
                f"[diag][drop] {dropped_invalid} transitions (action invalide) retirées avant update"
            )
        keep = ~invalid_action_mask
        if keep.sum() == 0:
            raise RuntimeError(
                "Aucune transition valide après filtrage des actions invalides"
            )
        obs = obs[keep]
        actions = actions[keep]
        returns = returns[keep]
        advs = advs[keep]
        masks = masks[keep]
        N = obs.size(0)
        print(f"[diag] transitions retenues après filtrage: {N}")
        sub_mask_all = masks[:, :LOGICAL_ACT_DIM]
        old_logits = old_logits[keep]
        old_log_probs_all, old_probs_all, old_entropy_samples = restricted_log_softmax(
            old_logits, sub_mask_all
        )
        old_log_probs = old_log_probs_all.gather(1, actions.unsqueeze(1)).squeeze(1)
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
            new_log_probs_all, new_probs_all, new_entropy_samples = (
                restricted_log_softmax(logits, sub_mask)
            )
            log_probs = new_log_probs_all.gather(1, actions[idx].unsqueeze(1)).squeeze(
                1
            )
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
            entropy = new_entropy_samples.mean()
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
        sub_mask_final = masks[:, :LOGICAL_ACT_DIM]
        new_log_all, new_probs_all, new_entropy_all = restricted_log_softmax(
            logits, sub_mask_final
        )
        new_logp = new_log_all.gather(1, actions.unsqueeze(1)).squeeze(1)
        approx_kl = (old_log_probs - new_logp).mean().item()
        # KL exacte restreinte
        kl_exact_vec = (old_probs_all * (old_log_probs_all - new_log_all)).sum(-1)
        kl_exact = kl_exact_vec.mean().item()
        old_lp_mean = old_log_probs.mean().item()
        new_lp_mean = new_logp.mean().item()
        old_lp_std = old_log_probs.std().item()
        new_lp_std = new_logp.std().item()
    ratio_full = torch.exp(new_logp - old_log_probs)
    if ratio_cap > 0:
        low = 1.0 / ratio_cap
        high = ratio_cap
        ratio_full = ratio_full.clamp(low, high)
    ratio_mean = ratio_full.mean().item()
    ratio_std = ratio_full.std().item()
    ratio_max = ratio_full.max().item()
    ratio_p95 = torch.quantile(
        ratio_full, torch.tensor(0.95, device=ratio_full.device)
    ).item()
    clip_fraction = clip_frac_acc / max(1, total_samples)
    return {
        "approx_kl": approx_kl,
        "kl_exact": kl_exact,
        "entropy": sum(entropies) / max(1, len(entropies)),
        "policy_loss": sum(policy_losses) / max(1, len(policy_losses)),
        "value_loss": sum(value_losses) / max(1, len(value_losses)),
        "epochs": epochs,
        "batches": len(policy_losses),
        "clip_fraction": clip_fraction,
        "ratio_mean": ratio_mean,
        "ratio_std": ratio_std,
        "ratio_max": ratio_max,
        "ratio_p95": ratio_p95,
        "old_logp_mean": old_lp_mean,
        "new_logp_mean": new_lp_mean,
        "old_logp_std": old_lp_std,
        "new_logp_std": new_lp_std,
        "dropped_invalid": dropped_invalid,
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


def linear_lr(base_lr: float, step: int, total_steps: int) -> float:
    frac = 1.0 - (step / max(1, total_steps))
    return base_lr * frac


def main():
    cfg = load_config(CONFIG_PATH)
    base_lr = float(cfg.get("learning_rate", 3e-4))
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
    resume_enabled = bool(cfg.get("resume", True))
    adv_clamp = float(cfg.get("adv_clamp", 0.0))
    mask_fill = float(cfg.get("mask_fill", -1e9))
    ignore_single_valid = bool(cfg.get("ignore_single_valid", False))
    ratio_cap = float(cfg.get("ratio_cap", 0.0))

    # Phase 6.6 – Normalisation observations + reprise scaler
    scaler = RunningMeanStd(shape=(obs_dim,))

    # Reprise éventuelle scaler (même timestamp que dernier policy)
    latest_policy = (
        find_latest(os.path.join(RUNS_DIR, "ppo_policy_*.pt"))
        if resume_enabled
        else None
    )
    latest_ts = None
    if latest_policy:
        try:
            latest_ts = latest_policy.split("_")[-1].split(".")[0]
            scaler_path = os.path.join(RUNS_DIR, f"ppo_scaler_{latest_ts}.pt")
            if os.path.exists(scaler_path):
                scaler.load_state_dict(torch.load(scaler_path, map_location=DEVICE))
                print(
                    f"[ppo] scaler repris depuis {scaler_path} (count={scaler.count:.0f})"
                )
        except Exception as e:
            print(f"[ppo] reprise scaler ignorée: {e}")

    # Met à jour scaler avec toutes les observations (offline) puis normalise
    with torch.no_grad():
        scaler.update(obs)
        obs = scaler.normalize(obs)
    model = PolicyValueNet(obs_dim).to(DEVICE)
    resumed_flag, latest_policy = try_resume(model) if resume_enabled else (0, None)
    old_model = PolicyValueNet(obs_dim).to(DEVICE)
    old_model.load_state_dict(model.state_dict())
    lr_schedule_mode = cfg.get("lr_schedule", "none")
    total_updates = int(cfg.get("updates", 1))
    optimizer = optim.Adam(model.parameters(), lr=base_lr)
    if resume_enabled:
        try_resume_optimizer(optimizer, latest_policy)
    early_stop = bool(cfg.get("early_stop", True))
    target_kl = float(cfg.get("target_kl", 0.1))
    min_entropy = float(cfg.get("min_entropy", 0.05))
    lr_kl_factor = float(cfg.get("lr_kl_factor", 0.5))
    patience_updates = int(cfg.get("patience_updates", 0))
    # Diagnostics masque (ancienne version non filtrante)
    with torch.no_grad():
        valid_counts = masks[:, :LOGICAL_ACT_DIM].sum(dim=1)
        vc_mean = valid_counts.float().mean().item()
        print(
            f"[diag] mask valid actions count: mean={vc_mean:.2f} min={valid_counts.min().item()} max={valid_counts.max().item()}"
        )
        uniq, cnt = torch.unique(valid_counts, return_counts=True)
        hist = {int(u.item()): int(c.item()) for u, c in zip(uniq, cnt)}
        print(f"[diag] mask histogram: {hist}")
        if ignore_single_valid:
            keep = valid_counts > 1
            dropped = (~keep).sum().item()
            if dropped:
                obs = obs[keep]
                actions = actions[keep]
                returns = returns[keep]
                advs = advs[keep]
                masks = masks[keep]
                print(f"[diag] dropped {dropped} transitions (single valid action)")
        if (actions >= LOGICAL_ACT_DIM).any():
            bad = (actions >= LOGICAL_ACT_DIM).sum().item()
            print(f"[diag][WARN] {bad} actions >= LOGICAL_ACT_DIM (out of range)")
        sample_logits, _ = model(obs[:1])
        sm = torch.log_softmax(sample_logits, dim=-1)[0]
        topv, topi = torch.topk(sm, 5)
        print("[diag] top5 pre-train log-probs:")
        for lv, li in zip(topv.tolist(), topi.tolist()):
            print(f"    idx={li} logp={lv:.3f}")
    if adv_clamp > 0:
        advs = advs.clamp_(-adv_clamp, adv_clamp)
        print(f"[diag] advs clamped to ±{adv_clamp}")
    history = []
    for update_idx in range(total_updates):
        # scheduler
        if lr_schedule_mode == "linear":
            new_lr = linear_lr(base_lr, update_idx, total_updates)
            for pg in optimizer.param_groups:
                pg["lr"] = new_lr
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
            mask_fill=mask_fill,
            ratio_cap=ratio_cap,
        )
        history.append(metrics)
        # early stop checks
        if early_stop:
            kl = metrics["approx_kl"]
            ent = metrics["entropy"]
            if kl > target_kl:
                # reduce LR once then maybe stop
                for pg in optimizer.param_groups:
                    pg["lr"] *= lr_kl_factor
                if update_idx >= total_updates - 1 or patience_updates == 0:
                    print(f"[ppo] early stop: KL {kl:.4f} > {target_kl}")
                    break
                patience_updates -= 1
            if ent < min_entropy:
                print(f"[ppo] early stop: entropy {ent:.4f} < {min_entropy}")
                break
    ts = int(time.time())
    policy_path = os.path.join(RUNS_DIR, f"ppo_policy_{ts}.pt")
    torch.save(model.state_dict(), policy_path)
    opt_path = os.path.join(RUNS_DIR, f"ppo_optimizer_{ts}.pt")
    torch.save(optimizer.state_dict(), opt_path)
    scaler_path = os.path.join(RUNS_DIR, f"ppo_scaler_{ts}.pt")
    torch.save(scaler.state_dict(), scaler_path)
    stats = {
        "obs_dim": obs_dim,
        "logical_act_dim": LOGICAL_ACT_DIM,
        "pad_dim": PAD_DIM,
        "metrics": metrics,
        "history": history,
        "count": obs.size(0),
        "config_used": {
            "learning_rate": base_lr,
            "batch_size": batch_size,
            "n_epochs": n_epochs,
            "clip_range": clip,
            "entropy_coef": ent_coef,
            "value_coef": vf_coef,
            "seed": seed,
            "lr_schedule": lr_schedule_mode,
            "updates": total_updates,
            "target_kl": target_kl,
            "min_entropy": min_entropy,
        },
        "resumed": bool(resumed_flag),
        "timestamp": ts,
        "scaler": {
            "count": scaler.count,
            "mean_sample": scaler.mean[:5].tolist(),
            "var_sample": scaler.var[:5].tolist(),
        },
    }
    stats_path = os.path.join(RUNS_DIR, f"ppo_stats_{ts}.json")
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)
    print("[ppo] saved", policy_path, "metrics=", metrics)


if __name__ == "__main__":
    main()
