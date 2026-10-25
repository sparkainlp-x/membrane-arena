/*
 * Membrane Arena: pure game logic (SYNTHETIC classical simulation).
 *
 * A JavaScript port of the three-membrane crystallization contest of
 * sparkainlp-x/crystallization-contest at width n = 32, with seeded
 * determinism, lazy per-generation stepping (so the player can steer between
 * generations), reward schemes, scoring, baseline comparison, lessons, daily
 * seeds, hash links, a store sanitizer and the plain-text share card.
 * No DOM, no network, no storage.
 *
 * The port is statistically comparable to the Python original, not
 * bit-identical: the random number generators differ. See DESIGN.md.
 * Oja, E. (1982), J. Math. Biol. 15, 267-273, doi:10.1007/BF00275687.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./baselines.js'));
  else root.ArenaGame = factory(root.ArenaBaselines);
})(typeof self !== 'undefined' ? self : this, function (BASE) {
  'use strict';

  var VERSION = '0.3.2';
  var BUILD = VERSION;   // shown in the page footer
  var GEN = 'membrane-arena/v1/';        // generator namespace: changing it changes every contest
  var EPOCH = '2026-10-24';              // day number 1
  var N = 32;                            // width of the measured baselines used here
  var EP = 8, GENS = 12, STEPS = 60;     // as in the repository contest
  var CHECK = 10, WINDOW = 5, ETA = 0.5;
  var AGREE = 0.4, TRUTH = 0.5, SIGMA_SCALE = 1.5;
  var AMP_CAP = 0.5, TARGET = 0.5, LEAK = 0.3, KSTAB = 1.5;
  var GAIN_MIN = 0.33, GAIN_MAX = 3.0, FACTOR_MIN = 0.2;
  var TH_MIN = 0.02, TH_MAX = 1.5, C_MAX = 0.5;
  var SCHEMES = ['individual', 'team', 'difference', 'consensus', 'random'];
  var W_STEPS = [0, 0.25, 0.5, 0.75, 1];
  var SCHEME_SCALE = 0.25;               // arena choice: weight of the scheme reward in selection
  var STEADY_REF = 0.05;                 // rate variance at which steadiness reaches 0
  var MISSION_IDS = ['shield', 'individual', 'amp', 'repo', 'play'];
  var OUTCOMES = ['reproduced', 'not_reproduced', 'found', 'not_found', 'no_effect', 'detected', 'agrees', 'partly', 'differs', 'beat', 'below'];
  var METRIC_IDS = ['T', 'F', 'precision', 'rateVar', 'score'];
  var DEFAULTS = { scheme: 'consensus', w: 0.5, shield: true, amp: false, stab: false, evolve: true, fcost: 0, th: 0.5, c: 0.05, g: 1.0 };

  /* ---------- seeded RNG (xmur3 hash + mulberry32 + Box-Muller) ---------- */

  function hashStr(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seedStr) { return mulberry32(hashStr(String(seedStr))); }
  function gauss(rng) {
    var u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  /* ---------- complex vectors in C^n: {r, i} Float64Array pairs ---------- */

  function zeros(n) { return { r: new Float64Array(n), i: new Float64Array(n) }; }
  function normalize(v) {
    var s = 0, k, n = v.r.length;
    for (k = 0; k < n; k++) s += v.r[k] * v.r[k] + v.i[k] * v.i[k];
    s = Math.sqrt(s);
    if (!(s > 0) || !isFinite(s)) throw new Error('cannot normalize');
    for (k = 0; k < n; k++) { v.r[k] /= s; v.i[k] /= s; }
    return v;
  }
  function rvec(n, rng) {
    var v = zeros(n);
    for (var k = 0; k < n; k++) { v.r[k] = gauss(rng); v.i[k] = gauss(rng); }
    return normalize(v);
  }
  function noisy(state, sigma, rng) {
    var n = state.r.length, v = zeros(n);
    for (var k = 0; k < n; k++) {
      v.r[k] = state.r[k] + sigma * gauss(rng);
      v.i[k] = state.i[k] + sigma * gauss(rng);
    }
    return normalize(v);
  }
  // <a|b> = sum conj(a) b
  function inner(a, b) {
    var re = 0, im = 0, n = a.r.length;
    for (var k = 0; k < n; k++) {
      re += a.r[k] * b.r[k] + a.i[k] * b.i[k];
      im += a.r[k] * b.i[k] - a.i[k] * b.r[k];
    }
    return { re: re, im: im };
  }
  function fidelity(a, b) { var z = inner(a, b); return z.re * z.re + z.im * z.im; }
  function copyVec(v) { return { r: Float64Array.from(v.r), i: Float64Array.from(v.i) }; }

  /* ---------- the contest, as in crystallization_contest/{events,rewards,contest}.py ---------- */

  function sigmaFor(n) { return SIGMA_SCALE / Math.sqrt(n); }
  function scaledThreshold(q, n, sigma) { return 1 + q * n / (1 + 2 * sigma * sigma * n); }
  function energyRatio(win, n) {
    var s = 0;
    for (var k = 0; k < win.length; k++) s += win[k];
    return n * s / win.length;
  }
  function agreeing(vec, decls, thresh) {
    var c = 0;
    for (var k = 0; k < decls.length; k++) if (decls[k] && fidelity(vec, decls[k]) >= thresh) c++;
    return c;
  }
  function systemEvent(decls, thresh) {            // need ceil(3/2) = 2 of 3
    for (var k = 0; k < decls.length; k++) if (decls[k] && agreeing(decls[k], decls, thresh) >= 2) return k;
    return null;
  }
  function isTrueEvent(vec, pat) { return !!vec && !!pat && fidelity(vec, pat) >= TRUTH; }

  function reward(scheme, i, decls) {              // rewards.py, for 3 agents
    var without, team;
    if (scheme === 'individual') return decls[i] ? 1 : 0;
    if (scheme === 'team' || scheme === 'difference') team = systemEvent(decls, AGREE) !== null ? 1 : 0;
    if (scheme === 'team') return team;
    if (scheme === 'difference') {
      without = decls.slice(); without[i] = null;
      return team - (systemEvent(without, AGREE) !== null ? 1 : 0);
    }
    if (scheme === 'consensus') return decls[i] && agreeing(decls[i], decls, AGREE) >= 2 ? 1 : 0;
    return 0;                                      // random
  }

  function warmStart(v, warm, amp) {
    amp = Math.min(Math.max(amp, 0), AMP_CAP);
    if (!warm || amp === 0) return v;
    var o = zeros(v.r.length);
    for (var k = 0; k < o.r.length; k++) { o.r[k] = (1 - amp) * v.r[k] + amp * warm.r[k]; o.i[k] = (1 - amp) * v.i[k] + amp * warm.i[k]; }
    return normalize(o);
  }
  function stabilizerFactor(rateEma) { return Math.max(FACTOR_MIN, 1 - KSTAB * (rateEma - TARGET)); }
  function leakyUpdate(rateEma, evRate) { return (1 - LEAK) * rateEma + LEAK * evRate; }
  function clampGain(g) { return Math.min(GAIN_MAX, Math.max(GAIN_MIN, g)); }

  // One episode of 3 coupled Oja membranes. `trace` (Float32Array STEPS*3) records geff * energy ratio.
  // `ix` is optional instrumentation that draws no random numbers, so it never changes a result:
  //   ix.fid   Float32Array STEPS*3, |<v|pattern>| of each membrane after each step (-1 in a noise episode)
  //   ix.noDecl  when true nobody declares or freezes (used by the Lab probe)
  //   ix.chk   when set to [[],[],[]], each check step pushes [geff * energy ratio, fidelity to the pattern] per membrane
  function episode(n, pat, sigma, P, warm, amp, rng, trace, ix) {
    ix = ix || {};
    var vs = [], win = [[], [], []], decl = [null, null, null], declStep = [null, null, null], i, j, k, t;
    var lastFid = [-1, -1, -1];
    if (ix.fid) for (k = 0; k < ix.fid.length; k++) ix.fid[k] = -1;
    for (i = 0; i < 3; i++) vs.push(warmStart(rvec(n, rng), warm, amp));
    var thr = [];
    for (i = 0; i < 3; i++) thr.push(scaledThreshold(Math.min(TH_MAX, P[i].th * (2 - P[i].sp)), n, sigma));
    var last = [0, 0, 0];
    for (t = 1; t <= STEPS; t++) {
      for (i = 0; i < 3; i++) {
        if (decl[i]) { trace[(t - 1) * 3 + i] = last[i]; if (ix.fid) ix.fid[(t - 1) * 3 + i] = lastFid[i]; continue; }
        var x = pat ? noisy(pat, sigma, rng) : rvec(n, rng);
        var y = inner(x, vs[i]);
        win[i].push(y.re * y.re + y.im * y.im);
        if (win[i].length > WINDOW) win[i].shift();
        var v = zeros(n), c = P[i].c;
        for (k = 0; k < n; k++) {
          v.r[k] = vs[i].r[k] + ETA * (x.r[k] * y.re - x.i[k] * y.im);
          v.i[k] = vs[i].i[k] + ETA * (x.r[k] * y.im + x.i[k] * y.re);
        }
        if (c > 0) {
          for (j = 0; j < 3; j++) {
            if (j === i) continue;
            var ph = inner(vs[j], v), m = Math.sqrt(ph.re * ph.re + ph.im * ph.im), pr = 1, pi = 0;
            if (m > 0) { pr = ph.re / m; pi = ph.im / m; }
            for (k = 0; k < n; k++) {
              v.r[k] += c * (pr * vs[j].r[k] - pi * vs[j].i[k]);
              v.i[k] += c * (pr * vs[j].i[k] + pi * vs[j].r[k]);
            }
          }
        }
        vs[i] = normalize(v);
        last[i] = P[i].geff * energyRatio(win[i], n);
        trace[(t - 1) * 3 + i] = last[i];
        if (pat) lastFid[i] = Math.sqrt(fidelity(vs[i], pat));
        if (ix.fid) ix.fid[(t - 1) * 3 + i] = lastFid[i];
      }
      if (t % CHECK === 0) {
        for (i = 0; i < 3; i++) {
          if (ix.chk) ix.chk[i].push([P[i].geff * energyRatio(win[i], n), pat ? fidelity(vs[i], pat) : 0]);
          if (!ix.noDecl && !decl[i] && P[i].geff * energyRatio(win[i], n) >= thr[i]) { decl[i] = copyVec(vs[i]); declStep[i] = t; }
        }
      }
    }
    return { decl: decl, declStep: declStep, thr: thr };
  }

  function sanitizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var d = DEFAULTS, num = function (v, lo, hi, dv) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv; };
    return {
      scheme: SCHEMES.indexOf(s.scheme) >= 0 ? s.scheme : d.scheme,
      w: num(s.w, 0, 1, d.w),
      shield: s.shield === undefined ? d.shield : !!s.shield,
      amp: s.amp === undefined ? d.amp : !!s.amp,
      stab: s.stab === undefined ? d.stab : !!s.stab,
      evolve: s.evolve === undefined ? d.evolve : !!s.evolve,
      fcost: num(s.fcost, 0, 2, d.fcost),
      th: num(s.th, 0.1, 1.2, d.th), c: num(s.c, 0, C_MAX, d.c), g: num(s.g, 0.5, 2, d.g)
    };
  }

  function createContest(seed, init) {
    var o = sanitizeSettings(init), sigma = sigmaFor(N), par = [];
    for (var i = 0; i < 3; i++) par.push({ th: o.th, c: o.c, g: o.g, sp: 0.5, geff: 1 });
    return {
      seed: String(seed), n: N, sigma: sigma, par: par, best: [-1, -1, -1], rateEma: TARGET, warm: null, hist: [], gen: 0,
      rng: makeRng(GEN + seed + '/main'), mrng: makeRng(GEN + seed + '/mut')
    };
  }
  function done(c) { return c.gen >= GENS; }

  // Starting parameters of a contest are set by its seed, so every player of a daily contest begins in the same place.
  // The repository baselines all began at DEFAULTS (th 0.5, c 0.05, g 1.0).
  function startFor(seed) {
    var r = makeRng(GEN + seed + '/start'), r2 = function (x) { return Math.round(x * 100) / 100; };
    return { th: r2(0.3 + 0.5 * r()), c: r2(0.3 * r()), g: r2(0.7 + 0.8 * r()) };
  }

  // Run generation c.gen with `settings`; returns the generation record (also appended to c.hist).
  function stepGeneration(c, settings) {
    if (done(c)) throw new Error('contest finished');
    var o = sanitizeSettings(settings), n = c.n, i, e, cand = [];
    for (i = 0; i < 3; i++) cand.push({ th: c.par[i].th, c: c.par[i].c, g: c.par[i].g, sp: c.par[i].sp, geff: 1 });
    var clamped = [false, false, false], mutated = false;
    if (c.gen > 0 && o.evolve) {
      mutated = true;
      cand.forEach(function (p, k) {
        p.th = Math.min(TH_MAX, Math.max(TH_MIN, p.th * Math.exp(0.2 * gauss(c.mrng))));
        p.c = Math.min(C_MAX, Math.max(0, p.c + 0.05 * gauss(c.mrng)));
        p.g = p.g * Math.exp(0.2 * gauss(c.mrng));
      });
    }
    if (o.stab) cand.forEach(function (p, k) { var g = clampGain(p.g); clamped[k] = g !== p.g; p.g = g; });
    var fp = [0, 0, 0], tp = [0, 0, 0], bonus = [0, 0, 0], joint = 0, outT = 0, outF = 0, episodes = [];
    var paramsStart = cand.map(function (p) { return { th: p.th, c: p.c, g: p.g }; });
    for (e = 0; e < EP; e++) {
      var planted = e % 2 === 0, pat = planted ? rvec(n, c.rng) : null, trace = new Float32Array(STEPS * 3);
      cand.forEach(function (p) { p.geff = p.g * (o.stab ? stabilizerFactor(c.rateEma) : 1); });
      var geffs = cand.map(function (p) { return p.geff; });
      var fidTrace = new Float32Array(STEPS * 3);
      var ep = episode(n, pat, c.sigma, cand, c.warm, o.amp ? AMP_CAP : 0, c.rng, trace, { fid: fidTrace });
      var d = ep.decl, truth = d.map(function (di) { return isTrueEvent(di, pat); }), agree = [];
      for (i = 0; i < 3; i++) {
        if (truth[i]) tp[i]++;
        if (d[i] && !truth[i]) fp[i]++;
        bonus[i] += reward(o.scheme, i, d);
        if (d[i]) {
          var conf = false;
          for (var j = 0; j < 3; j++) if (j !== i && d[j] && fidelity(d[i], d[j]) >= AGREE) { conf = true; if (j > i) agree.push([i, j]); }
          cand[i].sp = 0.8 * cand[i].sp + 0.2 * (conf ? 1 : 0);
        }
      }
      if (truth[0] && truth[1] && truth[2]) joint++;
      var outs, passed = null;
      if (o.shield) {
        passed = null;
        for (i = 0; i < 3; i++) if (d[i] && agreeing(d[i], d, AGREE) >= 2) { passed = i; break; }
        outs = passed === null ? [] : [passed];
      } else {
        outs = [];
        for (i = 0; i < 3; i++) if (d[i]) outs.push(i);
      }
      var evT = 0, evF = 0;
      outs.forEach(function (k) { if (truth[k]) evT++; else evF++; });
      outT += evT; outF += evF;
      c.warm = outs.length ? d[outs[0]] : null;
      c.rateEma = leakyUpdate(c.rateEma, outs.length / (o.shield ? 1 : 3));
      episodes.push({
        planted: planted, declStep: ep.declStep, truth: truth, thr: ep.thr, geff: geffs, outs: outs, passed: passed,
        dropped: o.shield && passed === null && (d[0] || d[1] || d[2]) ? true : false,
        agree: agree, evT: evT, evF: evF, trace: trace, fid: fidTrace, rateEma: c.rateEma
      });
    }
    var m = Math.max(tp[0], tp[1], tp[2]), top = [];
    for (i = 0; i < 3; i++) if (tp[i] === m) top.push(i);
    var scores = [], accepted = [], contest = [];
    for (i = 0; i < 3; i++) {
      var rank = top.indexOf(i) >= 0 && m > 0 ? 1 / top.length : 0;
      var base = o.w * joint + (1 - o.w) * rank;
      var s = base + SCHEME_SCALE * bonus[i] - o.fcost * fp[i] / EP;
      scores.push(s); contest.push(base);
      if (s >= c.best[i]) { c.best[i] = s; c.par[i] = cand[i]; accepted.push(true); } else accepted.push(false);
    }
    var rec = {
      gen: c.gen, settings: o, episodes: episodes, outT: outT, outF: outF, shield: o.shield, mutated: mutated,
      params: paramsStart, geff: episodes[EP - 1].geff, clamped: clamped,
      maxG: Math.max(c.par[0].g, c.par[1].g, c.par[2].g), gains: c.par.map(function (p) { return p.g; }),
      scores: scores, contest: contest, bonus: bonus.map(function (b) { return SCHEME_SCALE * b; }), accepted: accepted,
      best: c.best.slice(), joint: joint, tp: tp, fp: fp, rateEma: c.rateEma,
      parAfter: c.par.map(function (p) { return { th: p.th, c: p.c, g: p.g, sp: p.sp }; })
    };
    c.hist.push(rec);
    c.gen++;
    return rec;
  }

  /* ---------- scoring (the game's own weights; the repository has no game score) ---------- */

  function pvariance(xs) {
    if (!xs.length) return 0;
    var m = 0, v = 0, k;
    for (k = 0; k < xs.length; k++) m += xs[k];
    m /= xs.length;
    for (k = 0; k < xs.length; k++) v += (xs[k] - m) * (xs[k] - m);
    return v / xs.length;
  }
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }

  function summarize(hist) {
    var T = 0, F = 0, teq = 0, feq = 0, rates = [], maxG = 0, k;
    hist.forEach(function (h) {
      var w = h.shield ? 1 : 1 / 3;
      T += h.outT; F += h.outF; teq += h.outT * w; feq += h.outF * w;
      rates.push((h.outT + h.outF) / EP);
      if (h.maxG > maxG) maxG = h.maxG;
    });
    var gens = hist.length, planted = gens * EP / 2;
    var precision = T + F > 0 ? T / (T + F) : 0;
    var rateVar = pvariance(rates);
    var net = planted > 0 ? (teq - feq) / planted : 0;
    var steadiness = T + F > 0 ? 1 - clamp01(rateVar / STEADY_REF) : 0;
    var score = 100 * (0.5 * clamp01(net) + 0.25 * precision + 0.25 * steadiness);
    return {
      gens: gens, T: T, F: F, precision: precision, rateVar: rateVar, maxG: maxG, finalG: gens ? hist[gens - 1].maxG : 0,
      net: net, steadiness: steadiness, score: score,
      parts: { net: 50 * clamp01(net), precision: 25 * precision, steadiness: 25 * steadiness }
    };
  }

  /* ---------- baselines from the repository's results ---------- */

  function cfgTag(s) { return (s.shield ? 'S' : '-') + (s.amp ? 'A' : '-') + (s.stab ? 'Z' : '-'); }
  function nearestW(w) {
    var best = W_STEPS[0];
    W_STEPS.forEach(function (x) { if (Math.abs(x - w) < Math.abs(best - w)) best = x; });
    return best;
  }
  // measured width-32 row for the player's configuration, or null when the repository did not measure it
  function baselineFor(settings) {
    var s = sanitizeSettings(settings), tag = cfgTag(s), wm = [0, 0.5, 1], w = wm[0];
    wm.forEach(function (x) { if (Math.abs(x - s.w) < Math.abs(w - s.w) - 1e-9) w = x; });
    for (var k = 0; k < BASE.CONTEST32.length; k++) {
      var r = BASE.CONTEST32[k];
      if (r.cfg === tag && r.w === w) return { row: r, w: w, exactW: Math.abs(w - s.w) < 1e-9, tag: tag, file: BASE.SOURCE.contest };
    }
    return null;
  }
  // The same game score applied to the repository's mean counts (an approximation, labelled as such).
  function baselineScore(b) {
    if (!b) return null;
    var shielded = b.tag.charAt(0) === 'S', r = b.row, planted = GENS * EP / 2;
    var wgt = shielded ? 1 : 1 / 3;
    var net = (r.T - r.F) * wgt / planted;
    var steady = 1 - clamp01(r.rv / STEADY_REF);
    return 100 * (0.5 * clamp01(net) + 0.25 * r.P + 0.25 * steady);
  }

  /* ---------- lessons (numbers come from baselines.js, which comes from the CSV copies) ---------- */

  var LESSON_IDS = ['shield', 'amp', 'stab', 'individual', 'evolve', 'handpicked', 'synthetic'];
  function lessonVars() {
    var L = BASE.LESSON;
    return {
      fpmin: L.shieldFpMin, fpmax: L.shieldFpMax, vmin: L.shieldVarMin, vmax: L.shieldVarMax, ampd: L.ampMaxDeltaP.toFixed(3),
      cmin: L.stabCostMin, cmax: L.stabCostMax, low: L.indLowest, cells: L.indCells,
      rmin: L.runawayNoZMin, rmax: L.runawayNoZMax, seeds: L.seeds
    };
  }
  // Which lesson fits this run: the one about the thing the player just did, otherwise a rotation by seed.
  function pickLesson(settings, seed) {
    var s = sanitizeSettings(settings);
    if (!s.shield) return 'shield';
    if (s.amp) return 'amp';
    if (s.stab) return 'stab';
    if (s.scheme === 'individual') return 'individual';
    return LESSON_IDS[hashStr(String(seed || '')) % LESSON_IDS.length];
  }

  /* ---------- dates, daily seeds, streaks ---------- */

  function dateIndex(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
    if (!m) return NaN;
    var y = +m[1], mo = +m[2], d = +m[3];
    var ms = Date.UTC(y, mo - 1, d), dt = new Date(ms);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return Math.round(ms / 86400000);
  }
  function dayNumber(dateStr) { return dateIndex(dateStr) - dateIndex(EPOCH) + 1; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function localDateString(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function dailySeed(dateStr) { return 'd' + dateStr; }
  function seedDate(seed) { return seed.charAt(0) === 'd' && !isNaN(dateIndex(seed.slice(1))) ? seed.slice(1) : null; }
  function computeStreak(dates, today) {
    var idx = {};
    dates.forEach(function (d) { var i = dateIndex(d); if (!isNaN(i)) idx[i] = true; });
    var days = Object.keys(idx).map(Number).sort(function (a, b) { return a - b; });
    var best = 0, run = 0, prev = null;
    days.forEach(function (d) { run = prev !== null && d === prev + 1 ? run + 1 : 1; prev = d; if (run > best) best = run; });
    var t = dateIndex(today), cur = 0;
    var d0 = idx[t] ? t : (idx[t - 1] ? t - 1 : null);
    if (d0 !== null) { for (var d = d0; idx[d]; d--) cur++; }
    return { current: cur, best: best };
  }

  /* ---------- hash links, checked field by field ---------- */

  var SEED_RE = /^[A-Za-z0-9_-]{1,24}$/;
  var CFG_RE = /^([itdcr])-(0|25|50|75|100)-([S-])([A-])([Z-])$/;
  var SCHEME_CODE = { i: 'individual', t: 'team', d: 'difference', c: 'consensus', r: 'random' };
  function parseHash(hash) {
    var out = { mode: 'daily', seed: null, date: null, best: null, lang: null, preset: null };
    var h = String(hash || '').replace(/^#/, '');
    if (!h || h.length > 200) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1), m;
      if (k === 'd' && dateIndex(v) >= dateIndex(EPOCH)) { out.date = v; out.seed = dailySeed(v); out.mode = 'challenge'; }
      else if (k === 's' && SEED_RE.test(v)) { out.seed = v; out.mode = 'challenge'; }
      else if (k === 'b' && /^\d{1,3}$/.test(v) && +v <= 100) out.best = parseInt(v, 10);
      else if (k === 'l' && /^[a-z]{2}$/.test(v)) out.lang = v;
      else if (k === 'c' && (m = CFG_RE.exec(v))) {
        out.preset = { scheme: SCHEME_CODE[m[1]], w: +m[2] / 100, shield: m[3] === 'S', amp: m[4] === 'A', stab: m[5] === 'Z' };
      }
    });
    if (out.seed === null) { out.best = null; out.preset = null; }
    return out;
  }
  function presetCode(s) {
    var o = sanitizeSettings(s), code = 'itdcr'.charAt(SCHEMES.indexOf(o.scheme));
    return code + '-' + Math.round(nearestW(o.w) * 100) + '-' + cfgTag(o);
  }
  function buildChallengeHash(o) {
    var parts = [];
    if (o.date) parts.push('d=' + o.date); else parts.push('s=' + o.seed);
    if (typeof o.best === 'number' && isFinite(o.best)) parts.push('b=' + Math.max(0, Math.min(100, Math.round(o.best))));
    if (o.settings) parts.push('c=' + presetCode(o.settings));
    if (o.lang) parts.push('l=' + o.lang);
    return '#' + parts.join('&');
  }

  /* ---------- share card (plain text, no emoji) ---------- */

  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return vars && k in vars ? vars[k] : m; });
  }
  function bar(value, max, width) {
    width = width || 10;
    var f = Math.round(Math.min(1, Math.max(0, value / max)) * width);
    return new Array(f + 1).join('\u2588') + new Array(width - f + 1).join('\u2591');
  }
  function buildShare(o) {
    var L = o.labels, r = o.result, lines = [];
    lines.push(o.seed ? fmt(L['share.title_seed'], { seed: o.seed }) : fmt(L['share.title'], { day: o.day, date: o.date }));
    lines.push(fmt(L['share.score'], { score: Math.round(r.score) }) + (o.ref === null || o.ref === undefined ? '' : ' ' + fmt(L['share.ref'], { ref: Math.round(o.ref) })));
    lines.push(fmt(L['share.events'], { t: r.T, f: r.F, p: Math.round(r.precision * 100) }));
    lines.push(fmt(L['share.setup'], { tag: cfgTag(o.settings), scheme: L['scheme.' + o.settings.scheme + '.short'], w: Math.round(o.settings.w * 100) }));
    lines.push(L['share.steady'] + ' ' + bar(r.steadiness, 1, 10));
    lines.push(L['share.synthetic']);
    if (o.url) lines.push(o.url);
    return lines.join('\n');
  }

  /* ---------- defensive store ---------- */

  function sanitizeStore(raw) {
    var out = { daily: {}, bestDaily: null, bestPractice: null, bestScheme: {}, missions: {}, hc: false, still: false, introSeen: false, tutorialSeen: false }, num = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    if (raw.hc === true) out.hc = true;
    if (raw.still === true) out.still = true;
    if (raw.introSeen === true) out.introSeen = true;
    if (raw.tutorialSeen === true) out.tutorialSeen = true;
    var bs = raw.bestScheme;
    if (bs && typeof bs === 'object' && !Array.isArray(bs)) SCHEMES.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(bs, k) && num(bs[k]) && bs[k] >= 0 && bs[k] <= 100) out.bestScheme[k] = bs[k]; });
    var ms = raw.missions;
    if (ms && typeof ms === 'object' && !Array.isArray(ms)) {
      MISSION_IDS.forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(ms, id)) return;
        var m = ms[id];
        if (!m || typeof m !== 'object' || OUTCOMES.indexOf(m.outcome) < 0) return;
        var n = num(m.n) && m.n >= 0 && m.n <= 200 && Math.floor(m.n) === m.n ? m.n : 0;
        var metrics = Array.isArray(m.metrics) ? m.metrics.filter(function (x) { return METRIC_IDS.indexOf(x) >= 0; }).slice(0, 5) : [];
        out.missions[id] = { outcome: m.outcome, n: n, metrics: metrics };
      });
    }
    if (num(raw.bestDaily) && raw.bestDaily >= 0 && raw.bestDaily <= 100) out.bestDaily = raw.bestDaily;
    if (num(raw.bestPractice) && raw.bestPractice >= 0 && raw.bestPractice <= 100) out.bestPractice = raw.bestPractice;
    if (typeof raw.lang === 'string' && /^[a-z]{2}$/.test(raw.lang)) out.lang = raw.lang;
    var d = raw.daily;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      Object.keys(d).forEach(function (k) {
        var e = d[k];
        if (isNaN(dateIndex(k)) || dateIndex(k) < dateIndex(EPOCH) || !e || typeof e !== 'object') return;
        if (!num(e.score) || !num(e.T) || !num(e.F) || !num(e.precision)) return;
        if (e.score < 0 || e.score > 100 || e.precision < 0 || e.precision > 1) return;
        if (e.T < 0 || e.F < 0 || e.T > 1000 || e.F > 1000 || Math.floor(e.T) !== e.T || Math.floor(e.F) !== e.F) return;
        var st = typeof e.tag === 'string' && /^[S-][A-][Z-]$/.test(e.tag) ? e.tag : '---';
        out.daily[k] = { score: e.score, T: e.T, F: e.F, precision: e.precision, tag: st };
      });
    }
    return out;
  }

  return {
    VERSION: VERSION, BUILD: BUILD, EPOCH: EPOCH, N: N, EP: EP, GENS: GENS, STEPS: STEPS, CHECK: CHECK, AGREE: AGREE, TRUTH: TRUTH,
    AMP_CAP: AMP_CAP, TARGET: TARGET, GAIN_MIN: GAIN_MIN, GAIN_MAX: GAIN_MAX, FACTOR_MIN: FACTOR_MIN,
    MISSION_IDS: MISSION_IDS, OUTCOMES: OUTCOMES, SCHEMES: SCHEMES, W_STEPS: W_STEPS, DEFAULTS: DEFAULTS, LESSON_IDS: LESSON_IDS, SCHEME_SCALE: SCHEME_SCALE,
    hashStr: hashStr, makeRng: makeRng, gauss: gauss, rvec: rvec, noisy: noisy, inner: inner, fidelity: fidelity, normalize: normalize,
    sigmaFor: sigmaFor, scaledThreshold: scaledThreshold, energyRatio: energyRatio, systemEvent: systemEvent, reward: reward,
    stabilizerFactor: stabilizerFactor, leakyUpdate: leakyUpdate, clampGain: clampGain, warmStart: warmStart,
    sanitizeSettings: sanitizeSettings, createContest: createContest, startFor: startFor, stepGeneration: stepGeneration, done: done,
    summarize: summarize, cfgTag: cfgTag, baselineFor: baselineFor, baselineScore: baselineScore, nearestW: nearestW,
    pickLesson: pickLesson, lessonVars: lessonVars, fmt: fmt, bar: bar,
    dateIndex: dateIndex, dayNumber: dayNumber, localDateString: localDateString, dailySeed: dailySeed, seedDate: seedDate,
    computeStreak: computeStreak, parseHash: parseHash, buildChallengeHash: buildChallengeHash, presetCode: presetCode,
    buildShare: buildShare, sanitizeStore: sanitizeStore, baselines: BASE,
    episode: episode, copyVec: copyVec, pvariance: pvariance, clamp01: clamp01, SIGMA_SCALE: SIGMA_SCALE, STEADY_REF: STEADY_REF
  };
});
