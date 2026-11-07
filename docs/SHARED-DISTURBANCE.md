# Shared disturbance — the 2-of-3 shield certifies a common error

**Question** (Marco Frei, LinkedIn 2026-11-06): do the three votes stay
independent, or does the 2-of-3 shield merely certify a common error?

**Answer, measured 2026-11-06 on the game's real code** (`game.js` v0.3.5,
`episode()` unmodified, defaults th 0.5 / c 0.05 / g 1.0, N=32, game sigma
0.2652, deterministic seeds): a shared artifact as strong as a real pattern
passes the 2-of-3 shield in **96.6%** of episodes — the same rate as a real
planted pattern (**95.5%**). Clean noise never passes (**0.0%**). The shield
cannot distinguish a shared artifact from a real signal.

## How it was tested

A "shared disturbance" = every membrane, every step, sees a noisy copy of ONE
shared vector (the artifact) instead of independent random vectors. The shield
rule is the game's own: `systemEvent(decls, AGREE=0.4)` — a declaration passes
when it agrees (fidelity >= 0.4) with at least one other, i.e. 2 of 3. Run it:

```
node scripts/shared-disturbance-check.js
```

The check FAILS (exit 1) while the artifact pass rate exceeds 50% at full
strength, and passes once the game defends against shared disturbance.

## Operating point (1000 episodes/condition)

| condition | >=1 decl | >=2 decl | shield pass | pass matches input |
|---|---:|---:|---:|---:|
| noise (clean) | 0.0% | 0.0% | 0.0% | — |
| artifact, sigma 0.265 | 99.0% | 96.6% | **96.6%** | **96.4%** |
| planted pattern, sigma 0.265 | 98.8% | 95.5% | **95.5%** | 95.4% (true) |

## Dose-response (500 episodes/condition, threshold fixed at game sigma)

Artifact strength beta = strength of the shared component relative to a real
pattern (beta=1 is full strength, beta=0 is pure noise). Method: pass a scaled
pattern vector to the real `episode()` — inputs become
normalize(beta*artifact + sigma*gauss) with sigma fixed at 0.265, so the
declaration threshold never moves.

| beta | >=1 decl | shield pass | pass matches artifact |
|---:|---:|---:|---:|
| 0.10 | 0.0% | 0.0% | 0.0% |
| 0.25 | 0.0% | 0.0% | 0.0% |
| 0.50 | 0.0% | 0.0% | 0.0% |
| 0.75 | 17.6% | 1.4% | 1.4% |
| 1.00 | 98.2% | **94.2%** | **94.2%** |

The shield is not hair-trigger — the break is sharp and exactly at full
pattern strength. A half-strength shared artifact never trips it; at 75%
strength it trips 1.4%; at full strength it fires 94.2%. The game's threshold
sits right where a full-strength pattern just barely crosses it, so anything
weaker falls short.

## Coupling controls (500 episodes/condition)

| condition | shield pass | pass matches artifact |
|---|---:|---:|
| artifact sigma 0.265, coupling c=0 | **94.0%** | 94.0% |
| artifact sigma 2.0, coupling c=0 | 0.0% | 0.0% |
| noise, coupling c=0 | 0.0% | — |

- At game sigma, the agreement comes from the **shared input alone**: with
  coupling off, the shield still passes the artifact 94.0% (vs 94.2% with
  coupling). The membranes independently learn the same artifact and agree.
- At sigma 2.0 the picture flips: with coupling the shield passes 98.7% on
  noise but the passed declarations match NOTHING (0.0% artifact); with
  coupling off the pass rate is 0.0%. So at high noise the **coupling itself
  manufactures consensus** — the membranes synchronize on an arbitrary shared
  direction and the shield certifies it. Second, distinct failure mode.

## Caveats

- Varying sigma also moves the declaration threshold (`episode()` scales its
  threshold with sigma), so a sigma sweep is NOT a strength sweep — the
  dose-response above is the clean sweep (threshold fixed). Sigma 2.0 is far
  outside the game's operating sigma (0.265); the coupling finding is a
  stress-test result, not a normal-play result.
- Synthetic classical simulation only, as the game states. No claim about
  physical membranes, quantum hardware, or consciousness.

## Next step

Add the shared-disturbance scenario to the game: noise episodes with a shared
artifact at beta=1 (and the beta curve as a lesson), so the failure is visible
in play instead of hidden in the shield. The numbers above are the baseline
it should show.
