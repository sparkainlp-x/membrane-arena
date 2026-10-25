'use strict';
// Pair Watch page, strings and docs. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWatch, buildPair } = require('../build.js');
const W = require('../watch.js');
const P = require('../pair.js');
const L = require('../watch-i18n.js').LANGS;
const LP = require('../pair-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const FILES = ['watch.html', 'watch.css', 'watch.js', 'watch-i18n.js', 'watchui.js', 'scripts/watch-e2e-check.js',
  'docs/WATCH.md', 'tests/watch.test.js', 'tests/watchpage.test.js'];
// word lists are assembled from fragments so this file does not contain the words it forbids
const join = (parts) => new RegExp('\\b(' + parts.map((p) => p.join('')).join('|') + ')\\b', 'i');
const BANNED = join([['pro', 'ven'], ['valid', 'ated'], ['production', '-ready'], ['quantum ', 'advantage'], ['real-world ', 'performance']]);
const NAMES = join([['l', 'ee'], ['la', 'ha'], ['bel', 'kadi'], ['ti', 'su']]);
const EMOJI = /\p{Extended_Pictographic}/u;
const placeholders = (s) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(',');

test('the Pair Watch page is one self-contained file (no external files, no network APIs, no storage)', () => {
  const html = buildWatch();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(|localStorage|sessionStorage|indexedDB)/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html), 'only the SVG namespace URL appears');
  assert.ok(html.length < 250000, `under 250 KB (${html.length})`);
});

test('dist/watch.html, when present, matches a fresh build', { skip: !fs.existsSync(path.join(root, 'dist', 'watch.html')) }, () => {
  assert.equal(read('dist/watch.html'), buildWatch());
  assert.equal(read('dist/pair.html'), buildPair());
});

test('scripts load in dependency order, and the game links the reverse pages and the arena', () => {
  const html = read('watch.html');
  const order = ['baselines.js', 'game.js', 'reverse.js', 'pair.js', 'watch.js', 'watch-i18n.js', 'watchui.js'];
  const at = order.map((f) => html.indexOf(`<script src="${f}"></script>`));
  at.forEach((i, k) => assert.ok(i > 0, order[k] + ' is loaded'));
  for (let k = 1; k < at.length; k++) assert.ok(at[k] > at[k - 1], `${order[k]} after ${order[k - 1]}`);
  for (const q of ['pair.html', 'reverse.html', 'index.html']) assert.ok(html.includes(`href="${q}"`), 'links to ' + q);
  assert.ok(read('pair.html').includes('href="watch.html"'), 'the Reverse Pair page links to the game');
  assert.ok(LP.en['page.watch'] && LP.fr['page.watch'], 'the link has a label in both languages');
});

test('every element id used by watchui.js exists in watch.html, once', () => {
  const html = read('watch.html'), ui = read('watchui.js');
  const ids = new Set([...ui.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 20);
  for (const id of ids) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, '#' + id);
});

