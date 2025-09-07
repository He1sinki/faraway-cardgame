# Phase 3.1 - Extraction de données RL (collecte brute)

## Objectif
Mettre en place la collecte de trajectoires nécessaires à l'entraînement d'un agent RL (PPO ou autre) depuis les bots auto-joueurs (politique aléatoire pour amorçage).

## Nouveaux fichiers
- `dataset/featurize.js` : transformation d'un état serveur en vecteur numérique + mask d'actions.
- `dataset/episode_writer.js` : accumulateur et sérialisation d'un épisode (par joueur).
- `scripts/bot.js` (modifié) : sélection d'action aléatoire, enregistrement transitions, reward final.
- `scripts/build_dataset.js` : conversion épisodes -> transitions JSONL.
- Dossiers: `dataset/episodes/`, `dataset/transitions/`, `dataset/tmp/`.

## Format épisode
```jsonc
{
  "gameId": "abc12",
  "playerId": "<socketId>",
  "createdAt": 1234567890,
  "finishedAt": 1234567999,
  "steps": [
    { "obs": [..], "mask": [..], "action": 42, "reward": 0, "done": false, "info": { "seq": 3, "phase": "play" } },
    ...,
    { "obs": [...], "mask": [...], "action": 17, "reward": 5.5, "done": true, "info": { "seq": 120, "phase": "end" } }
  ],
  "finalInfo": { "finalReward": 5.5 }
}
```

## Format transition (jsonl)
Une ligne par transition:
```json
{ "obs": [...], "mask": [...], "action": 17, "reward": 0.5, "done": false }
```

## Politique actuelle
Politique purement aléatoire:
- phase `play`: carte aléatoire de la main.
- phase `shop`: carte aléatoire de la boutique si tour du joueur.
- phase `sanctuary`: première option de sanctuaire.
Objectif: produire diversité initiale pour entraîner un premier modèle supervisé / RL.

## Reward
Sparse final uniquement: score_joueur - moyenne_scores (centrage). Dernière transition reçoit ce reward; transitions précédentes reward=0 (peut être redistribué plus tard via GAE ou Monte Carlo).

## Featurisation (version 0)
- Normalisation simple des comptes (tour/8, hand/10...).
- One-hot phase (4).
- Buckets de main (32).
- Indicateurs booléens (hasToChoose, hasPlayed).

## Pipelines
Collecte:
```bash
npm run selfplay:collect
```
(TODO: script s'arrête aujourd'hui manuellement; on ajoutera un timer ou compteur de parties dans 3.2.)

Construction dataset transitions:
```bash
npm run dataset:build
```

## Étapes suivantes (Phase 3.2 suggestion)
- Limiter nombre d'épisodes par run (param ENV TARGET_EPISODES).
- Ajout d'un hash d'observation stable (deduplication).
- Stockage compressé (gz) après build.
- Script de split train/val/test.
- Ajout reward shaping intermédiaire (progression de tours ou cartes jouées).

---
Phase 3.1 complétée.
