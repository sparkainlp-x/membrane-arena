'use strict';
// Wave Pulse (pulse.js): the synthetic wave grid, the detector, the locator, the game and replay codes.
// Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pulse.js');
const G = require('../game.js');
const CAL = P.calib();

function playAll(seed, pick) {
  const run = P.createRun(seed);
  for (let i = 0; i < P.TOTAL; i++) {
    const A = P.preparePulse(run, i, CAL), g = pick(A, i);
    P.guess(run, A, g[0], g[1]);
  }
  return run;
}

test('grid and settings: 40 x 26 cells, 16 settings, the locator engine stays pinned to v0.3.4', () => {
  assert.equal(P.W, 40); assert.equal(P.H, 26); assert.equal(P.NC, 1040);
  assert.equal(P.SETTINGS.length, 16);
  assert.equal(new Set(P.SETTINGS.map(P.settingId)).size, 16);
  assert.equal(P.settingId(P.DEFAULT_SETTING), 'win/8/calm/even');
  assert.equal(P.VERSION, '0.3.4');
  assert.equal(G.VERSION, '0.3.5');
  // the courant number stays below the 2-D stability limit of the explicit scheme
  assert.ok(P.C_NOMINAL * P.C_NOMINAL <= 0.5);
});

test('the calibration in pulse-calib.js was fitted on calibration seeds and is the one the page uses', () => {
  assert.equal(CAL.calibrated, true);
  assert.equal(CAL.fittedOn, 'pcal-000..pcal-199');
  assert.deepEqual([CAL.k, CAL.c], [7, 0.46]);
  assert.ok(CAL.rho > 0);
  const r = require('../docs/pulse-results.json');
  assert.deepEqual([r.calibration.k, r.calibration.c, r.calibration.rho], [CAL.k, CAL.c, CAL.rho]);
});

test('spec and simulation are deterministic from the seed', () => {
  assert.deepEqual(P.spec('golden.0'), P.spec('golden.0'));
  assert.notDeepEqual(P.spec('golden.0'), P.spec('golden.1'));
  const a = P.simulate(P.spec('det'), 'win', 'even', true), b = P.simulate(P.spec('det'), 'win', 'even', true);
  assert.deepEqual(Array.from(a.clean[3]), Array.from(b.clean[3]));
  assert.equal(a.frames.length, P.TICKS * P.NC);
  assert.deepEqual(Array.from(a.frames.subarray(70 * P.NC, 71 * P.NC)), Array.from(b.frames.subarray(70 * P.NC, 71 * P.NC)));
});

test('triggers start inside the box; a win is one bump at the trigger tick, a cheer 3 to 5 bumps around its weighted centre', () => {
  for (let k = 0; k < 40; k++) {
    const sp = P.spec('box' + k);
    assert.ok(sp.x >= P.BOX.x0 && sp.x <= P.BOX.x1 && sp.y >= P.BOX.y0 && sp.y <= P.BOX.y1);
    const win = P.sources(sp, 'win');
    assert.equal(win.length, 1); assert.equal(win[0].t, P.PRE);
    assert.deepEqual(P.target(sp, 'win'), [sp.x, sp.y]);
    const ch = P.sources(sp, 'cheer');
    assert.ok(ch.length >= P.CHEER.mMin && ch.length <= P.CHEER.mMax);
    assert.ok(ch.every((b) => b.t >= P.PRE && b.t <= P.PRE + P.CHEER.delayMax));
    const t = P.target(sp, 'cheer'), a = ch.reduce((s, b) => s + b.a, 0);
    assert.ok(Math.abs(t[0] - ch.reduce((s, b) => s + b.a * b.x, 0) / a) < 1e-12);
    assert.ok(Math.abs(t[1] - ch.reduce((s, b) => s + b.a * b.y, 0) / a) < 1e-12);
  }
});

