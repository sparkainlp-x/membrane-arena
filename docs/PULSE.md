# Wave Pulse

**SYNTHETIC.** Wave Pulse is a game on a small classical simulation. It is not a model of a real arena floor, real pressure waves, holography, sensors or any physical system. The Great Wave look is a colour style only. Every number below is about this simulation and this game, nothing else.

Play it: https://sparkainlp-x.github.io/membrane-arena/pulse.html (or locally by opening `dist/pulse.html`: one self-contained file, offline, nothing stored). It is page 7 of Membrane Arena and links to the other six.

## The game in one minute

A big win or a crowd cheer sends a ripple across a 40 × 26 membrane grid. The floor is covered: you only see what the sensors at its edge recorded. Press **Listen**, watch the recordings come in, then tap where you think the ripple started and press **Confirm**. The ripple is replayed in a Great Wave colour style, with the true start (star), your guess (ring) and the locator's answer (cross).

- **Points:** 100 minus 12 per cell of error, never below 0. A hit is within 2 cells.
- **Stage 1 (pulses 1-4):** big wins, 8 sensors, calm.
- **Stage 2 (pulses 5-8):** crowd cheers (3 to 5 smaller bumps a few ticks apart) with loud noise.
- **Stage 3 (pulses 9-12):** a patchy floor with a hidden slow patch, and only the 4 corner sensors.
- **Locator hint:** shows the locator's answer and its 90% region before you confirm. It is advice, not the answer.
- **Free waves:** tap anywhere to send a wave from that cell, or send a crowd cheer; turn the patchy floor on to see the slow patch bend the rings. Nothing is scored.
- **Keys:** Space listens or moves to the next pulse, arrows move your marker (Shift for 2 cells), Enter confirms, H toggles the hint.

The end-of-run table compares you with the locator, the early-sensor average and always guessing the centre. The same seed always gives the same 12 pulses. A run's **replay code** (three letters per guess plus two check letters) can be shared as a link; opening it replays every guess from the seed and recomputes the score, so a code can only show what its guesses really earn. The check letters catch copying mistakes; they are not a signature.

## How the simulation works

- **Grid:** 40 × 26 cells, damped wave equation, explicit finite-difference step, nominal speed 0.5 cells per tick, damping 0.004, walls that reflect. 130 ticks; the trigger is at tick 20.
- **Triggers:** a big win is one Gaussian bump; a crowd cheer is 3 to 5 smaller bumps, and its "start" is their amplitude-weighted centre.
- **Patchy floor:** one hidden elliptical patch where waves travel at 45-65% of the normal speed.
- **Sensors:** 8 points at the edge (4 corners, 4 mid-edges), or the 4 corners. Each hears only the height under it, plus Gaussian noise (calm 0.004, loud 0.025).
- **Detector:** a sensor's arrival is the first tick where its 3-tick smoothed recording leaves the quiet level by more than k times its quiet wobble (k = 7).
- **Locator:** time-difference-of-arrival least squares. It tries every cell, then refines to 1/8 cell, and keeps the point whose distances best explain the arrival differences at one speed (c = 0.46 cells per tick), with an unknown start time. With fewer than 3 arrivals it falls back to the centre. Its 90% region is every half-cell point whose cost is within rho = 181.7 ticks² of the best.
- **Baselines:** early-sensor average (sensor positions weighted by how early they heard it), nearest sensor, centre, a seeded random guess, and a noise-free reference (the same locator on clean recordings).

## How good is the locator? (held-out evaluation)

The protocol, [docs/PULSE-PROTOCOL.md](PULSE-PROTOCOL.md), was written and frozen (SHA-256 recorded) before any run. The detector threshold, the locator speed and the region size were chosen on 200 calibration pulses (`pcal-000` to `pcal-199`) only. Every result comes from 200 separate held-out pulses (`ptest-000` to `ptest-199`), each played in all 16 settings (trigger × sensors × noise × floor). Brackets are 95% percentile bootstrap intervals over pulses (2000 resamples); proportions use Wilson intervals. Full report: [docs/pulse-check.txt](pulse-check.txt).

**Default setting (big win, 8 sensors, calm, even floor):**

