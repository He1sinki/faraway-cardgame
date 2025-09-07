# TODO – Feuille de route IA Self‑Play & RL pour Faraway Card Game

Objectif global: développer, entraîner et intégrer une IA capable de se connecter comme un client réseau standard, jouer en self-play, apprendre (RL), s’améliorer progressivement et fournir des logs exploitables à chaque étape du pipeline.

---

## Table des matières
1. Phase 0 – Vision & Portée
2. Phase 1 – Audit & Préparation Technique
3. Phase 2 – Instrumentation & Logging Fondations
4. Phase 3 – Client Bot (Interface Réseau)
5. Phase 4 – Modélisation de l’État & Wrapper Environnement RL
6. Phase 5 – Génération de Trajectoires (Self-Play Simulation)
7. Phase 6 – Boucle d’Entraînement RL (ex: PPO)
8. Phase 7 – Évaluation, Benchmarks & Validation Continue
9. Phase 8 – Debug & Analyse Approfondie
10. Phase 9 – Optimisation (Perf / Qualité / Coût)
11. Phase 10 – Intégration Produit & Opérations
12. Phase 11 – Durabilité, Sécurité & Roadmap Évolutive
13. Annexes – Structures de données & Formats de logs

---

## Phase 0 – Vision & Portée
### Objectifs fonctionnels
- IA joue via réseau (WebSocket / HTTP) sans accès interne privilégié.
- Self-play massif reproductible.
- Amélioration mesurable (Elo, win rate, reward moyenne).
- Pipeline entraînement scriptable & automatisable (CI / tâche cron).
- Observabilité: logs bruts + agrégats + visualisation.

### Livrables
- `docs/protocol.md` : protocole réseau (messages entrants/sortants documentés).
- `docs/ai_state_space.md` : définition state/action/reward.
- `docs/rl_pipeline.md` : architecture (collect → buffer → train → eval → deploy).

### Checkpoint
- Revue: portée validée + critères de succès chiffrés (ex: >60% win vs baseline scripted). 

---

## Phase 1 – Audit & Préparation Technique
### 1.1 Cartographie du code existant
- Lire `index.js` (serveur) & identifier points de connexion client (init, join game, actions, fin de manche).
- Lister événements réseau (ex: `GAME_STATE`, `PLAY_CARD`, `RESULT`, etc.).
- Identifier règles implicites à extraire (tour de jeu, limitations, scoring).

### 1.2 Normalisation protocole
- Ajouter (si manquant) un identifiant de version du protocole dans messages.
- Définir schémas JSON (TypeScript interfaces) dans `class/` ou nouveau dossier `protocol/`.

### 1.3 Environnement d’exécution RL
- Choisir stack entraînement: Node.js + (optionnel) Python pont gRPC/REST ou full JS (ex: TensorFlow.js). Recommandation: Python pour diversité libs RL.
- Décider mécanisme d’orchestration multi-process (Node serveur + N bots + Python learner).

### 1.4 Scripts d’infrastructure
- Ajouter scripts npm: `npm run server`, `npm run bot`, `npm run selfplay`, `npm run train`.
- Créer `scripts/` : shell ou Node pour lancer lots de parties.

### Checkpoints
- Test manuel: lancer serveur + 2 clients humains + 1 bot stub (ne fait qu’attendre). 
- Validation protocole: JSON schema pass (ajouter test Jest). 

---

## Phase 2 – Instrumentation & Logging Fondations
### 2.1 Choix outil logging
- Utiliser `pino` ou `winston` côté serveur, config JSON line.
- Format commun champ obligatoire: `ts, level, scope, gameId, playerId, action, payload, latencyMs`.

### 2.2 Logger côté serveur
- Ajouter middleware émission/réception messages (hook central) → log normalisé.
- Masquer données sensibles (hash si nécessaire).

### 2.3 Logger côté bot
- Module `logger.js` dédié: niveaux (debug, info, warn, error, traceDecision).
- Pour chaque décision: log features extraites + action choisie + distribution de proba (policy) + value estimate.

