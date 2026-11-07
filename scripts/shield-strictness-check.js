/*
 * Shield-strictness check for Membrane Arena (SYNTHETIC classical simulation).
 *
 * Follow-up to the grounds mission (PR #12): the committee overcommits — it
 * commits on a shared artifact as if it were a signal (signal 95.5%, artifact
 * 96.6%, coupling off 94.0%), and the requested measurement does not separate
 * the causes. Marco Frei's point: the strongest shield would regulate WHEN
 * the committee has grounds to decide.
 *
 * This check asks the next question: does ANY voting rule separate them? It
 * sweeps the shield's two knobs — the agreement threshold (fidelity two
 * declarations need to count as agreeing) and the required count (2 of 3 vs
 * unanimous 3 of 3) — and measures the shield pass rate for a planted signal
 * and for a full-strength shared artifact at every setting. It calls the
 * game's REAL episode() (game.js, unmodified) with the default membrane
 * params (th 0.5, c 0.05, g 1.0), warm=null, amp=0, N=32.
 *
 *   - signal:   pat=<fresh pattern per episode>, game sigma. Positive control.
 *   - artifact: pat=<one shared vector, fresh per episode>, beta=1. Any shield
 *               pass certifies the common error.
 *   - noise:    pat=null. Any shield pass is a false event.
 *
 * The shield rule at required=2 is the game's own systemEvent(decls, thresh).
 * At required=3 the same counting is applied with a unanimity requirement
 * (all three declarations must agree with each other); the counting is
 * re-implemented locally from the exported fidelity() because agreeing() is
 * not exported, and verified to reproduce systemEvent() exactly at required=2.
 *
 * The check PASSES only if some setting separates the causes: signal pass
 * >= 50% AND artifact pass <= 25% at that setting. Otherwise it FAILS
 * (exit 1): no voting rule on these responses can tell the artifact from
 * the signal, and the identifiability limit holds across the whole rule
 * space, not just at the 2-of-3 / 0.4 setting. Full numbers:
 * docs/SHIELD-STRICTNESS.md.
 *
 *   node scripts/shield-strictness-check.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const G = require('../game.js');

const N = G.N; // 32
const SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
const P0 = (c) => ({ th: 0.5, c: c, g: 1.0, sp: 0.5, geff: 1 });

// Local re-implementation of agreeing() (not exported) + systemEvent with a
// configurable required count. Verified below to match G.systemEvent at k=2.
function agreeingCount(vec, decls, thresh) {
  let c = 0;
  for (let k = 0; k < decls.length; k++) {
    if (decls[k] && G.fidelity(vec, decls[k]) >= thresh) c++;
  }
  return c;
}
function systemEventK(decls, thresh, k) {
  for (let i = 0; i < decls.length; i++) {
    if (decls[i] && agreeingCount(decls[i], decls, thresh) >= k) return i;
  }
  return null;
}

function runCell(condition, episodes, thresh, required) {
  const rng = G.makeRng('shield-strictness/' + condition);
  let pass = 0, passMatch = 0;
  for (let e = 0; e < episodes; e++) {
    const ref = (condition === 'noise') ? null : G.rvec(N, rng);
    const pat = (condition === 'artifact' || condition === 'signal') ? ref : null;
    const P = [P0(0.05), P0(0.05), P0(0.05)];
    const trace = new Float32Array(G.STEPS * 3);
    const ep = G.episode(N, pat, SIGMA, P, null, 0, rng, trace, {});
    const passed = systemEventK(ep.decl, thresh, required);
    if (passed !== null) {
      pass++;
      if (ref && G.fidelity(ep.decl[passed], ref) >= G.TRUTH) passMatch++;
    }
  }
  return { condition, thresh, required, pass: pass / episodes, passMatch: passMatch / episodes };
}

function main() {
  const K = 500;
  const thresholds = [0.4, 0.6, 0.8];
  const requireds = [2, 3];
  const conditions = ['signal', 'artifact', 'noise'];

  // Self-check: the local counter must reproduce the game's own shield.
  const rngCheck = G.makeRng('shield-strictness/self-check');
  for (let e = 0; e < 200; e++) {
    const pat = G.rvec(N, rngCheck);
    const P = [P0(0.05), P0(0.05), P0(0.05)];
    const trace = new Float32Array(G.STEPS * 3);
    const ep = G.episode(N, pat, SIGMA, P, null, 0, rngCheck, trace, {});
    if (systemEventK(ep.decl, G.AGREE, 2) !== G.systemEvent(ep.decl, G.AGREE)) {
      console.error('SELF-CHECK FAILED: local shield disagrees with systemEvent at k=2');
      process.exit(2);
    }
  }
  console.log('self-check: local shield reproduces systemEvent at k=2 (200 episodes)');

  const rows = [];
  for (const thresh of thresholds) {
    for (const required of requireds) {
      for (const condition of conditions) {
        rows.push(runCell(condition, K, thresh, required));
      }
    }
  }

  console.log('\nshield pass rate (K=' + K + ' episodes/cell, game sigma ' + SIGMA.toFixed(4) + ')');
  console.log('thresh  required  signal   artifact  noise    signal-artifact gap');
  let best = null;
  for (const thresh of thresholds) {
    for (const required of requireds) {
      const s = rows.find((r) => r.thresh === thresh && r.required === required && r.condition === 'signal');
      const a = rows.find((r) => r.thresh === thresh && r.required === required && r.condition === 'artifact');
      const n = rows.find((r) => r.thresh === thresh && r.required === required && r.condition === 'noise');
      const gap = s.pass - a.pass;
      console.log(
        thresh.toFixed(1).padEnd(8) + String(required).padEnd(10) +
        (100 * s.pass).toFixed(1).padStart(6) + '%  ' +
        (100 * a.pass).toFixed(1).padStart(6) + '%  ' +
        (100 * n.pass).toFixed(1).padStart(6) + '%  ' +
        (100 * gap).toFixed(1).padStart(8) + ' pts'
      );
      const separates = s.pass >= 0.5 && a.pass <= 0.25;
      if (!best || gap > best.gap) best = { thresh, required, gap, separates, signal: s.pass, artifact: a.pass };
    }
  }

  console.log('\nbest separation: thresh ' + best.thresh + ', required ' + best.required +
    ' — signal ' + (100 * best.signal).toFixed(1) + '%, artifact ' + (100 * best.artifact).toFixed(1) +
    '%, gap ' + (100 * best.gap).toFixed(1) + ' pts');
  if (best.separates) {
    console.log('PASS: a shield setting separates the artifact from the signal.');
    process.exit(0);
  }
  console.log('FAIL: no voting rule separates the artifact from the signal — the identifiability limit holds across the whole rule space.');
  process.exit(1);
}

main();
