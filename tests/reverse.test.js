'use strict';
// Reverse Membranes logic (SYNTHETIC classical simulation). Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../game.js');
const R = require('../reverse.js');
const I18N = require('../reverse-i18n.js').LANGS;
const play = (seed, settings) => { const c = R.createContest(seed); while (!R.done(c)) R.stepRound(c, settings); return R.summarize(c.hist); };

test('constants: half the arena width, the arena\'s episode, round and check counts', () => {
  assert.equal(R.N, 16);
  assert.equal(R.EP, G.EP); assert.equal(R.ROUNDS, G.GENS); assert.equal(R.STEPS, G.STEPS); assert.equal(R.CHECK, G.CHECK);
  assert.equal(R.VERSION, G.VERSION);
  assert.deepEqual(R.SIGN, { forward: 1, reverse: -1 });
});

test('settings are clamped and defaulted', () => {
  assert.deepEqual(R.sanitizeSettings(null), R.DEFAULTS);
  assert.deepEqual(R.sanitizeSettings({ polarity: 'sideways', th: 9, echo: 7.6, shield: 0 }), { polarity: 'reverse', th: 0.95, echo: 2, shield: false });
  assert.deepEqual(R.sanitizeSettings({ polarity: 'forward', th: -1, echo: -3 }), { polarity: 'forward', th: 0.2, echo: 0, shield: true });
  assert.equal(R.sanitizeSettings({ th: 'abc' }).th, R.DEFAULTS.th);
});

test('a dark sample is a unit vector with the hole\'s share of energy removed', () => {
  const rng = G.makeRng('unit/dark');
  const hole = G.rvec(R.N, rng);
  for (let k = 0; k < 50; k++) {
    const x = R.darkSample(hole, 1, rng);
    const nrm = G.inner(x, x).re;
    assert.ok(Math.abs(nrm - 1) < 1e-12);
    const z = G.inner(hole, x);
    assert.ok(z.re * z.re + z.im * z.im < 1e-20, 'depth 1 leaves nothing along the hole');
  }
  // depth 0.6 keeps 0.4 of the amplitude: energy ratio along the hole about 0.16 * 16 / 15.16 = 0.17
  let e = 0; const M = 4000;
  for (let k = 0; k < M; k++) { const z = G.inner(hole, R.darkSample(hole, 0.6, rng)); e += z.re * z.re + z.im * z.im; }
  const ratio = R.N * e / M;
  assert.ok(ratio > 0.12 && ratio < 0.23, String(ratio));
  // a random direction still sees about chance
  const other = G.rvec(R.N, rng); let f = 0;
  for (let k = 0; k < M; k++) { const z = G.inner(other, R.darkSample(hole, 1, rng)); f += z.re * z.re + z.im * z.im; }
  assert.ok(Math.abs(R.N * f / M - 1) < 0.15, String(R.N * f / M));
});

test('the reverse update removes the latest observation from v; the forward update moves v towards it', () => {
  const rng = G.makeRng('unit/update');
  for (let k = 0; k < 20; k++) {
    const x = G.rvec(R.N, rng), v = G.rvec(R.N, rng), w = G.copyVec(v);
    const before = G.fidelity(x, v);
    R.update(v, x, -1, R.ETA.reverse);
    assert.ok(Math.abs(G.inner(v, v).re - 1) < 1e-12);
    const z = G.inner(x, v);
    assert.ok(Math.hypot(z.re, z.im) < 1e-12, 'eta 1 makes v orthogonal to x');
    R.update(w, x, 1, R.ETA.forward);
    assert.ok(G.fidelity(x, w) > before, 'forward climbs towards x');
  }
});

test('signed energy: opposite energy is 1 - ratio for reverse, ratio - 1 for forward', () => {
  assert.ok(Math.abs(R.signedEnergy('reverse', 0.2) - 0.8) < 1e-12);
  assert.ok(Math.abs(R.signedEnergy('forward', 2) - 1) < 1e-12);
  assert.ok(Math.abs(R.signedEnergy('reverse', 1)) < 1e-12);
});