### 2.4 Stockage & rotation
- Dossier `logs/raw/` (JSONL). 
- Script `scripts/compress_logs.js` (archivage gzip > 24h).

### 2.5 Métriques agrégées
- Mini collecteur: parse JSONL -> produit `metrics/latest.json` : winRate, meanReward, avgTurnTime.

### Checkpoints
- Lancement d’une partie -> vérifier présence des 3 familles de logs: serveur / bot / métriques.
- Test unitaire: parseur de logs ne crash pas si ligne corrompue.

---

## Phase 3 – Client Bot (Interface Réseau)
### 3.1 Connexion
- Implémenter client WebSocket (`/bot/bot_client.js`).
- Gestion reconnexion + backoff.

### 3.2 Gestion session / lobby
- Méthodes: joinGame(), createGameIfNone(), handleStart().
- Attribution playerId / seat.

### 3.3 Machine d’états bot
- États: INIT → WAITING → IN_GAME → TERMINATED.
- Timeout watchdog (si pas de state update > X sec -> ping / reconnect).

### 3.4 File d’événements
- Normaliser en objets internes: { type, data, ts }.
- Buffer court-terme pour features (dernier N états).

### 3.5 Interface actions
- Méthodes asynchrones: playCard(cardId), pass(), etc.
- Validation locale (éviter actions illégales loguées).

### 3.6 Tests
- Mock serveur (ou sandbox) pour simuler 1 partie rapide.

### Checkpoints
- Script: lancer 4 bots → partie complète réussie sans crash.
- Couverture test >70% modules protocole & machine états.

---

## Phase 4 – Modélisation de l’État & Wrapper Environnement RL
### 4.1 Définir observation
- Décider représentation tensorielle: cartes main, visible board, scores, tours restants.
- Encoder masques d’actions (actions valides = 1/0).

### 4.2 Reward design
- Reward terminal: +1 victoire, 0 égalité, -1 défaite (ou scaling par score diff).
- Rewards denses optionnels (ex: progression objectif) – à expérimenter plus tard.

### 4.3 Wrapper
- Créer `rl/env.py` (si stack Python) ou `rl/env.js` sinon.
- Fonctions: reset(), step(action), get_observation(), legal_actions().

### 4.4 Synchronisation réseau vs step
- Stratégie: mode asynchrone (listener) + file pour step() qui attend prochain state stable.
- Timeout & retry sur latences.

### 4.5 Sérialisation dataset
- Stockage transitions: (obs, action, logProb, reward, done, value, mask) en `.npz` ou parquet.

### 4.6 Tests
- Test: encode/decode observation stable (hash).
- Test: masque actions correspond bien aux actions légales reçues.

### Checkpoints
- Génération 1k transitions dummy -> aucune incohérence (no NAN, no mismatch dimensions).

---

## Phase 5 – Génération de Trajectoires (Self-Play Simulation)
### 5.1 Orchestration self-play
- Script `scripts/selfplay.js`: spawn N bots + registre games parallèles.
- Paramètres: --games, --max-parallel, --seed.

### 5.2 Buffer de collecte
- Producer (bots) → queue (ex: Redis, simple FS append) → Consumer (learner).
- Format standard JSONL ou binaire (protobuf si volume élevé).

### 5.3 Gestion seeds
- Seed global + dérivées par (gameId, playerIdx).
  - Implémenté: `utils/prng.js`, dérivation `runSeed -> gameSeed -> playerSeed`.
  - Orchestrateur exporte `RUN_SEED`, bot enrichit chaque transition (`runSeed, gameSeed, playerSeed`).
  - Doc: `docs/seeding.md`.

### 5.4 Contrôle qualité data
- Vérifs périodiques: distribution actions, % invalid moves (doit tendre à 0), longueur moyenne parties.
  - Implémenté script: `scripts/quality_check.js` (commande: `npm run quality`).
  - Produit: `metrics/quality_latest.json` + `metrics/quality_latest.md` + historisation.
  - Indicateurs: distribution top actions, entropie, nullAction%, reward stats, seeds unicité, backlog queue.

