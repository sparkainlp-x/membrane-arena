'use strict';
/*
 * Headless Chrome playthrough of dist/reverse.html: plays whole contests by clicking (and once by
 * keyboard), in English and French, at phone and desktop sizes and once in high contrast. Checks the
 * page's score against the same contest replayed in Node with reverse.js, runs the mirror test,
 * records console errors, external requests, horizontal overflow and untranslated strings, and
 * writes screenshots and a JSON report.
 *   node scripts/reverse-e2e-check.js [port]
 * Needs playwright-core (set PLAYWRIGHT_CORE to its path if it is not resolvable) and a Chrome
 * binary (set CHROME to its path; default /usr/bin/google-chrome). Not part of `node --test`.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const R = require('../reverse.js');
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = parseInt(process.argv[2], 10) || 8768;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const ADAPTIVE_SEED = 'e2e-a1';   // one seed where following the darkness beats the fixed reference (it does not on every seed)
const served = [];
const server = http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/reverse.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'dist', 'reverse.html'))); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };
// the score Node gets for: round 1 at the seeded start, then the player's settings for the rest
function expected(seed, rest, restRounds) {
  const c = R.createContest(seed);
  R.stepRound(c, R.startFor(seed));
  for (let k = 0; k < restRounds && !R.done(c); k++) R.stepRound(c, rest);
  return Math.round(R.summarize(c.hist).score);
}
// every declaration dot must sit on the declaring side of its panel's threshold line (SVG y grows downwards)
async function dotsPastThreshold(page, polarity) {
  return page.evaluate((pol) => {
    const bad = []; let n = 0;
    document.querySelectorAll('#episodes svg').forEach((svg, k) => {
      const thr = svg.querySelector('line.thr'), ch = svg.querySelector('line.chance');
      const ty = +thr.getAttribute('y1'), cy0 = +ch.getAttribute('y1');
      if (pol === 'reverse' ? !(ty > cy0) : !(ty < cy0)) bad.push('panel ' + (k + 1) + ' line on the wrong side of chance');
      svg.querySelectorAll('circle.dot').forEach((c) => { n++; const cy = +c.getAttribute('cy'); if (pol === 'reverse' ? cy < ty - 0.6 : cy > ty + 0.6) bad.push('panel ' + (k + 1) + ' dot ' + cy + ' vs line ' + ty); });
    });
    return { n, bad };
  }, polarity);
}
async function idle(page) {
  await page.waitForFunction(() => !document.getElementById('btn-again').disabled, null, { timeout: 120000 });
}
async function setTh(page, th) {
  await page.evaluate((v) => { const el = document.getElementById('th'); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, th);
}
async function state(page) {
  return page.evaluate(() => ({
    score: +document.getElementById('score').textContent,
    tally: document.getElementById('tally').textContent,
    text: document.getElementById('res-text').textContent,
    forecast: document.getElementById('forecast').textContent,
    rounds: document.querySelectorAll('#rounds-body tr').length,
    charts: document.querySelectorAll('#episodes .ep').length,
    traces: document.querySelectorAll('#episodes polyline').length,
    dots: document.querySelectorAll('#episodes circle').length,
    lines: Array.from(document.querySelectorAll('#episodes .out')).map((p) => p.textContent),
    runDisabled: document.getElementById('btn-run').disabled
  }));
}
async function runCase(browser, lang, view, opts) {
  const name = `reverse-${lang}-${view}${opts.hc ? '-contrast' : ''}`;
  const ctx = await browser.newContext(Object.assign({ locale: lang === 'fr' ? 'fr-CA' : 'en-CA' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [], checks = [];
  const check = (what, ok, got) => checks.push({ what, ok: !!ok, got });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}/reverse.html#s=${opts.seed}${lang === 'fr' ? '&l=fr' : ''}`);
  if (opts.hc) await page.click('#btn-contrast');
  const t0 = Date.now();
  const start = R.startFor(opts.seed);
  const s0 = await page.evaluate(() => ({ pol: document.getElementById('pol').checked, echo: document.getElementById('e-val').textContent, th: document.getElementById('th').value, shield: document.getElementById('shield').checked }));
  check('starts at the seeded forward setup', !s0.pol && s0.echo === '0' && +s0.th === start.th && s0.shield, s0);
  // round 1 as the page starts: forward membranes in a dark world find nothing
  await page.click('#btn-run'); await idle(page);
  let st = await state(page);
  check('round 1 forward: no true output', /True 0|Vrais 0/.test(st.tally), st.tally);
  check('round 1 draws 8 episode charts, 24 traces', st.charts === 8 && st.traces === 24, [st.charts, st.traces]);
  check('round 1 explains the forward miss', /Forward membranes cannot see a gap|ne voient pas un creux/.test(st.text), st.text.slice(0, 120));
  { const g = await dotsPastThreshold(page, 'forward'); check('forward round: threshold above chance, every dot at or above it', g.bad.length === 0, g); }
  if (opts.shotForward) await page.screenshot({ path: path.join(shots, name + '-forward.png'), fullPage: false });
  // the player reverses the membranes, adds echo and sets the threshold
  if (opts.keyboard) {
    await page.focus('#pol'); await page.keyboard.press('Space');
    await page.focus('#e-inc'); await page.keyboard.press('Enter');
    await page.focus('#th');
    const steps = Math.round((opts.th - start.th) / 0.05);
    for (let k = 0; k < Math.abs(steps); k++) await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
  } else {
    await page.click('#pol');
    await page.click('#e-inc');
    await setTh(page, opts.th);
  }
  const s1 = await page.evaluate(() => ({ pol: document.getElementById('pol').checked, echo: document.getElementById('e-val').textContent, th: document.getElementById('th-val').textContent }));
  check('controls now reverse, echo 1, threshold ' + opts.th, s1.pol && s1.echo === '1' && parseFloat(s1.th.replace(',', '.')) === opts.th, s1);
  if (opts.oneMore) {
    if (opts.keyboard) { await page.focus('#btn-run'); await page.keyboard.press('Enter'); } else await page.click('#btn-run');
    await idle(page);
    st = await state(page);
    const exp2 = expected(opts.seed, { polarity: 'reverse', th: opts.th, echo: 1, shield: true }, 1);
    check('round 2 score matches Node', st.score === exp2, [st.score, exp2]);
    check('round 2 reverse declares (dots drawn)', st.dots > 0, st.dots);
    if (opts.shotRound) await page.screenshot({ path: path.join(shots, name + '-round.png'), fullPage: true });
  }
  if (opts.keyboard) { await page.focus('#btn-rest'); await page.keyboard.press('Enter'); } else await page.click('#btn-rest');
  await idle(page);
  st = await state(page);
  const exp = expected(opts.seed, { polarity: 'reverse', th: opts.th, echo: 1, shield: true }, R.ROUNDS - 1);
  check('contest over: 12 rows, run disabled', st.rounds === R.ROUNDS && st.runDisabled, [st.rounds, st.runDisabled]);
  check('final score matches Node replay', st.score === exp, [st.score, exp]);
  check('final text shows score and reference', /Final score|Score final/.test(st.text) && /Reference|Référence/.test(st.text), st.text.slice(-200));
  // the mirror test
  await page.click('#btn-mirror'); await idle(page);
  const mirror = await page.evaluate(() => Array.from(document.querySelectorAll('#mirror-body td')).map((td) => ({ world: td.dataset.world, polarity: td.dataset.polarity, hit: td.classList.contains('hit'), text: td.textContent })));
  const cell = (w, p) => mirror.find((c) => c.world === w && c.polarity === p) || {};
  check('mirror: only matching polarity finds patterns', mirror.length === 4 && cell('dark', 'reverse').hit && !cell('dark', 'forward').hit && !cell('bright', 'reverse').hit && cell('bright', 'forward').hit, mirror.map((c) => `${c.world}/${c.polarity}: ${c.text}`));
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
    info.lang === lang && info.hc === !!opts.hc && checks.every((c) => c.ok);
  return Object.assign({ name, ok, wallMs: ms, errors, external, opts, finalScore: st.score, checks }, info);
}
// a player who sets reverse and echo 1 before round 1, then moves the threshold to darkness - 0.1 each round
async function runAdaptive(browser, seed) {
  const name = 'reverse-en-desktop-adaptive';
  const ctx = await browser.newContext(Object.assign({ locale: 'en-CA' }, VIEWS.desktop));
  const page = await ctx.newPage();
  const errors = [], external = [], checks = [];
  const check = (what, ok, got) => checks.push({ what, ok: !!ok, got });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}/reverse.html#s=${seed}`);
  const t0 = Date.now();
  await page.click('#pol'); await page.click('#e-inc');
  const depths = R.depthsFor(seed), c = R.createContest(seed);
  for (let k = 0; k < R.ROUNDS; k++) {
    const th = Math.max(0.2, Math.round(20 * (depths[k] - 0.1)) / 20);
    const fc = await page.textContent('#forecast');
    if (k === 0) check('forecast shows round 1 darkness', fc.includes(depths[0].toFixed(2)), fc);
    await setTh(page, th);
    await page.click('#btn-run'); await idle(page);
    R.stepRound(c, { polarity: 'reverse', th, echo: 1, shield: true });
  }
  { const g = await dotsPastThreshold(page, 'reverse'); check('reverse round: threshold below chance, every dot at or below it', g.bad.length === 0 && g.n > 0, g); }
  const st = await state(page);
  const exp = Math.round(R.summarize(c.hist).score);
  const ref = R.createContest(seed); while (!R.done(ref)) R.stepRound(ref, R.DEFAULTS);
  const refScore = Math.round(R.summarize(ref.hist).score);
  check('adaptive score matches Node', st.score === exp, [st.score, exp]);
  check('page reports the reference and the comparison', st.text.includes('shield): ' + refScore) && /beat the reference|Below the reference/.test(st.text), st.text.slice(-160));
  check('adaptive play beats the reference on this seed', exp > refScore, [exp, refScore]);
  const overflowX = await page.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1);
  await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true });
  await ctx.close();
  const ok = errors.length === 0 && external.length === 0 && !overflowX && checks.every((x) => x.ok);
  return { name, ok, wallMs: Date.now() - t0, errors, external, opts: { seed, adaptive: true }, finalScore: st.score, reference: refScore, checks, overflowX, untranslated: [] };
}
(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const cases = [
    ['en', 'desktop', { seed: 'e2e-1', th: 0.6, oneMore: true, shotForward: true, shotRound: true }],
    ['fr', 'phone', { seed: 'e2e-2', th: 0.6, keyboard: true, oneMore: true, shotRound: true }],
    ['en', 'phone', { seed: 'e2e-3', th: 0.7, oneMore: true, shotRound: true }],
    ['en', 'desktop', { seed: 'e2e-4', th: 0.5, hc: true, oneMore: true }]
  ];
  const report = [];
  for (const [lang, view, opts] of cases) report.push(await runCase(browser, lang, view, opts));
  report.push(await runAdaptive(browser, ADAPTIVE_SEED));
  await browser.close();
  server.close();
  const out = { version: R.VERSION, chrome: process.env.CHROME || '/usr/bin/google-chrome', allOk: report.every((r) => r.ok), servedOther: served, cases: report };
  fs.writeFileSync(path.join(root, 'docs', 'reverse-e2e-report.json'), JSON.stringify(out, null, 2) + '\n');
  for (const r of report) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: score ${r.finalScore}, ${r.errors.length} errors, ${r.external.length} external requests, overflow ${r.overflowX}, untranslated ${r.untranslated.length}, ${r.wallMs} ms`);
    for (const c of r.checks) console.log(`     ${c.ok ? 'ok  ' : 'FAIL'} ${c.what}: ${JSON.stringify(c.got).slice(0, 160)}`);
    for (const e of r.errors) console.log('     ' + e);
  }
  process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
