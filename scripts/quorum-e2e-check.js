'use strict';
/*
 * Headless Chrome playthrough of dist/quorum.html: solves Build and Break levels by clicking, in
 * English and French, at phone and desktop sizes (and once in high contrast and once by keyboard),
 * records console errors, external requests, horizontal overflow and untranslated strings, checks
 * the stars the page awards, and writes screenshots and a JSON report.
 *   node scripts/quorum-e2e-check.js [port]
 * Needs playwright-core (set PLAYWRIGHT_CORE to its path if it is not resolvable) and a Chrome
 * binary (set CHROME to its path; default /usr/bin/google-chrome). Not part of `node --test`.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = parseInt(process.argv[2], 10) || 8767;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const served = [];
const server = http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/quorum.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'dist', 'quorum.html'))); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };
const stars = (s) => (s.match(/\u2605/g) || []).length;

// one step of play: a level, the clicks that set it up, the button to press, and the stars expected
async function play(page, step) {
  await page.click(`[data-level="${step.level}"]`);
  for (const c of step.clicks || []) await page.click(c);
  for (const id of step.units || []) {
    if (step.keyboard) { await page.focus(`#diagram [data-id="${id}"]`); await page.keyboard.press('Enter'); }
    else await page.click(`#diagram [data-id="${id}"]`);
  }
  await page.click(step.press);
  await page.waitForFunction(() => {
    const t = document.getElementById('btn-test');
    return (!t || !t.disabled) && /[\u2605\u2606]/.test(document.getElementById('res-stars').textContent) &&
      !/\.\.\.|episodes|épisodes sur/.test(document.getElementById('res-text').textContent.slice(0, 60));
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1300);   // let the layer-by-layer reveal finish
  const got = await page.evaluate(() => ({
    stars: document.getElementById('res-stars').textContent,
    text: document.getElementById('res-text').textContent,
    faultyDrawn: document.querySelectorAll('#diagram [data-faulty="1"]').length,
    membranesDrawn: document.querySelectorAll('#diagram .membrane').length,
    symbols: document.querySelectorAll('#diagram [data-sym]').length
  }));
  if (step.shot) await page.screenshot({ path: path.join(shots, step.shot + '.png'), fullPage: step.full !== false });
  return Object.assign({ level: step.level, expect: step.stars, ok: stars(got.stars) === step.stars }, got);
}

async function runCase(browser, lang, view, opts, steps) {
  const name = `quorum-${lang}-${view}${opts.hc ? '-contrast' : ''}`;
  const ctx = await browser.newContext(Object.assign({ locale: lang === 'fr' ? 'fr-CA' : 'en-CA' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}/quorum.html${lang === 'fr' ? '#l=fr' : ''}`);
  if (opts.hc) await page.click('#btn-contrast');
  const t0 = Date.now(), played = [];
  for (const s of steps) played.push(await play(page, Object.assign({}, s, { shot: s.shot ? `${name}-${s.shot}` : null })));
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => {
    const se = document.scrollingElement;
    return {
      lang: document.documentElement.lang, title: document.title,
      overflowX: se.scrollWidth > window.innerWidth + 1,
      hc: document.documentElement.classList.contains('hc'),
      untranslated: Array.from(document.querySelectorAll('[data-i18n]')).filter((el) => !el.textContent.trim()).map((el) => el.getAttribute('data-i18n')),
      share: document.getElementById('share').textContent
    };
  });
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
  await ctx.close();
  const ok = errors.length === 0 && external.length === 0 && !info.overflowX && info.untranslated.length === 0 &&
    info.lang === lang && info.hc === !!opts.hc && played.every((p) => p.ok);
  return Object.assign({ name, ok, wallMs: ms, errors, external, opts, played }, info);
}

const inc = (id, n) => Array(n).fill(`#${id}-inc`);
(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const cases = [
    ['en', 'desktop', {}, [
      { level: 'b1', clicks: inc('m', 2), press: '#btn-test', stars: 3 },                         // 3x1, 1 int = par 6
      { level: 'b3', clicks: [], press: '#btn-test', stars: 0, shot: 'fooled' },                   // the 1x1 start is fooled
      { level: 'b3', clicks: inc('m', 4).concat(inc('c', 2), ['#stab']), press: '#btn-test', stars: 3, shot: 'build' }, // 5x3, 1 int, inh = par 21
      { level: 'x2', units: ['i0'], press: '#btn-attack', stars: 3 },
      { level: 'x4', press: '#btn-claim', stars: 3 },
      { level: 'x5', units: ['i0', 'i1'], press: '#btn-attack', stars: 3, shot: 'break' }
    ]],
    ['fr', 'phone', {}, [
      { level: 'b2', clicks: inc('c', 2).concat(['#stab']), press: '#btn-test', stars: 3 },        // 1x3, 1 int, inh = par 9
      { level: 'x1', units: ['s0.0', 's0.1'], press: '#btn-attack', stars: 3, keyboard: true, shot: 'break' },
      { level: 'x6', press: '#btn-claim', stars: 3 }
    ]],
    ['en', 'phone', {}, [
      { level: 'b4', clicks: inc('c', 2).concat(inc('i', 2), ['#stab']), press: '#btn-test', stars: 3, shot: 'build' }, // 1x3, 3 int, inh = par 11
      { level: 'x3', units: ['s0.0', 's0.1', 's1.0'], press: '#btn-attack', stars: 0 },            // 3 of 4 faults: not enough
      { level: 'x3', units: ['s1.1'], press: '#btn-attack', stars: 2 }                             // second try wins: no first-try star
    ]],
    ['en', 'desktop', { hc: true }, [
      { level: 'x7', units: ['g0', 'g1', 'g2'], press: '#btn-attack', stars: 3, shot: 'break' },
      { level: 'b7', clicks: inc('c', 4).concat(inc('i', 4), ['#stab']), press: '#btn-test', stars: 3 } // 1x5, 5 int, inh = par 17
    ]]
  ];
  const report = [];
  for (const [lang, view, opts, steps] of cases) report.push(await runCase(browser, lang, view, opts, steps));
  await browser.close();
  server.close();
  const out = { version: require('../quorum.js').VERSION, chrome: process.env.CHROME || '/usr/bin/google-chrome', allOk: report.every((r) => r.ok), servedOther: served, cases: report };
  fs.writeFileSync(path.join(root, 'docs', 'quorum-e2e-report.json'), JSON.stringify(out, null, 2) + '\n');
  for (const r of report) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.errors.length} errors, ${r.external.length} external requests, overflow ${r.overflowX}, ${r.wallMs} ms`);
    for (const p of r.played) console.log(`     ${p.ok ? 'ok  ' : 'FAIL'} ${p.level}: ${p.stars} (expected ${p.expect}), ${p.membranesDrawn} membranes, ${p.faultyDrawn} faulty, ${p.symbols} symbols | ${p.text.slice(0, 150)}`);
    for (const e of r.errors) console.log('     ' + e);
  }
  process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
