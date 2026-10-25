'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, buildBrain } = require('../build.js');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('brain page is one self-contained file (no external files, no network APIs)', () => {
  const html = buildBrain();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(|localStorage|sessionStorage)/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html), 'only the SVG namespace URL appears');
  assert.ok(html.length < 250000, `under 250 KB (${html.length})`);
});

test('dist/brain.html, when present, matches a fresh build; the arena build is unchanged by the brain page', { skip: !fs.existsSync(path.join(root, 'dist', 'brain.html')) }, () => {
  assert.equal(read('dist/brain.html'), buildBrain());
  assert.equal(read('dist/index.html'), build());
});

test('every element id used by brainui.js exists in brain.html, and every data-i18n key exists in both languages', () => {
  const html = read('brain.html'), ui = read('brainui.js'), L = require('../brain-i18n.js').LANGS;
  const used = new Set();
  for (const m of ui.matchAll(/\$\('([\w-]+)'\)/g)) used.add(m[1]);
  assert.ok(used.size > 25);
  for (const id of used) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) keys.add(m[1]);
  for (const m of ui.matchAll(/\bt\('([a-z_]+\.[\w.]+)'/g)) keys.add(m[1]);
  assert.ok(keys.size > 50);
  for (const k of keys) { assert.ok(k in L.en, `en ${k}`); assert.ok(k in L.fr, `fr ${k}`); }
});

test('brain page script order and accessibility basics', () => {
  const html = read('brain.html');
  const order = [...html.matchAll(/<script src="([\w.-]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['baselines.js', 'game.js', 'stats.js', 'brain.js', 'brain-i18n.js', 'brainui.js']);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  for (const id of ['f', 'g', 'h', 'sg', 'gi', 'io', 'jitter', 'c', 'th', 'gain', 'fs', 'fc', 'fi', 'mode', 'episodes', 'seed']) assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `label for ${id}`);
  for (const id of ['stab', 'mem', 'fuse']) assert.match(html, new RegExp(`<label class="switch"><input id="${id}"`));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /<th scope="col"/);
});
