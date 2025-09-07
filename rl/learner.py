#!/usr/bin/env python3
"""Minimal PPO learner skeleton (Phase 3.4 enhanced)
Ajouts: lecture return/advantage si présents, normalisation avantage, logging métriques supplémentaires.
"""
from __future__ import annotations
import os, time, json, base64, glob, shutil, signal, math
from dataclasses import dataclass
from typing import List, Optional, Any

ROLLouts_DIR = os.path.join("data", "rollouts")
PENDING_DIR = os.path.join(ROLLouts_DIR, "pending")
PROCESSED_DIR = os.path.join(ROLLouts_DIR, "processed")
CORRUPT_DIR = os.path.join(ROLLouts_DIR, "corrupt")
RUNS_DIR = "runs"
ADV_DIR = os.path.join(ROLLouts_DIR, "processed_adv")

for d in (PENDING_DIR, PROCESSED_DIR, CORRUPT_DIR, RUNS_DIR, ADV_DIR):
    os.makedirs(d, exist_ok=True)

stop_loop = False


def handle_sigint(signum: int, frame: Any) -> None:  # frame type ignoré volontairement
    global stop_loop
    stop_loop = True


signal.signal(signal.SIGINT, handle_sigint)


@dataclass
class Transition:
    obs: bytes
    mask: bytes
    action: int
    logProb: float
    value: float
    reward: float
    done: bool
    gameId: str
    playerId: str
    turn: int
    episodeId: str
    ret: float = 0.0
    adv: float = 0.0


def parse_line(line: str) -> Optional[Transition]:
    try:
        obj = json.loads(line)
        return Transition(
            obs=base64.b64decode(obj["obs"]),
            mask=base64.b64decode(obj["mask"]),
            action=int(obj["action"]),
            logProb=float(obj.get("logProb", -1.0)),
            value=float(obj.get("value", 0.0)),
            reward=float(obj["reward"]),
            done=bool(obj["done"]),
            gameId=obj["gameId"],
            playerId=obj["playerId"],
            turn=int(obj.get("turn", 0)),
            episodeId=obj.get("episodeId", f"{obj['gameId']}_{obj['playerId']}"),
            ret=float(obj.get("return", obj["reward"])),
            adv=float(obj.get("advantage", obj["reward"])),
        )
    except Exception:
        return None


def collect_episodes(threshold: int = 2048) -> List[Transition]:
    transitions: List[Transition] = []
    files = [f for f in glob.glob(os.path.join(ROLLouts_DIR, "episode_*.jsonl"))]
    for f in files:
        dest = os.path.join(PENDING_DIR, os.path.basename(f))
        try:
            shutil.move(f, dest)
        except Exception:
            continue
    pending = sorted(glob.glob(os.path.join(PENDING_DIR, "episode_*.jsonl")))
    for pf in pending:
        with open(pf, "r") as fh:
            corrupt = False
            for line in fh:
                t = parse_line(line.strip())
                if t is None:
                    corrupt = True
                    break
                transitions.append(t)
            if corrupt:
                shutil.move(pf, os.path.join(CORRUPT_DIR, os.path.basename(pf)))
            else:
                shutil.move(pf, os.path.join(PROCESSED_DIR, os.path.basename(pf)))
        if len(transitions) >= threshold:
            break
    return transitions


def maybe_load_advantages(batch: List[Transition]) -> None:
    # Option future: remapper value/advantages post-calcul; pour l'instant déjà dans adv
    pass


def normalize_adv(batch: List[Transition]) -> None:
    vals = [t.adv for t in batch]
    if not vals:
        return
    m = sum(vals) / len(vals)
    var = sum((v - m) ** 2 for v in vals) / max(1, len(vals) - 1)
    std = math.sqrt(var + 1e-8)
    for t in batch:
        t.adv = (t.adv - m) / std


def dummy_train_step(batch: List[Transition]):
    if not batch:
        return {"meanReward": 0.0, "meanAdv": 0.0}
    mr = sum(t.reward for t in batch) / len(batch)
    ma = sum(t.adv for t in batch) / len(batch)
    return {"meanReward": mr, "meanAdv": ma}


def main():
    threshold = int(os.environ.get("BATCH_THRESHOLD", "2048"))
    poll = float(os.environ.get("POLL_SEC", "5"))
    print(f"[learner] Starting loop threshold={threshold}")
    update = 0
    while not stop_loop:
        batch = collect_episodes(threshold)
        if batch:
            normalize_adv(batch)
            metrics = dummy_train_step(batch)
            update += 1
            print(
                f"[learner] update={update} transitions={len(batch)} metrics={metrics}"
            )
        else:
            time.sleep(poll)


if __name__ == "__main__":
    main()
