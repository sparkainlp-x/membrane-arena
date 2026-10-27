'use strict';
// Wave Pulse local v0.3.5 region calibration and its separation from the v0.3.4 archive.
// Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const P = require('../pulse.js');
const OLD_CAL = require('../pulse-calib.js');
const CAL = require('../pulse-region-calib.js');
const DATA = require('../docs/pulse-region-results-v035.json');
const MANIFEST = require('../docs/pulse-region-manifest-v035.json');
const OLD_MANIFEST = require('../docs/pulse-manifest.json');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('the local v0.3.5 protocol uses distinct seed sets and preserves the frozen v0.3.4 protocol', () => {
  assert.equal(DATA.version, '0.3.5');
  assert.equal(DATA.protocolSha256, sha(read('docs/PULSE-REGION-PROTOCOL-v035.md')));
  assert.equal(MANIFEST.version, '0.3.5');
  assert.match(MANIFEST.status, /frozen v0.3.5 calibration and evaluation snapshot/);
  assert.equal(DATA.seeds.calibration.length, 200);
  assert.equal(DATA.seeds.heldOut.length, 400);
  assert.ok(DATA.seeds.calibration.every((s) => /^pcal35-\d{3}$/.test(s)));
  assert.ok(DATA.seeds.heldOut.every((s) => /^ptest35-\d{3}$/.test(s)));
  const calibration = new Set(DATA.seeds.calibration);
  assert.ok(DATA.seeds.heldOut.every((s) => !calibration.has(s)));
  assert.equal(OLD_CAL.version, '0.3.4');
  assert.equal(OLD_MANIFEST.version, '0.3.4');
  assert.equal(DATA.engineVersion, OLD_CAL.version);
  assert.equal(OLD_MANIFEST.inputs['docs/PULSE-PROTOCOL.md'], sha(read('docs/PULSE-PROTOCOL.md')));
  for (const [file, expected] of Object.entries(OLD_MANIFEST.outputs)) assert.equal(sha(read(file)), expected, file + ' remains byte-identical to its v0.3.4 output');
});

test('each setting has its own finite-sample threshold or an explicit no-finite-threshold result', () => {
  const ids = P.SETTINGS.map(P.settingId);
  assert.deepEqual(Object.keys(CAL.rhoBySetting), ids);
  assert.equal(CAL.version, '0.3.5');
  assert.equal(CAL.baseVersion, '0.3.4');
  assert.deepEqual([CAL.k, CAL.c, CAL.oldRho], [OLD_CAL.k, OLD_CAL.c, OLD_CAL.rho]);
  assert.equal(DATA.targetCoverage, 0.9);
  for (const id of ids) {
    assert.equal(CAL.bySetting[id].n, 200, id);
    assert.equal(CAL.bySetting[id].rank, 181, id);
    assert.equal(CAL.rhoBySetting[id], CAL.bySetting[id].rho, id);
    assert.ok(CAL.rhoBySetting[id] === null || (Number.isFinite(CAL.rhoBySetting[id]) && CAL.rhoBySetting[id] >= 0), id);
  }
  const hard = 'win/4/loud/patchy';
  assert.equal(CAL.bySetting[hard].calibrationFallbacks, 20);
  assert.equal(CAL.rhoBySetting[hard], null);
});

test('fresh held-out coverage keeps fallbacks in the denominator and reports the mixed result', () => {
  assert.equal(Object.keys(DATA.results).length, 16);
  assert.equal(DATA.summary.calibratedSettings, 11);
  assert.equal(DATA.summary.oldCalibratedSettings, 1);
  const def = DATA.results['win/8/calm/even'];
  assert.equal(def.n, 400);
  assert.equal(def.coverage, 343 / 400);
  assert.equal(def.intervalContains90, false);
  assert.equal(DATA.results['win/4/loud/patchy'].coverage, 0);
  assert.equal(DATA.results['win/4/loud/patchy'].fallbackRate, 28 / 400);
  assert.ok(Math.abs(DATA.summary.meanCoverage - 0.853125) < 1e-12);
});

test('the held-out CSV, report and SHA-256 manifest match the calibration artifacts', () => {
  const csv = read('docs/pulse-region-results-v035.csv').toString('utf8').trim().split('\n');
  assert.equal(csv.length, 1 + 16 * 400);
  const bySetting = {};
  for (const line of csv.slice(1)) {
    const [seed, setting, , covered, , fallback] = line.split(',');
    assert.match(seed, /^ptest35-\d{3}$/);
    const row = bySetting[setting] || (bySetting[setting] = { n: 0, hits: 0, fallbacks: 0 });
    row.n++;
    row.hits += Number(covered);
    row.fallbacks += Number(fallback);
  }
  for (const [id, row] of Object.entries(bySetting)) {
    assert.equal(row.n, 400, id);
    assert.equal(DATA.results[id].coverage, row.hits / row.n, id);
    assert.equal(DATA.results[id].fallbacks, row.fallbacks, id);
  }
  assert.match(read('docs/pulse-region-check-v035.txt').toString('utf8'), /11\/16/);
  assert.match(read('docs/pulse-region-check-v035.txt').toString('utf8'), /85\.8% \[82\.0%, 88\.8%\]/);
  for (const [file, expected] of Object.entries(MANIFEST.inputs)) assert.equal(sha(read(file)), expected, file);
  for (const [file, expected] of Object.entries(MANIFEST.outputs)) assert.equal(sha(read(file)), expected, file);
  assert.equal(MANIFEST.outputs['docs/pulse-region-results-v035.json'], sha(read('docs/pulse-region-results-v035.json')));
});

test('the page uses only the per-setting region map and warns when a finite region is unavailable', () => {
  const html = read('pulse.html').toString('utf8'), ui = read('pulseui.js').toString('utf8');
  assert.match(html, /pulse-region-calib\.js/);
  assert.match(ui, /PU\.settingId\(A\.setting\)/);
  assert.match(ui, /REGION_CAL\.rhoBySetting/);
  assert.match(ui, /banner\.regionfit/);
  assert.equal(require('../pulse-i18n.js').LANGS.en['eval.v035'].includes('85.8%'), true);
  const langs = require('../pulse-i18n.js').LANGS;
  assert.equal(langs.en['eval.v035'].includes('85.8%'), true);
  assert.equal(langs.fr['eval.v035'].includes('85,8'), true);
  const report = read('docs/pulse-region-check-v035.txt').toString('utf8');
  const nums = (s) => (s.replace(/(\d),(\d)/g, '$1.$2').match(/[+-]?\d+\.\d+/g) || []).map((x) => x.replace(/^\+/, ''));
  for (const lang of ['en', 'fr']) for (const n of nums(langs[lang]['eval.v035'])) assert.ok(report.includes(n), lang + ' v0.3.5 page number ' + n + ' appears in its separate report');
});
