# Shield strictness — can any voting rule separate the artifact from the signal?

Follow-up to the grounds mission (PR #12). The grounds mission showed the
committee overcommits: it commits on a shared artifact as if it were a
signal (signal 95.5%, artifact 96.6%, coupling off 94.0%), and the
measurement it would request does not separate the causes. Marco Frei's
point: the strongest shield would regulate *when* the committee has grounds
to decide.

This check asks the next question: **does any voting rule separate them?**
It sweeps the shield's two knobs — the agreement threshold (the fidelity
two declarations need to count as agreeing) and the required count (2 of 3
vs unanimous 3 of 3) — and measures the shield pass rate for a planted
signal and for a full-strength shared artifact at every setting.

## Method

`scripts/shield-strictness-check.js`. The game's real `episode()`
(unmodified) with the default membrane params (th 0.5, c 0.05, g 1.0),
N=32, game sigma 0.2652. K=500 episodes per cell.

- **signal** — a fresh planted pattern per episode (positive control).
- **artifact** — a fresh shared vector per episode, beta=1 (a common-mode
  disturbance; every membrane sees noisy copies of the same vector).
- **noise** — no pattern (control; any pass is a false event).

The 2-of-3 rule is the game's own `systemEvent(decls, thresh)`. The 3-of-3
rule applies the same counting with a unanimity requirement, re-implemented
locally from the exported `fidelity()` (the `agreeing()` helper is not
exported) and verified to reproduce `systemEvent()` exactly at required=2
over 200 episodes.

## Measured result (2026-11-07, game.js v0.3.5 + grounds mission)

Shield pass rate, K=500 per cell:

| thresh | required | signal | artifact | noise | gap (signal − artifact) |
|-------:|---------:|-------:|---------:|------:|------------------------:|
| 0.4 | 2 of 3 | 95.0% | 96.6% | 0.0% | −1.6 pts |
| 0.4 | 3 of 3 | 73.0% | 82.0% | 0.0% | −9.0 pts |
| 0.6 | 2 of 3 | 95.0% | 96.6% | 0.0% | −1.6 pts |
| 0.6 | 3 of 3 | 73.0% | 82.0% | 0.0% | −9.0 pts |
| 0.8 | 2 of 3 | 92.8% | 95.6% | 0.0% | −2.8 pts |
| 0.8 | 3 of 3 | 70.4% | 80.2% | 0.0% | −9.8 pts |

Reference rates from the shared-disturbance test (2026-11-06, 1000 eps):
signal 95.5%, artifact 96.6% — the 2-of-3 / 0.4 cell reproduces them.

## What it means

**No voting rule separates them.** At every setting the artifact is
committed at least as often as the real signal — the gap is negative
everywhere, never positive. Raising the agreement threshold (0.4 → 0.8)
barely moves either rate: the declarations agree at high fidelity whether
they come from a signal or an artifact.

**Strictness backfires.** Requiring unanimity (3 of 3) hurts the signal
*more* than the artifact: signal falls 95.0% → 73.0% (−22 pts) while the
artifact falls only 96.6% → 82.0% (−14.6 pts), so the gap widens from −1.6
to −9.0 pts. The artifact is more robust to strictness than the signal,
because it is a common input every membrane sees identically, while a real
signal has to survive the noisy learning dynamics. Making the vote stricter
does not buy grounds — it buys fewer true commits and relatively more false
ones.

**The identifiability limit holds across the whole rule space**, not just
at the 2-of-3 / 0.4 setting. The responses the shield sees do not contain
the distinction between the causes, so no rule computed from those
responses can recover it. A fix cannot be a stricter vote. It would have
to be a different *kind* of evidence — a measurement that is not the
membranes' responses (an independent channel, or a probe of the input
itself), or a shield that can say "I have no grounds" and abstain.

## Gate

The check passes only if some setting separates the causes (signal ≥ 50%
and artifact ≤ 25% at that setting). It currently **fails** (exit 1): no
setting does. It will pass once the game defends against shared disturbance
with a mechanism that is not a stricter vote.
