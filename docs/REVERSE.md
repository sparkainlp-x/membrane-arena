# Reverse Membranes: the arena run backwards

In the arena, a hidden pattern adds energy to the noise, and three membranes climb towards it. On this page everything is reversed. The hidden pattern is dark: one direction has had its energy taken out of every observation. Reverse membranes use the arena's learning rule with the sign flipped, so they slide away from wherever the observations carry energy and settle in the gap. Their "opposite energy" measures how far below chance their energy falls. When it crosses your threshold, they declare.

Play it in `dist/reverse.html` (after `node build.js`). It works offline, makes no network requests, and stores nothing.

This is a game on a SYNTHETIC classical simulation. "Opposite energy" is only the name of a score (1 minus an energy ratio), and a reverse membrane is a learning rule with a minus sign. The membranes are a metaphor. Nothing here models negative energy, antimatter, real membranes, neurons, biology, hardware or any physical system.

## What you do

A contest has 12 rounds of 8 episodes, the same as the arena. In each round, 4 episodes hide a dark pattern and 4 are plain noise. Each round has a seeded darkness between 0.6 and 1: the share of the pattern's amplitude that has been removed. The page shows it before you play the round. Before each round you set four things:

- **Polarity.** Reverse (learn away from energy) or forward (the arena's way round). Every contest starts forward, so the first thing to find out is that forward membranes see nothing here.
- **Opposite-energy threshold** (0.2 to 0.95). A membrane declares when its energy falls this far below chance. A lower threshold finds more patterns, but plain noise dips under it more often.
- **Echo** (0, 1 or 2). How many times each step replays the last 10 observations. Without echo, a missing direction is learned too slowly.
- **Shield.** If on, an output needs 2 of the 3 membranes to agree, as in the arena.

The score is the arena's game score: up to 50 for net true outputs, 25 for precision and 25 for steadiness across rounds. After the last round, the page shows a reference score. That is what reverse membranes with threshold 0.6, echo 1 and the shield get on the same seed when they are set that way from round 1.

The mirror test runs your threshold, echo and shield for 16 episodes in each world (dark pattern or the arena's bright pattern, strength 0.8) with both polarities. Only the matching polarity finds anything.

## What the measurements show

All numbers below come from `node scripts/reverse-check.js`. Its full output is in [reverse-check.txt](reverse-check.txt).

**Polarity has to match the world.** With the shield on, threshold 0.6 and echo 1, 200 episodes per cell (100 with a pattern):

| | Reverse membranes | Forward membranes |
|---|---|---|
| Dark pattern | 99 true, 1 false | 0 true, 0 false |
| Bright pattern | 0 true, 0 false | 80 true, 2 false |

**Echo matters most.** Mean scores over 20 seeds, shield on:

| Setup | Score | True | False | Missed (of 48) |
|---|---|---|---|---|
| Forward, threshold 0.6, echo 1 | 0.0 | 0.0 | 0.0 | 48.0 |
| Reverse, threshold 0.6, echo 0 | 55.3 | 15.3 | 0.3 | 32.8 |
| Reverse, threshold 0.6, echo 1 | 83.8 | 40.5 | 0.3 | 7.5 |
| Reverse, threshold 0.6, echo 2 | 80.0 | 39.1 | 0.7 | 8.9 |
| Reverse, threshold 0.4, echo 1 | 73.0 | 31.9 | 1.7 | 16.1 |
| Reverse, threshold 0.8, echo 1 | 58.6 | 29.2 | 0.0 | 18.8 |
| Reverse, threshold = darkness - 0.1, echo 1 | 86.3 | 41.1 | 0.3 | 6.8 |

Following the darkness helps a little on average, but not every time. Against a fixed 0.6, it scored higher on 11 of the 20 seeds, the same on 1 and lower on 8. Echo 2 is not better than echo 1, because the extra replays make noise episodes dip below the threshold too.

**The best threshold depends on the darkness.** With echo 1, the threshold with the most true outputs minus twice the false ones was 0.5 at darkness 0.6, 0.6 at 0.7, and 0.7 at 0.8, 0.9 and 1.0. At darkness 0.6, no setting finds more than about a third of the patterns.

**The shield is worth keeping.** Without it, every declaration is output. At threshold 0.6 that gives many more true outputs (117.5) but also 13.2 false ones, and the score falls to 61.4.

## How it works

- Each membrane is a unit vector `v` in 16 complex dimensions. Every step, it sees one observation `x` and moves to `v + s·eta·x<x|v>`, then is rescaled to length 1. Forward uses `s = +1` and `eta = 0.5`, which is the arena's Oja rule. Reverse uses `s = -1` and `eta = 1`, which removes the part of `v` along `x` exactly. So `v` drifts towards the direction the observations lack.
- In a dark episode, each observation is a random unit vector with `depth` of its component along the hidden pattern removed, then rescaled. In a bright episode (mirror test only), it is the arena's noisy copy of the pattern.
- The energy ratio is 16 times the mean of `|<x|v>|²` over the last 10 observations. It is about 1 for a random direction and 0 along a fully dark pattern. Opposite energy is `1 - ratio`; forward membranes use `ratio - 1`.
- Every 10 steps, a membrane at or past the threshold declares its vector and freezes. A declaration is true when its fidelity to the hidden pattern is at least 0.5. The shield's agreement test (fidelity 0.4 between declarations) is the arena's.
- Everything is seeded (`membrane-arena/reverse/v1/` namespace), so the same seed and settings always give the same contest. A golden test pins one.

## Why the width is 16, not 32

Learning a missing direction takes about as many observations as there are dimensions, because each anti-Hebbian step removes one direction. Here is one reverse membrane's mean fidelity to a fully dark pattern after the arena's 60 steps (section E of the check):

| Width | Echo 0 | Echo 1 | Echo 2 |
|---|---|---|---|
| 16 | 0.71 | 0.99 | 0.99 |
| 32 | 0.20 | 0.30 | 0.25 |

At width 32 the membranes barely find the gap, so the page runs at half the arena's width, with the arena's 60 steps, 8 episodes and 12 rounds.

## Limits

- The score is a game score. It is not an estimate of anything outside this simulation.
- The darkness is announced before each round, so following it is easy. A version with hidden darkness would be harder.
- A dark pattern at darkness below 0.6 is mostly out of reach in 60 steps; the tide never goes there.
- The arena's stabilizer and amplifier are not used on this page.

## Run and check it

```
node build.js                                  # writes dist/reverse.html with the other pages
node --test tests/*.test.js                    # includes tests/reverse.test.js and tests/reversepage.test.js
node scripts/reverse-check.js --write          # rewrites docs/reverse-check.txt (about 80 seconds)
PLAYWRIGHT_CORE=/path/to/playwright-core node scripts/reverse-e2e-check.js   # headless Chrome playthrough
```

The playthrough plays whole contests by clicking in English and French, on phone and desktop sizes, once by keyboard and once in high contrast. It checks the page's scores against the same contests replayed in Node, and plays one seed with a threshold that follows the darkness. It writes `docs/reverse-e2e-report.json` and screenshots in `docs/screenshots/reverse-*.png`.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
