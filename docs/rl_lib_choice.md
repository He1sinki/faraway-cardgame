# Phase 6.1 – Choix de la bibliothèque RL (PPO)

Objectif: sélectionner et justifier la/les librairie(s) utilisées pour la boucle d'entraînement PPO, en couvrant besoins actuels (offline rollouts + masques d'actions) et évolutions futures (self‑play online, évaluation continue, scheduling, callbacks).

## Besoins fonctionnels
1. PPO stable et éprouvé (fiabilité, reproductibilité).
2. Support facile pour: logging tensorboard, sauvegarde/reprise, callbacks (early stop, évaluation périodique).
3. Possibilité d'injecter un masque d'actions (actions illégales ⇒ logits = -inf).
4. Extensibilité: customisation policy réseau, ajout features (normalisation, reward shaping).
5. Compatibilité Python ≥ 3.10, GPU facultatif.
6. Mode hybride: offline (à partir de rollouts générés) puis online self‑play.

## Candidats évalués
| Option | Avantages | Inconvénients | Verdict |
|--------|-----------|---------------|---------|
| Custom (impl actuelle `ppo_train.py`) | Contrôle total, simple, masques faciles | Pas de gestion avancée (scheduler, eval, tb), risque bugs subtils | Conservé pour pipeline offline minimal (rapide) |
| Stable-Baselines3 (SB3) | Mûr, docs riches, callbacks, intégration tensorboard, large communauté | Action masking non natif (nécessite adaptation), offline RL limité | Adopté pour online + pipeline avancée |
| CleanRL | Code concis, lisible, reproductible | Pas de masquage intégré, moins de composants prêts (eval manager) | Option secondaire / lecture pédagogique |
| RLlib | Scalable distribué, multi-agent, production | Plus lourd, surdimensionné pour stade actuel, surcoût config | Différé (Phase 9+ si scaling massif) |

## Décision
Stratégie bi‑modale:
- Court terme (déjà en place): Entraînement PPO offline custom (`rl/ppo_train.py`) sur jeux de rollouts pré‑calculés (Phase 5.x) pour itérer vite sur le featurizing & reward shaping.
- Moyen terme: Migration progressive vers SB3 pour le mode self‑play online (simulation en direct) + instrumentation avancée (callbacks d'évaluation Elo, early stopping, logs tensorboard).

## Architecture cible (vue mixte)
```
Self-Play Orchestrator (Node)
  → Episodes JSONL → build_rollouts → returns/adv
    → (A) Custom PPO rapide (offline)  (rl/ppo_train.py)  [itérations fréquentes]
    → (B) SB3 Online Env (FarawayEnv Gymnasium) → PPO (sb3) [stabilisation / production]
```

## Intégration Masques d'Actions (SB3)
SB3 ne gère pas nativement `action_mask`. Approches:
1. Wrapper Env: stocker le masque dans `env.unwrapped.current_mask` et utiliser un custom policy qui le lit avant de calculer la distribution.
2. Override `distribution.forward()` (moins intrusif) pour appliquer `logits[mask==0] = -1e9`.

Choix: Policy custom légère (`MaskedPolicy`) dérivant de `ActorCriticPolicy` qui applique le masque juste après le réseau.

## Plan incrémental
1. (Fait) Conserver entraînement custom minimal pour continuité.
2. (Présent commit) Ajouter squelette `sb3_masked_policy.py` + doc.
3. (Prochain) Implémenter `FarawayOnlineEnv` (gymnasium) se connectant via WebSocket (ou boucle interne simulée) → expose `observation_space`, `action_space`.
4. Ajouter script `rl/train_sb3.py` (Phase 6.2) utilisant PPO SB3 + callbacks (eval every N steps).
5. Ajouter export/chargement checkpoints SB3 dans `runs/` (aligner nomenclature existante).
6. Intégrer symlink `runs/latest` + résumé métriques (approx_kl, entropy, winRate eval).

## Impacts Config
- Fichier `rl/config/ppo.yaml` enrichi champ `lib` (custom|sb3) + `sb3_policy`.
- Ajout dépendances: `gymnasium`, `tensorboard` pour visualisation.

## Risques & Mitigations
| Risque | Mitigation |
|--------|------------|
| Divergence résultats custom vs SB3 | Comparer sur mini dataset contrôlé (seed fixe) |
| Masque mal appliqué (fuites actions illégales) | Test unitaire: forcer mask=0 sauf une action et vérifier distribution argmax |
| Surcoût perfs online (latence) | Batch d'inférence + cache encodeur observation |
| Décalage format obs entre pipelines | Centraliser encodeur (même module base64 float32) |

## Tests à prévoir (Phase 6.2+)
1. Test distribution masquée (voir ci‑dessus).
2. Test reprise checkpoint SB3 (load, step, coherence shapes).
3. Test cohérence advantage normalization (custom vs SB3). 
4. Test offline → online warm start (charger weights custom dans SB3 policy si architecture identique).

## Conclusion
On consolide l'itération rapide avec le trainer custom actuel tout en préparant la montée en puissance via SB3 (callbacks, eval, logging standard). Ce document formalise la décision et le plan de migration graduelle.
