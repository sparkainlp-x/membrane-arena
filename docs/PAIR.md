# Reverse Pair: a two-membrane shield

Play it: https://sparkainlp-x.github.io/membrane-arena/pair.html, or build with `node build.js` and open `dist/pair.html`. It is one self-contained file that works offline.

SYNTHETIC classical simulation. "Opposite energy", "membrane", "tone", "channel" and "fade" are names for parts of a game. Nothing here models negative energy, antimatter, real membranes, neurons, oscillators, radio hardware or any physical system. The results below are about this simulation only.

## The short version

On 120 held-out contests, the full pair (observer, calibrator, equalizer and shield, at 2 : 1) beats the observer alone by a wide margin, with fades on the calibrator's tones and with fades between them. Off-grid, the benefit shrinks by about a third but does not disappear. Most of the real work is done by the equalizer. The shield's large score gain is almost entirely the arena's scoring rule, not filtering: its filtering effect is too small to detect, and off-grid it stops more true outputs than false ones.

## The idea

Two membranes share one channel and take turns on one clock. The **observer** is a reverse membrane from the [Reverse Membranes](REVERSE.md) page: it learns away from energy and hunts a hidden pattern made of missing energy. You cannot know in advance what it will find. The **calibrator** is the predictable one. It does not learn. It plays known sine tones through the channel and reads back how much of each arrives, so on a clean channel every reading is 1. The catch: in most episodes a fade dims part of the channel, and a fade also looks like missing energy. Left alone, the observer cannot tell the two apart. The calibrator can, because it knows what it should hear.

| | Observer | Calibrator |
|---|---|---|
| Learns? | Yes: the reverse (anti-Hebbian) rule, width 16, echo 1 | No |
| Sees | Observations with the hidden dark pattern, through the channel | Its own known tones, through the channel |
| Predictable? | No: it settles wherever energy is missing | Yes: on a clean channel it reads 1 on every frequency |
| Votes | By declaring, once its opposite energy reaches the threshold at a check (every 20 ticks) | No, if at least half of what the observer found sits in frequencies it reads below 0.7 |

## The tones and the tick

Each tone is a signed-amplitude sine code, the same coding as the Digital-to-Wave testbench: each of the 16 components gets amplitude |sin|, with phase π/4 where the sine is positive and 5π/4 where it is negative. There are 9 frequencies, from 0 to 8 cycles across the 16 components, and the calibrator plays them in order, one per tick. A reading is what comes back of the tone, plus reading noise with standard deviation 0.05.

There are 120 ticks per episode. With a share of 2, the pattern is two observer ticks, then one calibrator tick, and so on: 80 observer ticks and 40 calibrator ticks per episode. At 1 : 1 it is 60 and 60, at 3 : 1 90 and 30, at 4 : 1 96 and 24. More observer ticks mean more learning; fewer calibrator ticks mean older readings while the fade keeps moving.

## Two kinds of fade

In 75% of episodes a fade removes part of the energy in a small set of slow sinusoids, and the removed share rises and falls 0.5 to 2 times per episode, down to 0.05 to 0.4 of full strength at the bottom.

- **On-grid** fades cover exactly one of the calibrator's frequencies (1 to 7). This is the calibrator's home advantage: one tone sees the whole fade.
- **Off-grid** fades are centred between two tone frequencies (0.2 to 0.8 of the way from one to the next) and have a random width of 0 to 1.5 cycles. Their energy leaks across several tones, so the calibrator sees several partial dips, and dividing by its readings cannot undo the fade exactly.

Both kinds use the same seeds, so a given episode has the same pattern, noise, readings and fade timing either way; only the fade's position changes.

The **equalizer** divides each frequency of each observation by the calibrator's latest reading (never by less than 0.15) before the observer learns. The **2-membrane shield** is the arena's 2-of-3 shield cut down to two: an output needs both votes. Scoring is the arena's: net finds (50 points), precision (25) and steadiness (25), and an output without the shield counts a third.