test('the grid is quiet before the trigger, and the ripple reaches nearer sensors first', () => {
  const sp = P.spec('order'), sim = P.simulate(sp, 'win', 'even', false);
  for (const tr of sim.clean) for (let t = 0; t < P.PRE; t++) assert.equal(tr[t], 0);
  const thr = CAL.k * P.NOISE.calm;
  const arr = sim.clean.map((tr) => P.detectClean(tr, thr));
  const d = P.SENSORS.map((s) => P.dist(s, [sp.x, sp.y]));
  // every pair of sensors at clearly different distances is heard in distance order
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    if (d[i] + 3 < d[j]) assert.ok(arr[i] <= arr[j], `sensor ${i} (${d[i].toFixed(1)}) before ${j} (${d[j].toFixed(1)})`);
  }
});

test('a symmetric start gives symmetric arrivals; damping keeps the field bounded', () => {
  const sp = Object.assign({}, P.spec('sym'), { x: 19.5, y: 12.5, patch: P.spec('sym').patch });
  const sim = P.simulate(sp, 'win', 'even', true);
  const thr = CAL.k * P.NOISE.calm, a = sim.clean.map((tr) => P.detectClean(tr, thr));
  assert.equal(a[0], a[1]); assert.equal(a[0], a[2]); assert.equal(a[0], a[3]);   // the four corners
  assert.equal(a[4], a[5]); assert.equal(a[6], a[7]);                            // the mid-edges
  let peakEarly = 0, peakLate = 0;
  for (let i = 0; i < P.NC; i++) { peakEarly = Math.max(peakEarly, Math.abs(sim.frames[P.PRE * P.NC + i])); peakLate = Math.max(peakLate, Math.abs(sim.frames[(P.TICKS - 1) * P.NC + i])); }
  assert.ok(peakLate < peakEarly, 'the ripple spreads and loses height');
  assert.ok(Array.from(sim.frames).every(Number.isFinite));
});

test('a patchy floor has one slow patch and delays the arrivals that cross it', () => {
  const sp = P.spec('patch-test');
  const even = P.speedField(sp, 'even'), patchy = P.speedField(sp, 'patchy');
  assert.ok(even.every((v) => v === even[0]));
  assert.ok(Math.min(...patchy) < even[0] && Math.max(...patchy) <= even[0] + 1e-12);
  const ev = P.simulate(sp, 'win', 'even', false), pa = P.simulate(sp, 'win', 'patchy', false);
  const thr = CAL.k * P.NOISE.calm;
  const late = P.SENSORS.map((s, k) => P.detectClean(pa.clean[k], thr) - P.detectClean(ev.clean[k], thr));
  assert.ok(late.every((x) => x >= 0), JSON.stringify(late));
});

test('noise streams depend only on the pulse seed, and the detector stays quiet on noise alone', () => {
  assert.deepEqual(Array.from(P.noiseStreams('n1')[2]), Array.from(P.noiseStreams('n1')[2]));
  let falses = 0;
  for (let k = 0; k < 50; k++) {
    const z = P.noiseStreams('quiet' + k);
    for (const noise of ['calm', 'loud']) for (let s = 0; s < 8; s++) {
      if (P.detect(P.noisy(new Float64Array(P.TICKS), z[s], P.NOISE[noise]), CAL.k) >= 0) falses++;
    }
  }
  assert.ok(falses <= 8, `${falses} false detections in 800 noise-only recordings`);
});

test('the locator recovers a start from exact arrival times, and falls back to the centre with fewer than 3', () => {
  const idx = P.SENSOR_SETS[8], c = 0.5;
  for (const p of [[10, 7], [27.25, 15.5], [5.5, 20]]) {
    const arr = idx.map((k) => 30 + P.dist(P.SENSORS[k], p) / c);
    const loc = P.locate(idx, arr, c);
    assert.ok(Math.abs(loc.x - p[0]) <= 0.125 && Math.abs(loc.y - p[1]) <= 0.125, JSON.stringify([loc.x, loc.y, p]));
    assert.equal(loc.fallback, false);
    const reg = P.region(idx, arr, c, 5, loc);
    assert.ok(reg.cells.length > 0 && P.covers(idx, arr, c, 5, loc, p));
    assert.ok(reg.cells.length < P.region(idx, arr, c, 50, loc).cells.length, 'a larger threshold gives a larger region');
  }
  const fb = P.locate(idx, [40, 50, -1, -1, -1, -1, -1, -1], c);
  assert.equal(fb.fallback, true);
  assert.deepEqual([fb.x, fb.y], P.CENTER);
  assert.deepEqual(P.region(idx, [40, 50, -1, -1, -1, -1, -1, -1], c, 4, fb).cells, []);
});

