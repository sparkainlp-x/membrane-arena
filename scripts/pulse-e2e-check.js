'use strict';
/*
 * Headless Chrome playthrough of dist/pulse.html (Wave Pulse): plays whole runs by clicking and by
 * keyboard, in English and French, at phone and desktop sizes, once in high contrast and once with
 * reduced motion; plays free waves; opens a replay link with a good code and one with a broken code.
 * Replays every guess in Node with pulse.js and checks the page's arrival ticks, points, locator
 * points and end-of-run table against it. Records console errors, external requests, horizontal
 * overflow and untranslated strings, and writes screenshots and a JSON report.
 *   node scripts/pulse-e2e-check.js [port]
 * Needs playwright-core (set PLAYWRIGHT_CORE to its path if it is not resolvable) and a Chrome
 * binary (set CHROME to its path; default /usr/bin/google-chrome). Not part of `node --test`.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const PU = require('../pulse.js');
const LANGS = require('../pulse-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = parseInt(process.argv[2], 10) || 8772;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const served = [];
const server = http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/pulse.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'dist', 'pulse.html'))); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };
const CAL = PU.calib();
const half = (v) => Math.round(v * 2) / 2;
// where a policy taps for pulse i of a run
function aim(run, i, policy) {
  const A = PU.preparePulse(run, i, CAL);
  if (policy === 'center' || (policy === 'mix' && i % 3 === 2)) return { A, p: [half(PU.CENTER[0]), half(PU.CENTER[1])] };
  if (policy === 'early' || (policy === 'mix' && i % 3 === 1)) return { A, p: A.answers.early.map(half) };
  return { A, p: A.answers.locator.map(half) };
}
async function runCase(browser, lang, view, opts) {
  const name = `pulse-${lang}-${view}${opts.hc ? '-contrast' : ''}${opts.reduced ? '-reduced' : ''}${opts.tag ? '-' + opts.tag : ''}`;
  const ctx = await browser.newContext(Object.assign({ reducedMotion: opts.reduced ? 'reduce' : 'no-preference' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [], checks = [], t0 = Date.now();
  const check = (what, ok, got) => checks.push({ what, ok: !!ok, got });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://127.0.0.1:${port}/pulse.html`) && !u.startsWith('data:')) external.push(u); });
  const hash = opts.hash || `#s=${opts.seed}${lang === 'fr' ? '&l=fr' : ''}`;
  await page.goto(`http://127.0.0.1:${port}/pulse.html${hash}`);
  await page.waitForFunction(() => typeof window.WavePulseState === 'function');
  const st = () => page.evaluate(() => window.WavePulseState());
  const shot = async (tag, full) => { await page.screenshot({ path: path.join(shots, `${name}-${tag}.png`), fullPage: !!full }); };
  if (opts.hc) await page.click('#btn-contrast');
  if (!opts.reduced) await page.selectOption('#speed', opts.slow ? '2' : '4');
  const tapGrid = async (p) => {
    await page.locator('#scene').scrollIntoViewIfNeeded();
    const s = await st(), box = await page.locator('#scene').boundingBox();
    await page.mouse.click(box.x + s.grid.x + (p[0] + 0.5) * s.grid.cs, box.y + s.grid.y + (p[1] + 0.5) * s.grid.cs);
  };
  let st0 = await st();
  if (opts.verify) {
    check('replay check shown', await page.isVisible('#verify'), opts.verify);
    const v = st0.verify;
    if (opts.verify === 'ok') check('replay code verifies to the expected points', v && v.ok && v.points === opts.expectPoints, v);
    else check('broken replay code is rejected', v && !v.ok && v.error === opts.verify, v);
    await shot('verify');
  }
  if (opts.shots && opts.shots.includes('start')) await shot('start');
  // free waves
  if (opts.free) {
    await page.click('#mode-free');
    check('free mode shows its controls', await page.isVisible('#free-controls') && !(await page.isVisible('#play-controls')), null);
    await page.check('#free-patchy');
    await tapGrid([10, 8]);
    await page.waitForTimeout(opts.reduced ? 200 : 1500);
    let s = await st();
    check('a tap sends a free wave from the tapped cell', s.free && s.free.kind === 'win' && Math.abs(s.free.target[0] - 10) < 0.6 && Math.abs(s.free.target[1] - 8) < 0.6, s.free);
    await shot('free');
    await page.click('#free-cheer');
    await page.waitForTimeout(1200);
    s = await st();
    check('the cheer button sends a crowd cheer', s.free && s.free.kind === 'cheer', s.free);
    await shot('free-cheer');
    check('free waves do not score', s.points === 0 && s.idx === 0, { points: s.points, idx: s.idx });
    await page.click('#mode-play');
    s = await st();
    check('play mode returns to the run', s.mode === 'play' && s.phase === 'idle', { mode: s.mode, phase: s.phase });
  }
  // the run
  const pulses = opts.pulses === undefined ? PU.TOTAL : opts.pulses;
  const nodeRun = PU.createRun(opts.seed || 'none'), guesses = [];
  for (let i = 0; i < pulses; i++) {
    const { A, p } = aim(nodeRun, i, opts.policy || 'locator');
    let s = await st();
    check(`pulse ${i + 1}: page setting matches Node`, JSON.stringify(s.setting) === JSON.stringify(A.setting), s.setting);
    check(`pulse ${i + 1}: page arrival ticks match Node`, JSON.stringify(s.arrivals) === JSON.stringify(A.arrivals), s.arrivals);
    if (opts.keyboard) { await page.focus('#scene'); await page.keyboard.press('Space'); } else await page.click('#btn-go');
    if (i === 0 && opts.shots && opts.shots.includes('listen') && !opts.reduced) { await page.waitForTimeout(700); await page.locator('#scene').scrollIntoViewIfNeeded(); await shot('listen'); }
    await page.waitForFunction(() => window.WavePulseState().phase === 'guess', null, { timeout: 20000 });
    if (i === 0 && opts.hint) await page.check('#hint');
    if (opts.keyboard) {
      // move the marker from the centre with Shift+arrows (2 cells) and arrows (half a cell)
      await page.focus('#scene');
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');   // sets the marker at the centre
      s = await st();
      let dx = Math.round((p[0] - s.marker[0]) * 2), dy = Math.round((p[1] - s.marker[1]) * 2);
      const mv = async (n, pos, neg) => { const k = n > 0 ? pos : neg; n = Math.abs(n); while (n >= 4) { await page.keyboard.press('Shift+' + k); n -= 4; } while (n-- > 0) await page.keyboard.press(k); };
      await mv(dx, 'ArrowRight', 'ArrowLeft'); await mv(dy, 'ArrowDown', 'ArrowUp');
    } else await tapGrid(p);
    s = await st();
    check(`pulse ${i + 1}: marker lands where aimed`, s.marker && s.marker[0] === p[0] && s.marker[1] === p[1], { marker: s.marker, aimed: p });
    if (i === 0 && opts.shots && opts.shots.includes('guess')) { await page.locator('#scene').scrollIntoViewIfNeeded(); await shot('guess'); }
    const g = s.marker || p;
    guesses.push(g);
    const e = PU.guess(nodeRun, A, g[0], g[1]);
    if (opts.keyboard) await page.keyboard.press('Enter'); else await page.click('#btn-confirm');
    if (i === 0 && opts.shots && opts.shots.includes('reveal')) {
      if (!opts.reduced) await page.waitForTimeout(opts.slow ? 2200 : 900);
      await page.locator('#scene').scrollIntoViewIfNeeded(); await shot('reveal');
    }
    s = await st();
    const last = s.log[s.log.length - 1];
    check(`pulse ${i + 1}: points and locator points match Node`, last && last.points === e.points && last.locPoints === e.locator.points, { page: last, node: { points: e.points, loc: e.locator.points } });
    check(`pulse ${i + 1}: the true start is shown after the guess`, s.target && Math.abs(s.target[0] - A.target[0]) < 1e-9, s.target);
    if (opts.keyboard) { await page.focus('#scene'); await page.keyboard.press('Space'); } else await page.click('#btn-go');
  }
  const sum = PU.summarize(nodeRun.log);
  let s = await st();
  check('page totals match Node', s.points === sum.points && s.locatorPoints === sum.locator, { page: [s.points, s.locatorPoints], node: [sum.points, sum.locator] });
  let code = null;
  if (pulses === PU.TOTAL) {
    check('run ends', s.phase === 'end' && await page.isVisible('#end'), s.phase);
    const rows = await page.$$eval('#end-table tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
    check('end table: you, locator, early-sensor average, centre', rows.length === 4 && +rows[0][1] === sum.points && +rows[1][1] === sum.locator && +rows[2][1] === sum.early && +rows[3][1] === sum.center, rows);
    code = (await page.textContent('#end-code')).trim();
    check('end replay code equals the Node code', code === PU.encodeRun(opts.seed, nodeRun.log), code);
    const share = await page.textContent('#share');
    check('score card names the seed and its code', share.includes(opts.seed) && share.includes(code), share.split('\n')[0]);
    const rank = (await page.textContent('#end-rank')).trim();
    check('end rank sentence matches Node', rank === LANGS[lang]['end.rank.' + PU.rank(sum)].trim(), rank);
    if (opts.shots && opts.shots.includes('end')) { await page.click('#end summary'); await page.locator('#end').scrollIntoViewIfNeeded(); await shot('end'); await shot('page', true); }
  }
  const info = await page.evaluate((args) => {
    const body = document.body.innerText, keys = args.keys;
    const untranslated = keys.filter((k) => body.includes(k));
    if (args.lang === 'fr') args.enLong.forEach((s) => { if (body.includes(s)) untranslated.push(s.slice(0, 40)); });
    const cv = document.getElementById('scene'), px = cv.getContext('2d').getImageData(2, 2, 1, 1).data;
    return { lang: document.documentElement.lang, hc: document.documentElement.classList.contains('hc'), overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      untranslated, corner: [px[0], px[1], px[2]], canvasW: cv.clientWidth };
  }, { keys: Object.keys(LANGS.en).filter((k) => k.includes('.') && LANGS.en[k] !== ''), lang,
    enLong: Object.keys(LANGS.en).filter((k) => LANGS.en[k].length > 30 && LANGS.en[k] !== LANGS.fr[k] && !/Jean-François|SYNTHETIC/.test(LANGS.en[k])).map((k) => LANGS.en[k]) });
  if (opts.hc) check('high contrast scene background is black', info.corner.join() === '0,0,0', info.corner);
  await ctx.close();
  const ok = errors.length === 0 && external.length === 0 && !info.overflowX && info.untranslated.length === 0 &&
    info.lang === lang && info.hc === !!opts.hc && checks.every((x) => x.ok);
  return Object.assign({ name, ok, wallMs: Date.now() - t0, errors, external, opts: { seed: opts.seed, policy: opts.policy || 'locator', keyboard: !!opts.keyboard, pulses },
    points: s.points, locator: s.locatorPoints, code, checks }, info);
}
(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const report = [];
  const first = await runCase(browser, 'en', 'desktop', { seed: 'e2e-p1', policy: 'mix', slow: true, hint: true, shots: ['start', 'listen', 'guess', 'reveal', 'end'] });
  report.push(first);
  const cases = [
    ['fr', 'phone', { seed: 'e2e-p2', policy: 'locator', keyboard: true, hint: true, shots: ['start', 'guess', 'reveal', 'end'] }],
    ['en', 'desktop', { seed: 'e2e-p3', policy: 'center', hc: true, hint: true, pulses: 4, shots: ['guess', 'reveal'] }],
    ['fr', 'desktop', { seed: 'e2e-p4', free: true, pulses: 1, tag: 'free', shots: ['reveal'] }],
    ['en', 'phone', { seed: 'e2e-p5', policy: 'early', reduced: true, pulses: 3, free: true, shots: ['reveal'] }],
    ['fr', 'phone', { seed: 'e2e-p6', hc: true, policy: 'locator', hint: true, pulses: 2, shots: ['guess', 'reveal'] }]
  ];
  for (const [lang, view, opts] of cases) report.push(await runCase(browser, lang, view, opts));
  // replay links: the code from the first run, and the same code with one character changed
  if (first.code) {
    report.push(await runCase(browser, 'en', 'desktop', { seed: 'e2e-p1', hash: `#s=e2e-p1&r=${first.code}`, verify: 'ok', expectPoints: first.points, pulses: 0, tag: 'replay' }));
    const bad = first.code.slice(0, 3) + (first.code[3] === 'a' ? 'b' : 'a') + first.code.slice(4);   // still well formed, wrong check
    report.push(await runCase(browser, 'fr', 'desktop', { seed: 'e2e-p1', hash: `#s=e2e-p1&r=${bad}&l=fr`, verify: 'check', pulses: 0, tag: 'replay-bad' }));
  }
  await browser.close();
  server.close();
  const out = { version: PU.VERSION, chrome: process.env.CHROME || '/usr/bin/google-chrome', allOk: report.every((r) => r.ok), servedOther: served, cases: report };
  fs.writeFileSync(path.join(root, 'docs', 'pulse-e2e-report.json'), JSON.stringify(out, null, 2) + '\n');
  for (const r of report) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.opts.pulses} pulses, points ${r.points} (locator ${r.locator}), ${r.checks.length} checks, ${r.errors.length} errors, ${r.external.length} external, ${(r.wallMs / 1000).toFixed(1)} s`);
    for (const c of r.checks) if (!c.ok) console.log(`     FAIL ${c.what}: ${JSON.stringify(c.got).slice(0, 200)}`);
    for (const e of r.errors) console.log('     ' + e);
    if (r.untranslated.length) console.log('     untranslated: ' + JSON.stringify(r.untranslated));
    if (r.overflowX) console.log('     horizontal overflow');
  }
  process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