## How it was evaluated

The protocol was written and frozen before the run: [PAIR-PROTOCOL.md](PAIR-PROTOCOL.md). Thresholds were chosen on 40 calibration seeds only. The results come from 120 separate held-out seeds that were never used for tuning. Every method meets the same worlds on each seed, so comparisons are paired. Each number is a mean per contest with a 95% bootstrap interval over seeds (10000 resamples), and each comparison also gives the effect size d_z. A difference only counts if its interval excludes zero.

The methods: a random-declare baseline; the observer alone (all 120 ticks); ticks only (the calibrator takes its ticks but its readings are unused); observer and equalizer; observer and shield; the full pair; and an oracle that knows the true fade, undoes it exactly and vetoes declarations that sit on it.

One command regenerates every number: `node scripts/pair-check.js --write`. It writes the report [pair-check.txt](pair-check.txt), [pair-results.json](pair-results.json), a per-seed [pair-results.csv](pair-results.csv), and [pair-manifest.json](pair-manifest.json) with the seeds, versions and SHA-256 hashes of the inputs and outputs. `node scripts/pair-check.js --verify` recomputes everything and fails if any file differs.

## Results at 2 : 1 (held-out, mean per contest [95% interval])

| Method | Score, on-grid | Score, off-grid | False outputs, on-grid | False outputs, off-grid |
|---|---|---|---|---|
| Random declare | 10.5 [9.4, 11.5] | 10.5 [9.4, 11.5] | 47.7 | 47.7 |
| Observer alone | 41.9 [41.1, 42.8] | 36.9 [35.9, 37.9] | 17.4 | 20.4 |
| Ticks only | 44.2 [43.1, 45.3] | 36.0 [34.8, 37.3] | 10.6 | 14.9 |
| Observer + equalizer | 55.9 [55.1, 56.6] | 45.4 [44.4, 46.5] | 5.2 | 7.1 |
| Observer + shield | 74.1 [72.9, 75.2] | 63.3 [62.2, 64.5] | 2.5 | 2.5 |
| Full pair | 83.1 [81.8, 84.3] | 64.7 [63.3, 66.1] | 2.3 | 6.0 |
| Oracle | 92.7 [92.0, 93.5] | 86.2 [85.3, 87.0] | 1.3 | 1.1 |

Paired differences (A minus B):

- **Full pair against the observer alone, score:** +41.11 [39.80, 42.42] on-grid (d_z 5.51) and +27.78 [26.31, 29.25] off-grid (d_z 3.42). The pair won on all 120 seeds in both cases.
- **False outputs, same comparison:** -15.15 [-15.82, -14.48] on-grid and -14.33 [-14.99, -13.68] off-grid.
- **The home advantage:** the score benefit is 13.33 [11.63, 14.98] points smaller off-grid. So the benefit shrinks without the home advantage, but it does not disappear.
- **The equalizer against ticks only:** +11.68 [10.54, 12.84] on-grid and +9.40 [8.22, 10.58] off-grid. The share of declarations sitting mostly on the fade falls from 28.6% to 1.2% on-grid, and from 58.5% to 31.9% off-grid. Off-grid fades span 4.92 of 16 dimensions on average, so the chance level there is 9.1% (the random baseline); the equalizer leaves the observer well above chance.
- **Giving ticks away** to a calibrator whose readings are not used: +2.27 [1.15, 3.37] on-grid, and -0.87 [-2.08, 0.35] off-grid, which is no detectable difference.
- **The oracle gap:** the full pair is 9.68 [8.37, 10.95] points short of the oracle on-grid and 21.47 [19.91, 23.00] short off-grid. That gap is what nine tones cannot see.

Across tick shares (on-grid, full pair): 73.7 at 1 : 1, 83.1 at 2 : 1, 83.2 at 3 : 1 and 80.5 at 4 : 1. Off-grid: 59.6, 64.7, 63.7 and 62.9.