test('baselines: early-sensor average leans to the first sensor, nearest sensor picks it, random stays in the box', () => {
  const idx = P.SENSOR_SETS[4];
  assert.deepEqual(P.nearestSensor(idx, [50, 30, 60, 70]), P.SENSORS[1]);
  assert.deepEqual(P.nearestSensor(idx, [-1, -1, -1, -1]), P.CENTER);
  const e = P.earlyAverage(idx, [50, 30, 60, 70]);
  assert.ok(P.dist(e, P.SENSORS[1]) < P.dist(e, P.SENSORS[0]));
  assert.deepEqual(P.earlyAverage(idx, [-1, -1, -1, -1]), P.CENTER);
  const r = P.randomGuess('rg');
  assert.deepEqual(r, P.randomGuess('rg'));
  assert.ok(r[0] >= P.BOX.x0 && r[0] <= P.BOX.x1 && r[1] >= P.BOX.y0 && r[1] <= P.BOX.y1);
});

test('points: 100 minus 12 per cell, never below 0; a hit is within 2 cells', () => {
  assert.equal(P.points(0), 100); assert.equal(P.points(1), 88); assert.equal(P.points(2), 76);
  assert.equal(P.points(8.3), 0); assert.equal(P.points(30), 0);
  assert.equal(P.HIT, 2);
});

test('a run is 12 pulses in 3 stages: wins, loud cheers, then a patchy floor with 4 sensors', () => {
  const run = P.createRun('golden');
  assert.equal(run.pulses.length, P.TOTAL); assert.equal(P.TOTAL, 12);
  assert.equal(run.pulses.map((p) => P.settingId(p.setting)).join(' '),
    'win/8/calm/even win/8/calm/even win/8/calm/even win/8/calm/even cheer/8/loud/even cheer/8/loud/even cheer/8/loud/even cheer/8/loud/even win/4/calm/patchy cheer/4/calm/patchy win/4/calm/patchy cheer/4/calm/patchy');
  assert.deepEqual(run.pulses.map((p) => p.seed).slice(0, 2), ['golden.0', 'golden.1']);
  assert.equal(P.createRun('<bad seed>').seed, 'pulse');
  assert.equal(P.dailySeed('2026-10-25'), 'p2026-10-25');
});

test('guesses snap to the half-cell grid and stay on the floor', () => {
  const run = P.createRun('snap'), A = P.preparePulse(run, 0, CAL);
  const e = P.guess(run, A, 10.26, -3);
  assert.deepEqual(e.guess, [10.5, 0]);
  const e2 = P.guess(run, A, 99, 12.74);
  assert.deepEqual(e2.guess, [P.W - 1, 12.5]);
  assert.equal(e.points, P.points(P.dist(e.guess, A.target)));
});

test('golden run: guessing the locator\'s answer every time gives fixed totals', () => {
  const run = playAll('golden', (A) => A.answers.locator);
  const s = P.summarize(run.log);
  assert.deepEqual([s.pulses, s.points, s.locator, s.early, s.center, s.hits, s.locHits], [12, 1034, 1031, 526, 304, 10, 10]);
  assert.equal(P.rank(s), 'beatLocator');   // snapping to the half-cell grid happened to help by 3 points
});

test('rank: beat or tie the locator, beat the intuition, beat the centre, or lose', () => {
  const s = (points) => ({ pulses: 12, points, locator: 900, early: 600, center: 300 });
  assert.equal(P.rank(s(901)), 'beatLocator');
  assert.equal(P.rank(s(900)), 'tieLocator');
  assert.equal(P.rank(s(601)), 'beatIntuition');
  assert.equal(P.rank(s(301)), 'learning');
  assert.equal(P.rank(s(300)), 'lost');
  assert.equal(P.rank({ pulses: 0 }), 'none');
});

