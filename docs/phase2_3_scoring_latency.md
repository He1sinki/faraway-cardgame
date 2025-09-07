# Phase 2.3 – Scoring Détaillé, stateSeq & Acks
Date: 2025-09-07

## Objectif
Améliorer observabilité en fin de partie (score détaillé par joueur), ajouter séquence d'état incrémentale pour détecter pertes d'updates, et introduire un mécanisme d'ack côté client pour latence future.

## Ajouts
1. `stateSeq` : entier incrémenté avant chaque émission `update`. Injecté dans payload.
2. Logging scoring:
   - `score_breakdown` (un par joueur) payload = `{ total, round[] }`.
   - `endGameScore` (récap global: winners, scores array).
3. Acknowledgement bot:
   - Bot émet `updateAck { stateSeq, clientTime }`.
   - Serveur log `updateAck` pour analyse latence (Round Trip partiel). 
4. Incrément `stateSeq` sur toutes sorties `update` (y compris démarrage & fin).

## Cas d'Usage
- Détection updates manquants: séquence non contiguë côté bot → alerte.
- Analyse scoring: corréler séquence décisions vs points par carte (round array future expansion).
- Préparation latence: future Phase 2.4 ajouter `serverSent` + calcul RTT.

## Impacts Fichiers
- `index.js`: ajout stateSeq, logs scoring, gestion `updateAck`.
- `scripts/bot.js`: émission `updateAck`.
- Document courant.

## Prochaines Améliorations (2.4 Suggerées)
1. Ajouter `serverSent` timestamp dans chaque `update` + calcul RTT à l'ack.
2. Ajout compteur invalid moves par joueur.
3. Export latence moyenne dans `aggregate_metrics.js` (requires parsing `updateAck`).
4. Enrichir `score_breakdown` avec contributions par ressource.

Fin.
