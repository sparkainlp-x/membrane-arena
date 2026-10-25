# Reverse Pair evaluation protocol (v0.3.2)

This protocol was written and frozen before the v0.3.2 evaluation was run. The report records its SHA-256 hash, so any later edit to this file shows up as a mismatch. The numbers from v0.3.1 (8 seeds, threshold chosen on the same seeds) were exploratory. They are not reused here, apart from the choice of the primary tick share below.

SYNTHETIC classical simulation. "Observer", "calibrator", "membrane", "tone", "channel" and "fade" are names for parts of a game. Nothing here models physics, negative energy, antimatter, oscillators, radio hardware or biology. The questions below are about this simulation only.

## 1. Simulation changes made before the evaluation

1. **Common random numbers.** Every episode draws its world (pattern, fade, starting vector), its observation noise and its reading noise from separate streams keyed by seed, round and episode. Every method therefore faces the same worlds and the same noise on a given seed, and paired differences across seeds are meaningful.
2. **Full trajectories.** The observer runs all of its ticks, and declarations are read from the checks (every 20 ticks) after the run. The first check whose opposite energy reaches the threshold is the declaration, and the observer is treated as frozen from then on. This is equivalent to stopping at the declaration, and it lets one run serve every threshold and every shield rule.
3. **Two fade kinds**, side by side on the same seeds, worlds and noise:
   - **On-grid** (as in v0.3.1): in 75% of episodes, one of the calibrator's frequencies 1 to 7 fades. The fade covers exactly the two Fourier components of one tone.
   - **Off-grid**: in 75% of episodes, the fade covers a band of sinusoids centred between two tone frequencies. The centre is k + u, with k from 1 to 6 and u uniform in [0.2, 0.8]. The bandwidth is uniform in [0, 1.5] cycles, sampled every 0.5 cycle, at both signs of the frequency, and orthonormalized. Because these sinusoids are not on the 16-point grid, their energy leaks across several tones. The calibrator then sees partial dips on several tones instead of one deep dip, and its per-frequency equalizer cannot undo the fade exactly.

   Both kinds use the same depth range (0.6 to 0.95), the same slow sine timing (0.5 to 2 cycles per episode) and the same random phase.

## 2. Methods (baselines and ablations)

| Method | Observer ticks | Equalizer | Shield vote | Threshold |
|---|---|---|---|---|
| random | none | no | none | none: each episode declares a uniformly random unit vector at a uniformly random check, with probability 0.5 |
| alone | all 120 (no calibrator) | no | none | tuned |
| ticks only (control) | share s | no | none (the calibrator's ticks are spent, its readings unused) | tuned |
| eq | share s | the calibrator's latest readings | none | tuned |
| shield | share s | no | the calibrator's vote | tuned |
| full pair | share s | the calibrator's latest readings | the calibrator's vote | tuned |
| oracle | all 120 | the exact inverse of the true channel | vetoes a declaration lying mostly (≥ 0.5 of its energy) in the true fade subspace | tuned |

Shares s = 1, 2, 3 and 4 observer ticks per calibrator tick. The primary share is **s = 2**. It was fixed in advance from the v0.3.1 exploratory run, whose seeds are not among the held-out seeds.

## 3. Seeds

- **Calibration seeds:** `cal-000` to `cal-039` (40 contests). These are used only to choose each method's threshold.
- **Held-out seeds:** `test-000` to `test-119` (120 contests). These are never used for tuning. Every reported result comes from them.

The two sets are disjoint, and the evaluation script checks this. One seed is one contest: 12 rounds of 8 episodes (48 planted dark patterns, 48 noise-only), with the seeded darkness tide of the page.

## 4. Threshold selection

For each method, share and fade kind, the threshold is chosen from 0.40, 0.45, ..., 0.85. The choice maximizes the mean contest score over the calibration seeds, with ties going to the lower threshold. The chosen thresholds are frozen and written to the report before the held-out seeds are evaluated.

## 5. Metrics (per contest, over 96 episodes)

- **score**: the arena's score (net finds 50, precision 25, steadiness 25; outputs without the shield count a third).
- **false**: outputs that are not the planted pattern (fidelity below 0.5 or no pattern).
- **true**: outputs that are the planted pattern.
- **missed**: planted patterns not output as true.
- **on-fade %**: the share of declarations whose vector lies mostly (≥ 0.5 of its energy) in the true fade subspace.
- **held**: declarations stopped by the shield.

## 6. Hypotheses (each tested for both fade kinds, at s = 2)

- **H1.** The full pair gives fewer false outputs than the observer alone.
- **H2.** The full pair scores higher than the observer alone.
- **H3.** The equalizer lowers the on-fade share of declarations compared with the ticks-only control (same ticks, readings unused).
- **H4.** The shield lowers false outputs. This is measured at the full pair's threshold as the number of false declarations it stops (full pair compared with the equalizer alone at that same threshold), with the scoring-rule weighting separated out (section 8).
- **H5.** The benefit of the pair over the observer alone (in score and in false outputs) is smaller off-grid than on-grid. This is a paired difference of differences across seeds.
- **H6.** On clean frequencies, the calibrator's mean absolute reading error matches the prediction σ·√(2/π) = 0.0399 (σ = 0.05) for every frequency and tick share. On faded frequencies, the error grows as the share grows.

## 7. Statistics

- **Unit of analysis:** the held-out seed (n = 120).
- **For every method:** the mean and a 95% percentile bootstrap confidence interval (10,000 resamples of seeds, from a fixed bootstrap seed).
- **For every comparison:** the paired difference per seed, its mean and its 95% bootstrap interval. The effect size is Cohen's d_z (mean difference divided by the standard deviation of the differences), together with the count of seeds where A is above, equal to or below B.
- **Decision rule:** a difference is called a difference only if its 95% interval excludes zero. Otherwise it is reported as "no detectable difference". There is no correction for multiple comparisons. H1 to H5 are the primary comparisons; everything else is descriptive.
- **Calibration check (H6):** per frequency and share, the per-seed mean errors, their mean and their 95% bootstrap interval. The prediction is "met" if 0.0399 lies inside the interval for a clean frequency.

## 8. Separating the shield's filtering from the scoring rule

At the full pair's chosen threshold:

- **Filtering effect on false outputs:** false outputs of the equalizer alone at that threshold minus false outputs of the full pair. These are exactly the false declarations the shield stopped.
- **Score decomposition:** score(full) minus score(eq at the same threshold) splits into a **filtering part**, score(full scored as if unshielded) minus score(eq at the same threshold), and a **weighting part**, score(full) minus score(full scored as if unshielded). The weighting part comes only from the rule under which unshielded outputs count a third.

## 9. Reproducibility

`node scripts/pair-check.js --write` regenerates everything:

- `docs/pair-check.txt` (the report)
- `docs/pair-results.json` (settings, thresholds, summaries, comparisons, calibration check)
- `docs/pair-results.csv` (one row per held-out seed, fade kind, method and share)
- `docs/pair-manifest.json` (seed lists, versions, this protocol's SHA-256 and the SHA-256 of each output)

The tests check that the page and the docs quote the report.

## 10. Reporting

Results are reported as found, including null and negative results. If a benefit disappears off-grid, the report and the page say so plainly.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
