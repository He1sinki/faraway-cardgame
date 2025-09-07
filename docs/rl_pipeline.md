# Pipeline RL – Architecture Self-Play Faraway Card Game (Draft)
Version: 0.1
Date: 2025-09-07

## Objectif
Décrire l'architecture opérationnelle pour entraîner une IA via self-play et déployer des checkpoints.

## Vue Macro
```
+-----------+        +--------------+        +-----------------+        +--------------+
| Game Srv  |<-----> | Bot Workers  | -----> |  Traj Collector  | -----> |  Learner PPO |
+-----------+        +--------------+        +-----------------+        +--------------+
      ^                       |                        |                         |
      |                       v                        v                         v
      |                Logs JSONL                Datasets chunk           Checkpoints (.ckpt)
      |                             +--------------------+                       |
      |                             |   Evaluation Job   |<----------------------+
      |                             +--------------------+          metrics → Dashboard
```

## Composants
### 1. Game Server
- Node.js existant (`index.js`). Ajouts: timestamps, protocolVersion, hooks logs.

### 2. Bot Worker
- Process Node.js autonome.
- Sous-modules: réseau (socket), state mirror, action selector (policy client), logger.
- Mode: inference uniquement (question: embarquer modèle léger ou requête HTTP/gRPC vers service inference?). Phase initiale: modèle chargé localement.

### 3. Trajectory Collector
- Rôle: agréger transitions poussées par bots.
- Buffer disque segmenté: `data/rollouts/episode_{id}.jsonl` ou format binaire.
- Politique de rotation: taille max (ex: 10k transitions) -> flush & index.

### 4. Learner (PPO)
- Python (stable-baselines3 custom policy masque).
- Lit lots de transitions, calcule advantages (GAE), applique updates.
- Sauvegarde checkpoint périodique `runs/ppo_timestamp/`.

### 5. Evaluation Job
- Lance séries de matchs vs baselines (random / heuristique / dernier best).
- Produit métriques & Elo.
- Compare winRate au meilleur existant → met à jour `best_model` si amélioration stable.

### 6. Dashboard / Reporting
- Génère `reports/index.html` (graphiques: winRate, loss, entropy, value loss, Elo timeline).
- Sources: `metrics/aggregates.json`, `eval/elo_history.csv`.

## Flux de Données
1. Self-play orchestrator spawn N bots (param `--parallel`).
2. Chaque bot:
   - Reçoit `update` → encode observation.
   - Quand action requise: applique policy -> action + logProb + value.
   - Envoie action serveur.
   - Empile transition partielle (reward différée). Terminal: calcule reward & complète toutes transitions épisode.
3. Collector écrit transitions.
4. Learner surveille dossier; quand assez de données (ex: 50k steps) -> entraînement epoch.
5. Après n epochs: évaluation. Si meilleure performance -> `best_model` symlink mis à jour.

## Fréquences & Paramètres Initiaux (suggestions)
| Élément | Valeur initiale |
|---------|-----------------|
| Bots parallèles | 8 |
| Transitions par update | 4096 |
| Epochs PPO | 3 |
| Mini-batches | 8 |
| Interval checkpoint | 30 min ou 5 updates |
| Interval évaluation | 1 checkpoint |

## Format Fichier Transition (JSONL)
Une ligne par transition:
```json
{"obs":"base64float32","action":123,"mask":"base64uint8","logProb":-1.23,"value":0.45,"reward":0,"done":false,"gameId":"g1","playerId":"pA","turn":2}
```
Compression recommandée (gzip) après rotation.

## Structure Répertoires
```
logs/
  raw/ (serveur + bots)
  processed/
 data/
  rollouts/
    episode_*.jsonl
runs/
  ppo_YYYYMMDD_HHMMSS/
    config.json
    model.ckpt
    optimizer.pt
    stats.json
models/
  best_model/ (symlink → runs/ppo_...)
reports/
  index.html
metrics/
  aggregates.json
```

## Gestion des Seeds
- Seed global: passé à orchestrator.
- Seed par jeu: hash(seed_global, gameIndex).
- Seed NN init: stocké dans `config.json` pour reproductibilité.

## Contrôles Qualité Automatiques
| Vérif | Méthode |
|-------|---------|
| Dimensions obs | assert shape à l'encodage |
| Masque cohérent | aucune action illégale jouée (compteur) |
| Absence NaN | scan vecteurs avant écriture |
| Distribution actions | histogramme périodique (drift detection) |

## Stratégie Versionnement Modèle
- Chaque checkpoint numéroté (timestamp).
- Fichier `stats.json`: {"update": n, "episodes": m, "winRateRandom": x, ...}.
- Promotion: copie dans `models/best_model/` + écrire `models/manifest.json`.

## Évaluation Elo Simplifiée
- K=32 initial.
- Elo initial = 1000 pour tous.
- Mises à jour pairwise vs baseline + best précédent.

## Déploiement Inference (Phase ultérieure)
- Service Node.js charge `best_model` (fichier JSON poids ou ONNX).
- Endpoint local ou module direct.
- Batch inference possible (pile actions en attente <50ms).

## Sécurité (Futur)
- Auth tokens pour bots.
- Limiter spam events (rate limit).
- Validation côté serveur des transitions (anti injection).

## Prochaines Étapes
1. Créer encodeur état + masque (stub).
2. Implémenter collector (écriture JSONL + rotation).
3. Script self-play spawn bots + collecte.
4. Prototype learner (dummy network) pour vérifier pipeline flux.
5. Ajouter tests qualité (#transitions, dimension, pas d'action illégale).

Fin du document.
