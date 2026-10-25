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
const downloads = path.join(require('node:os').tmpdir(), 'membrane-arena-e2e');
fs.mkdirSync(downloads, { recursive: true });

// frame timing from requestAnimationFrame, collected in the page
const FRAMES = () => {
  window.__frames = []; let last = 0;
  const tick = (ts) => { if (last) window.__frames.push(ts - last); last = ts; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
function frameStats(frames) {
  const f = frames.slice().sort((a, b) => a - b), avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
  return { frames: f.length, avgFrameMs: +avg.toFixed(2), p95FrameMs: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(2), maxFrameMs: +(f[f.length - 1] || 0).toFixed(2), fps: +(1000 / avg).toFixed(1) };
}
// a canvas is drawn when it holds more than one colour
const NONBLANK = (id) => {
  const c = document.getElementById(id); if (!c || !c.width) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, r0 = d[0], g0 = d[1], b0 = d[2];
  let diff = 0; for (let i = 0; i < d.length; i += 4 * 7) if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 24) diff++;
  return diff > 20;
};

async function runCase(browser, lang, view, opts) {
  opts = opts || {};
  const name = `${lang}-${view}${opts.reduced ? '-reduced' : ''}${opts.hc ? '-contrast' : ''}`;
  const ctx = await browser.newContext(Object.assign({ locale: lang === 'fr' ? 'fr-CA' : 'en-CA', reducedMotion: opts.reduced ? 'reduce' : 'no-preference', acceptDownloads: true }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.addInitScript(FRAMES);
  // the screenshots kept in docs/screenshots (the other views are still exercised, just not saved)
  const KEEP = { 'en-desktop': null, 'fr-desktop': ['02', '04', '05', '06'], 'en-phone': ['02', '04', '05', '06', '07', '08'], 'fr-phone': ['02', '04'], 'en-desktop-reduced': ['02', '04'],
    'en-desktop-contrast': ['02', '04', '05'], 'en-phone-contrast': ['02', '04'] };
  const shot = async (n, loc) => {
    const keep = KEEP[name];
    if (keep && !keep.includes(n.slice(0, 2))) return;
    await (loc ? page.locator(loc) : page).screenshot({ path: path.join(shots, `${name}-${n}.png`) });
  };
  const out = { name, errors, external, checks: {} };
  const ck = (k, v) => { out.checks[k] = v; };
  // first visit with no hash: the intro plays (not in reduced motion), the tour card is shown
  await page.goto(`http://127.0.0.1:${port}/` + (lang === 'fr' ? '#l=fr' : ''));
  if (lang === 'fr') await page.evaluate(() => { localStorage.clear(); }), await page.reload();
  await page.waitForFunction(() => window.__arena && document.querySelector('#hud-gen').textContent.length > 0);
  await page.waitForTimeout(opts.reduced ? 300 : 2300);
  ck('introPlayed', await page.evaluate(() => window.__arena.stats().intro));
  ck('tourVisible', await page.isVisible('#tutorial'));
  if (opts.hc) { await page.click('#btn-contrast'); await page.waitForTimeout(200); }
  if (view === 'desktop' && !opts.hc && !opts.reduced) await shot('01-intro', '.stage');
  await page.evaluate(() => window.__arena.skipIntro());
  await page.click('#btn-tut-skip');
  ck('tourClosed', !(await page.isVisible('#tutorial')));
  await page.selectOption('#speed', '8');
  // measure the animated arena for 5 s with the meters tab, then 5 s with the Lab open
  await page.evaluate(() => { window.__frames.length = 0; window.__arena.resetStats(); });
  await page.click('#btn-run');
  await page.waitForTimeout(5000);
  const stA = await page.evaluate(() => ({ f: window.__frames.slice(), s: window.__arena.stats() }));
  Object.assign(out, frameStats(stA.f), { drawMsAvg: +stA.s.drawMs.toFixed(2), drawMsWorst: +stA.s.worstDrawMs.toFixed(2), particles: stA.s.particles });
  await page.evaluate(() => document.querySelector('.stage').scrollIntoView());
  await page.waitForTimeout(200);
  await shot('02-running', '.stage');
  if (!opts.reduced || opts.hc) {
    await page.evaluate(() => { window.__arena.showTab('lab'); window.__frames.length = 0; window.__arena.resetStats(); });
    await page.waitForTimeout(5000);
    const stB = await page.evaluate(() => ({ f: window.__frames.slice(), s: window.__arena.stats() }));
    out.withLab = Object.assign(frameStats(stB.f), { drawMsAvg: +stB.s.drawMs.toFixed(2), drawMsWorst: +stB.s.worstDrawMs.toFixed(2) });
  }
  // steer mid-run, as a player would
  await page.selectOption('#scheme', 'team');
  await page.keyboard.press('Escape');
  await page.click('#btn-finish');
  await page.waitForFunction(() => window.__arena.mode() === 'done', null, { timeout: 60000 });
  await page.waitForTimeout(900);
  out.result = await page.evaluate(() => ({ score: document.querySelector('#result-score').textContent, live: document.querySelector('#sr-live').textContent, cmp: document.querySelectorAll('#cmp tr').length, synthetic: document.querySelector('.tag').textContent }));
  // replay: scrub, the arena description follows, play advances
  ck('replayVisible', await page.isVisible('#replay'));
  const d0 = await page.evaluate(() => { window.__arena.replayTo(0); return window.__arena.desc(); });
  const d1 = await page.evaluate(() => { window.__arena.replayTo(2 * 480 + 3 * 60 + 40); return window.__arena.desc(); });
  ck('replayDescriptionChanges', d0 !== d1 && /Generation 3|G[ée]n[ée]ration 3/.test(d1));
  out.replayDesc = d1;
  await page.evaluate(() => document.querySelector('.stage').scrollIntoView());
  await shot('07-replay', '.stage');
  const before = await page.evaluate(() => window.__arena.replayIdx());
  await page.click('#btn-replay-play'); await page.waitForTimeout(700);
  const after = await page.evaluate(() => window.__arena.replayIdx());
  ck('replayPlays', after > before);
  await page.click('#btn-replay-play');
  // Lab: every instrument drawn and described
  await page.click('#tab-lab');
  await page.waitForTimeout(900);
  out.labCanvases = await page.evaluate((src) => { const f = eval(src); return ['lab-rates', 'lab-align', 'lab-hist', 'lab-sweep', 'lab-shield', 'lab-gain', 'lab-land', 'lab-amp', 'sci'].map((id) => [id, f(id)]); }, NONBLANK.toString());
  out.labAlt = await page.evaluate(() => [...document.querySelectorAll('#panel-lab .alt')].map((e) => e.textContent.length));
  await page.locator('#panel-lab').scrollIntoViewIfNeeded();
  await shot('04-lab', '#panel-lab');
  out.probeMs = await page.evaluate(() => { const t0 = performance.now(); ArenaLab.probe(window.__arena.contest(), window.__arena.contest().hist[11].settings, 60); return +(performance.now() - t0).toFixed(1); });
  // export
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('#btn-exp-run-csv')]);
  if (dl) { const f = path.join(downloads, name + '-run.csv'); await dl.saveAs(f); const txt = fs.readFileSync(f, 'utf8'); ck('runCsvRows', txt.trim().split('\n').length); } else ck('runCsvRows', 0);
  // ensemble: like for like with the repository, 20 seeds, time-sliced
  await page.click('#tab-ens');
  await page.click('#btn-ens-match');
  await page.check('#t-shield'); await page.selectOption('#ens-n', '20');
  await page.evaluate(() => { window.__frames.length = 0; });
  const e0 = Date.now();
  await page.click('#btn-ens-run');
  await page.waitForFunction(() => window.__arena.labState().ensN >= 20, null, { timeout: 120000 });
  out.ensembleWallMs = Date.now() - e0;
  const fe = await page.evaluate(() => window.__frames.slice());
  out.ensembleMaxFrameGapMs = frameStats(fe).maxFrameMs;
  out.ensembleComputeMs = await page.evaluate(() => Math.round(window.__arena.labState().ensMs));
  await page.waitForTimeout(400);
  out.ensemble = await page.evaluate(() => ({ status: document.querySelector('#ens-status').textContent, rows: document.querySelectorAll('#ens-table tr').length, like: document.querySelector('#ens-like').textContent.slice(0, 60), alt: document.querySelector('#ens-alt').textContent.length, note: document.querySelector('#ens-note').textContent }));
  await page.locator('#panel-ens').scrollIntoViewIfNeeded();
  await shot('05-ensemble', '#panel-ens');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('#btn-ens-json')]);
  if (dl2) { const f = path.join(downloads, name + '-ens.json'); await dl2.saveAs(f); ck('ensJsonOk', typeof JSON.parse(fs.readFileSync(f, 'utf8')) === 'object'); } else ck('ensJsonOk', false);
  // A/B: shield on against off, the same seeds
  await page.click('#tab-ab');
  await page.selectOption('#ab-factor', 'shield');
  await page.selectOption('#ab-n', '20');
  const a0 = Date.now();
  await page.click('#btn-ab-run');
  await page.waitForFunction(() => window.__arena.labState().abN >= 20, null, { timeout: 120000 });
  out.abWallMs = Date.now() - a0;
  await page.waitForTimeout(400);
  out.ab = await page.evaluate(() => ({ status: document.querySelector('#ab-status').textContent, verdict: document.querySelector('#ab-verdict').textContent, rows: document.querySelectorAll('#ab-table tr').length, alt: document.querySelector('#ab-alt').textContent.length }));
  await page.locator('#panel-ab').scrollIntoViewIfNeeded();
  await shot('06-ab', '#panel-ab');
  // missions recorded from those two runs; stored locally
  await page.click('#tab-missions');
  out.missions = await page.evaluate(() => [...document.querySelectorAll('#missions-list .mission')].map((li) => [li.id, li.className, li.querySelector('.status').textContent]));
  out.storedMissions = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('membrane-arena/v1')).missions || {}));
  await shot('08-missions', '#panel-missions');
  await page.click('#tab-method');
  await shot('09-method', '#panel-method');
  // layout
  for (const tab of ['meters', 'lab', 'ens', 'ab', 'missions', 'method']) {
    await page.click('#tab-' + tab);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    out.overflowX = Math.max(out.overflowX || 0, ov);
  }
  await page.click('#tab-lab');
  await page.evaluate(() => document.querySelector('#s-result').scrollIntoView());
  await shot('03-result', '#s-result');
  out.contrast = await page.evaluate(() => window.__arena.hc());
  out.reduced = await page.evaluate(() => window.__arena.reduced());
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
  // 7. v0.2: tabs by keyboard, the S key, tour and switches persist, hostile v0.2 store fields, intro skip
  ({ ctx, page, errs } = await fresh(null, '#s=tabs'));
  check('tour shown on the first visit', await page.isVisible('#tutorial'));
  await page.click('#btn-tut-next'); await page.click('#btn-tut-next');
  check('tour advances', /Step 3 of 5/.test(await page.textContent('#tut-step')), await page.textContent('#tut-step'));
  await page.click('#btn-tut-skip');
  check('closing the tour moves the focus to Run', (await page.evaluate(() => document.activeElement.id)) === 'btn-run');
  await page.focus('#tab-meters'); await page.keyboard.press('ArrowRight');
  check('arrow key moves to the Lab tab', (await page.getAttribute('#tab-lab', 'aria-selected')) === 'true' && await page.isVisible('#panel-lab') && !(await page.isVisible('#panel-meters')));
  await page.keyboard.press('End');
  check('End key moves to the last tab', (await page.getAttribute('#tab-method', 'aria-selected')) === 'true');
  await page.keyboard.press('Home');
  check('Home key moves to the first tab', (await page.getAttribute('#tab-meters', 'aria-selected')) === 'true');
  await page.click('#btn-motion'); await page.click('#btn-contrast');
  check('motion off and high contrast apply to the page', await page.evaluate(() => document.documentElement.classList.contains('still') && document.documentElement.classList.contains('hc') && window.__arena.reduced()));
  await page.reload(); await page.waitForFunction(() => window.__arena);
  check('switches and the finished tour persist after a reload', await page.evaluate(() => document.documentElement.classList.contains('hc') && document.documentElement.classList.contains('still')) && !(await page.isVisible('#tutorial')));
  await page.click('#btn-intro');
  check('the Intro button reopens the tour', await page.isVisible('#tutorial'));
  await page.click('#btn-tut-skip');
  await page.click('body', { position: { x: 5, y: 5 } });
  await page.keyboard.press('s');
  check('the S key opens the Lab', (await page.getAttribute('#tab-lab', 'aria-selected')) === 'true');
  check('Lab explains itself before any contest', await page.isVisible('#lab-empty'));
  check('no errors (tabs)', errs.length === 0, errs.join('|'));
  await ctx.close();
  ({ ctx, page, errs } = await fresh(() => localStorage.setItem('membrane-arena/v1', JSON.stringify({ missions: { shield: { outcome: '<img src=x onerror=alert(1)>', n: 5 }, play: { outcome: 'beat', n: 0 } }, bestScheme: { team: 'x', consensus: 61.5 }, hc: 'yes' }))));
  await page.click('#tab-missions');
  const ms = await page.evaluate(() => [...document.querySelectorAll('#missions-list .mission')].map((li) => li.className));
  check('hostile mission record ignored, valid one shown', ms[0] === 'mission' && /done/.test(ms[4]) && errs.length === 0, ms.join('|'));
  check('best-by-scheme record shown', /consensus 62/.test(await page.textContent('#stats-list')), await page.textContent('#stats-list'));
  check('hostile contrast flag ignored', !(await page.evaluate(() => window.__arena.hc())));
  await ctx.close();
  ({ ctx, page, errs } = await fresh(null, ''));
  await page.waitForTimeout(500);
  check('intro plays on a first visit without a link', await page.evaluate(() => window.__arena.stats().intro));
  await page.keyboard.press('Escape');
  check('Escape skips the intro', !(await page.evaluate(() => window.__arena.stats().intro)));
  check('skipping marks the intro as seen', await page.evaluate(() => window.__arena.store().introSeen === true));
  await ctx.close();
  return res;
}

