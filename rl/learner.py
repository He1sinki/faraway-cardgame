#!/usr/bin/env python3
"""Minimal PPO learner skeleton (Phase 1.3)
NOTE: Placeholder; real integration with stable-baselines3 or custom PPO to be added later.
"""
from __future__ import annotations
import os, time, json, base64, glob, shutil, signal
from dataclasses import dataclass
from typing import List, Optional, Any

ROLLouts_DIR = os.path.join("data", "rollouts")
PENDING_DIR = os.path.join(ROLLouts_DIR, "pending")
PROCESSED_DIR = os.path.join(ROLLouts_DIR, "processed")
CORRUPT_DIR = os.path.join(ROLLouts_DIR, "corrupt")
RUNS_DIR = "runs"

os.makedirs(PENDING_DIR, exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)
os.makedirs(CORRUPT_DIR, exist_ok=True)
os.makedirs(RUNS_DIR, exist_ok=True)

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


def parse_line(line: str) -> Optional[Transition]:
    try:
        obj = json.loads(line)
        return Transition(
            obs=base64.b64decode(obj["obs"]),
            mask=base64.b64decode(obj["mask"]),
            action=int(obj["action"]),
            logProb=float(obj["logProb"]),
            value=float(obj["value"]),
            reward=float(obj["reward"]),
            done=bool(obj["done"]),
            gameId=obj["gameId"],
            playerId=obj["playerId"],
            turn=int(obj["turn"]),
            episodeId=obj.get("episodeId", f"{obj['gameId']}_{obj['playerId']}"),
        )
    except Exception:
        return None


def collect_episodes(threshold: int = 2048) -> List[Transition]:
    """Move completed episode files to pending, parse them until threshold transitions."""
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


def dummy_train_step(batch: List[Transition]):
    # Placeholder for PPO update: compute losses here.
    # We'll just aggregate mean reward for now.
    if not batch:
        return {"meanReward": 0.0}
    mr = sum(t.reward for t in batch) / len(batch)
    return {"meanReward": mr}


def main():
    threshold = 2048
    poll = 5.0
    print(f"[learner] Starting loop threshold={threshold}")
    update = 0
    while not stop_loop:
        batch = collect_episodes(threshold)
        if batch:
            metrics = dummy_train_step(batch)
            update += 1
            print(
                f"[learner] update={update} transitions={len(batch)} metrics={metrics}"
            )
        else:
            time.sleep(poll)


if __name__ == "__main__":
    main()
