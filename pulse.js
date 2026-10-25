/*
 * Membrane Arena: Wave Pulse, find where the ripple started (SYNTHETIC classical simulation).
 * Pure logic: no DOM, no network, no storage.
 *
 * A trigger (a big win or a crowd cheer) starts a ripple somewhere on a 40 x 26 grid of membranes.
 * The ripple is a damped wave equation solved with the textbook leapfrog scheme and reflecting
 * walls. A few listening membranes (sensors) at the edge record the height under them, with noise.
 * The player, and the locator it can compare itself with, must say from those recordings alone
 * where the ripple started. Then the whole ripple is replayed, drawn in a Great Wave colour style.
 *
 * The locator is least-squares time-difference-of-arrival (TDOA) on detected arrival ticks. It
 * assumes an even floor. Some pulses run on a floor with a hidden slow patch, which breaks that
 * assumption on purpose. The detector threshold k, the locator speed c and the size rho of the
 * locator's 90% region were chosen on calibration seeds only (docs/PULSE-PROTOCOL.md) and are
 * loaded from pulse-calib.js.
 *
 * This is a game on a small simulation. It does not model a real arena floor, a pressure wave in a
 * real material, holography, light fields, smart materials or any physical system. "Membrane" names
 * a grid cell, as on the other pages; the Great Wave look is a colour style only.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // the frozen calibration is optional: scripts/pulse-check.js writes it and the game runs without it
    var calib = null;
    try { calib = require('./pulse-calib.js'); } catch (e) { calib = null; }
    module.exports = factory(require('./game.js'), calib);
  } else root.ArenaPulse = factory(root.ArenaGame, root.ArenaPulseCalib || null);
})(typeof self !== 'undefined' ? self : this, function (G, CALIB) {
  'use strict';
  var VERSION = G.VERSION;
  var GEN = 'membrane-arena/pulse/v1/';

  /* ---------- the simulation (docs/PULSE-PROTOCOL.md section 2) ---------- */
  var W = 40, H = 26, NC = W * H;
  var R2 = 0.25;                 // (c dt / dx)^2: nominal speed 0.5 cells per tick
  var C_NOMINAL = 0.5;
  var GAMMA = 0.004;             // damping
  var PRE = 20;                  // quiet listening ticks before the trigger
  var TICKS = 130;
  var BUMP_SIGMA = 1.2, BUMP_CUT2 = 36;
  var BOX = { x0: 4, x1: 35, y0: 4, y1: 21 };   // where a trigger can be
  var CENTER = [(W - 1) / 2, (H - 1) / 2];
  var SENSORS = [[1, 1], [38, 1], [1, 24], [38, 24], [20, 1], [20, 24], [1, 13], [38, 13]];
  var SENSOR_SETS = { 8: [0, 1, 2, 3, 4, 5, 6, 7], 4: [0, 1, 2, 3] };
  var NOISE = { calm: 0.004, loud: 0.025 };
  var CHEER = { mMin: 3, mMax: 5, rMin: 1, rMax: 4, aMin: 0.35, aMax: 0.55, delayMax: 7 };
  var PATCH = { cx0: 6, cx1: 34, cy0: 5, cy1: 21, ax0: 4, ax1: 10, ay0: 3, ay1: 8, f0: 0.45, f1: 0.65, edge: 6 };
  var AVG_TAU = 8;               // early-sensor average: weight exp(-(arrival - earliest) / 8)
  var HIT = 2;                   // a hit is within 2 cells
  var KINDS = ['win', 'cheer'], SENS = [8, 4], NOISES = ['calm', 'loud'], FLOORS = ['even', 'patchy'];
  // the 16 settings in the protocol's order: trigger x sensors x noise x floor
  var SETTINGS = [];
  KINDS.forEach(function (kind) { SENS.forEach(function (s) { NOISES.forEach(function (n) { FLOORS.forEach(function (f) {
    SETTINGS.push({ kind: kind, sensors: s, noise: n, floor: f });
  }); }); }); });
  var DEFAULT_SETTING = { kind: 'win', sensors: 8, noise: 'calm', floor: 'even' };
  function settingId(s) { return s.kind + '/' + s.sensors + '/' + s.noise + '/' + s.floor; }
  function settingIndex(s) {
    return ((KINDS.indexOf(s.kind) * 2 + SENS.indexOf(s.sensors)) * 2 + NOISES.indexOf(s.noise)) * 2 + FLOORS.indexOf(s.floor);
  }

  // Used until pulse-calib.js exists (the page says so); never used for reported results.
  var FALLBACK_CALIB = { k: 6, c: 0.5, rho: 4, calibrated: false };
  function calib() { return CALIB && CALIB.k ? CALIB : FALLBACK_CALIB; }

  function lerp(a, b, u) { return a + (b - a) * u; }

  // Everything random about a pulse comes from its seed, independently of the setting, so one seed
  // under two settings differs only in that setting.
  function spec(seed) {
    var rng = G.makeRng(GEN + seed + '/spec');
    var sx = lerp(BOX.x0, BOX.x1, rng()), sy = lerp(BOX.y0, BOX.y1, rng());
    var m = CHEER.mMin + Math.floor(rng() * (CHEER.mMax - CHEER.mMin + 1)), bumps = [];
    for (var j = 0; j < CHEER.mMax; j++) {   // always draw 5, use m: the draws stay aligned
      var ang = rng() * 2 * Math.PI, r = lerp(CHEER.rMin, CHEER.rMax, rng());
      var a = lerp(CHEER.aMin, CHEER.aMax, rng()), d = Math.floor(rng() * (CHEER.delayMax + 1));
      if (j < m) bumps.push({ x: sx + r * Math.cos(ang), y: sy + r * Math.sin(ang), a: a, t: PRE + d });
    }
    var patch = {
      cx: lerp(PATCH.cx0, PATCH.cx1, rng()), cy: lerp(PATCH.cy0, PATCH.cy1, rng()),
      ax: lerp(PATCH.ax0, PATCH.ax1, rng()), ay: lerp(PATCH.ay0, PATCH.ay1, rng()), f: lerp(PATCH.f0, PATCH.f1, rng())
    };
    return { seed: String(seed), x: sx, y: sy, bumps: bumps, patch: patch };
  }
  function sources(sp, kind) { return kind === 'cheer' ? sp.bumps : [{ x: sp.x, y: sp.y, a: 1, t: PRE }]; }
  function target(sp, kind) {
    if (kind !== 'cheer') return [sp.x, sp.y];
    var x = 0, y = 0, a = 0;
    sp.bumps.forEach(function (b) { x += b.a * b.x; y += b.a * b.y; a += b.a; });
    return [x / a, y / a];
  }
  function patchWeight(p, x, y) {
    var q = Math.pow((x - p.cx) / p.ax, 2) + Math.pow((y - p.cy) / p.ay, 2);
    return 1 / (1 + Math.exp((q - 1) * PATCH.edge));
  }
  function speedField(sp, floor) {
    var r2 = new Float64Array(NC);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      r2[y * W + x] = floor === 'patchy' ? R2 * (1 - (1 - sp.patch.f * sp.patch.f) * patchWeight(sp.patch, x, y)) : R2;
    }
    return r2;
  }
  // Runs the grid. Returns the clean height under all 8 sensors at every tick and, if asked, every
  // frame (Float32Array of TICKS * W * H) for drawing.
  function simulate(sp, kind, floor, wantFrames) {
    var up = new Float64Array(NC), u = new Float64Array(NC), un = new Float64Array(NC), tmp;
    var r2 = speedField(sp, floor), src = sources(sp, kind);
    var clean = SENSORS.map(function () { return new Float64Array(TICKS); });
    var frames = wantFrames ? new Float32Array(TICKS * NC) : null;
    for (var t = 0; t < TICKS; t++) {
      for (var s = 0; s < src.length; s++) {
        if (src[s].t !== t) continue;
        var b = src[s];
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
          var d2 = (x - b.x) * (x - b.x) + (y - b.y) * (y - b.y);
          if (d2 > BUMP_CUT2) continue;
          var v = b.a * Math.exp(-d2 / (2 * BUMP_SIGMA * BUMP_SIGMA));
          u[y * W + x] += v; up[y * W + x] += v;
        }
      }
      for (var k = 0; k < SENSORS.length; k++) clean[k][t] = u[SENSORS[k][1] * W + SENSORS[k][0]];
      if (frames) frames.set(u, t * NC);
      for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
        var i = yy * W + xx;
        var l = xx > 0 ? u[i - 1] : u[i + 1], r = xx < W - 1 ? u[i + 1] : u[i - 1];
        var dn = yy > 0 ? u[i - W] : u[i + W], dw = yy < H - 1 ? u[i + W] : u[i - W];
        un[i] = (2 * u[i] - (1 - GAMMA) * up[i] + r2[i] * (l + r + dn + dw - 4 * u[i])) / (1 + GAMMA);
      }
      tmp = up; up = u; u = un; un = tmp;
    }
    return { clean: clean, frames: frames, r2: r2 };
  }
  // Standard normal noise for each of the 8 sensors, from the pulse seed only.
  function noiseStreams(seed) {
    return SENSORS.map(function (p, k) {
      var rng = G.makeRng(GEN + seed + '/noise/' + k), z = new Float64Array(TICKS);
      for (var t = 0; t < TICKS; t++) z[t] = G.gauss(rng);
      return z;
    });
  }
  function noisy(clean, z, sigma) { return Float64Array.from(clean, function (v, t) { return v + sigma * z[t]; }); }

  /* ---------- detector and methods (section 3) ---------- */
  function smooth(x) {
    var s = new Float64Array(x.length);
    for (var t = 1; t < x.length - 1; t++) s[t] = (x[t - 1] + x[t] + x[t + 1]) / 3;
    return s;
  }
  function baseline(s) {
    var m = 0, v = 0, t;
    for (t = 1; t < PRE; t++) m += s[t];
    m /= PRE - 1;
    for (t = 1; t < PRE; t++) v += (s[t] - m) * (s[t] - m);
    return { mean: m, sd: Math.sqrt(v / (PRE - 2)) };
  }
  function crossing(s, m, thr) {
    for (var t = PRE; t < s.length - 1; t++) if (Math.abs(s[t] - m) > thr) return t;
    return -1;
  }
  // arrival tick of a noisy trace with threshold k baseline standard deviations, or -1
  function detect(trace, k) { var s = smooth(trace), b = baseline(s); return b.sd > 0 ? crossing(s, b.mean, k * b.sd) : -1; }
  // the same rule on a clean trace, with the threshold fixed at k times the setting's noise sigma
  function detectClean(trace, thr) { return crossing(smooth(trace), 0, thr); }

  function costAt(pos, arr, c, x, y) {
    var n = pos.length, res = new Array(n), m = 0, i;
    for (i = 0; i < n; i++) { res[i] = arr[i] - Math.sqrt((x - pos[i][0]) * (x - pos[i][0]) + (y - pos[i][1]) * (y - pos[i][1])) / c; m += res[i]; }
    m /= n;
    var ss = 0;
    for (i = 0; i < n; i++) ss += (res[i] - m) * (res[i] - m);
    return ss;
  }
  function used(sensorIdx, arrivals) {
    var pos = [], arr = [];
    sensorIdx.forEach(function (k, j) { if (arrivals[j] >= 0) { pos.push(SENSORS[k]); arr.push(arrivals[j]); } });
    return { pos: pos, arr: arr };
  }
  // TDOA least squares with an unknown start time: every cell, then 1/8 cell within one cell of the best
  function locate(sensorIdx, arrivals, c) {
    var u = used(sensorIdx, arrivals);
    if (u.pos.length < 3) return { x: CENTER[0], y: CENTER[1], cost: NaN, n: u.pos.length, fallback: true };
    var bx = 0, by = 0, bc = Infinity, x, y, q;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { q = costAt(u.pos, u.arr, c, x, y); if (q < bc) { bc = q; bx = x; by = y; } }
    var cx = bx, cy = by;
    for (var j = -8; j <= 8; j++) for (var i = -8; i <= 8; i++) {
      x = cx + i / 8; y = cy + j / 8;
      if (x < 0 || y < 0 || x > W - 1 || y > H - 1) continue;
      q = costAt(u.pos, u.arr, c, x, y);
      if (q < bc) { bc = q; bx = x; by = y; }
    }
    return { x: bx, y: by, cost: bc, n: u.pos.length, fallback: false };
  }
  // the locator's 90% region: half-cell points whose cost is within rho of the minimum
  function region(sensorIdx, arrivals, c, rho, loc) {
    if (loc.fallback) return { cells: [], area: 0 };
    var u = used(sensorIdx, arrivals), cells = [];
    for (var gy = 0; gy <= 2 * (H - 1); gy++) for (var gx = 0; gx <= 2 * (W - 1); gx++) {
      if (costAt(u.pos, u.arr, c, gx / 2, gy / 2) <= loc.cost + rho) cells.push(gy * (2 * W - 1) + gx);
    }
    return { cells: cells, area: cells.length * 0.25 };
  }
  function covers(sensorIdx, arrivals, c, rho, loc, tgt) {
    if (loc.fallback) return false;
    var u = used(sensorIdx, arrivals);
    return costAt(u.pos, u.arr, c, tgt[0], tgt[1]) <= loc.cost + rho;
  }
  function earlyAverage(sensorIdx, arrivals) {
    var first = Infinity, x = 0, y = 0, w = 0;
    arrivals.forEach(function (a) { if (a >= 0 && a < first) first = a; });
    if (first === Infinity) return CENTER.slice();
    sensorIdx.forEach(function (k, j) {
      if (arrivals[j] < 0) return;
      var wt = Math.exp(-(arrivals[j] - first) / AVG_TAU);
      x += wt * SENSORS[k][0]; y += wt * SENSORS[k][1]; w += wt;
    });
    return [x / w, y / w];
  }
  function nearestSensor(sensorIdx, arrivals) {
    var best = -1;
    arrivals.forEach(function (a, j) { if (a >= 0 && (best < 0 || a < arrivals[best])) best = j; });
    return best < 0 ? CENTER.slice() : SENSORS[sensorIdx[best]].slice();
  }
  function randomGuess(seed) {
    var rng = G.makeRng(GEN + seed + '/random');
    return [lerp(BOX.x0, BOX.x1, rng()), lerp(BOX.y0, BOX.y1, rng())];
  }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }
  function points(err) { return Math.max(0, Math.round(100 - 12 * err)); }

  // Everything a method can know about one pulse in one setting, and how each method does.
  // sim and z may be passed in to reuse one simulation across settings.
  function analyze(seed, setting, cal, sim, z) {
    cal = cal || calib();
    var sp = spec(seed);
    sim = sim || simulate(sp, setting.kind, setting.floor, false);
    z = z || noiseStreams(seed);
    var idx = SENSOR_SETS[setting.sensors], sigma = NOISE[setting.noise], tgt = target(sp, setting.kind);
    var traces = idx.map(function (k) { return noisy(sim.clean[k], z[k], sigma); });
    var arrivals = traces.map(function (tr) { return detect(tr, cal.k); });
    var loc = locate(idx, arrivals, cal.c);
    var cleanArr = idx.map(function (k) { return detectClean(sim.clean[k], cal.k * sigma); });
    var nf = locate(idx, cleanArr, cal.c);
    var answers = {
      locator: [loc.x, loc.y], early: earlyAverage(idx, arrivals), nearest: nearestSensor(idx, arrivals),
      center: CENTER.slice(), random: randomGuess(seed), noiseFree: [nf.x, nf.y]
    };
    var err = {};
    Object.keys(answers).forEach(function (m) { err[m] = dist(answers[m], tgt); });
    return {
      seed: String(seed), setting: setting, spec: sp, target: tgt, sensors: idx, traces: traces, arrivals: arrivals,
      loc: loc, answers: answers, err: err, covered: covers(idx, arrivals, cal.c, cal.rho, loc, tgt),
      missed: arrivals.filter(function (a) { return a < 0; }).length, sim: sim
    };
  }

  /* ---------- the game (section 9) ---------- */
  var PER_STAGE = 4;
  var STAGES = [
    { id: 1, key: 'wins', setting: function () { return { kind: 'win', sensors: 8, noise: 'calm', floor: 'even' }; } },
    { id: 2, key: 'cheers', setting: function () { return { kind: 'cheer', sensors: 8, noise: 'loud', floor: 'even' }; } },
    { id: 3, key: 'patchy', setting: function (j) { return { kind: j % 2 === 0 ? 'win' : 'cheer', sensors: 4, noise: 'calm', floor: 'patchy' }; } }
  ];
  var TOTAL = PER_STAGE * STAGES.length;
  var SEED_RE = /^[A-Za-z0-9_-]{1,24}$/;
  function pulseSeed(runSeed, i) { return runSeed + '.' + i; }
  function createRun(seed) {
    seed = SEED_RE.test(String(seed)) ? String(seed) : 'pulse';
    var pulses = [];
    STAGES.forEach(function (st, si) {
      for (var j = 0; j < PER_STAGE; j++) pulses.push({ seed: pulseSeed(seed, pulses.length), stage: si, setting: st.setting(j) });
    });
    return { seed: seed, pulses: pulses, log: [] };
  }
  function done(run) { return run.log.length >= TOTAL; }
  // a pulse ready to play: what the player may see (traces, arrivals, the locator's hint) and the
  // full frames for the reveal
  function preparePulse(run, i, cal) {
    var p = run.pulses[i], sp = spec(p.seed), sim = simulate(sp, p.setting.kind, p.setting.floor, true);
    var a = analyze(p.seed, p.setting, cal, sim, noiseStreams(p.seed));
    cal = cal || calib();
    a.region = region(a.sensors, a.arrivals, cal.c, cal.rho, a.loc);
    a.stage = p.stage; a.index = i;
    return a;
  }
  function snap(v, max) { return Math.max(0, Math.min(max, Math.round(v * 2) / 2)); }
  // the player's guess for pulse i, snapped to the half-cell grid
  function guess(run, a, x, y) {
    var g = [snap(x, W - 1), snap(y, H - 1)], e = dist(g, a.target);
    var entry = {
      i: a.index, stage: a.stage, setting: a.setting, guess: g, target: a.target, err: e, points: points(e),
      locator: { err: a.err.locator, points: points(a.err.locator) },
      early: { err: a.err.early, points: points(a.err.early) },
      center: { err: a.err.center, points: points(a.err.center) },
      covered: a.covered, fallback: a.loc.fallback
    };
    run.log.push(entry);
    return entry;
  }
  function summarize(log) {
    var s = { pulses: log.length, points: 0, locator: 0, early: 0, center: 0, hits: 0, locHits: 0, err: 0, locErr: 0 };
    log.forEach(function (e) {
      s.points += e.points; s.locator += e.locator.points; s.early += e.early.points; s.center += e.center.points;
      if (e.err <= HIT) s.hits++;
      if (e.locator.err <= HIT) s.locHits++;
      s.err += e.err; s.locErr += e.locator.err;
    });
    s.meanErr = log.length ? s.err / log.length : 0;
    s.meanLocErr = log.length ? s.locErr / log.length : 0;
    return s;
  }
  function rank(s) {
    if (!s.pulses) return 'none';
    if (s.points > s.locator) return 'beatLocator';
    if (s.points === s.locator) return 'tieLocator';
    if (s.points > s.early) return 'beatIntuition';
    if (s.points > s.center) return 'learning';
    return 'lost';
  }
  function dailySeed(dateStr) { return 'p' + dateStr; }

  /* ---------- replay codes: a run's guesses, checked by replaying it ---------- */
  // Three letters per guess (its half-cell position), then two check letters over the seed and the
  // body. The check catches typing and copying errors, not forgery: the replay recomputes every point
  // from the seed, so a code can only ever show the score its guesses really earn.
  var CODE_ABC = 'abcdefghijklmnopqrstuvwxyz234567', CHECK_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  var GX = 2 * W - 1, GY = 2 * H - 1;
  var CODE_RE = /^(?:[a-z2-7]{3}){1,12}[A-HJ-NP-Z]{2}$/;
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function checkChars(seed, body) { var h = fnv(String(seed) + ':' + body) % 576; return CHECK_ABC[Math.floor(h / 24)] + CHECK_ABC[h % 24]; }
  function encodeRun(seed, log) {
    var body = log.map(function (e) {
      var v = Math.round(e.guess[1] * 2) * GX + Math.round(e.guess[0] * 2);
      return CODE_ABC[v >> 10] + CODE_ABC[(v >> 5) & 31] + CODE_ABC[v & 31];
    }).join('');
    return body ? body + checkChars(seed, body) : '';
  }
  function decodeRun(seed, code) {
    code = String(code || '');
    if (!CODE_RE.test(code)) return { ok: false, error: 'format' };
    var body = code.slice(0, -2);
    if (checkChars(seed, body) !== code.slice(-2)) return { ok: false, error: 'check' };
    var guesses = [];
    for (var i = 0; i < body.length; i += 3) {
      var v = (CODE_ABC.indexOf(body[i]) << 10) + (CODE_ABC.indexOf(body[i + 1]) << 5) + CODE_ABC.indexOf(body[i + 2]);
      if (v >= GX * GY) return { ok: false, error: 'range', at: i / 3 };
      guesses.push([(v % GX) / 2, Math.floor(v / GX) / 2]);
    }
    return { ok: true, guesses: guesses };
  }
  function replayRun(seed, code, cal) {
    if (!SEED_RE.test(String(seed))) return { ok: false, error: 'seed' };
    var dec = decodeRun(seed, code);
    if (!dec.ok) return dec;
    var run = createRun(seed);
    dec.guesses.forEach(function (g, i) {
      var p = run.pulses[i], a = analyze(p.seed, p.setting, cal);
      a.stage = p.stage; a.index = i;
      guess(run, a, g[0], g[1]);
    });
    return { ok: true, run: run, summary: summarize(run.log), complete: done(run) };
  }

  /* ---------- links and share card ---------- */
  function parseHash(hash) {
    var out = { seed: null, lang: null, replay: null }, h = String(hash || '').replace(/^#/, '');
    if (!h || h.length > 200) return out;
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
      if (k === 's' && SEED_RE.test(v)) out.seed = v;
      else if (k === 'l' && (v === 'en' || v === 'fr')) out.lang = v;
      else if (k === 'r' && CODE_RE.test(v)) out.replay = v;
    });
    return out;
  }
  function buildHash(o) {
    var parts = [];
    if (o && o.seed && SEED_RE.test(o.seed)) {
      parts.push('s=' + o.seed);
      if (o.replay && CODE_RE.test(o.replay)) parts.push('r=' + o.replay);
    }
    if (o && o.lang === 'fr') parts.push('l=fr');
    return parts.length ? '#' + parts.join('&') : '';
  }
  var GLYPH = ['\u00B7', '\u25CB', '\u25C7', '\u25C6'];   // 0, 1-49, 50-79, 80+ points
  function glyph(p) { return p >= 80 ? GLYPH[3] : p >= 50 ? GLYPH[2] : p > 0 ? GLYPH[1] : GLYPH[0]; }
  function strip(log, stage) { return log.filter(function (e) { return e.stage === stage; }).map(function (e) { return glyph(e.points); }).join(''); }
  function shareText(o, t) {
    var s = o.summary, lines = [];
    lines.push(t('share.title', { seed: o.seed }));
    lines.push(t('share.points', { p: s.points, l: s.locator, h: s.hits, n: s.pulses }));
    STAGES.forEach(function (st, i) { lines.push(t('share.stage', { n: st.id }) + ' ' + strip(o.log, i)); });
    if (o.code) lines.push(t('share.code', { code: o.code }));
    lines.push(t('share.tag'));
    return lines.join('\n');
  }

  return {
    VERSION: VERSION, GEN: GEN, W: W, H: H, NC: NC, R2: R2, C_NOMINAL: C_NOMINAL, GAMMA: GAMMA, PRE: PRE, TICKS: TICKS,
    BOX: BOX, CENTER: CENTER, SENSORS: SENSORS, SENSOR_SETS: SENSOR_SETS, NOISE: NOISE, CHEER: CHEER, PATCH: PATCH,
    AVG_TAU: AVG_TAU, HIT: HIT, SETTINGS: SETTINGS, DEFAULT_SETTING: DEFAULT_SETTING, settingId: settingId,
    settingIndex: settingIndex, FALLBACK_CALIB: FALLBACK_CALIB, CALIB: CALIB, calib: calib,
    spec: spec, sources: sources, target: target, patchWeight: patchWeight, speedField: speedField, simulate: simulate,
    noiseStreams: noiseStreams, noisy: noisy, smooth: smooth, baseline: baseline, detect: detect, detectClean: detectClean,
    costAt: costAt, locate: locate, region: region, covers: covers, earlyAverage: earlyAverage, nearestSensor: nearestSensor,
    randomGuess: randomGuess, dist: dist, points: points, analyze: analyze,
    PER_STAGE: PER_STAGE, STAGES: STAGES, TOTAL: TOTAL, SEED_RE: SEED_RE, pulseSeed: pulseSeed, createRun: createRun,
    done: done, preparePulse: preparePulse, guess: guess, summarize: summarize, rank: rank, dailySeed: dailySeed,
    CODE_RE: CODE_RE, encodeRun: encodeRun, decodeRun: decodeRun, replayRun: replayRun,
    parseHash: parseHash, buildHash: buildHash, GLYPH: GLYPH, glyph: glyph, strip: strip, shareText: shareText
  };
});
