# Phase 3.6 - PPO Intégration Initiale

Objectifs:
1. Charger rollouts (processed_adv) en tenseurs PyTorch avec obs, action, mask, return, advantage.
2. Implémenter un mini PPO maison (sans SB3) pour contrôler pipeline (clip, value, entropy, advantage norm).
3. Sauvegarder checkpoints policy_<ts>.pt + value_<ts>.pt + stats.json.
4. Intégrer initialisation depuis policy_meta.json (offline imitation).
5. Préparer export du dernier modèle vers Node (fichier .json simple avec poids concaténés) pour futur client bot.

Hypothèses:
- action space = 256.
- obs_dim déterminé dynamiquement via première ligne.
- advantages déjà présents (sinon fallback return-baseline).

Étapes Code:
- Nouveau fichier `rl/ppo_train.py`.
- DataLoader simple sur fichiers JSONL.
- MLP partagée (policy) + tête value séparée.
- PPO update: calcul ratio, surrogate, clip, value loss, entropy.
- Gradient accumulation sur minibatches.

Scripts npm futurs (non créés ici):
- `npm run ppo` -> python rl/ppo_train.py

Prochaines phases:
- 3.7 Masquage action côté policy (logits -1e9 sur mask=0) + sampling.
- 3.8 Export modèle vers Node et intégration bot policy.
- 3.9 Boucle continue self-play -> PPO -> déploiement champion.

Ce fichier sert de référence d'implémentation.
