/*
 * Reference-leak check for Membrane Arena (SYNTHETIC classical simulation).
 *
 * Follow-up to the reference channel (PR #16): when the shield passes, an
 * independent reference channel that sees the environment but not the
 * disturbance is asked whether the declared pattern is really there. It
 * confirms the signal 94% of the time and the artifact never (K=100/arm;
 * K=500 verification: 92.6% vs 0.0%), so the shield has grounds.
 *
 * This check asks the next question: how much disturbance can leak into the
 * reference channel before it stops working? The reference channel's power
 * rests on the disturbance being confined to the membranes' channel. Here
 * the artifact leaks into the reference channel at strength gamma (0 = the
 * reference sees only noise, as in PR #16; 1 = the reference sees the full
 * artifact, as if it were a signal). It calls the game's REAL episode()
 * (game.js, unmodified) with the default membrane params (th 0.5, c 0.05,
 * g 1.0), warm=null, amp=0, N=32. When the shield passes, the reference
 * probe runs 20 samples from the reference channel and confirms the
 * declared pattern when its mean energy ratio reaches the game's own
 * declaration threshold (scaledThreshold, 3.91).
 *
 *   - signal:   pat=<fresh pattern per episode>, game sigma. The reference
 *               channel sees noisy(pat) at every gamma. Positive control.
 *   - artifact: pat=<one shared vector, fresh per episode>, beta=1. The
 *               reference channel sees noisy(gamma * art); gamma=0 is pure
 *               noise, gamma=1 is the full artifact.
 *
 * The check PASSES only if the reference is robust: it does not confirm
 * the artifact (decide rate < 50%) at gamma <= 0.5 — it tolerates up to a
 * half-strength leak — and it keeps confirming the signal (decide rate
 * > 50%) at every gamma. Otherwise it FAILS (exit 1): the reference is
 * fragile, and the shield's grounds depend on a leak smaller than half
 * strength. Full numbers: docs/REFERENCE-LEAK.md.
 *
 *   node scripts/reference-leak-check.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const G = require('../game.js');

const N = G.N; // 32
const SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
const P0 = { th: 0.5, c: 0.05, g: 1.0, sp: 0.5, geff: 1 };
const THR = G.scaledThreshold(0.5, N, SIGMA); // 3.91
const M = 20; // reference samples per shield pass

function refConfirms(decl, refPat, rng) {
  let sum = 0;
  for (let m = 0; m < M; m++) {
    const x = refPat ? G.noisy(refPat, SIGMA, rng) : G.rvec(N, rng);
    const y = G.inner(x, decl);
    sum += y.re * y.re + y.im * y.im;
  }
  return N * sum / M >= THR;
}

function runGamma(gamma, episodes) {
  const rng = G.makeRng('reference-leak/gamma-' + gamma);
  let artPass = 0, artConf = 0, sigPass = 0, sigConf = 0;
  for (let e = 0; e < episodes; e++) {
    const P = [P0, P0, P0];
    const trace = new Float32Array(G.STEPS * 3);
    // artifact arm
    const art = G.rvec(N, rng);
    const patA = { r: Float64Array.from(art.r, (v) => v), i: Float64Array.from(art.i, (v) => v) };
    const dA = G.episode(N, patA, SIGMA, P, null, 0, rng, trace, {}).decl;
    const pA = G.systemEvent(dA, G.AGREE);
    if (pA !== null) {
      artPass++;
      const refPat = gamma === 0 ? null : { r: Float64Array.from(art.r, (v) => v * gamma), i: Float64Array.from(art.i, (v) => v * gamma) };
      if (refConfirms(dA[pA], refPat, rng)) artConf++;
    }
    // signal arm (control)
    const pat = G.rvec(N, rng);
    const dS = G.episode(N, pat, SIGMA, P, null, 0, rng, trace, {}).decl;
    const pS = G.systemEvent(dS, G.AGREE);
    if (pS !== null) {
      sigPass++;
      if (refConfirms(dS[pS], pat, rng)) sigConf++;
    }
  }
  return {
    gamma,
    artifact: { pass: artPass / episodes, confirm: artPass ? artConf / artPass : 0, decide: artConf / episodes },
    signal: { pass: sigPass / episodes, confirm: sigPass ? sigConf / sigPass : 0, decide: sigConf / episodes },
  };
}

function main() {
  const K = 500;
  const gammas = [0, 0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 1.0];
  console.log('reference-leak check: artifact confirm rate by leak strength gamma');
  console.log('(K=' + K + ' episodes/arm/gamma, M=' + M + ' reference samples, threshold ' + THR.toFixed(2) + ', game sigma ' + SIGMA.toFixed(4) + ')');
  console.log('gamma  artifact decide  artifact confirm  signal decide  signal confirm');
  const rows = gammas.map((g) => runGamma(g, K));
  for (const r of rows) {
    console.log(
      r.gamma.toFixed(2).padEnd(7) +
      (100 * r.artifact.decide).toFixed(1).padStart(10) + '%  ' +
      (100 * r.artifact.confirm).toFixed(1).padStart(11) + '%  ' +
      (100 * r.signal.decide).toFixed(1).padStart(9) + '%  ' +
      (100 * r.signal.confirm).toFixed(1).padStart(9) + '%'
    );
  }
  // The break: the first gamma where the artifact decide rate reaches 50%.
  const brk = rows.find((r) => r.artifact.decide >= 0.5);
  console.log('\nbreak: ' + (brk ? 'artifact decide rate reaches 50% at gamma ' + brk.gamma.toFixed(2) + ' (' + (100 * brk.artifact.decide).toFixed(1) + '%)' : 'artifact decide rate stays below 50% at every gamma'));
  const robust = rows.filter((r) => r.gamma <= 0.5).every((r) => r.artifact.decide < 0.5) &&
    rows.every((r) => r.signal.decide > 0.5);
  if (robust) {
    console.log('PASS: the reference channel tolerates up to a half-strength leak (gamma <= 0.5) and keeps confirming the signal.');
    process.exit(0);
  }
  console.log('FAIL: the reference channel is fragile — it confirms the artifact at a leak of half strength or less, or it stops confirming the signal.');
  process.exit(1);
}

main();
