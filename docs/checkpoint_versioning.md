# Phase 5.5 – Versioning des Checkpoints

Objectif: assurer traçabilité et archivage systématique des poids de policy et statistiques d'entraînement.

## Structure cible
```
runs/
  ppo_YYYYMMDD_HHMMSS/
    model.ckpt        # copie du dernier ppo_policy_*.pt
    stats.json        # copie du dernier ppo_stats_*.json (si présent)
    metadata.json     # meta (git commit, runSeed, hash config, snippet config)
```

## Génération
- Script: `npm run checkpoint`
- Pipeline combinée après entraînement: `npm run ppo:versioned`

## Metadata
Champs:
- createdAt (epoch ms)
- runSeed (si défini dans env RUN_SEED)
- gitCommit (abrégé)
- configHash (sha1 sur contenu `rl/config/ppo.yaml`)
- ppoConfigSnippet (premières lignes du yaml pour lisibilité rapide)
- source (phase / provenance script)

## Bonnes pratiques futures
- Ajouter `policyVersion` incrémental.
- Sauvegarder `optimizer.pt` et `scheduler.pt` pour reprise exacte.
- Signer cryptographiquement (sha256) les artefacts pour intégrité.
- Compression optionnelle (zstd) pour stockage long terme.

## Intégration CI/CD (à venir)
1. Entraînement court (smoke) -> `ppo:versioned`
2. Éval -> produire `eval/report.html`
3. Promotion manuelle ou automatique du checkpoint vers `current/` symlink.

Fin.
