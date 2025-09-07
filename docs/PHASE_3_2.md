# Phase 3.2 - Automatisation collecte & enrichissements dataset

## Objectifs
1. Arrêt automatique de la self-play après N épisodes (`TARGET_EPISODES`).
2. Hash stable des observations (déduplication future & tracking) via FNV-1a quantisé.
3. Reward shaping léger (progression tours) pour réduire sparsité initiale.
4. Compression gzip des épisodes pour stockage.
5. Split transitions train/val/test (80/10/10) reproductible sur dernier lot.
6. Pipeline script unique `selfplay:collect` (collecte -> build -> split -> compress).

## Nouveaux / Modifiés
- `dataset/util_hash.js` : hash FNV-1a.
- `scripts/bot.js` : ajout obsHash, shaping reward, obsHash dans info.
- `scripts/selfplay.js` : monitoring dossier épisodes & arrêt sur quota.
- `scripts/split_dataset.js` : split transitions.
- `scripts/compress_episodes.js` : gzip des épisodes.
- `package.json` : scripts mis à jour.

## Variables d'environnement
| Variable | Rôle | Défaut |
|----------|------|--------|
| `BOTS` | Nombre de bots self-play | 4 (dans script pipeline) |
| `TARGET_EPISODES` | Quota d'épisodes à collecter | 20 (pipeline) |

## Pipeline
```bash
npm run selfplay:collect
```
Effectue séquentiellement:
1. Self-play jusqu'à `TARGET_EPISODES` épisodes JSON.
2. Construction transitions (`dataset:build`).
3. Split train/val/test (`dataset:split`).
4. Compression épisodes (`episodes:compress`).

## Formats
Identiques Phase 3.1, avec champs supplémentaires:
- `info.obsHash` dans chaque step.
- Reward final additionné à la dernière transition (shaping inclus).

## Prochaines pistes (Phase 3.3)
- Dédup d'observations (skip si hash déjà vu > threshold).
- Buffer priorité (prioritized replay pré-RL).
- Normalisation online des features (running mean/var).
- Export vers format numpy / parquet pour pipeline Python direct.
- Intégration d'un premier modèle PPO pour remplacer politique random.

---
Phase 3.2 complétée.
