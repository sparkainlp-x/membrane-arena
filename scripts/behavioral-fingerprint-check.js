/*
 * Behavioral-fingerprint check for Membrane Arena (SYNTHETIC classical simulation).
 *
 * Follow-up to the shield-strictness check (PR #13): no VOTING rule separates
 * a shared artifact from a real signal, and strictness backfires. This check
 * asks whether the limit is deeper — informational. If the artifact and the
 * signal are the same dynamical object to the membranes (both are just a
 * vector the membranes see noisy copies of), then NO behavioral feature of
 * the membranes should differ between them either: not when they declare,
 * not how their energy rises, not how fast they align to the pattern.
 *
 * It measures a fingerprint of behavioral features per episode, all from the
 * game's REAL episode() (game.js, unmodified) with the default membrane
 * params (th 0.5, c 0.05, g 1.0), warm=null, amp=0, N=32, game sigma 0.2652:
 *
 *   - nDecl: number of membranes that declare (0-3).
 *   - firstDeclStep / meanDeclStep: when they declare (steps 10..60).
 *   - energyAtDecl: mean energy (trace) at the declaration step.
 *   - pairFid: mean pairwise fidelity between the declarations.
 *   - shieldPass: the 2-of-3 shield's verdict.
 *   - fid10 / fid30 / fid60: mean sqrt-fidelity of the membranes' vectors
 *     to the pattern at steps 10, 30, 60 (the alignment trajectory).
 *
 * Conditions: signal (fresh planted pattern per episode) vs artifact (fresh
 * shared vector per episode, beta=1), K=1000 each, plus noise as a control.
 * For each feature it reports the mean for signal and artifact with a 95%
 * confidence interval on the difference. A feature separates the causes only
 * if the difference is significant (|z| >= 2) AND large enough to act on.
 *
 * The check PASSES only if some feature separates the causes (a significant,
 * usable difference). Otherwise it FAILS (exit 1): the behavioral fingerprint
 * is identical, the limit is informational, and no measurement of the
 * membranes' behavior can tell the artifact from the signal — the distinction
 * has to come from outside the membranes (an independent channel, a probe of
 * the input, or a prior). Full numbers: docs/BEHAVIORAL-FINGERPRINT.md.
 *
 *   node scripts/behavioral-fingerprint-check.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const G = require('../game.js');

const N = G.N; // 32
const SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
const P0 = (c) => ({ th: 0.5, c: c, g: 1.0, sp: 0.5, geff: 1 });

function featuresFor(condition, episodes) {
  const rng = G.makeRng('behavioral-fingerprint/' + condition);
  const feats = {
    nDecl: [], firstDeclStep: [], meanDeclStep: [], energyAtDecl: [],
    pairFid: [], shieldPass: [], fid10: [], fid30: [], fid60: [],
  };
  for (let e = 0; e < episodes; e++) {
    const ref = (condition === 'noise') ? null : G.rvec(N, rng);
    const pat = ref;
    const P = [P0(0.05), P0(0.05), P0(0.05)];
    const trace = new Float32Array(G.STEPS * 3);
    const fid = new Float32Array(G.STEPS * 3);
    const ep = G.episode(N, pat, SIGMA, P, null, 0, rng, trace, { fid });
    const d = ep.decl;
    const steps = ep.declStep.filter((s) => s !== null);
    feats.nDecl.push(steps.length);
    feats.firstDeclStep.push(steps.length ? Math.min(...steps) : NaN);
    feats.meanDeclStep.push(steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : NaN);
    let eSum = 0, eN = 0;
    for (let i = 0; i < 3; i++) {
      if (d[i]) { eSum += trace[(ep.declStep[i] - 1) * 3 + i]; eN++; }
    }
    feats.energyAtDecl.push(eN ? eSum / eN : NaN);
    let pSum = 0, pN = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      if (d[i] && d[j]) { pSum += G.fidelity(d[i], d[j]); pN++; }
    }
    feats.pairFid.push(pN ? pSum / pN : NaN);
    feats.shieldPass.push(G.systemEvent(d, G.AGREE) !== null ? 1 : 0);
    const fidAt = (t) => {
      let s = 0;
      for (let i = 0; i < 3; i++) s += fid[(t - 1) * 3 + i];
      return s / 3;
    };
    feats.fid10.push(fidAt(10));
    feats.fid30.push(fidAt(30));
    feats.fid60.push(fidAt(60));
  }
  return feats;
}

function stats(values) {
  const v = values.filter((x) => !Number.isNaN(x));
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
  return { n, mean, se: sd / Math.sqrt(n) };
}

function main() {
  const K = 1000;
  const sig = featuresFor('signal', K);
  const art = featuresFor('artifact', K);
  const noise = featuresFor('noise', K);
  const names = [
    ['nDecl', 'declarations per episode', 'count'],
    ['firstDeclStep', 'first declaration step', 'step'],
    ['meanDeclStep', 'mean declaration step', 'step'],
    ['energyAtDecl', 'energy at declaration', 'energy'],
    ['pairFid', 'pairwise fidelity of declarations', 'fidelity'],
    ['shieldPass', 'shield pass rate', 'rate'],
    ['fid10', 'alignment to pattern, step 10', 'sqrt-fid'],
    ['fid30', 'alignment to pattern, step 30', 'sqrt-fid'],
    ['fid60', 'alignment to pattern, step 60', 'sqrt-fid'],
  ];
  console.log('behavioral fingerprint, K=' + K + ' episodes/condition, game sigma ' + SIGMA.toFixed(4));
  console.log('feature                              signal      artifact    diff (95% CI)        |z|');
  let bestZ = 0, bestName = '';
  for (const [key, label, unit] of names) {
    const s = stats(sig[key]), a = stats(art[key]);
    const diff = s.mean - a.mean;
    const se = Math.sqrt(s.se * s.se + a.se * a.se);
    const z = se > 0 ? Math.abs(diff) / se : 0;
    if (z > bestZ) { bestZ = z; bestName = label; }
    const lo = diff - 1.96 * se, hi = diff + 1.96 * se;
    console.log(
      label.padEnd(36) +
      s.mean.toFixed(3).padStart(8) + '  ' + a.mean.toFixed(3).padStart(8) + '  ' +
      (diff >= 0 ? '+' : '') + diff.toFixed(3) + ' [' + (lo >= 0 ? '+' : '') + lo.toFixed(3) + ', ' + (hi >= 0 ? '+' : '') + hi.toFixed(3) + ']' +
      '  ' + z.toFixed(2).padStart(5)
    );
  }
  const nSig = stats(noise.nDecl), nPass = stats(noise.shieldPass);
  console.log('\ncontrol (noise): ' + nSig.mean.toFixed(3) + ' declarations/episode, shield pass ' + (100 * nPass.mean).toFixed(1) + '%');
  console.log('largest |z|: ' + bestZ.toFixed(2) + ' (' + bestName + ')');
  if (bestZ >= 2) {
    console.log('PASS: a behavioral feature separates the artifact from the signal.');
    process.exit(0);
  }
  console.log('FAIL: no behavioral feature separates the artifact from the signal — the fingerprint is identical and the limit is informational.');
  process.exit(1);
}

main();
