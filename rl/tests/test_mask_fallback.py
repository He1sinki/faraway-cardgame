import os, sys, torch, numpy as np, gymnasium as gym

# Assure chemin racine projet pour import 'rl'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, os.pardir))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from rl.sb3_masked_policy import MaskedPolicy
from stable_baselines3.common.torch_layers import MlpExtractor


# Minimal dummy objects to exercise forward
class DummyFeaturesExtractor(torch.nn.Module):
    def __init__(self, observation_space, features_dim=16):
        super().__init__()
        self._features_dim = features_dim
        # SB3 s'attend à un attribut features_dim
        self.features_dim = features_dim

    def forward(self, obs):
        return obs


class DummyPolicy(MaskedPolicy):
    def _build_mlp_extractor(self) -> None:
        # override to smaller net
        self.mlp_extractor = MlpExtractor(
            self.features_dim,
            net_arch=[32, 32],
            activation_fn=torch.nn.ReLU,
        )


def test_all_zero_mask():
    obs_dim = 8
    act_dim = 10
    obs_space = gym.spaces.Box(low=-1.0, high=1.0, shape=(obs_dim,), dtype=np.float32)
    act_space = gym.spaces.Discrete(act_dim)
    policy = DummyPolicy(
        observation_space=obs_space,
        action_space=act_space,
        lr_schedule=lambda _: 0.0,
        features_extractor_class=DummyFeaturesExtractor,
        features_extractor_kwargs={"features_dim": obs_dim},
    )
    policy._last_action_mask = torch.zeros(act_dim, dtype=torch.float32)
    dummy_obs = torch.randn(1, obs_dim)
    actions, values, log_prob = policy.forward(dummy_obs)
    assert actions.shape[0] == 1


if __name__ == "__main__":
    test_all_zero_mask()
    print("OK")