### 5.5 Versioning des policy checkpoints
- Dossier `runs/` (déjà présent) → sous-dossiers timestamp + `model.ckpt`, `metadata.json`, `stats.json`.
  - Script ajouté: `scripts/checkpoint_versioning.js` (commande: `npm run checkpoint`).
  - Génère dossier `ppo_YYYYMMDD_HHMMSS/` avec copie du dernier `ppo_policy_*.pt` -> `model.ckpt` + `stats.json` + `metadata.json` (git commit, runSeed, hash config).
  - Commande combinée: `npm run ppo:versioned` (train + versioning).

### Checkpoints
- Générer 10 parties → fichier transitions non vide.
- Générer 500 parties → script stats produit agrégats cohérents.

---

## Phase 6 – Boucle d’Entraînement RL (PPO recommandé)
### 6.1 Choix lib
- Python: `stable-baselines3` PPO ou impl custom si besoin de masques (adapter).
- JS option: `tfjs` (moins mature pour PPO multi-env avec masques).

### 6.2 Implémentation pipeline
- Collect (Phase 5) → Preprocess (normalisation obs, advantage calc GAE) → PPO update → Save checkpoint.

### 6.3 Hyperparams init (à mettre dans `config/ppo.yaml`)
- learning_rate: 3e-4
- gamma: 0.995
- gae_lambda: 0.95
- clip_range: 0.2
- entropy_coef: 0.01
- value_coef: 0.5
- batch_size / mini-batches selon volume transitions.

### 6.4 Gestion masques actions
- Adapter policy pour appliquer logits = -inf sur actions illégales avant softmax.

### 6.5 Scheduler & early stop
- Condition: plateau winRate validation sur 3 eval consécutives.

### 6.6 Persist & reprise
- Sauvegarder `optimizer_state`, `policy_state`, `scaler_state` (si normalisation).

### 6.7 Tests
- Test unitaire advantage calc (comparer expected calcul manuel).
- Test overfit mini-batch (policy doit apprendre séquence triviale).

### Checkpoints
- Premier checkpoint `runs/ppo_YYYYMMDD_HHMM/` créé.
- Loss policy diminue premières itérations.
- Win rate vs random > baseline aléatoire après X itérations (à fixer).

---

## Phase 7 – Évaluation, Benchmarks & Validation Continue
### 7.1 Matchs vs Baselines
- Opposants: Random, Heuristique simple (script), Dernier checkpoint stable.

### 7.2 Système d’Elo interne
- Implémenter calcul Elo après chaque batch d’évaluations.
- Stocker historique `eval/elo_history.csv`.

### 7.3 Tableaux de bord
- Générer `reports/index.html` (template simple) avec: courbe winRate, reward moyenne, longueur partie.

### 7.4 Regression tests
- Si perf < (baseline - tolérance) -> marquer build rouge.

### 7.5 Visualisation parties
- Sauvegarder replays (suite d’événements) -> viewer (Vue.js composant) pour rejouer.

### Checkpoints
- Script `npm run eval` produit rapport HTML.
- Diff entre 2 checkpoints visible sur graphique Elo.

---

## Phase 8 – Debug & Analyse Approfondie
### 8.1 Trace décisionnelle
- Pour échantillon de parties: log top-k actions + proba.

### 8.2 Analyse erreurs fréquentes
- Agréger cas où action choisie ≠ action heuristique « forte ».

### 8.3 Détection anomalies
- Script: scanner NaN, explosion gradients, value loss >> policy loss.

### 8.4 Profils performance
- Mesurer latence moyenne inference → objectif < X ms.

### 8.5 Outils
- Notebook exploratoire (stat distrib cartes jouées).

### Checkpoints
- Rapport anomalies vide ou justifié.
- Latence inference respect objectif.

---

## Phase 9 – Optimisation (Perf / Qualité / Coût)
### 9.1 Parallelisme
- Multi-process self-play (pool workers).
- Batch inference (regrouper requests sur 1 forward pass).

### 9.2 Compression modèle
- Pruning / quantization (post-training) si besoin côté prod.

### 9.3 Tuning hyperparams
- Grid ou Bayesian (outil: optuna) sur sous-échantillon.

