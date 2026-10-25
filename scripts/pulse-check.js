#!/usr/bin/env node
/*
 * Membrane Arena: the Wave Pulse evaluation (SYNTHETIC game on a classical simulation), as frozen in
 * docs/PULSE-PROTOCOL.md.
 *
 *   node scripts/pulse-check.js            print the report
 *   node scripts/pulse-check.js --write    also write pulse-calib.js, docs/pulse-check.txt,
 *                                          docs/pulse-results.json, docs/pulse-results.csv and
 *                                          docs/pulse-manifest.json
 *   node scripts/pulse-check.js --verify   recompute and compare with the written files (exit 1 on any difference)
 *
 * The detector threshold k, the locator speed c and the region size rho are chosen on the calibration
 * pulses only and frozen; only then are the held-out pulses scored, each in all 16 settings. Every
 * held-out mean has a 95% percentile bootstrap interval over pulses; every comparison is paired by
 * pulse, with d_z, win/tie/loss counts and, for the six confirmatory hypotheses, a sign-flip
 * permutation p-value with Holm's adjustment.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const P = require('../pulse.js');
// The evaluation is the one frozen and published with v0.3.4. Later releases re-verify it unchanged, so
// its outputs keep that version; pulse.js and the protocol are not changed after it.
const EVAL_VERSION = '0.3.4';
const G = require('../game.js');

const SMOKE = !!process.env.PULSE_SMOKE;
const pad = (k) => String(k).padStart(3, '0');
const CAL = SMOKE ? Array.from({ length: 16 }, (_, k) => 'psmoke-c' + k) : Array.from({ length: 200 }, (_, k) => 'pcal-' + pad(k));
const TEST = SMOKE ? Array.from({ length: 6 }, (_, k) => 'psmoke-t' + k) : Array.from({ length: 200 }, (_, k) => 'ptest-' + pad(k));
const K_GRID = [4, 5, 6, 7, 8, 10];
const C_GRID = Array.from({ length: 9 }, (_, i) => Math.round((0.44 + 0.02 * i) * 100) / 100);
const RHO_Q = 0.9;
const METHODS = ['locator', 'early', 'nearest', 'center', 'random', 'noiseFree'];
const LABEL = { locator: 'locator', early: 'early-sensor avg', nearest: 'nearest sensor', center: 'centre', random: 'random', noiseFree: 'noise-free traces' };
const BOOT = 2000, BOOT_SEED = 'pulse-bootstrap', PERM = 10000, PERM_SEED = 'pulse-permutation', TIE = 0.01;
const DEFAULT = P.settingId(P.DEFAULT_SETTING);
const sid = (kind, sensors, noise, floor) => P.settingId({ kind, sensors, noise, floor });
const HYP = [
  { id: 'H1', text: 'default: centre error - locator error', a: [DEFAULT, 'center'], b: [DEFAULT, 'locator'] },
  { id: 'H2', text: 'default: early-sensor average error - locator error', a: [DEFAULT, 'early'], b: [DEFAULT, 'locator'] },
  { id: 'H3', text: 'locator: patchy floor - even floor (win, 8, calm)', a: [sid('win', 8, 'calm', 'patchy'), 'locator'], b: [DEFAULT, 'locator'] },
  { id: 'H4', text: 'locator: loud - calm (win, 8, even)', a: [sid('win', 8, 'loud', 'even'), 'locator'], b: [DEFAULT, 'locator'] },
  { id: 'H5', text: 'locator: 4 sensors - 8 sensors (win, calm, even)', a: [sid('win', 4, 'calm', 'even'), 'locator'], b: [DEFAULT, 'locator'] },
  { id: 'H6', text: 'locator: crowd cheer - big win (8, calm, even)', a: [sid('cheer', 8, 'calm', 'even'), 'locator'], b: [DEFAULT, 'locator'] }
];

/* ---------------- statistics ---------------- */
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };
function quantile(sorted, q) { const h = (sorted.length - 1) * q, lo = Math.floor(h); return sorted[lo] + (h - lo) * (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]); }
// one shared set of resampled pulse indices, so every interval resamples the same pulses
function bootIndex(n) { const rng = G.makeRng(BOOT_SEED); return Array.from({ length: BOOT }, () => Array.from({ length: n }, () => Math.floor(rng() * n))); }
function ci(stat, idx) { const v = idx.map(stat).sort((a, b) => a - b); return [quantile(v, 0.025), quantile(v, 0.975)]; }
function meanCI(vals, idx) { return { mean: mean(vals), ci: ci((ix) => ix.reduce((s, i) => s + vals[i], 0) / ix.length, idx) }; }
function paired(a, b, idx) {
  const d = a.map((x, i) => x - b[i]), m = meanCI(d, idx), s = sd(d);
  return { mean: m.mean, ci: m.ci, dz: s > 0 ? m.mean / s : 0, wins: d.filter((x) => x >= TIE).length,
    ties: d.filter((x) => Math.abs(x) < TIE).length, losses: d.filter((x) => x <= -TIE).length };
}
// two-sided paired sign-flip permutation test on the mean difference
function permP(d) {
  const rng = G.makeRng(PERM_SEED), obs = Math.abs(mean(d)), n = d.length;
  let ge = 0;
  for (let r = 0; r < PERM; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rng() < 0.5 ? d[i] : -d[i];
    if (Math.abs(s / n) >= obs - 1e-12) ge++;
  }
  return (ge + 1) / (PERM + 1);
}
function holm(ps) {
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), adj = new Array(ps.length);
  let run = 0;
  order.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (ps.length - r) * p)); adj[i] = run; });
  return adj;
}
function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function verdict(c) { return c.ci[0] > 0 ? 'higher' : c.ci[1] < 0 ? 'lower' : 'not detectable'; }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/* ---------------- simulation helpers ---------------- */
// the four simulations a seed needs (kind x floor) and its noise streams
function simsFor(seed) {
  const sp = P.spec(seed), sims = {};
  for (const kind of ['win', 'cheer']) for (const floor of ['even', 'patchy']) sims[kind + '/' + floor] = P.simulate(sp, kind, floor, false);
  return { sp, sims, z: P.noiseStreams(seed) };
}

