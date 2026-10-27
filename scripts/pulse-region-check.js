#!/usr/bin/env node
/*
 * Membrane Arena: setting-specific Wave Pulse region calibration for v0.3.5.
 * The v0.3.4 locator and frozen evaluation remain unchanged; this script changes only
 * the cost allowance used for the displayed region. See docs/PULSE-REGION-PROTOCOL-v035.md.
 *
 *   node scripts/pulse-region-check.js            print the report
 *   node scripts/pulse-region-check.js --write    write the v0.3.5 calibration and reports
 *   node scripts/pulse-region-check.js --verify   compare the generated v0.3.5 files
 *   node scripts/pulse-region-check.js --smoke    use small, separate seed sets; never write
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.join(__dirname, '..');
const P = require('../pulse.js');
const G = require('../game.js');
const BASE = P.calib();
const TARGET = 0.9;
const CAL = Array.from({ length: 200 }, (_, i) => 'pcal35-' + String(i).padStart(3, '0'));
const TEST = Array.from({ length: 400 }, (_, i) => 'ptest35-' + String(i).padStart(3, '0'));
const OLD_RHO = BASE.rho;
const SMOKE = process.argv.includes('--smoke');
const WRITE = process.argv.includes('--write');
const VERIFY = process.argv.includes('--verify');
const BOOTSTRAP_VERSION = '0.3.5';

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, den = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / den;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
function pct(x) { return (100 * x).toFixed(1) + '%'; }
function f2(x) { return Number.isFinite(x) ? x.toFixed(2) : 'n/a'; }
function f3(x) { return Number.isFinite(x) ? x.toFixed(3) : 'n/a'; }
function isCalibrated(ci) { return ci[0] <= TARGET && TARGET <= ci[1]; }
function cleanInf(x) { return Number.isFinite(x) ? x : null; }
function sortKey(setting) { return P.settingId(setting); }

function seedRows(seeds) {
  const bySetting = Object.fromEntries(P.SETTINGS.map((s) => [sortKey(s), []]));
  for (const seed of seeds) {
    const sp = P.spec(seed), z = P.noiseStreams(seed), sims = {};
    for (const kind of ['win', 'cheer']) for (const floor of ['even', 'patchy']) {
      sims[kind + '/' + floor] = P.simulate(sp, kind, floor, false);
    }
    for (const setting of P.SETTINGS) {
      const id = sortKey(setting), sim = sims[setting.kind + '/' + setting.floor];
      const a = P.analyze(seed, setting, BASE, sim, z);
      const row = { seed, setting: id, fallback: a.loc.fallback, residual: Infinity, oldCovered: false };
      if (!a.loc.fallback) {
        const pos = [], arr = [];
        a.sensors.forEach((s, j) => {
          if (a.arrivals[j] >= 0) { pos.push(P.SENSORS[s]); arr.push(a.arrivals[j]); }
        });
        row.residual = Math.max(0, P.costAt(pos, arr, BASE.c, a.target[0], a.target[1]) - a.loc.cost);
        row.oldCovered = P.covers(a.sensors, a.arrivals, BASE.c, OLD_RHO, a.loc, a.target);
      }
      row._analysis = { sensors: a.sensors, arrivals: a.arrivals, target: a.target, loc: a.loc };
      bySetting[id].push(row);
    }
  }
  return bySetting;
}

function calibrate(bySetting) {
  const fit = {};
  for (const setting of P.SETTINGS) {
    const id = sortKey(setting), rows = bySetting[id], rank = Math.ceil(TARGET * (rows.length + 1));
    const sorted = rows.map((r) => r.residual).sort((a, b) => a - b);
    const selected = sorted[rank - 1];
    const rho = Number.isFinite(selected) ? Math.ceil(selected * 1000) / 1000 : null;
    const covered = Number.isFinite(rho) ? rows.filter((r) => !r.fallback && r.residual <= rho).length : 0;
    fit[id] = { rho, n: rows.length, rank, calibrationCovered: covered, calibrationFallbacks: rows.filter((r) => r.fallback).length };
  }
  return fit;
}

function score(testRows, fit) {
  const out = {};
  for (const setting of P.SETTINGS) {
    const id = sortKey(setting), rows = testRows[id], rho = fit[id].rho;
    let hits = 0, oldHits = 0, area = 0, fallbacks = 0, locatable = 0;
    for (const r of rows) {
      const a = r._analysis;
      if (r.oldCovered) oldHits++;
      if (r.fallback) { fallbacks++; continue; }
      locatable++;
      if (Number.isFinite(rho)) {
        const reg = P.region(a.sensors, a.arrivals, BASE.c, rho, a.loc);
        area += reg.area;
        if (P.covers(a.sensors, a.arrivals, BASE.c, rho, a.loc, a.target)) hits++;
      }
    }
    const n = rows.length, ci = wilson(hits, n), oldCI = wilson(oldHits, n), fallbackCI = wilson(fallbacks, n);
    out[id] = {
      n, rho, coverage: hits / n, ci, intervalContains90: isCalibrated(ci),
      conditionalCoverage: locatable ? hits / locatable : 0,
      oldCoverage: oldHits / n, oldCI, area: locatable ? area / locatable : 0,
      fallbacks, fallbackRate: fallbacks / n, fallbackCI, locatable,
      calibrationFallbacks: fit[id].calibrationFallbacks,
      calibrationCoverage: fit[id].calibrationCovered / fit[id].n
    };
  }
  return out;
}

function makeReport(cal, result, calSeeds, testSeeds, protocolSha) {
  const lines = [];
  const total = P.SETTINGS.length;
  const good = Object.values(result).filter((r) => r.intervalContains90).length;
  const oldGood = Object.values(result).filter((r) => r.oldCI[0] <= TARGET && TARGET <= r.oldCI[1]).length;
  lines.push('Membrane Arena ' + BOOTSTRAP_VERSION + ': Wave Pulse 90% region recalibration (SYNTHETIC simulation)');
  lines.push('Protocol docs/PULSE-REGION-PROTOCOL-v035.md, SHA-256 ' + protocolSha);
  lines.push('Regenerate: node scripts/pulse-region-check.js --write   Verify: node scripts/pulse-region-check.js --verify');
  lines.push('v0.3.4 engine retained: k = ' + BASE.k + ', c = ' + BASE.c + ', old shared rho = ' + OLD_RHO.toFixed(3) + ' ticks^2.');
  lines.push('Calibration: ' + calSeeds[0] + ' to ' + calSeeds[calSeeds.length - 1] + ' (' + calSeeds.length + ' seeds x ' + total + ' settings).');
  lines.push('Fresh held-out evaluation: ' + testSeeds[0] + ' to ' + testSeeds[testSeeds.length - 1] + ' (' + testSeeds.length + ' seeds x ' + total + ' settings).');
  lines.push('The selected allowance is order statistic ' + cal[P.settingId(P.SETTINGS[0])].rank + ' of ' + cal[P.settingId(P.SETTINGS[0])].n + ', including fallback pulses as infinite residuals; finite values round upward to 0.001.');
  lines.push('Unconditional coverage intervals and fallback-rate intervals are two-sided 95% Wilson intervals.');
  lines.push('');
  lines.push('Fresh held-out coverage by setting (90% check is descriptive; interval contains 90%):');
  lines.push('setting                 rho35    cal fb  unconditional [95% Wilson]  90%?  conditional  fallback [95% Wilson]  area/locatable  old rho coverage [95% Wilson]');
  for (const s of P.SETTINGS) {
    const id = P.settingId(s), r = result[id];
    const cov = pct(r.coverage) + ' [' + pct(r.ci[0]) + ', ' + pct(r.ci[1]) + ']';
    const fallback = pct(r.fallbackRate) + ' [' + pct(r.fallbackCI[0]) + ', ' + pct(r.fallbackCI[1]) + ']';
    const old = pct(r.oldCoverage) + ' [' + pct(r.oldCI[0]) + ', ' + pct(r.oldCI[1]) + ']';
    lines.push(id.padEnd(23) + ' ' + f3(r.rho).padEnd(8) + ' ' + String(r.calibrationFallbacks).padEnd(7) + ' ' + cov.padEnd(30) + ' ' + (r.intervalContains90 ? 'yes' : 'no ').padEnd(5) + ' ' + pct(r.conditionalCoverage).padEnd(12) + ' ' + fallback.padEnd(25) + ' ' + f2(r.area).padEnd(15) + ' ' + old);
  }
  lines.push('');
  lines.push('Settings whose fresh Wilson interval contains 90%: v0.3.5 ' + good + '/' + total + '; shared v0.3.4 allowance on the same fresh pulses ' + oldGood + '/' + total + '.');
  lines.push('Mean setting coverage (descriptive macro-average; not a pooled confidence interval): v0.3.5 ' + pct(Object.values(result).reduce((s, r) => s + r.coverage, 0) / total) + '; v0.3.4 ' + pct(Object.values(result).reduce((s, r) => s + r.oldCoverage, 0) / total) + '.');
  lines.push('All findings concern this synthetic game simulation only.');
  lines.push('Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.');
  return lines.join('\n') + '\n';
}

function generate({ calSeeds = CAL, testSeeds = TEST, smoke = false } = {}) {
  const t0 = Date.now();
  const protocolSha = sha(fs.readFileSync(path.join(ROOT, 'docs/PULSE-REGION-PROTOCOL-v035.md')));
  const calData = seedRows(calSeeds);
  const fit = calibrate(calData);
  const testData = seedRows(testSeeds);
  const results = score(testData, fit);
  const report = makeReport(fit, results, calSeeds, testSeeds, protocolSha);
  const tidy = (x) => JSON.parse(JSON.stringify(x, (k, v) => typeof v === 'number' && !Number.isFinite(v) ? null : v));
  const calibrationModule = '/* Membrane Arena: setting-specific Wave Pulse region allowances for v0.3.5.\n' +
    ' * Generated by scripts/pulse-region-check.js from calibration seeds only.\n' +
    ' * See docs/PULSE-REGION-PROTOCOL-v035.md. SYNTHETIC game data. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only. */\n' +
    '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.ArenaPulseRegionCalib = factory();\n' +
    '})(typeof self !== \'undefined\' ? self : this, function () {\n  \'use strict\';\n  return ' + JSON.stringify(tidy({ version: BOOTSTRAP_VERSION, calibrated: true,
      baseVersion: BASE.version, k: BASE.k, c: BASE.c, oldRho: OLD_RHO, targetCoverage: TARGET,
      method: 'finite-sample order statistic ceil(target*(n+1)); fallback residuals are infinite',
      calibrationSeeds: calSeeds, rhoBySetting: Object.fromEntries(Object.entries(fit).map(([id, v]) => [id, v.rho])),
      bySetting: fit }), null, 1) + ';\n});\n';
  const csv = ['seed,setting,rho35,covered35,area35,fallback,coveredV034,excessCost'];
  for (const s of P.SETTINGS) {
    const id = P.settingId(s), rho = fit[id].rho;
    for (const r of testData[id]) {
      const a = r._analysis;
      let covered = false, area = 0;
      if (!r.fallback && Number.isFinite(rho)) {
        const reg = P.region(a.sensors, a.arrivals, BASE.c, rho, a.loc);
        area = reg.area;
        covered = P.covers(a.sensors, a.arrivals, BASE.c, rho, a.loc, a.target);
      }
      csv.push([r.seed, id, rho === null ? '' : rho, covered ? 1 : 0, area, r.fallback ? 1 : 0, r.oldCovered ? 1 : 0, Number.isFinite(r.residual) ? r.residual.toFixed(6) : ''].join(','));
    }
  }
  const json = tidy({ version: BOOTSTRAP_VERSION, generator: P.GEN, protocolSha256: protocolSha,
    engineVersion: BASE.version, baseCalibration: { k: BASE.k, c: BASE.c, oldRho: OLD_RHO },
    targetCoverage: TARGET, method: 'per-setting finite-sample order statistic with fallback residuals as infinity; finite rho rounded upward to 0.001',
    seeds: { calibration: calSeeds, heldOut: testSeeds }, settings: P.SETTINGS.map(P.settingId),
    calibration: fit, results, summary: {
      calibratedSettings: Object.values(results).filter((r) => r.intervalContains90).length,
      totalSettings: P.SETTINGS.length,
      oldCalibratedSettings: Object.values(results).filter((r) => r.oldCI[0] <= TARGET && TARGET <= r.oldCI[1]).length,
      meanCoverage: Object.values(results).reduce((s, r) => s + r.coverage, 0) / P.SETTINGS.length,
      oldMeanCoverage: Object.values(results).reduce((s, r) => s + r.oldCoverage, 0) / P.SETTINGS.length
    } });
  const files = {
    'pulse-region-calib.js': calibrationModule,
    'docs/pulse-region-check-v035.txt': report,
    'docs/pulse-region-results-v035.json': JSON.stringify(json, null, 1) + '\n',
    'docs/pulse-region-results-v035.csv': csv.join('\n') + '\n'
  };
  const inputs = ['game.js', 'pulse.js', 'pulse-calib.js', 'scripts/pulse-region-check.js', 'docs/PULSE-REGION-PROTOCOL-v035.md'];
  const manifest = { version: BOOTSTRAP_VERSION, status: 'frozen v0.3.5 calibration and evaluation snapshot; release status is recorded in repository metadata', command: 'node scripts/pulse-region-check.js --write',
    seeds: { calibration: calSeeds, heldOut: testSeeds }, settings: P.SETTINGS.map(P.settingId), targetCoverage: TARGET,
    quantile: { rule: 'ceil(target*(n+1)) one-based order statistic', target: TARGET, rounding: 'finite thresholds rounded upward to 0.001' },
    inputs: Object.fromEntries(inputs.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f)))])),
    outputs: Object.fromEntries(Object.entries(files).map(([f, s]) => [f, sha(s)])),
    generatedWith: { node: process.version, platform: process.platform + '-' + process.arch } };
  files['docs/pulse-region-manifest-v035.json'] = JSON.stringify(manifest, null, 1) + '\n';
  return { report, files, manifest, json };
}

