'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');

function play(seed, s, gens) {
  const c = G.createContest(seed, s);
  const n = gens === undefined ? G.GENS : gens;
  for (let k = 0; k < n; k++) G.stepGeneration(c, s);
  return c;
}
const settings = (o) => Object.assign({}, G.DEFAULTS, o);

test('RNG: same seed, same stream; different seeds differ; values in [0,1)', () => {
  const a = G.makeRng('x'), b = G.makeRng('x'), c = G.makeRng('y');
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < 20; i++) { xs.push(a()); ys.push(b()); zs.push(c()); }
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every((v) => v >= 0 && v < 1));
});

test('gauss has mean near 0 and variance near 1', () => {
  const r = G.makeRng('g');
  let s = 0, s2 = 0;
  const m = 20000;
  for (let i = 0; i < m; i++) { const v = G.gauss(r); s += v; s2 += v * v; }
  assert.ok(Math.abs(s / m) < 0.03);
  assert.ok(Math.abs(s2 / m - 1) < 0.05);
});

test('complex vectors: unit norm, <a|a> = 1, conjugate symmetry, fidelity in [0,1]', () => {
  const r = G.makeRng('v');
  const a = G.rvec(32, r), b = G.rvec(32, r);
  const aa = G.inner(a, a), ab = G.inner(a, b), ba = G.inner(b, a);
  assert.ok(Math.abs(aa.re - 1) < 1e-12 && Math.abs(aa.im) < 1e-12);
  assert.ok(Math.abs(ab.re - ba.re) < 1e-12 && Math.abs(ab.im + ba.im) < 1e-12);
  const f = G.fidelity(a, b);
  assert.ok(f >= 0 && f <= 1);
  assert.ok(Math.abs(G.fidelity(a, a) - 1) < 1e-12);
});

test('a random vector in 32 dimensions has fidelity about 1/32 with another', () => {
  const r = G.makeRng('f');
  let s = 0;
  const m = 3000;
  for (let i = 0; i < m; i++) s += G.fidelity(G.rvec(32, r), G.rvec(32, r));
  assert.ok(Math.abs(s / m - 1 / 32) < 0.004);
});

test('noisy copy keeps unit norm and stays close to the pattern at the contest noise level', () => {
  const r = G.makeRng('n');
  const p = G.rvec(32, r), sigma = G.sigmaFor(32);
  let s = 0;
  const m = 500;
  for (let i = 0; i < m; i++) { const x = G.noisy(p, sigma, r); s += G.fidelity(p, x); assert.ok(Math.abs(G.inner(x, x).re - 1) < 1e-9); }
  assert.ok(s / m > 0.2 && s / m < 0.8);
});

test('scaled threshold and sigma follow the repository formulas', () => {
  assert.ok(Math.abs(G.sigmaFor(32) - 1.5 / Math.sqrt(32)) < 1e-15);
  const sg = G.sigmaFor(32);
  assert.ok(Math.abs(G.scaledThreshold(0.5, 32, sg) - (1 + 0.5 * 32 / (1 + 2 * sg * sg * 32))) < 1e-12);
  assert.equal(G.scaledThreshold(0, 32, sg), 1);
});

test('energy ratio is n times the window mean', () => {
  assert.equal(G.energyRatio([0.5, 1.5], 32), 32);
});

function unit(n, k) { const v = { r: new Float64Array(n), i: new Float64Array(n) }; v.r[k] = 1; return v; }

test('system event needs two agreeing declarations; reward schemes behave as in the repository', () => {
  const a = unit(32, 0), b = unit(32, 0), c = unit(32, 5);
  assert.equal(G.systemEvent([a, b, null], G.AGREE), 0);
  assert.equal(G.systemEvent([a, c, null], G.AGREE), null);
  assert.equal(G.systemEvent([null, null, null], G.AGREE), null);
  const d = [a, b, c];
  assert.equal(G.reward('individual', 2, d), 1);
  assert.equal(G.reward('individual', 2, [a, b, null]), 0);
  assert.equal(G.reward('team', 2, d), 1);
  assert.equal(G.reward('consensus', 0, d), 1);
  assert.equal(G.reward('consensus', 2, d), 0);
  assert.equal(G.reward('random', 0, d), 0);
  assert.equal(G.reward('difference', 0, d), 1, 'without a, b and c disagree, so a is pivotal');
  assert.equal(G.reward('difference', 2, d), 0, 'c is not part of the agreeing pair');
  assert.equal(G.reward('difference', 0, [a, b, a]), 0, 'a third agreeing vote makes a redundant');
  assert.equal(G.reward('difference', 0, [a, null, null]), 0);
  assert.equal(G.reward('team', 0, [a, c, null]), 0);
});

