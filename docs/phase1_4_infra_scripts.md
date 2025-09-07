# Phase 1.4 – Scripts d'Infrastructure (Livrables)
Date: 2025-09-07

## Objectif
Fournir des commandes normalisées pour lancer serveur, bot(s), sessions de self-play et boucle d'entraînement RL.

## Scripts Créés
| Script npm | Commande | Description |
|------------|----------|-------------|
| server | node scripts/server.js | Lance uniquement le serveur de jeu Node.js |
| bot | node scripts/bot.js | Lance un bot stub (connexion + join/create room) |
| selfplay | node scripts/selfplay.js | Orchestrateur multi-bots (var env BOTS=n) |
| train | bash scripts/train.sh | Démarre le learner Python (placeholder) |

## Fichiers
- `scripts/server.js` : wrapper simple du serveur.
- `scripts/bot.js` : client Socket.IO minimal (Phase 3: logique décisionnelle).
- `scripts/selfplay.js` : spawn N processus bot (“BOTS” ou argument CLI).
- `scripts/train.sh` : lance `rl/learner.py` (_future_: paramètres hyperparams).

## Utilisation
```bash
npm run server            # serveur seul
npm run bot               # un bot stub
BOTS=4 npm run selfplay   # 4 bots en parallèle
npm run train             # boucle learner (dummy)
```

## Prochaines Étapes
1. Phase 2: instrumentation logging (ajouter pino + hooks message).
2. Phase 3: implémenter machine d'états et actions légales dans `bot.js` ou module dédié.
3. Ajouter tests Jest pour valider que scripts se lancent sans exit code !=0.

Fin.
