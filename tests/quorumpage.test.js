'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, buildBrain, buildQuorum } = require('../build.js');
const Q = require('../quorum.js');
const L = require('../quorum-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const FILES = ['quorum.html', 'quorum.css', 'quorum.js', 'quorum-i18n.js', 'quorumui.js', 'scripts/quorum-check.js', 'scripts/quorum-e2e-check.js', 'docs/QUORUM.md', 'docs/quorum-check.txt'];
// word lists are assembled from fragments so this file does not contain the words it forbids
const join = (parts) => new RegExp('\\b(' + parts.map((p) => p.join('')).join('|') + ')\\b', 'i');
const BANNED = join([['pro', 'ven'], ['valid', 'ated'], ['production', '-ready'], ['quantum ', 'advantage'], ['real-world ', 'performance']]);
const NAMES = join([['l', 'ee'], ['la', 'ha'], ['bel', 'kadi'], ['ti', 'su']]);
const EMOJI = /\p{Extended_Pictographic}/u;

test('the game is one self-contained file (no external files, no network APIs, no storage)', () => {
  const html = buildQuorum();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(|localStorage|sessionStorage|indexedDB)/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html), 'only the SVG namespace URL appears');
  assert.ok(html.length < 250000, `under 250 KB (${html.length})`);
});

test('dist/quorum.html, when present, matches a fresh build; the arena and brain builds are unchanged by the game', { skip: !fs.existsSync(path.join(root, 'dist', 'quorum.html')) }, () => {
  assert.equal(read('dist/quorum.html'), buildQuorum());
  assert.equal(read('dist/index.html'), build());
  assert.equal(read('dist/brain.html'), buildBrain());
  assert.ok(!/quorum/i.test(read('index.html')), 'the arena page does not load the game');
});

test('every element id used by quorumui.js exists in quorum.html', () => {
  const html = read('quorum.html'), ui = read('quorumui.js');
  const used = new Set();
  for (const m of ui.matchAll(/\$\('([\w-]+)'\)/g)) used.add(m[1]);
  for (const p of ['m', 'c', 'i']) for (const s of ['-dec', '-inc', '-val']) used.add(p + s);
  assert.ok(used.size > 25);
  for (const id of used) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('English and French have the same keys and placeholders, and every key the page uses exists', () => {
  assert.deepEqual(Object.keys(L.fr).sort(), Object.keys(L.en).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(L.en)) {
    assert.equal(ph(L.fr[k]), ph(L.en[k]), `placeholders of ${k}`);
    assert.ok(L.en[k].trim() && L.fr[k].trim(), `${k} is not empty`);
  }
  const html = read('quorum.html'), ui = read('quorumui.js'), keys = new Set();
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) keys.add(m[1]);
  for (const m of ui.matchAll(/\bt\('([a-z]+\.[\w.]*[\w])'/g)) keys.add(m[1]);   // pl() stems get .1 and .n, added below
  for (const m of ui.matchAll(/\['((?:res|pick)\.[\w.]*\w)'/g)) keys.add(m[1]);
  for (const lv of Q.LEVELS) for (const s of ['title', 'brief', 'hint']) keys.add(`${lv.id}.${s}`);
  for (const m of Q.MODES) keys.add('mode.' + m);
  for (const g of Q.GOALS) { keys.add('goal.' + g); keys.add('res.bwin.' + g); }
  for (const o of ['true', 'false', 'none']) { keys.add('outcome.' + o); keys.add('unit.' + o); }
  for (const b of ['thr.total', 'thr.perColumn', 'thr.gates', 'thr.integrators', 'where.sensory']) { keys.add(b + '.1'); keys.add(b + '.n'); }
  assert.ok(keys.size > 100, String(keys.size));
  for (const k of keys) assert.ok(k in L.en, `en ${k}`);
});

test('script order and accessibility basics', () => {
  const html = read('quorum.html');
  const order = [...html.matchAll(/<script src="([\w.-]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['baselines.js', 'game.js', 'stats.js', 'brain.js', 'quorum.js', 'quorum-i18n.js', 'quorumui.js']);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /<label class="switch"><input id="stab"/);
  for (const p of ['m', 'c', 'i']) assert.match(html, new RegExp(`<output id="${p}-val" aria-labelledby="${p}-label"`));
  // stepper buttons get spoken names from the page script
  assert.match(read('quorumui.js'), /setAttribute\('aria-label', t\('design\.dec'/);
});

test('no banned wording, emoji or forbidden names in the game files', () => {
  for (const f of FILES) {
    if (!fs.existsSync(path.join(root, f))) continue;
    const s = read(f);
    assert.ok(!BANNED.test(s), `banned word in ${f}`);
    assert.ok(!EMOJI.test(s), `emoji in ${f}`);
    assert.ok(!NAMES.test(s), `forbidden name in ${f}`);
  }
});

test('the game says what it is: synthetic, a metaphor, and a game score', () => {
  for (const lang of ['en', 'fr']) {
    assert.match(L[lang]['page.tag'], /SYNTH/);
    assert.match(L[lang]['intro.p2'], /metaphor|métaphore/);
    assert.match(L[lang]['how.p3'], /game score|score de jeu/);
  }
});
