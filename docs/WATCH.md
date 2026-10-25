# Pair Watch

**SYNTHETIC.** Pair Watch is a game on a classical simulation. "Opposite energy", "membrane", "tone" and "channel" are names for parts of the game. Nothing here models negative energy, antimatter, real membranes, neurons, oscillators, radio hardware or any physical system.

Pair Watch is the visual, playable side of [Reverse Pair](PAIR.md). Two membranes watch one channel and take turns on one clock. You are the second vote of their 2-membrane shield: when the observer declares a find, you accept it or veto it.

Play it: [`watch.html`](../watch.html) (live at <https://sparkainlp-x.github.io/membrane-arena/watch.html>). It works offline, in English and French, on a phone, and in high contrast. It makes no network requests and stores nothing.

## What you see

- **The observer** is the round membrane on the left (on top on a phone). It is a reverse membrane: it learns away from energy and hunts a hidden dark pattern. Its **dark core** grows as its opposite energy rises. Its outline bulges toward the lanes its current find uses.
- **The threshold ring** is the dashed gold circle inside it. At a check, every 20 ticks, a core that has reached the ring declares a find.
- **The calibrator's lanes** are the nine bars on the right, one per known sine tone (0 to 8 cycles). On its ticks the calibrator plays one tone down one lane (you see the wave run down it) and the bar shows how much came back. A clean lane reads about 1. Older readings are fainter, because the fade can rise and fall between visits.
- **The red dashed line** is 0.7. A lane read below it counts as faded, and the bar turns red.
- **The cyan glow** at the foot of each lane shows where the observer's find sits.
- **The tick rail** across the top shows whose turn each tick is: cyan for the observer, gold for the calibrator, with the lane it will read.
- **The trace** at the bottom is the observer's opposite energy over the wave, with the threshold line and the checks.
- **After your call**, white dashes show the true channel at that tick, so you can see whether the calibrator's readings were right.

## How a wave plays

1. Before the wave, set the **tick**: how many observer ticks come for each calibrator tick (1 to 4). More observer ticks mean faster learning but older readings. From stage 2 you can also turn on the **equalizer**, which divides what the observer sees by the calibrator's latest readings.
2. Press **Play**. The wave runs tick by tick (1×, 2× or 4×; reduced-motion settings start at 4×). You can pause or skip ahead.
3. If the observer declares, the wave stops. The page tells you the opposite energy, the threshold and how much of the find sits in lanes the calibrator reads as faded. **Accept** or **veto**.
4. The truth appears: was a dark pattern planted, did the find match it, and was the fade behind a false find? You also see what the calibrator's own shield vote would have done.

Keys: A accept, V veto, Space play or pause, S skip ahead, N next wave.

## Three stages

| Stage | Waves | Equalizer | Fades |
| --- | --- | --- | --- |
| 1. The observer alone | 8 | locked off | on one of the calibrator's tones (on-grid) |
| 2. The equalizer unlocks | 8 | your choice | on-grid |
| 3. Off-grid | 8 | your choice | between the tones, leaking across lanes as partial dips |

Stage 3 follows the Reverse Pair finding that the calibrator loses its home advantage when fades fall between its tones.

## Points

These are this game's own points, not the arena score.

| What happened | Points |
| --- | --- |
| You accepted a real find | +100 |
| You accepted a false find | −150 |
| You vetoed a false find | +60 |
| You vetoed a real find | −40 |
| No declaration, no dark pattern (a quiet wave) | +10 |
| A dark pattern was planted but never declared | −20 |

Each good call in a row adds a streak bonus of 10 more than the last (0, 10, 20, 30, then 40 at most). At the end your calls, without the streak bonus, are compared on the same waves and settings with the calibrator's own shield vote (veto when at least half the find sits in lanes read below 0.7), with accepting every find, with vetoing every find, and with perfect calls.

## The coach

Turn on **Coach** to get a second opinion at each declaration. The coach is a small logistic model that sees only what you see at that moment: the stage (on-grid or off-grid fades), whether the equalizer is on, the faded share of the find, the tick of the declaration and the tick share. It shows its estimate that the find is real, with a 95% interval, on a meter marked at the break-even point.

The break-even point comes straight from the points table. Accepting is worth more than vetoing exactly when the chance the find is real is above (60 − (−150)) / ((100 − (−150)) + (60 − (−40))) = 210 / 350 = **0.6**. The coach advises accepting above 0.6 and vetoing below.

The coach is advice only: your own call is what scores. At the end, the table also shows what the coach's calls would have earned on your waves and settings. The coach was fitted once, on 200 calibration runs, and then frozen in `watch-coach.js`; the page never refits it. Its intervals cover the uncertainty of its coefficients, not of a single wave.

## Replay codes

When a run ends, the page shows a **replay code**, one letter per wave (your tick share, equalizer and call) plus two check characters, and puts it in the page address. Opening a link with a seed and a code replays the run from the seed and shows the checked points and the comparison table. Because every point is recomputed from the seed, a code can only ever show the score its calls really earn. The check characters catch typing and copying mistakes. A code is also rejected if it turns the equalizer on in stage 1, or if its calls do not fit the waves (a call where there was no declaration, or none where there was).

## Does the coach help? Held-out results

The evaluation followed a protocol frozen and hashed before the held-out run: [WATCH-PROTOCOL.md](WATCH-PROTOCOL.md). The coach was fitted on calibration seeds `wcal-000` to `wcal-199`, and every number below comes from 200 separate held-out runs, `wtest-000` to `wtest-199`. Intervals are 95% percentile bootstrap intervals over held-out seeds (2000 resamples). Points are per 24-wave run, without the streak bonus. The full report is [watch-check.txt](watch-check.txt); per-run results are in [watch-results.csv](watch-results.csv) and [watch-results.json](watch-results.json).

**Calibration (H1).** Over 17749 held-out declarations, the coach's expected calibration error is 0.0083 [0.0063, 0.0136]. Its Brier score is 0.0865 [0.0823, 0.0907], against 0.1725 for always guessing the average. Both meet the protocol's bar.

**Points in the default settings** (tick share 2, equalizer on when unlocked):

| Calls | Points per run | False finds kept | Real finds vetoed |
| --- | --- | --- | --- |
| Coach | 1084.8 [1055.0, 1113.5] | 0.81 [0.70, 0.94] | 0.29 [0.21, 0.37] |
| Calibrator's shield | 1053.0 [1022.7, 1084.6] | 0.83 [0.71, 0.95] | 0.49 [0.40, 0.58] |
| Accept every find | 914.4 [878.6, 951.2] | 1.82 [1.64, 1.99] | 0.00 |
| Random calls | 293.5 [253.1, 335.1] | 0.99 [0.87, 1.11] | 5.68 [5.42, 5.93] |
| Veto every find | −221.0 [−234.6, −208.0] | 0.00 | 10.84 [10.70, 10.99] |
| Perfect calls | 1296.6 [1283.6, 1310.2] | 0.00 | 0.00 |

**Paired by seed:**

- **H2:** the coach minus the shield is +31.9 [+16.5, +47.6] points per run (d_z 0.28; 50 runs won, 138 tied, 12 lost). That is a small effect. Most runs tie because the two agree on most declarations. They disagree on 82 held-out declarations: the coach is right on 63, mostly by keeping real finds that the shield vetoes.
- **H3:** the coach minus accepting every find is +170.5 [+141.7, +200.2] (d_z 0.80).
- **H4:** the shield minus accepting every find is +138.6 [+110.2, +169.1] (d_z 0.66).
- Perfect calls would still score 211.7 [184.8, 239.8] more per run than the coach, so there is room left for a better player.

In the exploratory table of all eight settings profiles, the coach is ahead of the shield in each one. The smallest margin is +20.7 [+1.4, +38.9] at tick share 1 with the equalizer off. That table has no correction for multiple comparisons. These results apply to this simulation only.

## How it connects to the Reverse Pair results

Every wave is an exact Reverse Pair episode from `pair.js`. The page recomputes the episode tick by tick to draw it, and the tests check that this matches `pair.js` number for number. They also check that the faded share shown at a declaration gives exactly the calibrator's vote. The thresholds are the ones chosen on calibration seeds for the Reverse Pair evaluation: 0.65 on-grid and 0.70 off-grid.

The game does not change `pair.js`, the frozen protocol ([PAIR-PROTOCOL.md](PAIR-PROTOCOL.md)) or the held-out results ([pair-check.txt](pair-check.txt)). Game seeds use their own namespace (`~watch`), separate from the evaluation's calibration and held-out seeds. A single run is one seed; for the Reverse Pair results with confidence intervals, read [PAIR.md](PAIR.md), and for the coach's, the section above. The Pair Watch evaluation has its own seeds (`wcal-` and `wtest-`), its own protocol and its own report, and it re-runs no Reverse Pair number.

## Checks

- `node --test tests/*.test.js` runs `tests/watch.test.js` (the game logic, the match with `pair.js`, the points and streaks, golden runs), `tests/watchpro.test.js` (the coach, the break-even point, replay codes and their rejections, the manifest hashes, and that the page and this document quote the report) and `tests/watchpage.test.js` (the page, both languages, links, the build and this document).
- `node scripts/watch-check.js --write` regenerates `watch-coach.js`, `docs/watch-check.txt`, `docs/watch-results.json`, `docs/watch-results.csv` and `docs/watch-manifest.json` (seeds, versions and SHA-256 hashes of every input and output). `node scripts/watch-check.js --verify` reruns everything and fails if any output differs.
- `node scripts/watch-e2e-check.js` plays whole runs in headless Chrome by clicking and by keyboard, in English and French, on a phone and a desktop, once in high contrast and once with reduced motion. It replays the same calls in Node and checks the page's points, every wave's outcome and the end table. With the coach on, it checks that every estimate shown matches Node and that following the coach ties the coach's row. It also opens the run's replay link to check the replayed points, and confirms that a code with one character changed is rejected. Screenshots go to `docs/screenshots/watch-*.png` and the report to `docs/watch-e2e-report.json`.

## Files

`watch.js` (game logic, the coach's features and policies, replay codes), `watch-coach.js` (the frozen fitted coach, generated), `scripts/watch-check.js` (the evaluation), `watch.html`, `watch.css`, `watch-i18n.js` (English and French), `watchui.js` (the canvas scene and controls), `dist/watch.html` (one self-contained file, built by `node build.js`).

Membrane Arena. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
