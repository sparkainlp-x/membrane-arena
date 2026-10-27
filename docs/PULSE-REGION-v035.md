# Wave Pulse region recalibration: v0.3.5 experimental release

**Bottom line:** setting-specific region sizes improved the fresh-test count of settings whose 95% Wilson interval contains 90% from 1 of 16 under the old shared allowance to 11 of 16. But the default setting came in below target, one setting could not receive a finite region, and the unweighted mean across settings was lower. This is an experimental update, not a completed fix.

## What changed

The locator itself is unchanged: detector threshold `k = 7`, speed `c = 0.46`, simulation and point estimates remain those of the v0.3.4 engine. The release gives each setting its own cost allowance for the shaded 90% region. It was fit using 200 new calibration seeds per setting and tested on 400 different held-out seeds per setting. The old shared allowance was also scored on those same fresh held-out pulses as a comparison.

## What the fresh test found

- For the default setting (big win, 8 sensors, calm noise, even floor), coverage was **85.8% [82.0%, 88.8%]**, below the 90% target.
- The new region's Wilson interval contained 90% in **11 of 16** settings. The old shared allowance did so in **1 of 16** settings on this same fresh test set. These are descriptive per-setting checks, not simultaneous guarantees.
- For `win/4/loud/patchy`, **20 of 200** calibration pulses fell back to the centre. Under the pre-registered rule, that left no finite region allowance for this setting. In the fresh test, **7.0% [4.9%, 9.9%]** of pulses also fell back; the release reports no region for the setting rather than implying one is calibrated.
- The unweighted mean of the 16 setting coverages was **85.3%** with the new map and **90.1%** with the old shared allowance. This is a descriptive average, not a pooled confidence interval; the missing region in one setting counts as zero coverage.

The thresholds were not adjusted after viewing the held-out results. This release does **not** support a claim that the displayed region is calibrated to 90% in every setting. A further attempt would need a separate calibration sample and a new, untouched evaluation set, with particular care around fallback-heavy settings.

## Reproducibility and historical results

The new protocol is [PULSE-REGION-PROTOCOL-v035.md](PULSE-REGION-PROTOCOL-v035.md); the generated [evaluation report](pulse-region-check-v035.txt), [JSON results](pulse-region-results-v035.json), [pulse-level CSV](pulse-region-results-v035.csv) and [hash manifest](pulse-region-manifest-v035.json) use only the new `pcal35-*` and `ptest35-*` seeds. Run `node scripts/pulse-region-check.js --verify` to recompute and check those files.

The published [v0.3.4 protocol](PULSE-PROTOCOL.md), calibration and numeric held-out results remain byte-for-byte unchanged. The v0.3.4 manifest's provenance hash is refreshed for the v0.3.5 software build; the original release archive remains the historical record.

**SYNTHETIC.** Every result concerns this small game simulation only, not any real floor or physical system.

Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
