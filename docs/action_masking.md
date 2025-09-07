# Phase 6.4 – Action Masking

Objectif: empêcher la policy de sélectionner des actions illégales en posant -inf (≈ -1e9) sur leurs logits avant softmax.

## Formats
- Masque binaire longueur `pad_act_dim` (config ppo.yaml). Indice < logical_act_dim mappé à une action réelle.
- Valeurs: 1 = action légale, 0 = illégale.

## Fallback sécurité
Si aucune action légale (somme = 0) on force la dernière action (réservée NOOP) à 1 pour éviter NaN.

## Pipeline Offline
Les transitions fournissent déjà `mask` encodé base64 (octets). Lors du training custom (`ppo_train.py`), seules les 208 premières colonnes (LOGICAL_ACT_DIM) sont regardées pour filtrer logits.

## SB3 Policy
`rl/sb3_masked_policy.py` applique le masque dans `forward()` et `evaluate_actions()`. Stocke densité (`_last_mask_density`) pour diagnostics.

## Diagnostics recommandés
- Densité moyenne du masque (ratio actions légales) → détecter states trop permissifs ou trop restrictifs.
- Clip fraction PPO (déjà ajouté) corrélée aux changements soudains de set d'actions légales.

## Tests futurs
1. Masque avec une seule action légale → distribution argmax = cette action.
2. Masque tout zéro → fallback crée action dernière = 1.
3. Masque aléatoire stable → entropie diminue uniquement si policy devient confiante.

Fin.