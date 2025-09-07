# Phase 6.6 – Persistance & Reprise

Cette phase ajoute la sauvegarde / reprise complète des éléments critiques d'entraînement PPO:

## Artefacts sauvegardés
- Policy (poids réseau) : `runs/ppo_policy_<ts>.pt`
- Optimizer (Adam) : `runs/ppo_optimizer_<ts>.pt`
- Scaler (RunningMeanStd) : `runs/ppo_scaler_<ts>.pt`
- Statistiques: `runs/ppo_stats_<ts>.json`

## Scaler (RunningMeanStd)
Implémenté dans `rl/scaler.py`.
Champs:
- `count`: nombre effectif d'échantillons agrégés
- `mean`: moyenne glissante des features
- `var`: variance (>=1e-8 clamp)

Normalisation appliquée offline à la totalité du buffer (transition vers future version online incrémentale possible).

## Reprise
Lors du lancement de `ppo_train.py`:
1. Charge dataset offline
2. Reprend `ppo_policy_*.pt` le plus récent si compatible dimension
3. Reprend `ppo_optimizer_*.pt` associé (même timestamp) si présent
4. Reprend `ppo_scaler_*.pt` pour normaliser les observations

En absence de scaler sauvegardé, un nouveau est créé et alimenté avec toutes les observations du batch offline actuel.

## Justification
La normalisation feature stabilise le KL et réduit les explosions observées précédemment. Persister le scaler évite les dérives si distribution obs change lentement.

## Étapes suivantes (potentielles)
- Migration vers mise à jour scaler online (mini-batches) + lock pour multi-process.
- Sauvegarde périodique intermédiaire (toutes X updates) au lieu d'une seule sauvegarde finale.
- Ajout d'un hash de config dans `stats.json` pour simplifier détection d'incompatibilités.