test('stabilizer factor shrinks above target, floors at 0.2; leaky update is a convex blend; gain clamp is [0.33, 3]', () => {
  assert.equal(G.stabilizerFactor(0.5), 1);
  assert.ok(G.stabilizerFactor(0.9) < 1);
  assert.equal(G.stabilizerFactor(10), 0.2);
  assert.ok(G.stabilizerFactor(0) > 1);
  assert.ok(Math.abs(G.leakyUpdate(0.5, 1) - 0.65) < 1e-12);
  assert.equal(G.clampGain(100), 3);
  assert.equal(G.clampGain(0.01), 0.33);
  assert.equal(G.clampGain(1.2), 1.2);
});

test('amplifier warm start: weight capped at 0.5, no effect without a previous output', () => {
  const r = G.makeRng('w');
  const v = G.rvec(32, r), w = G.rvec(32, r);
  assert.equal(G.warmStart(v, null, 0.5), v);
  assert.equal(G.warmStart(v, w, 0), v);
  const capped = G.warmStart(G.rvec(32, G.makeRng('w2')), w, 5);
  const half = G.warmStart(G.rvec(32, G.makeRng('w2')), w, 0.5);
  assert.ok(Math.abs(G.fidelity(capped, half) - 1) < 1e-12, 'weights above the cap behave like the cap');
});

test('determinism: the same seed and settings give identical generation records', () => {
  const s = settings({ shield: true, amp: true, stab: true });
  const a = play('daily1', s), b = play('daily1', s);
  assert.equal(JSON.stringify(a.hist.map(strip)), JSON.stringify(b.hist.map(strip)));
  assert.deepEqual(Array.from(a.hist[3].episodes[2].trace), Array.from(b.hist[3].episodes[2].trace));
  const c = play('daily2', s);
  assert.notEqual(JSON.stringify(a.hist.map(strip)), JSON.stringify(c.hist.map(strip)));
});
function strip(h) {
  return { outT: h.outT, outF: h.outF, scores: h.scores, params: h.params, ep: h.episodes.map((e) => [e.planted, e.declStep, e.truth, e.outs]) };
}

test('determinism does not depend on wall-clock time or call order of other contests', () => {
  const s = settings({});
  const a = play('iso', s, 4);
  play('other', s, 3);
  const b = play('iso', s, 4);
  assert.equal(JSON.stringify(a.hist.map(strip)), JSON.stringify(b.hist.map(strip)));
});

test('lazy stepping: settings changed at generation k apply from k and leave earlier generations untouched', () => {
  const s1 = settings({ shield: false }), s2 = settings({ shield: true });
  const a = G.createContest('lazy', s1);
  for (let k = 0; k < 4; k++) G.stepGeneration(a, s1);
  for (let k = 4; k < G.GENS; k++) G.stepGeneration(a, s2);
  const b = play('lazy', s1, 4);
  assert.equal(JSON.stringify(a.hist.slice(0, 4).map(strip)), JSON.stringify(b.hist.map(strip)));
  assert.ok(a.hist.slice(0, 4).every((h) => !h.shield));
  assert.ok(a.hist.slice(4).every((h) => h.shield));
  assert.ok(a.hist.slice(4).every((h) => h.outT + h.outF <= G.EP), 'at most one output per episode with the shield');
});

test('stepping past the last generation is refused', () => {
  const s = settings({});
  const c = play('end', s);
  assert.ok(G.done(c));
  assert.throws(() => G.stepGeneration(c, s));
  assert.equal(c.hist.length, 12);
});

