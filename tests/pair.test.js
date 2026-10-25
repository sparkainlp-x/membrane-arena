'use strict';
// Reverse Pair logic. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const P = require('../pair.js');
const L = require('../pair-i18n.js').LANGS;
const t = (k, v) => G.fmt(L.en[k], v);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const ones = () => new Float64Array(P.FREQS.length).fill(1);
test('the Fourier transform is unitary: it round-trips and keeps the norm', () => {
  const rng = G.makeRng('dft');
  for (let k = 0; k < 20; k++) {
    const v = G.rvec(P.N, rng), X = P.dft(v, false), back = P.dft(X, true);
    let n = 0;
    for (let j = 0; j < P.N; j++) { near(back.r[j], v.r[j], 1e-12, 're'); near(back.i[j], v.i[j], 1e-12, 'im'); n += X.r[j] ** 2 + X.i[j] ** 2; }
    near(n, 1, 1e-12, 'norm');
  }
});
test('each tone is a unit signed-amplitude sine code on exactly one calibration frequency', () => {
  P.FREQS.forEach((f) => {
    const v = P.TONES[f], s = P.signedSine(f), X = P.dft(v, false);
    let n = 0, scale = 0;
    for (let j = 0; j < P.N; j++) { n += v.r[j] ** 2 + v.i[j] ** 2; scale += s[j] ** 2; }
    near(n, 1, 1e-12, 'unit norm ' + f);
    scale = 1 / Math.sqrt(scale);
    for (let j = 0; j < P.N; j++) {
      const mag = Math.hypot(v.r[j], v.i[j]);
      near(mag, Math.abs(s[j]) * scale, 1e-12, `amplitude f${f} j${j}`);
      if (Math.abs(s[j]) > 1e-9) near(Math.atan2(v.i[j], v.r[j]), s[j] > 0 ? Math.PI / 4 : -3 * Math.PI / 4, 1e-9, `phase f${f} j${j}`);   // 5 pi / 4 = -3 pi / 4
    }
    const on = new Set();
    for (let k = 0; k < P.N; k++) if (X.r[k] ** 2 + X.i[k] ** 2 > 1e-12) on.add(P.freqOf(k));
    assert.deepEqual([...on], [f], 'tone ' + f + ' sits on its own frequency');
  });
});
test('the calibrator is predictable: clean readings average 1 with the predicted error, faded ones the true gain', () => {
  const M = 2000, clean = { fade: null, rnoise: new Float64Array(P.TICKS) };
  let sum = 0, abs = 0, n = 0;
  for (let k = 0; k < M / P.TICKS + 1; k++) {
    const w = P.world({ seed: 'read' + k, gen: 0, e: 1, depth: 0.8, kind: 'grid' });
    clean.rnoise = w.rnoise;
    for (let tk = 1; tk <= P.TICKS; tk++) { const v = P.readAt(clean, tk % 9, tk); sum += v; abs += Math.abs(v - 1); n++; }
  }
  near(sum / n, 1, 0.005, 'mean reading');
  near(abs / n, P.PRED_ERR, 0.003, 'mean absolute error');
  near(P.PRED_ERR, P.READ_NOISE * Math.sqrt(2 / Math.PI), 1e-15, 'the prediction');
  const w = P.world({ seed: 'readfade', gen: 0, e: 1, depth: 0.8, kind: 'grid', forceFade: true });
  const quiet = Object.assign({}, w, { rnoise: new Float64Array(P.TICKS) });
  for (let tk = 1; tk <= P.TICKS; tk++) {
    const g = P.gainsAt(w.fade, tk);
    P.FREQS.forEach((f) => near(P.readAt(quiet, f, tk), g[f], 1e-12, 'noise-free reading is the true gain'));
  }
});
test('on-grid fades cover exactly one tone; off-grid fades sit between tones and leak across several', () => {
  assert.deepEqual(Array.from(P.gainsAt(null, 10)), Array.from(ones()));
  const grid = P.buildFade({ kind: 'grid', band: 4, depth: 0.8, f: 1, ph: 0 });
  assert.equal(grid.rank, 2);
  P.FREQS.forEach((f) => near(grid.w[f], f === 4 ? 1 : 0, 1e-12, 'grid share of tone ' + f));
  let lo = 1, hi = 0;
  for (let tk = 1; tk <= P.TICKS; tk++) {
    const g = P.gainsAt(grid, tk);
    for (let k = 0; k < g.length; k++) if (k !== 4) near(g[k], 1, 1e-12, 'untouched tone');
    lo = Math.min(lo, g[4]); hi = Math.max(hi, g[4]);
  }
  near(lo, 0.2, 0.01, 'deepest'); near(hi, 1, 0.01, 'shallowest');
  const off = P.buildFade({ kind: 'off', center: 3.5, bw: 0, depth: 0.8, f: 1, ph: 0 });
  assert.ok(off.w[3] > 0.2 && off.w[4] > 0.2, 'a fade halfway between 3 and 4 reaches both');
  assert.ok(Math.max(...off.w) < 0.7, 'no single tone sees it whole: ' + Math.max(...off.w).toFixed(3));
  const rng = G.makeRng('fades');
  let nGrid = 0, nOff = 0;
  for (let k = 0; k < 300; k++) {
    const g = P.makeFade(rng, 'grid'), o = P.makeFade(rng, 'off');
    if (g) { nGrid++; assert.ok(g.band >= 1 && g.band <= 7); assert.ok(g.depth >= 0.6 && g.depth <= 0.95); assert.ok(P.FADE_FREQS.includes(g.f)); }
    if (o) {
      nOff++;
      assert.ok(o.center > 1 && o.center < 7 && Math.abs(o.center - Math.round(o.center)) >= 0.19, 'centre off the grid: ' + o.center);
      assert.ok(o.bw >= P.OFF_BW[0] && o.bw <= P.OFF_BW[1] && Math.abs(o.bw / P.OFF_STEP - Math.round(o.bw / P.OFF_STEP)) < 1e-9);
      assert.ok(o.rank >= 2 && o.rank <= 2 * (1 + P.OFF_BW[1] / P.OFF_STEP));
      assert.ok(Array.from(o.w).filter((x) => x > 0.01).length >= 2, 'leaks across at least two tones');
      // Q is orthonormal
      o.Q.forEach((q, i) => o.Q.forEach((r, j) => { const z = G.inner(q, r); near(Math.hypot(z.re, z.im), i === j ? 1 : 0, 1e-9, 'orthonormal'); }));
    }
  }
  near(nGrid / 300, P.FADE_P, 0.08, 'fade frequency (grid)'); near(nOff / 300, P.FADE_P, 0.08, 'fade frequency (off)');
});
test('paired worlds: both fade kinds and every method meet the same pattern, noise, readings and fade timing', () => {
  for (let e = 0; e < 8; e++) {
    const a = P.world({ seed: 'pairs', gen: 3, e, depth: 0.8, kind: 'grid' }), b = P.world({ seed: 'pairs', gen: 3, e, depth: 0.8, kind: 'off' });
    assert.equal(a.planted, e % 2 === 0); assert.equal(a.planted, b.planted);
    assert.deepEqual(Array.from(a.noise), Array.from(b.noise));
    assert.deepEqual(Array.from(a.rnoise), Array.from(b.rnoise));
    assert.deepEqual(a.v0, b.v0);
    if (a.pat) assert.deepEqual(a.pat, b.pat);
    assert.equal(!!a.fade, !!b.fade);
    if (a.fade) { assert.equal(a.fade.depth, b.fade.depth); assert.equal(a.fade.f, b.fade.f); assert.equal(a.fade.ph, b.fade.ph); assert.equal(a.fade.kind, 'grid'); assert.equal(b.fade.kind, 'off'); }
  }
  const w1 = P.world({ seed: 'pairs', gen: 0, e: 2, depth: 0.8, kind: 'grid' }), w2 = P.world({ seed: 'pairs', gen: 0, e: 2, depth: 0.8, kind: 'grid' });
  const t1 = P.trajectory(w1, 'eq', 2), t2 = P.trajectory(w2, 'eq', 2);
  assert.deepEqual(Array.from(t1.trace), Array.from(t2.trace), 'a trajectory is a pure function of its world');
  assert.equal(t1.checks.length, P.NCHECK);
});
test('the equalizer with exact readings undoes the channel', () => {
  const rng = G.makeRng('eq'), g = ones(); g[2] = 0.25; g[6] = 0.5;
  for (let k = 0; k < 10; k++) {
    const v = G.rvec(P.N, rng), back = P.shape(P.shape(v, g, false), g, true);
    for (let j = 0; j < P.N; j++) { near(back.r[j], v.r[j], 1e-12, 're'); near(back.i[j], v.i[j], 1e-12, 'im'); }
  }
  const deep = ones(); deep[1] = 0.01;
  const v = P.TONES[1], once = P.shape(P.shape(v, deep, false), deep, true);
  near(G.fidelity(once, v), (0.01 / P.EQ_FLOOR) ** 2, 1e-9, 'the floor caps the correction');
});
test('the tick: share observer ticks, then one calibrator tick', () => {
  for (let s = 1; s <= P.SHARE_MAX; s++) {
    const sch = P.schedule(s);
    assert.equal(sch.length, P.TICKS);
    assert.equal(sch.filter((x) => x === 'c').length, P.TICKS / (s + 1));
    assert.deepEqual(sch.slice(0, s + 1), Array(s).fill('o').concat(['c']));
  }
});
test('the shield vote: energy in frequencies read as faded', () => {
  const est = ones(); est[3] = 0.2;
  near(P.fadedShare(P.TONES[3], est), 1, 1e-12, 'all on the faded band');
  near(P.fadedShare(P.TONES[5], est), 0, 1e-12, 'none on it');
});
test('episodes: the observer finds a dark pattern on a clean channel and is fooled by a fade without help', () => {
  const S = (o) => P.sanitizeSettings(o);
  let found = 0, onFade = 0, held = 0, decl = 0, eqOn = 0, eqDecl = 0;
  for (let k = 0; k < 24; k++) {
    const w = Object.assign(P.world({ seed: 'episodes', gen: 0, e: 2 * (k % 4), depth: 0.9, kind: 'grid' }), {});
    w.fade = null;
    const ww = Object.assign({}, w, { pat: G.rvec(P.N, G.makeRng('pat' + k)), v0: G.rvec(P.N, G.makeRng('v0' + k)) });
    const ep = P.episode(ww, S({ share: 2, th: 0.6, eq: true, shield: true }));
    if (ep.out && ep.truth) found++;
  }
  assert.ok(found >= 20, 'clean channel finds ' + found);
  for (let k = 0; k < 24; k++) {
    const w = P.world({ seed: 'fooled' + k, gen: 0, e: 1, depth: 0.9, kind: 'grid' });
    w.fade = P.buildFade({ kind: 'grid', band: 1 + (k % 7), depth: 0.9, f: 0.5, ph: -Math.PI / 2 + 0.3 });   // deepest early in the episode
    const ep = P.episode(w, S({ share: 1, th: 0.5, eq: false, shield: true }));
    if (ep.declTick) { decl++; if (ep.onFade) { onFade++; if (ep.held) held++; } }
    assert.equal(ep.truth, false);
    const eq = P.episode(w, S({ share: 1, th: 0.5, eq: true, shield: false }));
    if (eq.declTick) { eqDecl++; if (eq.onFade) eqOn++; }
  }
  assert.ok(onFade >= 6, 'noise declarations on the fade: ' + onFade + ' of ' + decl);
  assert.ok(held >= onFade / 2, 'the shield holds most of them: ' + held);
  assert.ok(eqOn < onFade, 'the equalizer moves declarations off the fade: ' + eqOn + ' vs ' + onFade);
});
test('decisions: thresholds, shield rules, the oracle and the random baseline', () => {
  const w = P.world({ seed: 'decide', gen: 1, e: 0, depth: 0.9, kind: 'grid' });
  const tr = P.trajectory(w, 'eq', 2);
  let prev = 0;
  for (const th of [0.95, 0.8, 0.65, 0.5, 0.3]) {
    const d = P.decide(w, tr, th, 'none');
    const k = d.decl ? tr.checks.indexOf(d.check) + 1 : 99;
    if (prev) assert.ok(k <= prev, 'a lower threshold never declares later');
    prev = k;
    if (d.decl) { assert.ok(d.check.E >= th); assert.equal(d.out, true); }
    const c = P.decide(w, tr, th, 'cal');
    assert.equal(c.decl, d.decl);
    if (c.decl) { assert.equal(c.out, c.check.cal); assert.equal(c.held, !c.check.cal); }
  }
  // the oracle's exact inverse undoes the channel: with a fade, its observations equal the clean ones
  // (exact while the fade never removes more than 1 - EQ_FLOOR, i.e. depth <= 0.85)
  let tested = 0;
  for (let k = 0; k < 20; k++) {
    const wf = P.world({ seed: 'oracle' + k, gen: 0, e: 1, depth: 0.8, kind: k % 2 ? 'off' : 'grid', forceFade: true });
    if (wf.fade.depth > 1 - P.EQ_FLOOR) continue;
    tested++;
    const a = P.trajectory(wf, 'oracle', 2), b = P.trajectory(Object.assign({}, wf, { fade: null }), 'solo', 2);
    const md = Math.max(...Array.from(a.trace).map((x, i) => Math.abs(x - b.trace[i])));
    assert.ok(md < 1e-5, 'oracle trace equals the clean trace: ' + md);
  }
  assert.ok(tested >= 8, 'enough shallow fades: ' + tested);
  // the random baseline declares about half the time and is reproducible
  let n = 0;
  for (let e = 0; e < 200; e++) {
    const r1 = P.randomDecide(P.world({ seed: 'rand', gen: 0, e, depth: 0.8, kind: 'grid' }));
    const r2 = P.randomDecide(P.world({ seed: 'rand', gen: 0, e, depth: 0.8, kind: 'grid' }));
    assert.deepEqual(r1, r2);
    if (r1.decl) n++;
  }
  near(n / 200, 0.5, 0.1, 'random declares');
});
test('a seeded contest is reproducible and gives the golden numbers, on-grid and off-grid', () => {
  const play = (off) => {
    const c = P.createContest('golden');
    P.stepRound(c, P.startFor('golden'));
    while (!P.done(c)) P.stepRound(c, P.reference(off));
    return c;
  };
  const a = play(false), b = play(false), s = P.summarize(a.hist), so = P.summarize(play(true).hist);
  assert.deepEqual(a.hist.map((h) => [h.outT, h.outF, h.held, h.missed]), b.hist.map((h) => [h.outT, h.outF, h.held, h.missed]));
  assert.deepEqual(P.startFor('golden'), { share: 1, th: 0.65, eq: false, shield: false, off: false });
  assert.deepEqual(P.depthsFor('golden'), [0.83, 0.75, 0.64, 0.62, 0.66, 0.78, 0.88, 0.94, 0.98, 0.91, 0.81, 0.7]);
  assert.equal(s.score.toFixed(4), '83.7364');
  assert.deepEqual([s.T, s.F, s.missed], [41, 1, 7]);
  assert.equal(so.score.toFixed(4), '70.4179');
  assert.deepEqual([so.T, so.F, so.missed], [37, 5, 11]);
  assert.deepEqual(P.reference(true), { share: 2, th: P.TUNED.off, eq: true, shield: true, off: true });
  assert.throws(() => P.stepRound(a, P.DEFAULTS), /finished/);
});
test('starting controls and the darkness tide stay in range for many seeds', () => {
  for (let k = 0; k < 200; k++) {
    const s = P.startFor('s' + k), d = P.depthsFor('s' + k);
    assert.equal(s.share, 1); assert.equal(s.eq, false); assert.equal(s.shield, false);
    assert.ok(s.th >= 0.45 && s.th <= 0.75 && Math.abs(s.th * 20 - Math.round(s.th * 20)) < 1e-9, String(s.th));
    assert.equal(d.length, P.ROUNDS);
    assert.ok(d.every((x) => x >= 0.6 && x <= 1));
  }
});
test('settings are clamped and hostile input falls back to defaults', () => {
  assert.deepEqual(P.sanitizeSettings(null), P.DEFAULTS);
  assert.deepEqual(P.sanitizeSettings({ share: 99, th: -5, eq: 0, shield: 'yes', off: 1 }), { share: P.SHARE_MAX, th: 0.2, eq: false, shield: true, off: true });
  assert.deepEqual(P.sanitizeSettings({ share: 'x', th: NaN }), P.DEFAULTS);
  assert.equal(P.sanitizeSettings({ share: 2.6 }).share, 3);
  assert.deepEqual(P.DEFAULTS, P.reference(false));
});
test('the calibration check: clean error matches the prediction, faded error grows with the share, for both fade kinds', () => {
  for (const off of [false, true]) {
    const rows = P.calibrationCheck('unit', 24, off);
    assert.equal(rows.length, P.SHARE_MAX);
    rows.forEach((r) => near(r.cleanErr, P.PRED_ERR, 0.006, 'clean ' + r.share + (off ? ' off' : ' grid')));
    assert.ok(rows[P.SHARE_MAX - 1].fadeErr > rows[0].fadeErr * 1.4, rows.map((r) => r.fadeErr.toFixed(3)).join(' '));
    assert.deepEqual(rows.map((r) => r.obsTicks + r.calTicks), [120, 120, 120, 120]);
  }
});
test('score card: short lines in both languages, with the tick pattern', () => {
  const c = P.createContest('card');
  while (!P.done(c)) P.stepRound(c, { share: 3, th: 0.7, eq: true, shield: true });
  for (const lang of ['en', 'fr']) {
    const txt = P.shareText({ seed: 'card', result: P.summarize(c.hist), settings: c.hist[11].settings }, (k, v) => G.fmt(L[lang][k], v));
    txt.split('\n').forEach((line) => assert.ok(line.length <= 80, line));
    assert.ok(txt.includes('oooC'));
  }
  assert.ok(t('share.setup', { share: 3, th: '0.70', eq: 'on', sh: 'on' }).startsWith('Last setup: 3 : 1'));
});
test('hash links reuse the reverse page rules', () => {
  assert.equal(P.buildHash({ seed: 'p2026-10-25', lang: 'fr' }), '#s=p2026-10-25&l=fr');
  assert.deepEqual(P.parseHash('#s=p2026-10-25&l=fr'), { seed: 'p2026-10-25', lang: 'fr' });
  assert.ok(!P.parseHash('#s=<bad>').seed);
  assert.equal(P.dailySeed('2026-10-25'), 'p2026-10-25');
});
