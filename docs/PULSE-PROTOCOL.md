# Wave Pulse evaluation protocol (local draft for the next release)
Membrane Arena. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. License AGPL-3.0.

This protocol was written and frozen before any Wave Pulse calibration or held-out run. The report records its SHA-256 hash, so any later edit shows. The earlier pages, their engines, protocols and published results are not changed or re-tuned here.

**SYNTHETIC.** Wave Pulse is a game on a small classical simulation: a damped wave equation on a 40 × 26 grid of cells, solved with a textbook finite-difference scheme. It is not a model of a real arena floor, a pressure wave in a real material, holography, light fields, smart materials or any physical system. "Membrane" names a grid cell, as on the other pages. The Great Wave look is a colour style only. Results apply to this simulation only.

## 1. What is evaluated
A trigger (a "big win" or a "crowd cheer") starts a ripple somewhere on the membrane grid. A few listening membranes (sensors) at the edge of the grid record the height of the grid under them, with added noise. From those recordings alone, a method must say where the ripple started. The evaluation compares methods of doing that, and measures how the answer degrades when the simulation breaks the methods' assumptions.

## 2. Simulation (fixed in advance)
- **Grid.** 40 × 26 cells, reflecting walls (mirror boundary). Leapfrog update with the 5-point Laplacian: u⁺ = (2u − (1 − γ)u⁻ + r²·∇²u) / (1 + γ), with damping γ = 0.004 and r² = 0.25, so the nominal speed is 0.5 cells per tick (stable for r² ≤ 0.5).
- **Timeline.** 130 ticks. Ticks 0–19 are a quiet listening window (noise only). The trigger fires at tick 20.
- **Source.** The trigger point is uniform in x ∈ [4, 35], y ∈ [4, 21].
- **Big win.** One Gaussian bump of height 1 and width σ = 1.2 cells at the trigger point, added to u and u⁻ at tick 20 (cut off beyond 6 cells).
- **Crowd cheer.** 3, 4 or 5 bumps of height 0.35–0.55, each 1–4 cells from the trigger point at a random angle, firing at ticks 20–27. The target to find is their height-weighted centre.
- **Floor.** *Even:* r² = 0.25 everywhere. *Patchy:* one hidden elliptical slow patch, centre x ∈ [6, 34], y ∈ [5, 21], semi-axes 4–10 and 3–8 cells, speed factor f ∈ [0.45, 0.65] inside (r² = 0.25·f² at the core), with a smooth edge (logistic in the ellipse radius, slope 6).
- **Sensors.** *8 sensors:* the four corners (1, 1), (38, 1), (1, 24), (38, 24) and the four edge midpoints (20, 1), (20, 24), (1, 13), (38, 13). *4 sensors:* the four corners only.
- **Noise.** Independent Gaussian noise added to every sensor sample. *Calm:* σ = 0.004. *Loud:* σ = 0.025. Direct-wave peaks at the sensors are about 0.05–0.2.
- **Seeds.** A pulse seed fixes the trigger point, the cheer bumps, the patch and the noise of each sensor, independently of the setting. So the same seed under two settings differs only in that setting, and the 4-sensor noise is the first four of the 8-sensor noise streams.

