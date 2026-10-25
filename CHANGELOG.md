# Changelog
## 0.3.2 (2026-10-25)
The arena, brain, Quorum Keeper and Reverse Membranes mechanics and their seeds are unchanged; their built pages change only in the version string and in the new links between pages.
- Reverse Pair: `pair.js` (a reverse observer and a predictable calibrator taking turns on one clock, signed-amplitude sine tones on 9 frequencies, on-grid and off-grid fades, equalizer, 2-membrane shield, oracle and random baselines, seeded contest, calibration check, score card), `pair.html`, `pair-i18n.js` (English and French), `pairui.js`, `pair.css`, built to `dist/pair.html`. See `docs/PAIR.md`.
- Frozen evaluation protocol `docs/PAIR-PROTOCOL.md` (hypotheses, metrics, settings grid, 40 calibration seeds and 120 held-out seeds, analysis plan), written and hashed before the held-out run.
- `scripts/pair-check.js` runs it: thresholds chosen on calibration seeds only; every held-out number with a 95% bootstrap interval; paired differences with d_z and win/tie/loss counts; off-grid fades with random bandwidth beside on-grid ones; observer alone, ticks only, equalizer, shield, full pair, oracle and random baselines; the shield split into filtering and scoring-rule weighting; measured against predicted calibrator error per frequency and tick share. `--write` writes `docs/pair-check.txt`, `docs/pair-results.json`, `docs/pair-results.csv` and `docs/pair-manifest.json` (seeds, versions, SHA-256 of inputs and outputs); `--verify` recomputes and compares, and the tests workflow runs it on Node 20, 22 and 24.
- Headline (held-out, 2 : 1): full pair minus observer alone, +41.11 [39.80, 42.42] on-grid and +27.78 [26.31, 29.25] off-grid. The shield's filtering effect is not detectable once the equalizer is on.
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