test('generation record is well formed', () => {
  const c = play('rec', settings({}), 1);
  const h = c.hist[0];
  assert.equal(h.episodes.length, 8);
  h.episodes.forEach((e, k) => {
    assert.equal(e.planted, k % 2 === 0);
    assert.equal(e.trace.length, 180);
    assert.equal(e.declStep.length, 3);
    e.declStep.forEach((d) => assert.ok(d === null || (d % 10 === 0 && d >= 10 && d <= 60)));
    e.truth.forEach((t, i) => { if (t) assert.ok(e.planted && e.declStep[i] !== null); });
    if (!e.planted) assert.equal(e.evT, 0);
  });
  assert.equal(h.outT + h.outF, h.episodes.reduce((a, e) => a + e.outs.length, 0));
  assert.equal(h.scores.length, 3);
  assert.equal(h.accepted.length, 3);
  assert.ok(h.accepted.every(Boolean), 'the first generation is always accepted (best starts at -1)');
});

test('traces are finite, non-negative, and frozen after a declaration', () => {
  const c = play('trace', settings({ shield: false }), 2);
  for (const h of c.hist) for (const e of h.episodes) {
    for (let i = 0; i < 3; i++) {
      let frozen = null;
      for (let t = 0; t < 60; t++) {
        const v = e.trace[t * 3 + i];
        assert.ok(isFinite(v) && v >= 0);
        if (e.declStep[i] !== null && t + 1 > e.declStep[i]) { if (frozen === null) frozen = v; assert.equal(v, frozen); }
      }
    }
  }
});

test('evolution off keeps the initial parameters; evolution on changes them (the (1+1)-ES accepts mutations)', () => {
  const off = play('es', settings({ evolve: false, th: 0.6, c: 0.1, g: 1.2 }));
  off.hist.forEach((h) => h.params.forEach((p) => { assert.equal(p.th, 0.6); assert.equal(p.c, 0.1); assert.equal(p.g, 1.2); }));
  const on = play('es', settings({ evolve: true, th: 0.6, c: 0.1, g: 1.2 }));
  const moved = on.hist[11].params.some((p) => p.th !== 0.6 || p.g !== 1.2);
  assert.ok(moved);
  on.hist.slice(1).forEach((h) => assert.ok(h.mutated));
  assert.ok(!on.hist[0].mutated);
});

test('(1+1)-ES acceptance: best-so-far never decreases and every acceptance has s >= previous best', () => {
  const c = G.createContest('acc', settings({}));
  let prev = [-1, -1, -1];
  for (let k = 0; k < G.GENS; k++) {
    const h = G.stepGeneration(c, settings({}));
    for (let i = 0; i < 3; i++) {
      assert.ok(h.best[i] >= prev[i]);
      assert.equal(h.accepted[i], h.scores[i] >= prev[i]);
    }
    prev = h.best;
  }
});

test('parameters stay inside the repository bounds under evolution', () => {
  const c = play('bounds', settings({ stab: true }));
  c.hist.forEach((h) => h.parAfter.forEach((p) => {
    assert.ok(p.th >= 0.02 && p.th <= 1.5);
    assert.ok(p.c >= 0 && p.c <= 0.5);
    assert.ok(p.sp >= 0 && p.sp <= 1);
  }));
});

test('stabilizer on: every gain is inside [0.33, 3]; the clamp flag is reported when it bites', () => {
  let bit = false;
  for (let k = 0; k < 6; k++) {
    const c = play('clamp' + k, settings({ stab: true, g: 2 }));
    c.hist.forEach((h) => { h.params.forEach((p) => assert.ok(p.g >= 0.33 && p.g <= 3)); if (h.clamped.some(Boolean)) bit = true; });
  }
  assert.ok(bit, 'the clamp should bite for a start gain of 2 over 6 seeds');
});

test('stabilizer off: gains are not clamped and geff equals g', () => {
  const c = play('noz', settings({ stab: false }), 3);
  c.hist.forEach((h) => h.episodes.forEach((e) => e.geff.forEach((g, i) => assert.equal(g, h.params[i].g))));
});

