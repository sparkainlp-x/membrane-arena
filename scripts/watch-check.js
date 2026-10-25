#!/usr/bin/env node
/*
 * Membrane Arena: the Pair Watch evaluation (SYNTHETIC game on a classical simulation), as frozen in
 * docs/WATCH-PROTOCOL.md.
 *
 *   node scripts/watch-check.js            print the report
 *   node scripts/watch-check.js --write    also write docs/watch-check.txt, docs/watch-results.json,
 *                                          docs/watch-results.csv, watch-coach.js and docs/watch-manifest.json
 *   node scripts/watch-check.js --verify   recompute and compare with the written files (exit 1 on any difference)
 *
 * The coach is fitted on the calibration seeds only, rounded and frozen, and only then are the held-out
 * seeds scored. Every held-out number is a mean over 200 runs with a 95% percentile bootstrap interval
 * over seeds; every comparison is a paired difference with Cohen's d_z and the win/tie/loss count.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const W = require('../watch.js');
const G = require('../game.js');
// WATCH_SMOKE=1 runs a few smoke seeds (neither calibration nor held-out) to check the script; it cannot write.
const SMOKE = !!process.env.WATCH_SMOKE;
const pad = (k) => String(k).padStart(3, '0');
const CAL = SMOKE ? ['wsmoke-c0', 'wsmoke-c1', 'wsmoke-c2', 'wsmoke-c3'] : Array.from({ length: 200 }, (_, k) => 'wcal-' + pad(k));
const TEST = SMOKE ? ['wsmoke-t0', 'wsmoke-t1', 'wsmoke-t2', 'wsmoke-t3', 'wsmoke-t4'] : Array.from({ length: 200 }, (_, k) => 'wtest-' + pad(k));
const SHARES = [1, 2, 3, 4];
const PROFILES = [];
for (const eq of [true, false]) for (const share of SHARES) PROFILES.push({ key: share + '/' + (eq ? 'on' : 'off'), share, eq });
const MAIN = '2/on';
const POLICY_KEYS = ['coach', 'shield', 'acceptAll', 'vetoAll', 'random', 'perfect'];
const LABEL = { coach: 'coach', shield: 'shield', acceptAll: 'accept-all', vetoAll: 'veto-all', random: 'random', perfect: 'perfect' };
const LAMBDA = 1, MAX_IT = 100, TOL = 1e-10;
const BOOT = 2000, BOOT_SEED = 'watch-bootstrap';
const ECE_BINS = 10;

/* ---------------- the settings sweep for one run (runs in a worker) ---------------- */
// every wave under every setting the game allows: one row per (wave, share, equalizer)
function sweep(seed) {
  const run = W.createRun(seed), rows = [];
  for (let i = 0; i < W.TOTAL; i++) {
    const st = W.STAGES[run.waves[i].stage];
    for (const share of SHARES) for (const eq of (st.eq ? [false, true] : [false])) {
      const e = W.evaluate(run, i, { share, eq });
      rows.push([i, e.stage, share, eq ? 1 : 0, e.declTick || 0, e.planted ? 1 : 0, e.truth ? 1 : 0,
        e.calVote ? 1 : 0, e.declTick ? e.fadedShare : -1, e.onFade ? 1 : 0]);
    }
  }
  return { seed, rows };
}
if (!isMainThread) {
  for (const seed of workerData.seeds) parentPort.postMessage(sweep(seed));
  process.exit(0);
}
function asWave(r) {
  return { index: r[0], stage: r[1], settings: { share: r[2], eq: !!r[3] }, declTick: r[4] || null, planted: !!r[5],
    truth: !!r[6], calVote: r[4] ? !!r[7] : null, fadedShare: r[4] ? r[8] : null, onFade: !!r[9] };
}
function runAll(seeds) {
  const n = Math.max(1, Math.min(os.cpus().length, 8, seeds.length)), parts = Array.from({ length: n }, () => []);
  seeds.forEach((s, k) => parts[k % n].push(s));
  const out = {};
  return Promise.all(parts.map((part) => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { seeds: part } });
    w.on('message', (m) => { out[m.seed] = m.rows.map(asWave); });
    w.on('error', reject);
    w.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('worker exit ' + c))));
  }))).then(() => out);
}

