/*
 * Integrated-shield check for Membrane Arena (SYNTHETIC classical simulation).
 *
 * The reference channel (PR #16) was Lab-only: it proved the shield could
 * have grounds, but the in-game shield still voted 2-of-3 without consulting
 * it. This check measures the integrated shield — the in-game shield now
 * consults the reference channel before committing (game.js shieldCommit).
 * It calls the game's REAL episode() with the default membrane params
 * (th 0.5, c 0.05, g 1.0), warm=null, amp=0, N=32, then applies the game's
 * REAL shieldCommit (2-of-3 agreement as the trigger, the reference channel
 * as the gate, M=20 samples, threshold scaledThreshold(0.5, 32, sigma)=3.91).
 * The reference draws from its own RNG stream, independent of the
 * membranes' stream, exactly as the game does (createContest refRng).
 *
 *   - signal:   pat=<fresh pattern per episode>. The reference channel sees
 *               the pattern (it is in the environment). Positive control.
 *   - artifact: pat=<one shared vector, fresh per episode>, beta=1. The
 *               reference channel sees only noise — the artifact lives only
 *               in the membranes' channel, so the true environment pattern
 *               is null.
 *
 * The check PASSES only if the integrated shield has grounds: it commits on
 * the signal (commit rate > 50%) and abstains on the artifact (commit rate
 * < 50%). Otherwise it FAILS (exit 1): the integrated shield overcommits on
 * the artifact, or it stops committing on the signal. Full numbers:
 * docs/INTEGRATED-SHIELD.md.
 *
 *   node scripts/integrated-shield-check.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const G = require('../game.js');

const N = G.N; // 32
const SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
const P0 = { th: 0.5, c: 0.05, g: 1.0, sp: 0.5, geff: 1 };
const THR = G.scaledThreshold(0.5, N, SIGMA); // 3.91
const M = G.REF_M; // 20

function runArm(kind, K, rng, refRng) {
  let pass = 0, commit = 0, passMatch = 0;
  for (let e = 0; e < K; e++) {
    const P = [P0, P0, P0];
    const trace = new Float32Array(G.STEPS * 3);
    let pat, refPat;
    if (kind === 'signal') {
      pat = G.rvec(N, rng);
      refPat = pat;
    } else {
      const art = G.rvec(N, rng);
      pat = { r: Float64Array.from(art.r, (v) => v), i: Float64Array.from(art.i, (v) => v) };
      refPat = null; // the artifact is not in the environment
    }
    const d = G.episode(N, pat, SIGMA, P, null, 0, rng, trace, {}).decl;
    const sc = G.shieldCommit(d, refPat, SIGMA, refRng);
    if (sc.refChecked) pass++;
    if (sc.passed !== null) {
      commit++;
      if (refPat && G.fidelity(d[sc.passed], refPat) >= G.TRUTH) passMatch++;
    }
  }
  return {
    passRate: pass / K,
    commitRate: commit / K,
    confirmRate: pass ? commit / pass : 0,
    passMatch: passMatch,
  };
}

function main() {
  const K = 500;
  const rng = G.makeRng('membrane-arena/v1/integrated-shield/repo');
  const refRng = G.makeRng('membrane-arena/v1/integrated-shield/reference');
  console.log('integrated-shield check: signal commit rate vs artifact commit rate');
  console.log('(K=' + K + ' episodes/arm, M=' + M + ' reference samples, threshold ' + THR.toFixed(2) + ', game sigma ' + SIGMA.toFixed(4) + ')');
  const signal = runArm('signal', K, rng, refRng);
  const artifact = runArm('artifact', K, rng, refRng);
  console.log('arm       2-of-3 pass   commit rate   confirm | pass');
  console.log(
    'signal  ' +
    (100 * signal.passRate).toFixed(1).padStart(10) + '%  ' +
    (100 * signal.commitRate).toFixed(1).padStart(9) + '%  ' +
    (100 * signal.confirmRate).toFixed(1).padStart(9) + '%'
  );
  console.log(
    'artifact' +
    (100 * artifact.passRate).toFixed(1).padStart(10) + '%  ' +
    (100 * artifact.commitRate).toFixed(1).padStart(9) + '%  ' +
    (100 * artifact.confirmRate).toFixed(1).padStart(9) + '%'
  );
  console.log('signal passMatch (committed declaration matches the pattern): ' + signal.passMatch + '/' + K);
  console.log('artifact passMatch (committed declaration matches the artifact): ' + artifact.passMatch + '/' + K);
  const grounds = signal.commitRate > 0.5 && artifact.commitRate < 0.5;
  if (grounds) {
    console.log('PASS: the integrated shield commits on the signal and abstains on the artifact — it has grounds in play.');
    process.exit(0);
  }
  console.log('FAIL: the integrated shield does not have grounds in play (signal commit <= 50% or artifact commit >= 50%).');
  process.exit(1);
}

main();
