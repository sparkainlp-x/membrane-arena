'use strict';
// Reverse Membranes page, strings and docs. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, buildBrain, buildQuorum, buildReverse } = require('../build.js');
const L = require('../reverse-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const FILES = ['reverse.html', 'reverse.css', 'reverse.js', 'reverse-i18n.js', 'reverseui.js', 'scripts/reverse-check.js',
  'scripts/reverse-e2e-check.js', 'docs/REVERSE.md', 'docs/reverse-check.txt', 'tests/reverse.test.js'];
// word lists are assembled from fragments so this file does not contain the words it forbids
const join = (parts) => new RegExp('\\b(' + parts.map((p) => p.join('')).join('|') + ')\\b', 'i');
const BANNED = join([['pro', 'ven'], ['valid', 'ated'], ['production', '-ready'], ['quantum ', 'advantage'], ['real-world ', 'performance']]);
const NAMES = join([['l', 'ee'], ['la', 'ha'], ['bel', 'kadi'], ['ti', 'su']]);
const EMOJI = /\p{Extended_Pictographic}/u;

test('the page is one self-contained file (no external files, no network APIs, no storage)', () => {
  const html = buildReverse();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(|localStorage|sessionStorage|indexedDB)/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html), 'only the SVG namespace URL appears');
  assert.ok(html.length < 250000, `under 250 KB (${html.length})`);
});

test('dist/reverse.html, when present, matches a fresh build, and the other pages match theirs', { skip: !fs.existsSync(path.join(root, 'dist', 'reverse.html')) }, () => {
  assert.equal(read('dist/reverse.html'), buildReverse());
  assert.equal(read('dist/index.html'), build());
  assert.equal(read('dist/brain.html'), buildBrain());
  assert.equal(read('dist/quorum.html'), buildQuorum());
  assert.ok(!/<script[^>]*(reverse|pair)/i.test(read('index.html')), 'the arena page does not load the reverse pages (it only links to them)');
});

test('scripts load in dependency order, and Quorum Keeper links to the page', () => {
  const html = read('reverse.html');
  const order = ['game.js', 'reverse.js', 'reverse-i18n.js', 'reverseui.js'].map((f) => html.indexOf(`<script src="${f}">`));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(read('quorum.html').includes('href="reverse.html"'));
  for (const f of ['index.html', 'brain.html', 'quorum.html']) assert.ok(html.includes(`href="${f}"`), f);
});

