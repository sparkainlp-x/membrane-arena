'use strict';
// Reverse Pair page, strings and docs. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, buildBrain, buildQuorum, buildReverse, buildPair } = require('../build.js');
const L = require('../pair-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const FILES = ['pair.html', 'pair.css', 'pair.js', 'pair-i18n.js', 'pairui.js', 'scripts/pair-check.js',
  'scripts/pair-e2e-check.js', 'docs/PAIR.md', 'docs/pair-check.txt', 'tests/pair.test.js'];
// word lists are assembled from fragments so this file does not contain the words it forbids
const join = (parts) => new RegExp('\\b(' + parts.map((p) => p.join('')).join('|') + ')\\b', 'i');
const BANNED = join([['pro', 'ven'], ['valid', 'ated'], ['production', '-ready'], ['quantum ', 'advantage'], ['real-world ', 'performance']]);
const NAMES = join([['l', 'ee'], ['la', 'ha'], ['bel', 'kadi'], ['ti', 'su']]);
const EMOJI = /\p{Extended_Pictographic}/u;
test('the pair page is one self-contained file (no external files, no network APIs, no storage)', () => {
  const html = buildPair();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(|localStorage|sessionStorage|indexedDB)/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html), 'only the SVG namespace URL appears');
  assert.ok(html.length < 250000, `under 250 KB (${html.length})`);
});
test('dist/pair.html, when present, matches a fresh build, and the other pages match theirs', { skip: !fs.existsSync(path.join(root, 'dist', 'pair.html')) }, () => {
  assert.equal(read('dist/pair.html'), buildPair());
  assert.equal(read('dist/reverse.html'), buildReverse());
  assert.equal(read('dist/index.html'), build());
  assert.equal(read('dist/brain.html'), buildBrain());
  assert.equal(read('dist/quorum.html'), buildQuorum());
});
test('scripts load in dependency order, and the two reverse pages link each other', () => {
  const html = read('pair.html');
  const order = ['game.js', 'reverse.js', 'pair.js', 'pair-i18n.js', 'pairui.js'].map((f) => html.indexOf(`<script src="${f}">`));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(html.includes('href="reverse.html"') && html.includes('href="index.html"'));
  assert.ok(read('reverse.html').includes('href="pair.html"'));
  const R = require('../reverse-i18n.js').LANGS;
  assert.ok(R.en['page.pair'] && R.fr['page.pair'] && R.en['page.pair'] !== R.fr['page.pair']);
});
test('every element id used by pairui.js exists in pair.html, once', () => {
  const html = read('pair.html'), ui = read('pairui.js');
  const used = new Set();
  for (const m of ui.matchAll(/\$\('([\w-]+)'\)/g)) used.add(m[1]);
  ['btn-again', 'btn-today', 'btn-new', 'btn-cal'].forEach((id) => used.add(id));
  assert.ok(used.size > 20, String(used.size));
  for (const id of used) assert.equal(html.split(`id="${id}"`).length - 1, 1, `#${id}`);
});
test('English and French have the same keys and placeholders, and every key the page uses exists', () => {
  assert.deepEqual(Object.keys(L.fr).sort(), Object.keys(L.en).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  const SAME = ['sec.result', 'share.score', 'tick.o', 'cal.row', 'cal.ticks.cell'];   // the same in both languages
  for (const k of Object.keys(L.en)) {
    assert.equal(ph(L.fr[k]), ph(L.en[k]), `placeholders of ${k}`);
    assert.ok(L.en[k].trim() && L.fr[k].trim(), `${k} is not empty`);
    if (!SAME.includes(k)) assert.notEqual(L.fr[k], L.en[k], `${k} is translated`);
  }
  const html = read('pair.html'), ui = read('pairui.js'), keys = new Set();
  const PREFIX = /'((?:page|intro|sec|ctl|forecast|dark|btn|seed|tally|res|chart|ep|out|legend|col|setup|tick|ticks|tone|tones|cal|how|share|foot)(?:\.[\w]+)*)'/g;
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) keys.add(m[1]);
  for (const m of ui.matchAll(PREFIX)) if (/\./.test(m[1]) || m[1] === 'tally') keys.add(m[1]);
  ['share.on', 'share.off'].forEach((k) => keys.delete(k));
  assert.ok(keys.size > 80, String(keys.size));
  for (const k of keys) assert.ok(k in L.en, `en ${k}`);
  for (const k of Object.keys(L.en)) assert.ok(keys.has(k) || /^share\./.test(k), `unused key ${k}`);
});
test('the page says, in both languages, that it is a synthetic game and models no physics or hardware', () => {
  assert.match(L.en['intro.p2'], /SYNTHETIC: a game on a classical simulation/);
  assert.match(L.en['intro.p2'], /negative energy, antimatter, real membranes, neurons, oscillators or radio hardware/);
  assert.match(L.fr['intro.p2'], /SYNTHÉTIQUE : un jeu sur une simulation classique/);
  assert.match(L.fr['intro.p2'], /l'énergie négative, l'antimatière/);
  assert.match(read('docs/PAIR.md'), /SYNTHETIC classical simulation/);
  assert.match(read('docs/PAIR.md'), /Nothing here models negative energy, antimatter/);
  assert.match(read('pair.js'), /Nothing here models negative energy,\n? ?\*? ?antimatter/);
});
test('new files: attribution and license header, no forbidden words, no other names, no emoji', () => {
  for (const f of FILES) {
    const s = read(f);
    if (!/\.txt$/.test(f)) {
      const text = f === 'pair.html' ? L.en['foot.license'] + L.fr['foot.license'] : s;   // the page's attribution is its footer
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
// every decimal number in a text, normalized to a point (French writes 41,11)
const decimals = (txt) => (txt.match(/\d+[.,]\d+/g) || []).map((m) => m.replace(',', '.'));
test('the numbers quoted on the page and in docs/PAIR.md are the ones in docs/pair-check.txt', () => {
  const rep = read('docs/pair-check.txt'), res = JSON.parse(read('docs/pair-results.json'));
  // the page: every measured number in the evaluation and how-it-works text, in both languages
  for (const lang of ['en', 'fr']) for (const k of Object.keys(L[lang]).filter((x) => /^(eval|how)\./.test(x))) {
    for (const n of decimals(L[lang][k])) assert.ok(rep.includes(n), `${lang} ${k}: ${n} is not in the report`);
  }
  // the headline: H2 means and intervals, as the report rounds them
  const f2 = (x) => x.toFixed(2);
  for (const kind of ['grid', 'off']) {
    const h = res.comparisons.H2[kind];
    for (const v of [h.mean, h.lo, h.hi]) { assert.ok(L.en['eval.p1'].includes(f2(v)), `en H2 ${kind} ${f2(v)}`); assert.ok(L.fr['eval.p1'].includes(f2(v).replace('.', ',')), `fr H2 ${kind}`); }
    assert.ok(h.lo > 0, 'the headline benefit excludes zero (' + kind + ')');
  }
  // the shield's filtering part: quoted with its interval, and that interval crosses zero, so the page says no difference
  for (const kind of ['grid', 'off']) {
    const d = res.decomposition[kind].filtering;
    assert.ok(d.lo < 0 && d.hi > 0, 'filtering interval crosses zero (' + kind + ')');
    for (const v of [d.mean, d.lo, d.hi]) assert.ok(L.en['eval.p3'].includes(f2(v)), `en filtering ${kind} ${f2(v)}`);
  }
  assert.match(L.en['eval.p3'], /no detectable difference/);
  assert.match(L.fr['eval.p3'], /aucune différence détectable/);
  // docs/PAIR.md: every decimal in its results sections comes from the report
  const md = read('docs/PAIR.md');
  const parts = md.split(/\n## /).filter((sec) => /^(Results|Calibration|The shield)/.test(sec));
  assert.ok(parts.length >= 2, 'docs/PAIR.md has results sections');
  for (const sec of parts) for (const n of decimals(sec)) assert.ok(rep.includes(n), `docs/PAIR.md: ${n} is not in the report`);
});
test('the page\'s tuned thresholds are the ones chosen on the calibration seeds', () => {
  const P = require('../pair.js'), res = JSON.parse(read('docs/pair-results.json'));
  assert.equal(P.TUNED.grid, res.chosen.grid['full|2']);
  assert.equal(P.TUNED.off, res.chosen.off['full|2']);
  assert.equal(res.primaryShare, 2);
});
test('reproducibility: the manifest records seeds, versions and SHA-256 hashes that match the files', () => {
  const crypto = require('node:crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
  const m = JSON.parse(read('docs/pair-manifest.json')), pkg = JSON.parse(read('package.json'));
  // the published v0.3.2 evaluation stays as it was; later releases only re-check it
  assert.equal(m.version, '0.3.2');
  assert.equal(m.checkedWith, pkg.version);
  assert.equal(m.command, 'node scripts/pair-check.js --write');
  assert.ok(m.seeds.heldOut.length >= 100, 'at least 100 held-out seeds');
  assert.ok(m.seeds.calibration.length >= 20);
  assert.equal(new Set(m.seeds.heldOut.concat(m.seeds.calibration)).size, m.seeds.heldOut.length + m.seeds.calibration.length, 'the two seed sets are disjoint');
  for (const [f, h] of Object.entries(m.inputs)) assert.equal(sha(f), h, `input ${f} changed since the report was written: run node scripts/pair-check.js --write`);
  for (const [f, h] of Object.entries(m.outputs)) assert.equal(sha(f), h, `output ${f}`);
  assert.ok(m.generatedWith && /^v\d+/.test(m.generatedWith.node));
  const rep = read('docs/pair-check.txt');
  assert.ok(rep.includes('SHA-256 ' + sha('docs/PAIR-PROTOCOL.md')), 'the report names the protocol hash');
  assert.equal(JSON.parse(read('docs/pair-results.json')).protocolSha256, sha('docs/PAIR-PROTOCOL.md'));
  const csv = read('docs/pair-results.csv').trim().split('\n');
  assert.equal(csv[0], 'seed,fade,method,share,threshold,score,true,false,missed,declared,on_fade,held');
  assert.ok(csv.slice(1).every((l) => /^test-\d{3},/.test(l)), 'the CSV holds held-out seeds only');
});
test('the frozen protocol states hypotheses, metrics, grid, seeds and the analysis plan', () => {
  const pr = read('docs/PAIR-PROTOCOL.md');
  for (const h of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) assert.ok(pr.includes(h), h);
  for (const w of [/held-out/i, /calibration seeds/i, /bootstrap/i, /paired/i, /d_z|effect size/i, /off-grid/i, /oracle/i, /random/i]) assert.match(pr, w);
  assert.match(pr, /SYNTHETIC/);
});
test('all seven pages connect: every page links to the other six', () => {
  const pages = ['index.html', 'brain.html', 'quorum.html', 'reverse.html', 'pair.html', 'watch.html', 'pulse.html'];
  for (const p of pages) {
    const html = read(p);
    for (const q of pages) if (q !== p) assert.ok(html.includes(`href="${q}"`), `${p} links to ${q}`);
  }
});
