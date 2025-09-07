# Phase 5.2 – Buffer de Collecte (Queue disque)

Objectif: Découpler production (bots self-play) et consommation (pré-traitement / entraînement RL) via un buffer persistant simple, tolérant aux crash, inspectable, sans dépendance externe.

## Motivations
- Éviter backpressure bloquant sur bots si preprocessing plus lent.
- Permettre plusieurs consumers futurs (ex: un pour stats, un pour RL).
- Assurer atomicité des lots pour faciliter reprise après crash.

## Architecture
```
Bots -> QueueProducer (.part -> .ready) -> queue_consumer -> transitions JSONL consolidés -> pipeline RL (dedup / normalize / export)
```

## Format lot (.ready)
- Fichier texte UTF-8.
- 1 transition JSON par ligne.
- Terminologie: *lot* = chunk de transitions produit par un bot avant rotation.

## Transitions (champ minimal)
```
{"obs":[...],"mask":[...],"action":123,"reward":0.0,"done":false,"gameId":"g1","playerId":"pA","seq":42}
```

## Stratégie rotation producteur
- Paramètres: maxTransitions (500), maxBytes (~512KB) – ajustables.
- À dépassement d'un seuil → fermeture du flux puis rename atomique `.part` -> `.ready`.

## Consommateur
- Polling (1s) des fichiers `.ready`.
- Déplacement vers `processing/` pour exclure duplication.
- Lecture + append en mémoire.
- Flush vers `dataset/transitions/queue_transitions_<TS>.jsonl` avec rollover (MAX_OUT_LINES=5000).
- Archive: renommage `.ready` -> `.done` dans `archive/`.

## Cas Crash & Reprise
- Crash producteur: fichier `.part` laissé tel quel → ignoré par consumer (non terminé). Redémarrage producteur peut soit réutiliser soit recréer.
- Crash consumer après rename vers `processing/`: fichier restera en processing → script de maintenance peut le renvoyer en `incoming/` ou finaliser.

## Évolutions Futures
- FS Watch (fs.watch / chokidar) pour réduire latence.
- Compression gzip lors archivage (.done.gz).
- Checksum (SHA256) par lot pour intégrité.
- Format binaire (flatbuffers / protobuf) si >10^7 transitions.
- Multi-consumers avec lock fichier (fcntl advisory) ou directory-based locking.

## Intégration Pipeline
- Nouvelle commande: `npm run selfplay+queue` (lance consumer + selfplay orchestrator).
- Fichiers générés: `dataset/transitions/queue_transitions_<TS>.jsonl` utilisables par scripts existants (dedup, normalize...).

## Monitoring Minimal
- Logs `[queue_consumer] appended X lines -> file`.
- Métriques possibles (Phase 5.4): throughput lignes/sec, backlog (# .ready), taille moyenne lot.

Fin.