/* ---------------- 1. calibration (calibration pulses only) ---------------- */
function calibrate() {
  const pool = CAL.map((seed, i) => {
    const setting = P.SETTINGS[i % 16], sp = P.spec(seed), sim = P.simulate(sp, setting.kind, setting.floor, false);
    const z = P.noiseStreams(seed), idx = P.SENSOR_SETS[setting.sensors], sigma = P.NOISE[setting.noise];
    const traces = idx.map((k) => P.noisy(sim.clean[k], z[k], sigma));
    return { seed, setting, idx, traces, target: P.target(sp, setting.kind) };
  });
  const grid = [];
  let best = null;
  for (const k of K_GRID) {
    const arr = pool.map((p) => p.traces.map((tr) => P.detect(tr, k)));
    for (const c of C_GRID) {
      const errs = pool.map((p, j) => { const l = P.locate(p.idx, arr[j], c); return P.dist([l.x, l.y], p.target); });
      const m = mean(errs);
      grid.push({ k, c, meanErr: m });
      if (!best || m < best.meanErr) best = { k, c, meanErr: m };   // ascending k then c: ties keep the smaller
    }
  }
  const gaps = [];
  let fallbacks = 0;
  for (const p of pool) {
    const arr = p.traces.map((tr) => P.detect(tr, best.k)), l = P.locate(p.idx, arr, best.c);
    if (l.fallback) { fallbacks++; continue; }
    const u = { pos: [], arr: [] };
    p.idx.forEach((s, j) => { if (arr[j] >= 0) { u.pos.push(P.SENSORS[s]); u.arr.push(arr[j]); } });
    gaps.push(P.costAt(u.pos, u.arr, best.c, p.target[0], p.target[1]) - l.cost);
  }
  gaps.sort((a, b) => a - b);
  const rho = Math.round(quantile(gaps, RHO_Q) * 1000) / 1000;
  return { k: best.k, c: best.c, rho, calMeanErr: best.meanErr, grid, pulses: pool.length, rhoFallbacks: fallbacks, rhoQuantile: RHO_Q };
}

