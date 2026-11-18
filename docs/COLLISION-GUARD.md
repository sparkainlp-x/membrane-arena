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
params, K=500/arm): on a genuine signal the closest pair averages
0.874 fidelity and the guard fires on only 1.0% of shield passes; on a
shared artifact it fires on 0.6%. A strongly coupled pair reaches 0.953.
COLLIDE = 0.9 sits between the natural level and the planted level.
COLL_MARGIN = 0.05 is the 3x3's margin, carried over exactly (same
arithmetic in fidelity units).

Wiring: the guard is part of the shield. `shieldCommit` (game.js) applies
both gates after the 2-of-3 trigger: the reference channel confirms
first, then the collision analysis runs; if collided, the shield
abstains (passed = null, outs = [], dropped = true) and the episode
records `collision: true` with `collMaxFid` / `collMargin`. No new
setting — the guard is a default, as the 3x3 adopted its pairwise
guard as a default. The collision check runs after the reference
check, so the reference stream is consumed exactly as in PR #18
whenever 2-of-3 agree.

This PR was built on main before PR #18 merged. The reference gate
and the collision guard are both abstain-gates on the 2-of-3 trigger
and compose; the rebase onto PR #18 wired the collision check into
`shieldCommit`, as anticipated here.

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
- **collision** (planted): a shared pattern, membranes 0 and 1 strongly
  coupled (c = 0.5) while membrane 2 is uncoupled (c = 0), so the pair
  declares near-identical vectors (mean maxFid ~0.95) and the third
  declares on its own learning, which lands far enough below the pair
  for the guard to fire. The per-membrane-pattern plant ([A, A, B]) does
  not work — the all-to-all coupling drags the pair off the pattern —
  so the plant is a strongly coupled pair on a *shared* pattern; see
  "Measured rates" for why. This arm uses per-membrane coupling
  (already supported via P). `episode()` also gained an optional `pats`
  parameter (per-membrane patterns) for future probes; it is not used
  by this probe and existing callers are unaffected.

Mission criterion (reuses the `grounds` / `overcommits` / `abstains`
outcomes): the shield has grounds iff it commits on the signal
(> 50%) and the guard fires on the planted collision at least 5x its
fire rate on the signal, on more than 10% of the planted arm. A
commit-rate criterion would measure the plant's composition, not the
guard: most planted episodes are global consensus (the third agrees),
where the guard correctly stays silent, so the planted commit rate
stays above 50% even though the guard fires on every localised
collision that actually occurs.

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

## The combined shield's steady-state: the 1/3 bound re-derived to 1/2

The shield-effect test (`tests/game.test.js`, "shield effect over 16
seeds") asserted the shielded rate variance is under a third of the
unshielded rate variance. That 1/3 bound dates to the original port
(commit 956bdd6), written for the ungated 2-of-3 shield; it was never
re-derived for gated systems. After the rebase onto PR #18 the combined
two-gate shield measured 0.3361 on the 16-seed set — only 0.0028 over
1/3, which looked like noise. A larger sample settles it above 1/3:

| system (scheme `random`) | 16 seeds | 128 seeds | bootstrap 95% CI (128) |
|---|---|---|---|
| reference gate alone | 0.2939 | 0.3202 | [0.285, 0.364] |
| collision guard alone | 0.2034 | 0.2309 | [0.205, 0.261] |
| both gates | 0.3361 | 0.4110 | [0.367, 0.469] |

An independent 128-seed family gives 0.4326 for both gates (pooled 256
seeds ~0.42). Each gate alone still satisfies 1/3, so the excess is the
interaction, not either gate.

Mechanism: the two gates' restrictiveness rises together across
generations (correlation 0.882 over generations 0–11). Both are most
permissive in generation 0 (reference pass 0.984, collision pass 0.992)
and tighten later — the reference as thresholds drift down under sp
adaptation and membranes declare on marginal evidence it rejects (its
abstentions rise from 0.06 to ~0.6 per generation), the collision guard
as coupling drifts up (mean c 0.050 → 0.070) and pairs converge more
often (its abstentions rise from 0.03 to ~0.3 per generation). Their
generation profiles align, so the combined commit rate swings more
across generations than either gate alone: the generation-0 spike over
the later-generation mean is +0.107 combined, vs +0.073 reference-only
and +0.047 collision-only — and that swing is the dominant term in the
rate variance.

The bound is therefore re-derived for the combined system as 1/2: the
next simple fraction above the 128-seed 95% CI upper limit (0.469). It
comes from that measurement, not from the test result — the 16-seed
value 0.3361 and the 128-seed value 0.4110 both sit below it, and the
shield still delivers the effect (128 seeds: F 0.35 vs 11.09
unshielded, score 79.33 vs 69.12). The old 1/3 bound stands as the
single-gate steady-state; it does not apply to the combined system.

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
