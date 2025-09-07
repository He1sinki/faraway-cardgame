import torch, random
import torch.nn as nn
import torch.optim as optim


# Mini policy/value réseau identique à PolicyValueNet (simplifié)
class TinyNet(nn.Module):
    def __init__(self, obs_dim=4, act_dim=3):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(obs_dim, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU()
        )
        self.pi = nn.Linear(32, act_dim)
        self.v = nn.Linear(32, 1)

    def forward(self, x):
        h = self.shared(x)
        return self.pi(h), self.v(h).squeeze(-1)


def test_overfit_single_batch():
    torch.manual_seed(0)
    random.seed(0)
    obs_dim = 4
    act_dim = 3
    # dataset trivial: action 1 donne reward +1 sinon 0
    N = 64
    obs = torch.randn(N, obs_dim)
    actions = torch.ones(N, dtype=torch.long)  # action correcte toujours 1
    returns = torch.ones(N)
    advs = torch.ones(N)
    masks = torch.ones(N, act_dim)  # toutes actions valides
    net = TinyNet(obs_dim, act_dim)
    optim_ = optim.Adam(net.parameters(), lr=1e-2)
    for epoch in range(200):
        logits, values = net(obs)
        log_probs = torch.log_softmax(logits, dim=-1)
        lp_act = log_probs[torch.arange(N), actions]
        ratio = torch.exp(lp_act - lp_act.detach())  # ~1
        policy_loss = -(ratio * advs).mean()
        value_loss = (values - returns).pow(2).mean()
        loss = (
            policy_loss
            + 0.5 * value_loss
            - 0.01 * (-(log_probs * torch.exp(log_probs)).sum(-1).mean())
        )
        optim_.zero_grad()
        loss.backward()
        optim_.step()
        if epoch % 20 == 0:
            print("epoch", epoch, "loss", loss.item())
    # Après entraînement, prob(action=1) doit être >0.95
    with torch.no_grad():
        logits, _ = net(obs[:8])
        probs = torch.softmax(logits, dim=-1)
        mean_p1 = probs[:, 1].mean().item()
        assert mean_p1 > 0.95, f"probabilité action correcte insuffisante: {mean_p1}"


if __name__ == "__main__":
    test_overfit_single_batch()
    print("overfit minibatch OK")
