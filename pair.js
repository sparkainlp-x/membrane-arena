/*
 * Membrane Arena: Reverse Pair, a two-membrane shield of an observer and a calibrator
 * (SYNTHETIC classical simulation). Pure logic: no DOM, no network, no storage.
 *
 * Two membranes share one channel and take turns on one clock:
 *
 *   observer     a reverse (anti-Hebbian) membrane, as on the Reverse Membranes page. It learns
 *                away from energy and declares when its opposite energy (1 - windowed energy ratio)
 *                reaches the threshold at a check. What it will find is not known in advance.
 *   calibrator   the predictable one. It does not learn. On its ticks it sends one known
 *                calibration tone through the channel and reads back how much of the tone
 *                arrives. With a clean channel every reading is 1 (plus a little reading noise),
 *                so any shortfall is the channel. The tones are signed-amplitude sine codes
 *                (amplitude |sin|, phase pi/4 when positive and 5 pi/4 when negative, as in the
 *                Digital-to-Wave testbench) at 9 frequencies, 0 to 8 cycles across the 16
 *                components. The calibrator sweeps them in order, one per tick.
 *   the tick     ticks alternate between the two: `share` observer ticks, then one calibrator
 *                tick, over 120 ticks per episode.
 *   the channel  in most episodes a fade removes part of the energy in a subspace of slow
 *                sinusoids, and the removed part rises and falls slowly. On-grid fades cover one
 *                tone frequency exactly. Off-grid fades cover a band of sinusoids centred between
 *                two tone frequencies, whose energy leaks across several tones.
 *   equalizer    if on, the observer divides each observation's frequency components by the
 *                calibrator's latest readings before learning.
 *   2-membrane shield  an output needs both membranes. The calibrator votes no when at least
 *                half of the declared vector's energy sits in frequencies it reads below 0.7.
 *
 * For the evaluation (scripts/pair-check.js, docs/PAIR-PROTOCOL.md) every episode draws its world
 * and its noise from separate streams keyed by seed, round and episode, so every method meets the
 * same worlds, and one full trajectory serves every threshold and every shield rule.
 *
 * These are names for parts of a game, nothing more. Nothing here models negative energy,
 * antimatter, real membranes, neurons, oscillators, radio hardware or any physical system.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'), require('./reverse.js'));
  else root.ArenaPair = factory(root.ArenaGame, root.ArenaReverse);
})(typeof self !== 'undefined' ? self : this, function (G, R) {
  'use strict';
  var VERSION = G.VERSION;
  var GEN = 'membrane-arena/pair/v2/';     // generator namespace: changing it changes every contest
  var N = R.N;                             // 16, as on the Reverse Membranes page
  var EP = R.EP, ROUNDS = R.ROUNDS;        // 8 episodes, 12 rounds
  var TICKS = 120, CHECK = 20, NCHECK = TICKS / CHECK;
  var WINDOW = R.WINDOW, ECHO = 1, ETA = R.ETA.reverse;
  var FREQS = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // calibration tone frequencies, cycles across the 16 components
  var NF = FREQS.length;
  var READ_NOISE = 0.05;                   // standard deviation of one calibrator reading
  var PRED_ERR = READ_NOISE * Math.sqrt(2 / Math.PI);   // predicted mean absolute reading error, clean channel
  var FADED = 0.7;                         // a reading below this counts as faded for the shield
  var EQ_FLOOR = 0.15;                     // the equalizer never divides by less than this
  var ON_FADE = 0.5;                       // "on the fade": at least this share of a vector's energy in the fade subspace
  var FADE_P = 0.75, FADE_DEPTH = [0.6, 0.95], FADE_FREQS = [0.5, 1, 1.5, 2];
  var OFF_BW = [0, 1.5], OFF_STEP = 0.5;   // off-grid bandwidth (cycles) and its sampling step
  var TRUTH = G.TRUTH;
  var SHARE_MAX = 4;
  var LIMITS = { th: [0.2, 0.95], share: [1, SHARE_MAX] };
  // Thresholds chosen on the calibration seeds by scripts/pair-check.js (full pair, share 2), per fade kind.
  // tests/pairpage.test.js checks them against docs/pair-check.txt.
  var TUNED = { grid: 0.65, off: 0.7 };
  function reference(off) { return { share: 2, th: TUNED[off ? 'off' : 'grid'], eq: true, shield: true, off: !!off }; }
  var DEFAULTS = reference(false);
  function zeros(n) { return { r: new Float64Array(n), i: new Float64Array(n) }; }
  function round2(x) { return Math.round(x * 100) / 100; }
  /* ---------- settings ---------- */
  function sanitizeSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var d = DEFAULTS, num = function (v, lo, hi, dv) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv; };
    return {
      share: Math.round(num(s.share, 1, SHARE_MAX, d.share)),
      th: num(s.th, LIMITS.th[0], LIMITS.th[1], d.th),
      eq: s.eq === undefined ? d.eq : !!s.eq,
      shield: s.shield === undefined ? d.shield : !!s.shield,
      off: s.off === undefined ? d.off : !!s.off
    };
  }
  /* ---------- frequencies ---------- */
  var COS = new Float64Array(N * N), SIN = new Float64Array(N * N);
  (function () { for (var k = 0; k < N; k++) for (var j = 0; j < N; j++) { var a = 2 * Math.PI * k * j / N; COS[k * N + j] = Math.cos(a); SIN[k * N + j] = Math.sin(a); } })();
  var SCALE = 1 / Math.sqrt(N);
  // unitary discrete Fourier transform (inverse when inv is true)
  function dft(x, inv) {
    var X = zeros(N), s = inv ? 1 : -1, k, j, re, im, c, sn;
    for (k = 0; k < N; k++) {
      re = 0; im = 0;
      for (j = 0; j < N; j++) { c = COS[k * N + j]; sn = s * SIN[k * N + j]; re += x.r[j] * c - x.i[j] * sn; im += x.r[j] * sn + x.i[j] * c; }
      X.r[k] = re * SCALE; X.i[k] = im * SCALE;
    }
    return X;
  }
  // the calibration frequency a Fourier component belongs to (components k and N - k share one)
  function freqOf(k) { return k <= N / 2 ? k : N - k; }
  // signed-amplitude sine code of frequency f: amplitude |s_j|, phase pi/4 if s_j > 0, 5 pi/4 if s_j < 0
  function signedSine(f) {
    var s = [], j;
    for (j = 0; j < N; j++) s.push(f === 0 ? 1 : f === N / 2 ? Math.cos(Math.PI * j) : Math.sin(2 * Math.PI * f * (j + 0.5) / N));
    return s;
  }
  function tone(f) {
    var s = signedSine(f), v = zeros(N), j, phi, a;
    for (j = 0; j < N; j++) {
      a = Math.abs(s[j]);
      if (s[j] === 0) continue;
      phi = s[j] > 0 ? Math.PI / 4 : 5 * Math.PI / 4;
      v.r[j] = a * Math.cos(phi); v.i[j] = a * Math.sin(phi);
    }
    return G.normalize(v);
  }
  var TONES = FREQS.map(tone);
  // per-frequency gains (the calibrator's view) applied in the Fourier domain; invert divides instead
  function shape(x, gains, invert) {
    var X = dft(x, false), k, c;
    for (k = 0; k < N; k++) {
      c = gains[freqOf(k)];
      if (invert) c = 1 / Math.max(EQ_FLOOR, c);
      X.r[k] *= c; X.i[k] *= c;
    }
    return dft(X, true);
  }
  /* ---------- fades ---------- */
  // complex sinusoid at a (possibly fractional) frequency phi, in cycles across the N components, unit norm
  function sinusoid(phi) {
    var v = zeros(N), j, a;
    for (j = 0; j < N; j++) { a = 2 * Math.PI * phi * j / N; v.r[j] = Math.cos(a) * SCALE; v.i[j] = Math.sin(a) * SCALE; }
    return v;
  }
  // orthonormal basis of the span of vs (modified Gram-Schmidt; nearly dependent vectors are dropped)
  function orthonormal(vs) {
    var Q = [];
    vs.forEach(function (v0) {
      var v = G.copyVec(v0), k, n = 0;
      Q.forEach(function (q) {
        var z = G.inner(q, v);
        for (k = 0; k < N; k++) { v.r[k] -= z.re * q.r[k] - z.im * q.i[k]; v.i[k] -= z.re * q.i[k] + z.im * q.r[k]; }
      });
      for (k = 0; k < N; k++) n += v.r[k] * v.r[k] + v.i[k] * v.i[k];
      if (n > 0.09) Q.push(G.normalize(v));
    });
    return Q;
  }
  // share of v's energy inside span(Q)
  function inSpan(Q, v) {
    var e = 0, n = 0, k, z;
    for (k = 0; k < Q.length; k++) { z = G.inner(Q[k], v); e += z.re * z.re + z.im * z.im; }
    for (k = 0; k < N; k++) n += v.r[k] * v.r[k] + v.i[k] * v.i[k];
    return n > 0 ? e / n : 0;
  }
  // x - c Q Q^H x (c = a(t) for the channel; c < 0 boosts the subspace, as the oracle's exact inverse does)
  function project(x, Q, c) {
    var y = G.copyVec(x), k, j, z, q;
    if (!c) return y;
    for (k = 0; k < Q.length; k++) {
      q = Q[k]; z = G.inner(q, x);
      for (j = 0; j < N; j++) { y.r[j] -= c * (z.re * q.r[j] - z.im * q.i[j]); y.i[j] -= c * (z.re * q.i[j] + z.im * q.r[j]); }
    }
    return y;
  }
  // a fade from its parameters: { kind 'grid', depth, f, ph, band } or { kind 'off', depth, f, ph, center, bw }
  function buildFade(p) {
    var vs = [], phis = [], m, i;
    if (p.kind === 'grid') phis = [p.band];
    else {
      m = 1 + Math.floor(p.bw / OFF_STEP + 1e-9);
      for (i = 0; i < m; i++) phis.push(m === 1 ? p.center : p.center - p.bw / 2 + p.bw * i / (m - 1));
    }
    phis.forEach(function (phi) { vs.push(sinusoid(phi)); vs.push(sinusoid(-phi)); });
    var Q = orthonormal(vs), w = new Float64Array(NF);
    for (i = 0; i < NF; i++) w[i] = inSpan(Q, TONES[i]);
    return Object.assign({}, p, { Q: Q, w: w, rank: Q.length });
  }
  // the removed share a(t) of the fade subspace at tick t (0 without a fade)
  function fadeLevel(fade, t) { return fade ? fade.depth * (0.5 + 0.5 * Math.sin(2 * Math.PI * fade.f * t / TICKS + fade.ph)) : 0; }
  // what the calibrator reads on each tone at tick t, without noise: 1 - a(t) |Q^H tone|^2
  function gainsAt(fade, t) {
    var g = new Float64Array(NF), a = fadeLevel(fade, t), k;
    for (k = 0; k < NF; k++) g[k] = fade ? 1 - a * fade.w[k] : 1;
    return g;
  }
  /* ---------- worlds: every episode's draws, by stream ---------- */
  function stream(seed, gen, e, name) { return G.makeRng(GEN + seed + '/r' + gen + '/e' + e + '/' + name); }
  // fade parameters for either kind from one stream: presence, depth, timing and phase are shared by both
  function fadeParams(rng, kind) {
    var u = [rng(), rng(), rng(), rng(), rng(), rng(), rng(), rng()];
    if (u[0] >= FADE_P) return null;
    var p = { kind: kind, depth: round2(FADE_DEPTH[0] + (FADE_DEPTH[1] - FADE_DEPTH[0]) * u[1]),
      f: FADE_FREQS[Math.floor(u[2] * FADE_FREQS.length)], ph: 2 * Math.PI * u[3] };
    if (kind === 'grid') p.band = 1 + Math.floor(u[4] * 7);
    else {
      p.center = round2(1 + Math.floor(u[5] * 6) + 0.2 + 0.6 * u[6]);
      p.bw = Math.round((OFF_BW[0] + (OFF_BW[1] - OFF_BW[0]) * u[7]) / OFF_STEP) * OFF_STEP;
    }
    return p;
  }
  function makeFade(rng, kind) { var p = fadeParams(rng, kind || 'grid'); return p ? buildFade(p) : null; }
  // o: { seed, gen, e, depth, kind ('grid' or 'off'), forceFade }
  function world(o) {
    var planted = o.e % 2 === 0, k;
    var p = fadeParams(stream(o.seed, o.gen, o.e, 'fade'), o.kind);
    for (k = 0; !p && o.forceFade && k < 50; k++) p = fadeParams(stream(o.seed, o.gen, o.e, 'fade/' + k), o.kind);
    var or = stream(o.seed, o.gen, o.e, 'obs'), noise = new Float64Array(TICKS * 2 * N);
    for (k = 0; k < noise.length; k++) noise[k] = G.gauss(or);
    var rr = stream(o.seed, o.gen, o.e, 'read'), rnoise = new Float64Array(TICKS);
    for (k = 0; k < TICKS; k++) rnoise[k] = G.gauss(rr);
    return { planted: planted, pat: planted ? G.rvec(N, stream(o.seed, o.gen, o.e, 'pattern')) : null, depth: o.depth,
      fade: p ? buildFade(p) : null, v0: G.rvec(N, stream(o.seed, o.gen, o.e, 'init')), noise: noise, rnoise: rnoise,
      rand: stream(o.seed, o.gen, o.e, 'random') };
  }
  // the observation at tick t: noise with `depth` of the dark pattern's amplitude removed, through the channel
  function observeAt(w, t) {
    var g = zeros(N), k, base = (t - 1) * 2 * N;
    for (k = 0; k < N; k++) { g.r[k] = w.noise[base + 2 * k]; g.i[k] = w.noise[base + 2 * k + 1]; }
    if (w.pat) {
      var z = G.inner(w.pat, g), d = w.depth;
      for (k = 0; k < N; k++) { g.r[k] -= d * (z.re * w.pat.r[k] - z.im * w.pat.i[k]); g.i[k] -= d * (z.re * w.pat.i[k] + z.im * w.pat.r[k]); }
    }
    return w.fade ? project(g, w.fade.Q, fadeLevel(w.fade, t)) : g;
  }
  // the calibrator's reading of tone f at tick t: what comes back of the tone, plus reading noise
  function readAt(w, f, t) {
    var g = w.fade ? 1 - fadeLevel(w.fade, t) * w.fade.w[f] : 1;
    return Math.min(1.2, Math.max(0, g + READ_NOISE * w.rnoise[t - 1]));
  }
  // share of a vector's energy in frequencies the calibrator reads below FADED
  function fadedShare(v, est) {
    var X = dft(v, false), e = 0, n = 0, k, q;
    for (k = 0; k < N; k++) { q = X.r[k] * X.r[k] + X.i[k] * X.i[k]; n += q; if (est[freqOf(k)] < FADED) e += q; }
    return n > 0 ? e / n : 0;
  }
  // which membrane owns tick t (1-based): `share` observer ticks, then one calibrator tick
  function owner(t, share) { return (t - 1) % (share + 1) < share ? 'o' : 'c'; }
  function schedule(share) { var out = []; for (var t = 1; t <= TICKS; t++) out.push(owner(t, share)); return out; }
  /* ---------- one full trajectory ---------- */
  // mode: 'solo' (every tick to the observer, no calibrator), 'raw' (calibrator ticks spent, readings not
  // used by the observer), 'eq' (equalizer from the latest readings) or 'oracle' (every tick, exact inverse
  // of the true channel). Returns the opposite-energy trace and, at each check, what any threshold or
  // shield rule needs.
  function trajectory(w, mode, share) {
    var solo = mode === 'solo' || mode === 'oracle', v = G.copyVec(w.v0), win = [], buf = [], est = new Float64Array(NF);
    var trace = new Float32Array(TICKS), checks = [], readings = [], E = 0, sweep = 0, t, r, b, k;
    for (k = 0; k < NF; k++) est[k] = 1;     // before any reading the calibrator predicts a clean channel
    for (t = 1; t <= TICKS; t++) {
      if (solo || owner(t, share) === 'o') {
        var x = observeAt(w, t);
        if (mode === 'eq') x = shape(x, est, true);
        else if (mode === 'oracle' && w.fade) x = project(x, w.fade.Q, 1 - 1 / Math.max(EQ_FLOOR, 1 - fadeLevel(w.fade, t)));
        x = G.normalize(x);
        var y = G.inner(x, v);
        win.push(y.re * y.re + y.im * y.im); if (win.length > WINDOW) win.shift();
        buf.push(x); if (buf.length > WINDOW) buf.shift();
        R.update(v, x, -1, ETA);
        for (r = 0; r < ECHO; r++) for (b = 0; b < buf.length; b++) R.update(v, buf[b], -1, ETA);
        E = R.signedEnergy('reverse', G.energyRatio(win, N));
      } else {
        var f = FREQS[sweep % NF]; sweep++;
        est[f] = readAt(w, f, t);
        readings.push({ t: t, f: f, v: est[f] });
      }
      trace[t - 1] = E;
      if (t % CHECK === 0) {
        var onF = w.fade ? inSpan(w.fade.Q, v) : 0;
        checks.push({ t: t, E: E, valid: win.length > 0, fid: w.pat ? G.fidelity(v, w.pat) : 0, inFade: onF, onFade: onF >= ON_FADE,
          cal: solo ? null : fadedShare(v, est) < 0.5, oracle: onF < ON_FADE,
          est: Float32Array.from(est), gain: Float32Array.from(gainsAt(w.fade, t)) });
      }
    }
    return { trace: trace, checks: checks, readings: readings };
  }
  var NO_DECL = { decl: false, out: false, truth: false, held: false, onFade: false, check: null };
  // the declaration a threshold picks from a trajectory, and the output under a shield rule ('none', 'cal' or 'oracle')
  function decide(w, tr, th, vote) {
    var c = null, k;
    for (k = 0; k < tr.checks.length; k++) if (tr.checks[k].valid && tr.checks[k].E >= th) { c = tr.checks[k]; break; }
    if (!c) return NO_DECL;
    var truth = !!w.pat && c.fid >= TRUTH, yes = vote === 'none' ? true : vote === 'cal' ? c.cal : c.oracle;
    return { decl: true, out: !!yes, truth: truth, held: !yes, onFade: !!w.fade && c.onFade, check: c };
  }
  // the random-declare baseline: with probability 0.5, a uniformly random unit vector at a random check
  function randomDecide(w) {
    var r = G.makeRng(String(w.rand())), d = r() < 0.5, ci = Math.floor(r() * NCHECK), v = G.rvec(N, r);
    if (!d) return NO_DECL;
    return { decl: true, out: true, truth: !!w.pat && G.fidelity(v, w.pat) >= TRUTH, held: false,
      onFade: !!w.fade && inSpan(w.fade.Q, v) >= ON_FADE, check: { t: CHECK * (ci + 1) } };
  }
  /* ---------- the page's episode ---------- */
  function episode(w, P) {
    var tr = trajectory(w, P.eq ? 'eq' : 'raw', P.share), d = decide(w, tr, P.th, P.shield ? 'cal' : 'none'), k;
    var trace = Float32Array.from(tr.trace), declTick = d.check ? d.check.t : null;
    if (declTick) for (k = declTick; k < TICKS; k++) trace[k] = trace[declTick - 1];   // the observer is frozen once it declares
    var snapC = d.check || tr.checks[tr.checks.length - 1];
    return { declTick: declTick, calVote: d.check ? d.check.cal : null, out: d.out, truth: d.truth, held: d.held, onFade: d.onFade,
      trace: trace, snap: { t: snapC.t, est: snapC.est, gain: snapC.gain }, readings: tr.readings };
  }
  /* ---------- the contest ---------- */
  function depthsFor(seed) {
    var r = G.makeRng(GEN + seed + '/tide'), ph = 2 * Math.PI * r(), f = 0.35 + 0.4 * r(), out = [];
    for (var k = 0; k < ROUNDS; k++) out.push(round2(Math.min(1, Math.max(0.6, 0.8 + 0.17 * Math.sin(ph + f * k) + 0.06 * (r() - 0.5)))));
    return out;
  }
  function createContest(seed) {
    seed = String(seed);
    return { seed: seed, depths: depthsFor(seed), hist: [], gen: 0 };
  }
  function done(c) { return c.gen >= ROUNDS; }
  // Where a contest's controls begin: an even tick, no equalizer, no shield, on-grid fades, a seeded threshold on the 0.05 grid.
  function startFor(seed) {
    var r = G.makeRng(GEN + seed + '/start');
    return { share: 1, th: round2(Math.round(20 * (0.45 + 0.3 * r())) / 20), eq: false, shield: false, off: false };
  }
  function roundWorlds(seed, gen, depth, kind) {
    var out = [];
    for (var e = 0; e < EP; e++) out.push(world({ seed: seed, gen: gen, e: e, depth: depth, kind: kind }));
    return out;
  }
  function fadeInfo(f) { return { kind: f.kind, depth: f.depth, f: f.f, band: f.band, center: f.center, bw: f.bw, rank: f.rank }; }
  function stepRound(c, settings) {
    if (done(c)) throw new Error('contest finished');
    var o = sanitizeSettings(settings), depth = c.depths[c.gen], episodes = [], outT = 0, outF = 0, tp = 0, fp = 0, missed = 0, held = 0;
    roundWorlds(c.seed, c.gen, depth, o.off ? 'off' : 'grid').forEach(function (w) {
      var ep = episode(w, o);
      if (ep.out) { if (ep.truth) outT++; else outF++; }
      if (ep.declTick) { if (ep.truth) tp++; else fp++; }
      if (ep.held) held++;
      if (w.planted && !(ep.out && ep.truth)) missed++;
      episodes.push(Object.assign({ planted: w.planted, fade: w.fade ? fadeInfo(w.fade) : null }, ep));
    });
    var rec = { gen: c.gen, settings: o, depth: depth, episodes: episodes, outT: outT, outF: outF, shield: o.shield,
      maxG: 1, tp: tp, fp: fp, missed: missed, held: held };
    c.hist.push(rec);
    c.gen++;
    return rec;
  }
  function summarize(hist) {
    var s = G.summarize(hist);
    s.missed = hist.reduce(function (a, h) { return a + h.missed; }, 0);
    s.planted = hist.length * EP / 2;
    return s;
  }
  // a round record for summarize() from per-episode decisions (shielded: whether outputs count in full)
  function roundRecord(worlds, decs, shielded) {
    var rec = { outT: 0, outF: 0, shield: !!shielded, maxG: 1, missed: 0, held: 0, decl: 0, onFade: 0 };
    decs.forEach(function (d, k) {
      if (d.out) { if (d.truth) rec.outT++; else rec.outF++; }
      if (d.held) rec.held++;
      if (d.decl) { rec.decl++; if (d.onFade) rec.onFade++; }
      if (worlds[k].planted && !(d.out && d.truth)) rec.missed++;
    });
    return rec;
  }
  /* ---------- the calibration check: predicted against measured ---------- */
  // The calibrator alone (the observer never changes its readings). At every observer tick after the first
  // full sweep, cb(f, |error|, w_f, signed error) for each tone f, where the error is the latest reading
  // minus what the tone would read now, and w_f is the share of tone f inside the fade (0 without a fade).
  function calibratorErrors(w, share, cb) {
    var est = new Float64Array(NF), sweep = 0, k, t, a, g;
    for (k = 0; k < NF; k++) est[k] = 1;
    for (t = 1; t <= TICKS; t++) {
      if (owner(t, share) === 'c') { var f = FREQS[sweep % NF]; sweep++; est[f] = readAt(w, f, t); }
      else if (sweep >= NF) {
        a = fadeLevel(w.fade, t);
        for (k = 0; k < NF; k++) { g = w.fade ? 1 - a * w.fade.w[k] : 1; cb(k, Math.abs(est[k] - g), w.fade ? w.fade.w[k] : 0, est[k] - g); }
      }
    }
  }
  // the tone most inside a fade; wide fades can cover two tones fully, so near-ties (within 1e-9) go to
  // the lower frequency, which keeps the choice identical across JavaScript engines
  function fadedTone(fade) {
    var hi = -Infinity, k;
    for (k = 0; k < NF; k++) if (fade.w[k] > hi) hi = fade.w[k];
    for (k = 0; k < NF; k++) if (fade.w[k] >= hi - 1e-9) return k;
    return 0;
  }
  // The page's check: per tick share, over `episodes` episodes that all have a fade of the chosen kind, the
  // mean error on the faded tone and on clean tones (less than 1% of the tone inside the fade).
  function calibrationCheck(seed, episodes, off) {
    var out = [], n = episodes || 24, worlds = [], e;
    for (e = 0; e < n; e++) worlds.push(world({ seed: seed + '-cal', gen: Math.floor(e / EP), e: e % EP, depth: 0.8, kind: off ? 'off' : 'grid', forceFade: true }));
    for (var share = 1; share <= SHARE_MAX; share++) {
      var ef = 0, nf = 0, ec = 0, nc = 0;
      worlds.forEach(function (w) {
        var top = fadedTone(w.fade);
        calibratorErrors(w, share, function (f, err, wt) { if (f === top) { ef += err; nf++; } else if (wt < 0.01) { ec += err; nc++; } });
      });
      out.push({ share: share, fadeErr: nf ? ef / nf : 0, cleanErr: nc ? ec / nc : 0, calTicks: TICKS / (share + 1), obsTicks: TICKS * share / (share + 1) });
    }
    return out;
  }
  /* ---------- seeds, hash links, share card ---------- */
  var SEED_RE = /^[A-Za-z0-9_-]{1,24}$/;
  function dailySeed(dateStr) { return 'p' + dateStr; }
  function parseHash(hash) { return R.parseHash(hash); }
  function buildHash(o) { return R.buildHash(o); }
  function shareText(o, t) {
    var r = o.result, s = o.settings, lines = [];
    lines.push(t('share.title', { seed: o.seed }));
    lines.push(t('share.score', { score: Math.round(r.score) }));
    lines.push(t('share.events', { t: r.T, f: r.F, m: r.missed, p: Math.round(r.precision * 100) }));
    lines.push(t('share.setup', { share: s.share, th: s.th.toFixed(2), eq: t(s.eq ? 'share.on' : 'share.off'), sh: t(s.shield ? 'share.on' : 'share.off') }));
    lines.push(t(s.off ? 'share.fades.off' : 'share.fades.grid'));
    lines.push(t('share.tick') + ' ' + schedule(s.share).slice(0, s.share + 1).join('').toUpperCase().replace(/O/g, 'o'));
    lines.push(t('share.tag'));
    return lines.join('\n');
  }
  return {
    VERSION: VERSION, GEN: GEN, N: N, EP: EP, ROUNDS: ROUNDS, TICKS: TICKS, CHECK: CHECK, NCHECK: NCHECK, WINDOW: WINDOW, ECHO: ECHO,
    FREQS: FREQS, READ_NOISE: READ_NOISE, PRED_ERR: PRED_ERR, FADED: FADED, EQ_FLOOR: EQ_FLOOR, ON_FADE: ON_FADE,
    FADE_P: FADE_P, FADE_DEPTH: FADE_DEPTH, FADE_FREQS: FADE_FREQS, OFF_BW: OFF_BW, OFF_STEP: OFF_STEP,
    SHARE_MAX: SHARE_MAX, LIMITS: LIMITS, DEFAULTS: DEFAULTS, TUNED: TUNED, reference: reference, SEED_RE: SEED_RE,
    sanitizeSettings: sanitizeSettings, dft: dft, freqOf: freqOf, signedSine: signedSine, tone: tone, TONES: TONES, shape: shape,
    sinusoid: sinusoid, orthonormal: orthonormal, inSpan: inSpan, project: project, buildFade: buildFade, fadeLevel: fadeLevel,
    gainsAt: gainsAt, fadeParams: fadeParams, makeFade: makeFade, world: world, observeAt: observeAt, readAt: readAt,
    fadedShare: fadedShare, owner: owner, schedule: schedule, trajectory: trajectory, decide: decide, randomDecide: randomDecide,
    episode: episode, depthsFor: depthsFor, createContest: createContest, done: done, startFor: startFor, roundWorlds: roundWorlds,
    stepRound: stepRound, summarize: summarize, roundRecord: roundRecord, calibratorErrors: calibratorErrors, fadedTone: fadedTone,
    calibrationCheck: calibrationCheck, dailySeed: dailySeed, parseHash: parseHash, buildHash: buildHash, shareText: shareText
  };
});