## 3. Methods
- **Detector (shared).** Smooth each trace with a 3-tick moving average. Estimate its mean and standard deviation over ticks 1–19. The arrival tick is the first tick ≥ 20 where the smoothed trace is more than k standard deviations from that mean. A sensor that never crosses has no arrival.
- **Locator (TDOA).** Least-squares time-difference-of-arrival with an unknown start time: for a candidate point, the residuals are arrival − distance / c, the start time is their mean, and the cost is the sum of squared deviations. Grid search over every cell, then a 1/8-cell search within ±1 cell of the best cell. It needs at least 3 arrivals; otherwise it answers the centre of the grid. It assumes an even floor.
- **Locator's 90% region.** All points on a half-cell grid whose cost is at most the minimum cost + ρ.
- **Early-sensor average.** The average of the positions of the sensors with an arrival, weighted by exp(−(arrival − earliest arrival) / 8). Fixed, not tuned. It stands for an intuitive human strategy.
- **Nearest sensor.** The position of the sensor with the earliest arrival.
- **Centre.** Always the centre of the grid, (19.5, 12.5).
- **Random.** A uniform point in the trigger box, from its own seeded stream.
- **Noise-free traces.** The locator with the same k, c and detector threshold (k times the condition's true noise σ), applied to the traces without noise. It separates the cost of noise from the cost of the model.

## 4. Calibration (only on calibration seeds)
The three tuned values are chosen on 200 calibration pulses `pcal-000` to `pcal-199` only. Pulse `pcal-i` runs in setting number i mod 16 (the order of section 5).
1. k ∈ {4, 5, 6, 7, 8, 10} and c ∈ {0.44, 0.46, …, 0.60} jointly: the pair with the lowest mean locator error over the calibration pool. Ties go to the smaller k, then the smaller c.
2. ρ: the 90th percentile of (cost at the true target − minimum cost) over the calibration pool, with the chosen k and c.

They are written to `pulse-calib.js`, which the page loads. They are never changed after looking at held-out results.

## 5. Settings and held-out seeds
16 settings: trigger {big win, crowd cheer} × sensors {8, 4} × noise {calm, loud} × floor {even, patchy}. The **default** setting is big win, 8 sensors, calm, even. Held-out results use 200 pulses `ptest-000` to `ptest-199`, each run in all 16 settings. They are never used for tuning.

## 6. Metrics
For each pulse and method: the error (distance in cells from the answer to the target), a hit (error ≤ 2 cells) and the game points max(0, round(100 − 12 × error)). For the locator, also: whether the 90% region contains the target, the region's area in cells, the number of missed sensors, and whether it fell back to the centre.

## 7. Hypotheses (confirmatory)
All on held-out pulses, with the locator unless stated.
- **H1.** In the default setting, the locator's error is lower than the centre guess's.
- **H2.** In the default setting, the locator's error is lower than the early-sensor average's.
- **H3.** The locator's error is higher on the patchy floor than on the even floor (big win, 8 sensors, calm).
- **H4.** The locator's error is higher with loud noise than with calm noise (big win, 8 sensors, even).
- **H5.** The locator's error is higher with 4 sensors than with 8 (big win, calm, even).
- **H6.** The locator's error is higher for crowd cheers than for big wins (8 sensors, calm, even).

## 8. Analysis
- Every mean has a 95% percentile bootstrap interval (2000 resamples of pulses, seed `pulse-bootstrap`).
- Every comparison is paired by pulse: the mean difference with its 95% bootstrap interval, the effect size d_z (mean difference / SD of differences), and win/tie/loss counts (ties: |difference| < 0.01 cells).
- Confirmatory tests also get a two-sided paired sign-flip permutation p-value (10 000 flips, seed `pulse-permutation`), Holm-adjusted over H1–H6.
- **Decision rule.** A hypothesis is supported when its interval lies entirely on the predicted side of zero and its Holm-adjusted p < 0.05. If the interval crosses zero, the difference is reported as not detectable. A result on the wrong side is reported as found.
- Proportions (hits, coverage, misses) get Wilson 95% intervals.
- **Region calibration.** Coverage of the 90% region per setting, with its Wilson interval. It is called calibrated in a setting when the interval contains 0.90. Expected beforehand: under-coverage where the locator's assumptions break (patchy floor, loud noise, cheers).
- **Speed check.** On the even floor, noise-free, the locator's speed c is a prediction of how fast arrivals advance with distance. The measured value is the slope of distance against arrival tick, fitted separately for sensors along an axis from the trigger (angle within 22.5° of horizontal or vertical) and along a diagonal, with bootstrap intervals over pulses. Reported against c and against the nominal 0.5.
- **Exploratory.** The full 16-setting table for every method, with no correction for multiple comparisons, labelled as exploratory.

## 9. Game
The page uses the same simulation, detector, locator and frozen values. A run is 12 pulses from the run seed: 4 big wins (8 sensors, calm, even floor), 4 crowd cheers (8 sensors, loud, even floor), then 4 pulses on a patchy floor with 4 sensors and calm noise, alternating big win and cheer. Points per pulse are the game points of section 6. The end of a run compares the player with the locator, the early-sensor average and the centre on the same pulses. The locator's hint is advice only.

## 10. Reproducibility
`node scripts/pulse-check.js --write` runs the calibration and the held-out evaluation and writes `pulse-calib.js`, `docs/pulse-check.txt`, `docs/pulse-results.json`, `docs/pulse-results.csv` and `docs/pulse-manifest.json`. The manifest records the seeds, the versions, the SHA-256 hashes of the inputs (this protocol and the code) and of every output. `node scripts/pulse-check.js --verify` recomputes everything and exits with an error on any difference. Tests check that the page and the docs quote the report.