test('episodes are deterministic for a seed, and a membrane\'s trace freezes once it declares', () => {
  const P = R.sanitizeSettings({ th: 0.6, echo: 1 });
  const run = () => { const rng = G.makeRng('unit/ep'); const pat = G.rvec(R.N, rng); const tr = new Float32Array(R.STEPS * 3); return { r: R.episode({ world: 'dark', pat, depth: 1, P }, rng, tr), tr }; };
  const a = run(), b = run();
  assert.deepEqual(a.r.declStep, b.r.declStep);
  assert.deepEqual(Array.from(a.tr), Array.from(b.tr));
  const i = a.r.declStep.findIndex((s) => s !== null);
  assert.ok(i >= 0, 'someone declares at depth 1');
  const s = a.r.declStep[i];
  assert.equal(s % R.CHECK, 0);
  assert.ok(a.tr[(s - 1) * 3 + i] >= P.th, 'declared at or above the threshold');
  for (let t = s; t <= R.STEPS; t++) assert.equal(a.tr[(t - 1) * 3 + i], a.tr[(s - 1) * 3 + i]);
});

test('reverse membranes find a dark pattern; forward membranes never do', () => {
  const rng = G.makeRng('unit/find');
  let hitRev = 0, hitFwd = 0, declFwd = 0;
  for (let k = 0; k < 30; k++) {
    const pat = G.rvec(R.N, rng);
    const rv = R.episode({ world: 'dark', pat, depth: 1, P: R.sanitizeSettings({ th: 0.6, echo: 1 }) }, rng, null);
    if (rv.decl.some((d) => R.isTrue(d, pat))) hitRev++;
    const fw = R.episode({ world: 'dark', pat, depth: 1, P: R.sanitizeSettings({ polarity: 'forward', th: 0.6, echo: 1 }) }, rng, null);
    if (fw.decl.some((d) => R.isTrue(d, pat))) hitFwd++;
    declFwd += fw.decl.filter(Boolean).length;
  }
  assert.ok(hitRev >= 27, `reverse found ${hitRev} of 30`);
  assert.equal(hitFwd, 0);
  assert.ok(declFwd < 30, 'forward declarations in a dark world are noise and rare');
});

test('judge: the shield passes one declaration that 2 of 3 agree on, and holds lone ones', () => {
  const rng = G.makeRng('unit/judge');
  const pat = G.rvec(R.N, rng), other = G.rvec(R.N, rng), third = G.rvec(R.N, rng);
  let j = R.judge([G.copyVec(pat), G.copyVec(pat), other], pat, true);
  assert.deepEqual([j.outs, j.evT, j.evF, j.dropped], [[0], 1, 0, false]);
  j = R.judge([pat, other, third], pat, true);
  assert.deepEqual([j.outs, j.evT, j.evF, j.dropped], [[], 0, 0, true]);
  j = R.judge([pat, other, null], pat, false);
  assert.deepEqual([j.outs, j.evT, j.evF], [[0, 1], 1, 1]);
  j = R.judge([null, null, null], null, true);
  assert.deepEqual([j.outs, j.dropped], [[], false]);
  j = R.judge([other, G.copyVec(other), null], null, true);
  assert.deepEqual([j.evT, j.evF], [0, 1], 'agreement on noise is a false output');
});

test('the darkness tide is seeded, 12 rounds between 0.6 and 1, and seeds differ', () => {
  const d = R.depthsFor('golden');
  assert.deepEqual(d, [0.62, 0.71, 0.8, 0.92, 0.97, 1, 0.91, 0.82, 0.72, 0.69, 0.61, 0.68]);
  assert.deepEqual(R.depthsFor('golden'), d);
  assert.notDeepEqual(R.depthsFor('other'), d);
  for (const s of ['a', 'b', 'c', 'r2026-10-25']) for (const x of R.depthsFor(s)) assert.ok(x >= R.DEPTH_MIN && x <= R.DEPTH_MAX);
});

test('a contest starts forward with no echo and a threshold on the slider grid', () => {
  for (const s of ['a', 'b', 'golden', 'e2e-1', 'r2026-10-25']) {
    const st = R.startFor(s);
    assert.equal(st.polarity, 'forward'); assert.equal(st.echo, 0); assert.equal(st.shield, true);
    assert.ok(st.th >= 0.3 && st.th <= 0.9);
    assert.ok(Math.abs(st.th * 20 - Math.round(st.th * 20)) < 1e-9, String(st.th));
  }
  assert.deepEqual(R.startFor('golden'), { polarity: 'forward', th: 0.7, echo: 0, shield: true });
});