(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const only = process.env.E2E_ONLY === 'robustness';
  if (!only) {
    for (const f of fs.readdirSync(shots)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shots, f));
    for (const [lang, view, o] of [['en', 'desktop'], ['fr', 'desktop'], ['en', 'phone'], ['fr', 'phone'], ['en', 'desktop', { reduced: true }], ['en', 'desktop', { hc: true }], ['en', 'phone', { hc: true }]]) {
      const r = await runCase(browser, lang, view, o);
      console.log(JSON.stringify(r));
    }
  }
  const checks = await robustness(browser);
  console.log(JSON.stringify(checks));
  report.push({ name: 'robustness', errors: checks.filter((c) => !c.ok).map((c) => c.name + ': ' + c.detail), external: [], checks });
  await browser.close(); server.close();
  if (!only) fs.writeFileSync(path.join(root, 'docs', 'e2e-report.json'), JSON.stringify({ chrome: 'headless Chrome via playwright-core', cases: report, otherRequestsServed: served }, null, 1));
  const bad = report.filter((r) => r.errors.length || r.external.length);
  console.log(bad.length ? 'PROBLEMS: ' + JSON.stringify(bad.map((b) => [b.name, b.errors, b.external])) : 'no console errors, no external requests');
})().catch((e) => { console.error(e); process.exit(1); });
