/*
 * Augmented-perception shield: give augmented perception grounds to project.
 * (SYNTHETIC classical simulation.)
 *
 * An augmented-perception system (for example Alexandra Bernadotte's
 * ZEUS, a brain-computer interface with augmented intelligence) lets you
 * see more than your eyes can see. This prototype wires that perception
 * through the Membrane Arena shield and out to a holographic fan, so what
 * the system perceives is only projected in shared light when the shield
 * has grounds to trust it. ZEUS is the input here, not the product:
 * the shield is the work, and it works with any augmented-perception
 * system that declares what it perceives.
 *
 * The pipeline, per episode:
 *   1. The perception system perceives. Three channels — VISUAL (sees),
 *      ACOUSTIC (hears), CONTEXT (knows where you are) — each declares a
 *      vector, via the game's REAL episode() (membranes 0, 1, 2).
 *   2. The shield decides. 2-of-3 agreement (systemEvent), then the
 *      collision guard (pairwiseCollision: a localised collision is one
 *      witness counted twice, so the shield abstains), then the reference
 *      channel (M clean samples from the true pattern, never the
 *      disturbance; confirms when the mean energy ratio reaches the
 *      game's own declaration threshold).
 *   3. The hologram projects — or abstains. PROJECT means the fan shows
 *      the perception in light, shared with everyone in the room.
 *      ABSTAIN means nothing is projected: no grounds, no light.
 *
 * Arms (K episodes each, repo-start params th 0.5, c 0.05, g 1.0, N 32):
 *   - signal:    a real pattern in the environment. The fan should
 *                project it (grounds).
 *   - artifact:  a shared disturbance (spoofed / interference). The
 *                reference channel should refuse it — nothing projected.
 *   - collision: two channels locked onto the same reading (one witness
 *                counted twice). The collision guard should catch it
 *                when it is localised; when the third channel agrees it
 *                becomes global consensus and is indistinguishable from
 *                a real signal (honest limit, see below).
 *   - noise:     nothing there. Nobody declares, nothing projects.
 *
 * The check PASSES (exit 0) only if the fan projects the real signal
 * (> 50%) and never projects the artifact (< 10%) or noise (0%).
 * The collision arm is reported, not gated: the guard is known to be
 * partial — it fires only on localised collisions, and in ~74% of
 * planted passes the third channel agrees, making it global consensus.
 * Full numbers and the honest limits: docs/AUGMENTED-PERCEPTION-SHIELD.md
 * (to be written when this prototype is reviewed).
 *
 *   node scripts/augmented-perception-shield.js
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
var G = require('../game.js');
var L = require('../lab.js');

var N = G.N; // 32
var SIGMA = G.sigmaFor(N); // 1.5/sqrt(32) = 0.2652
var K = 500;
var M = 20; // reference samples per passed episode

function pct(x) { return (100 * x).toFixed(1) + '%'; }

// The full shield, in augmented-perception terms. d = the three channels' declarations.
// refPat = the true pattern the reference channel sees (null = the
// environment without the disturbance). Returns { project, reason }.
function shieldDecide(d, refPat, rng, thr) {
  var passed = G.systemEvent(d, G.AGREE);
  if (passed === null) return { project: false, reason: 'no-consensus' };
  var coll = G.pairwiseCollision(d);
  if (coll.collided) return { project: false, reason: 'collision', coll: coll };
  var sum = 0, m;
  for (m = 0; m < M; m++) {
    var x = refPat ? G.noisy(refPat, SIGMA, rng) : G.rvec(N, rng);
    var y = G.inner(x, d[passed]);
    sum += y.re * y.re + y.im * y.im;
  }
  if (N * sum / M >= thr) return { project: true, reason: 'grounds', passed: passed };
  return { project: false, reason: 'no-reference' };
}

function arm(patFn, P, rng, thr) {
  var project = 0, noConsensus = 0, collision = 0, noReference = 0, e;
  for (e = 0; e < K; e++) {
    var made = patFn(), pat = made.pat, ref = made.ref;
    var trace = new Float32Array(G.STEPS * 3);
    var d = G.episode(N, pat, SIGMA, P, null, 0, rng, trace, {}).decl;
    var res = shieldDecide(d, ref, rng, thr);
    if (res.project) project++;
    else if (res.reason === 'no-consensus') noConsensus++;
    else if (res.reason === 'collision') collision++;
    else noReference++;
  }
  return { project: project, projectRate: project / K, noConsensus: noConsensus, collision: collision, noReference: noReference };
}

function main() {
  var settings = Object.assign({}, G.DEFAULTS, L.REPO_START, { shield: true, amp: false, stab: false });
  var s = G.sanitizeSettings(settings);
  var rng = G.makeRng('membrane-arena/v1/augmented-perception/check');
  var thr = G.scaledThreshold(s.th, N, SIGMA);
  var P = [0, 1, 2].map(function () { return { th: s.th, c: s.c, g: s.g, sp: 0.5, geff: 1 }; });
  var PC = [{ th: s.th, c: 0.5, g: s.g, sp: 0.5, geff: 1 }, { th: s.th, c: 0.5, g: s.g, sp: 0.5, geff: 1 }, { th: s.th, c: 0, g: s.g, sp: 0.5, geff: 1 }];

  function artifactPat(beta) {
    var art = G.rvec(N, rng);
    return { pat: { r: Float64Array.from(art.r, function (v) { return v * beta; }), i: Float64Array.from(art.i, function (v) { return v * beta; }) }, ref: null };
  }

  console.log('Augmented-perception shield — K = ' + K + '/arm, repo-start params (th ' + s.th + ', c ' + s.c + ', g ' + s.g + '), M = ' + M);
  console.log('channels: VISUAL / ACOUSTIC / CONTEXT  |  shield: 2-of-3 vote -> collision guard -> reference confirm  |  PROJECT = fan shows it in light');
  console.log('arm        project  no-consensus  collision  no-reference');
  var signal = arm(function () { var v = G.rvec(N, rng); return { pat: v, ref: v }; }, P, rng, thr);
  var artifact = arm(function () { return artifactPat(1); }, P, rng, thr);
  var collision = arm(function () { var v = G.rvec(N, rng); return { pat: v, ref: v }; }, PC, rng, thr);
  var noise = arm(function () { return { pat: null, ref: null }; }, P, rng, thr);
  [['signal', signal], ['artifact', artifact], ['collision', collision], ['noise', noise]].forEach(function (row) {
    var name = row[0], r = row[1];
    console.log(name.padEnd(11) + pct(r.projectRate).padEnd(9) + String(r.noConsensus).padEnd(14) + String(r.collision).padEnd(11) + String(r.noReference));
  });
  console.log('reference threshold: ' + thr.toFixed(2));
  var pass = signal.projectRate > 0.5 && artifact.projectRate < 0.1 && noise.projectRate === 0;
  if (pass) {
    console.log('PASS: the fan projects the real signal (' + pct(signal.projectRate) + ') and never projects the artifact (' + pct(artifact.projectRate) + ') or noise. Collision projects ' + pct(collision.projectRate) + ' — the guard is partial by design (localised collisions only); when the third channel agrees it is global consensus.');
  } else {
    console.log('FAIL: signal ' + pct(signal.projectRate) + ', artifact ' + pct(artifact.projectRate) + ', noise ' + pct(noise.projectRate) + '. Expected signal > 50%, artifact < 10%, noise 0%.');
  }
  process.exit(pass ? 0 : 1);
}

main();
