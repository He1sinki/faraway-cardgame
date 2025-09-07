# Phase 4.4 – Wrapper Environnement Réseau RL

Objectif: fournir une interface type Gym pour interagir avec le serveur de jeu via WebSocket tout en gérant la synchronisation (attente d'un nouvel état après action) et la construction cohérente (obs, mask).

## Fichier principal
`rl/env.js` exporte `NetworkEnv` avec les méthodes:
- `reset()` -> (obs, mask, info)
- `step(actionIndex)` -> (obs, mask, reward, done, info)

## Détails d'implémentation
- Connexion via `socket.io-client` (URL configurable `SERVER_URL`).
- Création / join automatique d'une room (critère: room <4 joueurs, pas encore en cours) sinon création.
- Lancement automatique de la partie si >=2 joueurs.
- Réception des events: `rooms`, `roomJoined`, `joinedRoom`, `beginGame`, `update`.
- Chaque `update` est acquitté avec `updateAck` (latence potentielle mesurable plus tard).
- Synchronisation `step`: envoie l'action réseau correspondante puis attend soit un nouvel état soit le timeout.

## Mapping actions
Réutilise `action_space.js` (R regions, S sanctuaries, padding jusqu'à 256). Translittération:
- `[0, R)` -> `playCard(cardId)`
- `[R, 2R)` -> `shopChooseCard(cardId - R)`
- `[2R, 2R+S)` -> `sanctuaryChoose(cardIdRelative)` (offset +1 si protocole démarre à 1)
- Autres / padding -> NOOP (aucun envoi réseau)

## Reward
- Shaping léger: pendant la phase `play`, ajout `(turn/8)*coeff` aligné avec bot existant.
- Reward terminal: différence (score_joueur - moyenne_scores) à la fin (`phase === end`).
- Le `step()` retourne actuellement le cumul (peut être modifié en reward incrémental si nécessaire plus tard).

## Gestion Timeout
- `timeoutMs` (défaut 5000ms). Si aucune mise à jour reçue après action, on renvoie l'état courant (`stalled: true`).

## Test basique
`rl/test_env_basic.js` script simple qui:
1. Reset l'env.
2. Fait quelques steps aléatoires.
3. Affiche reward, phase, stalled.

Script npm ajouté:
```json
"env:test": "node rl/test_env_basic.js"
```

## Limitations & Next Steps
- Reward incrémental vs cumul à clarifier selon pipeline PPO (souvent reward step = delta). Facile à ajuster.
- Pas encore de seed déterministe (dépend serveur). Ajouter champ `seed` dans protocole pour reproduction.
- Pas de gestion multi-épisodes consécutifs (il faudra detect fin puis relancer reset automatique pour collect en continu).
- Normalisation observation non incluse (Phase 6 préprocessing).
- Pas de gestion d'erreurs réseau avancée / backoff multi-niveaux.

## Qualité & Invariants
- Dimensions obs/mask alignées avec `encode_observation.js`.
- Toute action illégale remplacée par NOOP côté env (sécurité). On pourra plutôt lever une exception en mode debug.

---
Fin Phase 4.4.
