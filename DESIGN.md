# Design

Membrane Arena turns the three-membrane contest of [crystallization-contest](https://github.com/sparkainlp-x/crystallization-contest) into a game that is honest about what that contest did and did not show. This file records the decisions and their reasons.

## Fidelity to the repository

`game.js` is a port of `crystallization_contest/{events,rewards,contest}.py` at width n = 32, the smallest measured width, so the width-32 rows of the results tables apply directly.

- Vectors live in C^32 (two Float64 arrays). Observations are noisy copies of the planted pattern (complex Gaussian noise, sigma = 1.5 / sqrt(n)) or random unit vectors.
- Each membrane takes an Oja step, then a coupling step toward each peer (`c`, phase-aligned), then renormalises. Membranes that have declared stop updating. Random numbers are drawn in the same order as the Python code.
- Every 10 steps (of 60) an undeclared membrane declares when `gain * n * mean(last 5 |<x|v>|^2)` reaches `1 + q * n / (1 + 2 sigma^2 n)`, with `q = min(1.5, th * (2 - sp))` and `sp` the membrane's running confirmation rate.
- Truth: the episode is planted and fidelity to the pattern is at least 0.5. Agreement between two declarations: fidelity at least 0.4.
- Shield: the first declared membrane confirmed by at least two of three (itself included) leaves; otherwise nothing leaves.
- Amplifier: the next episode's starting vectors blend toward the last output with weight at most 0.5.
- Stabilizer: a leaky integrator of the output rate (leak 0.3, target 0.5) scales the gain by `max(0.2, 1 - 1.5 (rate - 0.5))`; the evolved gain is clamped to [0.33, 3].
- (1+1)-ES: per generation each membrane mutates `th` (log-normal, 0.2), `c` (normal, 0.05, clamped to [0, 0.5]) and `g` (log-normal, 0.2), and keeps the mutation if its score is at least its best so far. Score: `w * joint + (1 - w) * rank bonus`, as in the repository.

The generators differ (xmur3 seeding plus mulberry32 and Box-Muller here, Python's Mersenne Twister there), so runs are not bit-identical. `scripts/port-check.js` compares the port with the repository's 12 width-32 rows over 100 seeds each and writes `docs/port-check.txt`; the largest difference was 1.07 combined standard errors over 36 comparisons. That describes agreement, it is not a proof of equivalence.

## What the game adds, and says so

- **Reward schemes.** The repository's contest had no reward scheme; schemes were measured separately (Experiment 1). To make the choice playable the game adds `0.25 x` the summed per-episode scheme reward (`rewards.py`, for three agents) to each membrane's selection score. "None" is exactly the repository's contest. The UI states that this combination was not measured, and `docs/scheme-check.txt` shows what it did in this port: little.
- **Cost per false event.** The repository's `fcost` option, exposed as a slider (default 0).
- **Game score.** `50 x net + 25 x precision + 25 x steadiness`. Net counts an unshielded output as 1/3 of an episode and a shielded one as 1 so that the two modes are comparable, divided by the 48 planted episodes and clamped. Steadiness is `1 - rate variance / 0.05`, clamped; with no output at all it is 0, so staying silent earns nothing. These weights are a design choice; the results screen says part of the shield's steadiness is mechanical.
- **Seeded starting parameters.** `startFor(seed)` draws the starting threshold (0.30 to 0.80), coupling (0 to 0.30) and gain (0.70 to 1.50). A fixed daily start makes steering matter: from a poor start, evolution helps; from the repository's start it can lose (`docs/evolve-check.txt`). Starting values lock when a run begins; switching evolution off freezes them.
- **Baseline score.** The same formula applied to the repository's mean counts, labelled approximate.

## Lazy generation stepping

The player may change settings while the contest runs. `stepGeneration(contest, settings)` computes one generation (about 10 ms) with the settings in force at its start; the canvas then replays it as a timeline. Earlier generations never change, which is tested. Settings changed mid-generation apply from the next one, and the UI says so.

## Timeline and rendering

`buildTimeline` turns a generation record into events (declarations, per-episode outputs, generation end) at times set by a fixed 60 steps per second at 1x. The arena advances the clock by `dt x speed` and fires each event exactly once (tested against arbitrary frame sizes), so the animation, the counters, the ribbon and the announcements share one clock.

- Membranes: six wavy rings per membrane whose amplitude grows with the ratio of energy to threshold; colour runs from dim navy to the membrane's hue at threshold, to near white above; a progress arc shows the same ratio.
- Particles: a pooled array of at most 320 (observation flow from the source, link flow between membranes at a rate proportional to `c`).
- Bursts: a true declaration grows a hexagonal gold lattice; a false one draws grey cracks and speckle. Truth is shown only at the declaration, never before it. Shield pass flashes the triangle gold; a held declaration draws a dashed grey triangle.
- Colour is never the only signal: events differ in shape, the ribbon uses letters (T, F, H) and every outcome is announced in text.
- Reduced motion (media query, live) removes ripples and particles and shows bursts at full size, fading by opacity only.
- The device pixel ratio is capped at 2, and the draw loop clamps `dt` so a hidden tab does not leap ahead.
- Draw cost was 0.5 to 0.7 ms per frame on average in the headless pass (`docs/e2e-report.json`).

## Accessibility

Keyboard: Space, G, F, S, plus every control is a native element. An `aria-live` region announces each generation summary, and each episode event at 1x and 2x (faster speeds would flood a screen reader). The three gains and the output rate are `role="meter"` with value text. The canvas is `role="img"` with a text alternative, since all information is repeated as text. Buttons and inputs are at least 44 px high. Focus is visible and the help dialog traps Tab and closes on Escape.

## Data handling

- **Hash.** `parseHash` accepts `d` (a real date on or after 2026-10-24), `s` (1 to 24 of `[A-Za-z0-9_-]`), `b` (integer 0 to 100), `l` (two lowercase letters), `c` (a strict preset pattern) and nothing else. Over-long or malformed input falls back to the daily contest. A seed is data: `__proto__` is a legal seed and never used as a property name.
- **Storage.** `sanitizeStore` rebuilds the record entry by entry; wrong types, impossible dates, out-of-range scores and unknown tags are dropped. If `localStorage` throws, the game continues and says the record will not persist.
- **Share card.** Plain text, no emoji, at most 40 characters per line (tested for the worst case in both languages), with the SYNTHETIC label.

## Known weaknesses

- The game's scoring and the scheme bonus are design choices, not findings.
- Only width 32 is simulated; the repository's other widths are not shown.
- Eight episodes per generation make the evolution step noisy by construction; a single run is one sample.
- The daily result can be computed from the page source.
- Headless-Chrome checks run on software rendering; phone hardware was not tested.
