#!/usr/bin/env python3
"""Phase 3.4 - Post-traitement: calcule returns & (futur) advantages.
Lit fichiers episode_*.jsonl dans data/rollouts/processed.
Ajoute colonnes return et advantage (placeholder = return).
Produit une copie augmentée dans data/rollouts/processed_adv/.
"""
import os, json, glob
from typing import List

ROLL_DIR = os.path.join('data','rollouts')
PROCESSED = os.path.join(ROLL_DIR,'processed')
OUT_DIR = os.path.join(ROLL_DIR,'processed_adv')
os.makedirs(OUT_DIR, exist_ok=True)

gamma = float(os.environ.get('GAMMA','0.995'))

files = sorted(glob.glob(os.path.join(PROCESSED,'episode_*.jsonl')))
if not files:
    print('[returns] no processed episodes'); exit(0)

for f in files:
    lines = open(f,'r').read().strip().split('\n')
    traj = [json.loads(l) for l in lines if l.strip()]
    returns: List[float] = []
    g = 0.0
    for t in reversed(traj):
        g = t['reward'] + gamma * g * (0.0 if t['done'] else 1.0)
        returns.append(g)
    returns.reverse()
    outp = os.path.join(OUT_DIR, os.path.basename(f))
    with open(outp,'w') as w:
        for t, R in zip(traj, returns):
            t['return'] = R
            t['advantage'] = R
            w.write(json.dumps(t)+'\n')
    print('[returns] wrote', outp, 'len', len(traj))
