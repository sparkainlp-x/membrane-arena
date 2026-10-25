'use strict';
/*
 * Headless Chrome check of dist/brain.html: plans and runs in English and French at phone and desktop
 * sizes (and once in high contrast), records console errors, external requests, horizontal overflow,
 * that the diagram has one shape per planned membrane, and writes screenshots and a JSON report.
 *   node scripts/brain-e2e-check.js [port]
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
const port = parseInt(process.argv[2], 10) || 8766;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const served = [];
const server = http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/brain.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'dist', 'brain.html'))); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };

async function runCase(browser, lang, view, opts) {
  const name = `brain-${lang}-${view}${opts.hc ? '-contrast' : ''}`;
  const ctx = await browser.newContext(Object.assign({ locale: lang === 'fr' ? 'fr-CA' : 'en-CA' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}/brain.html${lang === 'fr' ? '#l=fr' : ''}`);
  if (opts.hc) await page.click('#btn-contrast');
  await page.selectOption('#f', opts.f);
  await page.selectOption('#g', opts.g);
  await page.selectOption('#h', opts.h);
  await page.selectOption('#fs', opts.fs);
  await page.selectOption('#fc', opts.fc);
  await page.selectOption('#episodes', '40');
  const t0 = Date.now();
  await page.click('#btn-run');
  await page.waitForFunction(() => document.querySelector('#results-body tr') && !document.getElementById('btn-run').disabled, null, { timeout: 120000 });
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => {
    const se = document.scrollingElement;
    return {
      lang: document.documentElement.lang, title: document.title,
      membranesDrawn: document.querySelectorAll('#diagram .membrane').length,
      microtubulesDrawn: document.querySelectorAll('#diagram .mt').length,
      faultyDrawn: document.querySelectorAll('#diagram [data-faulty="1"]').length,
      planTotal: document.getElementById('plan-total').textContent,
      checks: Array.from(document.querySelectorAll('#checks li')).map((li) => li.textContent),
      results: Array.from(document.querySelectorAll('#results-body tr')).map((tr) => Array.from(tr.children).map((c) => c.textContent)),
      status: document.getElementById('run-status').textContent,
      overflowX: se.scrollWidth > window.innerWidth + 1,
      hc: document.documentElement.classList.contains('hc'),
      untranslated: Array.from(document.querySelectorAll('[data-i18n]')).filter((el) => !el.textContent.trim()).map((el) => el.getAttribute('data-i18n'))
    };
  });
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
  await ctx.close();
  const counts = info.planTotal.match(/\d+/g).map(Number);
  const ok = errors.length === 0 && external.length === 0 && !info.overflowX && info.untranslated.length === 0 &&
    info.membranesDrawn === counts[0] && info.microtubulesDrawn === counts[1] && info.lang === lang && info.hc === !!opts.hc;
  return Object.assign({ name, ok, wallMs: ms, errors, external, opts }, info);
}

(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const cases = [
    ['en', 'desktop', { f: '1', g: '1', h: '0', fs: '1', fc: '1' }],
    ['fr', 'desktop', { f: '2', g: '1', h: '1', fs: '2', fc: '0' }],
    ['en', 'phone', { f: '1', g: '1', h: '0', fs: '0', fc: '0' }],
    ['fr', 'phone', { f: '1', g: '0', h: '0', fs: '1', fc: '0' }],
    ['en', 'desktop', { f: '2', g: '2', h: '1', fs: '3', fc: '0', hc: true }]
  ];
  const report = [];
  for (const [lang, view, opts] of cases) report.push(await runCase(browser, lang, view, opts));
  await browser.close();
  server.close();
  const out = { version: require('../brain.js').VERSION, chrome: process.env.CHROME || '/usr/bin/google-chrome', allOk: report.every((r) => r.ok), servedOther: served, cases: report };
  fs.writeFileSync(path.join(root, 'docs', 'brain-e2e-report.json'), JSON.stringify(out, null, 2) + '\n');
  for (const r of report) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.membranesDrawn} membranes, ${r.microtubulesDrawn} microtubules, ${r.faultyDrawn} faulty drawn, ${r.errors.length} errors, ${r.external.length} external requests, overflow ${r.overflowX}, ${r.wallMs} ms`);
  process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
