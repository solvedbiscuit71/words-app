import random
import math


def randexp(n: int, lam=1.0):
    if n == 0:
        raise ValueError("n cannot be zero")
    if n == 1:
        return n

    # Compute exponential weights, increasing with index
    weights = [math.exp(lam * i / (n - 1)) for i in range(n)]
    total_weight = sum(weights)

    # Inverse-CDF sampling
    r = random.random() * total_weight
    cumulative = 0.0
    for i, w in enumerate(weights):
        cumulative += w
        if r <= cumulative:
            return i

    return n - 1


def rand(n: int, weights: list[float]):
    total_weight = sum(weights)

    # Inverse-CDF sampling
    r = random.random() * total_weight
    cumulative = 0.0
    for i, w in enumerate(weights):
        cumulative += w
        if r <= cumulative:
            return i

    return n - 1


if __name__ == "__main__":
    # Quick sanity check: sample many times and print frequency per index
    n = 10
    lam = 2.0

    counts = {i: 0 for i in range(n)}
    trials = 100_000

    for _ in range(trials):
        picked = randexp(n, lam)
        counts[picked] += 1

    for i in range(n):
        print(f"{i}: {counts[i] / trials:.4f}")

    print("-" * 50)

    n = 10

    counts = {i: 0 for i in range(n)}
    trials = 100_000

    for _ in range(trials):
        picked = rand(n, [0, 0, 1, 1, 1, 2, 2, 3, 3, 5])
        counts[picked] += 1

    for i in range(n):
        print(f"{i}: {counts[i] / trials:.4f}")
