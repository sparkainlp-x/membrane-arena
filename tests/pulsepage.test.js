'use strict';
// Wave Pulse page, strings, docs and evaluation files. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildPulse } = require('../build.js');
const P = require('../pulse.js');
const L = require('../pulse-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const FILES = ['pulse.html', 'pulse.css', 'pulse.js', 'pulse-i18n.js', 'pulseui.js', 'pulse-calib.js',
  'scripts/pulse-check.js', 'scripts/pulse-e2e-check.js', 'docs/PULSE.md', 'docs/PULSE-PROTOCOL.md',
  'tests/pulse.test.js', 'tests/pulsepage.test.js'];
// word lists are assembled from fragments so this file does not contain the words it forbids
const join = (parts) => new RegExp('\\b(' + parts.map((p) => p.join('')).join('|') + ')', 'i');
const BANNED = join([['pro', 'ven'], ['valid', 'ated'], ['production', '-ready'], ['quan', 'tum'], ['real-world ', 'performance'],
  ['self-', 'heal'], ['light-', 'sculpt'], ['levit', 'at'], ['ana', 'morph']]);
const NAMES = join([['l', 'ee\\b'], ['la', 'ha\\b'], ['bel', 'kadi'], ['ti', 'su\\b']]);
const EMOJI = /\p{Extended_Pictographic}/u;
const placeholders = (s) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(',');

test('the Wave Pulse page is one self-contained file (no external files, no network APIs, no storage)', () => {
  const html = buildPulse();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\(|localStorage|sessionStorage|indexedDB)/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html), 'only the SVG namespace URL appears');
  assert.ok(html.length < 250000, `under 250 KB (${html.length})`);
  assert.ok(html.includes('ArenaPulseCalib') || html.includes(String(P.calib().rho)), 'the fitted calibration is inlined');
});

test('dist/pulse.html, when present, matches a fresh build', { skip: !fs.existsSync(path.join(root, 'dist', 'pulse.html')) }, () => {
  assert.equal(read('dist/pulse.html'), buildPulse());
});

test('scripts load in dependency order, the calibration before the logic', () => {
  const html = read('pulse.html');
  const order = ['baselines.js', 'game.js', 'pulse-calib.js', 'pulse.js', 'pulse-i18n.js', 'pulseui.js'];
  const at = order.map((f) => html.indexOf(`<script src="${f}"></script>`));
  at.forEach((i, k) => assert.ok(i > 0, order[k] + ' is loaded'));
  for (let k = 1; k < at.length; k++) assert.ok(at[k] > at[k - 1], `${order[k]} after ${order[k - 1]}`);
});

test('every element id used by pulseui.js exists in pulse.html, once', () => {
  const html = read('pulse.html'), ui = read('pulseui.js');
  const ids = new Set([...ui.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 25, `${ids.size} ids`);
  for (const id of ids) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, '#' + id);
});

