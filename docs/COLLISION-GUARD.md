# Collision guard: a margin guard for the in-game shield

## The 3x3 finding, carried over

The membrane-arena-3x3 work (rounds 1-6, suite 154/154) found the shield
was blind to a **pairwise collision**: two cells converging to the same
state while the rest of the lattice stayed spread out. Mean divergence
barely moved (0.458 -> 0.436), far above the 0.02 floor. The fix was a
pairwise guard (min pairwise divergence, threshold 0.10) plus a **margin**
condition (mean_div - min_div > 0.05) so the guard fires on a *localised*
collision but not on *global* synchronisation, where everything is low
together. Measured separation ~17x (exact control margin <= 0.032 vs
planted collision 0.30 at step 1). The key insight: the threshold is not
a fidelity value — it is the clock match — and the margin distinguishes
a localised collision from global synchronisation.

## Mapping to the game

The game's shield is 2-of-3 agreement at AGREE = 0.4. It counts
agreement but not its *structure*: it cannot tell two membranes
declaring near-identical vectors (one effective witness, counted twice)
from two independent membranes that happen to agree.

| 3x3 | game |
|---|---|
| cell state rho | declaration (a unit vector in C^32) |
| pairwise fidelity between cells | pairwise fidelity between declarations |
| min / mean divergence | max / mean fidelity (divergence = 1 - fidelity, so margin = maxFid - meanFid = meanDiv - minDiv, identical arithmetic) |
| collision: two cells identical | collision: two membranes declare near-identical vectors (fidelity >= 0.9) |
| global synchronisation: all cells identical, margin ~0 | global consensus: all three declarations close, margin small |
| guard fires -> reject the step | guard fires -> the shield abstains (does not commit), as the reference gate does in PR #18 |

## The guard

`pairwiseCollision(decls)` in game.js, constants `COLLIDE = 0.9` and
`COLL_MARGIN = 0.05`:

- Among non-null declarations, compute all pairwise fidelities.
- Fewer than 2 non-null declarations: no collision (nothing to check).
- Exactly 2 non-null declarations: margin is 0 by definition (one pair,
  no background), so no collision. A silent third membrane is not
  dissent — there is no positive evidence the agreement is localised.
  The standard 2-of-3 pass stands.
- 3 non-null declarations: maxFid, meanFid, margin = maxFid - meanFid.
  Collided iff maxFid >= COLLIDE **and** margin > COLL_MARGIN.

Threshold justification (measured on the real episode(), repo-start
params, K=200/arm): on a genuine signal the closest pair averages
0.874 fidelity and the guard fires on only 0.5% of shield passes; on a
shared artifact it fires on 0.0%. A strongly coupled pair reaches 0.954.
COLLIDE = 0.9 sits between the natural level and the planted level.
COLL_MARGIN = 0.05 is the 3x3's margin, carried over exactly (same
arithmetic in fidelity units).

Wiring: the guard is part of the shield. In `stepGeneration`, when the
shield would commit on a 2-of-3 agreement, the collision analysis runs
first; if collided, the shield abstains (passed = null, outs = [],
dropped = true) and the episode records `collision: true` with
`collMaxFid` / `collMargin`. No new setting — the guard is a default,
as the 3x3 adopted its pairwise guard as a default.

This PR is independent of PR #18 (built on main). The reference gate
and the collision guard are both abstain-gates on the 2-of-3 trigger
and compose; a follow-up can wire the collision check into
`shieldCommit` if #18 merges.

## What the guard does NOT do

It does not separate a signal from a shared artifact: both are global
consensus (all three membranes converge on the same vector), so the
margin is small and the guard stays silent. That separation is the
reference channel's job (PR #16 / #18). The guard defends against a
different failure mode: a *localised* collision, where two membranes
are one voice and the third dissents.

## The probe (Lab mission `collision`)

`collisionProbe` in lab.js, three arms at repo-start params, K episodes
each, seeded stream `membrane-arena/v1/collision/<seedTag>`:

- **signal**: all three membranes see the pattern. Expect the shield to
  pass ~95% and the guard to fire on ~0.5% of passes.
- **artifact**: all three see a shared artifact, beta = 1. Expect the
  shield to pass ~94% and the guard to fire ~0% (global consensus).
- **collision** (planted): membranes 0 and 1 see artifact A with strong
  coupling (c = 0.5), membrane 2 sees a different pattern B with no
  coupling (c = 0). Expect the pair to declare near-identical vectors
  (maxFid ~0.95) while the third declares far away, so the guard fires
  and the shield abstains. This arm needs per-membrane patterns in
  `episode()` (new optional `pats` parameter; existing callers
  unaffected) and per-membrane coupling (already supported via P).

Mission criterion (reuses the `grounds` / `overcommits` / `abstains`
outcomes): the shield has grounds iff it commits on the signal
(> 50%) and abstains on the planted collision (< 50% commit).

## Measured rates

`node scripts/collision-guard-check.js`, K = 500/arm, repo-start params
(th 0.5, c 0.05, g 1.0), beta = 1, seed `check`:

| arm | shield pass | guard fires | guard fires \| pass | commits | mean maxFid | mean margin |
|---|---|---|---|---|---|---|
| signal | 96.0% | 1.0% | 1.0% | 95.0% | 0.874 | 0.017 |
| artifact | 98.0% | 0.6% | 0.6% | 97.4% | 0.875 | 0.020 |
| collision (planted) | 92.0% | 24.0% | 26.1% | 68.0% | 0.953 | 0.037 |
| noise | 0.0% | 0.0% | — | 0.0% | — | — |

Fire-rate ratio (collision / signal): **24.0x**. Mission outcome: **grounds**
(signal commits 95.0%, guard fires on the planted collision 24x its fire
rate on the signal, on 24.0% of the planted arm). The Lab's mission seed
(K = 100/arm) gives the same outcome: signal commits 94/100, collision
fires 22/100, ratio 22x.

The guard does not separate signal from artifact (both are global
consensus: fire 1.0% vs 0.6%). That separation is the reference
channel's job. What the guard does: it fires 24x more often on a planted
pairwise collision than on a genuine signal, while the signal still
commits 95% of the time.

Honest consequence for the game: the guard abstains on some episodes
that used to be true outputs. Golden numbers change — golden1: T 41 → 37,
F 7, score 81.77 → 74.23; d2026-10-24: T 45 → 41, F 2, score 93.13 →
83.66. Old challenge links no longer play the same contest.

Two things the dynamics would not let us build, and why the plant is what
it is. First, a per-membrane-pattern plant ([A, A, B] with strong coupling)
does not work: the all-to-all coupling drags the pair off the pattern (the
pair never declares at c = 0.5) or leaves it uncollided (mutual fidelity
0.28 at c = 0.05). A localised collision cannot be constructed through
the dynamics by giving the membranes different patterns — the coupling
that synchronises the pair also couples it to the third. Second, a
low-threshold third membrane does not work either: the pair is pulled
toward the third's state, so the margin stays ~0. The working plant is a
strongly coupled pair on a *shared* pattern with the third uncoupled: the
pair declares near-identical vectors (mean maxFid 0.953) and the third
declares on its own learning, which lands far enough below the pair
(margin p90 0.130 vs signal p90 0.039) for the guard to fire on 26% of
passes. In the other ~74% of planted passes the third agrees and the
episode is global consensus, where the guard correctly stays silent —
so the guard fires on the localised collisions that actually occur, not
on every planted episode.
