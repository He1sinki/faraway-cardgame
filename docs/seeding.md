# Phase 5.3 – Gestion & Dérivation des Seeds

Objectif: Rendre la génération de données self-play reproductible et traçable.

## Concepts
- runSeed: seed global passé à l'orchestrateur (`--seed`).
- gameSeed: dérivé (runSeed, gameId) pour toute la partie.
- playerSeed: dérivé (gameSeed, playerIndex) pour chaque agent.

## Formules
```
gameSeed = HashCombine(runSeed, Hash(gameId))
playerSeed = HashCombine(gameSeed, playerIndex)
```
Fonctions implémentées dans `utils/prng.js`.

## Utilisation runtime
- Orchestrateur (`scripts/selfplay.js`) exporte RUN_SEED et SEED par bot (SEED=runSeed+botIndex) dans env.
- Bot dérive gameSeed lors de `beginGame` puis playerSeed quand il connaît son index.
- RNG interne: `makeRNG(playerSeed)` (mulberry32) → stable.

## Trace dans les données
- Chaque transition inclut: `runSeed, gameSeed, playerSeed`.
- Fichier épisode (`episode_writer`) inclut ces seeds dans `finalInfo`.

## Reproductibilité
Pour rejouer une collecte:
1. Relancer `selfplay.js --seed <runSeed>`
2. S'assurer que version du code & config identiques (tag git / hash commit à logguer ultérieurement).
3. Les transitions produites auront mêmes seeds et donc mêmes séquences pseudo-aléatoires (si serveur déterministe).

## Limites actuelles
- Si le serveur introduit son propre aléatoire non seedé, la trajectoire peut diverger.
- Hash(gameId) dépend du format d'ID, un changement de génération d'ID rompra la stabilité.

## Évolutions proposées
- Logger `gitCommit` dans finalInfo.
- Exposer endpoint serveur pour forcer un seed global côté règles.
- Enregistrer `policyVersion` dans chaque transition quand on passera à l'inférence non-random.

Fin.
