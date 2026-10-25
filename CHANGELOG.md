# Changelog

## 0.1.0 (unreleased)

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