/* ---------------- linear algebra and the logistic fit ---------------- */
function cholesky(A) {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (!(s > 0)) throw new Error('matrix not positive definite'); L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
  }
  return L;
}
function cholSolve(L, b) {
  const n = L.length, y = new Array(n), x = new Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}
function inverse(A) {
  const L = cholesky(A), n = A.length, inv = A.map(() => new Array(n).fill(0));
  for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const c = cholSolve(L, e); for (let i = 0; i < n; i++) inv[i][j] = c[i]; }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const m = (inv[i][j] + inv[j][i]) / 2; inv[i][j] = inv[j][i] = m; }
  return inv;
}
function hessian(X, beta) {
  const k = beta.length, H = Array.from({ length: k }, () => new Array(k).fill(0)), p = new Array(X.length);
  for (let r = 0; r < X.length; r++) {
    let z = 0; for (let i = 0; i < k; i++) z += X[r][i] * beta[i];
    p[r] = W.sigmoid(z); const w = p[r] * (1 - p[r]);
    for (let i = 0; i < k; i++) { const xi = X[r][i] * w; if (xi) for (let j = 0; j <= i; j++) H[i][j] += xi * X[r][j]; }
  }
  for (let i = 0; i < k; i++) { for (let j = 0; j < i; j++) H[j][i] = H[i][j]; if (i > 0) H[i][i] += LAMBDA; }
  return { H, p };
}
// ridge-penalized logistic regression by iteratively reweighted least squares (docs/WATCH-PROTOCOL.md 2)
function fitLogistic(X, y) {
  const k = X[0].length; let beta = new Array(k).fill(0), it = 0, delta = Infinity;
  while (it < MAX_IT && delta >= TOL) {
    const { H, p } = hessian(X, beta), g = new Array(k).fill(0);
    for (let r = 0; r < X.length; r++) { const d = y[r] - p[r]; for (let i = 0; i < k; i++) g[i] += X[r][i] * d; }
    for (let i = 1; i < k; i++) g[i] -= LAMBDA * beta[i];
    const step = cholSolve(cholesky(H), g);
    beta = beta.map((b, i) => b + step[i]);
    delta = Math.max.apply(null, step.map(Math.abs)); it++;
  }
  return { beta, cov: inverse(hessian(X, beta).H), iterations: it, converged: delta < TOL };
}
const r9 = (x) => Math.round(x * 1e9) / 1e9 + 0;   // + 0 turns -0 into 0

/* ---------------- statistics ---------------- */
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, a.length - 1)); };
function quantile(sorted, q) { const h = (sorted.length - 1) * q, lo = Math.floor(h); return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)]) - sorted[lo]); }
// one shared set of resampled seed indices, so every interval resamples the same runs
function bootIndex(n) { const rng = G.makeRng(BOOT_SEED); return Array.from({ length: BOOT }, () => Array.from({ length: n }, () => Math.floor(rng() * n))); }
function ci(stat, idx) { const v = idx.map(stat).sort((a, b) => a - b); return [quantile(v, 0.025), quantile(v, 0.975)]; }
function meanCI(vals, idx) { return { mean: mean(vals), ci: ci((ix) => ix.reduce((s, i) => s + vals[i], 0) / ix.length, idx) }; }
function paired(a, b, idx) {
  const d = a.map((x, i) => x - b[i]), m = meanCI(d, idx), s = sd(d);
  return { mean: m.mean, ci: m.ci, dz: s > 0 ? m.mean / s : 0, wins: d.filter((x) => x > 0).length, ties: d.filter((x) => x === 0).length, losses: d.filter((x) => x < 0).length };
}
function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
function verdict(c) { return c.ci[0] > 0 ? 'higher' : c.ci[1] < 0 ? 'lower' : 'not detectable'; }