## The shield: filtering or scoring rule?

The full pair's lead over observer + equalizer splits into two parts at the pair's threshold. Filtering is what the shield's vote changes, counted under the same scoring rule. Weighting is the arena rule that unshielded outputs count a third.

| | Total | Filtering | Weighting |
|---|---|---|---|
| On-grid | 26.81 [26.34, 27.27] | -0.07 [-0.17, 0.03] | 26.88 [26.42, 27.34] |
| Off-grid | 19.25 [18.60, 19.89] | -0.16 [-0.55, 0.22] | 19.42 [18.85, 19.97] |

Both filtering intervals cross zero: once the equalizer is on, the shield's vote makes no detectable difference to the score. It does stop some false outputs (0.12 [0.06, 0.18] per contest on-grid and 1.02 [0.84, 1.21] off-grid), but it also stops true ones (0.30 [0.20, 0.41] on-grid and 1.89 [1.65, 2.13] off-grid). Off-grid it stops more true outputs than false ones. Without the equalizer the vote does real work: observer + shield has 8.09 fewer false outputs than ticks only on-grid and 12.50 fewer off-grid, although those two use different thresholds.

## Calibration check: predicted against measured

The calibrator's predicted mean error on a clean tone is 0.05 × √(2/π) = 0.0399. On tones the fade does not touch, measured on held-out seeds, the prediction fell inside the 95% interval in 32 of 36 frequency and share cells on-grid, and 32 of 36 off-grid. With 36 cells, about 34 would be expected at 95% coverage, so this is a close match.

On the tone most inside the fade, the error includes stale readings and grows as the calibrator ticks less:

| Share | Faded tone error, on-grid | Faded tone error, off-grid |
|---|---|---|
| 1 : 1 | 0.1486 [0.1472, 0.1500] | 0.1415 [0.1401, 0.1429] |
| 2 : 1 | 0.2067 [0.2046, 0.2089] | 0.1957 [0.1935, 0.1979] |
| 3 : 1 | 0.2514 [0.2488, 0.2540] | 0.2373 [0.2348, 0.2397] |
| 4 : 1 | 0.2843 [0.2816, 0.2869] | 0.2694 [0.2668, 0.2719] |

The growth from 1 : 1 to 4 : 1 is 0.1357 [0.1337, 0.1377] on-grid and 0.1279 [0.1260, 0.1297] off-grid. The full per-frequency tables are in [pair-check.txt](pair-check.txt). The page's quick check counts a tone as clean when less than 1% of it lies inside the fade, because off-grid fades leak a little into every tone; the report uses tones the fade does not touch at all.

## Honest limits

- This is a game. The channel, the fades and the noise are all invented, and the reading noise is fixed and known, which is what makes the calibrator's prediction exact.
- Off-grid fades remove the calibrator's home advantage only partly: they still change gain on slow sinusoids, which suits a calibrator that measures gains.
- The "on the fade" rule (at least half of a vector's energy in the fade subspace) is not adjusted for the fade's size, so its chance level differs between the two kinds; the random baseline reports it.
- The calibrator's estimate is just its latest reading for each frequency. It does no smoothing and no forecasting.
- The threshold grid was 0.40 to 0.85 in steps of 0.05; finer grids or other scoring rules could change the rankings.

## Files

- `pair.js`: the logic (no DOM), built on `game.js` and `reverse.js`.
- `pair.html`, `pair.css`, `pair-i18n.js` (English and French), `pairui.js`: the page, built to `dist/pair.html`.
- `scripts/pair-check.js`: the evaluation; `docs/PAIR-PROTOCOL.md`: the frozen protocol.
- `scripts/pair-e2e-check.js`: a headless Chrome playthrough (writes `docs/pair-e2e-report.json` and `docs/screenshots/pair-*.png`).
- `tests/pair.test.js`, `tests/pairpage.test.js`: tests, run with `node --test tests/*.test.js`. They check that the page and this file quote the report.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