test('every element id used by reverseui.js exists in reverse.html, once', () => {
  const html = read('reverse.html'), ui = read('reverseui.js');
  const used = new Set();
  for (const m of ui.matchAll(/\$\('([\w-]+)'\)/g)) used.add(m[1]);
  ['btn-again', 'btn-today', 'btn-new', 'btn-mirror'].forEach((id) => used.add(id));
  assert.ok(used.size > 20, String(used.size));
  for (const id of used) assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id}`);
});

test('English and French have the same keys and placeholders, and every key the page uses exists', () => {
  assert.deepEqual(Object.keys(L.fr).sort(), Object.keys(L.en).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(L.en)) {
    assert.equal(ph(L.fr[k]), ph(L.en[k]), `placeholders of ${k}`);
    assert.ok(L.en[k].trim() && L.fr[k].trim(), `${k} is not empty`);
    if (!['sec.result', 'legend.m1', 'legend.m2', 'legend.m3', 'share.score'].includes(k)) assert.notEqual(L.fr[k], L.en[k], `${k} is translated`);
  }
  const html = read('reverse.html'), ui = read('reverseui.js'), logic = read('reverse.js'), keys = new Set();
  const PREFIX = /'((?:page|intro|sec|ctl|forecast|dark|btn|seed|tally|res|chart|ep|out|legend|col|setup|pol|mirror|how|share|foot)(?:\.[\w]+)*)'/g;
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) keys.add(m[1]);
  for (const src of [ui, logic]) for (const m of src.matchAll(PREFIX)) if (/\./.test(m[1]) || m[1] === 'tally') keys.add(m[1]);
  for (const p of ['reverse', 'forward']) keys.add('pol.' + p);
  for (const w of ['dark', 'bright']) keys.add('mirror.' + w);
  ['pol.', 'mirror.', 'share.on', 'share.off'].forEach((k) => keys.delete(k));
  assert.ok(keys.size > 80, String(keys.size));
  for (const k of keys) assert.ok(k in L.en, `en ${k}`);
  for (const k of Object.keys(L.en)) assert.ok(keys.has(k) || k === 'ctl.echo.dec' || k === 'ctl.echo.inc' || /^share\./.test(k), `unused key ${k}`);
});

test('the page says, in both languages, that it is a synthetic game and models no physics or biology', () => {
  assert.match(L.en['intro.p2'], /SYNTHETIC classical simulation/);
  assert.match(L.en['intro.p2'], /negative energy, antimatter, real membranes, neurons/);
  assert.match(L.fr['intro.p2'], /simulation classique SYNTHÉTIQUE/);
  assert.match(L.fr['intro.p2'], /énergie négative, de l'antimatière/);
  const md = read('docs/REVERSE.md');
  assert.match(md, /SYNTHETIC classical simulation/);
  assert.match(md, /Nothing here models negative energy, antimatter/);
  assert.match(read('reverse.js'), /Nothing here models negative\n? ?\*? ?energy, antimatter/);
});

test('new files: attribution and license header, no forbidden words, no other names, no emoji', () => {
  for (const f of FILES) {
    const s = read(f);
    if (!/\.txt$/.test(f)) {
      const text = f === 'reverse.html' ? L.en['foot.license'] + L.fr['foot.license'] : s;   // the page's attribution is its footer, in both languages
      assert.ok(text.includes('Jean-François Brisson, Spark AI NLP'), `${f} names the authors`);
      assert.ok(text.includes('AGPL-3.0'), `${f} license`);
    }
    assert.ok(!BANNED.test(s), `${f}: ${(s.match(BANNED) || [])[0]}`);
    assert.ok(!NAMES.test(s), `${f}: ${(s.match(NAMES) || [])[0]}`);
    assert.ok(!EMOJI.test(s), `${f} has no emoji`);
  }
  for (const k of Object.keys(L.en)) for (const lang of ['en', 'fr']) {
    assert.ok(!BANNED.test(L[lang][k]), `${lang} ${k}`);
    assert.ok(!EMOJI.test(L[lang][k]), `${lang} ${k}`);
  }
});

test('the numbers quoted on the page and in docs/REVERSE.md are the ones in docs/reverse-check.txt', () => {
  const rep = read('docs/reverse-check.txt'), md = read('docs/REVERSE.md');
  const fixed = rep.match(/reverse, fixed threshold 0\.6, echo 1\s+score\s+([\d.]+)/)[1];
  const follow = rep.match(/reverse, threshold = darkness - 0\.1, echo 1\s+score\s+([\d.]+)/)[1];
  const noEcho = rep.match(/reverse, fixed threshold 0\.6, echo 0\s+score\s+([\d.]+)/)[1];
  const fwd = rep.match(/forward membranes, threshold 0\.6, echo 1\s+score\s+([\d.]+)/)[1];
  assert.deepEqual([fixed, follow, noEcho, fwd], ['83.8', '86.3', '55.3', '0.0']);
  for (const v of [fixed, follow, noEcho]) {
    assert.ok(L.en['how.p4'].includes(v), `en how.p4 ${v}`);
    assert.ok(L.fr['how.p4'].includes(v.replace('.', ',')), `fr how.p4 ${v}`);
    assert.ok(md.includes(`| ${v} |`), `docs ${v}`);
  }
  const wins = rep.match(/higher on (\d+) of (\d+) seeds, equal on (\d+), lower on (\d+)/);
  assert.ok(md.includes(`higher on ${wins[1]} of the ${wins[2]} seeds, the same on ${wins[3]} and lower on ${wins[4]}`), 'docs quote the seed count');
  const mirror = rep.match(/shield on\s+dark\/reverse: T (\d+) F (\d+) \| dark\/forward: T (\d+) F (\d+) \| bright\/reverse: T (\d+) F (\d+) \| bright\/forward: T (\d+) F (\d+)/);
  assert.ok(md.includes(`| Dark pattern | ${mirror[1]} true, ${mirror[2]} false | ${mirror[3]} true, ${mirror[4]} false |`), 'docs mirror row 1');
  assert.ok(md.includes(`| Bright pattern | ${mirror[5]} true, ${mirror[6]} false | ${mirror[7]} true, ${mirror[8]} false |`), 'docs mirror row 2');
  const w16 = rep.match(/width 16\s+echo 0: ([\d.]+)\s+echo 1: ([\d.]+)\s+echo 2: ([\d.]+)/), w32 = rep.match(/width 32\s+echo 0: ([\d.]+)\s+echo 1: ([\d.]+)\s+echo 2: ([\d.]+)/);
  assert.ok(md.includes(`| 16 | ${w16[1]} | ${w16[2]} | ${w16[3]} |`) && md.includes(`| 32 | ${w32[1]} | ${w32[2]} | ${w32[3]} |`), 'docs width table');
  assert.ok(L.en['how.p3'].includes(`${w16[2]} to the hidden pattern at width 16, but only ${w32[2]}`), 'page width numbers');
});
