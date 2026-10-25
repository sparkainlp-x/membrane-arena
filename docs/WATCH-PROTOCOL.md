# Pair Watch evaluation protocol (v0.3.3)

This protocol was written and frozen before the v0.3.3 Pair Watch evaluation was run. The report records its SHA-256 hash, so any later edit shows. It covers the game's coach and its decision policies only. The Reverse Pair engine (`pair.js`), its protocol ([PAIR-PROTOCOL.md](PAIR-PROTOCOL.md)) and its v0.3.2 results are not changed or re-tuned here.

**SYNTHETIC.** Everything below is about a game on a classical simulation. Nothing here models negative energy, antimatter, real membranes, neurons, oscillators, radio hardware or any physical system. Results apply to this simulation only.

## 1. What is evaluated

In Pair Watch the player is the second vote of the 2-membrane shield. When the observer declares a find, the player accepts or vetoes it. Points for a call: accept a real find +100, accept a false find −150, veto a false find +60, veto a real find −40; a wave with no declaration scores +10 if no dark pattern was planted and −20 if one was. Policies are compared on these points without the streak bonus.

**Break-even probability.** If p is the chance that a declared find is real, accepting is worth 100p − 150(1 − p) and vetoing is worth −40p + 60(1 − p). Accepting is better exactly when p > p\* = (60 + 150) / ((100 + 150) + (60 + 40)) = 0.6. The code computes p\* from the points table, not from this paragraph.

**The coach** estimates p for a declaration from what the player can see at that moment: whether the fades are on-grid or off-grid, whether the equalizer is on, the tick share, the tick of the declaration, and the faded share (the part of the find's energy in lanes the calibrator reads below 0.7). The coach's policy accepts when its estimate is above p\* and vetoes otherwise (an estimate exactly at p\* is a veto).

## 2. Model (fixed in advance)

Penalized logistic regression with these 11 features, x:

1. intercept
2. off: 1 for off-grid fades (stage 3), else 0
3. eq: 1 when the equalizer is on, else 0
4. off × eq
5. f: the faded share, 0 to 1
6. f²
7. f × eq
8. t20: 1 when the declaration is at tick 20
9. early: 1 when the declaration is at tick 20 or 40
10. late: 1 when the declaration is at tick 120
11. share − 2 (the tick share, 1 to 4, centred)

The model is fitted by iteratively reweighted least squares with a ridge penalty λ = 1 on every coefficient except the intercept, until the largest coefficient change is below 1e-10 (at most 100 iterations). The covariance of the coefficients is the inverse of the penalized Hessian at the fit. A prediction's 95% interval is logit⁻¹(xᵀβ ± 1.96 √(xᵀΣx)). Coefficients and covariance are rounded to 9 decimals, written to `watch-coach.js` (the file the page loads) and then used, rounded, for every held-out number.

The features were chosen on 30 exploration seeds (`wexp-0` to `wexp-29`), which are not used again. On those seeds the faded share and the declaration tick were the strongest signals.

## 3. Seeds and settings

- **Calibration seeds:** `wcal-000` to `wcal-199` (200 runs). Used only to fit the coach.
- **Held-out seeds:** `wtest-000` to `wtest-199` (200 runs). Every reported number comes from these, after the coach is fixed.
- The two sets are disjoint, and both are separate from the Reverse Pair seeds (game worlds use the `~watch` namespace).
- **Settings sweep.** Every wave of every run is played under every setting the game allows: stage 1 with tick share 1, 2, 3 and 4 (equalizer locked off); stages 2 and 3 with tick share 1 to 4 and the equalizer off and on. The coach is fitted on every declaration in this sweep.
- **Profiles.** A profile fixes the settings for a whole run: tick share s ∈ {1, 2, 3, 4} and the equalizer either always off or on whenever unlocked. That gives 8 profiles. The **main profile** is the game's default: tick share 2, equalizer on whenever unlocked.

## 4. Policies

- **coach:** accept when the coach's estimate is above p\*.
- **shield:** the calibrator's own vote (veto when at least half the find's energy sits in lanes read below 0.7).
- **accept-all** and **veto-all.**
- **random:** accept with probability 0.5, seeded by run, wave and profile (`watch-random`).
- **perfect:** accept exactly the real finds (an upper bound no player can reach without knowing the truth).

## 5. Hypotheses

- **H1, calibration.** On held-out declarations (all profiles pooled), the coach's expected calibration error (ECE, 10 equal-width bins weighted by count) is at most 0.05, and its Brier score is lower than a constant model that predicts the calibration seeds' base rate. The Brier difference gets a 95% bootstrap interval over held-out seeds; a lower Brier score is claimed only if the interval is entirely below zero.
- **H2, coach against shield.** In the main profile, the coach's run points minus the shield's run points, paired by held-out seed.
- **H3, coach against accept-all**, and **H4, shield against accept-all**, both in the main profile and paired by seed.
- For H2 to H4, a difference is claimed only if its 95% interval excludes zero. Otherwise the result is reported as "not detectable".
- **Exploratory:** the same three comparisons in each of the 8 profiles, coach against perfect, and reliability by fade kind and equalizer. These are exploratory, with no correction for multiple comparisons. They are reported as found and not used to change the coach.

## 6. Analysis

- Run points are summed per held-out run. Means get 95% percentile bootstrap intervals over the 200 held-out seeds (2,000 resamples, seed `watch-bootstrap`).
- Paired differences get the mean, the 95% bootstrap interval, Cohen's d_z (mean difference divided by the standard deviation of the differences) and win/tie/loss counts.
- Calibration intervals resample held-out seeds as clusters, so declarations from one run stay together.
- The reliability table gives, per bin, the count, the mean prediction, the observed rate and its 95% Wilson interval.
- Null or negative results are reported as found. If the coach does not beat the shield, the report says so.

## 7. Reproducibility

`node scripts/watch-check.js --write` regenerates every number: `docs/watch-check.txt` (report), `docs/watch-results.json`, `docs/watch-results.csv` (one row per held-out seed, profile and policy), `watch-coach.js` (the fitted model the page loads) and `docs/watch-manifest.json` (seeds, versions, the protocol hash and SHA-256 hashes of inputs and outputs). `node scripts/watch-check.js --verify` recomputes everything and exits 1 on any difference. The tests check that the page and `docs/WATCH.md` quote the report.

Membrane Arena. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
