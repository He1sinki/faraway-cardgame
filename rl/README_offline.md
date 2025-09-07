# Offline Imitation (Phase 3.5)

Script: `simple_offline_train.py`

Usage:
```
cd rl
python simple_offline_train.py
```
Environment vars:
- EPOCHS (default 5)
- BATCH (default 2048)

Input rollouts: `data/rollouts/processed_adv/episode_*.jsonl`
Each line must contain: obs (b64 float32 array), action (>=0), mask (ignored here), advantage/return (ignored).

Output: `runs/policy_<timestamp>.pt` + `runs/policy_meta.json`.

Next steps: integrate PPO using this policy as initialization.
