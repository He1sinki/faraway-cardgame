import torch
from rl.sb3_masked_policy import MaskedPolicy
from stable_baselines3.common.torch_layers import MlpExtractor

# Minimal dummy objects to exercise forward
class DummyFeaturesExtractor(torch.nn.Module):
    def __init__(self, observation_space, features_dim=16):
        super().__init__()
        self._features_dim = features_dim
    def forward(self, obs):
        return obs

class DummyPolicy(MaskedPolicy):
    def _build_mlp_extractor(self) -> None:
        # override to smaller net
        self.mlp_extractor = MlpExtractor(self.features_dim, net_arch=[32, 32])


def test_all_zero_mask():
    obs_dim = 8
    act_dim = 10
    policy = DummyPolicy(
        observation_space=None,
        action_space=None,
        lr_schedule=lambda x: 0.0,
        net_arch=[32,32],
        activation_fn=torch.nn.ReLU,
        features_extractor_class=DummyFeaturesExtractor,
        features_extractor_kwargs={"features_dim": obs_dim},
    )
    policy._last_action_mask = torch.zeros(act_dim, dtype=torch.float32)
    dummy_obs = torch.randn(1, obs_dim)
    actions, values, log_prob = policy.forward(dummy_obs)
    assert actions.shape[0] == 1

if __name__ == '__main__':
    test_all_zero_mask()
    print('OK')