### 9.4 Récompenses façonnées
- Tester reward shaping & comparer courbes apprentissage.

### 9.5 Mémoire & IO
- Passer JSONL → binaire (parquet/protobuf) si >10^7 transitions.

### Checkpoints
- Temps pour générer 10k transitions réduit de X%.
- Taille stockage / transition réduite.

---

## Phase 10 – Intégration Produit & Opérations
### 10.1 API de sélection modèle
- Endpoint serveur pour charger `current_model`.
- Hot reload sécurisé (verrou).

### 10.2 Feature flags
- Activer/désactiver IA vs joueurs humains.

### 10.3 Monitoring prod
- Export métriques Prometheus (winRate live, latence inference, erreurs réseau).

### 10.4 CI/CD
- Pipeline: lint + tests + self-play court (smoke) + eval rapide.

### 10.5 Gestion versions modèles
- Tag semantic: `ai-vMAJOR.MINOR.PATCH` + changelog.

### Checkpoints
- Déploiement nouvelle version IA sans downtime.
- Rollback possible (charger checkpoint N-1).

---

## Phase 11 – Durabilité, Sécurité & Roadmap Évolutive
### 11.1 Sécurité
- Limiter commandes bot (anti triche: même interface que client normal).
- Rate limit & signature messages.

### 11.2 Observabilité long terme
- Archivage S3 / Glacier (ou équivalent) des replays + checkpoints.

### 11.3 Gouvernance modèle
- Documenter changements conceptuels (reward, state space) -> migration script.

### 11.4 Roadmap futures features
- Multi-agent coordination (si variantes équipe).
- Imitation learning sur replays humains.
- Curriculum (augmenter difficulté progressive).

### 11.5 End-of-life plan
- Critères pour déprécier un modèle.

---

## Annexes – Structures & Formats
### A.1 Exemple message log bot (JSONL)
```json
{"ts": 1731000000123, "scope": "decision", "gameId": "g123", "playerId": "p2", "turn": 5, "obsHash": "af93c1", "legalActions": ["PLAY_12","PLAY_15","PASS"], "policyProbs": {"PLAY_12":0.55,"PLAY_15":0.30,"PASS":0.15}, "chosen":"PLAY_12", "value":0.12}
```

### A.2 Transition RL
```
obs: Float32[N]
action: int
mask: Float32[A]
logProb: float
reward: float
done: bool
value: float
nextObs: Float32[N]
```

### A.3 Schéma répertoire `runs/`
```
runs/
  ppo_YYYYMMDD_HHMMSS/
    config.json
    model.ckpt
    optimizer.pt
    stats.json
    eval/
      report.html
      elo_history.csv
```

### A.4 Checklist Qualité (à répéter chaque release IA)
- [ ] Tests protocole OK
- [ ] Génération self-play > X parties sans erreur
- [ ] WinRate vs baseline >= seuil
- [ ] No NaN / divergences
- [ ] Latence inference < budget
- [ ] Logs décisionnels présents
- [ ] Rapport évaluation archivé

### A.5 Script minimal self-play (pseudo)
```pseudo
for i in range(num_games):
  game = create_game()
  bots = spawn_bots(game)
  while not game.finished:
     for b in bots if b.turn:
        obs = b.observe()
        action, logProb, value = policy.sample(obs, mask)
        send_action(action)
        buffer.store(obs, action, logProb, value, reward=0)
  finalize_rewards(buffer)
```

---

## Prochaines actions immédiates (Sprint 0)
1. Documenter protocole existant (`docs/protocol.md`).
2. Ajouter logger serveur + format JSON line.
3. Créer client bot minimal qui rejoint une partie et log les états reçus.
4. Définir première version observation + masque actions.
5. Générer 10 parties self-play random et stocker transitions brutes.

Une fois cela atteint: passer à la Phase 6 (intégration PPO) avec un pipeline de collecte stable.

---

## Indicateurs de succès initiaux
- M0: Self-play random stable (aucune erreur réseau) & logs complets.
- M1: PPO apprend (winRate random >55%).
- M2: Heuristique battue (>60%).
- M3: Intégration continue + dashboard automatisé.

---

Fin du document.
