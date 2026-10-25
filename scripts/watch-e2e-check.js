'use strict';
/*
 * Headless Chrome playthrough of dist/watch.html (Pair Watch): plays whole runs by clicking and by
 * keyboard, in English and French, at phone and desktop sizes, once in high contrast and once with
 * reduced motion. Replays the player's calls in Node with watch.js and checks the page's points, the
 * outcome of every wave and the end-of-run table against it. Records console errors, external requests,
 * horizontal overflow and untranslated strings, and writes screenshots and a JSON report.
 *   node scripts/watch-e2e-check.js [port]
 * Needs playwright-core (set PLAYWRIGHT_CORE to its path if it is not resolvable) and a Chrome
 * binary (set CHROME to its path; default /usr/bin/google-chrome). Not part of `node --test`.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const W = require('../watch.js');
const LANGS = require('../watch-i18n.js').LANGS;
const root = path.join(__dirname, '..');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = parseInt(process.argv[2], 10) || 8771;
const shots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const served = [];
const server = http.createServer((req, res) => {
  if (req.url.split('#')[0].split('?')[0] === '/watch.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(root, 'dist', 'watch.html'))); }
  else { served.push(req.url); res.writeHead(404); res.end('no'); }
});
const VIEWS = { phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 } };
// Node replay of the same run: the same settings and the calls the player made in the browser
function replay(seed, share, eqPref, calls) {
  const run = W.createRun(seed), waves = [];
  for (let i = 0; i < calls.length && !W.done(run); i++) {
    const wave = W.playWave(run, { share, eq: eqPref });
    waves.push(wave);
    W.resolve(run, wave, wave.declTick ? calls[i] : null);
  }
  return { log: run.log, waves, summary: W.summarize(run.log) };
}
const num = (s) => parseInt(String(s).replace('\u2212', '-').replace(/[^0-9-]/g, ''), 10);

async function runCase(browser, lang, view, opts) {
  const name = `watch-${lang}-${view}${opts.hc ? '-contrast' : ''}${opts.reduced ? '-reduced' : ''}${opts.coach ? '-coach' : ''}`;
  const ctx = await browser.newContext(Object.assign({ reducedMotion: opts.reduced ? 'reduce' : 'no-preference' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [], external = [], checks = [];
  const check = (what, ok, got) => checks.push({ what, ok: !!ok, got });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://127.0.0.1:${port}/watch.html`) && !u.startsWith('data:')) external.push(u); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/watch.html#s=${opts.seed}${lang === 'fr' ? '&l=fr' : ''}`);
  await page.waitForFunction(() => typeof window.PairWatchState === 'function');
  const state = () => page.evaluate(() => window.PairWatchState());
  const shot = async (tag, full) => {
    if (!(opts.shots || []).includes(tag)) return;
    opts.shots = opts.shots.filter((x) => x !== tag);
    if (full) await page.screenshot({ path: path.join(shots, `${name}-${tag}.png`), fullPage: true });
    else await page.locator('.game').screenshot({ path: path.join(shots, `${name}-${tag}.png`) });
  };
  const waitPhase = async (list) => { await page.waitForFunction((l) => l.includes(window.PairWatchState().phase), list, { timeout: 20000 }); return state(); };
  if (opts.hc) await page.click('#btn-contrast');
  if (opts.reduced) check('reduced motion starts at 4x', (await page.inputValue('#speed')) === '4', await page.inputValue('#speed'));
  if (opts.slow) await page.selectOption('#speed', '1');
  await shot('start', true);
  // tick share
  const share = opts.share || 2;
  for (let s = 2; s < share; s++) await page.click('#s-inc');
  for (let s = 2; s > share; s--) await page.click('#s-dec');
  check('tick share shown', (await page.textContent('#s-val')) === String(share), await page.textContent('#s-val'));
  check('equalizer locked in stage 1', await page.isDisabled('#eq'), await page.isDisabled('#eq'));
  if (opts.coach) await page.click('#coach');
  const coachP = [];
  const eqPref = !opts.eqOff;
  const calls = [], shown = [];
  const waves = opts.waves || W.TOTAL;
  let decided = 0;
  for (let i = 0; i < waves; i++) {
    let st = await state();
    if (st.phase !== 'idle') { check('idle before wave ' + (i + 1), false, st.phase); break; }
    if (i >= W.WAVES && !(await page.isDisabled('#eq'))) {
      if ((await page.isChecked('#eq')) !== eqPref) await page.click('#eq');
    }
    if (opts.keyboard) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press(' '); }
    else await page.click('#btn-go');
    if ((opts.shots || []).includes('play')) {
      await page.waitForFunction(() => window.PairWatchState().shown >= 14, null, { timeout: 20000 });
      await page.click('#btn-pause');
      await shot('play');
      check('pause holds the tick', (await state()).shown === (await new Promise((r) => setTimeout(r, 300)).then(state)).shown, null);
      await page.click('#btn-pause');
    }
    st = await state();
    if (st.phase === 'play') {
      if (opts.keyboard) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('s'); }
      else await page.click('#btn-skip');
    }
    st = await waitPhase(['decide', 'reveal']);
    let c = null;
    if (st.phase === 'decide') {
      decided++;
      const q = await page.textContent('#decide-q');
      const p = parseInt((q.match(/(\d+)\s?%/) || [])[1], 10);
      shown.push(p);
      if (decided === 1) {
        check('decision panel visible, status hidden visually', await page.evaluate(() => !document.getElementById('decide').hidden && document.getElementById('status').classList.contains('sr-only')), null);
        const aria = await page.getAttribute('#scene', 'aria-label');
        check('scene label describes the tick', /Tick \d+/.test(aria), aria.slice(0, 120));
      }
      await shot('decide');
      if (opts.coach) {
        const cp = st.coachP, bar = await page.evaluate(() => parseFloat(document.getElementById('coach-bar').style.width));
        coachP.push(cp);
        if (decided === 1) {
          check('coach panel visible with its meter', await page.evaluate(() => !document.getElementById('coach-box').hidden), null);
          check('meter width is the coach probability', Math.abs(bar - 100 * cp) < 0.06, { bar, p: cp });
          await shot('meter');
        }
      } else if (decided === 1) check('coach panel hidden while the coach is off', await page.evaluate(() => document.getElementById('coach-box').hidden), null);
      c = opts.policy === 'accept' ? 'accept' : opts.policy === 'veto' ? 'veto' : opts.policy === 'coach' ? (st.coachP > W.BREAK_EVEN ? 'accept' : 'veto') : (p < 50 ? 'accept' : 'veto');
      if (opts.keyboard) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press(c === 'accept' ? 'a' : 'v'); }
      else await page.click(c === 'accept' ? '#btn-accept' : '#btn-veto');
      st = await waitPhase(['reveal']);
    } else { shown.push(null); if (opts.coach) coachP.push(null); }
    calls.push(c);
    if (i >= 2 * W.WAVES) { if ((opts.shots || []).includes('reveal-off') && c) { await page.waitForTimeout(900); await shot('reveal-off'); } }
    else if ((opts.shots || []).includes('reveal') && c) { await page.waitForTimeout(900); await shot('reveal'); }
    if (opts.keyboard) { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('n'); }
    else await page.click('#btn-go');
  }
  const st = await state();
  const rep = replay(opts.seed, share, eqPref, calls);
  check('every wave matches the Node replay', JSON.stringify(st.log.map((e) => [e.kind, e.points])) === JSON.stringify(rep.log.map((e) => [e.kind, e.points])),
    { page: st.log.length, node: rep.log.length });
  check('points match the Node replay', st.points === rep.summary.points, { page: st.points, node: rep.summary.points });
  const agree = rep.waves.reduce((a, w, i) => a + (w.declTick && shown[i] !== null ? ((shown[i] < 50) === !!w.calVote ? 1 : 0) : 0), 0);
  if (opts.policy === 'shield') check('the shown faded share gives the shield\'s vote', agree === rep.summary.declared, { agree, declared: rep.summary.declared });
  if (opts.coach) {
    const want = rep.waves.slice(0, waves).map((w) => (w.declTick ? W.predict(W.COACH, w).p : null));
    const worst = coachP.reduce((m, p, i) => Math.max(m, p === null || want[i] === null ? (p === want[i] ? 0 : 1) : Math.abs(p - want[i])), 0);
    check('the coach shown in the browser matches Node', worst < 1e-12, { worst, n: coachP.filter((x) => x !== null).length });
    check('advice is counted for every call made with the coach on', st.coachShown === rep.summary.declared, { shown: st.coachShown, declared: rep.summary.declared });
  }
  let endRows = null;
  if (waves === W.TOTAL) {
    check('run ends', st.phase === 'end', st.phase);
    endRows = await page.$$eval('#end-body tr', (rows) => rows.map((r) => [r.cells[0].textContent, r.cells[1].textContent]));
    const s = rep.summary, want = [s.base, s.points, s.shield, s.coach, s.acceptAll, s.vetoAll, s.best];
    check('end table matches the Node replay', JSON.stringify(endRows.map((r) => num(r[1]))) === JSON.stringify(want), { page: endRows.map((r) => num(r[1])), node: want });
    if (opts.policy === 'shield') check('playing the shield\'s vote ties the shield', s.base === s.shield, { base: s.base, shield: s.shield });
    if (opts.policy === 'accept') check('accepting everything ties accept-all', s.base === s.acceptAll, { base: s.base, acceptAll: s.acceptAll });
    if (opts.policy === 'coach') check('following the coach ties the coach row', s.base === s.coach, { base: s.base, coach: s.coach });
    const code = W.encodeRun(opts.seed, rep.log);
    check('the replay code matches Node', st.replay === code, { page: st.replay, node: code });
    check('the address holds the replay code', (await page.evaluate(() => location.hash)).includes('r=' + code), null);
    if (opts.replayCheck) {
      const vp = await ctx.newPage();
      vp.on('pageerror', (e) => errors.push(String(e)));
      await vp.goto(`http://127.0.0.1:${port}/watch.html#s=${opts.seed}${lang === 'fr' ? '&l=fr' : ''}&r=${code}`);
      await vp.waitForFunction(() => typeof window.PairWatchState === 'function');
      const v = await vp.evaluate(() => window.PairWatchState().verify);
      check('a replay link is checked on load', v && v.ok && v.points === s.points, v);
      check('the replay check is shown with its table', await vp.evaluate(() => !document.getElementById('verify').hidden && document.querySelectorAll('#verify-body tr').length >= 6), null);
      if ((opts.shots || []).includes('verify')) { opts.shots = opts.shots.filter((x) => x !== 'verify'); await vp.locator('#verify').screenshot({ path: path.join(shots, `${name}-verify.png`) }); }
      const k = Math.floor(code.length / 2), alt = code[k] === 'a' ? 'b' : 'a';
      const bad = code.slice(0, k) + alt + code.slice(k + 1);
      await vp.goto(`http://127.0.0.1:${port}/watch.html#s=${opts.seed}&r=${bad}`);
      await vp.reload();
      await vp.waitForFunction(() => typeof window.PairWatchState === 'function');
      const vb = await vp.evaluate(() => ({ v: window.PairWatchState().verify, bad: document.getElementById('verify').classList.contains('bad') }));
      check('a code changed in one character is rejected', !!vb.v && !vb.v.ok && vb.bad, vb);
      await vp.close();
    }
    const share0 = await page.textContent('#share');
    check('score card names the seed', share0.includes(opts.seed), share0.split('\n')[0]);
    await page.click('#end summary');
    await shot('end', true);
  }
  const info = await page.evaluate((args) => {
    const body = document.body.innerText, keys = args.keys;
    const untranslated = keys.filter((k) => body.includes(k));
    if (args.lang === 'fr') args.enLong.forEach((s) => { if (body.includes(s)) untranslated.push(s.slice(0, 40)); });
    const cv = document.getElementById('scene'), px = cv.getContext('2d').getImageData(2, 2, 1, 1).data;
    return { lang: document.documentElement.lang, hc: document.documentElement.classList.contains('hc'), overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      untranslated, corner: [px[0], px[1], px[2]], canvasW: cv.clientWidth };
  }, { keys: Object.keys(LANGS.en).filter((k) => k.includes('.')), lang, enLong: Object.values(LANGS.en).filter((s) => s.length > 30 && !/Jean-François|SYNTHETIC/.test(s)) });
  if (opts.hc) check('high contrast scene background is black', info.corner.join() === '0,0,0', info.corner);
  await ctx.close();
  const ok = errors.length === 0 && external.length === 0 && !info.overflowX && info.untranslated.length === 0 &&
    info.lang === lang && info.hc === !!opts.hc && checks.every((x) => x.ok);
  return Object.assign({ name, ok, wallMs: Date.now() - t0, errors, external, opts: { seed: opts.seed, share, eqPref, policy: opts.policy, keyboard: !!opts.keyboard, waves },
    points: st.points, base: rep.summary.base, shield: rep.summary.shield, acceptAll: rep.summary.acceptAll, best: rep.summary.best, checks }, info);
}
(async () => {
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
  const cases = [
    ['en', 'desktop', { seed: 'e2e-w1', policy: 'shield', slow: true, replayCheck: true, shots: ['start', 'play', 'decide', 'reveal', 'reveal-off', 'end', 'verify'] }],
    ['fr', 'phone', { seed: 'e2e-w2', policy: 'accept', keyboard: true, replayCheck: true, shots: ['start', 'decide', 'reveal', 'end', 'verify'] }],
    ['en', 'desktop', { seed: 'e2e-w3', policy: 'veto', hc: true, waves: 8, shots: ['decide', 'reveal'] }],
    ['fr', 'desktop', { seed: 'e2e-w4', policy: 'shield', share: 3, eqOff: true, shots: ['reveal-off'] }],
    ['en', 'phone', { seed: 'e2e-w5', policy: 'shield', reduced: true, waves: 6, shots: ['decide'] }],
    ['en', 'desktop', { seed: 'e2e-w6', policy: 'coach', coach: true, shots: ['meter', 'end'] }],
    ['fr', 'phone', { seed: 'e2e-w7', policy: 'coach', coach: true, hc: true, waves: 8, shots: ['meter'] }]
  ];
  const report = [];
  for (const [lang, view, opts] of cases) report.push(await runCase(browser, lang, view, opts));
  await browser.close();
  server.close();
  const out = { version: W.VERSION, chrome: process.env.CHROME || '/usr/bin/google-chrome', allOk: report.every((r) => r.ok), servedOther: served, cases: report };
  fs.writeFileSync(path.join(root, 'docs', 'watch-e2e-report.json'), JSON.stringify(out, null, 2) + '\n');
  for (const r of report) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: points ${r.points} (calls ${r.base}, shield ${r.shield}, accept-all ${r.acceptAll}, best ${r.best}), ${r.errors.length} errors, ${r.external.length} external requests, overflow ${r.overflowX}, untranslated ${r.untranslated.length}, ${r.wallMs} ms`);
    for (const c of r.checks) console.log(`     ${c.ok ? 'ok  ' : 'FAIL'} ${c.what}: ${JSON.stringify(c.got).slice(0, 160)}`);
    for (const e of r.errors) console.log('     ' + e);
    if (r.untranslated.length) console.log('     untranslated: ' + JSON.stringify(r.untranslated));
  }
  process.exit(out.allOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
