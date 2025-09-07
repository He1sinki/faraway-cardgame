# Phase 2.2 – Instrumentation Étendue & Transitions
Date: 2025-09-07

## Objectif
Tracer systématiquement les événements structurants de la partie (connexion sockets, création/join de rooms, transitions de phases, mises à jour d'état) pour permettre reconstitution de chronologies et diagnostics.

## Ajouts Clés
- Transitions de phase loguées: `phase_transition` avec `{from,to,turn}`.
- Mises à jour régulières: `state_update` (par phase) incluant `turn`.
- Événements sockets: `socket_connected`, `socket_disconnected`.
- Lobby: `room_created`, `room_joined`, `room_join_reject` (motif), `startGame_request`, `startGame_reject`.
- Début partie: `beginGame_init`, `beginGame_started`.

## Couverture
| Domaine | Actions Loggées |
|---------|-----------------|
| Connexion | connect / disconnect |
| Lobby | create / join / rejects / startGame |
| Gameplay | transitions phase, actions joueur (Phase 2.1), updates état |
| Fin | transition vers end + score (à ajouter Phase 2.3) |

## Format Rappel
Chaque ligne JSON contient: `ts, scope, action, gameId, playerId, phase?, payload{...}`.

## Prochaines Étapes (Phase 2.3 Suggestion)
1. Log détaillé scoring final: distribution contributions (wonders, sets, fame par carte).
2. Ajout ID interne incrémental par update (`stateSeq`) pour détection pertes de messages.
3. Latence: timestamp émission serveur vs réception ack bot (introduire event ack). 
4. Ajout compteur rejeu d'action illégale par joueur.

## Vérification Rapide
Lancer:
```bash
npm run server &
BOT_ID=1 npm run bot &
```
Observer `logs/raw/server.log` pour suite d'events cohérente.

Fin.
