# Décision Phase 1.3 – Stack Entraînement RL
Date: 2025-09-07

## Résumé
Adoption d'un pipeline hybride: serveur & bots en Node.js, apprentissage en Python (stable-baselines3 adaptation PPO) avec passerelle fichiers (JSONL transitions) puis possibilité future gRPC.

## Motivations
- Écosystème RL mature (PyTorch, SB3) côté Python.
- Complexité protocole jeu modérée → sérialisation fichiers suffisante pour MVP.
- Découplage clair collecte vs entraînement (facilite scaling horizontal bots).

## Alternatives Évaluées
| Option | Avantages | Inconvénients | Statut |
|--------|-----------|---------------|--------|
| Full JS (tfjs) | Monolangue, déploiement simplifié | Moins de libs RL avancées, masques actions custom lourds | Rejeté MVP |
| gRPC temps réel | Faible latence, streaming | Surcoût infra initial | Plus tard |
| Redis queue | Facile multi-prod | Dépendance supplémentaire | Étape 2 potentielle |

## Architecture Choisie (MVP)
- Bots écrivent transitions complète sur fin d'épisode -> fichier `data/rollouts/episode_<id>.jsonl`.
- Learner Python scrute répertoire, charge par batch taille cumulée >= seuil (ex 4096 pas). Supprime/Archive fichiers consommés.
- Checkpoints écrits dans `runs/ppo_<timestamp>/`.

## Contrat Fichier Transition
JSONL lignes format:
```json
{"obs":"base64float32","mask":"base64uint8","action":123,"logProb":-1.23,"value":0.45,"reward":0,"done":false,"gameId":"g1","playerId":"pA","turn":2,"episodeId":"g1_pA_20250907T120000"}
```
Dernière ligne d'un épisode porte `done:true`.

## Synchronisation
- Aucune écriture concurrente fichier: un épisode = un fichier (écrit en append). 
- Une fois épisode clos (fsync + close), learner déplace dans sous-dossier `pending/` → lecture → `processed/`.

## Stratégie Erreurs
- Si parsing erreur -> déplacer fichier vers `corrupt/` + log.
- Validation: tailles vecteurs attendues, pas de NaN.

## Prochaines Étapes
1. Ajouter squelette learner Python + requirements.
2. Définir format config PPO (`rl/config/ppo.yaml`).
3. Implémenter watcher rollouts (polling 5s) + pipeline prétraitement GAE.

Fin du document.