test('replay codes: round trip, recomputed score, and the errors a code can have', () => {
  const run = playAll('golden', (A, i) => i % 2 ? A.answers.locator : A.answers.early);
  const code = P.encodeRun('golden', run.log);
  assert.match(code, P.CODE_RE);
  assert.equal(code.length, 3 * 12 + 2);
  const r = P.replayRun('golden', code, CAL);
  assert.equal(r.ok, true); assert.equal(r.complete, true);
  assert.deepEqual(r.summary, P.summarize(run.log));
  assert.deepEqual(r.run.log.map((e) => e.guess), run.log.map((e) => e.guess));
  // the check letters tie the code to its seed
  assert.deepEqual(P.replayRun('golden2', code, CAL), { ok: false, error: 'check' });
  const bad = code.slice(0, 3) + (code[3] === 'a' ? 'b' : 'a') + code.slice(4);
  assert.deepEqual(P.replayRun('golden', bad, CAL), { ok: false, error: 'check' });
  assert.deepEqual(P.replayRun('golden', 'HELLO', CAL), { ok: false, error: 'format' });
  assert.deepEqual(P.replayRun('<x>', code, CAL), { ok: false, error: 'seed' });
  // a partial run replays as incomplete
  const part = P.createRun('part');
  for (let i = 0; i < 3; i++) { const A = P.preparePulse(part, i, CAL); P.guess(part, A, 20, 12); }
  const rp = P.replayRun('part', P.encodeRun('part', part.log), CAL);
  assert.equal(rp.ok, true); assert.equal(rp.complete, false); assert.equal(rp.summary.pulses, 3);
});

test('links: parseHash and buildHash round trip and reject bad values', () => {
  const code = P.encodeRun('abc', playAll('abc', (A) => A.answers.center).log);
  assert.deepEqual(P.parseHash('#s=abc&r=' + code + '&l=fr'), { seed: 'abc', lang: 'fr', replay: code });
  assert.equal(P.buildHash({ seed: 'abc', replay: code, lang: 'fr' }), '#s=abc&r=' + code + '&l=fr');
  assert.deepEqual(P.parseHash(P.buildHash({ seed: 'abc', replay: code })), { seed: 'abc', lang: null, replay: code });
  assert.deepEqual(P.parseHash('#s=<b>&l=de&r=XX'), { seed: null, lang: null, replay: null });
  assert.equal(P.buildHash({ replay: code }), '');
  assert.equal(P.buildHash({ seed: 'bad seed!' , lang: 'fr' }), '#l=fr');
});

test('share card: seed, totals, one glyph per pulse, the code, no emoji', () => {
  const run = playAll('golden', (A) => A.answers.locator), s = P.summarize(run.log), code = P.encodeRun('golden', run.log);
  const t = (k, o) => k + (o ? JSON.stringify(o) : '');
  const txt = P.shareText({ seed: 'golden', summary: s, log: run.log, code }, t);
  assert.ok(txt.includes('"seed":"golden"') && txt.includes(code) && txt.includes('"p":1034'));
  assert.equal(P.strip(run.log, 0), '\u25C6\u25C6\u25C6\u25C6');
  assert.equal(P.glyph(0), '\u00B7'); assert.equal(P.glyph(49), '\u25CB'); assert.equal(P.glyph(50), '\u25C7'); assert.equal(P.glyph(80), '\u25C6');
  assert.ok(!/\p{Extended_Pictographic}/u.test(txt));
});

test('preparePulse gives the page exactly what analyze gives the evaluation', () => {
  const run = P.createRun('same');
  for (const i of [0, 5, 9]) {
    const A = P.preparePulse(run, i, CAL), B = P.analyze(run.pulses[i].seed, run.pulses[i].setting, CAL);
    assert.deepEqual(A.arrivals, B.arrivals);
    assert.deepEqual(A.answers, B.answers);
    assert.deepEqual(A.err, B.err);
    assert.equal(A.covered, B.covered);
    assert.ok(A.region.cells.length > 0 || A.loc.fallback);
  }
});
