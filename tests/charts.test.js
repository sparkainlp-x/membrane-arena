'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../charts.js');
const G = require('../game.js');
const L = require('../lab.js');

function stubCanvas(w, h) {
  const log = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'log') return log;
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return typeof t[k] === 'undefined' ? (...a) => { log.push(k); } : t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: w, height: h }), ctx, log };
}
const s0 = Object.assign({}, G.DEFAULTS, { shield: true, stab: true });
const c0 = G.createContest('chart-seed', s0);
while (!G.done(c0)) G.stepGeneration(c0, s0);
const pr = L.probe(c0, s0, 12);
const sizes = [[320, 190], [390, 220], [900, 260], [1180, 340]];

test('scale maps the data range onto the pixel range, ticks are nice and inside the range', () => {
  const s = C.scale(0, 10, 100, 200);
  assert.equal(s(0), 100); assert.equal(s(10), 200); assert.equal(s(5), 150);
  const r = C.scale(0, 1, 50, 10); assert.equal(r(1), 10);
  assert.deepEqual(C.ticks(0, 1, 4), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  [[0, 1], [0, 3.4], [0, 13], [0.82, 0.96], [1, 12]].forEach(([lo, hi]) => {
    const t = C.ticks(lo, hi, 4);
    assert.ok(t.length >= 2 && t.length <= 9, `${lo}-${hi}: ${t}`);
    t.forEach((v) => assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9));
    for (let k = 1; k < t.length; k++) assert.ok(t[k] > t[k - 1]);
  });
  assert.deepEqual(C.ticks(2, 2), [2]);
});

test('jitter is deterministic and bounded; score colours are valid rgb', () => {
  for (let k = 0; k < 200; k++) { const j = C.jitter(k); assert.ok(j >= -1 && j <= 1); assert.equal(j, C.jitter(k)); }
  assert.notEqual(C.jitter(1), C.jitter(2));
  [0, 0.3, 0.5, 0.9, 1].forEach((t) => { const c = C.scoreColor(t, 0, 1); assert.equal(c.length, 3); c.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v <= 255)); });
  assert.equal(C.scoreColor(1, 1, 1).length, 3);
});

test('every Lab chart draws on phone and desktop sizes, in both palettes, from real simulation data', () => {
  const ser = L.rateSeries(c0.hist), al = L.alignment(c0.hist, 11), h = L.ratioHistogram(pr), sw = L.sweep(pr, 20), sc = L.shieldCounts(c0.hist), gt = L.gainTrace(c0.hist), ls = L.landscape(c0.hist);
  const es = L.createEnsemble({ settings: s0, n: 3, repoStart: true }); let r; do { r = es.step(1000); } while (!r.done);
  const sum = L.summarizeEnsemble(es.results(), s0, true);
  const pm = L.createPaired({ settings: s0, factor: 'amp', a: true, b: false, n: 3, repoStart: true }); do { r = pm.step(1000); } while (!r.done);
  const ps = L.summarizePaired(pm.a.results(), pm.b.results()), ab = L.ampBaseline();
  for (const hc of [false, true]) for (const [w, hh] of sizes) {
    const o = { hc, labels: { empty: 'no data' } };
    const jobs = [
      (cv) => C.drawRates(cv, ser, o), (cv) => C.drawAlignment(cv, al, o), (cv) => C.drawHist(cv, h, o), (cv) => C.drawSweep(cv, sw, o), (cv) => C.drawShield(cv, sc, o),
      (cv) => C.drawGain(cv, gt, o), (cv) => C.drawLandscape(cv, ls, { x: 'th', y: 'g' }, o), (cv) => C.drawLandscape(cv, ls, { x: 'c', y: 'th' }, o), (cv) => C.drawEnsemble(cv, sum, o),
      (cv) => C.drawPaired(cv, ps, o), (cv) => C.drawAmp(cv, ab, o), (cv) => C.drawRail(cv, c0.hist, 1234, o)
    ];
    jobs.forEach((job, k) => {
      const cv = stubCanvas(w, hh);
      job(cv);
      assert.ok(cv.log.length > 20, `chart ${k} drew only ${cv.log.length} calls at ${w}x${hh}`);
      assert.ok(cv.width >= 160 && cv.height >= 36);
    });
  }
});

test('every chart handles empty data with a message instead of throwing', () => {
  const o = { labels: { empty: 'no data' } };
  const emptyEns = { n: 0, metrics: {}, baseline: null };
  [
    (cv) => C.drawRates(cv, [], o), (cv) => C.drawAlignment(cv, null, o), (cv) => C.drawHist(cv, null, o), (cv) => C.drawSweep(cv, null, o),
    (cv) => C.drawShield(cv, { gens: [], total: {} }, o), (cv) => C.drawGain(cv, { x: [], geff: [[], [], []], rate: [] }, o),
    (cv) => C.drawLandscape(cv, { trials: 0, points: [] }, null, o), (cv) => C.drawEnsemble(cv, emptyEns, o), (cv) => C.drawPaired(cv, { n: 0, metrics: {} }, o),
    (cv) => C.drawAmp(cv, { rows: [] }, o)
  ].forEach((job, k) => {
    const cv = stubCanvas(300, 200); job(cv);
    assert.ok(cv.log.includes('fillText'), `chart ${k} shows the empty message`);
  });
});

test('the high-contrast palette is white on black with heavier lines, and the normal palette keeps the brand colours', () => {
  assert.equal(C.HC.bg, '#000000'); assert.equal(C.HC.text, '#ffffff'); assert.ok(C.HC.lw > C.PAL.lw);
  assert.deepEqual(C.PAL.gold, [201, 168, 76]); assert.equal(C.PAL.bg, '#070e26');
});

test('the ensemble chart plots the repository baseline marker only when a baseline exists', () => {
  const s1 = L.matchRepository({ shield: true }), es = L.createEnsemble({ settings: s1, n: 2, repoStart: true }); let r; do { r = es.step(1000); } while (!r.done);
  const withB = L.summarizeEnsemble(es.results(), s1, true), without = Object.assign({}, withB, { baseline: null });
  const a = stubCanvas(600, 300), b = stubCanvas(600, 300);
  C.drawEnsemble(a, withB, {}); C.drawEnsemble(b, without, {});
  assert.ok(withB.baseline, 'a baseline exists for shield only');
  assert.ok(a.log.length > b.log.length, 'baseline adds drawing calls');
});
