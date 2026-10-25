/*
 * Membrane Arena: Pair Watch, a visual game on the Reverse Pair (SYNTHETIC classical simulation).
 * Pure logic: no DOM, no network, no storage.
 *
 * The player is the second vote of the 2-membrane shield. Each wave is one Reverse Pair episode,
 * played tick by tick: the observer (a reverse membrane) learns away from energy, and the calibrator
 * (the predictable one) plays its known sine tones and reads back how much of each arrives. When the
 * observer declares, the wave stops and the player accepts or vetoes the find, using what the
 * calibrator has read. Then the truth is shown: was a dark pattern planted, and did the find hit it
 * or the fade?
 *
 * Three stages of 8 waves follow the Reverse Pair findings: the observer alone against on-grid fades,
 * then the equalizer unlocks, then fades fall between the calibrator's tones (off-grid). Before each
 * wave the player sets the tick (observer ticks per calibrator tick) and, from stage 2, the
 * equalizer. At the end the player's calls are compared with the calibrator's own shield vote, with
 * accepting everything and with vetoing everything, on the same waves and the same settings.
 *
 * Every wave is an exact Reverse Pair episode: the frames below recompute pair.js's trajectory step
 * by step (tests/watch.test.js checks they match it number for number), and the declaration and the
 * calibrator's vote come from pair.js itself. The points are this game's own and are not the arena
 * score. Nothing here models negative energy, antimatter, real membranes, neurons, oscillators,
 * radio hardware or any physical system.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // the fitted coach is optional: scripts/watch-check.js writes it and the game works without it
    var coach = null;
    try { coach = require('./watch-coach.js'); } catch (e) { coach = null; }
    module.exports = factory(require('./game.js'), require('./reverse.js'), require('./pair.js'), coach);
  } else root.ArenaWatch = factory(root.ArenaGame, root.ArenaReverse, root.ArenaPair, root.ArenaWatchCoach || null);
})(typeof self !== 'undefined' ? self : this, function (G, R, P, COACH) {
  'use strict';
  var VERSION = G.VERSION;
  var GEN = 'membrane-arena/watch/v1/';
  var N = P.N, NF = P.FREQS.length, TICKS = P.TICKS, CHECK = P.CHECK;
  var WAVES = 8;                            // waves per stage (one Reverse Pair round)
  var STAGES = [
    { id: 1, eq: false, off: false },       // the observer alone against on-grid fades
    { id: 2, eq: true, off: false },        // the equalizer unlocks
    { id: 3, eq: true, off: true }          // fades fall between the calibrator's tones
  ];
  var TOTAL = WAVES * STAGES.length;
  // points for the player's call (this game's own scale)
  var POINTS = { acceptTrue: 100, acceptFalse: -150, vetoTrue: -40, vetoFalse: 60, quietClean: 10, quietPlanted: -20 };
  var STREAK_BONUS = 10, STREAK_MAX = 5;
  function round2(x) { return Math.round(x * 100) / 100; }

  /* ---------- the run ---------- */
  // a seeded shuffle of 0..n-1
  function perm(n, rng) {
    var a = [], i, j, t;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function createRun(seed) {
    seed = String(seed);
    var r = G.makeRng(GEN + seed + '/run'), waves = [];
    STAGES.forEach(function (st, si) {
      var order = perm(WAVES, r);
      for (var k = 0; k < WAVES; k++) {
        waves.push({ stage: si, gen: si, e: order[k], depth: round2(0.7 + 0.25 * r()) });
      }
    });
    return { seed: seed, waves: waves, idx: 0, log: [] };
  }
  function done(run) { return run.idx >= TOTAL; }
  function stageOf(run) { return STAGES[Math.min(STAGES.length - 1, Math.floor(run.idx / WAVES))]; }
  function sanitize(settings, stage) {
    var s = settings && typeof settings === 'object' ? settings : {};
    var share = Math.round(Number(s.share));
    if (!isFinite(share)) share = 2;
    share = Math.min(P.SHARE_MAX, Math.max(1, share));
    return { share: share, eq: !!(stage.eq && s.eq) };
  }
  // the Reverse Pair world behind wave i of a run
  function worldFor(run, i) {
    var wv = run.waves[i], st = STAGES[wv.stage];
    return P.world({ seed: run.seed + '~watch', gen: wv.gen, e: wv.e, depth: wv.depth, kind: st.off ? 'off' : 'grid' });
  }
  // share of a vector's energy in each calibration frequency
  function spectrum(v) {
    var X = P.dft(v, false), s = new Float32Array(NF), n = 0, k, q;
    for (k = 0; k < N; k++) { q = X.r[k] * X.r[k] + X.i[k] * X.i[k]; s[P.freqOf(k)] += q; n += q; }
    if (n > 0) for (k = 0; k < NF; k++) s[k] /= n;
    return s;
  }

  /* ---------- one wave, frame by frame ---------- */
  // Recomputes pair.js's trajectory() for the page, keeping what the picture needs at every tick:
  // who owns the tick, the opposite energy, the observer's spectrum, the calibrator's latest readings
  // and the tone it just read. Stops recording once the observer has declared.
  function frames(w, mode, share) {
    var v = G.copyVec(w.v0), win = [], buf = [], est = new Float64Array(NF), out = [], E = 0, sweep = 0, t, r, b, k;
    var eta = R.ETA.reverse;
    for (k = 0; k < NF; k++) est[k] = 1;
    var spec = spectrum(v);
    for (t = 1; t <= TICKS; t++) {
      var fr = { t: t, who: P.owner(t, share), f: -1, reading: null };
      if (fr.who === 'o') {
        var x = P.observeAt(w, t);
        if (mode === 'eq') x = P.shape(x, est, true);
        x = G.normalize(x);
        var y = G.inner(x, v);
        win.push(y.re * y.re + y.im * y.im); if (win.length > P.WINDOW) win.shift();
        buf.push(x); if (buf.length > P.WINDOW) buf.shift();
        R.update(v, x, -1, eta);
        for (r = 0; r < P.ECHO; r++) for (b = 0; b < buf.length; b++) R.update(v, buf[b], -1, eta);
        E = R.signedEnergy('reverse', G.energyRatio(win, N));
        spec = spectrum(v);
      } else {
        var f = P.FREQS[sweep % NF]; sweep++;
        est[f] = P.readAt(w, f, t);
        fr.f = f; fr.reading = est[f];
      }
      fr.E = E; fr.spec = spec; fr.est = Float32Array.from(est);
      fr.gain = P.gainsAt(w.fade, t);
      fr.check = t % CHECK === 0;
      out.push(fr);
    }
    return out;
  }
  // The outcome of wave i under some settings, without the frames: what the evaluation and the
  // replay check need. It is the same Reverse Pair episode the page draws.
  function evaluate(run, i, settings) {
    var wv = run.waves[i], st = STAGES[wv.stage], s = sanitize(settings, st);
    var w = worldFor(run, i), mode = s.eq ? 'eq' : 'raw', th = P.TUNED[st.off ? 'off' : 'grid'];
    var tr = P.trajectory(w, mode, s.share), d = P.decide(w, tr, th, 'cal');
    var declTick = d.check ? d.check.t : null;
    return {
      index: i, stage: wv.stage, settings: s, th: th, planted: w.planted, depth: wv.depth,
      declTick: declTick, truth: d.truth, onFade: d.onFade, calVote: d.check ? !!d.check.cal : null,
      fadedShare: declTick ? P.fadedShare(lastV(w, mode, s.share, declTick), d.check.est) : null,
      fid: d.check ? d.check.fid : null, fade: w.fade ? { kind: w.fade.kind } : null, world: w, tr: tr
    };
  }
  // Everything the page needs to play wave run.idx with the player's settings.
  function playWave(run, settings) {
    if (done(run)) throw new Error('run finished');
    var ev = evaluate(run, run.idx, settings), w = ev.world, st = STAGES[ev.stage];
    return {
      index: ev.index, stage: ev.stage, stageInfo: st, settings: ev.settings, th: ev.th,
      planted: ev.planted, depth: ev.depth,
      fade: w.fade ? { kind: w.fade.kind, depth: w.fade.depth, band: w.fade.band, center: w.fade.center, bw: w.fade.bw, w: Array.from(w.fade.w) } : null,
      frames: frames(w, ev.settings.eq ? 'eq' : 'raw', ev.settings.share), declTick: ev.declTick, truth: ev.truth, onFade: ev.onFade,
      calVote: ev.calVote, fadedShare: ev.fadedShare, fid: ev.fid, trace: Array.from(ev.tr.trace)
    };
  }
  // the observer's vector at tick tEnd (the frames keep only its spectrum)
  function lastV(w, mode, share, tEnd) {
    var v = G.copyVec(w.v0), win = [], buf = [], est = new Float64Array(NF), sweep = 0, t, r, b, k, eta = R.ETA.reverse;
    for (k = 0; k < NF; k++) est[k] = 1;
    for (t = 1; t <= tEnd; t++) {
      if (P.owner(t, share) === 'o') {
        var x = P.observeAt(w, t);
        if (mode === 'eq') x = P.shape(x, est, true);
        x = G.normalize(x);
        buf.push(x); if (buf.length > P.WINDOW) buf.shift();
        R.update(v, x, -1, eta);
        for (r = 0; r < P.ECHO; r++) for (b = 0; b < buf.length; b++) R.update(v, buf[b], -1, eta);
      } else { var f = P.FREQS[sweep % NF]; sweep++; est[f] = P.readAt(w, f, t); }
    }
    return v;
  }

  /* ---------- calls and points ---------- */
  // what happens for a call: 'accept', 'veto', or null when the observer never declared
  function outcome(wave, call) {
    if (!wave.declTick) return wave.planted ? { kind: 'quietPlanted', points: POINTS.quietPlanted, good: false }
      : { kind: 'quietClean', points: POINTS.quietClean, good: true };
    if (call === 'accept') return wave.truth ? { kind: 'acceptTrue', points: POINTS.acceptTrue, good: true }
      : { kind: 'acceptFalse', points: POINTS.acceptFalse, good: false };
    return wave.truth ? { kind: 'vetoTrue', points: POINTS.vetoTrue, good: false }
      : { kind: 'vetoFalse', points: POINTS.vetoFalse, good: true };
  }
  // why a find was false: it sat on the fade, or it was noise
  function falseReason(wave) { return !wave.declTick || wave.truth ? null : wave.onFade ? 'fade' : 'noise'; }
  /* ---------- the coach: a calibrated estimate of P(real find) ---------- */
  // Accepting is worth more than vetoing exactly when P(real) is above this (docs/WATCH-PROTOCOL.md 1).
  var BREAK_EVEN = (POINTS.vetoFalse - POINTS.acceptFalse) / ((POINTS.acceptTrue - POINTS.acceptFalse) + (POINTS.vetoFalse - POINTS.vetoTrue));
  var FEATURES = ['intercept', 'off', 'eq', 'off*eq', 'f', 'f^2', 'f*eq', 't20', 'early', 'late', 'share-2'];
  // what the player can see at a declaration (docs/WATCH-PROTOCOL.md 2)
  function features(e) {
    var off = STAGES[e.stage].off ? 1 : 0, eq = e.settings.eq ? 1 : 0, f = e.fadedShare, t = e.declTick;
    return [1, off, eq, off * eq, f, f * f, f * eq, t === CHECK ? 1 : 0, t <= 2 * CHECK ? 1 : 0, t === TICKS ? 1 : 0, e.settings.share - 2];
  }
  function sigmoid(z) { return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }
  // the model's estimate and 95% interval for one declaration; null without a model or a declaration
  function predict(model, e) {
    if (!model || !e || !e.declTick) return null;
    var x = features(e), b = model.beta, S = model.cov, z = 0, v = 0, i, j;
    for (i = 0; i < x.length; i++) z += x[i] * b[i];
    for (i = 0; i < x.length; i++) for (j = 0; j < x.length; j++) v += x[i] * S[i][j] * x[j];
    var se = Math.sqrt(Math.max(0, v));
    return { p: sigmoid(z), lo: sigmoid(z - 1.96 * se), hi: sigmoid(z + 1.96 * se), z: z, se: se };
  }
  function coachAccepts(model, e) { var q = predict(model, e); return !!q && q.p > BREAK_EVEN; }
  // the policies of docs/WATCH-PROTOCOL.md 4: does the policy accept this declaration?
  var POLICIES = {
    coach: function (e, ctx) { return coachAccepts(ctx.model, e); },
    shield: function (e) { return !!e.calVote; },
    acceptAll: function () { return true; },
    vetoAll: function () { return false; },
    random: function (e, ctx) { return G.makeRng('watch-random/' + ctx.seed + '/' + e.index + '/' + ctx.profile)() < 0.5; },
    perfect: function (e) { return !!e.truth; }
  };
  function resolve(run, wave, call) {
    if (done(run)) throw new Error('run finished');
    if (wave.index !== run.idx) throw new Error('wave out of order');
    if (wave.declTick && call !== 'accept' && call !== 'veto') throw new Error('a declared wave needs a call');
    var c = wave.declTick ? call : null, o = outcome(wave, c), prev = run.log.length ? run.log[run.log.length - 1].streak : 0;
    var streak = o.good ? Math.min(STREAK_MAX, prev + 1) : 0;
    var bonus = o.good && wave.declTick ? STREAK_BONUS * (streak - 1) : 0;
    var entry = { index: wave.index, stage: wave.stage, settings: wave.settings, planted: wave.planted, declTick: wave.declTick,
      truth: wave.truth, onFade: wave.onFade, calVote: wave.calVote, fadedShare: wave.fadedShare, call: c,
      kind: o.kind, good: o.good, points: o.points + bonus, bonus: bonus, streak: streak, reason: falseReason(wave),
      fade: wave.fade ? wave.fade.kind : null };
    run.log.push(entry);
    run.idx++;
    return entry;
  }
  // a policy's points on the logged waves (no streak bonus, so policies compare on the same scale)
  function policyPoints(log, pick) {
    return log.reduce(function (a, e) {
      var call = e.declTick ? (pick(e) ? 'accept' : 'veto') : null;
      return a + outcome(e, call).points;
    }, 0);
  }
  function summarize(log) {
    var s = { waves: log.length, points: 0, bonus: 0, declared: 0, accepted: 0, acceptTrue: 0, acceptFalse: 0, vetoTrue: 0, vetoFalse: 0,
      quietClean: 0, quietPlanted: 0, agreeShield: 0, bestStreak: 0, byStage: STAGES.map(function () { return { points: 0, good: 0, waves: 0 }; }) };
    log.forEach(function (e) {
      s.points += e.points; s.bonus += e.bonus; s[e.kind]++;
      if (e.declTick) { s.declared++; if (e.call === 'accept') s.accepted++; if ((e.call === 'accept') === !!e.calVote) s.agreeShield++; }
      s.bestStreak = Math.max(s.bestStreak, e.streak);
      var b = s.byStage[e.stage]; b.points += e.points; b.waves++; if (e.good) b.good++;
    });
    s.base = s.points - s.bonus;
    s.shield = policyPoints(log, function (e) { return !!e.calVote; });
    s.acceptAll = policyPoints(log, function () { return true; });
    s.vetoAll = policyPoints(log, function () { return false; });
    s.best = policyPoints(log, function (e) { return !!e.truth; });
    s.coach = COACH ? policyPoints(log, function (e) { return coachAccepts(COACH, e); }) : null;
    return s;
  }
  // a rank for the end screen, from the player's points without streak bonus against the shield and the best possible
  function rank(s) {
    if (!s.waves) return 'none';
    if (s.base >= s.best) return 'perfect';
    if (s.base > s.shield) return 'beatShield';
    if (s.base === s.shield) return 'tieShield';
    if (s.base > s.acceptAll) return 'learning';
    return 'fooled';
  }

  /* ---------- seeds, links, share card ---------- */
  var SEED_RE = P.SEED_RE;
  function dailySeed(dateStr) { return 'w' + dateStr; }
  /* ---------- replay codes: a run's settings and calls, checked by replaying it ---------- */
  // One letter per wave for (tick share, equalizer, call), then two check characters over the seed and
  // the letters. The check catches typing and copying errors, not forgery: the replay recomputes every
  // point from the seed, so a code can only ever show the score its calls really earn.
  var CODE_ABC = 'abcdefghijklmnopqrstuvwx', CHECK_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var CODE_RE = /^[a-x]{1,24}[A-HJ-NP-Z2-9]{2}$/;
  var CALLS = ['accept', 'veto', null];
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function checkChars(seed, body) { var h = fnv(String(seed) + ':' + body) % 1024; return CHECK_ABC[h >> 5] + CHECK_ABC[h & 31]; }
  function encodeRun(seed, log) {
    var body = log.map(function (e) {
      return CODE_ABC[((e.settings.share - 1) * 2 + (e.settings.eq ? 1 : 0)) * 3 + CALLS.indexOf(e.call)];
    }).join('');
    return body ? body + checkChars(seed, body) : '';
  }
  function decodeRun(seed, code) {
    code = String(code || '');
    if (!CODE_RE.test(code)) return { ok: false, error: 'format' };
    var body = code.slice(0, -2);
    if (checkChars(seed, body) !== code.slice(-2)) return { ok: false, error: 'check' };
    return { ok: true, steps: body.split('').map(function (ch) {
      var k = CODE_ABC.indexOf(ch);
      return { share: Math.floor(k / 6) + 1, eq: Math.floor(k / 3) % 2 === 1, call: CALLS[k % 3] };
    }) };
  }
  // replays a code on its seed and returns the run, or why the code does not fit the seed
  function replayRun(seed, code) {
    if (!SEED_RE.test(String(seed))) return { ok: false, error: 'seed' };
    var dec = decodeRun(seed, code);
    if (!dec.ok) return dec;
    var run = createRun(seed);
    for (var i = 0; i < dec.steps.length; i++) {
      var st = dec.steps[i], stage = STAGES[run.waves[i].stage];
      if (st.eq && !stage.eq) return { ok: false, error: 'locked', at: i };
      var ev = evaluate(run, i, st);
      if (!ev.declTick !== (st.call === null)) return { ok: false, error: 'call', at: i };
      ev.index = run.idx;
      resolve(run, ev, st.call);
    }
    return { ok: true, run: run, summary: summarize(run.log), complete: done(run) };
  }
  function parseHash(hash) {
    var out = P.parseHash(hash), h = String(hash || '').replace(/^#/, '');
    out.replay = null;
    if (h.length <= 200) h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0 && kv.slice(0, i) === 'r' && CODE_RE.test(kv.slice(i + 1))) out.replay = kv.slice(i + 1);
    });
    return out;
  }
  function buildHash(o) {
    var base = P.buildHash(o);
    if (!o.replay || !CODE_RE.test(o.replay) || !base || base.indexOf('s=') < 0) return base;
    return base + '&r=' + o.replay;
  }
  var GLYPH = { acceptTrue: '\u25C6', acceptFalse: '\u2715', vetoTrue: '\u25CB', vetoFalse: '\u25A0', quietClean: '\u00B7', quietPlanted: '\u2013' };
  function strip(log, stage) { return log.filter(function (e) { return e.stage === stage; }).map(function (e) { return GLYPH[e.kind]; }).join(''); }
  function shareText(o, t) {
    var s = o.summary, lines = [];
    lines.push(t('share.title', { seed: o.seed }));
    lines.push(t('share.points', { p: s.base, b: s.bonus, sh: s.shield }));
    STAGES.forEach(function (st, i) { lines.push(t('share.stage', { n: st.id }) + ' ' + strip(o.log, i)); });
    lines.push(t('share.calls', { a: s.acceptTrue, f: s.acceptFalse, v: s.vetoFalse, m: s.vetoTrue }));
    if (o.code) lines.push(t('share.code', { code: o.code }));
    lines.push(t('share.tag'));
    return lines.join('\n');
  }
  return {
    VERSION: VERSION, GEN: GEN, N: N, NF: NF, TICKS: TICKS, CHECK: CHECK, WAVES: WAVES, STAGES: STAGES, TOTAL: TOTAL,
    POINTS: POINTS, STREAK_BONUS: STREAK_BONUS, STREAK_MAX: STREAK_MAX, SEED_RE: SEED_RE, GLYPH: GLYPH,
    createRun: createRun, done: done, stageOf: stageOf, sanitize: sanitize, worldFor: worldFor, spectrum: spectrum,
    frames: frames, playWave: playWave, outcome: outcome, falseReason: falseReason, resolve: resolve,
    policyPoints: policyPoints, summarize: summarize, rank: rank, dailySeed: dailySeed, parseHash: parseHash,
    buildHash: buildHash, strip: strip, shareText: shareText,
    evaluate: evaluate, BREAK_EVEN: BREAK_EVEN, FEATURES: FEATURES, features: features, sigmoid: sigmoid, predict: predict,
    coachAccepts: coachAccepts, POLICIES: POLICIES, COACH: COACH,
    CODE_RE: CODE_RE, encodeRun: encodeRun, decodeRun: decodeRun, replayRun: replayRun
  };
});
