# Phase 4.6 – Tests Observation & Masque

Objectif: garantir la fiabilité de l'encodage (déterminisme) et la cohérence du masque d'actions avec les actions légales issues de l'état brut.

## Tests ajoutés
1. `rl/test_encode_observation.js` (existant, référencé):
   - Déterminisme (hash identique pour même état).
   - Masque contient cartes jouables en phase `play`.
   - Présence d'au moins une action (NOOP) hors phase.
2. `rl/test_mask_consistency.js` (nouveau):
   - Recharge jusqu'à 50 épisodes JSON.
   - Ré-encode chaque step via `encodeObservation` (en utilisant `rawState`).
   - Vérifie pour chaque phase :
     - play: toutes cartes de `hand` doivent avoir mask[cardId] = 1.
     - shop: si `hasToChoose` -> cartes shop présentes dans segment shop (offset = R).
     - sanctuary: cartes de `sanctuaryChoose` présentes dans segment sanctuary (offset = 2R + (c-1)).
   - Agrège statistiques missing/total et retourne code exit 2 si incohérences (>0).

## Scripts npm
```json
"test:encode": "node rl/test_encode_observation.js",
"test:mask": "node rl/test_mask_consistency.js"
```

## Utilisation
```bash
npm run test:encode
npm run test:mask
```

Sortie attendue `test:mask`:
```
[mask_consistency] sample files= N
 play missing: 0/XXX (0.00%)
 shop missing: 0/YYY (0.00%)
 sanct missing: 0/ZZZ (0.00%)
```

## Checkpoint Qualité Phase 4.6
- [x] Déterminisme encodeur validé.
- [x] Masque cohérent sur échantillon d'épisodes.
- [ ] Intégrer ces tests dans pipeline CI (à faire Phase 10.4).

## Prochaines étapes (vers Phase 5)
- Orchestrateur self-play multi-bots (`scripts/selfplay.js`).
- Paramètres: nombre de parties, parallélisme, seed base.
- Écriture continue d'épisodes + export binaire périodique.

---
Fin Phase 4.6.