test('English and French have the same keys and placeholders, and every key the page uses exists', () => {
  assert.deepEqual(Object.keys(L.fr).sort(), Object.keys(L.en).sort());
  for (const k of Object.keys(L.en)) {
    assert.ok(L.en[k].length && L.fr[k].length, k + ' is not empty');
    assert.equal(placeholders(L.fr[k]), placeholders(L.en[k]), k + ' placeholders');
  }
  const used = new Set();
  for (const f of ['watch.html', 'watchui.js', 'watch.js']) {
    const s = read(f);
    for (const m of s.matchAll(/data-i18n(?:-[a-z]+)?="([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/\bt\('([a-zA-Z0-9.]+)'/g)) used.add(m[1]);
  }
  W.STAGES.forEach((s) => used.add('stage.' + s.id));
  Object.keys(W.POINTS).forEach((k) => used.add('kind.' + k));
  ['perfect', 'beatShield', 'tieShield', 'learning', 'fooled', 'none'].forEach((r) => used.add('rank.' + r));
  ['acceptTrue', 'vetoTrue', 'quietClean', 'quietPlanted', 'acceptFalse.fade', 'acceptFalse.noise', 'vetoFalse.fade', 'vetoFalse.noise']
    .forEach((k) => used.add('out.' + k));
  for (const k of used) if (!k.endsWith('.')) assert.ok(k in L.en, 'missing key ' + k);
  assert.ok(used.size > 90, `${used.size} keys used`);
});

test('the page says, in both languages, that it is a synthetic game and models no physics or hardware', () => {
  assert.equal(L.en['page.tag'], 'SYNTHETIC');
  assert.equal(L.fr['page.tag'], 'SYNTHÉTIQUE');
  assert.match(L.en['intro.p2'], /Nothing here models negative energy, antimatter, real membranes, neurons, oscillators or radio hardware/);
  assert.match(L.fr['intro.p2'], /Rien ici ne modélise l'énergie négative, l'antimatière/);
  assert.match(read('watch.js'), /Nothing here models negative energy, antimatter/);
  assert.match(read('docs/WATCH.md'), /\*\*SYNTHETIC\.\*\*.*Nothing here models negative energy, antimatter/);
});

test('new files: attribution and license header, no forbidden words, no other names, no emoji', () => {
  for (const f of FILES) {
    const s = read(f);
    assert.ok(s.includes('Jean-François Brisson, Spark AI NLP'), f + ' names the author');
    assert.ok(s.includes('AGPL-3.0'), f + ' names the license');
    if (f !== 'tests/watchpage.test.js') {
      assert.ok(!BANNED.test(s), f + ' has a forbidden word: ' + (s.match(BANNED) || [])[0]);
      assert.ok(!NAMES.test(s), f + ' names someone else: ' + (s.match(NAMES) || [])[0]);
    }
    assert.ok(!EMOJI.test(s), f + ' has an emoji');
  }
  for (const lang of ['en', 'fr']) for (const [k, v] of Object.entries(L[lang])) {
    assert.ok(!BANNED.test(v), `${lang} ${k}`);
    assert.ok(!EMOJI.test(v), `${lang} ${k}`);
  }
});

test('the rules on the page and in docs/WATCH.md are the ones the game uses', () => {
  const fmt = (x, lang) => (lang === 'fr' ? x.toFixed(2).replace('.', ',') : x.toFixed(2));
  for (const lang of ['en', 'fr']) {
    const p1 = L[lang]['how.p1'], p3 = L[lang]['how.p3'];
    assert.ok(p1.includes(fmt(P.TUNED.grid, lang)) && p1.includes(fmt(P.TUNED.off, lang)), lang + ' thresholds');
    assert.ok(p1.includes(String(P.CHECK)), lang + ' check interval');
    assert.ok(p3.includes(lang === 'fr' ? '0,7' : '0.7'), lang + ' faded line');
    for (const v of Object.values(W.POINTS)) assert.ok(p3.includes(String(Math.abs(v))), `${lang} how.p3 quotes ${v}`);
  }
  const doc = read('docs/WATCH.md');
  const rows = { acceptTrue: 'You accepted a real find', acceptFalse: 'You accepted a false find', vetoFalse: 'You vetoed a false find',
    vetoTrue: 'You vetoed a real find', quietClean: 'No declaration, no dark pattern', quietPlanted: 'A dark pattern was planted but never declared' };
  for (const [k, label] of Object.entries(rows)) {
    const line = doc.split('\n').find((l) => l.startsWith('| ' + label));
    assert.ok(line, 'docs row ' + k);
    const v = W.POINTS[k];
    assert.ok(line.includes((v > 0 ? '+' : '\u2212') + Math.abs(v)), `docs row ${k} says ${v}`);
  }
  assert.ok(doc.includes(`(0, ${W.STREAK_BONUS}, ${2 * W.STREAK_BONUS}, ${3 * W.STREAK_BONUS}, then ${(W.STREAK_MAX - 1) * W.STREAK_BONUS} at most)`), 'streak bonus');
  assert.ok(doc.includes('0.65 on-grid and 0.70 off-grid'));
  assert.equal(W.WAVES * W.STAGES.length, 24);
  assert.ok(doc.includes('| 1. The observer alone | 8 |'));
});

test('docs/WATCH.md points to the Reverse Pair results and says the game leaves them unchanged', () => {
  const doc = read('docs/WATCH.md');
  for (const link of ['(PAIR.md)', '(PAIR-PROTOCOL.md)', '(pair-check.txt)', '(../watch.html)']) assert.ok(doc.includes(link), link);
  assert.match(doc, /does not change `pair\.js`, the frozen protocol/);
  assert.match(read('watch.js'), /run\.seed \+ '~watch'/, 'game seeds have their own namespace');
  assert.ok(doc.includes('`~watch`'));
});

test('README and CHANGELOG describe Pair Watch', () => {
  const readme = read('README.md');
  const sec = readme.slice(readme.indexOf('## Pair Watch'));
  assert.ok(readme.includes('## Pair Watch'), 'README section');
  assert.ok(sec.includes('https://sparkainlp-x.github.io/membrane-arena/watch.html'), 'live link');
  assert.ok(sec.includes('docs/WATCH.md'));
  assert.ok(readme.includes('scripts/watch-e2e-check.js'));
  const log = read('CHANGELOG.md');
  const top = log.slice(0, log.indexOf('## 0.3.2'));
  assert.match(top, /## 0\.3\.3 \(/);
  assert.match(top, /Pair Watch/);
});
