'use strict';
/*
 * Headless Chrome check of dist/index.html: plays a full round in English and French at phone and
 * desktop sizes, records console errors, external requests, frame timing, and writes screenshots.
 *   node scripts/e2e-check.js [port]
 * Needs playwright-core (set PLAYWRIGHT_CORE to its path if it is not resolvable) and a Chrome
 * binary (set CHROME to its path; default /usr/bin/google-chrome). Not part of `node --test`.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = parseInt(process.argv[2], 10) || 8765;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const server = http.createServer((req, res) => {
  const f = path.join(root, 'dist', 'index.html');
  if (req.url.split('#')[0].split('?')[0] === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(f)); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const served = [];

const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };
const report = [];

async function runCase(browser, lang, view, opts) {
  opts = opts || {};
  const name = `${lang}-${view}${opts.reduced ? '-reduced' : ''}`;
  const ctx = await browser.newContext(Object.assign({ locale: lang === 'fr' ? 'fr-CA' : 'en-CA', reducedMotion: opts.reduced ? 'reduce' : 'no-preference' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [], requests = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { requests.push(r.url()); if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.addInitScript(() => {
    window.__frames = []; let last = 0;
    const tick = (ts) => { if (last) window.__frames.push(ts - last); last = ts; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.goto(`http://127.0.0.1:${port}/#l=${lang}&s=e2e${lang}`);
  await page.waitForFunction(() => window.__arena && document.querySelector('#hud-gen').textContent.length > 0);
  await page.screenshot({ path: path.join(shots, `${name}-1-idle.png`), fullPage: false });
  const out = { name, errors, external };
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, `${name}-1-idle.png`), fullPage: false });
  if (opts.saz) { await page.check('#t-amp'); await page.check('#t-stab'); }
  await page.selectOption('#speed', '8');
  if (view === 'desktop' && !opts.reduced) { await page.click('#btn-science'); }
  await page.evaluate(() => { window.__frames.length = 0; window.__arena.resetStats(); });
  const t0 = Date.now();
  await page.click('#btn-run');
  await page.waitForTimeout(4500);
  await page.evaluate(() => document.querySelector('.stage').scrollIntoView());
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(shots, `${name}-2-running.png`), fullPage: false });
  // steer mid-run: change the reward scheme and the cooperation setting, as a player would
  await page.selectOption('#scheme', 'team');
  await page.fill('#w', '1');
  await page.waitForFunction(() => window.__arena.mode() === 'done', null, { timeout: 180000 });
  out.runMs = Date.now() - t0;
  const frames = await page.evaluate(() => window.__frames.slice());
  const stats = await page.evaluate(() => window.__arena.stats());
  frames.sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
  out.frames = frames.length; out.avgFrameMs = +avg.toFixed(2); out.p95FrameMs = +frames[Math.floor(frames.length * 0.95)].toFixed(2); out.maxFrameMs = +frames[frames.length - 1].toFixed(2);
  out.fps = +(1000 / avg).toFixed(1); out.drawMsAvg = +stats.drawMs.toFixed(2); out.drawMsWorst = +stats.worstDrawMs.toFixed(2);
  await page.waitForTimeout(900);
  out.result = await page.evaluate(() => ({ score: document.querySelector('#result-score').textContent, share: document.querySelector('#share-text').textContent, live: document.querySelector('#sr-live').textContent, cmp: document.querySelectorAll('#cmp tr').length, lesson: document.querySelector('#lesson-title').textContent, synthetic: document.querySelector('.tag').textContent }));
  out.overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.evaluate(() => document.querySelector('#s-result').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, `${name}-3-result.png`), fullPage: false });
  out.viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  await page.screenshot({ path: path.join(shots, `${name}-4-full.png`), fullPage: true });
  if (view === 'desktop' && !opts.reduced) {
    await page.locator('#panel-meters').screenshot({ path: path.join(shots, `${name}-5-meters.png`) });
    await page.locator('#panel-science').screenshot({ path: path.join(shots, `${name}-6-science.png`) });
  }
  out.cmpRepoCells = await page.evaluate(() => [...document.querySelectorAll('#cmp tr')].slice(1).map((r) => r.children[2].textContent));
  // the daily record survives a reload; copy works or fails politely
  await page.click('#btn-copy');
  await page.waitForTimeout(300);
  out.copyStatus = await page.evaluate(() => document.querySelector('#copy-status').textContent);
  await ctx.close();
  report.push(out);
  return out;
}

async function robustness(browser) {
  const res = [];
  const check = (name, ok, detail) => res.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  const fresh = async (init, url) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage(), errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.dismiss(); });
    if (init) await page.addInitScript(init);
    await page.goto(`http://127.0.0.1:${port}/${url || ''}`);
    await page.waitForFunction(() => window.__arena);
    return { ctx, page, errs };
  };
  // 1. daily contest: finish by keyboard, record saved, survives a reload
  let { ctx, page, errs } = await fresh();
  check('daily mode label', /Daily contest #1/.test(await page.textContent('#mode-line')) || /^Daily contest #\d+/.test(await page.textContent('#mode-line')), await page.textContent('#mode-line'));
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__arena.mode() === 'done');
  const saved = await page.evaluate(() => localStorage.getItem('membrane-arena/v1'));
  check('daily result saved', saved && Object.keys(JSON.parse(saved).daily).length === 1, saved && saved.slice(0, 80));
  await page.reload(); await page.waitForFunction(() => window.__arena);
  check('daily-done message after reload', await page.isVisible('#daily-done'));
  check('streak shown after reload', /streak: 1/i.test(await page.textContent('#stats-list')), await page.textContent('#stats-list'));
  check('no errors (daily)', errs.length === 0, errs.join('|'));
  // 6. language switch re-renders the result
  await page.keyboard.press('f'); await page.waitForFunction(() => window.__arena.mode() === 'done');
  await page.click('#btn-lang');
  check('language switch re-renders the result', /^Score \d+ sur 100/.test(await page.textContent('#result-score')), await page.textContent('#result-score'));
  await ctx.close();
  // 2. corrupted storage
  ({ ctx, page, errs } = await fresh(() => localStorage.setItem('membrane-arena/v1', '{{{not json')));
  check('corrupted storage ignored', (await page.textContent('#hud-gen')).length > 0 && errs.length === 0, errs.join('|'));
  await ctx.close();
  ({ ctx, page, errs } = await fresh(() => localStorage.setItem('membrane-arena/v1', JSON.stringify({ daily: { '2026-10-24': { score: 'x' }, '__proto__': { score: 1 } }, bestDaily: 1e9, lang: '<b>' }))));
  check('hostile stored record ignored', /No daily result/.test(await page.textContent('#stats-list')) && errs.length === 0, errs.join('|'));
  await ctx.close();
  // 3. storage blocked (private mode)
  ({ ctx, page, errs } = await fresh(() => { Storage.prototype.getItem = () => { throw new Error('blocked'); }; Storage.prototype.setItem = () => { throw new Error('blocked'); }; }));
  await page.keyboard.press('f'); await page.waitForFunction(() => window.__arena.mode() === 'done');
  check('blocked storage: plays and warns', errs.length === 0 && await page.isVisible('#store-warn'), errs.join('|'));
  await ctx.close();
  // 4. hostile hash
  ({ ctx, page, errs } = await fresh(null, '#d=2026-02-31&s=%3Cimg%20src=x%20onerror=alert(1)%3E&c=zzz&b=99999&l=xx'));
  check('hostile hash falls back to the daily contest', /^Daily contest/.test(await page.textContent('#mode-line')) && errs.length === 0, await page.textContent('#mode-line'));
  await ctx.close();
  ({ ctx, page, errs } = await fresh(null, '#s=abc123&b=70&c=t-25-SA-&l=fr'));
  check('valid challenge link applies seed, target, preset and language', /Défi : battez 70 sur la graine abc123/.test(await page.textContent('#mode-line')) && (await page.inputValue('#scheme')) === 'team' && (await page.inputValue('#w')) === '0.25' && (await page.isChecked('#t-amp')), await page.textContent('#mode-line'));
  await ctx.close();
  // 5. keyboard: Space runs and pauses, g steps one generation, f finishes
  ({ ctx, page, errs } = await fresh(null, '#s=keys'));
  await page.selectOption('#speed', '8');
  await page.keyboard.press(' '); check('space runs', (await page.evaluate(() => window.__arena.mode())) === 'running');
  await page.keyboard.press(' '); check('space pauses', (await page.evaluate(() => window.__arena.mode())) === 'paused');
  await page.keyboard.press('g');
  const atEnd = () => window.__arena.mode() === 'paused' && window.__arena.stats().t >= 11.1 - 1e-6;
  await page.waitForFunction(atEnd, null, { timeout: 30000 });
  check('g finishes the current generation, then pauses', (await page.evaluate(() => window.__arena.contest().hist.length)) === 1);
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.__arena.mode() === 'paused' && window.__arena.contest().hist.length === 2 && window.__arena.stats().t >= 11.1 - 1e-6, null, { timeout: 30000 });
  check('g at a generation boundary runs exactly the next generation', (await page.evaluate(() => window.__arena.contest().hist.length)) === 2);
  await page.keyboard.press(' ');
  await page.waitForFunction(() => window.__arena.contest().hist.length >= 3, null, { timeout: 30000 });
  check('space at a boundary resumes into the next generation', true);
  await page.keyboard.press('f'); await page.waitForFunction(() => window.__arena.mode() === 'done');
  check('f finishes with 12 generations', (await page.evaluate(() => window.__arena.contest().hist.length)) === 12);
  check('result is announced to the live region', /Contest finished/.test(await page.textContent('#sr-live')));
  check('no errors (keys)', errs.length === 0, errs.join('|'));
  await ctx.close();
  return res;
}

(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const only = process.env.E2E_ONLY === 'robustness';
  if (!only) for (const lang of ['en', 'fr']) for (const view of ['desktop', 'phone']) {
    const o = await runCase(browser, lang, view, { saz: lang === 'en' && view === 'desktop' });
    console.log(JSON.stringify(o));
  }
  if (!only) console.log(JSON.stringify(await runCase(browser, 'en', 'desktop', { reduced: true })));
  const checks = await robustness(browser);
  console.log(JSON.stringify(checks));
  report.push({ name: 'robustness', errors: checks.filter((c) => !c.ok).map((c) => c.name + ': ' + c.detail), external: [], checks });
  await browser.close(); server.close();
  if (!only) fs.writeFileSync(path.join(root, 'docs', 'e2e-report.json'), JSON.stringify({ chrome: 'headless Chrome via playwright-core', cases: report, otherRequestsServed: served }, null, 1));
  const bad = report.filter((r) => r.errors.length || r.external.length);
  console.log(bad.length ? 'PROBLEMS: ' + JSON.stringify(bad.map((b) => [b.name, b.errors, b.external])) : 'no console errors, no external requests');
})().catch((e) => { console.error(e); process.exit(1); });
