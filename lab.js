/*
 * Membrane Arena: Lab instruments (SYNTHETIC classical simulation).
 *
 * Pure functions that turn contest records into the numbers behind each Lab
 * chart: rate series with Wilson bands, alignment traces, the probe run for
 * the energy-ratio histogram and the threshold sweep, shield counts, gain
 * trace, parameter-trial landscape, multi-seed ensembles, paired A/B runs,
 * missions, CSV and JSON export, and a plain-text equivalent of every chart.
 * Every number comes from the simulation in game.js or from the repository
 * CSV copies in baselines.js. No DOM, no network, no storage.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'), require('./stats.js'));
  else root.ArenaLab = factory(root.ArenaGame, root.ArenaStats);
})(typeof self !== 'undefined' ? self : this, function (G, ST) {
  'use strict';

  var B = G.baselines;
  var REPO_START = { th: G.DEFAULTS.th, c: G.DEFAULTS.c, g: G.DEFAULTS.g };
  var METRICS = ['T', 'F', 'precision', 'rateVar', 'score'];
  var FACTORS = {
    scheme: { levels: G.SCHEMES },
    shield: { levels: [true, false] },
    amp: { levels: [true, false] },
    stab: { levels: [true, false] },
    evolve: { levels: [true, false] },
    w: { levels: G.W_STEPS }
  };

  function nowMs() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
  function f(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function pct(x) { return Math.round(100 * x) + '%'; }

  /* ---------- 1. rates with Wilson bands (episode level, cumulative over generations) ---------- */

  // true-event rate: share of planted episodes with at least one true output
  // false-event rate: share of all episodes with at least one false output
  function rateSeries(hist) {
    var out = [], planted = 0, all = 0, tEp = 0, fEp = 0;
    hist.forEach(function (h, k) {
      h.episodes.forEach(function (ep) {
        all++; if (ep.planted) planted++;
        if (ep.evT > 0) tEp++;
        if (ep.evF > 0) fEp++;
      });
      var tr = ST.wilson(tEp, planted), fr = ST.wilson(fEp, all);
      out.push({ gen: k + 1, planted: planted, episodes: all, trueEp: tEp, falseEp: fEp, tr: tr, fr: fr });
    });
    return out;
  }

  /* ---------- 2. alignment of the weight vectors with the signal ---------- */

  // |<v|signal>| after each step, mean and sd over the planted episodes of generation `gen` (0-based)
  function alignment(hist, gen) {
    var rec = hist[gen];
    if (!rec) return null;
    var STEPS = G.STEPS, mean = [[], [], []], sd = [[], [], []], n = 0, i, t;
    var eps = rec.episodes.filter(function (e) { return e.planted; });
    n = eps.length;
    for (i = 0; i < 3; i++) {
      for (t = 0; t < STEPS; t++) {
        var vals = eps.map(function (e) { return e.fid[t * 3 + i]; });
        mean[i].push(ST.mean(vals)); sd[i].push(ST.sd(vals));
      }
    }
    return { gen: gen + 1, n: n, mean: mean, sd: sd, steps: STEPS };
  }

  /* ---------- 3. the probe: what each membrane would do at every threshold ---------- */

  function effThreshold(par, n, sigma) {
    return G.scaledThreshold(Math.min(1.5, par.th * (2 - par.sp)), n, sigma);
  }
  // K episodes (half planted) with the current parameters of the contest and nobody frozen by a declaration.
  // Each agent-episode keeps [gain x energy ratio, fidelity] at the six check steps.
  function probe(contest, settings, K, seedTag) {
    var s = G.sanitizeSettings(settings), n = contest.n, rng = G.makeRng('membrane-arena/v1/probe/' + contest.seed + '/' + (seedTag || contest.gen));
    var P = contest.par.map(function (p) { return { th: p.th, c: p.c, g: p.g, sp: p.sp, geff: p.g * (s.stab ? G.stabilizerFactor(contest.rateEma) : 1) }; });
    var samples = [], e, i, thr = P.map(function (p) { return effThreshold(p, n, contest.sigma); });
    for (e = 0; e < K; e++) {
      var planted = e % 2 === 0, pat = planted ? G.rvec(n, rng) : null, chk = [[], [], []];
      var trace = new Float32Array(G.STEPS * 3);
      G.episode(n, pat, contest.sigma, P, contest.warm, s.amp ? G.AMP_CAP : 0, rng, trace, { noDecl: true, chk: chk });
      for (i = 0; i < 3; i++) samples.push({ planted: planted, agent: i, chk: chk[i] });
    }
    return { samples: samples, K: K, thr: thr, geff: P.map(function (p) { return p.geff; }), gen: contest.gen };
  }
  // decision statistic: the largest gain x energy ratio over the check steps
  function decisionStat(sample) {
    var m = 0;
    sample.chk.forEach(function (c) { if (c[0] > m) m = c[0]; });
    return m;
  }
  function ratioHistogram(pr, bins) {
    bins = bins || 24;
    var pl = [], no = [], hi = 4;
    pr.samples.forEach(function (sm) { var v = decisionStat(sm); if (v > hi) hi = v; (sm.planted ? pl : no).push(v); });
    pr.thr.forEach(function (t) { if (t * 1.15 > hi) hi = t * 1.15; });
    hi = Math.ceil(hi);
    return { lo: 0, hi: hi, bins: bins, planted: ST.histogram(pl, 0, hi, bins), noise: ST.histogram(no, 0, hi, bins), nPlanted: pl.length, nNoise: no.length, thr: pr.thr.slice() };
  }
  // a declaration at threshold th: the first check step with score >= th; it is true when planted and fidelity >= 0.5 there
  function declareAt(sample, th) {
    for (var k = 0; k < sample.chk.length; k++) if (sample.chk[k][0] >= th) return { step: (k + 1) * G.CHECK, ok: sample.planted && sample.chk[k][1] >= G.TRUTH };
    return null;
  }
  // Precision / recall trade-off as the threshold moves, before the shield. recall = true declarations per planted
  // agent-episode; falseRate = false declarations per agent-episode (all); precision = true / (true + false).
  function sweep(pr, points) {
    points = points || 40;
    var hi = ratioHistogram(pr, 4).hi, out = [], nPl = 0, nAll = pr.samples.length, k;
    pr.samples.forEach(function (sm) { if (sm.planted) nPl++; });
    for (k = 0; k < points; k++) {
      var th = 1 + (hi - 1) * k / (points - 1), tp = 0, fp = 0;
      pr.samples.forEach(function (sm) { var d = declareAt(sm, th); if (d) { if (d.ok) tp++; else fp++; } });
      out.push({ th: th, tp: tp, fp: fp, recall: nPl ? tp / nPl : 0, falseRate: nAll ? fp / nAll : 0, precision: tp + fp ? tp / (tp + fp) : null, recallCI: ST.wilson(tp, nPl), falseCI: ST.wilson(fp, nAll) });
    }
    return { points: out, nPlanted: nPl, nAll: nAll, thr: pr.thr.slice(), hi: hi };
  }
  function atThreshold(pr, th) {
    var nPl = 0, tp = 0, fp = 0;
    pr.samples.forEach(function (sm) { if (sm.planted) nPl++; var d = declareAt(sm, th); if (d) { if (d.ok) tp++; else fp++; } });
    return { tp: tp, fp: fp, nPlanted: nPl, nAll: pr.samples.length, recall: nPl ? tp / nPl : 0, precision: tp + fp ? tp / (tp + fp) : null };
  }

  /* ---------- 4. shield counts ---------- */

  // A declaration either leaves (passed), is held because no 2-of-3 agreement released anything in that episode,
  // or is redundant because another confirmed declaration of the same episode already left.
  var SH_KEYS = ['declared', 'passed', 'held', 'redundant', 'trueDeclared', 'truePassed', 'trueHeld', 'trueRedundant', 'falseDeclared', 'falsePassed', 'falseHeld', 'falseRedundant'];
  function zeroShield() { var o = {}; SH_KEYS.forEach(function (k) { o[k] = 0; }); return o; }
  function shieldCounts(hist) {
    var gens = [], tot = zeroShield();
    hist.forEach(function (h, k) {
      var r = zeroShield(); r.gen = k + 1; r.shield = h.shield;
      h.episodes.forEach(function (ep) {
        for (var i = 0; i < 3; i++) {
          if (ep.declStep[i] === null) continue;
          var passed = ep.outs.indexOf(i) >= 0, truth = ep.truth[i] ? 'true' : 'false', kind = passed ? 'Passed' : (ep.passed === null && h.shield ? 'Held' : 'Redundant');
          r.declared++; r[kind.toLowerCase()]++;
          r[truth + 'Declared']++; r[truth + kind]++;
        }
      });
      SH_KEYS.forEach(function (key) { tot[key] += r[key]; });
      gens.push(r);
    });
    return { gens: gens, total: tot };
  }

  /* ---------- 5. stabilizer gain trace ---------- */

  function gainTrace(hist) {
    var geff = [[], [], []], rate = [], x = [], clampedGens = [], k = 0, gmax = 0;
    hist.forEach(function (h) {
      h.episodes.forEach(function (ep) {
        x.push(k++);
        for (var i = 0; i < 3; i++) { geff[i].push(ep.geff[i]); if (ep.geff[i] > gmax) gmax = ep.geff[i]; }
        rate.push(ep.rateEma);
      });
      h.clamped.forEach(function (c, i) { if (c) clampedGens.push({ gen: h.gen + 1, i: i }); });
    });
    return { x: x, geff: geff, rate: rate, min: G.GAIN_MIN, max: G.GAIN_MAX, target: G.TARGET, floor: G.FACTOR_MIN, clamped: clampedGens, gmax: gmax, stab: hist.length ? hist[hist.length - 1].settings.stab : false };
  }

  /* ---------- 6. (1+1)-ES parameter trials ---------- */

  function landscape(hist) {
    var pts = [];
    hist.forEach(function (h) {
      for (var i = 0; i < 3; i++) pts.push({ gen: h.gen + 1, i: i, th: h.params[i].th, c: h.params[i].c, g: h.params[i].g, score: h.scores[i], accepted: !!h.accepted[i], mutated: h.mutated });
    });
    var acc = pts.filter(function (p) { return p.accepted; }).length;
    return { points: pts, accepted: acc, trials: pts.length };
  }

  /* ---------- 7. amplifier: the repository's measurement ---------- */

  // S-- against SA- in the repository's width-32 table, per cooperation weight
  function ampBaseline() {
    var rows = [], file = B.SOURCE.contest;
    [0, 0.5, 1].forEach(function (w) {
      var a = null, b = null;
      B.CONTEST32.forEach(function (r) { if (r.w === w && r.cfg === 'S--') a = r; if (r.w === w && r.cfg === 'SA-') b = r; });
      if (a && b) rows.push({ w: w, off: a, on: b, dT: b.T - a.T, dF: b.F - a.F, dP: b.P - a.P });
    });
    return { rows: rows, file: file, maxDeltaP: B.LESSON.ampMaxDeltaP, seeds: rows.length ? rows[0].off.seeds : 0 };
  }

  /* ---------- 8. ensembles ---------- */

  function labSeed(base, k) { return base + k; }
  function startFor(seed, repoStart) { return repoStart ? { th: REPO_START.th, c: REPO_START.c, g: REPO_START.g } : G.startFor(seed); }
  function runOne(seed, settings, repoStart) {
    var init = Object.assign({}, settings, startFor(seed, repoStart)), c = G.createContest(seed, init), s = G.sanitizeSettings(Object.assign({}, settings, { th: init.th, c: init.c, g: init.g }));
    while (!G.done(c)) G.stepGeneration(c, s);
    return metricsOf(seed, c);
  }
  function metricsOf(seed, c) {
    var r = G.summarize(c.hist);
    return { seed: seed, T: r.T, F: r.F, precision: r.precision, rateVar: r.rateVar, score: r.score, maxG: r.maxG };
  }
  // a time-sliced ensemble: call step(budgetMs) repeatedly (for example once per timer tick) until it reports done
  function createEnsemble(o) {
    var settings = G.sanitizeSettings(o.settings), n = Math.max(1, Math.min(200, o.n | 0)), base = o.base || 'e', repo = !!o.repoStart;
    var st = { k: 0, c: null, s: null, results: [], settings: settings, n: n, base: base, repoStart: repo, cancelled: false, ms: 0, t0: null };
    function progress() { return Math.min(1, (st.k + (st.c ? st.c.gen / G.GENS : 0)) / n); }
    function step(budget, clock) {
      clock = clock || nowMs;
      if (st.t0 === null) st.t0 = clock();
      var start = clock();
      while (!st.cancelled && st.k < n) {
        if (!st.c) {
          var seed = labSeed(base, st.k + 1), init = Object.assign({}, settings, startFor(seed, repo));
          st.c = G.createContest(seed, init); st.s = G.sanitizeSettings(init); st.seed = seed;
        }
        G.stepGeneration(st.c, st.s);
        if (G.done(st.c)) { st.results.push(metricsOf(st.seed, st.c)); st.c = null; st.k++; }
        if (clock() - start >= budget) break;
      }
      st.ms += clock() - start;
      return { done: st.cancelled || st.k >= n, progress: progress(), completed: st.k };
    }
    return { step: step, state: function () { return st; }, cancel: function () { st.cancelled = true; }, results: function () { return st.results; } };
  }

  // like-for-like with the repository table only when the contest is set up the way the repository ran it
  function likeForLike(settings, repoStart) {
    var s = G.sanitizeSettings(settings);
    return !!(repoStart && s.scheme === 'random' && s.fcost === 0 && s.evolve);
  }
  function matchRepository(settings) { return Object.assign({}, G.sanitizeSettings(settings), { scheme: 'random', fcost: 0, evolve: true }); }

  function summarizeEnsemble(results, settings, repoStart) {
    var s = G.sanitizeSettings(settings), out = { n: results.length, metrics: {}, like: likeForLike(s, repoStart), baseline: null };
    var rng = G.makeRng('membrane-arena/v1/ens-boot/' + results.length + '/' + (results.length ? results[0].seed : ''));
    METRICS.forEach(function (m) {
      var vals = results.map(function (r) { return r[m]; });
      out.metrics[m] = { t: ST.tCI(vals), boot: ST.bootstrapCI(vals, rng, 1000), desc: ST.describe(vals), values: vals };
    });
    var b = G.baselineFor(s);
    if (b) {
      var r = b.row, k = r.seeds;
      var ci = function (mean, sdv) { var h = ST.tCrit95(k - 1) * sdv / Math.sqrt(k); return { mean: mean, sd: sdv, lo: mean - h, hi: mean + h }; };
      out.baseline = { tag: b.tag, w: b.w, exactW: b.exactW, file: b.file, seeds: k, T: ci(r.T, r.Tsd), F: ci(r.F, r.Fsd), precision: ci(r.P, r.Psd), rateVar: { mean: r.rv, sd: null, lo: null, hi: null }, score: { mean: G.baselineScore(b), sd: null, lo: null, hi: null, approx: true } };
    }
    return out;
  }
  function overlap(a, b) { return a.lo <= b.hi && b.lo <= a.hi; }
  // how many of the three repository metrics (T, F, precision) have a baseline interval that overlaps the ensemble interval
  function agreementWithBaseline(sum) {
    if (!sum.baseline) return null;
    var res = {}, count = 0;
    ['T', 'F', 'precision'].forEach(function (m) { res[m] = overlap(sum.metrics[m].t, sum.baseline[m]); if (res[m]) count++; });
    return { per: res, count: count, of: 3 };
  }

  /* ---------- 9. A/B paired runs ---------- */

  function applyFactor(settings, factor, level) {
    var o = Object.assign({}, G.sanitizeSettings(settings));
    if (!FACTORS[factor]) throw new Error('unknown factor');
    o[factor] = level;
    return G.sanitizeSettings(o);
  }
  function createPaired(o) {
    var a = createEnsemble({ settings: applyFactor(o.settings, o.factor, o.a), n: o.n, base: o.base || 'ab', repoStart: o.repoStart });
    var b = createEnsemble({ settings: applyFactor(o.settings, o.factor, o.b), n: o.n, base: o.base || 'ab', repoStart: o.repoStart });
    var meta = { factor: o.factor, a: o.a, b: o.b, n: a.state().n, repoStart: !!o.repoStart };
    function step(budget, clock) {
      clock = clock || nowMs;
      var start = clock(), ra, rb;
      do {
        ra = a.step(Math.max(1, budget / 2), clock); rb = b.step(Math.max(1, budget / 2), clock);
        if (ra.done && rb.done) break;
      } while (clock() - start < budget);
      return { done: ra.done && rb.done, progress: (ra.progress + rb.progress) / 2, completed: Math.min(ra.completed, rb.completed) };
    }
    return { step: step, meta: meta, a: a, b: b, cancel: function () { a.cancel(); b.cancel(); }, state: function () { return { a: a.state(), b: b.state(), n: meta.n }; } };
  }
  // paired by seed: the same seed gives both arms the same random streams until their settings make them differ
  function summarizePaired(resA, resB) {
    var n = Math.min(resA.length, resB.length), A = resA.slice(0, n), Bs = resB.slice(0, n), out = { n: n, metrics: {} };
    var rng = G.makeRng('membrane-arena/v1/ab-boot/' + n);
    METRICS.forEach(function (m) {
      var va = A.map(function (r) { return r[m]; }), vb = Bs.map(function (r) { return r[m]; });
      out.metrics[m] = { a: ST.tCI(va), b: ST.tCI(vb), diff: n >= 2 ? ST.paired(va, vb, rng, 1000) : null, va: va, vb: vb };
    });
    return out;
  }

  /* ---------- 10. missions ---------- */

  var MISSIONS = [
    { id: 'shield', kind: 'ab', factor: 'shield', a: true, b: false, minN: 20, metric: 'F' },
    { id: 'individual', kind: 'ab', factor: 'scheme', a: 'consensus', b: 'individual', minN: 20, metric: 'T' },
    { id: 'amp', kind: 'ab', factor: 'amp', a: true, b: false, minN: 20, metric: 'precision' },
    { id: 'repo', kind: 'ens', minN: 20 },
    { id: 'play', kind: 'play' }
  ];
  function missionById(id) { for (var k = 0; k < MISSIONS.length; k++) if (MISSIONS[k].id === id) return MISSIONS[k]; return null; }
  // returns { counts: bool (the required experiment was run), outcome: string id, detail: object }
  function evaluateMission(id, data) {
    var m = missionById(id);
    if (!m) return null;
    if (m.kind === 'ab') {
      var meta = data.meta, sum = data.summary;
      if (!meta || meta.factor !== m.factor || meta.a !== m.a || meta.b !== m.b || sum.n < m.minN) return { counts: false, outcome: 'wrong_setup', detail: {} };
      var d = sum.metrics[m.metric].diff;
      if (m.id === 'shield') return { counts: true, outcome: d.excludesZero && d.mean < 0 ? 'reproduced' : 'not_reproduced', detail: { metric: m.metric, mean: d.mean, lo: d.lo, hi: d.hi, n: sum.n } };
      if (m.id === 'individual') {
        var lag = ['T', 'F', 'precision', 'score'].filter(function (k) { var x = sum.metrics[k].diff; return x.excludesZero && (k === 'F' ? x.mean > 0 : x.mean > 0) ; });
        // A is consensus, B is individual: a positive difference in T, precision or score means individual lags; a negative one in F means the same
        var lags = [];
        ['T', 'precision', 'score'].forEach(function (k) { var x = sum.metrics[k].diff; if (x.excludesZero && x.mean > 0) lags.push(k); });
        var xf = sum.metrics.F.diff; if (xf.excludesZero && xf.mean < 0) lags.push('F');
        return { counts: true, outcome: lags.length ? 'found' : 'not_found', detail: { metrics: lags, n: sum.n, unused: lag.length } };
      }
      if (m.id === 'amp') return { counts: true, outcome: d.excludesZero ? 'detected' : 'no_effect', detail: { metric: m.metric, mean: d.mean, lo: d.lo, hi: d.hi, n: sum.n } };
    }
    if (m.kind === 'ens') {
      if (!data.summary || data.summary.n < m.minN || !data.summary.like || !data.summary.baseline) return { counts: false, outcome: 'wrong_setup', detail: {} };
      var ag = agreementWithBaseline(data.summary);
      return { counts: true, outcome: ag.count === 3 ? 'agrees' : (ag.count >= 1 ? 'partly' : 'differs'), detail: ag };
    }
    if (m.kind === 'play') {
      if (!data.result || data.ref === null || data.ref === undefined) return { counts: false, outcome: 'no_ref', detail: {} };
      return { counts: true, outcome: data.result.score >= data.ref ? 'beat' : 'below', detail: { score: data.result.score, ref: data.ref } };
    }
    return null;
  }

  /* ---------- 11. export ---------- */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
    var s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, rows) {
    return [header.map(csvCell).join(',')].concat(rows.map(function (r) { return r.map(csvCell).join(','); })).join('\n') + '\n';
  }
  function runCSV(hist) {
    var header = ['generation', 'shield', 'true_outputs', 'false_outputs', 'declared', 'passed', 'held', 'redundant', 'rate_ema', 'th_a', 'th_b', 'th_c', 'g_a', 'g_b', 'g_c', 'score_a', 'score_b', 'score_c', 'accepted_a', 'accepted_b', 'accepted_c'];
    var sc = shieldCounts(hist).gens;
    return toCSV(header, hist.map(function (h, k) {
      return [h.gen + 1, h.shield ? 1 : 0, h.outT, h.outF, sc[k].declared, sc[k].passed, sc[k].held, sc[k].redundant, h.rateEma, h.params[0].th, h.params[1].th, h.params[2].th, h.params[0].g, h.params[1].g, h.params[2].g,
        h.scores[0], h.scores[1], h.scores[2], h.accepted[0] ? 1 : 0, h.accepted[1] ? 1 : 0, h.accepted[2] ? 1 : 0];
    }));
  }
  function ensembleCSV(results) {
    return toCSV(['seed', 'true_outputs', 'false_outputs', 'precision', 'rate_variance', 'game_score', 'max_gain'], results.map(function (r) { return [r.seed, r.T, r.F, r.precision, r.rateVar, r.score, r.maxG]; }));
  }
  function pairedCSV(resA, resB) {
    var n = Math.min(resA.length, resB.length), rows = [], k;
    for (k = 0; k < n; k++) rows.push([resA[k].seed, resA[k].T, resB[k].T, resA[k].F, resB[k].F, resA[k].precision, resB[k].precision, resA[k].score, resB[k].score]);
    return toCSV(['seed', 'true_a', 'true_b', 'false_a', 'false_b', 'precision_a', 'precision_b', 'score_a', 'score_b'], rows);
  }
  function round6(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 1e6) / 1e6 : v; }
  function meta(kind, extra) {
    return Object.assign({
      app: 'membrane-arena', build: G.BUILD, engine: G.VERSION, kind: kind, label: 'SYNTHETIC classical simulation, not a physical experiment',
      baselines: { repo: B.SOURCE.repo, commit: B.SOURCE.commit, file: B.SOURCE.contest }
    }, extra || {});
  }
  function ciJSON(c) { return c ? { mean: round6(c.mean), lo: round6(c.lo), hi: round6(c.hi) } : null; }
  function ensembleJSON(results, summary, settings, repoStart) {
    var m = {};
    Object.keys(summary.metrics).forEach(function (k) { m[k] = { t95: ciJSON(summary.metrics[k].t), bootstrap95: ciJSON(summary.metrics[k].boot), sd: round6(summary.metrics[k].t.sd) }; });
    return JSON.stringify({ meta: meta('ensemble', { n: results.length, repositoryStart: !!repoStart, likeForLikeWithRepository: summary.like, settings: G.sanitizeSettings(settings) }), summary: m, baseline: summary.baseline, results: results.map(function (r) { return { seed: r.seed, T: r.T, F: r.F, precision: round6(r.precision), rateVar: round6(r.rateVar), score: round6(r.score), maxG: round6(r.maxG) }; }) }, null, 1);
  }
  function pairedJSON(pm, summary, settings) {
    var m = {};
    Object.keys(summary.metrics).forEach(function (k) {
      var x = summary.metrics[k];
      m[k] = { a: ciJSON(x.a), b: ciJSON(x.b), diff: x.diff ? { mean: round6(x.diff.mean), t95: [round6(x.diff.lo), round6(x.diff.hi)], bootstrap95: x.diff.boot ? [round6(x.diff.boot.lo), round6(x.diff.boot.hi)] : null, excludesZero: x.diff.excludesZero, effect: round6(x.diff.effect), aWins: x.diff.aWins } : null };
    });
    return JSON.stringify({ meta: meta('paired-ab', { n: summary.n, factor: pm.factor, a: pm.a, b: pm.b, repositoryStart: pm.repoStart, settings: G.sanitizeSettings(settings), note: 'exploratory, no correction for comparing several metrics' }), metrics: m }, null, 1);
  }
  function runJSON(contest, seedInfo) {
    var hist = contest.hist, sum = G.summarize(hist);
    return JSON.stringify({
      meta: meta('contest', { seed: contest.seed, mode: seedInfo ? seedInfo.mode : null }),
      summary: { T: sum.T, F: sum.F, precision: round6(sum.precision), rateVar: round6(sum.rateVar), score: round6(sum.score) },
      shield: shieldCounts(hist).total, generations: hist.map(function (h) { return { gen: h.gen + 1, settings: h.settings, outT: h.outT, outF: h.outF, params: h.params.map(function (p) { return { th: round6(p.th), c: round6(p.c), g: round6(p.g) }; }), scores: h.scores.map(round6), accepted: h.accepted }; })
    }, null, 1);
  }

  /* ---------- 12. text equivalents (t is the i18n function) ---------- */

  function describeRates(t, series) {
    if (!series.length) return t('alt.empty');
    var last = series[series.length - 1];
    return t('alt.rates', { g: last.gen, tr: pct(last.tr.p), tlo: pct(last.tr.lo), thi: pct(last.tr.hi), pl: last.planted, fr: pct(last.fr.p), flo: pct(last.fr.lo), fhi: pct(last.fr.hi), n: last.episodes });
  }
  function describeAlignment(t, al) {
    if (!al) return t('alt.empty');
    var a = [0, 1, 2].map(function (i) { return f(al.mean[i][al.steps - 1], 2); });
    var half = [0, 1, 2].map(function (i) { return f(al.mean[i][Math.floor(al.steps / 2) - 1], 2); });
    return t('alt.align', { g: al.gen, n: al.n, h1: half[0], h2: half[1], h3: half[2], a1: a[0], a2: a[1], a3: a[2] });
  }
  function describeHist(t, h) {
    if (!h) return t('alt.empty');
    var meanOf = function (counts) { var s = 0, n = 0, w = (h.hi - h.lo) / h.bins; counts.forEach(function (c, k) { s += c * (h.lo + (k + 0.5) * w); n += c; }); return n ? s / n : 0; };
    var above = function (counts, th) { var w = (h.hi - h.lo) / h.bins, a = 0, n = 0; counts.forEach(function (c, k) { n += c; if (h.lo + (k + 0.5) * w >= th) a += c; }); return n ? a / n : 0; };
    var th = h.thr.reduce(function (a, b) { return a + b; }, 0) / h.thr.length;
    return t('alt.hist', { mp: f(meanOf(h.planted), 1), mn: f(meanOf(h.noise), 1), th: f(th, 1), ap: pct(above(h.planted, th)), an: pct(above(h.noise, th)), np: h.nPlanted, nn: h.nNoise });
  }
  function describeSweep(t, sw, cur) {
    if (!sw || !sw.points.length) return t('alt.empty');
    var p = sw.points;
    var best = null;
    p.forEach(function (q) { if (q.precision !== null && q.recall >= 0.5 && (best === null || q.th < best.th)) best = q; });
    var lo = p[0], hi = p[p.length - 1];
    return t('alt.sweep', { lr: pct(lo.recall), lf: f(lo.falseRate, 2), hth: f(hi.th, 1), hr: pct(hi.recall), hf: f(hi.falseRate, 2), cur: cur ? pct(cur.recall) : '-', curp: cur && cur.precision !== null ? pct(cur.precision) : '-', n: sw.nAll });
  }
  function describeShield(t, sc) {
    var x = sc.total;
    if (!x.declared) return t('alt.shield_none');
    return t('alt.shield', { d: x.declared, p: x.passed, h: x.held, r: x.redundant, fd: x.falseDeclared, fp: x.falsePassed, fh: x.falseHeld, td: x.trueDeclared, th: x.trueHeld });
  }
  function describeGain(t, gt) {
    if (!gt.x.length) return t('alt.empty');
    var gmin = Infinity, rmax = 0;
    gt.geff.forEach(function (a) { a.forEach(function (v) { if (v < gmin) gmin = v; }); });
    gt.rate.forEach(function (v) { if (v > rmax) rmax = v; });
    return t(gt.stab ? 'alt.gain_on' : 'alt.gain_off', { n: gt.x.length, lo: f(gmin, 2), hi: f(gt.gmax, 2), cmin: gt.min, cmax: gt.max, rmax: f(rmax, 2), tgt: gt.target, cl: gt.clamped.length });
  }
  function describeLandscape(t, ls) {
    if (!ls.trials) return t('alt.empty');
    var best = ls.points.reduce(function (a, b) { return b.score > a.score ? b : a; });
    return t('alt.land', { n: ls.trials, a: ls.accepted, th: f(best.th, 2), g: f(best.g, 2), s: f(best.score, 2), gen: best.gen, m: 'ABC'.charAt(best.i) });
  }
  function describeAmp(t, ab) {
    var r0 = ab.rows[1] || ab.rows[0];
    if (!r0) return t('alt.empty');
    return t('alt.amp', { dp: f(ab.maxDeltaP, 3), dT: f(r0.dT, 2), dF: f(r0.dF, 2), seeds: ab.seeds, file: ab.file });
  }
  function describeEnsemble(t, sum) {
    if (!sum.n) return t('alt.empty');
    var m = sum.metrics, b = sum.baseline;
    var txt = t('alt.ens', { n: sum.n, T: f(m.T.t.mean, 1), Tlo: f(m.T.t.lo, 1), Thi: f(m.T.t.hi, 1), F: f(m.F.t.mean, 1), Flo: f(m.F.t.lo, 1), Fhi: f(m.F.t.hi, 1), P: f(m.precision.t.mean, 3), Plo: f(m.precision.t.lo, 3), Phi: f(m.precision.t.hi, 3) });
    if (b) txt += ' ' + t('alt.ens_base', { T: f(b.T.mean, 1), F: f(b.F.mean, 1), P: f(b.precision.mean, 3), seeds: b.seeds, file: b.file, like: t(sum.like ? 'ens.like_yes' : 'ens.like_no') });
    else txt += ' ' + t('alt.ens_nobase');
    return txt;
  }
  function describePaired(t, sum, pm, label) {
    if (!sum.n || sum.n < 2) return t('alt.empty');
    var m = sum.metrics;
    var one = function (k, d) { var x = m[k].diff; return f(x.mean, d) + ' (' + f(x.lo, d) + ' to ' + f(x.hi, d) + ')' + (x.excludesZero ? '' : ' ' + t('ab.ci_zero')); };
    return t('alt.ab', { n: sum.n, a: label.a, b: label.b, T: one('T', 1), F: one('F', 1), P: one('precision', 3), S: one('score', 1), wins: m.score.diff.aWins });
  }

  return {
    METRICS: METRICS, FACTORS: FACTORS, MISSIONS: MISSIONS, REPO_START: REPO_START,
    rateSeries: rateSeries, alignment: alignment, probe: probe, decisionStat: decisionStat, ratioHistogram: ratioHistogram, declareAt: declareAt,
    sweep: sweep, atThreshold: atThreshold, effThreshold: effThreshold, shieldCounts: shieldCounts, gainTrace: gainTrace, landscape: landscape, ampBaseline: ampBaseline,
    runOne: runOne, createEnsemble: createEnsemble, likeForLike: likeForLike, matchRepository: matchRepository, summarizeEnsemble: summarizeEnsemble,
    agreementWithBaseline: agreementWithBaseline, applyFactor: applyFactor, createPaired: createPaired, summarizePaired: summarizePaired,
    missionById: missionById, evaluateMission: evaluateMission,
    toCSV: toCSV, runCSV: runCSV, ensembleCSV: ensembleCSV, pairedCSV: pairedCSV, ensembleJSON: ensembleJSON, pairedJSON: pairedJSON, runJSON: runJSON,
    describeRates: describeRates, describeAlignment: describeAlignment, describeHist: describeHist, describeSweep: describeSweep, describeShield: describeShield,
    describeGain: describeGain, describeLandscape: describeLandscape, describeAmp: describeAmp, describeEnsemble: describeEnsemble, describePaired: describePaired
  };
});
