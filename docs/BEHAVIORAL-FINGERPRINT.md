# Behavioral fingerprint — is the limit informational?

Follow-up to the shield-strictness check (PR #13): no *voting rule*
separates a shared artifact from a real signal, and strictness backfires.
This check asks whether the limit is deeper — informational. If the
artifact and the signal are the same dynamical object to the membranes
(both are just a vector the membranes see noisy copies of), then *no*
behavioral feature of the membranes should differ between them either:
not when they declare, not how their energy rises, not how fast they
align to the pattern.

## Method

`scripts/behavioral-fingerprint-check.js`. The game's real `episode()`
(unmodified) with the default membrane params (th 0.5, c 0.05, g 1.0),
N=32, game sigma 0.2652. K=1000 episodes per condition.

- **signal** — a fresh planted pattern per episode.
- **artifact** — a fresh shared vector per episode, beta=1.
- **noise** — no pattern (control).

Features per episode, all read off `episode()`'s own outputs (declarations,
declaration steps, the energy trace, the fidelity trajectory):

- declarations per episode, first and mean declaration step, energy at
  declaration, pairwise fidelity of the declarations, shield pass rate,
  and the membranes' alignment to the pattern (sqrt-fidelity) at steps 10,
  30 and 60.

For each feature the check reports the mean for signal and artifact with a
95% confidence interval on the difference. A feature separates the causes
only if the difference is significant (|z| >= 2).

## Measured result (2026-11-07, game.js v0.3.5 + grounds mission)

| feature | signal | artifact | diff [95% CI] | \|z\| |
|---|---:|---:|---:|---:|
| declarations per episode | 2.692 | 2.694 | −0.002 [−0.055, +0.051] | 0.07 |
| first declaration step | 37.747 | 37.766 | −0.019 [−0.844, +0.806] | 0.05 |
| mean declaration step | 43.758 | 43.519 | +0.238 [−0.458, +0.934] | 0.67 |
| energy at declaration | 6.284 | 6.267 | +0.016 [−0.024, +0.056] | 0.80 |
| pairwise fidelity of declarations | 0.855 | 0.855 | −0.000 [−0.002, +0.002] | 0.18 |
| shield pass rate | 0.954 | 0.949 | +0.005 [−0.014, +0.024] | 0.52 |
| alignment to pattern, step 10 | 0.333 | 0.340 | −0.007 [−0.019, +0.005] | 1.17 |
| alignment to pattern, step 30 | 0.769 | 0.772 | −0.003 [−0.017, +0.011] | 0.40 |
| alignment to pattern, step 60 | 0.909 | 0.910 | −0.001 [−0.005, +0.002] | 0.85 |

Control (noise): 0.000 declarations per episode, shield pass 0.0%.

Largest |z| is 1.17 — no feature comes close to significance.

## What it means

**The fingerprint is identical.** The membranes declare at the same time
(first declaration ~step 38, mean ~step 44), with the same energy (~6.28),
the same agreement between declarations (fidelity 0.855), and they align
to the pattern at the same rate (0.33 at step 10, 0.77 at step 30, 0.91 at
step 60) — whether the pattern is a real signal or a shared artifact.
Every confidence interval covers zero.

**The limit is informational, not mechanical.** The artifact and the signal
are the same dynamical object to the membranes: a vector they see noisy
copies of, learned by the same Oja update, crossing the same energy
threshold at the same time. The distinction between "real pattern" and
"common disturbance" is not in the membranes' behavior at all — it is in
where the pattern came from, and the membranes have no access to that.
So no measurement of the membranes' behavior — not the vote, not the
timing, not the energy, not the alignment — can tell them apart.

**What could separate them has to come from outside the membranes:**
an independent channel that does not share the disturbance, a probe of
the input itself, or a prior about which patterns are expected. That is
the next thing to build — a shield that can say "I have no grounds" needs
a source of grounds, and the membranes alone cannot supply one.

## Gate

The check passes only if some behavioral feature separates the causes (a
significant difference). It currently **fails** (exit 1): none does. It
will pass once the game has a mechanism — outside the membranes' behavior —
that distinguishes a shared disturbance from a real signal.
