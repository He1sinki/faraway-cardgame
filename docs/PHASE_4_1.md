# Phase 4.1 – Encodage Observation Structuré

Objectif: figer un schéma déterministe pour l'observation RL + espace d'actions.

## Paramètres constants
- R (regions) = 77 (indices 0..76)
- S (sanctuaries) = 53 (tiles 1..53)
- ACT_DIM = 2R + S + 1 = 208 (PLAY, SHOP, SANCT, NOOP)
- Masque entraînement/export = 256 (padding zeros)

## Mapping Actions
| Segment | Indices | Sémantique |
|---------|---------|------------|
| PLAY_i  | 0 .. 76 | Jouer carte région i (phase play) |
| SHOP_i  | 77 .. 153 | Prendre carte boutique i (phase shop) |
| SANCT_j | 154 .. 206 | Choisir sanctuaire j (tile j, 1-based) |
| NOOP    | 207 | Aucune action / fallback |

## Encodage Observation
Vecteur concaténé:
1. Phase one-hot (4)
2. Turn normalisé (1)
3. Scores agrégés normalisés (12): stone, chimera, thistle, clue, red, green, blue, yellow, colorless, night, wonderSet, colorSet
4. hasToChoose (1)
5. hand multi-hot (R)
6. shop multi-hot (R)
7. playedSelf multi-hot (R)
8. playedOthers multi-hot (R)
9. sanctuaryChoices multi-hot (S)
10. sanctuaries joués multi-hot (S)

Total dimension observation: 4 +1 +12 +1 + (4R) + (2S) = 18 + (4*77) + (2*53) = 18 + 308 + 106 = 432.

## Fichier
- Implémentation: `rl/encode_observation.js`

## Masque d'Actions
Construite selon phase + hasToChoose; NOOP forcé si aucune action valable.

## Compatibilité Ancienne Featurisation
- `dataset/featurize.js` conservé pour pipelines existants (legacy) mais sera remplacé progressivement.

## Tests Requis (à implémenter Phase 4.2)
- Même état → même hash observation.
- Action jouée dans logs a toujours mask[action]==1.
- Aucune fuite: multi-hot n'active que cartes réellement visibles.

## Étapes Suivantes
1. Ajouter tests d'intégrité encodeur.
2. Adapter export rollouts pour utiliser nouvel encodeur (option flag).
3. Mettre à jour PPO pour ACT_DIM=208 tout en continuant à pad 256.
4. Migrer bots vers encodeObservation pour décisions.

Fin.
