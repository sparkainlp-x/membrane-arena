'use strict';
/*
 * Headless Chrome playthrough of dist/pair.html: plays whole contests by clicking (and once by
 * keyboard), in English and French, at phone and desktop sizes and once in high contrast. Checks the
 * page's score against the same contest replayed in Node with pair.js, the tick strip, the nine tone
 * plots, the chart geometry and the calibration check, records console errors, external requests,
 * horizontal overflow and untranslated strings, and writes screenshots and a JSON report.
 *   node scripts/pair-e2e-check.js [port]
 * Needs playwright-core (set PLAYWRIGHT_CORE to its path if it is not resolvable) and a Chrome
 * binary (set CHROME to its path; default /usr/bin/google-chrome). Not part of `node --test`.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const P = require('../pair.js');
const RES = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'pair-results.json'), 'utf8'));
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = parseInt(process.argv[2], 10) || 8769;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const served = [];
const server = http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/pair.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'dist', 'pair.html'))); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };
// the score Node gets for: round 1 at the seeded start, then the player's settings for the rest
function expected(seed, rest, restRounds) {
  const c = P.createContest(seed);
  P.stepRound(c, P.startFor(seed));
  for (let k = 0; k < restRounds && !P.done(c); k++) P.stepRound(c, rest);
  return Math.round(P.summarize(c.hist).score);
}
// the expected first 20 cells of the tick strip
function strip(share) {
  let sweep = 0; const out = [];
  for (let t = 1; t <= 20; t++) out.push(P.owner(t, share) === 'o' ? 'O' : String(P.FREQS[sweep++ % P.FREQS.length]));
  return out.join(' ');
}
// opposite energy at a declaration is at least the threshold, so every dot sits on or above the line
async function geometry(page) {
  return page.evaluate(() => {
    const bad = []; let n = 0, bars = 0;
    document.querySelectorAll('#episodes .ep').forEach((ep, k) => {
      const svg = ep.querySelector('svg.trace'), thr = svg.querySelector('line.thr'), ch = svg.querySelector('line.chance');
      const ty = +thr.getAttribute('y1'), cy0 = +ch.getAttribute('y1');
      if (!(ty < cy0)) bad.push('panel ' + (k + 1) + ' threshold not above chance');
      svg.querySelectorAll('circle.dot').forEach((c) => { n++; if (+c.getAttribute('cy') > ty + 0.6) bad.push('panel ' + (k + 1) + ' dot below threshold'); });
      const b = ep.querySelectorAll('svg.bars rect').length; bars += b; if (b !== 9) bad.push('panel ' + (k + 1) + ' has ' + b + ' bars');
    });
    return { n, bars, bad };
  });
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
    rounds: document.querySelectorAll('#rounds-body tr').length,
    charts: document.querySelectorAll('#episodes .ep').length,
    tones: document.querySelectorAll('#tones .tone').length,
    stems: document.querySelectorAll('#tones line.stem').length,
    ticks: Array.from(document.querySelectorAll('#ticks li')).map((li) => li.textContent).join(' '),
    ticksText: document.getElementById('ticks-text').textContent,
    runDisabled: document.getElementById('btn-run').disabled
  }));
}
async function runCase(browser, lang, view, opts) {
  const name = `pair-${lang}-${view}${opts.hc ? '-contrast' : ''}`;
  const ctx = await browser.newContext(Object.assign({ locale: lang === 'fr' ? 'fr-CA' : 'en-CA' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [], checks = [];
  const check = (what, ok, got) => checks.push({ what, ok: !!ok, got });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (!r.url().startsWith(`http://127.0.0.1:${port}/`) && !r.url().startsWith('data:')) external.push(r.url()); });
  await page.goto(`http://127.0.0.1:${port}/pair.html#s=${opts.seed}${lang === 'fr' ? '&l=fr' : ''}`);
  if (opts.hc) await page.click('#btn-contrast');
  const t0 = Date.now();
  const start = P.startFor(opts.seed);
  const s0 = await page.evaluate(() => ({ share: document.getElementById('s-val').textContent, th: document.getElementById('th').value, eq: document.getElementById('eq').checked, shield: document.getElementById('shield').checked, off: document.getElementById('off').checked }));
  check('starts at the seeded setup (even tick, helpers off, on-grid fades)', s0.share === '1' && +s0.th === start.th && !s0.eq && !s0.shield && !s0.off, s0);
  // the evaluation section quotes the held-out headline from docs/pair-results.json
  {
    const ev = await page.evaluate(() => document.querySelector('[data-i18n="eval.p1"]').textContent);
    const want = ['grid', 'off'].flatMap((k) => ['mean', 'lo', 'hi'].map((f) => RES.comparisons.H2[k][f].toFixed(2)));
    const fmt = (v) => (lang === 'fr' ? v.replace('.', ',') : v);
    check('evaluation section quotes the held-out headline', want.every((v) => ev.includes(fmt(v))), want);
  }
  let st = await state(page);
  check('nine tone plots, 16 stems each', st.tones === 9 && st.stems === 9 * P.N, [st.tones, st.stems]);
  check('tick strip alternates O and the tone sweep', st.ticks === strip(1), st.ticks);
  // round 1 as the page starts
  await page.click('#btn-run'); await idle(page);
  st = await state(page);
  check('round 1 score matches Node', st.score === expected(opts.seed, start, 0), [st.score, expected(opts.seed, start, 0)]);
  check('round 1 draws 8 episode charts', st.charts === 8, st.charts);
  check('round 1 explains the missing equalizer and shield', /equalizer is off|égaliseur est éteint/.test(st.text) && /shield is off|bouclier est éteint/.test(st.text), st.text.slice(0, 160));
  if (opts.shotStart) await page.screenshot({ path: path.join(shots, name + '-start.png'), fullPage: false });
  // the player gives the observer more ticks, turns both helpers on and sets the threshold
  if (opts.keyboard) {
    for (let k = 1; k < opts.share; k++) { await page.focus('#s-inc'); await page.keyboard.press('Enter'); }
    await page.focus('#eq'); await page.keyboard.press('Space');
    await page.focus('#shield'); await page.keyboard.press('Space');
    if (opts.off) { await page.focus('#off'); await page.keyboard.press('Space'); }
    await page.focus('#th');
    const steps = Math.round((opts.th - start.th) / 0.05);
    for (let k = 0; k < Math.abs(steps); k++) await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft');
  } else {
    for (let k = 1; k < opts.share; k++) await page.click('#s-inc');
    await page.click('#eq'); await page.click('#shield');
    if (opts.off) await page.click('#off');
    await setTh(page, opts.th);
  }
  const rest = { share: opts.share, th: opts.th, eq: true, shield: true, off: !!opts.off };
  const s1 = await page.evaluate(() => ({ share: document.getElementById('s-val').textContent, eq: document.getElementById('eq').checked, shield: document.getElementById('shield').checked, off: document.getElementById('off').checked, th: document.getElementById('th-val').textContent }));
  check('controls now ' + opts.share + ' : 1, both helpers on, threshold ' + opts.th + (opts.off ? ', off-grid fades' : ''), s1.share === String(opts.share) && s1.eq && s1.shield && s1.off === !!opts.off && parseFloat(s1.th.replace(',', '.')) === opts.th, s1);
  st = await state(page);
  check('tick strip follows the share', st.ticks === strip(opts.share), st.ticks);
  const c = P.TICKS / (opts.share + 1);
  check('tick text gives the tick counts', st.ticksText.includes(String(P.TICKS - c)) && st.ticksText.includes(String(c)), st.ticksText);
  if (opts.keyboard) { await page.focus('#btn-run'); await page.keyboard.press('Enter'); } else await page.click('#btn-run');
  await idle(page);
  st = await state(page);
  check('round 2 score matches Node', st.score === expected(opts.seed, rest, 1), [st.score, expected(opts.seed, rest, 1)]);
  { const g = await geometry(page); check('chart geometry: threshold above chance, dots on or above it, 9 bars per panel', g.bad.length === 0, g); }
  if (opts.shotRound) await page.screenshot({ path: path.join(shots, name + '-round.png'), fullPage: true });
  if (opts.keyboard) { await page.focus('#btn-rest'); await page.keyboard.press('Enter'); } else await page.click('#btn-rest');
  await idle(page);
  st = await state(page);
  const exp = expected(opts.seed, rest, P.ROUNDS - 1);
  check('contest over: 12 rows, run disabled', st.rounds === P.ROUNDS && st.runDisabled, [st.rounds, st.runDisabled]);
  check('final score matches Node replay', st.score === exp, [st.score, exp]);
  check('final text shows score and reference', /Final score|Score final/.test(st.text) && /reference|référence/.test(st.text), st.text.slice(-200));
  // the calibration check
  await page.click('#btn-cal'); await idle(page);
  const cal = await page.evaluate(() => Array.from(document.querySelectorAll('#cal-body tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => parseFloat(td.textContent.replace(',', '.')))));
  const nodeCal = P.calibrationCheck(opts.seed, 48, !!opts.off);
  check('calibration: 4 rows matching Node', cal.length === 4 && cal.every((r, k) => Math.abs(r[1] - nodeCal[k].fadeErr) < 0.0006 && Math.abs(r[2] - nodeCal[k].cleanErr) < 0.0006), cal);
  check('calibration: clean error near the predicted 0.040, faded error grows with the share', cal.every((r) => Math.abs(r[2] - 0.04) < 0.008) && cal[3][1] > cal[0][1], cal.map((r) => [r[1], r[2]]));
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
    info.lang === lang && info.hc === !!opts.hc && checks.every((x) => x.ok);
  return Object.assign({ name, ok, wallMs: ms, errors, external, opts, finalScore: st.score, reference: (() => { const r = P.createContest(opts.seed); while (!P.done(r)) P.stepRound(r, P.reference(!!opts.off)); return Math.round(P.summarize(r.hist).score); })(), checks }, info);
}
(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const cases = [
    ['en', 'desktop', { seed: 'e2e-p1', share: 2, th: 0.7, shotStart: true, shotRound: true }],
    ['fr', 'phone', { seed: 'e2e-p2', share: 2, th: 0.7, keyboard: true, shotRound: true }],
    ['en', 'phone', { seed: 'e2e-p3', share: 3, th: 0.6, off: true, shotRound: true }],
    ['en', 'desktop', { seed: 'e2e-p4', share: 4, th: 0.7, hc: true, off: true, shotRound: true }],
    ['fr', 'desktop', { seed: 'e2e-p5', share: 2, th: 0.75, off: true, shotRound: true }]
  ];
  const report = [];
  for (const [lang, view, opts] of cases) report.push(await runCase(browser, lang, view, opts));
  await browser.close();
  server.close();
  const out = { version: P.VERSION, chrome: process.env.CHROME || '/usr/bin/google-chrome', allOk: report.every((r) => r.ok), servedOther: served, cases: report };
  fs.writeFileSync(path.join(root, 'docs', 'pair-e2e-report.json'), JSON.stringify(out, null, 2) + '\n');
  for (const r of report) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: score ${r.finalScore} (reference ${r.reference}), ${r.errors.length} errors, ${r.external.length} external requests, overflow ${r.overflowX}, untranslated ${r.untranslated.length}, ${r.wallMs} ms`);
    for (const c of r.checks) console.log(`     ${c.ok ? 'ok  ' : 'FAIL'} ${c.what}: ${JSON.stringify(c.got).slice(0, 160)}`);
    for (const e of r.errors) console.log('     ' + e);
  }
  process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
