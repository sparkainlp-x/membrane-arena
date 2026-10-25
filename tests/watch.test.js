'use strict';
/* Tests for watch.js, the Pair Watch game logic (SYNTHETIC classical simulation).
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only. */
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../watch.js');
const P = require('../pair.js');
const G = require('../game.js');

// play a whole run with one policy; returns the run, every wave and the summary
function play(seed, share, eq, pick) {
  const run = W.createRun(seed), waves = [];
  while (!W.done(run)) {
    const w = W.playWave(run, { share, eq });
    waves.push(w);
    W.resolve(run, w, w.declTick ? (pick(w) ? 'accept' : 'veto') : null);
  }
  return { run, waves, s: W.summarize(run.log) };
}
// the faded share the page shows at the declaration, from the frames alone
function shownShare(w) {
  const fr = w.frames[w.declTick - 1];
  let s = 0;
  for (let f = 0; f < W.NF; f++) if (fr.est[f] < P.FADED) s += fr.spec[f];
  return s;
}
const golden = play('golden', 2, true, (w) => w.calVote);
const noEq = play('golden', 4, false, () => true);

test('a run is 3 stages of 8 waves, seeded and repeatable', () => {
  assert.equal(W.TOTAL, 24);
  assert.deepEqual(W.STAGES.map((s) => [s.eq, s.off]), [[false, false], [true, false], [true, true]]);
  const a = W.createRun('same'), b = W.createRun('same'), c = W.createRun('other');
  assert.deepEqual(a.waves, b.waves);
  assert.notDeepEqual(a.waves, c.waves);
  assert.equal(a.waves.length, 24);
  for (let si = 0; si < 3; si++) {
    const st = a.waves.filter((w) => w.stage === si);
    assert.equal(st.length, 8);
    assert.deepEqual(st.map((w) => w.e).sort(), [0, 1, 2, 3, 4, 5, 6, 7], 'each stage plays all 8 episodes of one round once');
    st.forEach((w) => assert.ok(w.depth >= 0.7 && w.depth <= 0.95));
  }
});

test('the equalizer stays locked in stage 1 and the tick share is clamped', () => {
  const run = W.createRun('lock');
  const w = W.playWave(run, { share: 99, eq: true });
  assert.deepEqual(w.settings, { share: P.SHARE_MAX, eq: false });
  assert.deepEqual(W.sanitize({ share: 0 }, W.STAGES[1]), { share: 1, eq: false });
  assert.deepEqual(W.sanitize({ share: 'x', eq: true }, W.STAGES[1]), { share: 2, eq: true });
  assert.deepEqual(W.sanitize(null, W.STAGES[2]), { share: 2, eq: false });
});

test('every wave is an exact Reverse Pair episode: frames match pair.js tick by tick', () => {
  for (const r of [golden, noEq]) {
    for (const w of r.waves) {
      assert.equal(w.frames.length, P.TICKS);
      let worst = 0;
      for (let k = 0; k < P.TICKS; k++) worst = Math.max(worst, Math.abs(w.frames[k].E - w.trace[k]));
      assert.ok(worst < 1e-5, `wave ${w.index}: frames drift ${worst} from pair.js`);
      w.frames.forEach((fr, k) => {
        assert.equal(fr.who, P.owner(k + 1, w.settings.share));
        assert.equal(fr.f >= 0, fr.who === 'c');
      });
    }
  }
});

test('the declaration is the first check at or over the tuned threshold', () => {
  for (const w of golden.waves.concat(noEq.waves)) {
    assert.equal(w.th, P.TUNED[w.stageInfo.off ? 'off' : 'grid']);
    const checks = [];
    for (let t = P.CHECK; t <= P.TICKS; t += P.CHECK) checks.push(t);
    const first = checks.find((t) => w.trace[t - 1] >= w.th) || null;
    assert.equal(w.declTick, first, `wave ${w.index}`);
  }
});

test('the faded share the page shows gives the calibrator\'s own vote', () => {
  let n = 0;
  for (const w of golden.waves.concat(noEq.waves, play('vote', 3, true, () => false).waves)) {
    if (!w.declTick) { assert.equal(w.calVote, null); continue; }
    n++;
    assert.ok(Math.abs(shownShare(w) - w.fadedShare) < 1e-5, `wave ${w.index}`);
    assert.equal(shownShare(w) < 0.5, w.calVote, `wave ${w.index}`);
  }
  assert.ok(n >= 30, `${n} declarations checked`);
});

test('stage 3 fades fall between the calibrator\'s tones', () => {
  const kinds = golden.waves.map((w) => (w.fade ? w.fade.kind : null));
  for (let i = 0; i < 24; i++) if (kinds[i]) assert.equal(kinds[i], i < 16 ? 'grid' : 'off');
  assert.ok(kinds.slice(16).filter(Boolean).length >= 4);
});