/* ---------------- main ---------------- */
async function main() {
  const write = process.argv.includes('--write'), verify = process.argv.includes('--verify');
  if (SMOKE && (write || verify)) { console.error('WATCH_SMOKE runs cannot write or verify'); process.exit(2); }
  const t0 = Date.now();
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const protocolSha = sha(fs.readFileSync(path.join(ROOT, 'docs/WATCH-PROTOCOL.md')));
  const all = await runAll(CAL.concat(TEST));

  /* 1. fit the coach on calibration declarations only */
  const calDecl = [];
  for (const s of CAL) for (const e of all[s]) if (e.declTick) calDecl.push(e);
  const X = calDecl.map(W.features), y = calDecl.map((e) => (e.truth ? 1 : 0));
  const fit = fitLogistic(X, y), baseRate = mean(y);
  const model = {
    version: W.VERSION, generator: W.GEN, features: W.FEATURES, lambda: LAMBDA, breakEven: W.BREAK_EVEN,
    fittedOn: { seeds: CAL[0] + ' to ' + CAL[CAL.length - 1], runs: CAL.length, declarations: calDecl.length, baseRate: r9(baseRate) },
    iterations: fit.iterations, converged: fit.converged,
    beta: fit.beta.map(r9), cov: fit.cov.map((row) => row.map(r9))
  };

  /* 2. held-out: policies per run and profile */
  const idx = bootIndex(TEST.length);
  const pts = {}, cnt = {};
  for (const pr of PROFILES) { pts[pr.key] = {}; cnt[pr.key] = {}; for (const k of POLICY_KEYS) { pts[pr.key][k] = []; cnt[pr.key][k] = []; } }
  const csv = ['seed,profile,policy,points,declared,false_accepted,real_vetoed'];
  for (const s of TEST) {
    const rows = all[s];
    for (const pr of PROFILES) {
      const waves = [];
      for (let i = 0; i < W.TOTAL; i++) {
        const eq = pr.eq && W.STAGES[rows.find((r) => r.index === i).stage].eq;
        waves.push(rows.find((r) => r.index === i && r.settings.share === pr.share && r.settings.eq === eq));
      }
      const ctx = { model, seed: s, profile: pr.key };
      for (const k of POLICY_KEYS) {
        let p = 0, decl = 0, fa = 0, rv = 0;
        for (const e of waves) {
          const call = e.declTick ? (W.POLICIES[k](e, ctx) ? 'accept' : 'veto') : null, o = W.outcome(e, call);
          p += o.points;
          if (e.declTick) decl++;
          if (o.kind === 'acceptFalse') fa++;
          if (o.kind === 'vetoTrue') rv++;
        }
        pts[pr.key][k].push(p); cnt[pr.key][k].push({ decl, fa, rv });
        csv.push([s, pr.key, k, p, decl, fa, rv].join(','));
      }
    }
  }
  const summary = {}, comparisons = {};
  for (const pr of PROFILES) {
    summary[pr.key] = {};
    for (const k of POLICY_KEYS) {
      const c = cnt[pr.key][k];
      summary[pr.key][k] = { points: meanCI(pts[pr.key][k], idx), falseAccepted: meanCI(c.map((x) => x.fa), idx), realVetoed: meanCI(c.map((x) => x.rv), idx), declared: mean(c.map((x) => x.decl)) };
    }
    comparisons[pr.key] = {
      'coach-shield': paired(pts[pr.key].coach, pts[pr.key].shield, idx),
      'coach-acceptAll': paired(pts[pr.key].coach, pts[pr.key].acceptAll, idx),
      'shield-acceptAll': paired(pts[pr.key].shield, pts[pr.key].acceptAll, idx),
      'coach-perfect': paired(pts[pr.key].coach, pts[pr.key].perfect, idx)
    };
  }

  /* 3. calibration on every held-out declaration of the sweep (each wave and setting once) */
  const per = TEST.map((s) => all[s].filter((e) => e.declTick).map((e) => ({ e, p: W.predict(model, e).p, y: e.truth ? 1 : 0 })));
  const nBin = (p) => Math.min(ECE_BINS - 1, Math.floor(p * ECE_BINS));
  // per-seed sums so that the bootstrap can resample seeds as clusters
  const agg = per.map((list) => {
    const b = Array.from({ length: ECE_BINS }, () => ({ n: 0, p: 0, y: 0 }));
    let br = 0, bb = 0;
    for (const d of list) { const x = b[nBin(d.p)]; x.n++; x.p += d.p; x.y += d.y; br += (d.p - d.y) ** 2; bb += (baseRate - d.y) ** 2; }
    return { n: list.length, bins: b, brier: br, brierBase: bb };
  });
  const calibStats = (ix) => {
    const b = Array.from({ length: ECE_BINS }, () => ({ n: 0, p: 0, y: 0 })); let n = 0, br = 0, bb = 0;
    for (const i of ix) { const a = agg[i]; n += a.n; br += a.brier; bb += a.brierBase; a.bins.forEach((x, j) => { b[j].n += x.n; b[j].p += x.p; b[j].y += x.y; }); }
    const ece = b.reduce((s, x) => s + (x.n ? Math.abs(x.p - x.y) : 0), 0) / n;
    return { n, ece, brier: br / n, brierBase: bb / n, bins: b };
  };
  const allIx = TEST.map((_, i) => i), cal0 = calibStats(allIx);
  const calibration = {
    declarations: cal0.n, ece: { value: cal0.ece, ci: ci((ix) => calibStats(ix).ece, idx) },
    brier: { value: cal0.brier, ci: ci((ix) => calibStats(ix).brier, idx) },
    brierBase: { value: cal0.brierBase, ci: ci((ix) => calibStats(ix).brierBase, idx) },
    brierDiff: { value: cal0.brier - cal0.brierBase, ci: ci((ix) => { const c = calibStats(ix); return c.brier - c.brierBase; }, idx) },
    bins: cal0.bins.map((x, j) => ({ lo: j / ECE_BINS, hi: (j + 1) / ECE_BINS, n: x.n, predicted: x.n ? x.p / x.n : null, observed: x.n ? x.y / x.n : null, wilson: wilson(x.y, x.n) })),
    groups: {}
  };
  for (const off of [false, true]) for (const eq of [false, true]) {
    const list = [].concat.apply([], per).filter((d) => W.STAGES[d.e.stage].off === off && d.e.settings.eq === eq);
    if (!list.length) continue;
    const k = list.filter((d) => d.y).length;
    calibration.groups[(off ? 'off' : 'grid') + '|' + (eq ? 'eq' : 'raw')] = { n: list.length, predicted: mean(list.map((d) => d.p)), observed: k / list.length, wilson: wilson(k, list.length) };
  }
  // how often the coach and the shield disagree, and who is right then (main profile, held-out)
  const dis = { n: 0, coachRight: 0, shieldRight: 0, coachAcceptsShieldVetoes: 0, coachVetoesShieldAccepts: 0 };
  for (const s of TEST) for (const e of all[s]) {
    if (!e.declTick || e.settings.share !== 2 || e.settings.eq !== !!W.STAGES[e.stage].eq) continue;
    const c = W.coachAccepts(model, e), sh = !!e.calVote;
    if (c === sh) continue;
    dis.n++; if (c === e.truth) dis.coachRight++; else dis.shieldRight++;
    if (c) dis.coachAcceptsShieldVetoes++; else dis.coachVetoesShieldAccepts++;
  }

  /* ---------------- the report ---------------- */
  const L = [], o = (s) => L.push(s);
  const f0 = (x) => (Math.round(x) + 0).toFixed(0), f1 = (x) => (Math.round(x * 10) / 10 + 0).toFixed(1), f2 = (x) => x.toFixed(2), f3 = (x) => x.toFixed(3), f4 = (x) => x.toFixed(4);
  const sgn = (x, f) => (x > 0 ? '+' : '') + f(x);
  const mci = (m, f) => f(m.mean) + ' [' + f(m.ci[0]) + ', ' + f(m.ci[1]) + ']';
  const dci = (c) => sgn(c.mean, f1) + ' [' + sgn(c.ci[0], f1) + ', ' + sgn(c.ci[1], f1) + '], d_z ' + f2(c.dz) + ', W/T/L ' + c.wins + '/' + c.ties + '/' + c.losses;
  o('Pair Watch evaluation report, v' + W.VERSION + '. SYNTHETIC game on a classical simulation; no physical claims.');
  o('Protocol: docs/WATCH-PROTOCOL.md, SHA-256 ' + protocolSha);
  o('Regenerate: node scripts/watch-check.js --write   Check: node scripts/watch-check.js --verify');
  o('Coach fitted on ' + CAL.length + ' calibration runs (' + CAL[0] + ' to ' + CAL[CAL.length - 1] + '); every number below is from ' + TEST.length + ' held-out runs');
  o('(' + TEST[0] + ' to ' + TEST[TEST.length - 1] + '). Intervals: 95% percentile bootstrap over held-out seeds, ' + BOOT + ' resamples, seed ' + BOOT_SEED + '.');
  o('Points are per 24-wave run, without the streak bonus. A difference is claimed only when its interval excludes zero.');
  o('');
  o('1. Decision rule');
  o('   Accepting beats vetoing exactly when P(real) > ' + f2(W.BREAK_EVEN) + ' (from the points table: +' + W.POINTS.acceptTrue + ' / ' + W.POINTS.acceptFalse + ' for accepting, ' + W.POINTS.vetoTrue + ' / +' + W.POINTS.vetoFalse + ' for vetoing).');
  o('   The coach accepts when its estimate is above ' + f2(W.BREAK_EVEN) + '.');
  o('');
  o('2. The coach (penalized logistic regression, lambda ' + LAMBDA + ')');
  o('   ' + calDecl.length + ' calibration declarations, ' + f1(100 * baseRate) + '% real; ' + fit.iterations + ' iterations, ' + (fit.converged ? 'converged' : 'NOT converged') + '.');
  o('   feature        coefficient    s.e.');
  W.FEATURES.forEach((name, i) => o('   ' + name.padEnd(13) + (model.beta[i] >= 0 ? ' ' : '') + f3(model.beta[i]).padStart(11) + '   ' + f3(Math.sqrt(model.cov[i][i]))));
  o('');
  o('3. Calibration on held-out declarations (H1)');
  o('   ' + calibration.declarations + ' declarations (every held-out wave under every setting, each once).');
  o('   ECE ' + f4(calibration.ece.value) + ' [' + f4(calibration.ece.ci[0]) + ', ' + f4(calibration.ece.ci[1]) + ']: ' + (calibration.ece.value <= 0.05 ? 'at most 0.05, as H1 requires.' : 'above 0.05, so H1 fails.'));
  o('   Brier ' + f4(calibration.brier.value) + ' [' + f4(calibration.brier.ci[0]) + ', ' + f4(calibration.brier.ci[1]) + '] against ' + f4(calibration.brierBase.value) + ' for the constant base rate;');
  o('   difference ' + f4(calibration.brierDiff.value) + ' [' + f4(calibration.brierDiff.ci[0]) + ', ' + f4(calibration.brierDiff.ci[1]) + ']: ' + (calibration.brierDiff.ci[1] < 0 ? 'lower, as H1 requires.' : 'not detectably lower, so H1 fails.'));
  o('   bin          n   predicted   observed   95% Wilson');
  for (const b of calibration.bins) o('   ' + (f1(b.lo) + '-' + f1(b.hi)).padEnd(9) + String(b.n).padStart(6) + '   ' + (b.n ? f3(b.predicted) : '  -  ').padStart(9) + '   ' + (b.n ? f3(b.observed) : '  -  ').padStart(8) + '   [' + f3(b.wilson[0]) + ', ' + f3(b.wilson[1]) + ']');
  o('   by fade kind and equalizer (exploratory)');
  for (const [k, g] of Object.entries(calibration.groups)) o('   ' + k.padEnd(9) + String(g.n).padStart(6) + '   predicted ' + f3(g.predicted) + '   observed ' + f3(g.observed) + ' [' + f3(g.wilson[0]) + ', ' + f3(g.wilson[1]) + ']');
  o('');
  const S = summary[MAIN], C = comparisons[MAIN];
  o('4. Main profile (tick share 2, equalizer on when unlocked): points per run');
  o('   policy        points                    false finds kept      real finds vetoed');
  for (const k of POLICY_KEYS) o('   ' + LABEL[k].padEnd(12) + mci(S[k].points, f1).padEnd(26) + mci(S[k].falseAccepted, f2).padEnd(22) + mci(S[k].realVetoed, f2));
  o('   ' + f1(S.coach.declared) + ' declarations per run on average.');
  o('');
  o('5. Paired comparisons, main profile');
  o('   H2 coach - shield       ' + dci(C['coach-shield']) + ': ' + verdict(C['coach-shield']));
  o('   H3 coach - accept-all   ' + dci(C['coach-acceptAll']) + ': ' + verdict(C['coach-acceptAll']));
  o('   H4 shield - accept-all  ' + dci(C['shield-acceptAll']) + ': ' + verdict(C['shield-acceptAll']));
  o('   coach - perfect         ' + dci(C['coach-perfect']) + ' (exploratory)');
  o('   Coach and shield disagree on ' + dis.n + ' held-out declarations: the coach is right on ' + dis.coachRight + ', the shield on ' + dis.shieldRight + '.');
  o('   (coach accepts, shield vetoes: ' + dis.coachAcceptsShieldVetoes + '; coach vetoes, shield accepts: ' + dis.coachVetoesShieldAccepts + ')');
  o('');
  o('6. Every profile (exploratory; no correction for multiple comparisons)');
  o('   profile  coach          shield         accept-all     coach - shield            coach - accept-all        shield - accept-all');
  for (const pr of PROFILES) {
    const s = summary[pr.key], c = comparisons[pr.key];
    const short = (x) => sgn(x.mean, f1) + ' [' + sgn(x.ci[0], f1) + ', ' + sgn(x.ci[1], f1) + ']';
    o('   ' + pr.key.padEnd(8) + ' ' + f1(s.coach.points.mean).padEnd(14) + ' ' + f1(s.shield.points.mean).padEnd(14) + ' ' + f1(s.acceptAll.points.mean).padEnd(14) + ' ' + short(c['coach-shield']).padEnd(25) + ' ' + short(c['coach-acceptAll']).padEnd(25) + ' ' + short(c['shield-acceptAll']));
  }
  o('   (profile = tick share / equalizer when unlocked)');
  o('');
  o('7. Notes');
  o('   The coach sees only what the player sees at a declaration. It is fitted to this game\'s waves, and its');
  o('   intervals cover the uncertainty of its coefficients, not of single waves. Results apply to this simulation only.');
  const report = L.join('\n') + '\n';

  /* ---------------- files ---------------- */
  const round = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 + 0 : x);
  const tidy = (v) => JSON.parse(JSON.stringify(v, (k, x) => round(x)));
  const results = tidy({ version: W.VERSION, generator: W.GEN, protocolSha256: protocolSha, breakEven: W.BREAK_EVEN, mainProfile: MAIN,
    bootstrap: { resamples: BOOT, seed: BOOT_SEED, interval: '95% percentile' }, coach: { iterations: fit.iterations, converged: fit.converged, declarations: calDecl.length, baseRate },
    calibration, summary, comparisons, disagreement: dis });
  const coachJs = '/* Membrane Arena: the Pair Watch coach, fitted by scripts/watch-check.js on calibration seeds only.\n' +
    ' * Generated file: do not edit by hand (node scripts/watch-check.js --write). SYNTHETIC game data;\n' +
    ' * see docs/WATCH-PROTOCOL.md. Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only. */\n' +
    '(function (root, factory) {\n  if (typeof module === \'object\' && module.exports) module.exports = factory();\n  else root.ArenaWatchCoach = factory();\n' +
    '})(typeof self !== \'undefined\' ? self : this, function () {\n  \'use strict\';\n  return ' + JSON.stringify(model) + ';\n});\n';
  const files = { 'docs/watch-check.txt': report, 'docs/watch-results.json': JSON.stringify(results, null, 1) + '\n', 'docs/watch-results.csv': csv.join('\n') + '\n', 'watch-coach.js': coachJs };
  const inputs = ['game.js', 'reverse.js', 'pair.js', 'watch.js', 'scripts/watch-check.js', 'docs/WATCH-PROTOCOL.md'];
  const manifest = { version: W.VERSION, generator: W.GEN, command: 'node scripts/watch-check.js --write',
    seeds: { calibration: CAL, heldOut: TEST }, profiles: PROFILES.map((p) => p.key), mainProfile: MAIN, policies: POLICY_KEYS,
    bootstrap: { resamples: BOOT, seed: BOOT_SEED }, protocolSha256: protocolSha,
    inputs: Object.fromEntries(inputs.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f)))])),
    outputs: Object.fromEntries(Object.entries(files).map(([f, s]) => [f, sha(s)])),
    // where the written files were made; --verify ignores this entry, so any Node version can check them
    generatedWith: { node: process.version, platform: process.platform + '-' + process.arch } };
  files['docs/watch-manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  const comparable = (f, s) => {
    if (f !== 'docs/watch-manifest.json' || !s) return s;
    try { const m = JSON.parse(s); delete m.generatedWith; return JSON.stringify(m); } catch (e) { return s; }
  };
  process.stdout.write(report);
  process.stderr.write('done in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s (node ' + process.version + ')\n');
  if (write) for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, f), s);
  if (verify) {
    let bad = 0;
    for (const [f, s] of Object.entries(files)) {
      const cur = fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : '';
      if (comparable(f, cur) !== comparable(f, s)) { bad++; process.stderr.write('differs: ' + f + '\n'); }
    }
    if (bad) process.exit(1);
    process.stderr.write('verify: all outputs match\n');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