test('contest: 12 rounds, records each round, refuses a 13th, and the golden seed is pinned', () => {
  const c = R.createContest('golden');
  const r1 = R.stepRound(c, R.DEFAULTS);
  assert.equal(r1.gen, 0); assert.equal(r1.episodes.length, R.EP); assert.equal(r1.depth, 0.62);
  assert.equal(r1.episodes[0].trace.length, R.STEPS * 3);
  assert.deepEqual(r1.episodes.map((e) => e.planted), [true, false, true, false, true, false, true, false]);
  while (!R.done(c)) R.stepRound(c, R.DEFAULTS);
  assert.throws(() => R.stepRound(c, R.DEFAULTS), /finished/);
  const s = R.summarize(c.hist);
  assert.equal(s.planted, 48);
  // golden numbers: changing the generator or the rules changes every contest
  assert.deepEqual([s.T, s.F, s.missed, Math.round(s.score * 1000) / 1000], [41, 0, 7, 85.601]);
  assert.equal(play('golden', R.DEFAULTS).score, s.score, 'same seed and settings, same contest');
});

test('echo matters: without it, absence is learned too slowly (3 seeds)', () => {
  for (const sd of ['t1', 't2', 't3']) {
    const a = play(sd, { echo: 0 }).score, b = play(sd, { echo: 1 }).score;
    assert.ok(b > a + 15, `${sd}: echo 1 ${b.toFixed(1)} vs echo 0 ${a.toFixed(1)}`);
  }
  assert.equal(play('t1', { polarity: 'forward' }).T, 0, 'forward membranes score no true output in the dark contest');
});

test('the mirror test: each world is found only by the matching polarity', () => {
  const cells = R.mirrorTest(R.DEFAULTS, 'unit', 40);
  const get = (w, p) => cells.find((c) => c.world === w && c.polarity === p);
  assert.equal(cells.length, 4);
  for (const c of cells) { assert.equal(c.planted, 20); assert.equal(c.noise, 20); }
  assert.ok(get('dark', 'reverse').T >= 16, JSON.stringify(cells));
  assert.ok(get('bright', 'forward').T >= 14, JSON.stringify(cells));
  assert.equal(get('dark', 'forward').T, 0);
  assert.equal(get('bright', 'reverse').T, 0);
  assert.deepEqual(R.mirrorTest(R.DEFAULTS, 'unit', 40), cells, 'deterministic');
});

test('seeds and links: daily seed, hash parsing rejects junk, round trip', () => {
  assert.equal(R.dailySeed('2026-10-25'), 'r2026-10-25');
  assert.deepEqual(R.parseHash('#s=abc_1&l=fr'), { seed: 'abc_1', lang: 'fr' });
  assert.deepEqual(R.parseHash('#s=<script>&l=de'), { seed: null, lang: null });
  assert.deepEqual(R.parseHash('#s=' + 'x'.repeat(25)), { seed: null, lang: null });
  assert.deepEqual(R.parseHash('#' + 'a'.repeat(300)), { seed: null, lang: null });
  assert.equal(R.buildHash({ seed: 'e2e-1', lang: 'fr' }), '#s=e2e-1&l=fr');
  assert.equal(R.buildHash({ seed: 'bad seed', lang: 'en' }), '');
  assert.deepEqual(R.parseHash(R.buildHash({ seed: 'r2026-10-25', lang: 'en' })), { seed: 'r2026-10-25', lang: null });
});

test('the score card is plain text in both languages, with one darkness glyph per round', () => {
  const c = R.createContest('golden');
  while (!R.done(c)) R.stepRound(c, R.DEFAULTS);
  for (const lang of ['en', 'fr']) {
    const t = (k, v) => G.fmt(I18N[lang][k], v);
    const s = R.shareText({ seed: 'golden', result: R.summarize(c.hist), settings: c.hist[11].settings, depths: c.depths }, t);
    const lines = s.split('\n');
    assert.equal(lines.length, 6);
    assert.ok(lines[1].includes('86/100'));
    assert.ok(!/\{\w+\}/.test(s), 'every placeholder filled');
    assert.ok(!/\p{Extended_Pictographic}/u.test(s));
    assert.equal(lines[4].split(' ').pop().length, 12);
  }
  assert.equal(R.darkGlyph(0.6), '\u2581'); assert.equal(R.darkGlyph(1), '\u2588'); assert.equal(R.darkGlyph(5), '\u2588');
});

test('reverse.js uses only seeded randomness and touches no browser state', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'reverse.js'), 'utf8');
  assert.ok(!/Math\.random|Date\.now|new Date|document\.|window\.|localStorage|fetch\(/.test(src));
});