test('English and French have the same keys and placeholders, and every key the page uses exists', () => {
  assert.deepEqual(Object.keys(L.fr).sort(), Object.keys(L.en).sort());
  for (const k of Object.keys(L.en)) {
    if (k !== 'end.rank.none') assert.ok(L.en[k].length && L.fr[k].length, k + ' is not empty');
    assert.equal(placeholders(L.fr[k]), placeholders(L.en[k]), k + ' placeholders');
  }
  const used = new Set();
  for (const f of ['pulse.html', 'pulseui.js', 'pulse.js']) {
    const s = read(f);
    for (const m of s.matchAll(/data-i18n(?:-[a-z]+)?="([a-zA-Z0-9.]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/\bt\('([a-zA-Z0-9.]+)'/g)) used.add(m[1]);
  }
  P.STAGES.forEach((s) => { used.add('stage.' + s.id); used.add('banner.' + s.id); });
  [...new Set(P.SETTINGS.map((s) => s.kind))].forEach((k) => used.add('kind.' + k));
  ['beatLocator', 'tieLocator', 'beatIntuition', 'learning', 'lost', 'none'].forEach((r) => used.add('end.rank.' + r));
  ['format', 'check', 'seed', 'range'].forEach((e) => used.add('verify.why.' + e));
  for (const k of used) if (!k.endsWith('.') && k !== 'S') assert.ok(k in L.en, 'missing key ' + k);
  assert.ok(used.size > 90, `${used.size} keys used`);
});

test('the page says, in both languages, that it is synthetic and claims no holography or real floor', () => {
  assert.equal(L.en['page.tag'], 'SYNTHETIC');
  assert.equal(L.fr['page.tag'], 'SYNTHÉTIQUE');
  assert.match(L.en['intro.p3'], /^SYNTHETIC: a game on a small classical simulation\. It is not a model of a real arena floor, real pressure waves, holography or any physical system\. The Great Wave look is a colour style only\.$/);
  assert.match(L.fr['intro.p3'], /^SYNTHÉTIQUE\s*:\s*un jeu sur une petite simulation classique\. Ce n’est pas un modèle d’un vrai sol d’arène/);
  assert.match(read('docs/PULSE.md'), /^# Wave Pulse\n\n\*\*SYNTHETIC\.\*\* .*not a model of a real arena floor, real pressure waves, holography/);
  assert.match(read('docs/PULSE-PROTOCOL.md'), /SYNTHETIC/);
  // every mention of holography, in both languages and in the docs, is a denial
  for (const lang of ['en', 'fr']) for (const [k, v] of Object.entries(L[lang])) {
    for (const sentence of v.split(/(?<=\.)\s+/)) {
      if (/holograph/i.test(sentence)) assert.match(sentence, /\bnot\b|n’est pas|ni d’|aucun/, `${lang} ${k}: ${sentence}`);
    }
  }
  for (const f of ['docs/PULSE.md', 'README.md', 'CHANGELOG.md']) {
    for (const sentence of read(f).split(/(?<=[.;])\s+/)) {
      if (/holograph/i.test(sentence)) assert.match(sentence, /\bnot\b|\bno\b/i, `${f}: ${sentence.slice(0, 120)}`);
    }
  }
});

test('new files: attribution and license, no forbidden words, no other names, no emoji', () => {
  for (const f of FILES) {
    const s = read(f);
    if (!/\.md$/.test(f) || f === 'docs/PULSE.md') {
      assert.ok(s.includes('Jean-François Brisson, Spark AI NLP') || s.includes('Jean-Fran\\u00E7ois Brisson, Spark AI NLP'), f + ' names the author');
      assert.ok(s.includes('AGPL-3.0'), f + ' names the license');
    }
    if (f !== 'tests/pulsepage.test.js') {
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

test('the rules on the page and in docs/PULSE.md are the ones the game uses', () => {
  const how = L.en['how.p1'] + ' ' + L.en['how.p4'], doc = read('docs/PULSE.md');
  assert.ok(how.includes(`${P.W} × ${P.H} cells`) && doc.includes(`${P.W} × ${P.H}`));
  assert.ok(how.includes(`nominal ${P.C_NOMINAL} cells per tick`) && doc.includes(`nominal speed ${P.C_NOMINAL} cells per tick`));
  assert.ok(how.includes(`${P.CHEER.mMin} to ${P.CHEER.mMax} smaller bumps`) && doc.includes(`${P.CHEER.mMin} to ${P.CHEER.mMax} smaller bumps`));
  assert.ok(how.includes('100 minus 12 per cell') && P.points(1) === 88 && doc.includes('100 minus 12 per cell'));
  assert.ok(how.includes(`within ${P.HIT} cells`) && doc.includes(`within ${P.HIT} cells`));
  assert.ok(how.includes(`${P.TOTAL / P.STAGES.length}`) || L.en['intro.p2'].includes(`${P.TOTAL} pulses in ${P.STAGES.length} stages`));
  assert.ok(doc.includes(`damping ${P.GAMMA}`) && doc.includes(`${P.TICKS} ticks`) && doc.includes(`tick ${P.PRE}`));
  assert.ok(doc.includes(`calm ${P.NOISE.calm}, loud ${P.NOISE.loud}`));
  assert.ok(doc.includes(`${Math.round(P.PATCH.f0 * 100)}-${Math.round(P.PATCH.f1 * 100)}% of the normal speed`));
  const cal = P.calib();
  assert.ok(doc.includes(`k = ${cal.k}`) && doc.includes(`c = ${cal.c}`) && doc.includes(`rho = ${cal.rho.toFixed(1)}`));
  assert.ok(L.en['eval.p1'].includes(`k = ${cal.k}`) && L.en['eval.p1'].includes(`c = ${cal.c} cells per tick`));
});

test('the page and docs quote the report: every decimal in the evaluation section is in docs/pulse-check.txt', () => {
  const report = read('docs/pulse-check.txt');
  const nums = (s) => (s.replace(/(\d),(\d)/g, '$1.$2').match(/[+-]?\d+\.\d+/g) || []).map((x) => x.replace(/^\+/, ''));
  for (const lang of ['en', 'fr']) {
    const ev = ['eval.p1', 'eval.p2', 'eval.p3', 'eval.p4', 'eval.p5'].map((k) => L[lang][k]).join(' ');
    const found = nums(ev);
    assert.ok(found.length >= 20, `${lang}: ${found.length} numbers`);
    for (const x of found) assert.ok(report.includes(x), `${lang} eval quotes ${x}, which is not in the report`);
  }
  const doc = read('docs/PULSE.md');
  const evalPart = doc.slice(doc.indexOf('## How good is the locator?'), doc.indexOf('## Reproduce every number'));
  for (const x of nums(evalPart)) assert.ok(report.includes(x), `docs/PULSE.md quotes ${x}, which is not in the report`);
  const readme = read('README.md'), sec = readme.slice(readme.indexOf('## Wave Pulse'), readme.indexOf('## The score'));
  for (const x of nums(sec)) assert.ok(report.includes(x), `README quotes ${x}, which is not in the report`);
  // a hypothesis is only called supported because its interval is above zero
  const res = require('../docs/pulse-results.json');
  assert.equal(res.hypotheses.length, 6);
  for (const h of res.hypotheses) assert.equal(h.supported, h.ci[0] > 0 && h.pHolm < 0.05, h.id);
  assert.ok(res.hypotheses.every((h) => h.supported), 'the page says all six held');
});

test('the evaluation is reproducible: the manifest names the seeds, versions and SHA-256 hashes of its files', () => {
  const m = require('../docs/pulse-manifest.json'), res = require('../docs/pulse-results.json');
  assert.equal(m.version, '0.3.4'); // the evaluation published with v0.3.4
  assert.equal(m.checkedWith, P.VERSION);
  assert.equal(m.command, 'node scripts/pulse-check.js --write');
  assert.equal(m.seeds.calibration.length, 200);
  assert.equal(m.seeds.heldOut.length, 200);
  assert.equal(m.seeds.calibration[0], 'pcal-000'); assert.equal(m.seeds.heldOut[199], 'ptest-199');
  const cal = new Set(m.seeds.calibration);
  assert.ok(m.seeds.heldOut.every((s) => !cal.has(s)), 'held-out seeds are never calibration seeds');
  assert.equal(m.settings.length, 16);
  for (const [f, h] of Object.entries(m.inputs)) assert.equal(sha(f), h, f + ' is the input the outputs were made from');
  for (const [f, h] of Object.entries(m.outputs)) assert.equal(sha(f), h, f + ' matches its recorded hash');
  assert.equal(res.protocolSha256, sha('docs/PULSE-PROTOCOL.md'));
  assert.ok(read('docs/pulse-check.txt').includes(sha('docs/PULSE-PROTOCOL.md')));
});

test('the frozen protocol states the model, seeds, methods, hypotheses and analysis before the results', () => {
  const p = read('docs/PULSE-PROTOCOL.md');
  for (const s of ['pcal-000', 'ptest-199', 'H1', 'H6', 'bootstrap', 'Holm', 'Wilson', 'early-sensor', 'nearest', 'random', 'noise-free']) {
    assert.ok(p.toLowerCase().includes(s.toLowerCase()), 'protocol mentions ' + s);
  }
  assert.ok(!p.includes('0.62 ['), 'the protocol holds no results');
});

test('README and CHANGELOG describe Wave Pulse, and the workflows ship and verify it', () => {
  const readme = read('README.md');
  const sec = readme.slice(readme.indexOf('## Wave Pulse'), readme.indexOf('## The score'));
  assert.ok(sec.length > 500, 'README section');
  assert.ok(sec.includes('dist/pulse.html') && sec.includes('docs/PULSE.md') && sec.includes('docs/PULSE-PROTOCOL.md'));
  assert.ok(readme.includes('scripts/pulse-e2e-check.js') && readme.includes('node scripts/pulse-check.js --verify'));
  const log = read('CHANGELOG.md'), top = log.slice(0, log.indexOf('## 0.3.3'));
  assert.match(top, /Wave Pulse/);
  assert.match(read('.github/workflows/pages.yml'), /cp dist\/pulse\.html _site\/pulse\.html/);
  const ci = read('.github/workflows/tests.yml');
  assert.match(ci, /node scripts\/pulse-check\.js --verify/);
  assert.match(ci, /git diff --exit-code [^\n]*dist\/pulse\.html/);
});

test('Wave Pulse links the six other pages, and each of them links back with a label in both languages', () => {
  const html = read('pulse.html');
  for (const q of ['index.html', 'brain.html', 'quorum.html', 'reverse.html', 'pair.html', 'watch.html']) {
    assert.ok(html.includes(`href="${q}"`), 'Wave Pulse links to ' + q);
    assert.ok(read(q).includes('href="pulse.html"'), q + ' links to Wave Pulse');
  }
  for (const f of ['brain-i18n.js', 'quorum-i18n.js', 'reverse-i18n.js', 'pair-i18n.js', 'watch-i18n.js']) {
    const LL = require('../' + f).LANGS || require('../' + f);
    const en = LL.en || LL.LANGS?.en, fr = LL.fr || LL.LANGS?.fr;
    assert.ok(en && fr, f + ' exports both languages');
    assert.ok(Object.keys(en).some((k) => /pulse/i.test(k)) && Object.keys(fr).some((k) => /pulse/i.test(k)), f + ' has a Wave Pulse label');
  }
});
