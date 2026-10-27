# Wave Pulse region calibration protocol for v0.3.5

Membrane Arena. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. License AGPL-3.0-only.

**SYNTHETIC.** This is a game on a small classical simulation, not a model of any physical system. This add-on evaluates only the size of the locator's displayed region. It does not change the v0.3.4 simulation, detector, point estimate, hypotheses, protocol, or published results. `docs/PULSE-PROTOCOL.md` and its v0.3.4 outputs remain untouched.

## Question

The v0.3.4 locator used one shared cost allowance, `rho = 181.726`, for its nominal 90% region in all 16 settings. The frozen v0.3.4 evaluation found that the region's Wilson interval contained 90% in only 2 of the 16 settings. This update tests whether a separate allowance per setting better calibrates the region while leaving the locator itself unchanged.

## Fixed components

The game, seed generator, detector threshold (`k = 7`), locator speed (`c = 0.46` cells per tick), target definition, least-squares cost, half-cell region grid, and 16-setting grid are exactly those of `docs/PULSE-PROTOCOL.md`. Only the cost allowance `rho` changes. The old shared value remains a comparison on the new held-out pulses; it is not used to choose the new values.

## Calibration sample

Use 200 new calibration seeds, `pcal35-000` through `pcal35-199`. Every seed is evaluated in each of the 16 settings, giving 200 calibration observations per setting. The seed set is distinct from both v0.3.4 seed ranges (`pcal-000..199` and `ptest-000..199`). The same seed is used across settings, as in the original protocol, so setting comparisons share the underlying trigger, cheer, patch, and noise streams.

For each setting and calibration pulse that yields a locator estimate, calculate the nonnegative excess cost at the true target:

`delta = cost(true target) - minimum locator cost`.

A pulse with fewer than three detected arrivals has no region and is assigned an infinite residual for calibration. For each setting, sort all 200 residuals including those infinities. Select the order statistic at rank `ceil(0.90 * (200 + 1)) = 181` (one-based), the finite-sample 90% quantile. Round a finite selected value **up** to the next 0.001 ticks² so rounding cannot make the region narrower. If the selected value is infinite, that setting has no finite calibrated region and is reported as such; do not substitute another value.

The resulting setting-specific allowance is frozen in `pulse-region-calib.js`. No held-out result may change it.

## Fresh held-out evaluation

Use 400 different new seeds, `ptest35-000` through `ptest35-399`, each in all 16 settings. None appears in the calibration sample or the v0.3.4 samples. The evaluation script scores both the new setting-specific allowances and, as a descriptive comparator only, the old shared v0.3.4 allowance on these same fresh pulses.

For each setting, report unconditional coverage out of all 400 pulses, its two-sided 95% Wilson interval, conditional coverage among nonfallback pulses, fallback rate and Wilson interval, mean region area among locatable pulses, and calibration-sample fallback count. A fallback locator has no region and counts as not covered in unconditional coverage. The setting is labelled “interval contains 90%” when its unconditional Wilson interval includes 0.90; this is a descriptive per-setting check, not a simultaneous 16-setting guarantee or a new confirmatory hypothesis. Conditional coverage is reported separately and never replaces the unconditional measure. If the fallback rate exceeds 10%, finite `rho` alone cannot produce 90% unconditional coverage.

## Reproduction and separation from v0.3.4

`node scripts/pulse-region-check.js --write` writes only the v0.3.5 region calibration module and its own report, JSON, CSV, and manifest. `--verify` recomputes and compares only those v0.3.5 files. The manifest records both new seed sets and the SHA-256 hashes of the protocol, code, engine, calibration input, and outputs. The frozen v0.3.4 protocol and its reports are not regenerated or edited by this workflow.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
