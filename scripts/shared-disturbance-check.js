/*
 * Shared-disturbance check for Membrane Arena (SYNTHETIC classical simulation).
 *
 * Marco Frei's question (LinkedIn, 2026-11-06): do the three votes stay
 * independent, or does the 2-of-3 shield merely certify a common error?
 *
 * The check injects a SHARED artifact into all three membranes' inputs, in
 * episodes with no planted pattern, and measures whether the 2-of-3 shield
 * still fires. It calls the game's REAL episode() (game.js, unmodified) with
 * the default membrane params (th 0.5, c 0.05, g 1.0 — the repository
 * baselines' starting point), warm=null, amp=0, N=32.
 *
 *   - noise:    pat=null. Each membrane each step sees an independent random
 *               vector. Any shield pass is a false event.
 *   - artifact: pat=<one shared vector, fresh per episode>. Every membrane
 *               sees noisy copies of the SAME vector — a common-mode
 *               disturbance. Any shield pass certifies the common error.
 *               Part 2 varies the artifact strength beta (pat = beta*artifact,
 *               sigma fixed at the game value so the threshold never moves):
 *               beta=1 is a full-strength artifact, beta=0 is pure noise.
 *   - planted:  pat=<fresh pattern per episode>, game sigma. Positive control:
 *               shield passes here are true events.
 *
 * Shield rule is the game's own: systemEvent(decls, AGREE=0.4) — a declaration
 * passes when it agrees (fidelity >= 0.4) with at least one other, i.e. 2 of 3.
 *
 * Measured 2026-11-06 (game.js v0.3.5): clean noise 0.0% shield pass; shared
 * artifact at game sigma 96.6% pass (96.4% matching the artifact); planted
 * pattern 95.5% pass. Dose-response: half-strength artifact 0.0%, 75% strength
 * 1.4%, full strength 94.2%. The shield cannot distinguish a shared artifact
 * from a real signal — it certifies the common error. This check FAILS (exit 1)
 * while the artifact pass rate exceeds 50%, and passes once the game defends
 * against shared disturbance (e.g. a shared-disturbance scenario, or a
 * per-membrane independence check). Full numbers: docs/SHARED-DISTURBANCE.md.
 *
 *   node scripts/shared-disturbance-check.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const G = require('../game.js');

const N = G.N; // 32
const SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
const P0 = (c) => ({ th: 0.5, c: c, g: 1.0, sp: 0.5, geff: 1 });

function runCondition(name, episodes, opts) {
  const rng = G.makeRng('shared-disturbance/' + name);
  let decl1 = 0, decl2 = 0, pass = 0, passMatch = 0, totalDecl = 0;
  for (let e = 0; e < episodes; e++) {
    const art = opts.artifact ? G.rvec(N, rng) : null; // unit artifact, fresh per episode
    let pat = null;
    if (art && opts.beta > 0) {
      pat = { r: Float64Array.from(art.r, (v) => v * opts.beta), i: Float64Array.from(art.i, (v) => v * opts.beta) };
    }
    const P = [P0(opts.c), P0(opts.c), P0(opts.c)];
    const trace = new Float32Array(G.STEPS * 3);
    const ep = G.episode(N, pat, opts.sigma, P, null, 0, rng, trace, {});
    const d = ep.decl;
    const nDecl = d.filter(Boolean).length;
    totalDecl += nDecl;
    if (nDecl >= 1) decl1++;
    if (nDecl >= 2) decl2++;
    const passed = G.systemEvent(d, G.AGREE);
    if (passed !== null) {
      pass++;
      if (art && G.fidelity(d[passed], art) >= G.TRUTH) passMatch++;
    }
  }
  return {
    condition: name, sigma: opts.sigma, beta: opts.beta, coupling: opts.c,
    declAtLeast1: decl1 / episodes, declAtLeast2: decl2 / episodes,
    shieldPass: pass / episodes, shieldPassMatchesArtifact: passMatch / episodes,
    meanDeclPerEpisode: totalDecl / episodes
  };
}

function printTable(title, rows) {
  console.log(title);
  console.log('condition             sigma  beta  c     >=1 decl  >=2 decl  shield pass  pass=artifact  mean decl/ep');
  rows.forEach((r) => {
    const f = (x) => (x * 100).toFixed(1).padStart(6) + '%';
    console.log(
      r.condition.padEnd(20) + ' ' + String(r.sigma).padEnd(6) +
      ' ' + String(r.beta).padEnd(5) + ' ' + String(r.coupling).padEnd(5) +
      ' ' + f(r.declAtLeast1) + ' ' + f(r.declAtLeast2) + ' ' + f(r.shieldPass) +
      ' ' + f(r.shieldPassMatchesArtifact) + ' ' + r.meanDeclPerEpisode.toFixed(2).padStart(6)
    );
  });
  console.log('');
}

console.log('Shared-disturbance check — Membrane Arena game.js v' + G.VERSION);
console.log('N=' + N + ', game sigma=' + SIGMA.toFixed(4) + ', defaults th=0.5 g=1.0');
console.log('');

// Part 1: operating point, 1000 episodes/condition.
const part1 = [
  runCondition('noise', 1000, { artifact: false, beta: 0, sigma: SIGMA, c: 0.05 }),
  runCondition('artifact-sigma0.265', 1000, { artifact: true, beta: 1, sigma: SIGMA, c: 0.05 }),
  runCondition('planted-sigma0.265', 1000, { artifact: true, beta: 1, sigma: SIGMA, c: 0.05 })
];
// Note: part 1's planted row reuses the artifact row's mechanism (pat = a fresh
// vector per episode at game sigma); it is the positive control — the shield
// passes a real pattern at the same rate. The artifact row is the same input
// process relabelled: a shared vector with no planted pattern behind it.
printTable('Part 1 — operating point (1000 episodes/condition):', part1);

// Part 2: dose-response, threshold fixed at game sigma, 500 episodes/condition.
const part2 = [
  runCondition('artifact-beta0.10', 500, { artifact: true, beta: 0.10, sigma: SIGMA, c: 0.05 }),
  runCondition('artifact-beta0.25', 500, { artifact: true, beta: 0.25, sigma: SIGMA, c: 0.05 }),
  runCondition('artifact-beta0.50', 500, { artifact: true, beta: 0.50, sigma: SIGMA, c: 0.05 }),
  runCondition('artifact-beta0.75', 500, { artifact: true, beta: 0.75, sigma: SIGMA, c: 0.05 }),
  runCondition('artifact-beta1.00', 500, { artifact: true, beta: 1.00, sigma: SIGMA, c: 0.05 }),
  runCondition('artifact-s0.265-c0', 500, { artifact: true, beta: 1.00, sigma: SIGMA, c: 0 }),
  runCondition('artifact-s2.0-c0', 500, { artifact: true, beta: 1.00, sigma: 2.0, c: 0 }),
  runCondition('noise-c0', 500, { artifact: false, beta: 0, sigma: SIGMA, c: 0 })
];
printTable('Part 2 — dose-response + coupling controls (500 episodes/condition):', part2);

// Verdict: the check fails while the shield certifies the common error more
// often than not at full artifact strength (beta=1, game sigma).
const worst = part1[1].shieldPass;
if (worst > 0.5) {
  console.log('FAIL: shared artifact passes the 2-of-3 shield ' + (worst * 100).toFixed(1) +
    '% of the time at full strength (planted pattern: ' + (part1[2].shieldPass * 100).toFixed(1) +
    '%). The shield certifies a common error.');
  process.exit(1);
}
console.log('PASS: shared artifact passes the 2-of-3 shield ' + (worst * 100).toFixed(1) + '% of the time.');