| method | error (cells) | hits within 2 cells | game points |
|---|---|---|---|
| locator | 0.62 [0.57, 0.68] | 99.5% [97.2%, 99.9%] | 92.6 [91.9, 93.2] |
| early-sensor average | 3.05 [2.89, 3.21] | 16.0% [11.6%, 21.7%] | 63.5 [61.7, 65.3] |
| nearest sensor | 8.14 [7.84, 8.45] | 0.0% [0.0%, 1.9%] | 12.0 [9.8, 14.3] |
| centre | 9.34 [8.79, 9.89] | 3.0% [1.4%, 6.4%] | 14.8 [11.9, 18.1] |
| random | 12.47 [11.61, 13.40] | 2.0% [0.8%, 5.0%] | 11.6 [8.6, 14.6] |
| noise-free reference | 0.44 [0.42, 0.47] | 100.0% [98.1%, 100.0%] | 94.7 [94.4, 95.0] |

**The six hypotheses written into the protocol all held.** Each is a paired difference across the same 200 pulses, in cells, with Holm-corrected sign-flip permutation p-values:

| hypothesis | difference | effect size d_z | result |
|---|---|---|---|
| H1 centre error − locator error | +8.72 [+8.20, +9.24] | 2.27 | supported |
| H2 early-sensor average − locator | +2.43 [+2.29, +2.57] | 2.42 | supported |
| H3 patchy floor − even floor | +0.65 [+0.53, +0.78] | 0.68 | supported |
| H4 loud − calm | +0.90 [+0.69, +1.13] | 0.55 | supported |
| H5 4 sensors − 8 sensors | +0.13 [+0.07, +0.18] | 0.35 | supported |
| H6 crowd cheer − big win | +0.33 [+0.27, +0.39] | 0.73 | supported |

The cost of having only 4 sensors is real but small (0.13 cells).

**The three game stages, held-out:** stage 1 locator error 0.62 [0.57, 0.68] cells; stage 2 (cheers, loud) 2.01 [1.72, 2.32]; stage 3 patchy floor with 4 sensors, 1.53 [1.37, 1.70] for wins and 1.63 [1.47, 1.79] for cheers.

## What did not work

- **The 90% region is calibrated in only 2 of 16 settings.** On a calm, even floor it holds the start 99.5% of the time (too wide); with loud noise on a patchy floor only 59.0% [52.1%, 65.6%] (too narrow). One fixed region size cannot fit every setting. The game still shows it, labelled as the locator's 90% region, and the evaluation section on the page says it is miscalibrated.
- **The speed the locator uses is not the speed the arrivals show.** In clean recordings arrivals advance at 0.488 [0.488, 0.488] cells per tick, while calibration picked c = 0.46. The report does not test why.
- **A flaw in the frozen protocol.** The noise-free reference uses a threshold of k times the noise level, but smoothing lowers the noise wobble by √3, so its threshold is √3 times higher than the noisy detector's. In loud settings it then misses sensors and is not a fair reference there. It is reported as frozen; an exploratory variant added afterwards (k σ / √3) gives 0.55 [0.52, 0.59] cells in the default setting and 1.30 [1.08, 1.55] in win/8/loud/even.

## Reproduce every number

```
node scripts/pulse-check.js --write    # regenerate pulse-calib.js and docs/pulse-*
node scripts/pulse-check.js --verify   # regenerate in memory and compare byte for byte
```

It takes about 6 seconds. It writes `pulse-calib.js` (the fitted k, c and rho the page loads), [docs/pulse-check.txt](pulse-check.txt), `docs/pulse-results.json`, `docs/pulse-results.csv` (one row per held-out pulse, setting and method) and `docs/pulse-manifest.json` (seeds, versions, and the SHA-256 of every input and output). The tests check that the page and this document quote the report.

## Checks

- `node --test tests/*.test.js`: `tests/pulse.test.js` (the simulation, detector, locator, game, replay codes) and `tests/pulsepage.test.js` (the page, both languages, the report quotes, the seven-page links).
- `node scripts/pulse-e2e-check.js`: a headless Chrome playthrough in English and French, phone and desktop, high contrast and reduced motion, by clicking and by keyboard, plus free waves and replay links. Every pulse's arrivals and points are recomputed in Node and compared. Screenshots go to `docs/screenshots/pulse-*.png` and the report to `docs/pulse-e2e-report.json`.

## Limits

The simulation is small and idealised: one wave speed, square cells, reflecting walls, Gaussian noise, no real materials or sensors. The locator is a textbook method on simulated data. Nothing here says how any real floor, crowd or sensor would behave.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
