# Phase 3.4 - Bridge Dataset -> Learner & Préparation PPO

## Objectifs
- Export binaire base64 (float32/uint8) compatible learner Python.
- Génération rollouts `data/rollouts/episode_*.jsonl` depuis épisodes collectés.
- Script post-traitement returns / advantages (Monte Carlo) + normalisation côté learner.
- Mise à jour learner pour reconnaître champs return/advantage.
- Ajout requirements RL (torch, stable-baselines3) pour prochaine phase d'entraînement réel.

## Nouveaux scripts
| Fichier | Rôle |
|---------|------|
| `scripts/export_rollouts.js` | Convertit `dataset/episodes/*.json` en fichiers rollouts JSONL (base64). |
| `scripts/compute_returns_advantages.py` | Calcule returns (MC) et duplique en advantages (placeholder). |
| `rl/learner.py` (modifié) | Support return/advantage + normalisation avantage. |
| `rl/requirements.txt` | Dépendances RL futures. |

## Format ligne rollout
```jsonc
{
  "obs": "base64(float32[N])",
  "mask": "base64(uint8[256])",
  "action": 123,          // -1 si aucune
  "logProb": -1.0,        // placeholder (sera calculé après policy forward)
  "value": 0.0,           // placeholder
  "reward": 0.5,
  "done": false,
  "gameId": "g42",
  "playerId": "abc",
  "turn": 17,             // seq utilisé comme proxy
  "episodeId": "g42_abc_175726..."
}
```

## Workflow recommandé
1. Collecte self-play (Phase 3.3 pipeline).
2. Export rollouts:
```bash
node scripts/export_rollouts.js
```
3. Learner (consomme nouveaux rollouts) :
```bash
npm run train  # lance rl/learner.py
```
4. Calcul returns + advantages post-ingestion:
```bash
python3 scripts/compute_returns_advantages.py
```
(Pour future intégration, ce calcul sera déclenché automatiquement après calcul de value function.)

## Prochaines étapes (Phase 3.5 envisagée)
- Intégration réelle PPO (SB3 custom policy avec mask d'actions).
- Conversion obs -> tensor PyTorch (decoder base64) + dataloader mini-batch.
- Calcul GAE (avantage) à partir des valeurs réseau.
- Sauvegarde checkpoints (policy.zip) + metrics JSON.
- Rétro-injection policy dans bots (remplacer random).

---
Phase 3.4 complétée.
