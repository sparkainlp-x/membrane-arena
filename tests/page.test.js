'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../build.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const SOURCES = ['index.html', 'style.css', 'baselines.js', 'game.js', 'stats.js', 'lab.js', 'i18n.js', 'scene.js', 'charts.js', 'labui.js', 'app.js', 'build.js', 'scripts/make-baselines.js', 'scripts/port-check.js', 'scripts/scheme-check.js', 'scripts/evolve-check.js', 'scripts/e2e-check.js', 'scripts/serve.js', 'brain.html', 'brain.css', 'brain.js', 'brain-i18n.js', 'brainui.js', 'scripts/brain.js', 'scripts/brain-check.js'];
// word lists are assembled from fragments so this file does not contain the words it forbids
const join = (parts) => new RegExp('\\b(' + parts.map((p) => p.join('')).join('|') + ')\\b', 'i');
const BANNED = join([['pro', 'ven'], ['valid', 'ated'], ['production', '-ready'], ['quantum ', 'advantage'], ['real-world ', 'performance']]);
const NAMES = join([['l', 'ee'], ['la', 'ha'], ['bel', 'kadi'], ['ti', 'su']]);
// The README and CHANGELOG carry the lineage credit, so the credited name may appear there but no other collaborator name.
const CREDIT_DOCS = new Set(['README.md', 'CHANGELOG.md']);
const NAMES_IN_CREDIT_DOCS = join([['la', 'ha'], ['bel', 'kadi'], ['ti', 'su']]);
const EMOJI = /\p{Extended_Pictographic}/u;