/* ---------------- 2. held-out evaluation ---------------- */
function evaluate(cal) {
  const rows = [];        // one per pulse x setting
  const speed = [];       // per pulse: [{cls, d, t}] for the speed check
  for (const seed of TEST) {
    const { sp, sims, z } = simsFor(seed);
    for (const setting of P.SETTINGS) {
      const sim = sims[setting.kind + '/' + setting.floor];
      const a = P.analyze(seed, setting, cal, sim, z);
      const reg = P.region(a.sensors, a.arrivals, cal.c, cal.rho, a.loc);
      // exploratory, added after the protocol: the noise-free reference with the noisy detector's
      // average threshold (smoothing divides the noise SD by sqrt 3)
      const sigma = P.NOISE[setting.noise];
      const nf2arr = a.sensors.map((k) => P.detectClean(sim.clean[k], cal.k * sigma / Math.sqrt(3)));
      const nf2 = P.locate(a.sensors, nf2arr, cal.c);
      rows.push({ seed, setting: P.settingId(setting), err: a.err, nf2: P.dist([nf2.x, nf2.y], a.target),
        covered: a.covered, area: reg.area, missed: a.missed, fallback: a.loc.fallback, n: a.sensors.length });
    }
    // speed check: even floor, big win, noise-free arrivals at all 8 sensors, start tick known (PRE)
    const sim = sims['win/even'], pts = [];
    P.SENSORS.forEach((s, k) => {
      const t = P.detectClean(sim.clean[k], cal.k * P.NOISE.calm);
      if (t < 0) return;
      const dx = s[0] - sp.x, dy = s[1] - sp.y, ang = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2);
      const off = Math.min(ang, Math.PI / 2 - ang);          // 0 along an axis, pi/4 on a diagonal
      pts.push({ cls: off <= Math.PI / 8 ? 'axis' : 'diagonal', d: Math.hypot(dx, dy), t: t - P.PRE });
    });
    speed.push(pts);
  }
  return { rows, speed };
}
function slope(pts) {   // least-squares slope of distance against arrival tick
  const n = pts.length, mt = mean(pts.map((p) => p.t)), md = mean(pts.map((p) => p.d));
  let num = 0, den = 0;
  for (const p of pts) { num += (p.t - mt) * (p.d - md); den += (p.t - mt) * (p.t - mt); }
  return den > 0 ? num / den : NaN;
}

