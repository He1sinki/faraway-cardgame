# Phase 4.5 – Sérialisation Dataset RL

Objectif: disposer d'un format efficace pour alimenter l'entraînement (offline ou PPO) sans repasser par JSON pour chaque batch.

## Approche
Plutôt qu'écrire directement un `.npz` (nécessite Python / lib supplémentaire côté Node), on produit un *lot binaire structuré* puis on laisse un script Python regrouper si besoin en `.npz`.

## Format produit
Dossier: `data/binary/batch_<timestamp>/`
- `obs.float32.bin` : concaténation en little-endian des vecteurs observation (Float32)
- `actions.int32.bin` : actions (Int32 little-endian)
- `rewards.float32.bin` : rewards (Float32)
- `masks.uint8.bin` : masques actions (Uint8, taille = maskDim par transition)
- `dones.uint8.bin` : (0/1)
- `meta.json` : `{ count, obsDim, maskDim, episodes, steps, createdAt }`

Chaque transition occupe: `obsDim*4 + 4 + 4 + maskDim + 1` octets (hors meta), ce qui réduit considérablement la surcharge par rapport à JSONL.

## Scripts
- `dataset/npz_writer.js` : utilitaire d'écriture bas niveau.
- `scripts/export_npz.js` : lit `dataset/episodes/*.json`, ré-encode si possible (`encodeObservation`), ajoute les transitions.

Script npm:
```json
"export:npz": "node scripts/export_npz.js"
```

## Chargement côté Python (exemple)
```python
import numpy as np, json, os
root = 'data/binary/batch_1690000000000'
with open(os.path.join(root,'meta.json')) as f: meta = json.load(f)
obs = np.fromfile(os.path.join(root,'obs.float32.bin'), dtype='<f4').reshape(meta['count'], meta['obsDim'])
actions = np.fromfile(os.path.join(root,'actions.int32.bin'), dtype='<i4')
rewards = np.fromfile(os.path.join(root,'rewards.float32.bin'), dtype='<f4')
masks = np.fromfile(os.path.join(root,'masks.uint8.bin'), dtype='uint8').reshape(meta['count'], meta['maskDim'])
dones = np.fromfile(os.path.join(root,'dones.uint8.bin'), dtype='uint8')
```

Pour créer un `.npz` compact:
```python
np.savez_compressed('batch_converted.npz', obs=obs, actions=actions, rewards=rewards, masks=masks, dones=dones, meta=meta)
```

## Validation à effectuer
1. Générer quelques épisodes (`scripts/bot.js`).
2. Lancer `npm run export:npz`.
3. Vérifier `meta.json` cohérent (obsDim == encodeur, maskDim == 256 ou 208 selon padding).
4. Charger en Python et vérifier absence de NaN: `np.isnan(obs).sum() == 0`.

## Prochaines extensions
- Ajouter fichier `values.float32.bin` et `logprobs.float32.bin` lorsque la policy les produira.
- Compression optionnelle (gzip/ brotli) côté Node si volume disque critique.
- Segmentation en shards (taille cible ~256MB) pour streaming.
- Index temporel (offsets) si random access nécessaire.

---
Fin Phase 4.5.
