"""Squelette Policy SB3 avec masquage d'actions.
Phase 6.1: Préparation migration vers SB3.

Usage futur:
 from sb3_masked_policy import MaskedPolicy
 model = PPO(MaskedPolicy, env, ...)

Attente: l'environnement expose un attribut `current_action_mask` (np.ndarray shape [act_dim])
juste avant chaque appel à `policy.forward()`. On applique -1e9 sur logits des actions illégales.
"""

from typing import Optional, Tuple, Dict, Any
import torch as th
import torch.nn as nn
import gymnasium as gym
from stable_baselines3.common.policies import ActorCriticPolicy


class MaskedPolicy(ActorCriticPolicy):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

    def forward(
        self,
        obs: th.Tensor,
        deterministic: bool = False,
    ) -> Tuple[th.Tensor, th.Tensor, th.Tensor]:
        features = self.extract_features(obs)
        latent_pi, latent_vf = self.mlp_extractor(features)
        distribution = self._get_action_dist_from_latent(latent_pi)
        # Récupération masque si présent
        mask = getattr(self, "_last_action_mask", None)
        if mask is not None:
            # mask shape: [batch, act_dim] ou [act_dim]
            if mask.ndim == 1:
                mask = mask.unsqueeze(0).repeat(
                    distribution.distribution.logits.size(0), 1
                )
            logits = distribution.distribution.logits
            logits = logits.masked_fill(mask == 0, -1e9)
            distribution.distribution.logits = logits
        actions = distribution.get_actions(deterministic=deterministic)
        log_prob = distribution.log_prob(actions)
        values = self.value_net(latent_vf)
        return actions, values, log_prob

    def set_action_mask(self, mask_tensor: th.Tensor):
        """Setter appelé par le runner/env avant policy.forward."""
        self._last_action_mask = mask_tensor

    def _predict(
        self, observation: th.Tensor, deterministic: bool = False
    ) -> th.Tensor:
        actions, _, _ = self.forward(observation, deterministic)
        return actions

    def evaluate_actions(
        self,
        obs: th.Tensor,
        actions: th.Tensor,
    ) -> Tuple[th.Tensor, th.Tensor, th.Tensor]:
        features = self.extract_features(obs)
        latent_pi, latent_vf = self.mlp_extractor(features)
        distribution = self._get_action_dist_from_latent(latent_pi)
        mask = getattr(self, "_last_action_mask", None)
        if mask is not None:
            if mask.ndim == 1:
                mask = mask.unsqueeze(0).repeat(
                    distribution.distribution.logits.size(0), 1
                )
            logits = distribution.distribution.logits
            logits = logits.masked_fill(mask == 0, -1e9)
            distribution.distribution.logits = logits
        log_prob = distribution.log_prob(actions)
        values = self.value_net(latent_vf)
        entropy = distribution.entropy()
        return values, log_prob, entropy
