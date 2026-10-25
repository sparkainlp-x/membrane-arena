'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../stats.js');
const G = require('../game.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('Wilson interval matches published values', () => {
  const a = S.wilson(5, 10);
  near(a.lo, 0.2366, 5e-4, 'lo 5/10'); near(a.hi, 0.7634, 5e-4, 'hi 5/10'); near(a.p, 0.5, 1e-12);
  const b = S.wilson(0, 10);
  near(b.lo, 0, 1e-12); near(b.hi, 0.2775, 5e-4, 'hi 0/10');
  const c = S.wilson(10, 10);
  near(c.hi, 1, 1e-12); near(c.lo, 0.7225, 5e-4, 'lo 10/10');
  const d = S.wilson(81, 100);
  near(d.lo, 0.7225, 2e-3); near(d.hi, 0.8749, 2e-3);
});

test('Wilson interval edge cases: no trials, clipped counts, always inside [0,1] and ordered', () => {
  assert.deepEqual(S.wilson(0, 0), { p: 0, lo: 0, hi: 1, n: 0 });
  assert.equal(S.wilson(99, 10).p, 1);
  assert.equal(S.wilson(-3, 10).p, 0);
  for (let n = 1; n <= 40; n++) for (let k = 0; k <= n; k++) {
    const w = S.wilson(k, n);
    assert.ok(w.lo >= 0 && w.hi <= 1 && w.lo <= w.p + 1e-12 && w.p <= w.hi + 1e-12);
  }
});

test('Wilson interval covers a binomial proportion about 95 percent of the time (seeded simulation)', () => {
  const rng = G.makeRng('wilson-coverage');
  for (const [p, n] of [[0.3, 20], [0.5, 30], [0.1, 50]]) {
    let hit = 0; const R = 3000;
    for (let r = 0; r < R; r++) {
      let k = 0; for (let i = 0; i < n; i++) if (rng() < p) k++;
      const w = S.wilson(k, n); if (w.lo <= p && p <= w.hi) hit++;
    }
    const cov = hit / R;
    assert.ok(cov > 0.925 && cov < 0.985, `coverage ${cov} for p=${p}, n=${n}`);
  }
});

test('t critical values and the t interval of a known sample', () => {
  near(S.tCrit95(4), 2.776, 1e-9); near(S.tCrit95(19), 2.093, 1e-9); near(S.tCrit95(30), 2.042, 1e-9);
  near(S.tCrit95(50), 2.000, 1e-9); near(S.tCrit95(1000), 1.959964, 1e-6);
  assert.ok(Number.isNaN(S.tCrit95(0)));
  const ci = S.tCI([1, 2, 3, 4, 5]);
  near(ci.mean, 3, 1e-12); near(ci.sd, Math.sqrt(2.5), 1e-12); near(ci.half, 2.776 * Math.sqrt(2.5) / Math.sqrt(5), 1e-9);
  near(ci.lo, 3 - ci.half, 1e-12);
  const one = S.tCI([7]);
  assert.equal(one.lo, 7); assert.equal(one.hi, 7); assert.equal(one.half, 0);
});

test('t interval covers the mean of a normal population about 95 percent of the time', () => {
  const rng = G.makeRng('t-coverage');
  for (const n of [5, 12, 40]) {
    let hit = 0; const R = 3000;
    for (let r = 0; r < R; r++) {
      const a = []; for (let i = 0; i < n; i++) a.push(2 + 3 * G.gauss(rng));
      const ci = S.tCI(a); if (ci.lo <= 2 && 2 <= ci.hi) hit++;
    }
    const cov = hit / R;
    assert.ok(cov > 0.93 && cov < 0.97, `coverage ${cov} for n=${n}`);
  }
});

test('bootstrap interval is reproducible, brackets the mean and agrees roughly with the t interval', () => {
  const a = []; const r0 = G.makeRng('boot-data'); for (let i = 0; i < 40; i++) a.push(10 + 2 * G.gauss(r0));
  const b1 = S.bootstrapCI(a, G.makeRng('boot'), 800), b2 = S.bootstrapCI(a, G.makeRng('boot'), 800);
  assert.deepEqual(b1, b2);
  assert.ok(b1.lo < b1.mean && b1.mean < b1.hi);
  const t = S.tCI(a);
  near(b1.lo, t.lo, 0.35); near(b1.hi, t.hi, 0.35);
  assert.equal(S.bootstrapCI([4], G.makeRng('x')).lo, 4);
});

test('bootstrap interval of the mean covers about 90 to 98 percent (small seeded simulation)', () => {
  const rng = G.makeRng('boot-coverage');
  let hit = 0; const R = 400;
  for (let r = 0; r < R; r++) {
    const a = []; for (let i = 0; i < 25; i++) a.push(G.gauss(rng));
    const ci = S.bootstrapCI(a, rng, 300); if (ci.lo <= 0 && 0 <= ci.hi) hit++;
  }
  const cov = hit / R;
  assert.ok(cov > 0.90 && cov < 0.99, `coverage ${cov}`);
});

test('paired difference: known case, sign, wins, and the interval excludes zero only when it should', () => {
  const a = [5, 6, 7, 8, 9, 10], b = [4, 4, 5, 6, 6, 7];
  const p = S.paired(a, b, G.makeRng('p'), 500);
  assert.deepEqual(p.diffs, [1, 2, 2, 2, 3, 3]);
  near(p.mean, 13 / 6, 1e-12); assert.equal(p.n, 6); assert.equal(p.aWins, 6);
  assert.equal(p.excludesZero, true);
  assert.ok(p.boot && p.boot.lo > 0);
  near(p.effect, p.mean / p.sd, 1e-12);
  const same = S.paired([1, 2, 3, 4], [1, 2, 3, 4]);
  assert.equal(same.mean, 0); assert.equal(same.excludesZero, false); assert.equal(same.effect, 0); assert.equal(same.ties, 4);
  const noisy = S.paired([1, 5, 2, 6, 3, 7], [3, 3, 4, 4, 5, 5]);
  assert.equal(noisy.excludesZero, false);
  assert.throws(() => S.paired([1, 2], [1]));
});

test('paired differences have the right false-positive rate under no effect (about 5 percent)', () => {
  const rng = G.makeRng('paired-null');
  let fp = 0; const R = 2000;
  for (let r = 0; r < R; r++) {
    const a = [], b = [];
    for (let i = 0; i < 20; i++) { const shared = G.gauss(rng); a.push(shared + 0.5 * G.gauss(rng)); b.push(shared + 0.5 * G.gauss(rng)); }
    if (S.paired(a, b).excludesZero) fp++;
  }
  const rate = fp / R;
  assert.ok(rate > 0.03 && rate < 0.08, `false-positive rate ${rate}`);
});

test('histogram counts, clipping and describe', () => {
  assert.deepEqual(S.histogram([0, 0.1, 0.5, 0.99, 1, 2, -1, NaN], 0, 1, 4), [3, 0, 1, 3]);
  const d = S.describe([3, 1, 2, 10]);
  assert.equal(d.min, 1); assert.equal(d.max, 10); assert.equal(d.median, 2.5); assert.equal(d.n, 4);
  assert.equal(S.describe([]).n, 0);
  near(S.quantile([1, 2, 3, 4], 0.25), 1.75, 1e-12);
});
