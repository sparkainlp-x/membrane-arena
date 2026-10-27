# Changelog
## 0.3.5 (2026-10-26)
- Wave Pulse adds an experimental, setting-specific calibration for the hint region; the locator engine, detector, simulation and v0.3.4 numeric results are unchanged.
- Calibration used 200 new seeds per setting; evaluation used 400 separate held-out seeds per setting under a protocol frozen before the full run. On the fresh set, 11 of 16 new per-setting Wilson intervals contain 90%, versus 1 of 16 with the old shared allowance. The default setting is 85.8% [82.0%, 88.8%]; `win/4/loud/patchy` had 20/200 calibration fallbacks and no finite region. This does not establish 90% coverage across all settings. See `docs/PULSE-REGION-v035.md` and `docs/pulse-region-check-v035.txt`.
- The v0.3.4 protocol and numeric results remain unchanged; the current manifest is rechecked against the v0.3.5 software build. Archived on Zenodo as [10.5281/zenodo.23680525](https://doi.org/10.5281/zenodo.23680525) (all-version concept DOI: [10.5281/zenodo.23633126](https://doi.org/10.5281/zenodo.23633126)).

## 0.3.4 (2026-10-25)
Archived on Zenodo as 10.5281/zenodo.23647863 (all versions: 10.5281/zenodo.23633126). The six earlier pages, their mechanics, seeds and results (including the frozen Reverse Pair and Pair Watch protocols and outputs) are unchanged; their built pages change only in the version string and in the new links to Wave Pulse.
- Wave Pulse (`pulse.html`, `pulse.js`, `pulseui.js`, `pulse-i18n.js`, `pulse.css`), page 7: a SYNTHETIC visual game where a big win or a crowd cheer sends a ripple across a 40 × 26 damped wave grid. The player locates the start from the edge sensors' recordings, then sees the ripple replayed in a Great Wave colour style. 12 pulses in 3 stages, a locator hint with its 90% region, free waves, keyboard play, replay codes in the page address, English and French, phone and high contrast. No claim of holography or of modelling a real floor.
- Frozen protocol `docs/PULSE-PROTOCOL.md`, hashed before any run. `scripts/pulse-check.js --write` calibrates the detector threshold, locator speed and region size on 200 calibration pulses and evaluates on 200 held-out pulses in 16 settings, writing `pulse-calib.js`, `docs/pulse-check.txt`, `docs/pulse-results.json`, `docs/pulse-results.csv` and `docs/pulse-manifest.json` (seeds, versions, SHA-256); `--verify` recomputes and compares.
- Headline (held-out, default setting): locator error 0.62 [0.57, 0.68] cells, early-sensor average 3.05 [2.89, 3.21], centre 9.34 [8.79, 9.89]. All six hypotheses held. Negative results reported as found: the 90% region is calibrated in only 2 of 16 settings, the fitted locator speed (0.46) differs from the measured arrival speed (0.488), and the frozen noise-free reference had a threshold flaw (reported, with an exploratory corrected variant).
- `scripts/pulse-e2e-check.js`: headless Chrome playthroughs checked against a Node replay (`docs/pulse-e2e-report.json`, `docs/screenshots/pulse-*.png`).
- All seven pages link to each other. The Pages and tests workflows include `dist/pulse.html`, and CI runs `scripts/pulse-check.js --verify`.
- `docs/PULSE-PROTOCOL.md` is published byte for byte as it was frozen before the first run (its title still calls it a draft for the next release, and its SHA-256 is in the report).
- `scripts/watch-check.js` and `scripts/pulse-check.js` now pin the version of the evaluation they reproduce (0.3.3 and 0.3.4) and record the checking version as `checkedWith`, as `scripts/pair-check.js` already did. The Reverse Pair and Pair Watch outputs are byte-identical; only their manifests change (`checkedWith` and input hashes).
- `VERSION` in `game.js`, `brain.js` and `quorum.js`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.3.4.
- Tests grew from 271 to 303 (`tests/pulse.test.js`, `tests/pulsepage.test.js`).

## 0.3.3 (2026-10-25)
Archived on Zenodo as 10.5281/zenodo.23645840 (all versions: 10.5281/zenodo.23633126). The arena, brain, Quorum Keeper, Reverse Membranes and Reverse Pair mechanics and their seeds are unchanged; their built pages change only in the version string and in the new links to Pair Watch. The published Reverse Pair engine, protocol, seeds, thresholds and v0.3.2 results are unchanged: `scripts/pair-check.js` now writes them as the v0.3.2 evaluation, and its manifest only records the release that re-checked them.
- Pair Watch, a visual game on the Reverse Pair: `watch.js` has 24 waves in 3 stages. Each wave is an exact `pair.js` episode replayed tick by tick, and the player is the second vote of the 2-membrane shield. It keeps points and streaks and compares the player with the calibrator's shield, accept-all, veto-all and perfect calls. `watch.html`, `watch.css`, `watch-i18n.js` (English and French) and `watchui.js` draw the canvas scene: the observer membrane with its dark core and threshold ring, the calibrator's nine tone lanes, the tick rail and the opposite-energy trace. `build.js` writes `dist/watch.html`. `docs/WATCH.md`.
- The coach: a penalized logistic model of P(real find) on what the player sees at a declaration. It is fitted only on calibration runs `wcal-000` to `wcal-199`, frozen in `watch-coach.js`, and shown as a meter with a 95% interval and the 0.6 break-even point implied by the points table. It is advice only; the end table adds the coach's calls.
- Frozen protocol `docs/WATCH-PROTOCOL.md`, written and hashed before the held-out run. `scripts/watch-check.js --write` regenerates `watch-coach.js`, `docs/watch-check.txt`, `docs/watch-results.json`, `docs/watch-results.csv` and `docs/watch-manifest.json` (seeds, versions, SHA-256 hashes); `--verify` recomputes and compares.
- Headline (200 held-out runs, tick share 2, equalizer on): expected calibration error 0.0083 [0.0063, 0.0136]. Points per run: coach 1084.8 [1055.0, 1113.5], shield 1053.0 [1022.7, 1084.6], accept-all 914.4 [878.6, 951.2]. Coach minus shield +31.9 [+16.5, +47.6] (d_z 0.28, 138 of 200 runs tied); perfect calls would still score 211.7 more per run.
- Replay codes: one letter per wave plus two check characters, kept in the page address. A replay link recomputes every point from the seed, and a code that does not fit (mistyped, wrong seed, equalizer in stage 1, calls that do not match the waves) is rejected.
- All six pages link to each other (the arena footer and the brain, Quorum Keeper, Reverse Membranes and Reverse Pair headers link to Pair Watch). The Pages and tests workflows include `dist/watch.html`.
- `scripts/watch-e2e-check.js` is a headless Chrome playthrough checked against a Node replay. It covers the coach's estimates, the replay link and a mistyped code, and writes `docs/watch-e2e-report.json` and `docs/screenshots/watch-*.png`.
- `VERSION` in `game.js`, `brain.js` and `quorum.js`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.3.3.
- Tests grew from 236 to 271 (`tests/watch.test.js`, `tests/watchpage.test.js`, `tests/watchpro.test.js`).

## 0.3.2 (2026-10-25)
Archived on Zenodo as 10.5281/zenodo.23644414 (all versions: 10.5281/zenodo.23633126). The arena, brain, Quorum Keeper and Reverse Membranes mechanics and their seeds are unchanged; their built pages change only in the version string and in the new links between pages.
- Reverse Pair: `pair.js` (a reverse observer and a predictable calibrator taking turns on one clock, signed-amplitude sine tones on 9 frequencies, on-grid and off-grid fades, equalizer, 2-membrane shield, oracle and random baselines, seeded contest, calibration check, score card), `pair.html`, `pair-i18n.js` (English and French), `pairui.js`, `pair.css`, built to `dist/pair.html`. See `docs/PAIR.md`.
- Frozen evaluation protocol `docs/PAIR-PROTOCOL.md` (hypotheses, metrics, settings grid, 40 calibration seeds and 120 held-out seeds, analysis plan), written and hashed before the held-out run.
- `scripts/pair-check.js` runs it: thresholds chosen on calibration seeds only; every held-out number with a 95% bootstrap interval; paired differences with d_z and win/tie/loss counts; off-grid fades with random bandwidth beside on-grid ones; observer alone, ticks only, equalizer, shield, full pair, oracle and random baselines; the shield split into filtering and scoring-rule weighting; measured against predicted calibrator error per frequency and tick share. `--write` writes `docs/pair-check.txt`, `docs/pair-results.json`, `docs/pair-results.csv` and `docs/pair-manifest.json` (seeds, versions, SHA-256 of inputs and outputs); `--verify` recomputes and compares, and the tests workflow runs it on Node 20, 22 and 24.
- Headline (held-out, 2 : 1): full pair minus observer alone, +41.11 [39.80, 42.42] on-grid and +27.78 [26.31, 29.25] off-grid. Once the equalizer is on, the shield's vote stops some false outputs (0.12 [0.06, 0.18] per contest on-grid, 1.02 [0.84, 1.21] off-grid) and more true ones, so its net filtering effect on the score is not detectable (-0.07 [-0.17, 0.03] on-grid, -0.16 [-0.55, 0.22] off-grid); its score gain is the scoring rule's weighting.
- `scripts/pair-e2e-check.js` (headless Chrome playthrough in English and French, phone and desktop, high contrast, on-grid and off-grid; `docs/pair-e2e-report.json`, `docs/screenshots/pair-*.png`). The page's numbers match Node exactly: when a wide fade covers two tones fully, the "most faded" tone is the lower one (near-ties within 1e-9), so Chrome and Node agree.
- All five pages now link to each other: the brain page links to Quorum Keeper, Reverse Membranes and Reverse Pair, and the arena footer links to the four other pages.
- README: one section per page, each with its live link.
- `VERSION` in `game.js`, `brain.js` and `quorum.js`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.3.2.
- Tests grew from 208 to 236 (`tests/pair.test.js`, `tests/pairpage.test.js`), including checks that the page and `docs/PAIR.md` quote the report and that the manifest hashes match the files.

## 0.3.1 (2026-10-25)
Archived on Zenodo as 10.5281/zenodo.23642469 (all versions: 10.5281/zenodo.23633126). The arena, brain and Quorum Keeper mechanics and their seeds are unchanged; their built pages change only in the version string, and the Quorum Keeper header gains a link to the new page.
- Reverse Membranes: `reverse.js` (anti-Hebbian membranes that learn away from energy, dark patterns with part of a direction's energy removed, opposite energy `1 - ratio`, echo replay, seeded darkness tide, contest, mirror test, score card), `reverse.html`, `reverse-i18n.js` (English and French), `reverseui.js`, `reverse.css`, built to `dist/reverse.html`. The page runs at width 16; see `docs/REVERSE.md`.
- `scripts/reverse-check.js` (writes `docs/reverse-check.txt`), `scripts/reverse-e2e-check.js` (headless Chrome playthrough, writes `docs/reverse-e2e-report.json` and `docs/screenshots/reverse-*.png`).
- `build.js` builds the page; the workflows check and deploy `dist/reverse.html`; the Quorum Keeper page links to it.
- `VERSION` in `game.js` (which `reverse.js` reuses), `brain.js` and `quorum.js`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.3.1; the check reports were re-run for 0.3.1.
- Tests grew from 184 to 208 (`tests/reverse.test.js`, `tests/reversepage.test.js`).
## 0.3.0 (2026-10-25)
Archived on Zenodo as 10.5281/zenodo.23639631 (all versions: 10.5281/zenodo.23633126). The arena's mechanics and seeds are unchanged: a seed, a daily seed or a challenge link from 0.1.0 or 0.2.0 plays exactly as before, and `dist/index.html` changes only in its version string.
- Brain architecture: `brain.js` plans the necessary membranes of each kind (sensory columns, gates, integrators, output, optional inhibitory and memory) from the faults each layer must tolerate (2f + 1 voters, strict-majority quorum). It builds the microtubule links with delays and transport noise, checks wiring and timing, runs seeded simulations with colluding, stuck or silent faults, and draws an SVG diagram.
- `brain.html` page (English and French, high contrast, built to `dist/brain.html`), `brain-i18n.js`, `brainui.js`, `brain.css`.
- `scripts/brain.js` (command line), `scripts/brain-check.js` (writes `docs/brain-check.txt`), `scripts/brain-e2e-check.js` (headless Chrome, writes `docs/brain-e2e-report.json` and `docs/screenshots/brain-*.png`), `docs/BRAIN.md`.
- `build.js` builds both pages; the workflows check and deploy `dist/brain.html`.
- Quorum Keeper game: `quorum.js` (symbolic vote evaluator, exhaustive adversary that groups interchangeable placements, 7 Build and 7 Break levels, scoring, SVG diagram), `quorum.html`, `quorum-i18n.js` (English and French), `quorumui.js`, `quorum.css`, built to `dist/quorum.html`; `scripts/quorum-check.js` (level calibration, writes `docs/quorum-check.txt`), `scripts/quorum-e2e-check.js` (headless Chrome playthrough, writes `docs/quorum-e2e-report.json` and `docs/screenshots/quorum-*.png`), `docs/QUORUM.md`. The workflows check and deploy `dist/quorum.html`.
- `VERSION` in `game.js`, `brain.js` and `quorum.js`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.3.0; the brain and Quorum Keeper check reports were re-run for 0.3.0.
- Tests grew from 146 to 184.

## 0.2.0 (2026-10-25)

Archived on Zenodo as 10.5281/zenodo.23633127 (all versions: 10.5281/zenodo.23633126). A seed, a daily seed or a challenge link from 0.1.0 plays exactly as before (a golden test pins this).

- Lab view with six tabs (meters, Lab, ensemble, A/B test, missions, method). Instruments, all computed from the simulation: event rates with Wilson bands, weight-vector alignment, energy-ratio histogram with thresholds, precision and recall against the threshold, shield counts, stabilizer gain trace with clamp bounds, (1+1) evolution landscape, and the repository's amplifier measurement. Each has a text equivalent in English and French.
- `stats.js`: Wilson interval, Student t interval, seeded percentile bootstrap, paired difference, histogram; tested against known values and by coverage simulation.
- `lab.js`: probe run, threshold sweep, time-sliced multi-seed ensembles with the repository CSV baselines overlaid and their file named, A/B tests on the same seeds with paired differences, five missions, CSV and JSON export.
- `charts.js`: instrument drawing with a high-contrast palette.
- `scene.js`: deforming membrane meshes with interference from the other two, an interference field, energy-scaled particle streaks, per-membrane compass dials with trails, branching crystals for true events and dull cracks for false ones, a shield gate, a skippable intro, a replay position that redraws the arena at any step.
- Replay slider and rail for the whole contest; arena text description that follows it.
- Guided tour, missions saved in this browser only, best score per scheme, motion switch, high-contrast mode.
- The engine records the alignment trace without drawing any random number; `game.js` adds `BUILD` for the page footer; `VERSION`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.2.0.
- Tests grew from 88 to 146; the headless Chrome check now covers the Lab, ensemble, A/B test, replay, exports, reduced motion and high contrast, plus 36 browser checks (`scripts/e2e-check.js`).
- Page size limit in the page test raised from 250 KB to 450 KB (the built page is about 300 KB).
- Closing the tour returns the focus to the Run button, and the letter shortcuts (G, F, S) now also work while a button has focus; Space and Enter stay with the focused button.
- Port check re-run with 100 seeds: 36 comparisons, none beyond 2 standard errors, largest 1.07 (`docs/port-check.txt`).

## 0.1.0 (first published on GitHub Pages, never tagged)

- Documentation only: added a lineage line to the README that acknowledges Mun Seok Lee for the package received under his name that membrane-crystallization began as, and states that he is not an author of this release and has not endorsed it.
- First version: a daily, practice and challenge contest of 12 generations of 8 episodes with three coupled Oja-rule membranes, a reward scheme, a cooperation setting, a 2-of-3 shield, a capped amplifier, a gain-clamped stabilizer and a (1+1) evolution step, steerable between generations.
- `game.js`: seeded port of the crystallization-contest mechanics at width 32, lazy per-generation stepping, scoring, baseline lookup, lessons, daily seeds, strict hash parsing, store sanitizer, share card.
- `baselines.js` generated from CSV copies of the repository's results; a test checks it is current and another re-derives the lesson numbers.
- `scene.js`: canvas scene with rippling membranes, pooled flow particles, lattice and crack bursts, shield flash, gain meters data, fitness chart and science chart; reduced-motion fallback; pause when hidden.
- Bilingual EN/FR interface, plain-text share card (no emoji, lines of at most 40 characters), challenge links in the URL hash, defensive local storage.
- `build.js` inlines everything into `dist/index.html`.
- Checks measured in this port and recorded in `docs/`: port against the repository means, evolution step from several starts, reward-scheme bonus.
- Headless Chrome pass (not in CI): full round in English and French at 390 px and 1366 px, plus reduced motion; no console errors, no external requests, no horizontal overflow; plus 19 browser checks of the daily record, damaged and blocked storage, hostile hash input, challenge links and keyboard control (`scripts/e2e-check.js`).
- 88 tests with Node's built-in runner, README, DESIGN, CITATION.cff and .zenodo.json.
- CI: tests on Node 20, 22 and 24 for every push and pull request, and a GitHub Pages deploy of `dist/index.html` from `main` after the tests pass.