test('stabilizer on: effective gain follows the leaky integrator factor', () => {
  const c = G.createContest('zz', settings({ stab: true }));
  const h = G.stepGeneration(c, settings({ stab: true }));
  const e0 = h.episodes[0];
  assert.ok(Math.abs(e0.geff[0] - h.params[0].g * G.stabilizerFactor(0.5)) < 1e-12);
  const e1 = h.episodes[1];
  assert.ok(Math.abs(e1.geff[0] - h.params[0].g * G.stabilizerFactor(e0.rateEma)) < 1e-12);
});

test('shield: at most one output per episode, outputs are agreeing declared membranes', () => {
  const c = play('sh', settings({ shield: true }), 4);
  c.hist.forEach((h) => h.episodes.forEach((e) => {
    assert.ok(e.outs.length <= 1);
    if (e.outs.length) { assert.ok(e.declStep[e.outs[0]] !== null); assert.equal(e.passed, e.outs[0]); }
    if (e.dropped) assert.equal(e.outs.length, 0);
  }));
});

test('without the shield every declaration is an output', () => {
  const c = play('nosh', settings({ shield: false }), 3);
  c.hist.forEach((h) => h.episodes.forEach((e) => assert.equal(e.outs.length, e.declStep.filter((d) => d !== null).length)));
});

function means(s, seeds) {
  let T = 0, F = 0, rv = 0, sc = 0;
  for (let k = 0; k < seeds; k++) {
    const c = play('m' + k, s);
    const r = G.summarize(c.hist);
    T += r.T; F += r.F; rv += r.rateVar; sc += r.score;
  }
  return { T: T / seeds, F: F / seeds, rv: rv / seeds, score: sc / seeds };
}

test('shield effect over 16 seeds: fewer false events, a steadier rate, a higher game score', () => {
  const base = settings({ scheme: 'random' });
  const off = means(Object.assign({}, base, { shield: false }), 16);
  const on = means(Object.assign({}, base, { shield: true }), 16);
  assert.ok(on.F < off.F, `F ${on.F} vs ${off.F}`);
  assert.ok(on.rv < off.rv / 3, `rate variance ${on.rv} vs ${off.rv}`);
  assert.ok(on.score > off.score);
});

test('amplifier effect over 16 seeds is small: its mean score is within 3 points of the shield alone', () => {
  const base = settings({ scheme: 'random' });
  const s = means(Object.assign({}, base, { shield: true }), 16);
  const a = means(Object.assign({}, base, { shield: true, amp: true }), 16);
  assert.ok(Math.abs(a.score - s.score) < 3, `${a.score} vs ${s.score}`);
});

test('summarize: bounds, weights and the no-event case', () => {
  const none = G.summarize([]);
  assert.equal(none.score, 0);
  const c = play('sum', settings({}));
  const r = G.summarize(c.hist);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.precision >= 0 && r.precision <= 1);
  assert.ok(r.steadiness >= 0 && r.steadiness <= 1);
  assert.equal(r.T, c.hist.reduce((a, h) => a + h.outT, 0));
  assert.ok(Math.abs(r.parts.net + r.parts.precision + r.parts.steadiness - r.score) < 1e-9);
  const fake = [{ shield: true, outT: 0, outF: 0, maxG: 1 }];
  assert.equal(G.summarize(fake).score, 0, 'no events earns nothing, not a free steadiness bonus');
});

test('summarize: unshielded counts are weighted 1/3, shielded 1', () => {
  const h = (shield) => [{ shield: shield, outT: 6, outF: 0, maxG: 1 }];
  const un = G.summarize(h(false)), sh = G.summarize(h(true));
  assert.ok(Math.abs(sh.net - 6 / 4) < 1e-12, 'one generation has 4 planted episodes');
  assert.ok(Math.abs(un.net - 2 / 4) < 1e-12);
});

