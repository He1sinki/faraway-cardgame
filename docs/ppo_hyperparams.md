# Phase 6.3 – Hyperparamètres PPO (Rationale & Defaults)

| Paramètre | Valeur défaut | Rôle | Notes d'ajustement |
|-----------|---------------|------|--------------------|
| learning_rate | 3e-4 | Pas d'apprentissage Adam | Diminuer si instabilité (KL explose) |
| gamma | 0.995 | Discount futur reward | 0.99 si parties courtes |
| gae_lambda | 0.95 | Lissage GAE | Baisser (0.9) réduit variance mais plus biaisé |
| clip_range | 0.2 | Clipping ratio PPO | Réduire (0.15) si ratio > (1±clip) souvent |
| entropy_coef | 0.01 | Exploration | Décroissance possible après stabilité |
| value_coef | 0.5 | Pondération MSE value | 0.4–0.6 classique |
| batch_size | 256 | Taille lot global par epoch | Augmenter si beaucoup de transitions |
| n_epochs | 3 | Passes par lot | 1–10 typique; trop haut → overfit buffer |
| max_grad_norm | 0.5 | Clip gradient L2 | 0.5 standard PPO |
| vf_clip | null | Clipping value (SB3 style) | Utiliser ~0.2 pour limiter sur-ajustement value |
| vf_clip_range | null | Clip delta value custom | Alternative simple si vf_clip absent |
| updates | 1 | Répéter PPO sur même buffer | >1 = ré-exploitation (surfit rapide) |
| lr_schedule | none | Décroissance LR | linear: LR * (1 - step/updates) |
| normalize_advantage | true | Stabilise policy gradient | Garder true |

## Stratégie d'ajustement rapide
1. Observer approx_kl & entropy:
   - KL >> 0.1 et augmente: réduire learning_rate ou clip_range.
   - Entropy s'effondre tôt: augmenter entropy_coef.
2. Value_loss >> policy_loss persistant: réduire value_coef ou activer vf_clip.
3. Stagnation win rate: augmenter n_epochs ou learning_rate (petit incrément).

## Early Stop (Phase future)
Déclencher arrêt si:
```
approx_kl > 0.2 (trop grande dérive) OU
entropy < 0.01 (policy quasi déterministe trop tôt)
```
Action: réduire LR de 50% et reprendre.

## TODO Suivi métriques
- Ajouter moyenne ratio clipping (% samples clampés)
- Enregistrer histogramme logits masqués/non masqués.

Fin.