/* ---------------- main ---------------- */
function main() {
  const write = process.argv.includes('--write'), verify = process.argv.includes('--verify');
  if (SMOKE && (write || verify)) { console.error('PULSE_SMOKE runs cannot write or verify'); process.exit(2); }
  const t0 = Date.now();
  const protocolSha = sha(fs.readFileSync(path.join(ROOT, 'docs/PULSE-PROTOCOL.md'), 'utf8'));
  const cal = calibrate();
  const frozen = { k: cal.k, c: cal.c, rho: cal.rho, calibrated: true };
  const ev = evaluate(frozen);
  const n = TEST.length, idx = bootIndex(n);
  const bySetting = {};
  for (const r of ev.rows) (bySetting[r.setting] = bySetting[r.setting] || []).push(r);
  const errOf = (setting, m) => bySetting[setting].map((r) => (m === 'noiseFree2' ? r.nf2 : r.err[m]));

  // per-setting summary for every method
  const summary = {};
  for (const s of P.SETTINGS) {
    const id = P.settingId(s), rs = bySetting[id], out = { methods: {} };
    for (const m of METHODS.concat(['noiseFree2'])) {
      const e = errOf(id, m), hits = e.filter((x) => x <= P.HIT).length;
      out.methods[m] = { err: meanCI(e, idx), median: quantile(e.slice().sort((a, b) => a - b), 0.5),
        hit: { rate: hits / n, ci: wilson(hits, n) }, points: meanCI(e.map(P.points), idx) };
    }
    const cov = rs.filter((r) => r.covered).length, sensorsMissed = rs.reduce((t, r) => t + r.missed, 0);
    out.coverage = { rate: cov / n, ci: wilson(cov, n), calibrated: wilson(cov, n)[0] <= 0.9 && wilson(cov, n)[1] >= 0.9 };
    out.area = meanCI(rs.map((r) => r.area), idx);
    out.missed = { rate: sensorsMissed / (n * rs[0].n), ci: wilson(sensorsMissed, n * rs[0].n) };
    out.fallbacks = rs.filter((r) => r.fallback).length;
    out.locatorVsCentre = paired(errOf(id, 'center'), errOf(id, 'locator'), idx);
    out.locatorVsEarly = paired(errOf(id, 'early'), errOf(id, 'locator'), idx);
    summary[id] = out;
  }
  // confirmatory hypotheses
  const hyp = HYP.map((h) => {
    const a = errOf(h.a[0], h.a[1]), b = errOf(h.b[0], h.b[1]), d = a.map((x, i) => x - b[i]);
    return Object.assign({ id: h.id, text: h.text }, paired(a, b, idx), { p: permP(d) });
  });
  const adj = holm(hyp.map((h) => h.p));
  hyp.forEach((h, i) => { h.pHolm = adj[i]; h.supported = h.ci[0] > 0 && h.pHolm < 0.05; h.result = h.supported ? 'supported' : h.ci[1] < 0 ? 'opposite direction' : h.ci[0] > 0 ? 'not supported (interval above zero, Holm p >= 0.05)' : 'not detectable'; });
  // speed check
  const speedOut = {};
  for (const cls of ['axis', 'diagonal', 'all']) {
    const per = ev.speed.map((pts) => pts.filter((p) => cls === 'all' || p.cls === cls));
    const flat = per.flat(), est = slope(flat);
    const boots = idx.map((ix) => slope(ix.flatMap((i) => per[i]))).filter((x) => isFinite(x)).sort((a, b) => a - b);
    speedOut[cls] = { slope: est, ci: [quantile(boots, 0.025), quantile(boots, 0.975)], points: flat.length };
  }
  // game-stage settings, for the page
  const stageSettings = ['win/8/calm/even', 'cheer/8/loud/even', 'win/4/calm/patchy', 'cheer/4/calm/patchy'];

  /* ---------------- report ---------------- */
  const L = [], o = (s) => L.push(s);
  const f2 = (x) => x.toFixed(2), f3 = (x) => x.toFixed(3), pc = (x) => (100 * x).toFixed(1) + '%';
  const sgn = (x, f) => (x >= 0 ? '+' : '') + f(x);
  const mci = (m, f) => f(m.mean) + ' [' + f(m.ci[0]) + ', ' + f(m.ci[1]) + ']';
  const dci = (c) => sgn(c.mean, f2) + ' [' + sgn(c.ci[0], f2) + ', ' + sgn(c.ci[1], f2) + '], d_z ' + f2(c.dz) + ', W/T/L ' + c.wins + '/' + c.ties + '/' + c.losses;
  const pci = (r) => pc(r.rate) + ' [' + pc(r.ci[0]) + ', ' + pc(r.ci[1]) + ']';
  o('Membrane Arena ' + EVAL_VERSION + ': Wave Pulse evaluation (SYNTHETIC game on a classical simulation)');
  o('Protocol docs/PULSE-PROTOCOL.md, SHA-256 ' + protocolSha);
  o('Regenerate: node scripts/pulse-check.js --write   Check: node scripts/pulse-check.js --verify');
  o('Grid ' + P.W + ' x ' + P.H + ', r^2 ' + P.R2 + ' (nominal speed ' + P.C_NOMINAL + ' cells/tick), damping ' + P.GAMMA + ', ' + P.TICKS + ' ticks, trigger at tick ' + P.PRE + '.');
  o('Calibration pulses ' + CAL[0] + ' to ' + CAL[CAL.length - 1] + ' (' + CAL.length + '); held-out pulses ' + TEST[0] + ' to ' + TEST[TEST.length - 1] + ' (' + n + ', each in all 16 settings).');
  o('Intervals: 95% percentile bootstrap over pulses (' + BOOT + ' resamples, seed ' + BOOT_SEED + '); proportions: Wilson 95%.');
  o('');
  o('1. Calibration (calibration pulses only)');
  o('   Chosen: detector threshold k = ' + cal.k + ', locator speed c = ' + f2(cal.c) + ' cells/tick (mean calibration error ' + f2(cal.calMeanErr) + ' cells).');
  o('   90% region: rho = ' + f3(cal.rho) + ' ticks^2 (90th percentile of cost at the target - minimum cost; ' + cal.rhoFallbacks + ' fallback pulses left out).');
  o('   Mean calibration error by k (best c for each k):');
  for (const k of K_GRID) {
    const row = cal.grid.filter((g) => g.k === k).sort((a, b) => a.meanErr - b.meanErr)[0];
    o('     k ' + String(k).padEnd(3) + ' best c ' + f2(row.c) + '  error ' + f2(row.meanErr));
  }
  o('');
  o('2. Confirmatory hypotheses (held-out; difference = predicted larger - predicted smaller, in cells)');
  for (const h of hyp) o('   ' + h.id + ' ' + h.text.padEnd(52) + ' ' + dci(h) + ', p ' + h.p.toFixed(4) + ', Holm ' + h.pHolm.toFixed(4) + ': ' + h.result);
  o('   Rule: supported when the interval is above zero and the Holm-adjusted p < 0.05.');
  o('');
  o('3. Default setting (' + DEFAULT + '): every method');
  o('   method              error (cells)            median  hits (<= 2 cells)          game points');
  for (const m of METHODS) {
    const s = summary[DEFAULT].methods[m];
    o('   ' + LABEL[m].padEnd(19) + ' ' + mci(s.err, f2).padEnd(24) + ' ' + f2(s.median).padEnd(7) + ' ' + pci(s.hit).padEnd(26) + ' ' + mci(s.points, (x) => x.toFixed(1)));
  }
  o('');
  o('4. The four game settings (stages 1, 2 and 3)');
  o('   setting                locator error            early-sensor avg         centre                   locator points');
  for (const id of stageSettings) {
    const s = summary[id].methods;
    o('   ' + id.padEnd(22) + ' ' + mci(s.locator.err, f2).padEnd(24) + ' ' + mci(s.early.err, f2).padEnd(24) + ' ' + mci(s.center.err, f2).padEnd(24) + ' ' + mci(s.locator.points, (x) => x.toFixed(1)));
  }
  o('');
  o('5. The locator\'s 90% region: coverage by setting (calibrated when the Wilson interval contains 90%)');
  o('   setting                coverage                   calibrated  area (cells)            missed sensors          fallbacks');
  for (const s of P.SETTINGS) {
    const id = P.settingId(s), r = summary[id];
    o('   ' + id.padEnd(22) + ' ' + pci(r.coverage).padEnd(26) + ' ' + (r.coverage.calibrated ? 'yes' : 'no').padEnd(11) + ' ' + mci(r.area, (x) => x.toFixed(1)).padEnd(23) + ' ' + pci(r.missed).padEnd(23) + ' ' + r.fallbacks);
  }
  o('');
  o('6. Speed check (even floor, big win, noise-free arrivals, slope of distance against arrival tick)');
  for (const cls of ['axis', 'diagonal', 'all']) {
    const s = speedOut[cls];
    o('   ' + cls.padEnd(9) + ' ' + f3(s.slope) + ' [' + f3(s.ci[0]) + ', ' + f3(s.ci[1]) + '] cells/tick from ' + s.points + ' arrivals');
  }
  o('   Locator speed c = ' + f2(cal.c) + '; nominal speed ' + P.C_NOMINAL + '.');
  o('');
  o('7. Every setting (exploratory; no correction for multiple comparisons)');
  o('   setting                locator        noise-free     centre - locator               early - locator');
  for (const s of P.SETTINGS) {
    const id = P.settingId(s), r = summary[id];
    const short = (c) => sgn(c.mean, f2) + ' [' + sgn(c.ci[0], f2) + ', ' + sgn(c.ci[1], f2) + ']';
    o('   ' + id.padEnd(22) + ' ' + f2(r.methods.locator.err.mean).padEnd(14) + ' ' + f2(r.methods.noiseFree.err.mean).padEnd(14) + ' ' + short(r.locatorVsCentre).padEnd(30) + ' ' + short(r.locatorVsEarly));
  }
  o('');
  o('8. Notes');
  o('   A flaw in the frozen protocol, found when it was run: the noise-free reference uses a threshold of k times');
  o('   the noise sigma, but smoothing divides the noise SD by sqrt 3, so its threshold is sqrt 3 times higher than');
  o('   the noisy detector\'s. In loud settings it then misses sensors, and it is not a fair reference there. It is');
  o('   reported as frozen. An exploratory variant with k sigma / sqrt 3, added after the protocol, gives in the');
  o('   default setting ' + mci(summary[DEFAULT].methods.noiseFree2.err, f2) + ' and in win/8/loud/even ' + mci(summary['win/8/loud/even'].methods.noiseFree2.err, f2) + ' cells.');
  o('   The region is the locator\'s own: ' + 'a pulse whose locator falls back to the centre (fewer than 3 arrivals) counts as not covered.');
  o('   Errors are distances in grid cells. Results apply to this simulation only.');
  const report = L.join('\n') + '\n';

  /* ---------------- files ---------------- */
  const round = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 + 0 : x);
  const tidy = (v) => JSON.parse(JSON.stringify(v, (k, x) => round(x)));
  const results = tidy({ version: EVAL_VERSION, generator: P.GEN, protocolSha256: protocolSha, defaultSetting: DEFAULT,
    bootstrap: { resamples: BOOT, seed: BOOT_SEED, interval: '95% percentile' }, permutation: { flips: PERM, seed: PERM_SEED, adjust: 'Holm' },
    calibration: { k: cal.k, c: cal.c, rho: cal.rho, calMeanErr: cal.calMeanErr, rhoFallbacks: cal.rhoFallbacks, grid: cal.grid },
    hypotheses: hyp, summary, speed: speedOut, stageSettings });
  const csv = ['seed,setting,' + METHODS.map((m) => 'err_' + m).join(',') + ',err_noiseFree2,covered,area,missed,fallback'];
  for (const r of ev.rows) csv.push([r.seed, r.setting].concat(METHODS.map((m) => round(r.err[m]))).concat([round(r.nf2), r.covered ? 1 : 0, r.area, r.missed, r.fallback ? 1 : 0]).join(','));
  const calibJs = '/* Membrane Arena: the Wave Pulse calibration, chosen by scripts/pulse-check.js on calibration pulses only.\n' +
    ' * Generated file: do not edit by hand (node scripts/pulse-check.js --write). SYNTHETIC game data;\n' +
    ' * see docs/PULSE-PROTOCOL.md. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only. */\n' +
    '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.ArenaPulseCalib = factory();\n' +
    '})(typeof self !== \'undefined\' ? self : this, function () {\n  \'use strict\';\n  return ' +
    JSON.stringify({ version: EVAL_VERSION, generator: P.GEN, k: cal.k, c: cal.c, rho: cal.rho, calibrated: true, fittedOn: CAL[0] + '..' + CAL[CAL.length - 1] }) + ';\n});\n';
  const files = { 'pulse-calib.js': calibJs, 'docs/pulse-check.txt': report, 'docs/pulse-results.json': JSON.stringify(results, null, 1) + '\n', 'docs/pulse-results.csv': csv.join('\n') + '\n' };
  const inputs = ['game.js', 'pulse.js', 'scripts/pulse-check.js', 'docs/PULSE-PROTOCOL.md'];
  const manifest = { version: EVAL_VERSION, checkedWith: P.VERSION, generator: P.GEN, command: 'node scripts/pulse-check.js --write',
    seeds: { calibration: CAL, heldOut: TEST }, settings: P.SETTINGS.map(P.settingId), defaultSetting: DEFAULT, methods: METHODS,
    grids: { k: K_GRID, c: C_GRID }, bootstrap: { resamples: BOOT, seed: BOOT_SEED }, permutation: { flips: PERM, seed: PERM_SEED },
    inputs: Object.fromEntries(inputs.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f), 'utf8'))])),
    outputs: Object.fromEntries(Object.entries(files).map(([f, s]) => [f, sha(s)])),
    // where the written files were made; --verify ignores this entry, so any Node version can check them
    generatedWith: { node: process.version, platform: process.platform + '-' + process.arch } };
  files['docs/pulse-manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  const comparable = (f, s) => {
    if (f !== 'docs/pulse-manifest.json' || !s) return s;
    try { const m = JSON.parse(s); delete m.generatedWith; return JSON.stringify(m); } catch (e) { return s; }
  };
  process.stdout.write(report);
  process.stderr.write('done in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s (node ' + process.version + ')\n');
  if (write) for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, f), s);
  if (verify) {
    let bad = 0;
    for (const [f, s] of Object.entries(files)) {
      const cur = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '';
      if (comparable(f, cur) !== comparable(f, s)) { bad++; process.stderr.write('differs: ' + f + '\n'); }
    }
    if (bad) process.exit(1);
    process.stderr.write('verify: all outputs match\n');
  }
}
main();
