# Phase 3.3 - Nettoyage & Préparation Dataset Avancée

## Objectifs
- Déduplication des transitions (obs identiques) pour réduire bruit.
- Normalisation (mean/std) des features et production d'un fichier normalisé.
- Construction d'un index de replay des épisodes (navigation / QA / UI future).
- Chaîne pipeline enrichie intégrant dedup -> normalize -> split -> compress -> index.

## Nouveaux scripts
| Script | Rôle |
|--------|------|
| `scripts/dedup_transitions.js` | Filtre transitions duplicées via hash FNV-1a sur `obs`. |
| `scripts/normalize_dataset.js` | Calcule mean/std et réécrit obs normalisées. Sauvegarde stats. |
| `scripts/build_replay_index.js` | Indexe les épisodes (métadonnées). |

## Artifacts
- `dataset/transitions/dedup_*.jsonl`
- `dataset/transitions/normalized_*.jsonl`
- `dataset/stats/stats.json`
- `dataset/episodes/index.json`

## Pipeline mise à jour
```bash
npm run selfplay:collect
```
Enchaîne: collect -> build -> dedup -> normalize -> split -> compress -> index.

## Notes
- Dedup conserve la première occurrence (choix conservatif). Possibilité d'introduire pondération plus tard (prioritized replay).
- Normalisation: toute obs dimensionnelle traitée; si dimension varie -> ignorée.
- Stats recalculées à chaque run sur le dernier lot de transitions.

## Étapes futures (Phase 3.4 suggest.)
- Export vers format binaire (npz / parquet) + script Python de chargement.
- Balanced sampling (stratifier par phase / action). 
- Ajout du champ advantages (post-traitement Monte Carlo) pour pré-training PPO.
- Mise en cache inter-run des stats (EMA) et drift detection.

---
Phase 3.3 complétée.
