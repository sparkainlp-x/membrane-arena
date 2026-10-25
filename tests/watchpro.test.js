/* Membrane Arena: tests for the Pair Watch coach, replay codes and the held-out evaluation.
 * SYNTHETIC game; no physical claims. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const W = require('../watch.js');
const COACH = require('../watch-coach.js');
const L = require('../watch-i18n.js').LANGS;

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');

// plays a whole run; settingsAt(i) gives the settings for wave i, choose(wave) the call
function playAll(seed, choose, settingsAt) {
  const run = W.createRun(seed);
  while (!W.done(run)) {
    const s = settingsAt ? settingsAt(run.idx) : { share: 2, eq: true };
    const w = W.playWave(run, s);
    W.resolve(run, w, w.declTick ? choose(w) : null);
  }
  return run;
}
const mixed = (i) => ({ share: 1 + (i % 4), eq: i % 3 !== 0 });

test('the fast evaluator gives exactly the wave the page plays', () => {
  for (const s of [{ share: 1, eq: false }, { share: 2, eq: true }, { share: 4, eq: true }]) {
    const run = W.createRun('wp-eval');
    for (let i = 0; i < W.TOTAL; i++) {
      const ev = W.evaluate(run, i, s);
      run.idx = i;
      const pw = W.playWave(run, s);
      for (const k of ['stage', 'planted', 'declTick', 'truth', 'onFade', 'calVote', 'fadedShare', 'fid']) {
        assert.deepEqual(ev[k], pw[k], `wave ${i} ${k} share ${s.share} eq ${s.eq}`);
      }
      assert.deepEqual(ev.settings, pw.settings);
    }
  }
});

test('the break-even probability comes from the points table', () => {
  assert.ok(Math.abs(W.BREAK_EVEN - 0.6) < 1e-12, String(W.BREAK_EVEN));
  const gain = (p) => (p * 100 + (1 - p) * -150) - (p * -40 + (1 - p) * 60);
  assert.ok(gain(0.59) < 0 && gain(0.61) > 0 && Math.abs(gain(W.BREAK_EVEN)) < 1e-9);
  assert.equal(COACH.breakEven, W.BREAK_EVEN);
});

test('the coach model is the frozen fit: calibration seeds only, converged, consistent shapes', () => {
  assert.equal(W.COACH, COACH, 'watch.js loads the fitted coach');
  assert.deepEqual(COACH.features, W.FEATURES);
  assert.equal(COACH.beta.length, W.FEATURES.length);
  assert.equal(COACH.cov.length, W.FEATURES.length);
  for (let i = 0; i < COACH.cov.length; i++) {
    assert.ok(COACH.cov[i][i] > 0, 'positive variances');
    for (let j = 0; j < COACH.cov.length; j++) assert.ok(Math.abs(COACH.cov[i][j] - COACH.cov[j][i]) < 1e-12, 'symmetric');
  }
  assert.equal(COACH.converged, true);
  assert.equal(COACH.lambda, 1);
  assert.match(COACH.fittedOn.seeds, /^wcal-000 to wcal-199$/);
  assert.equal(COACH.fittedOn.runs, 200);
});

test('coach estimates: null without a declaration, a probability inside its interval, less trust in faded finds', () => {
  const run = playAll('wp-coach', () => 'accept', mixed);
  assert.equal(W.predict(COACH, { declTick: null }), null);
  assert.equal(W.predict(null, run.log.find((e) => e.declTick)), null);
  let n = 0;
  for (const e of run.log) {
    const q = W.predict(COACH, e);
    if (!e.declTick) { assert.equal(q, null); continue; }
    n++;
    assert.ok(q.p > 0 && q.p < 1 && q.lo <= q.p && q.p <= q.hi && q.se > 0, JSON.stringify(q));
    assert.equal(W.coachAccepts(COACH, e), q.p > W.BREAK_EVEN);
  }
  assert.ok(n > 5);
  // with everything else fixed, a larger share of the find inside faded lanes means a lower estimate
  for (const eq of [false, true]) for (const stage of [1, 2]) {
    let prev = 2;
    for (let f = 0; f <= 1.0001; f += 0.1) {
      const p = W.predict(COACH, { declTick: 60, stage, settings: { share: 2, eq }, fadedShare: f }).p;
      assert.ok(p < prev, `stage ${stage} eq ${eq} f ${f.toFixed(1)}`);
      prev = p;
    }
  }
});

test('policies: the shield is the calibrator\'s vote, perfect is the truth, random is seeded, the coach row sums its calls', () => {
  const run = playAll('wp-policy', (w) => (w.calVote ? 'accept' : 'veto'), mixed);
  const s = W.summarize(run.log);
  assert.equal(s.base, s.shield, 'playing the shield ties the shield');
  const ctx = { model: COACH, seed: 'wp-policy', profile: '2/on' };
  for (const e of run.log.filter((x) => x.declTick)) {
    assert.equal(W.POLICIES.shield(e, ctx), !!e.calVote);
    assert.equal(W.POLICIES.perfect(e, ctx), !!e.truth);
    assert.equal(W.POLICIES.acceptAll(e, ctx), true);
    assert.equal(W.POLICIES.vetoAll(e, ctx), false);
    assert.equal(W.POLICIES.random(e, ctx), W.POLICIES.random(e, ctx));
    assert.equal(W.POLICIES.coach(e, ctx), W.coachAccepts(COACH, e));
  }
  const coachRun = playAll('wp-policy', (w) => (W.coachAccepts(COACH, w) ? 'accept' : 'veto'), mixed);
  const cs = W.summarize(coachRun.log);
  assert.equal(cs.base, cs.coach, 'following the coach ties the coach row');
  assert.equal(cs.coach, s.coach, 'the coach row does not depend on the player\'s calls');
});

test('replay codes: one letter per wave plus two check characters, and the replay gives back the same run', () => {
  const calls = ['accept', 'veto'];
  let k = 0;
  const run = playAll('wp-replay', () => calls[k++ % 2], (i) => (i < W.WAVES ? { share: 1 + (i % 4), eq: false } : mixed(i)));
  const code = W.encodeRun('wp-replay', run.log);
  assert.equal(code.length, W.TOTAL + 2);
  assert.match(code, /^[a-x]{24}[A-HJ-NP-Z2-9]{2}$/);
  const dec = W.decodeRun('wp-replay', code);
  assert.ok(dec.ok);
  dec.steps.forEach((st, i) => {
    assert.equal(st.share, run.log[i].settings.share);
    assert.equal(st.eq, run.log[i].settings.eq);
    assert.equal(st.call, run.log[i].call);
  });
  const rep = W.replayRun('wp-replay', code);
  assert.ok(rep.ok && rep.complete);
  assert.deepEqual(rep.run.log, run.log);
  assert.deepEqual(rep.summary, W.summarize(run.log));
  assert.equal(W.encodeRun('wp-replay', []), '');
});

test('replay codes: copying mistakes, a different seed and impossible runs are rejected', () => {
  const run = playAll('wp-bad', (w) => (w.calVote ? 'accept' : 'veto'));
  const code = W.encodeRun('wp-bad', run.log);
  let caught = 0;
  for (let i = 0; i < W.TOTAL; i++) {
    const ch = code[i] === 'a' ? 'b' : 'a';
    const r = W.replayRun('wp-bad', code.slice(0, i) + ch + code.slice(i + 1));
    if (!r.ok) caught++;
  }
  assert.ok(caught >= W.TOTAL - 1, `one-letter changes caught: ${caught} of ${W.TOTAL}`);
  assert.equal(W.replayRun('wp-other', code).error, 'check');
  assert.equal(W.replayRun('wp-bad', 'hello').error, 'format');
  assert.equal(W.replayRun('wp-bad', '').error, 'format');
  assert.equal(W.replayRun('<bad seed>', code).error, 'seed');
  // a correctly checked code that switches the equalizer on in stage 1
  const fakeEq = run.log.slice(0, 3).map((e) => Object.assign({}, e, { settings: { share: 2, eq: true } }));
  const r1 = W.replayRun('wp-bad', W.encodeRun('wp-bad', fakeEq));
  assert.equal(r1.error, 'locked'); assert.equal(r1.at, 0);
  // a correctly checked code that gives no call for a declared wave
  const i = run.log.findIndex((e) => e.declTick);
  const fakeCall = run.log.slice(0, i + 1).map((e, j) => (j === i ? Object.assign({}, e, { call: null }) : e));
  const r2 = W.replayRun('wp-bad', W.encodeRun('wp-bad', fakeCall));
  assert.equal(r2.error, 'call'); assert.equal(r2.at, i);
  // a partial run replays but is not complete
  const part = W.replayRun('wp-bad', W.encodeRun('wp-bad', run.log.slice(0, 5)));
  assert.ok(part.ok && !part.complete && part.run.log.length === 5);
});

test('links carry a replay code only with a seed, and bad codes are dropped', () => {
  const run = playAll('wp-link', () => 'accept');
  const code = W.encodeRun('wp-link', run.log);
  const h = W.buildHash({ seed: 'wp-link', replay: code });
  assert.ok(h.includes('s=wp-link') && h.endsWith('&r=' + code));
  assert.equal(W.parseHash(h).replay, code);
  assert.equal(W.parseHash(h).seed, 'wp-link');
  assert.equal(W.parseHash('#s=wp-link&r=<script>').replay, null);
  assert.equal(W.parseHash('#s=wp-link&r=' + 'a'.repeat(300)).replay, null);
  assert.ok(!W.buildHash({ replay: code }).includes('r='));
});

test('the evaluation is reproducible: the manifest names the seeds, versions and SHA-256 hashes of its files', () => {
  const m = JSON.parse(read('docs/watch-manifest.json')), pkg = JSON.parse(read('package.json'));
  assert.equal(m.version, '0.3.3'); // the evaluation published with v0.3.3
  assert.equal(m.checkedWith, pkg.version);
  assert.equal(m.command, 'node scripts/watch-check.js --write');
  assert.equal(m.seeds.calibration.length, 200);
  assert.equal(m.seeds.heldOut.length, 200);
  assert.ok(m.seeds.calibration.every((s) => /^wcal-\d{3}$/.test(s)));
  assert.ok(m.seeds.heldOut.every((s) => /^wtest-\d{3}$/.test(s)));
  assert.equal(new Set(m.seeds.calibration.concat(m.seeds.heldOut)).size, 400, 'the two seed sets are disjoint');
  for (const [f, h] of Object.entries(m.inputs)) assert.equal(sha(f), h, `input ${f} changed since the report was written: run node scripts/watch-check.js --write`);
  for (const [f, h] of Object.entries(m.outputs)) assert.equal(sha(f), h, `output ${f}`);
  assert.ok(Object.keys(m.outputs).includes('watch-coach.js'), 'the fitted coach is an output with its hash');
  assert.ok(m.generatedWith && /^v\d+/.test(m.generatedWith.node));
  const proto = sha('docs/WATCH-PROTOCOL.md');
  assert.equal(m.protocolSha256, proto);
  assert.equal(JSON.parse(read('docs/watch-results.json')).protocolSha256, proto);
  assert.ok(read('docs/watch-check.txt').includes('SHA-256 ' + proto));
  const csv = read('docs/watch-results.csv').trim().split('\n');
  assert.equal(csv[0], 'seed,profile,policy,points,declared,false_accepted,real_vetoed');
  assert.ok(csv.slice(1).every((l) => /^wtest-\d{3},/.test(l)), 'the CSV holds held-out seeds only');
  assert.equal(csv.length - 1, 200 * m.profiles.length * m.policies.length);
});

test('the frozen protocol states the model, seeds, policies, hypotheses and analysis', () => {
  const pr = read('docs/WATCH-PROTOCOL.md');
  for (const h of ['H1', 'H2', 'H3', 'H4']) assert.ok(pr.includes('**' + h), h);
  for (const w of [/calibration/i, /held-out/i, /bootstrap/i, /paired/i, /d_z/, /ECE/, /Brier/, /0\.6/, /not detectable/, /SYNTHETIC/]) assert.match(pr, w);
  // the published Reverse Pair protocol is not touched
  assert.equal(sha('docs/PAIR-PROTOCOL.md'), JSON.parse(read('docs/pair-results.json')).protocolSha256);
});

test('the page and docs quote the report: every number in the evaluation section is in docs/watch-check.txt', () => {
  const rep = read('docs/watch-check.txt'), res = JSON.parse(read('docs/watch-results.json'));
  for (const lang of ['en', 'fr']) {
    for (const k of ['eval.p1', 'eval.p2', 'eval.p3']) {
      const nums = (L[lang][k].replace(/(\d),(\d)/g, '$1.$2').match(/\d+(?:\.\d+)?/g) || []).filter((x) => x !== '95');
      assert.ok(nums.length >= 3, k);
      for (const x of nums) assert.ok(rep.includes(x), `${lang} ${k} quotes ${x}, which is not in the report`);
    }
  }
  // and they are the numbers of the results file, not just any numbers in the report
  const en = L.en['eval.p2'], s = res.summary[res.mainProfile], c = res.comparisons[res.mainProfile];
  const near = (txt, v) => (txt.match(/-?\d+\.\d/g) || []).some((x) => Math.abs(parseFloat(x) - v) <= 0.05 + 1e-9);
  for (const p of ['coach', 'shield', 'acceptAll']) {
    assert.ok(near(en, s[p].points.mean), `${p} mean`);
    for (const v of s[p].points.ci) assert.ok(near(en, v), `${p} interval`);
  }
  assert.ok(near(en, c['coach-shield'].mean) && c['coach-shield'].ci.every((v) => near(en, v)));
  assert.ok(en.includes(`${c['coach-shield'].wins} runs won, ${c['coach-shield'].ties} tied, ${c['coach-shield'].losses} lost`));
  assert.ok(L.en['eval.p1'].includes(String(res.calibration.declarations)));
  assert.ok(L.en['eval.p3'].includes(`disagree on ${res.disagreement.n}`) && L.en['eval.p3'].includes(`right on ${res.disagreement.coachRight}`));
  // H2 is only claimed because its interval excludes zero
  assert.ok(c['coach-shield'].ci[0] > 0);
  const doc = read('docs/WATCH.md').replace(/(\d),(\d)/g, '$1.$2');
  for (const x of ['0.0083', '1084.8', '1053.0', '914.4', '31.9', '16.5', '47.6', '138.6']) assert.ok(doc.includes(x), `docs/WATCH.md quotes ${x}`);
});

test('the page loads the fitted coach before the game logic, and the coach starts off', () => {
  const html = read('watch.html');
  const order = ['game.js', 'reverse.js', 'pair.js', 'watch-coach.js', 'watch.js', 'watch-i18n.js', 'watchui.js'].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((x) => x > 0), JSON.stringify(order));
  assert.ok(order.every((x, i) => i === 0 || x > order[i - 1]), 'dependency order');
  assert.match(html, /<input[^>]*id="coach"(?![^>]*checked)[^>]*>/, 'coach switch present and unchecked');
  const ui = read('watchui.js');
  assert.ok(/W\.resolve\(run, [a-z]+, call\)/.test(ui), 'the player\'s own call is what scores');
});