test('baselineFor returns the measured width-32 row, labels the nearest w, and null when unmeasured', () => {
  const b = G.baselineFor(settings({ shield: true, amp: false, stab: false, w: 0.5 }));
  assert.equal(b.tag, 'S--');
  assert.equal(b.row.cfg, 'S--');
  assert.equal(b.row.w, 0.5);
  assert.equal(b.row.T, 42.15);
  assert.ok(b.exactW);
  assert.equal(b.file, 'results/contest_w32-128_summary.csv');
  const n = G.baselineFor(settings({ shield: true, w: 0.25 }));
  assert.ok(!n.exactW);
  assert.equal(G.baselineFor(settings({ shield: false, amp: true })), null);
  assert.equal(G.baselineFor(settings({ shield: false, stab: true })), null);
  assert.ok(G.baselineFor(settings({ shield: true, amp: true, stab: true })));
});

test('baselineScore applies the game formula to repository means and is bounded', () => {
  for (const r of G.baselines.CONTEST32) {
    const b = G.baselineFor({ w: r.w, shield: r.cfg[0] === 'S', amp: r.cfg[1] === 'A', stab: r.cfg[2] === 'Z' });
    const sc = G.baselineScore(b);
    assert.ok(sc > 0 && sc <= 100);
  }
  assert.equal(G.baselineScore(null), null);
  const un = G.baselineScore(G.baselineFor(settings({ shield: false, w: 0.5 })));
  const sh = G.baselineScore(G.baselineFor(settings({ shield: true, w: 0.5 })));
  assert.ok(sh > un);
});

test('lesson choice follows what the player did, and rotates otherwise', () => {
  assert.equal(G.pickLesson(settings({ shield: false })), 'shield');
  assert.equal(G.pickLesson(settings({ shield: true, amp: true })), 'amp');
  assert.equal(G.pickLesson(settings({ shield: true, stab: true })), 'stab');
  assert.equal(G.pickLesson(settings({ shield: true, scheme: 'individual' })), 'individual');
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(G.pickLesson(settings({}), 's' + i));
  assert.ok(seen.size >= 4);
  seen.forEach((id) => assert.ok(G.LESSON_IDS.includes(id)));
});

test('sanitizeSettings clamps, rejects unknown schemes and keeps booleans', () => {
  const s = G.sanitizeSettings({ scheme: '__proto__', w: 9, th: -1, c: 'x', g: NaN, shield: 0, amp: 1 });
  assert.equal(s.scheme, 'consensus');
  assert.equal(s.w, 1);
  assert.equal(s.th, 0.1);
  assert.equal(s.c, 0.05);
  assert.equal(s.g, 1);
  assert.equal(s.shield, false);
  assert.equal(s.amp, true);
  assert.deepEqual(G.sanitizeSettings(null), G.DEFAULTS);
  assert.deepEqual(G.sanitizeSettings('x'), G.DEFAULTS);
});

test('dates: validation, day number from 2026-10-24, leap years', () => {
  assert.equal(G.dayNumber('2026-10-24'), 1);
  assert.equal(G.dayNumber('2026-10-25'), 2);
  assert.equal(G.dayNumber('2027-01-01'), 70);
  assert.ok(!isNaN(G.dateIndex('2028-02-29')));
  assert.ok(isNaN(G.dateIndex('2027-02-29')));
  assert.ok(isNaN(G.dateIndex('2026-13-01')));
  assert.ok(isNaN(G.dateIndex('2026-1-1')));
  assert.ok(isNaN(G.dateIndex('hello')));
  assert.equal(G.localDateString(new Date(2026, 9, 24, 23, 59)), '2026-10-24');
  assert.equal(G.seedDate('d2026-10-24'), '2026-10-24');
  assert.equal(G.seedDate('d2026-02-31'), null);
  assert.equal(G.seedDate('free'), null);
});

test('streaks', () => {
  assert.deepEqual(G.computeStreak([], '2026-10-24'), { current: 0, best: 0 });
  assert.deepEqual(G.computeStreak(['2026-10-24', '2026-10-25'], '2026-10-25'), { current: 2, best: 2 });
  assert.deepEqual(G.computeStreak(['2026-10-24', '2026-10-25'], '2026-10-26'), { current: 2, best: 2 });
  assert.deepEqual(G.computeStreak(['2026-10-24', '2026-10-25'], '2026-10-27'), { current: 0, best: 2 });
  assert.deepEqual(G.computeStreak(['bad', '2026-10-24'], '2026-10-24'), { current: 1, best: 1 });
});

