# Reference leak — how much disturbance can reach the reference channel?

The reference channel (PR #16) gives the shield grounds: it confirms the
signal 94% of the time and the artifact never. Its power rests on one
assumption — the disturbance is confined to the membranes' channel, and
the reference channel sees only the environment. This check tests that
assumption's boundary: how much of the artifact can leak into the
reference channel before the shield's grounds fail?

## Method

`scripts/reference-leak-check.js`. The game's real `episode()` (unmodified)
with the default membrane params (th 0.5, c 0.05, g 1.0), N=32, game sigma
0.2652. The artifact leaks into the reference channel at strength gamma:

- **gamma = 0** — the reference sees only noise (the PR #16 setup).
- **gamma = 1** — the reference sees the full artifact, as if it were a
  signal.
- Between, the reference sees noisy(gamma × artifact).

At each gamma, K=500 episodes per arm. When the shield passes, the
reference probe runs 20 samples from the reference channel and confirms
the declared pattern when its mean energy ratio reaches the game's own
declaration threshold (3.91). The signal arm is the control: the reference
sees noisy(pat) at every gamma.

The check PASSES only if the reference is robust: it does not confirm the
artifact (decide rate < 50%) at gamma ≤ 0.5 — it tolerates up to a
half-strength leak — and it keeps confirming the signal (decide rate
> 50%) at every gamma.

## Measured result (2026-11-07, game.js v0.3.6)

| gamma | artifact decides | artifact confirms (of passes) | signal decides | signal confirms |
|---:|---:|---:|---:|---:|
| 0.00 | 0.0% | 0.0% | 93.2% | 98.5% |
| 0.25 | 0.0% | 0.0% | 93.6% | 99.2% |
| 0.50 | 0.0% | 0.0% | 94.2% | 99.4% |
| 0.60 | 1.0% | 1.0% | 95.4% | 98.1% |
| 0.70 | 15.2% | 15.9% | 94.4% | 99.4% |
| 0.75 | 33.8% | 35.1% | 94.4% | 98.7% |
| 0.80 | 59.6% | 63.4% | 93.6% | 98.5% |
| 1.00 | 93.4% | 98.9% | 95.6% | 99.0% |

The break — the first gamma where the artifact decide rate reaches 50% —
is **gamma = 0.80**. The check **PASSES**.

## What it means

**The reference channel is robust, not fragile.** It tolerates up to a
half-strength leak into the reference channel and still never confirms
the artifact (0.0% at gamma ≤ 0.5). The leak starts to bite only at
gamma = 0.60 (1.0%), rises through 0.70 (15.2%) and 0.75 (33.8%), and
crosses half only at 0.80. At full leak (gamma = 1.0) it is fully broken
(93.4%), as it must be — a disturbance that reaches the reference channel
at full strength is, to every channel, the same as a signal.

So the shield's grounds do not depend on a perfectly clean reference
channel. They depend on the disturbance being at most half as strong in
the reference channel as in the membranes' channel. Below that, the
shield commits on the signal (~94%) and abstains on the artifact (0%).
Above it, the grounds degrade sharply — and the degradation is itself
measured, not assumed.

## Gate

The check passes when the reference holds at gamma ≤ 0.5 and keeps
confirming the signal at every gamma. It would fail if the reference
confirmed the artifact at half strength or less, or stopped confirming
real signals. The break point (gamma = 0.80) is the measured boundary of
the grounds the reference channel provides.
