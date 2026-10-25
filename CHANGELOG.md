# Changelog

## 0.2.0 (2026-10-25)

A seed, a daily seed or a challenge link from 0.1.0 plays exactly as before (a golden test pins this).

- Lab view with six tabs (meters, Lab, ensemble, A/B test, missions, method). Instruments, all computed from the simulation: event rates with Wilson bands, weight-vector alignment, energy-ratio histogram with thresholds, precision and recall against the threshold, shield counts, stabilizer gain trace with clamp bounds, (1+1) evolution landscape, and the repository's amplifier measurement. Each has a text equivalent in English and French.
- `stats.js`: Wilson interval, Student t interval, seeded percentile bootstrap, paired difference, histogram; tested against known values and by coverage simulation.
- `lab.js`: probe run, threshold sweep, time-sliced multi-seed ensembles with the repository CSV baselines overlaid and their file named, A/B tests on the same seeds with paired differences, five missions, CSV and JSON export.
- `charts.js`: instrument drawing with a high-contrast palette.
- `scene.js`: deforming membrane meshes with interference from the other two, an interference field, energy-scaled particle streaks, per-membrane compass dials with trails, branching crystals for true events and dull cracks for false ones, a shield gate, a skippable intro, a replay position that redraws the arena at any step.
- Replay slider and rail for the whole contest; arena text description that follows it.
- Guided tour, missions saved in this browser only, best score per scheme, motion switch, high-contrast mode.
- The engine records the alignment trace without drawing any random number; `game.js` adds `BUILD` for the page footer; `VERSION`, `package.json`, `CITATION.cff` and `.zenodo.json` now say 0.2.0.
- Tests grew from 88 to 144; the headless Chrome check now covers the Lab, ensemble, A/B test, replay, exports, reduced motion and high contrast, plus 36 browser checks (`scripts/e2e-check.js`).
- Page size limit in the page test raised from 250 KB to 450 KB (the built page is about 300 KB).
- Closing the tour returns the focus to the Run button, so the keyboard shortcuts keep working.
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