function comparable(f, s) {
  if (f !== 'docs/pulse-region-manifest-v035.json' || !s) return s;
  try { const m = JSON.parse(s); delete m.generatedWith; return JSON.stringify(m); } catch { return s; }
}
function main() {
  if ((WRITE || VERIFY) && SMOKE) { console.error('--smoke cannot write or verify'); process.exit(2); }
  if (WRITE && VERIFY) { console.error('choose either --write or --verify'); process.exit(2); }
  const calSeeds = SMOKE ? Array.from({ length: 16 }, (_, i) => 'psmoke35-c' + String(i).padStart(2, '0')) : CAL;
  const testSeeds = SMOKE ? Array.from({ length: 16 }, (_, i) => 'psmoke35-t' + String(i).padStart(2, '0')) : TEST;
  const out = generate({ calSeeds, testSeeds, smoke: SMOKE });
  process.stdout.write(out.report);
  if (SMOKE) process.stderr.write('smoke run only; no files written\n');
  else if (WRITE) for (const [f, s] of Object.entries(out.files)) fs.writeFileSync(path.join(ROOT, f), s);
  else if (VERIFY) {
    let bad = 0;
    for (const [f, s] of Object.entries(out.files)) {
      const cur = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '';
      if (comparable(f, cur) !== comparable(f, s)) { bad++; process.stderr.write('differs: ' + f + '\n'); }
    }
    if (bad) process.exit(1);
    process.stderr.write('verify: all v0.3.5 region outputs match\n');
  }
}

if (require.main === module) main();
module.exports = { generate, wilson, calibrate, score, CAL, TEST, TARGET };