test('built page is one self-contained file (no external files, no network APIs)', () => {
  const html = build();
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/<link[^>]*rel=["']stylesheet/i.test(html), 'no external stylesheet');
  assert.ok(!/(fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|import\()/.test(html));
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)[^\s"')]+/.test(html.replace(/<title>[^<]*<\/title>/, '')), 'only the SVG namespace URL appears');
  assert.ok(!/googletagmanager|google-analytics|cdn\.|fonts\.googleapis/i.test(html));
  assert.ok(html.length < 450000, 'one file, no dependencies, under 450 KB');
});

test('dist/index.html, when present, matches a fresh build', { skip: !fs.existsSync(path.join(root, 'dist', 'index.html')) }, () => {
  assert.equal(read('dist/index.html'), build());
});

test('no banned wording, emoji or forbidden names anywhere in the shipped sources and documents', () => {
  for (const f of SOURCES.concat(['README.md', 'DESIGN.md', 'CHANGELOG.md', 'CITATION.cff', '.zenodo.json', 'docs/port-check.txt', 'docs/scheme-check.txt', 'docs/evolve-check.txt', 'docs/brain-check.txt', 'data/SOURCE.txt'])) {
    if (!fs.existsSync(path.join(root, f))) continue;
    const s = read(f);
    assert.ok(!BANNED.test(s), `banned word in ${f}`);
    assert.ok(!EMOJI.test(s), `emoji in ${f}`);
    assert.ok(!(CREDIT_DOCS.has(f) ? NAMES_IN_CREDIT_DOCS : NAMES).test(s), `forbidden name in ${f}`);
  }
});

test('every element id used by app.js exists in index.html', () => {
  const html = read('index.html'), app = read('app.js') + read('labui.js');
  const used = new Set();
  for (const m of app.matchAll(/\$\('([\w-]+)'\)/g)) used.add(m[1]);
  assert.ok(used.size > 100);
  for (const id of used) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  for (const i of [0, 1, 2]) for (const p of ['m-gain-', 'm-fill-', 'm-eff-', 'm-val-']) assert.ok(html.includes(`id="${p}${i}"`));
  for (const id of ['th', 'c', 'g', 'fcost', 'w']) assert.ok(html.includes(`id="${id}-val"`));
});

test('script load order in index.html: baselines, game, stats, lab, i18n, scene, charts, labui, app', () => {
  const html = read('index.html');
  const order = [...html.matchAll(/<script src="([\w.]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(order, ['baselines.js', 'game.js', 'stats.js', 'lab.js', 'i18n.js', 'scene.js', 'charts.js', 'labui.js', 'app.js']);
});

test('every data-i18n key in index.html and every literal key used by app.js exists in English', () => {
  const en = require('../i18n.js').LANGS.en, html = read('index.html'), app = read('app.js') + read('labui.js');
  const used = new Set();
  for (const m of html.matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
  for (const m of app.matchAll(/\bt\('([a-z_]+\.[\w.]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 150);
  for (const k of used) assert.ok(k in en, `missing key ${k}`);
});

test('accessibility basics: language attribute, viewport, labelled controls, live region, dialog, reduced motion', () => {
  const html = read('index.html'), css = read('style.css');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  for (const id of ['scheme', 'w', 'th', 'c', 'g', 'fcost', 'speed']) assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `label for ${id}`);
  for (const id of ['t-shield', 't-amp', 't-stab', 't-evolve']) assert.match(html, new RegExp(`<label class="switch"><input id="${id}"`));
  assert.match(html, /role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="meter"/);
  assert.match(html, /<canvas id="arena" role="img"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible/);
  assert.match(html, /class="skip"/);
  assert.match(css, /min-height: 44px/);
});

test('brand colours are present (gold on navy, cyan accent)', () => {
  const css = read('style.css').toLowerCase();
  assert.ok(css.includes('#c9a84c'));
  assert.ok(css.includes('#0a1330'));
  assert.ok(css.includes('#40d0e0'));
});

test('the page states privacy and the synthetic label in the markup and in every language', () => {
  const html = read('index.html'), I = require('../i18n.js');
  assert.match(html, /data-i18n="tag\.synthetic"/);
  assert.match(html, /data-i18n="footer\.disclaimer"/);
  assert.match(html, /data-i18n="footer\.privacy"/);
  for (const l of Object.keys(I.LANGS)) assert.match(I.LANGS[l]['footer.disclaimer'], /SYNTH/);
});

test('app.js guards what it reads: hash through parseHash, storage through sanitizeStore, no innerHTML from data', () => {
  const app = read('app.js');
  assert.match(app, /G\.parseHash\(window\.location\.hash\)/);
  assert.match(app, /G\.sanitizeStore\(JSON\.parse/);
  assert.match(app, /try \{[^}]*localStorage/);
  assert.ok(!/innerHTML\s*=\s*[^'"\s]/.test(app.replace(/innerHTML = ''/g, '')), 'innerHTML is only used to clear');
  assert.ok(!/eval\(|new Function|document\.write/.test(app));
});

test('metadata: licence is the full AGPL-3.0 text, package and citation agree on name and version', () => {
  const lic = read('LICENSE');
  assert.match(lic, /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
  assert.ok(lic.length > 30000);
  const pkg = JSON.parse(read('package.json')), G = require('../game.js');
  assert.equal(pkg.version, G.VERSION);
  assert.equal(pkg.license, 'AGPL-3.0-only');
  if (fs.existsSync(path.join(root, 'CITATION.cff'))) {
    const cff = read('CITATION.cff');
    assert.match(cff, new RegExp('version: ' + G.VERSION.replace(/\./g, '\\.')));
    assert.match(cff, /license: AGPL-3\.0-only/);
    assert.match(cff, /0009-0000-9778-5374/);
    const z = JSON.parse(read('.zenodo.json'));
    assert.equal(z.version, G.VERSION);
    assert.equal(z.license, 'AGPL-3.0-only');
    assert.equal(z.creators.length, 1);
  }
});

test('CI workflows exist, are local files only, and run the tests on supported Node versions', () => {
  const t = read('.github/workflows/tests.yml');
  assert.match(t, /node-version: \[20, 22, 24\]/);
  assert.match(t, /node --test tests\//);
  assert.match(t, /node build\.js/);
  assert.match(read('.github/workflows/pages.yml'), /upload-pages-artifact/);
});

test('app.js builds the scheme options before it applies a hash preset (a preset selects an option)', () => {
  const app = read('app.js');
  const boot = app.slice(app.indexOf('function init()'));
  assert.match(boot, /buildSchemeOptions\(\);\s+applyHash\(\);/);
});

test('pausing at a generation boundary resumes into the next generation (no stuck run)', () => {
  const app = read('app.js');
  assert.match(app, /atBoundary = true/);
  assert.match(app, /if \(atBoundary\) \{ atBoundary = false; nextGeneration\(\); \}/);
});

test('the Lab: six tabs with a tablist, one panel each, arrow-key handling, and every chart canvas has a text equivalent', () => {
  const html = read('index.html'), ui = read('labui.js');
  assert.match(html, /role="tablist"/);
  for (const k of ['meters', 'lab', 'ens', 'ab', 'missions', 'method']) {
    assert.match(html, new RegExp(`id="tab-${k}"[^>]*role="tab"[^>]*aria-controls="panel-${k}"`));
    assert.match(html, new RegExp(`id="panel-${k}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-${k}"`));
  }
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(ui.includes(`'${key}'`));
  for (const m of html.matchAll(/<canvas id="([\w-]+)"[^>]*aria-describedby="([\w-]+)"/g)) assert.ok(html.includes(`id="${m[2]}"`), `description for ${m[1]}`);
  const lab = html.match(/<canvas id="(lab-[\w]+|ens-chart|ab-chart|rail|sci)"/g) || [];
  assert.ok(lab.length >= 11, 'all instruments are canvases');
  for (const m of lab) assert.match(html, new RegExp(m.replace(/[<>"]/g, (c) => (c === '"' ? '"' : '\\' + c)) + '[^>]*aria-describedby='), `${m} is described`);
  assert.ok(!/innerHTML\s*=\s*[^'"\s]/.test(ui.replace(/innerHTML = ''/g, '')), 'innerHTML only clears');
  assert.ok(!/eval\(|new Function|document\.write/.test(ui));
});

test('motion and contrast: system setting plus a page switch, high-contrast stylesheet, intro skippable, no motion needed to use anything', () => {
  const css = read('style.css'), app = read('app.js'), html = read('index.html');
  assert.match(css, /html\.hc /);
  assert.match(css, /html\.still /);
  assert.match(css, /forced-colors: active/);
  assert.match(app, /sysReduced \|\| still/);
  assert.match(app, /Escape' && arena && arena\.stats\(\)\.intro/);
  assert.match(app, /if \(!store\.introSeen && !reducedNow\(\)/);
  assert.match(html, /id="btn-motion"/);
  assert.match(html, /id="btn-contrast"/);
  assert.match(html, /aria-describedby="arena-desc"/);
});

test('closing the tour returns the focus to the Run button (a hidden button must not keep it)', () => {
  const app = read('app.js');
  assert.match(app, /function closeTutorial\(\) \{[^}]*contains\(document\.activeElement\)[^}]*\$\('btn-run'\)\.focus\(\)/s);
});

test('letter shortcuts work while a button has focus; Space stays with the button', () => {
  const app = read('app.js');
  assert.match(app, /tag === 'INPUT' \|\| tag === 'SELECT' \|\| tag === 'TEXTAREA'\) return;/);
  assert.match(app, /\(tag === 'BUTTON' \|\| tag === 'SUMMARY' \|\| tag === 'A'\) && \(e\.key === ' ' \|\| e\.key === 'Enter'\)/);
});

test('the method panel names what was measured, what is a design choice and what is not verified', () => {
  const I = require('../i18n.js');
  for (const l of Object.keys(I.LANGS)) {
    const L = I.LANGS[l];
    for (const k of ['method.measured', 'method.design', 'method.unverified']) assert.ok(L[k] && L[k].length > 4, `${l} ${k}`);
  }
  const html = read('index.html');
  for (const k of ['method.measured', 'method.design', 'method.unverified']) assert.ok(html.includes(`data-i18n="${k}"`));
});

test('the DOI named in the README matches the one in CITATION.cff, and the page names no DOI of its own', () => {
  const readme = read('README.md'), cff = read('CITATION.cff');
  const v = cff.match(/value: "(10\.5281\/zenodo\.\d+)"/), concept = cff.match(/^doi: "(10\.5281\/zenodo\.\d+)"/m);
  assert.ok(v && concept, 'CITATION.cff carries a version DOI and a concept DOI');
  assert.ok(readme.includes(v[1]) && readme.includes(concept[1]));
  assert.notEqual(v[1], concept[1]);
});
