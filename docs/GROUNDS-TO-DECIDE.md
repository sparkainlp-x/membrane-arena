# Grounds to decide — commit, request a measurement, or abstain

**Question** (Marco Frei, LinkedIn 2026-11-07, following the shared-disturbance
result): the shield cannot distinguish a shared artifact from a real signal,
so when does the committee have grounds to decide at all? Give it a choice —
commit, request a measurement that could separate the causes, or abstain —
and test whether it recognises when more agreement cannot provide more
justification.

**Answer, measured on the game's real code** (`game.js` v0.3.5, `episode()`
unmodified, defaults th 0.5 / c 0.05 / g 1.0, N=32, game sigma 0.2652,
deterministic seeds): the committee commits on the shared artifact **as often
as on a real signal** — 96.6% vs 95.5% — and the measurement it would request
does not separate the causes either: with the coupling switched off, the
artifact still passes 94.0%. The committee has no grounds, and the only
correct action is to abstain.

## How it was tested

`groundsProbe` runs three arms of K episodes each at the repository starting
parameters, all through the real `episode()` with the shield's own 2-of-3
verdict (`systemEvent(decls, AGREE=0.4)`):

- **signal** — a planted real pattern (a fresh unit vector per episode).
- **artifact** — a shared artifact as strong as a real pattern (beta = 1).
- **measure** — the same artifact with the coupling switched off (c = 0): the
  measurement the committee would request to test whether the consensus is
  coupling-driven rather than input-driven.

The mission counts only at K = 100 per arm, beta = 1, repository starting
parameters. Its outcome is `grounds` when the committee commits on the signal
(pass > 50%) and abstains on the artifact (pass < 50%), `overcommits` when it
commits on the artifact (pass > 50%), and `abstains` when it commits on
neither.

## Three arms (reference rates, shared-disturbance test 2026-11-06)

| arm | shield pass | pass matches input |
|---|---:|---:|
| real signal | **95.5%** | 95.4% (true) |
| shared artifact | **96.6%** | 96.4% |
| artifact, coupling off (requested measurement) | **94.0%** | 94.0% |

The grounds probe reproduces these rates (500 episodes per arm, 2026-11-07):
signal 96.0%, artifact 97.4%, coupling off 94.0%. The mission seed (100
episodes per arm) gives signal 99, artifact 97, coupling off 99 — outcome
`overcommits`.

## Why the requested measurement does not help

The coupling-off arm tests the most plausible hypothesis: that the consensus
is manufactured by the coupling between membranes. It is not — at game sigma
the agreement comes from the **shared input alone**. With coupling off, the
membranes independently learn the same artifact and still agree 94.0% of the
time. The measurement rules out the coupling hypothesis, but it cannot
separate a signal from an artifact, because both are the same thing to the
membranes: a coherent pattern in the shared input. No measurement on the
responses can recover a distinction the responses do not contain.

## What would count as grounds

The committee would have grounds only if it committed on the signal and
abstained on the artifact — a clear separation in the two pass rates. The
current shield does the opposite: it commits on both. A future shield that
regulates *when* the committee may decide — for example by requiring an
independent measurement that the causes actually differ, and abstaining while
none exists — would be the defence this mission is waiting for. Until then
the mission records `overcommits`, honestly.

## Caveats

- Signal and artifact are mechanistically identical inside `episode()`: both
  are a unit vector passed as the pattern. The distinction is about what the
  pattern *is*, which the membranes cannot see. That is the point of the
  mission, not a flaw in it.
- Synthetic classical simulation only, as the game states. No claim about
  physical membranes, quantum hardware, or consciousness.
