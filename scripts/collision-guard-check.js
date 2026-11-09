/*
 * Collision-guard check for Membrane Arena (SYNTHETIC classical simulation).
 *
 * Follow-up to the 3x3 membrane work (rounds 1-6): the shield was blind to
 * a pairwise collision — two cells converging to the same state while the
 * rest stayed spread out. A pairwise guard with a margin condition (fires
 * only when the collision is localised, not on global synchronisation)
 * catches it. This check carries that guard into the browser game.
 *
 * The game's shield is 2-of-3 agreement (AGREE = 0.4). It counts agreement
 * but not its structure: it cannot tell two membranes declaring
 * near-identical vectors (one effective witness, counted twice) from two
 * independent membranes that happen to agree. The collision guard
 * (game.js pairwiseCollision, COLLIDE = 0.9, COLL_MARGIN = 0.05) fires when
 * the closest pair of declarations is far above the mean fidelity — a
 * localised collision — and the shield abstains instead of committing.
 * It stays silent on global consensus, whether signal or artifact.
 *
 * This check calls the game's REAL collisionProbe (lab.js) at K = 500/arm
 * with the repository starting parameters (th 0.5, c 0.05, g 1.0), warm =
 * null, amp = 0, N = 32, and a noise control run on the real episode():
 *
 *   - signal:    pat = <fresh pattern per episode>. Positive control: the
 *                guard should stay silent (global consensus) and the shield
 *                should commit.
 *   - artifact:  pat = <one shared vector, fresh per episode>, beta = 1.
 *                Global consensus too: the guard should stay silent. It
 *                does NOT separate signal from artifact — that is the
 *                reference channel's job (PR #16 / #18).
 *   - collision: pat = <fresh pattern per episode>, membranes 0 and 1
 *                strongly coupled (c = 0.5) while membrane 2 is uncoupled
 *                (c = 0), so the pair declares near-identical vectors.
 *                The guard should fire far more often here than on signal.
 *   - noise:     pat = null. Nobody should declare, so the guard never
 *                fires and the shield never passes.
 *
 * The check PASSES (exit 0) only if the mission evaluates to 'grounds':
 * the signal commits (> 50%) and the guard fires on the planted collision
 * at least 5x its fire rate on the signal, on more than 10% of the planted
 * arm. Otherwise it FAILS (exit 1). Full numbers:
 * docs/COLLISION-GUARD.md.
 *
 *   node scripts/collision-guard-check.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const G = require('../game.js');
const L = require('../lab.js');

const N = G.N; // 32
const SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
const K = 500;

function pct(x) { return (100 * x).toFixed(1) + '%'; }

var settings = Object.assign({}, G.DEFAULTS, L.REPO_START, { shield: true, amp: false, stab: false });
var res = L.collisionProbe(settings, K, 'check', 1);

// Noise control on the real episode(): pat = null, repo-start params.
var rng = G.makeRng('membrane-arena/v1/collision/check-noise');
var P = [0, 1, 2].map(function () { return { th: 0.5, c: 0.05, g: 1.0, sp: 0.5, geff: 1 }; });
var noisePass = 0, noiseFire = 0;
for (var e = 0; e < K; e++) {
  var trace = new Float32Array(G.STEPS * 3);
  var d = G.episode(N, null, SIGMA, P, null, 0, rng, trace, {}).decl;
  if (G.systemEvent(d, G.AGREE) !== null) { noisePass++; if (G.pairwiseCollision(d).collided) noiseFire++; }
}
var noise = { pass: noisePass, fire: noiseFire, commit: noisePass - noiseFire,
  passRate: noisePass / K, fireRate: noiseFire / K, commitRate: (noisePass - noiseFire) / K,
  meanMaxFid: 0, meanMargin: 0 };

console.log('Collision guard — K = ' + K + '/arm, repo-start params (th 0.5, c 0.05, g 1.0), beta = 1');
console.log('arm        pass     fire     commit   meanMaxFid  meanMargin');
[['signal', res.signal], ['artifact', res.artifact], ['collision', res.collision], ['noise', noise]].forEach(function (pair) {
  var a = pair[1];
  console.log(pair[0].padEnd(11) + pct(a.passRate).padEnd(9) + pct(a.fireRate).padEnd(9) + pct(a.commitRate).padEnd(9) +
    (a.meanMaxFid ? a.meanMaxFid.toFixed(3) : '-').padEnd(12) + (a.meanMargin ? a.meanMargin.toFixed(3) : '-'));
});
console.log('fire|pass: signal ' + pct(res.signal.fireGivenPass) + ', artifact ' + pct(res.artifact.fireGivenPass) +
  ', collision ' + pct(res.collision.fireGivenPass) + ', noise ' + (noisePass ? pct(noiseFire / noisePass) : '-'));
var ratio = res.signal.fireRate ? (res.collision.fireRate / res.signal.fireRate).toFixed(1) : 'inf';
console.log('fire-rate ratio (collision / signal): ' + ratio + 'x');

var mission = L.evaluateMission('collision', { result: res });
console.log('mission: ' + (mission ? mission.outcome : 'null') + ' — ' + JSON.stringify(mission ? mission.detail : null));
if (mission && mission.counts && mission.outcome === 'grounds') {
  console.log('PASS: the guard fires far more often on the planted collision than on a real signal, while the signal still commits.');
} else {
  console.log('FAIL: the guard does not give the shield grounds to abstain on a localised collision.');
  process.exit(1);
}
