# Phase 2.1 – Choix Outil & Spécification Logging
Date: 2025-09-07

## Objectif
Mettre en place une base de logging structurée JSON line côté serveur & bots avec un format commun pour l'observabilité et l'agrégation.

## Outil
- Bibliothèque: `pino` (performant, JSON natif, faible overhead).
- Option dev: `pino-pretty` pour lecture locale.

## Format Log Canonique
Champs standards (clé manquante -> null omis côté analytics si absent):
| Champ | Type | Description |
|-------|------|-------------|
| ts | number | Epoch ms (injecté via fonction timestamp pino) |
| scope | string | 'server' | 'bot' | sous-système |
| kind | string | Catégorie (decision, lifecycle, event) – bots surtout |
| gameId | string|null | Identifiant salle/partie |
| playerId | string|null | Socket id joueur (si applicable) |
| action | string|null | Nom action logique (playCard, shopChooseCard, *_reject) |
| phase | string|null | Phase jeu lors de l'événement |
| latencyMs | number|null | Future mesure latence (placeholder) |
| payload | object|null | Détails additionnels |

## Fichiers Créés / Modifiés
- `logger/serverLogger.js` : logger serveur + helper `logEvent`.
- `logger/botLogger.js` : logger bot + helpers `logDecision`, `logLifecycle`.
- `scripts/compress_logs.js` : compression >24h .log → .gz.
- `scripts/aggregate_metrics.js` : agrégation simple (compte décisions, actions) → `metrics/latest.json`.
- `index.js` : instrumentation rejets & succès actions joueur.
- `package.json` : scripts `logs:compress`, `logs:agg`, dépendances pino (+ pino-pretty dev).

## Usage
```bash
npm run server
# Dans un autre terminal
npm run bot
# Inspecter logs
tail -f logs/raw/server.log | npx pino-pretty
```

## Prochaines Étapes (Phase 2.2+)
1. Étendre logging aux transitions de phase (`roomUpdate` avant/après changement phase).
2. Ajouter mesure latence (horodatage emission -> réception ack côté bot).
3. Introduire logs décisionnels détaillés (policy distribution) quand policy sera disponible.
4. Tests robustesse parseur (lignes corrompues).

Fin.