test('hash: valid challenge parses; invalid fields are ignored', () => {
  const h = G.parseHash('#d=2026-10-25&b=77&l=fr&c=c-50-SA-');
  assert.equal(h.mode, 'challenge');
  assert.equal(h.seed, 'd2026-10-25');
  assert.equal(h.best, 77);
  assert.equal(h.lang, 'fr');
  assert.deepEqual(h.preset, { scheme: 'consensus', w: 0.5, shield: true, amp: true, stab: false });
  const bad = G.parseHash('#d=2026-10-23&s=<script>&b=999&c=x-50-SAZ&l=FR');
  assert.equal(bad.mode, 'daily');
  assert.equal(bad.seed, null);
  assert.equal(bad.best, null);
  assert.equal(bad.preset, null);
  assert.equal(bad.lang, null);
  assert.equal(G.parseHash('#s=abc&b=-5').best, null);
  assert.equal(G.parseHash('#s=abc&c=c-33-SAZ').preset, null);
  assert.equal(G.parseHash('#s=abc&c=c-50-S-A').preset, null);
  assert.equal(G.parseHash('#s=' + 'a'.repeat(25)).seed, null);
  assert.equal(G.parseHash('#s=a&' + 'z'.repeat(300)).seed, null);
  assert.equal(G.parseHash('#d=2026-02-31').seed, null);
  assert.equal(G.parseHash('#s=__proto__').seed, '__proto__', 'a seed string is data, not a property name');
  assert.equal(G.parseHash(undefined).mode, 'daily');
});

test('hash: build then parse round-trips', () => {
  const s = settings({ scheme: 'team', w: 0.75, shield: true, amp: false, stab: true });
  const h = G.buildChallengeHash({ date: '2026-11-02', best: 81.4, settings: s, lang: 'en' });
  const p = G.parseHash(h);
  assert.equal(p.date, '2026-11-02');
  assert.equal(p.best, 81);
  assert.equal(p.preset.scheme, 'team');
  assert.equal(p.preset.w, 0.75);
  assert.equal(p.preset.stab, true);
  assert.equal(G.parseHash(G.buildChallengeHash({ seed: 'abc' })).seed, 'abc');
  assert.equal(G.presetCode(settings({ w: 0.6 })), 'c-50-S--');
});

test('store sanitizer drops malformed data and keeps well-formed entries', () => {
  assert.deepEqual(G.sanitizeStore(null).daily, {});
  assert.deepEqual(G.sanitizeStore([1, 2]).daily, {});
  assert.deepEqual(G.sanitizeStore('x').daily, {});
  const good = { score: 80, T: 40, F: 3, precision: 0.93, tag: 'SAZ' };
  const s = G.sanitizeStore({
    bestDaily: 91, bestPractice: 'x', lang: 'fr',
    daily: { '2026-10-24': good, '2026-10-23': good, '2026-02-31': good, '2026-10-25': { score: 'x' }, '2026-10-26': { score: 101, T: 1, F: 1, precision: 0.5 }, '__proto__': good, '2026-10-27': Object.assign({}, good, { T: 1.5 }), '2026-10-28': Object.assign({}, good, { tag: '<b>' }) }
  });
  assert.equal(s.bestDaily, 91);
  assert.equal(s.bestPractice, null);
  assert.equal(s.lang, 'fr');
  assert.deepEqual(Object.keys(s.daily).sort(), ['2026-10-24', '2026-10-28']);
  assert.equal(s.daily['2026-10-28'].tag, '---');
  assert.equal(G.sanitizeStore({ lang: '__proto__' }).lang, undefined);
  assert.equal(G.sanitizeStore({ bestDaily: Infinity }).bestDaily, null);
});

test('fmt substitutes known keys and leaves unknown placeholders', () => {
  assert.equal(G.fmt('a {x} {y}', { x: 1 }), 'a 1 {y}');
});

test('performance: a full contest of 12 generations runs in well under a second', () => {
  const t0 = process.hrtime.bigint();
  play('perf', settings({ shield: true, amp: true, stab: true }));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `took ${ms} ms`);
});

