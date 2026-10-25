/*
 * Membrane Arena: Reverse Membranes, the opposite-energy arena (SYNTHETIC classical simulation).
 * Pure logic: no DOM, no network, no storage.
 *
 * The arena's membranes are Hebbian (Oja's rule): each one climbs towards the direction where its
 * noisy observations carry the most energy, and declares when its windowed energy ratio rises
 * far enough above 1 (the level a random direction would see). This page runs the mirror image:
 *
 *   dark pattern     every observation is random except that a hidden direction, the hole, has
 *                    had part of its energy removed (`depth` of its amplitude). It is a pattern
 *                    made of missing energy, the opposite of the arena's bright pattern.
 *   reverse membrane the same update with the sign flipped (anti-Hebbian): v <- v - eta x <x|v>,
 *                    then normalize. With eta = 1 each step removes the part of v along the latest
 *                    observation, so v drifts towards the direction the observations lack.
 *   echo             the membrane keeps its last WINDOW observations and replays the update over
 *                    them `echo` more times per step. It is what makes absence learnable in 60
 *                    steps: without it the descent is too slow (see docs/REVERSE.md).
 *   opposite energy  E- = 1 - ratio: how far the membrane's windowed energy sits BELOW chance (1 means
 *                    the observations carry no energy at all along it). A reverse membrane declares
 *                    when E- reaches its threshold. Forward membranes use the mirrored rule
 *                    ratio - 1 >= threshold.
 *
 * "Opposite energy" is a name for that signed score, nothing more. Nothing here models negative
 * energy, antimatter, real membranes, neurons or any physical system.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'));
  else root.ArenaReverse = factory(root.ArenaGame);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  var VERSION = G.VERSION;
  var GEN = 'membrane-arena/reverse/v1/';  // generator namespace: changing it changes every contest
  var N = 16;                              // half the arena width: see docs/REVERSE.md
  var EP = G.EP, ROUNDS = G.GENS, STEPS = G.STEPS, CHECK = G.CHECK;   // 8 episodes, 12 rounds, 60 steps, check every 10
  var WINDOW = 10;                         // energy window and echo buffer
  var ETA = { forward: 0.5, reverse: 1.0 };// forward = the arena's rate; reverse = one exact removal per sample
  var TRUTH = G.TRUTH, AGREE = G.AGREE;    // 0.5 fidelity to count as the pattern, 0.4 to agree
  var DEPTH_MIN = 0.6, DEPTH_MAX = 1.0;
  var POLARITIES = ['reverse', 'forward'];
  var WORLDS = ['dark', 'bright'];
  var ECHO_MAX = 2;
  var LIMITS = { th: [0.2, 0.95] };
  var DEFAULTS = { polarity: 'reverse', th: 0.6, echo: 1, shield: true };
  var SIGN = { forward: 1, reverse: -1 };
  function zeros(n) { return { r: new Float64Array(n), i: new Float64Array(n) }; }
  function round2(x) { return Math.round(x * 100) / 100; }
  /* ---------- settings ---------- */
  function sanitizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var d = DEFAULTS, num = function (v, lo, hi, dv) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv; };
    return {
      polarity: POLARITIES.indexOf(s.polarity) >= 0 ? s.polarity : d.polarity,
      th: num(s.th, LIMITS.th[0], LIMITS.th[1], d.th),
      echo: Math.round(num(s.echo, 0, ECHO_MAX, d.echo)),
      shield: s.shield === undefined ? d.shield : !!s.shield
    };
  }
  /* ---------- observations ---------- */
  // a random observation with `depth` of the hole's amplitude removed (depth 1 removes it all)
  function darkSample(hole, depth, rng) {
    var n = hole.r.length, g = zeros(n), k;
    for (k = 0; k < n; k++) { g.r[k] = G.gauss(rng); g.i[k] = G.gauss(rng); }
    var z = G.inner(hole, g);
    for (k = 0; k < n; k++) {
      g.r[k] -= depth * (z.re * hole.r[k] - z.im * hole.i[k]);
      g.i[k] -= depth * (z.re * hole.i[k] + z.im * hole.r[k]);
    }
    return G.normalize(g);
  }
  function sample(world, pat, depth, sigma, n, rng) {
    if (!pat) return G.rvec(n, rng);
    return world === 'dark' ? darkSample(pat, depth, rng) : G.noisy(pat, sigma, rng);
  }
  // v <- v + s * eta * x <x|v>, normalized in place (s = +1 Hebbian, -1 anti-Hebbian)
  function update(v, x, s, eta) {
    var y = G.inner(x, v), n = v.r.length, a = s * eta, k, xr, xi, q = 0;
    var yr = a * y.re, yi = a * y.im;
    for (k = 0; k < n; k++) {
      xr = x.r[k]; xi = x.i[k];
      v.r[k] += xr * yr - xi * yi;
      v.i[k] += xr * yi + xi * yr;
      q += v.r[k] * v.r[k] + v.i[k] * v.i[k];
    }
    q = Math.sqrt(q);
    if (!(q > 0) || !isFinite(q)) throw new Error('cannot normalize');
    for (k = 0; k < n; k++) { v.r[k] /= q; v.i[k] /= q; }
    return v;
  }
  // signed energy: forward measures energy above chance (ratio - 1), reverse the opposite energy below it (1 - ratio)
  function signedEnergy(polarity, ratio) { return SIGN[polarity] * (ratio - 1); }
  /* ---------- one episode of three membranes ---------- */
  // o: { world, pat (null for a noise episode), depth, P: settings }. trace (Float32Array STEPS*3)
  // records each membrane's signed energy; it freezes at the declaration, as in the arena.
  function episode(o, rng, trace) {
    var n = N, P = o.P, s = SIGN[P.polarity], eta = ETA[P.polarity], sigma = G.sigmaFor(n);
    var vs = [], win = [[], [], []], buf = [[], [], []], decl = [null, null, null], declStep = [null, null, null];
    var last = [0, 0, 0], i, t, r, b;
    for (i = 0; i < 3; i++) vs.push(G.rvec(n, rng));
    for (t = 1; t <= STEPS; t++) {
      for (i = 0; i < 3; i++) {
        if (decl[i]) { if (trace) trace[(t - 1) * 3 + i] = last[i]; continue; }
        var x = sample(o.world, o.pat, o.depth, sigma, n, rng), y = G.inner(x, vs[i]);
        win[i].push(y.re * y.re + y.im * y.im); if (win[i].length > WINDOW) win[i].shift();
        buf[i].push(x); if (buf[i].length > WINDOW) buf[i].shift();
        vs[i] = update(vs[i], x, s, eta);
        for (r = 0; r < P.echo; r++) for (b = 0; b < buf[i].length; b++) vs[i] = update(vs[i], buf[i][b], s, eta);
        last[i] = signedEnergy(P.polarity, G.energyRatio(win[i], n));
        if (trace) trace[(t - 1) * 3 + i] = last[i];
      }
      if (t % CHECK === 0) {
        for (i = 0; i < 3; i++) {
          if (decl[i]) continue;
          if (last[i] >= P.th) { decl[i] = G.copyVec(vs[i]); declStep[i] = t; }
        }
      }
    }
    return { decl: decl, declStep: declStep, last: last };
  }
  // what the three declarations add up to: with the shield only a declaration that 2 of 3 agree on passes
  function judge(decl, pat, shield) {
    var truth = decl.map(function (d) { return isTrue(d, pat); });
    var outs = [], passed = null, i, j;
    if (shield) {
      for (i = 0; i < 3; i++) {
        if (!decl[i]) continue;
        var c = 0;
        for (j = 0; j < 3; j++) if (decl[j] && G.fidelity(decl[i], decl[j]) >= AGREE) c++;
        if (c >= 2) { passed = i; break; }
      }
      if (passed !== null) outs.push(passed);
    } else for (i = 0; i < 3; i++) if (decl[i]) outs.push(i);
    var evT = 0, evF = 0;
    outs.forEach(function (k) { if (truth[k]) evT++; else evF++; });
    return { truth: truth, outs: outs, passed: passed, evT: evT, evF: evF,
      dropped: shield && passed === null && (decl[0] || decl[1] || decl[2]) ? true : false };
  }
  function isTrue(d, pat) { return !!d && !!pat && G.fidelity(d, pat) >= TRUTH; }
  /* ---------- the contest: 12 rounds of 8 episodes in the dark world ---------- */
  // How dark the hidden pattern is in each round: a seeded tide between DEPTH_MIN and DEPTH_MAX.
  function depthsFor(seed) {
    var r = G.makeRng(GEN + seed + '/tide'), ph = 2 * Math.PI * r(), f = 0.35 + 0.4 * r(), out = [];
    for (var k = 0; k < ROUNDS; k++) {
      var d = 0.8 + 0.17 * Math.sin(ph + f * k) + 0.06 * (r() - 0.5);
      out.push(round2(Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, d))));
    }
    return out;
  }
  function createContest(seed) {
    seed = String(seed);
    return { seed: seed, depths: depthsFor(seed), hist: [], gen: 0, rng: G.makeRng(GEN + seed + '/main') };
  }
  function done(c) { return c.gen >= ROUNDS; }
  // Where a contest's controls begin: the arena's way round (forward), no echo, a seeded threshold.
  // Finding the reverse polarity and the echo is the first part of the game.
  function startFor(seed) {
    var r = G.makeRng(GEN + seed + '/start');
    return { polarity: 'forward', th: round2(Math.round(20 * (0.3 + 0.6 * r())) / 20), echo: 0, shield: true };   // on the slider's 0.05 grid
  }
  function stepRound(c, settings) {
    if (done(c)) throw new Error('contest finished');
    var o = sanitizeSettings(settings), depth = c.depths[c.gen], episodes = [], outT = 0, outF = 0, tp = 0, fp = 0, missed = 0;
    for (var e = 0; e < EP; e++) {
      var planted = e % 2 === 0, pat = planted ? G.rvec(N, c.rng) : null, trace = new Float32Array(STEPS * 3);
      var ep = episode({ world: 'dark', pat: pat, depth: depth, P: o }, c.rng, trace);
      var j = judge(ep.decl, pat, o.shield);
      outT += j.evT; outF += j.evF;
      j.truth.forEach(function (x, i) { if (x) tp++; else if (ep.decl[i]) fp++; });
      if (planted && j.evT === 0) missed++;
      episodes.push({ planted: planted, declStep: ep.declStep, truth: j.truth, outs: j.outs, passed: j.passed, dropped: j.dropped,
        evT: j.evT, evF: j.evF, trace: trace });
    }
    var rec = { gen: c.gen, settings: o, depth: depth, episodes: episodes, outT: outT, outF: outF, shield: o.shield,
      maxG: 1, tp: tp, fp: fp, missed: missed };
    c.hist.push(rec);
    c.gen++;
    return rec;
  }
  // The arena's game score (net true outputs, precision, steadiness), applied to this contest.
  function summarize(hist) {
    var s = G.summarize(hist);
    s.missed = hist.reduce(function (a, h) { return a + h.missed; }, 0);
    s.planted = hist.length * EP / 2;
    return s;
  }
  /* ---------- the mirror test: both worlds, both polarities, the player's settings ---------- */
  // Returns 4 cells { world, polarity, T, F, planted, noise } over `episodes` episodes each (half planted).
  function mirrorTest(settings, seed, episodes) {
    var o = sanitizeSettings(settings), ep = episodes || 2 * EP, cells = [];
    WORLDS.forEach(function (world) {
      POLARITIES.forEach(function (pol) {
        var P = Object.assign({}, o, { polarity: pol }), rng = G.makeRng(GEN + seed + '/mirror/' + world);
        var cell = { world: world, polarity: pol, T: 0, F: 0, planted: 0, noise: 0 };
        for (var e = 0; e < ep; e++) {
          var planted = e % 2 === 0, pat = planted ? G.rvec(N, rng) : null;
          var r = episode({ world: world, pat: pat, depth: 0.8, P: P }, rng, null);
          var j = judge(r.decl, pat, P.shield);
          if (planted) cell.planted++; else cell.noise++;
          cell.T += j.evT; cell.F += j.evF;
        }
        cells.push(cell);
      });
    });
    return cells;
  }
  /* ---------- seeds, hash links, share card ---------- */
  var SEED_RE = /^[A-Za-z0-9_-]{1,24}$/;
  function dailySeed(dateStr) { return 'r' + dateStr; }
  function parseHash(hash) {
    var out = { seed: null, lang: null };
    var h = String(hash || '').replace(/^#/, '');
    if (!h || h.length > 200) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      if (k === 's' && SEED_RE.test(v)) out.seed = v;
      else if (k === 'l' && (v === 'en' || v === 'fr')) out.lang = v;
    });
    return out;
  }
  function buildHash(o) {
    var parts = [];
    if (o.seed && SEED_RE.test(o.seed)) parts.push('s=' + o.seed);
    if (o.lang === 'fr') parts.push('l=fr');
    return parts.length ? '#' + parts.join('&') : '';
  }
  // one of 8 block heights for a darkness between DEPTH_MIN and DEPTH_MAX
  function darkGlyph(d) {
    var k = Math.round(7 * Math.min(1, Math.max(0, (d - DEPTH_MIN) / (DEPTH_MAX - DEPTH_MIN))));
    return String.fromCharCode(0x2581 + k);
  }
  function shareText(o, t) {
    var r = o.result, lines = [];
    lines.push(t('share.title', { seed: o.seed }));
    lines.push(t('share.score', { score: Math.round(r.score) }));
    lines.push(t('share.events', { t: r.T, f: r.F, m: r.missed, p: Math.round(r.precision * 100) }));
    lines.push(t('share.setup', { pol: t('pol.' + o.settings.polarity), th: o.settings.th.toFixed(2), e: o.settings.echo, sh: t(o.settings.shield ? 'share.on' : 'share.off') }));
    lines.push(t('share.depth') + ' ' + o.depths.map(darkGlyph).join(''));
    lines.push(t('share.tag'));
    return lines.join('\n');
  }
  return {
    VERSION: VERSION, N: N, EP: EP, ROUNDS: ROUNDS, STEPS: STEPS, CHECK: CHECK, WINDOW: WINDOW, ETA: ETA,
    TRUTH: TRUTH, AGREE: AGREE, DEPTH_MIN: DEPTH_MIN, DEPTH_MAX: DEPTH_MAX, POLARITIES: POLARITIES, WORLDS: WORLDS,
    ECHO_MAX: ECHO_MAX, LIMITS: LIMITS, DEFAULTS: DEFAULTS, SIGN: SIGN,
    sanitizeSettings: sanitizeSettings, darkSample: darkSample, sample: sample, update: update, signedEnergy: signedEnergy,
    episode: episode, judge: judge, isTrue: isTrue, depthsFor: depthsFor, createContest: createContest, done: done, startFor: startFor,
    stepRound: stepRound, summarize: summarize, mirrorTest: mirrorTest,
    darkGlyph: darkGlyph, dailySeed: dailySeed, parseHash: parseHash, buildHash: buildHash, shareText: shareText
  };
});
