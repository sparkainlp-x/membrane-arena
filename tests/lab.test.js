'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const ST = require('../stats.js');
const L = require('../lab.js');

const contests = {};
function run(seed, o) {
  const key = seed + JSON.stringify(o || {});
  if (contests[key]) return contests[key];
  const s = Object.assign({}, G.DEFAULTS, o || {});
  const c = G.createContest(seed, s);
  while (!G.done(c)) G.stepGeneration(c, s);
  return (contests[key] = { c, s });
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
function drain(ens, budget, clock) { let r; do { r = ens.step(budget, clock); } while (!r.done); return r; }

test('rate series: cumulative episode counts agree with the records, Wilson bands bracket the estimate', () => {
  const { c } = run('lab-rate', { shield: true });
  const ser = L.rateSeries(c.hist);
  assert.equal(ser.length, G.GENS);
  ser.forEach((r, k) => {
    assert.equal(r.planted, 4 * (k + 1)); assert.equal(r.episodes, 8 * (k + 1));
    assert.ok(r.tr.lo <= r.tr.p + 1e-12 && r.tr.p <= r.tr.hi + 1e-12 && r.fr.lo <= r.fr.p + 1e-12 && r.fr.p <= r.fr.hi + 1e-12);
    assert.equal(r.tr.n, r.planted); assert.equal(r.fr.n, r.episodes);
    if (k) assert.ok(ser[k].trueEp >= ser[k - 1].trueEp && ser[k].falseEp >= ser[k - 1].falseEp);
  });
  let tEp = 0; c.hist.forEach((h) => h.episodes.forEach((e) => { if (e.evT > 0) tEp++; }));
  assert.equal(ser[ser.length - 1].trueEp, tEp);
  assert.ok(ser[ser.length - 1].tr.hi - ser[ser.length - 1].tr.lo < ser[0].tr.hi - ser[0].tr.lo, 'the band narrows with more episodes');
  assert.deepEqual(L.rateSeries([]), []);
});

test('alignment: shape, range, and the weight vectors move toward the signal during planted episodes', () => {
  const { c } = run('lab-align', { shield: true });
  const al = L.alignment(c.hist, 3);
  assert.equal(al.n, 4); assert.equal(al.steps, G.STEPS); assert.equal(al.gen, 4);
  for (let i = 0; i < 3; i++) {
    assert.equal(al.mean[i].length, G.STEPS);
    al.mean[i].forEach((v) => assert.ok(v >= 0 && v <= 1.0001));
    assert.ok(al.mean[i][G.STEPS - 1] > al.mean[i][0], `agent ${i} aligns over the episode`);
    assert.ok(al.sd[i].every((v) => v >= 0));
  }
  assert.equal(L.alignment(c.hist, 99), null);
});

test('probe: deterministic, uses the contest parameters, and planted episodes score higher than noise', () => {
  const { c, s } = run('lab-probe', { shield: true });
  const a = L.probe(c, s, 30), b = L.probe(c, s, 30);
  assert.deepEqual(a.samples.map((x) => x.chk), b.samples.map((x) => x.chk));
  assert.equal(a.samples.length, 90);
  assert.equal(a.samples.filter((x) => x.planted).length, 45);
  a.samples.forEach((x) => assert.equal(x.chk.length, G.STEPS / G.CHECK));
  const mean = (arr) => ST.mean(arr.map(L.decisionStat));
  assert.ok(mean(a.samples.filter((x) => x.planted)) > mean(a.samples.filter((x) => !x.planted)) + 1);
  const h = L.ratioHistogram(a);
  assert.equal(h.planted.reduce((x, y) => x + y, 0), 45); assert.equal(h.noise.reduce((x, y) => x + y, 0), 45);
  a.thr.forEach((t) => assert.ok(t < h.hi));
  const c2 = G.createContest('lab-probe-other', s); G.stepGeneration(c2, s);
  assert.notDeepEqual(L.probe(c2, s, 6).samples[0].chk, a.samples[0].chk);
});

test('probe does not disturb the contest it reads', () => {
  const s = Object.assign({}, G.DEFAULTS), c = G.createContest('lab-undisturbed', s);
  G.stepGeneration(c, s); G.stepGeneration(c, s);
  const before = JSON.stringify([c.par, c.rateEma, c.gen, c.best]);
  L.probe(c, s, 12);
  assert.equal(JSON.stringify([c.par, c.rateEma, c.gen, c.best]), before);
  const t1 = G.stepGeneration(c, s);
  const c2 = G.createContest('lab-undisturbed', s); G.stepGeneration(c2, s); G.stepGeneration(c2, s);
  const t2 = G.stepGeneration(c2, s);
  assert.equal(t1.outT, t2.outT); assert.equal(t1.outF, t2.outF);
});

test('threshold sweep: the number of declarations never rises with the threshold; atThreshold agrees with a sweep point', () => {
  const { c, s } = run('lab-sweep', { shield: true });
  const pr = L.probe(c, s, 40), sw = L.sweep(pr, 30);
  for (let k = 1; k < sw.points.length; k++) {
    // recall itself can rise at low thresholds: an early crossing happens before the vector has aligned, so it counts as false
    assert.ok(sw.points[k].tp + sw.points[k].fp <= sw.points[k - 1].tp + sw.points[k - 1].fp);
    assert.ok(sw.points[k].th > sw.points[k - 1].th);
  }
  const p = sw.points[10], at = L.atThreshold(pr, p.th);
  assert.equal(at.tp, p.tp); assert.equal(at.fp, p.fp);
  assert.ok(p.recallCI.lo <= p.recall && p.recall <= p.recallCI.hi);
  assert.equal(sw.nAll, 120); assert.equal(sw.nPlanted, 60);
  assert.ok(sw.points[0].falseRate > sw.points[sw.points.length - 1].falseRate);
  const last = sw.points[sw.points.length - 1];
  assert.ok(last.tp + last.fp <= sw.points[0].tp + sw.points[0].fp);
});

test('shield counts: every declaration is passed, held or redundant, and the passed ones equal the outputs', () => {
  for (const shield of [true, false]) {
    const { c } = run('lab-shield', { shield });
    const sc = L.shieldCounts(c.hist), x = sc.total, sum = G.summarize(c.hist);
    assert.equal(x.declared, x.passed + x.held + x.redundant);
    assert.equal(x.trueDeclared + x.falseDeclared, x.declared);
    assert.equal(x.truePassed, sum.T); assert.equal(x.falsePassed, sum.F);
    assert.equal(x.trueDeclared, x.truePassed + x.trueHeld + x.trueRedundant);
    assert.equal(x.falseDeclared, x.falsePassed + x.falseHeld + x.falseRedundant);
    if (!shield) { assert.equal(x.passed, x.declared); assert.equal(x.held + x.redundant, 0); }
    else assert.ok(x.passed < x.declared);
    assert.equal(sc.gens.length, G.GENS);
  }
});

test('shield: held declarations are mostly false, so the shield removes false events more than true ones (single seed, descriptive)', () => {
  const { c } = run('lab-shield2', { shield: true });
  const x = L.shieldCounts(c.hist).total;
  assert.ok(x.falseHeld / Math.max(1, x.falseDeclared) >= x.trueHeld / Math.max(1, x.trueDeclared));
});

test('gain trace: without the stabilizer the effective gain is the evolved gain; with it the bounds are reported', () => {
  const off = run('lab-gain', { stab: false }).c, on = run('lab-gain', { stab: true }).c;
  const g0 = L.gainTrace(off.hist), g1 = L.gainTrace(on.hist);
  assert.equal(g0.x.length, G.GENS * G.EP); assert.equal(g0.rate.length, G.GENS * G.EP);
  assert.equal(g0.stab, false); assert.equal(g1.stab, true);
  assert.equal(g0.min, G.GAIN_MIN); assert.equal(g0.max, G.GAIN_MAX); assert.equal(g0.target, 0.5);
  off.hist.forEach((h, k) => h.episodes.forEach((e, j) => e.geff.forEach((v, i) => assert.equal(g0.geff[i][k * G.EP + j], v))));
  g1.geff.forEach((a) => a.forEach((v) => assert.ok(v > 0)));
  g1.rate.forEach((v) => assert.ok(v >= 0 && v <= 1));
});

test('landscape: three trials per generation, accepted count matches the records', () => {
  const { c } = run('lab-land', {});
  const ls = L.landscape(c.hist);
  assert.equal(ls.trials, 3 * G.GENS);
  assert.equal(ls.accepted, c.hist.reduce((n, h) => n + h.accepted.filter(Boolean).length, 0));
  ls.points.forEach((p) => { assert.ok(p.th > 0 && p.c >= 0 && p.g > 0 && isFinite(p.score)); });
  assert.equal(ls.points.filter((p) => p.mutated).length, 3 * (G.GENS - 1));
});

test('amplifier baseline: the measured difference is read from the repository table and is about zero', () => {
  const ab = L.ampBaseline();
  assert.equal(ab.rows.length, 3);
  assert.equal(ab.file, 'results/contest_w32-128_summary.csv');
  ab.rows.forEach((r) => {
    assert.equal(r.off.cfg, 'S--'); assert.equal(r.on.cfg, 'SA-');
    assert.ok(Math.abs(r.dP) <= 0.005, `dP ${r.dP}`);
    near(r.dT, r.on.T - r.off.T, 1e-12);
  });
  assert.equal(ab.maxDeltaP, G.baselines.LESSON.ampMaxDeltaP);
  assert.ok(Math.max(...ab.rows.map((r) => Math.abs(r.dP))) <= ab.maxDeltaP + 1e-9);
});

test('ensemble: time slicing does not change a result, and equals running each seed straight through', () => {
  const s = L.matchRepository(Object.assign({}, G.DEFAULTS, { shield: true }));
  const a = L.createEnsemble({ settings: s, n: 4, repoStart: true }), b = L.createEnsemble({ settings: s, n: 4, repoStart: true });
  drain(a, 1000); drain(b, 0.001, (() => { let t = 0; return () => (t += 1); })());
  assert.deepEqual(a.results(), b.results());
  assert.equal(a.results().length, 4);
  const direct = L.runOne('e2', s, true);
  assert.deepEqual(a.results()[1], direct);
  assert.deepEqual(a.results().map((r) => r.seed), ['e1', 'e2', 'e3', 'e4']);
});

test('ensemble: progress is monotone, cancel stops it, and n is bounded', () => {
  const e = L.createEnsemble({ settings: G.DEFAULTS, n: 3 });
  let last = -1, r, tick = 0;
  do { r = e.step(1, () => (tick += 5)); assert.ok(r.progress >= last); last = r.progress; } while (!r.done);
  assert.equal(last, 1);
  const c = L.createEnsemble({ settings: G.DEFAULTS, n: 50 });
  let tk = 0; c.step(1, () => (tk += 3)); c.cancel();
  assert.equal(c.step(50).done, true);
  assert.ok(c.results().length < 50);
  assert.equal(L.createEnsemble({ settings: G.DEFAULTS, n: 9999 }).state().n, 200);
  assert.equal(L.createEnsemble({ settings: G.DEFAULTS, n: 0 }).state().n, 1);
});

test('ensemble summary: intervals come from the stats toolkit, baseline carries its file, like-for-like needs the repository setup', () => {
  const s = L.matchRepository(Object.assign({}, G.DEFAULTS, { shield: true }));
  const e = L.createEnsemble({ settings: s, n: 8, repoStart: true }); drain(e, 1000);
  const sum = L.summarizeEnsemble(e.results(), s, true);
  assert.equal(sum.n, 8);
  assert.deepEqual(sum.metrics.T.t, ST.tCI(e.results().map((r) => r.T)));
  assert.ok(sum.metrics.F.boot.lo <= sum.metrics.F.boot.hi);
  assert.equal(sum.like, true);
  assert.equal(sum.baseline.file, 'results/contest_w32-128_summary.csv');
  assert.equal(sum.baseline.tag, 'S--');
  near(sum.baseline.T.mean, 42.15, 1e-9);
  near(sum.baseline.T.hi - sum.baseline.T.mean, ST.tCrit95(19) * 3.528 / Math.sqrt(20), 1e-9);
  const ag = L.agreementWithBaseline(sum);
  assert.equal(ag.of, 3); assert.ok(ag.count >= 0 && ag.count <= 3);
  assert.equal(L.likeForLike(s, false), false);
  assert.equal(L.likeForLike(Object.assign({}, s, { scheme: 'consensus' }), true), false);
  assert.equal(L.likeForLike(Object.assign({}, s, { fcost: 0.5 }), true), false);
  assert.equal(L.likeForLike(Object.assign({}, s, { evolve: false }), true), false);
  const m = L.matchRepository({ scheme: 'team', fcost: 1, evolve: false, shield: true });
  assert.equal(m.scheme, 'random'); assert.equal(m.fcost, 0); assert.equal(m.evolve, true);
});

test('ensemble at the repository setup reproduces the repository means within sampling error (width 32, shield on)', () => {
  const s = L.matchRepository(Object.assign({}, G.DEFAULTS, { shield: true }));
  const e = L.createEnsemble({ settings: s, n: 40, repoStart: true }); drain(e, 1000);
  const sum = L.summarizeEnsemble(e.results(), s, true), ag = L.agreementWithBaseline(sum);
  assert.ok(ag.count >= 2, `agreement ${JSON.stringify(ag.per)}`);
});

test('paired runs: both arms use the same seeds; identical arms give zero difference; the shield cuts false outputs', () => {
  const base = Object.assign({}, G.DEFAULTS, { shield: true, scheme: 'random' });
  const same = L.createPaired({ settings: base, factor: 'amp', a: false, b: false, n: 4, repoStart: true }); drain(same, 1000);
  const sa = L.summarizePaired(same.a.results(), same.b.results());
  assert.deepEqual(same.a.results().map((r) => r.seed), same.b.results().map((r) => r.seed));
  sa.metrics.score.diff.diffs.forEach((d) => assert.equal(d, 0));
  assert.equal(sa.metrics.score.diff.excludesZero, false);
  const sh = L.createPaired({ settings: base, factor: 'shield', a: true, b: false, n: 14, repoStart: true }); drain(sh, 1000);
  const ss = L.summarizePaired(sh.a.results(), sh.b.results());
  assert.equal(ss.n, 14);
  assert.ok(ss.metrics.F.diff.excludesZero && ss.metrics.F.diff.mean < 0, `shield F diff ${ss.metrics.F.diff.mean}`);
  assert.ok(ss.metrics.F.diff.boot.hi < 0);
});

test('applyFactor changes only the named factor and rejects unknown ones', () => {
  const s = L.applyFactor(G.DEFAULTS, 'scheme', 'team');
  assert.equal(s.scheme, 'team'); assert.equal(s.shield, G.DEFAULTS.shield);
  assert.equal(L.applyFactor(G.DEFAULTS, 'w', 0.75).w, 0.75);
  assert.equal(L.applyFactor(G.DEFAULTS, 'stab', true).stab, true);
  assert.throws(() => L.applyFactor(G.DEFAULTS, 'th', 1));
  assert.equal(L.applyFactor(G.DEFAULTS, 'scheme', 'nonsense').scheme, G.DEFAULTS.scheme);
});

test('missions: the required experiment must have been run, and the outcome follows the interval', () => {
  const mk = (diffs, extra) => ({ n: diffs.length, metrics: Object.fromEntries(['T', 'F', 'precision', 'rateVar', 'score'].map((k) => [k, { diff: ST.paired(diffs.map((d) => d + 100), diffs.map(() => 100)) }])) });
  const neg = Array.from({ length: 24 }, (_, k) => -3 - (k % 3)), zero = Array.from({ length: 24 }, (_, k) => (k % 2 ? 1 : -1) * 0.5);
  const meta = { factor: 'shield', a: true, b: false };
  assert.equal(L.evaluateMission('shield', { meta, summary: mk(neg) }).outcome, 'reproduced');
  assert.equal(L.evaluateMission('shield', { meta, summary: mk(zero) }).outcome, 'not_reproduced');
  assert.equal(L.evaluateMission('shield', { meta: { factor: 'amp', a: true, b: false }, summary: mk(neg) }).counts, false);
  assert.equal(L.evaluateMission('shield', { meta, summary: mk(neg.slice(0, 5)) }).counts, false);
  assert.equal(L.evaluateMission('amp', { meta: { factor: 'amp', a: true, b: false }, summary: mk(zero) }).outcome, 'no_effect');
  assert.equal(L.evaluateMission('amp', { meta: { factor: 'amp', a: true, b: false }, summary: mk(neg) }).outcome, 'detected');
  const pos = Array.from({ length: 24 }, (_, k) => 3 + (k % 3));
  assert.equal(L.evaluateMission('individual', { meta: { factor: 'scheme', a: 'consensus', b: 'individual' }, summary: mk(pos) }).outcome, 'found');
  assert.equal(L.evaluateMission('individual', { meta: { factor: 'scheme', a: 'consensus', b: 'individual' }, summary: mk(zero) }).outcome, 'not_found');
  assert.equal(L.evaluateMission('play', { result: { score: 80 }, ref: 70 }).outcome, 'beat');
  assert.equal(L.evaluateMission('play', { result: { score: 60 }, ref: 70 }).outcome, 'below');
  assert.equal(L.evaluateMission('play', { result: { score: 60 }, ref: null }).counts, false);
  assert.equal(L.evaluateMission('nope', {}), null);
  assert.equal(L.MISSIONS.length, 5);
});

test('CSV and JSON export: rectangular, quoted correctly, labelled SYNTHETIC, with the baseline file', () => {
  const { c } = run('lab-export', { shield: true });
  const csv = L.runCSV(c.hist).trim().split('\n');
  assert.equal(csv.length, G.GENS + 1);
  const w = csv[0].split(',').length;
  csv.forEach((ln) => assert.equal(ln.split(',').length, w));
  assert.equal(L.toCSV(['a', 'b'], [['x,y', 'he said "hi"'], [1.23456789, null]]), 'a,b\n"x,y","he said ""hi"""\n1.234568,\n');
  const s = L.matchRepository(Object.assign({}, G.DEFAULTS, { shield: true }));
  const e = L.createEnsemble({ settings: s, n: 3, repoStart: true }); drain(e, 1000);
  const sum = L.summarizeEnsemble(e.results(), s, true);
  assert.equal(L.ensembleCSV(e.results()).trim().split('\n').length, 4);
  const j = JSON.parse(L.ensembleJSON(e.results(), sum, s, true));
  assert.match(j.meta.label, /SYNTHETIC/); assert.equal(j.meta.baselines.file, 'results/contest_w32-128_summary.csv');
  assert.equal(j.results.length, 3); assert.equal(j.meta.likeForLikeWithRepository, true);
  const pm = L.createPaired({ settings: s, factor: 'amp', a: true, b: false, n: 3, repoStart: true }); drain(pm, 1000);
  const ps = L.summarizePaired(pm.a.results(), pm.b.results());
  assert.equal(L.pairedCSV(pm.a.results(), pm.b.results()).trim().split('\n').length, 4);
  const pj = JSON.parse(L.pairedJSON(pm.meta, ps, s));
  assert.equal(pj.meta.factor, 'amp'); assert.match(pj.meta.note, /exploratory/);
  const rj = JSON.parse(L.runJSON(c, { mode: 'practice' }));
  assert.equal(rj.generations.length, G.GENS); assert.match(rj.meta.label, /SYNTHETIC/);
  assert.equal(rj.summary.T, G.summarize(c.hist).T);
});

test('text equivalents: every chart has one, in both languages, with every placeholder filled and no NaN', () => {
  const I = require('../i18n.js');
  const s = Object.assign({}, G.DEFAULTS, { shield: true, stab: true });
  const { c } = run('lab-alt', { shield: true, stab: true });
  const pr = L.probe(c, s, 12), sw = L.sweep(pr, 20), cur = L.atThreshold(pr, pr.thr[0]);
  const e = L.createEnsemble({ settings: L.matchRepository({ shield: true }), n: 3, repoStart: true }); drain(e, 1000);
  const es = L.matchRepository({ shield: true }), sum = L.summarizeEnsemble(e.results(), es, true);
  const pm = L.createPaired({ settings: es, factor: 'amp', a: true, b: false, n: 3, repoStart: true }); drain(pm, 1000);
  const ps = L.summarizePaired(pm.a.results(), pm.b.results());
  for (const lang of ['en', 'fr']) {
    const t = I.make(lang);
    const texts = {
      rates: L.describeRates(t, L.rateSeries(c.hist)), align: L.describeAlignment(t, L.alignment(c.hist, 5)), hist: L.describeHist(t, L.ratioHistogram(pr)),
      sweep: L.describeSweep(t, sw, cur), shield: L.describeShield(t, L.shieldCounts(c.hist)), gain: L.describeGain(t, L.gainTrace(c.hist)),
      land: L.describeLandscape(t, L.landscape(c.hist)), amp: L.describeAmp(t, L.ampBaseline()), ens: L.describeEnsemble(t, sum),
      ab: L.describePaired(t, ps, pm.meta, { a: 'on', b: 'off' })
    };
    Object.entries(texts).forEach(([k, v]) => {
      assert.ok(v.length > 30, `${lang} ${k} too short`);
      assert.ok(!/[{}]|NaN|undefined|Infinity/.test(v), `${lang} ${k}: ${v}`);
    });
    assert.equal(L.describeRates(t, []), t('alt.empty'));
    assert.equal(L.describeAlignment(t, null), t('alt.empty'));
    const off = run('lab-alt-off', { shield: false });
    assert.match(L.describeGain(t, L.gainTrace(off.c.hist)), lang === 'en' ? /Stabilizer off/ : /Stabilisateur coupé/);
    assert.equal(L.describeShield(t, L.shieldCounts([])), t('alt.shield_none'));
  }
});

test('the amplifier text equivalent states the repository file and the near-zero measurement', () => {
  const I = require('../i18n.js');
  const txt = L.describeAmp(I.make('en'), L.ampBaseline());
  assert.match(txt, /results\/contest_w32-128_summary\.csv/);
  assert.match(txt, /0\.00\d/);
});
