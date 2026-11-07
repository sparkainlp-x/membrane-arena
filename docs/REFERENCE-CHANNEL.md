# Reference channel — a source of grounds from outside the membranes

The grounds mission (PR #12) showed the committee overcommits: it commits
on a shared artifact as if it were a signal. The shield-strictness check
(PR #13) showed no voting rule separates them, and strictness backfires.
The behavioral-fingerprint check (PR #14) showed no measurement of the
membranes' behavior separates them either — the limit is informational.
The artifact and the signal are the same dynamical object to the membranes;
the distinction is in where the pattern came from, and the membranes have
no access to that.

This mission gives the shield a source of grounds from **outside** the
membranes: an independent reference channel.

## The mechanism

Two input channels:

- **Channel A** — the membranes' channel. It carries the pattern the
  membranes see, whether that pattern is a real signal or a shared
  disturbance in the apparatus.
- **Channel B** — the reference channel. It sees the environment but **not**
  the disturbance.

A real signal is in the environment, so it appears in **both** channels.
An artifact lives only in the membranes' channel, so the reference channel
sees noise. When the shield passes, it requests a reference measurement:
20 independent samples from channel B, and it measures the declared
vector's mean energy ratio in those samples. The reference confirms the
declared pattern when that energy reaches the game's own declaration
threshold (`scaledThreshold`, 3.91 at the repository starting parameters).

The shield then decides on the reference's answer: commit only if the
reference confirms, abstain otherwise.

## Method

`referenceProbe` in `lab.js`. The game's real `episode()` (unmodified)
with the default membrane params (th 0.5, c 0.05, g 1.0), N=32, game
sigma 0.2652. Two arms, K=100 episodes each at the repository starting
parameters, seeded stream `membrane-arena/v1/reference/<seedTag>`:

- **signal** — a fresh planted pattern per episode. The reference channel
  sees noisy copies of the pattern.
- **artifact** — a fresh shared vector per episode, beta=1. The reference
  channel sees noise.

In each episode the shield's verdict is the game's own 2-of-3 rule. When
it passes, the reference probe runs on the declared vector (M=20 samples).
The decide rate is the fraction of episodes where the shield passes **and**
the reference confirms. Outcome is `grounds` only if the signal decide
rate exceeds 50% and the artifact decide rate is below 50%;
`overcommits` if the artifact decide rate exceeds 50%; `abstains` if
both are at or below 50%.

## Measured result (2026-11-07, game.js v0.3.6)

Mission seed (K=100 per arm):

| arm | shield pass | pass matches | reference confirms (of passes) | decides |
|---|---:|---:|---:|---:|
| real signal | 94.0% | 94.0% | 94/94 (100.0%) | **94.0%** |
| shared artifact | 95.0% | 95.0% | 0/95 (0.0%) | **0.0%** |

Verification seed (K=500 per arm): signal decides 92.6% (463 of 468
passes confirmed, 98.9%), artifact decides 0.0% (0 of 480 confirmed).
Outcome: **`grounds`**, on both seeds. Determinism verified (two runs
deep-equal).

Sanity (200 episodes, M=20): the declared vector's mean energy ratio in
the reference samples is 5.55 for a signal and 1.00 for an artifact,
against the declaration threshold of 3.91 — the two distributions do not
overlap (signal min 3.67, artifact max 1.49).

## What it means

**The shield now has grounds.** The reference channel separates the
causes cleanly: it confirms the signal 98–100% of the time and the
artifact never. The committee commits on the signal (94%) and abstains
on the artifact (0%). The three checks that established the limit — the
grounds mission, the shield-strictness sweep, the behavioral fingerprint —
all measured the membranes alone. The limit holds *within* the membranes.
It does not hold once the shield can ask an independent witness.

**The grounds were never in the votes.** They were in a second channel
that does not share the disturbance. A shield that can only count votes
cannot know when it has grounds; a shield that can ask whether the
pattern is really in the environment can. The fix was not a stricter
vote, a different threshold, or a new behavioral feature — it was a
source of evidence the membranes do not contain.

## Gate

The mission counts only for the described run (100 episodes per arm,
beta=1, repository starting parameters). Its outcome is `grounds` when
the reference confirms the signal and not the artifact. It will read
`overcommits` if the reference ever confirms an artifact, and `abstains`
if it stops confirming real signals.