test('startFor: deterministic per seed, inside the documented ranges, two decimals, varies across seeds', () => {
  assert.deepEqual(G.startFor('d2026-10-24'), G.startFor('d2026-10-24'));
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const s = G.startFor('seed' + i);
    assert.ok(s.th >= 0.3 && s.th <= 0.8, `th ${s.th}`);
    assert.ok(s.c >= 0 && s.c <= 0.3, `c ${s.c}`);
    assert.ok(s.g >= 0.7 && s.g <= 1.5, `g ${s.g}`);
    [s.th, s.c, s.g].forEach((v) => assert.equal(Math.round(v * 100) / 100, v));
    seen.add(s.th + '/' + s.g);
  }
  assert.ok(seen.size > 100);
});

test('a start from startFor is accepted by createContest and kept as the first generation\'s parameters', () => {
  const st = G.startFor('daily-start');
  const s = Object.assign({}, G.DEFAULTS, st);
  const c = G.createContest('daily-start', s);
  const h = G.stepGeneration(c, s);
  h.params.forEach((p) => { assert.equal(p.th, st.th); assert.equal(p.c, st.c); assert.equal(p.g, st.g); });
});

test('evolution lesson exists and the repository start is the documented default', () => {
  assert.ok(G.LESSON_IDS.includes('evolve'));
  assert.deepEqual([G.DEFAULTS.th, G.DEFAULTS.c, G.DEFAULTS.g], [0.5, 0.05, 1.0]);
});

test('from a poor start, evolution beats a frozen start; from the repository start the frozen start does at least as well (12 seeds)', () => {
  const mean = (o) => { let t = 0; for (let k = 0; k < 12; k++) { const s = Object.assign({}, G.DEFAULTS, { scheme: 'random', shield: true }, o); const c = G.createContest('evo' + k, s); while (!G.done(c)) G.stepGeneration(c, s); t += G.summarize(c.hist).score; } return t / 12; };
  assert.ok(mean({ th: 0.8, evolve: true }) > mean({ th: 0.8, evolve: false }));
  assert.ok(mean({ evolve: false }) >= mean({ evolve: true }));
});

test('instrumentation: alignment trace is recorded, in range, -1 only in noise episodes, and does not change any result', () => {
  const s = Object.assign({}, G.DEFAULTS, { shield: true });
  const c = G.createContest('instr', s);
  const rec = G.stepGeneration(c, s);
  rec.episodes.forEach((ep) => {
    assert.equal(ep.fid.length, G.STEPS * 3);
    for (let k = 0; k < ep.fid.length; k++) {
      if (ep.planted) assert.ok(ep.fid[k] >= 0 && ep.fid[k] <= 1 + 1e-6, `fid ${ep.fid[k]}`);
      else assert.equal(ep.fid[k], -1);
    }
  });
  // golden counts for this seed, recorded before the instrumentation was added to the engine
  const c2 = G.createContest('instr', s);
  const r2 = G.stepGeneration(c2, s);
  assert.equal(r2.outT, rec.outT);
  assert.equal(r2.outF, rec.outF);
});

test('golden: full contests reproduce the exact v0.1.0 numbers, so old challenge links play the same contest', () => {
  const out = [];
  for (const seed of ['golden1', 'd2026-10-24']) {
    const s = Object.assign({}, G.DEFAULTS, G.startFor(seed), { shield: true, stab: true, amp: true });
    const c = G.createContest(seed, s);
    while (!G.done(c)) G.stepGeneration(c, s);
    const r = G.summarize(c.hist);
    out.push([seed, r.T, r.F, r.score.toFixed(6), c.par.map((p) => p.th.toFixed(6) + '/' + p.g.toFixed(6)).join(' ')]);
  }
  assert.deepEqual(out, [
    ['golden1', 41, 7, '81.770833', '0.479345/1.007160 0.339303/0.752064 0.445237/1.116356'],
    ['d2026-10-24', 45, 2, '93.131049', '0.271716/0.674343 0.408475/0.924243 0.439168/0.936201']
  ]);
});
