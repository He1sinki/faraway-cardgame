# Phase 2.5 - Agrégation avancée & Observabilité

## Objectifs
Étendre la couche métriques pour:
- Latence réseau (RTT update -> ack) : moyenne, p50, p90, p99, max.
- Invalid moves (instantanés + ratio par 100 actions).
- Durées des phases (play, shop, sanctuary, end).
- Distribution des actions serveur.
- Throughput (acks / seconde).
- Export double: JSON structuré + résumé Markdown lisible.
- Historisation des snapshots.

## Fichiers clés
- `scripts/aggregate_metrics.js` : nouvelle version enrichie.
- `metrics/latest.json` : snapshot complet courant.
- `metrics/history/*.json` : archives successives.
- `metrics/latest.md` : résumé humain.

## Champs JSON principaux
| Champ | Description |
|-------|-------------|
| globalLatency | Statistiques agrégées toutes parties confondues. |
| perGame[gameId].latencyStats | Statistiques latence par partie. |
| perGame[gameId].invalidMoves | Total invalid moves (inclut rejects + résumé fin). |
| perGame[gameId].phaseDurations | Durées cumulées par phase (ms). |
| perGame[gameId].throughputAckPerSec | updateAck / durée (s). |
| invalidPer100Actions | Normalisation global invalid/ actions * 100. |

## Mécanisme
1. Lecture de tous les fichiers `logs/raw/*.log` (format pino JSONL).
2. Ingestion ligne par ligne: classification des actions.
3. Calcul post-traitement: durées de phases via transitions successives, latency percentiles, ratios.
4. Écriture des sorties.

## Ajouts futurs (suggestions)
- Export parquet/arrow pour entraînement ML.
- Heatmap temporelle latence (bucket 1s).
- Corrélation invalidMoves vs latence.
- Alerte (exit code !=0) si p99 > seuil.

## Commandes
```bash
npm run logs:agg
```

## Intégration pipeline
À lancer après chaque session self-play (ex: en fin de `scripts/selfplay.js`) pour produire un snapshot exploitable par la phase d'entraînement RL et le monitoring continu.

---
Phase 2.5 complétée.
