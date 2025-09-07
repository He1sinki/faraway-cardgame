## Phase 5.1 – Orchestrateur Self-Play

Objectif: lancer automatiquement plusieurs bots, surveiller la production d'épisodes et atteindre un nombre cible avec contrôle de parallélisme, seeds et rotation de lots.

### Script principal
`scripts/selfplay.js`

### Paramètres CLI
--bots N            Nombre total de bots à utiliser (vague) (def = BOTS env ou 4)
--episodes M        Nombre total d'épisodes à produire (def = TARGET_EPISODES env ou 20)
--max-parallel P    Nombre maximum de bots simultanés (def = N)
--seed S            Seed base (def = timestamp modulo 1e9)
--batch-size B      Taille d'un lot avant rotation (nécessite --rotate)
--rotate            Active rotation: episodes écrits dans `dataset/episodes/batch_<k>`
--quiet             Réduction logs console

### Comportement
1. Spawne jusqu'à `max-parallel` bots.
2. Chaque bot écrit ses épisodes (JSON) dans `EPISODE_DIR` (redirigé si rotation).
3. Le script poll le dossier courant (ou batch) toutes les 2s, incrémente un compteur pour nouveaux fichiers.
4. Quand `episodes` atteint le seuil -> arrêt propre (SIGINT aux bots, sortie code 0).
5. Rotation: après chaque multiple de `batchSize`, incrémente `batchIndex` et crée nouveau dossier.

### Seeds
Seed de base + index bot (`seed + botIdx`) exposée en env `SEED` (future utilisation policy déterministe).

### Intégration Bot
`scripts/bot.js` lit `EPISODE_DIR` via env pour écrire dans le lot actif.

### Exemple
```
node scripts/selfplay.js --bots 8 --max-parallel 4 --episodes 120 --seed 12345 --rotate --batch-size 40
```

### Sortie Monitoring
`episodes=E/Target active=A rate=R ep/min ETA=T m`

### Prochaines étapes (5.2+)
- Buffer/queue streaming (JSONL direct) pour éviter scan disque.
- Collecte métriques distribution actions / invalid moves.
- Ajout redémarrage policy (hot reload) entre batches.

---
Fin Phase 5.1.