test('points follow the table and good calls build a streak bonus up to 40', () => {
  assert.deepEqual(W.POINTS, { acceptTrue: 100, acceptFalse: -150, vetoTrue: -40, vetoFalse: 60, quietClean: 10, quietPlanted: -20 });
  const run = { seed: 'x', waves: new Array(24), idx: 0, log: [] };
  const fake = (o) => Object.assign({ index: run.idx, stage: 0, settings: {}, planted: true, declTick: 20, truth: true, onFade: false, calVote: true, fadedShare: 0, fade: null }, o);
  const got = [];
  for (let i = 0; i < 6; i++) got.push(W.resolve(run, fake({}), 'accept').points);
  assert.deepEqual(got, [100, 110, 120, 130, 140, 140]);
  assert.equal(W.resolve(run, fake({ truth: false, onFade: true }), 'accept').points, -150);
  assert.equal(run.log[6].reason, 'fade');
  assert.equal(W.resolve(run, fake({ truth: false }), 'veto').points, 60);
  assert.equal(run.log[7].reason, 'noise');
  assert.equal(W.resolve(run, fake({}), 'veto').points, -40);
  assert.equal(W.resolve(run, fake({ declTick: null, planted: false }), null).points, 10);
  assert.equal(W.resolve(run, fake({ declTick: null, planted: true }), null).points, -20);
  const s = W.summarize(run.log);
  assert.equal(s.bonus, 140);   // 0 + 10 + 20 + 30 + 40 + 40, then every streak restarts
  assert.equal(s.base, s.points - s.bonus);
});

test('a call is required for a declaration, and waves are played in order', () => {
  const run = W.createRun('order');
  const w = W.playWave(run, { share: 2 });
  if (w.declTick) assert.throws(() => W.resolve(run, w, null), /needs a call/);
  W.resolve(run, w, w.declTick ? 'veto' : null);
  assert.throws(() => W.resolve(run, w, 'accept'), /out of order/);
  while (!W.done(run)) { const x = W.playWave(run, { share: 2 }); W.resolve(run, x, x.declTick ? 'accept' : null); }
  assert.throws(() => W.playWave(run, { share: 2 }), /finished/);
});

test('the end-of-run comparison: the shield, accept-all, veto-all and perfect calls', () => {
  const s = golden.s;
  assert.equal(s.waves, 24);
  assert.equal(s.base, s.shield, 'playing the calibrator\'s vote ties the shield');
  assert.equal(s.agreeShield, s.declared);
  assert.equal(noEq.s.base, noEq.s.acceptAll, 'accepting everything ties accept-all');
  for (const r of [golden, noEq]) {
    assert.ok(r.s.best >= Math.max(r.s.shield, r.s.acceptAll, r.s.vetoAll));
    assert.equal(r.s.best, W.policyPoints(r.run.log, (e) => !!e.truth));
  }
});

test('golden run: same seed, same game', () => {
  const s = golden.s;
  assert.deepEqual([s.declared, s.acceptTrue, s.acceptFalse, s.quietClean, s.quietPlanted], [13, 10, 3, 11, 0]);
  assert.deepEqual([s.base, s.points, s.shield, s.acceptAll, s.vetoAll, s.best], [660, 870, 660, 660, -110, 1290]);
  assert.equal(golden.run.log.map((e) => W.GLYPH[e.kind]).join(''), '\u25C6\u00B7\u2715\u25C6\u00B7\u25C6\u00B7\u00B7\u25C6\u25C6\u00B7\u00B7\u25C6\u00B7\u2715\u25C6\u25C6\u2715\u00B7\u00B7\u25C6\u00B7\u00B7\u25C6');
  assert.deepEqual([noEq.s.base, noEq.s.shield, noEq.s.acceptAll, noEq.s.best], [340, 1250, 340, 1390], 'without the equalizer the shield helps a lot');
});

test('ranks', () => {
  const base = { waves: 24, best: 500, shield: 300, acceptAll: 100 };
  assert.equal(W.rank(Object.assign({}, base, { base: 500 })), 'perfect');
  assert.equal(W.rank(Object.assign({}, base, { base: 350 })), 'beatShield');
  assert.equal(W.rank(Object.assign({}, base, { base: 300 })), 'tieShield');
  assert.equal(W.rank(Object.assign({}, base, { base: 200 })), 'learning');
  assert.equal(W.rank(Object.assign({}, base, { base: 100 })), 'fooled');
  assert.equal(W.rank({ waves: 0 }), 'none');
});

test('seeds, links and the share card', () => {
  assert.equal(W.dailySeed('2026-10-25'), 'w2026-10-25');
  assert.ok(W.SEED_RE.test(W.dailySeed(G.localDateString(new Date()))));
  const h = W.buildHash({ seed: 'abc', lang: 'fr' });
  assert.deepEqual([W.parseHash(h).seed, W.parseHash(h).lang], ['abc', 'fr']);
  assert.ok(!W.parseHash('#s=<bad>').seed);
  const L = require('../watch-i18n.js').LANGS;
  const t = (k, v) => G.fmt(L.en[k], v);
  const card = W.shareText({ seed: 'golden', summary: golden.s, log: golden.run.log }, t).split('\n');
  assert.equal(card[0], 'Pair Watch golden');
  assert.equal(card[1], '660 points from calls (+210 streak bonus). Calibrator\'s shield on the same waves: 660.');
  assert.equal(card[2], 'Stage 1 ' + W.strip(golden.run.log, 0));
  assert.equal(W.strip(golden.run.log, 0).length, 8);
  assert.match(card[card.length - 1], /SYNTHETIC/);
});

test('the game does not change the published Reverse Pair engine', () => {
  // the version and the tuned thresholds the held-out evaluation used
  assert.equal(W.VERSION, P.VERSION);
  assert.deepEqual(P.TUNED, { grid: 0.65, off: 0.7 });
  const RES = require('../docs/pair-results.json');
  const flat = JSON.stringify(RES);
  assert.ok(flat.includes('0.65') && flat.includes('0.7'));
});
