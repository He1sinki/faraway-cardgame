import math
import torch


def compute_returns(rewards, dones, gamma):
    R = 0.0
    out = []
    for r, d in zip(reversed(rewards), reversed(dones)):
        R = r + gamma * R * (1.0 - d)
        out.append(R)
    return list(reversed(out))


def compute_gae(rewards, values, dones, gamma, lam):
    gae = 0.0
    adv = [0.0] * len(rewards)
    last_value = 0.0
    for t in reversed(range(len(rewards))):
        next_non_terminal = 1.0 - dones[t]
        next_value = values[t + 1] if t + 1 < len(values) else last_value
        delta = rewards[t] + gamma * next_value * next_non_terminal - values[t]
        gae = delta + gamma * lam * next_non_terminal * gae
        adv[t] = gae
    returns = [a + v for a, v in zip(adv, values)]
    return adv, returns


def test_simple_return_equals_sum():
    rewards = [1.0, 1.0, 1.0]
    dones = [0, 0, 1]
    gamma = 0.9
    expected = [1.0 + 0.9 * (1.0 + 0.9 * 1.0), 1.0 + 0.9 * 1.0, 1.0]
    calc = compute_returns(rewards, dones, gamma)
    assert all(abs(a - b) < 1e-6 for a, b in zip(expected, calc))


def test_gae_matches_manual_no_bootstrap():
    rewards = [0.0, 1.0, 0.0]
    dones = [0, 0, 1]
    values = [0.2, 0.4, 0.1]
    gamma = 0.99
    lam = 0.95
    adv, rets = compute_gae(rewards, values, dones, gamma, lam)
    # brute force last state (done) advantage = delta
    # delta_2 = r2 - v2 (since done -> no bootstrap)
    delta2 = rewards[2] - values[2]
    assert abs(adv[2] - delta2) < 1e-6
    # check returns = advantage + value
    for a, v, r in zip(adv, values, rets):
        assert abs(a + v - r) < 1e-6


def test_gae_zero_rewards():
    rewards = [0.0] * 5
    dones = [0, 0, 0, 0, 1]
    values = [0.1, 0.1, 0.1, 0.1, 0.1]
    gamma = 0.99
    lam = 0.95
    adv, rets = compute_gae(rewards, values, dones, gamma, lam)
    # advantages should decay toward -value when all rewards zero and terminal
    assert adv[-1] == -values[-1]


if __name__ == "__main__":
    test_simple_return_equals_sum()
    test_gae_matches_manual_no_bootstrap()
    test_gae_zero_rewards()
    print("advantage tests OK")
