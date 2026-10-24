'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, readCsv } = require('../scripts/make-baselines.js');
const B = require('../baselines.js');

const root = path.join(__dirname, '..');

test('baselines.js is exactly what the generator produces from data/*.csv', () => {
  assert.equal(fs.readFileSync(path.join(root, 'baselines.js'), 'utf8'), build());
});

test('the CSV copies are unchanged copies of the repository results (row counts and headers)', () => {
  assert.equal(readCsv('contest_w32-128_summary.csv').length, 36);
  assert.equal(readCsv('contest_256_summary.csv').length, 4);
  assert.equal(readCsv('sweep_summary.csv').length, 75);
  assert.equal(readCsv('stress_summary.csv').length, 6);
  assert.ok('precision_mean' in readCsv('contest_256_summary.csv')[0]);
});

test('source is named: repository, commit, file paths', () => {
  assert.equal(B.SOURCE.repo, 'sparkainlp-x/crystallization-contest');
  assert.match(B.SOURCE.commit, /^[0-9a-f]{40}$/);
  assert.equal(B.SOURCE.contest, 'results/contest_w32-128_summary.csv');
});

test('width-32 table: 12 rows, three w values, four configurations, 20 seeds each', () => {
  assert.equal(B.CONTEST32.length, 12);
  assert.deepEqual([...new Set(B.CONTEST32.map((r) => r.w))].sort(), [0, 0.5, 1]);
  assert.deepEqual([...new Set(B.CONTEST32.map((r) => r.cfg))].sort(), ['---', 'S--', 'SA-', 'SAZ']);
  assert.ok(B.CONTEST32.every((r) => r.seeds === 20));
});

test('spot checks against the CSV text', () => {
  const row = B.CONTEST32.find((r) => r.w === 0.5 && r.cfg === 'SAZ');
  assert.deepEqual([row.T, row.F, row.P], [40.65, 6.35, 0.865]);
  const raw = fs.readFileSync(path.join(root, 'data', 'contest_w32-128_summary.csv'), 'utf8');
  assert.ok(raw.includes('32,0.5,SAZ,20,40.65,4.475,6.35,4.44,0.865,0.094,0.001,0.002,1.226,0.123,0.0'));
});

test('lesson numbers: shield, amplifier, stabilizer, individual reward, stress', () => {
  const L = B.LESSON;
  assert.equal(L.shieldFpMin, 2.3);
  assert.equal(L.shieldFpMax, 3.2);
  assert.equal(L.indLowest, 10);
  assert.equal(L.indCells, 15);
  assert.ok(L.ampMaxDeltaP <= 0.005);
  assert.ok(L.stabCostMin >= 0 && L.stabCostMax <= 5);
  assert.equal(L.runawayNoZMin, 20);
  assert.equal(L.runawayNoZMax, 35);
  assert.equal(L.runawayZMax, 0);
  assert.ok(L.shieldVarMin >= 8 && L.shieldVarMax <= 17);
});

test('lesson numbers are re-derived independently here from the width-32..256 CSV rows', () => {
  const rows = readCsv('contest_w32-128_summary.csv').concat(readCsv('contest_256_summary.csv'));
  const ratios = [32, 64, 128, 256].map((n) => {
    const f = (cfg) => rows.find((r) => r.width === n && r.w === 0.5 && r.cfg === cfg).false_events_mean;
    return f('---') / f('S--');
  });
  assert.ok(Math.abs(Math.min(...ratios) - 2.3) < 0.05);
  assert.ok(Math.abs(Math.max(...ratios) - 3.2) < 0.05);
  const sweep = readCsv('sweep_summary.csv');
  let lowest = 0, cells = 0;
  for (const width of [32, 64, 128, 256, 512]) for (const N of [3, 5, 9]) {
    const cell = sweep.filter((r) => r.width === width && r.N === N);
    if (!cell.length) continue;
    cells++;
    const min = Math.min(...cell.map((r) => r.true_events_mean));
    if (cell.find((r) => r.scheme === 'individual').true_events_mean === min && cell.filter((r) => r.true_events_mean === min).length === 1) lowest++;
  }
  assert.equal(cells, 15);
  assert.equal(lowest, 10);
});

test('scheme table covers the five reward schemes at width 32, N = 3', () => {
  assert.deepEqual(B.SCHEMES32.map((r) => r.scheme), ['individual', 'team', 'difference', 'consensus', 'random']);
  assert.equal(B.SCHEMES32[0].T, 6.75);
});
