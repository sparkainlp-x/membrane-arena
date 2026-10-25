#!/usr/bin/env node
/*
 * Membrane Arena: the Reverse Pair evaluation (SYNTHETIC classical simulation), as frozen in
 * docs/PAIR-PROTOCOL.md.
 *
 *   node scripts/pair-check.js            print the report
 *   node scripts/pair-check.js --write    also write docs/pair-check.txt, docs/pair-results.json,
 *                                         docs/pair-results.csv and docs/pair-manifest.json
 *   node scripts/pair-check.js --verify   recompute and compare with the written files (exit 1 on any difference)
 *
 * Thresholds are chosen on the calibration seeds only and frozen before the held-out seeds are
 * scored. Every held-out number is a mean over 120 contests with a 95% percentile bootstrap interval;
 * every comparison is a paired difference across seeds, with Cohen's d_z and the win/tie/loss count.
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
const P = require('../pair.js');
const G = require('../game.js');

// PAIR_SMOKE=1 runs a few smoke-* seeds (neither calibration nor held-out) to check the script; it cannot write.
const SMOKE = !!process.env.PAIR_SMOKE;
const CAL = SMOKE ? ['smoke-c0', 'smoke-c1', 'smoke-c2', 'smoke-c3'] : Array.from({ length: 40 }, (_, k) => 'cal-' + String(k).padStart(3, '0'));
const TEST = SMOKE ? ['smoke-t0', 'smoke-t1', 'smoke-t2', 'smoke-t3', 'smoke-t4', 'smoke-t5'] : Array.from({ length: 120 }, (_, k) => 'test-' + String(k).padStart(3, '0'));
const KINDS = ['grid', 'off'];
const SHARES = [1, 2, 3, 4];
const PRIMARY = 2;
const THS = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85];
const BOOT = 10000, BOOT_SEED = 'pair-bootstrap';
const SHARED = { ticks: 1, eq: 1, shield: 1, full: 1 };          // methods that depend on the tick share
const LABEL = { random: 'random', alone: 'alone', ticks: 'ticks only', eq: 'eq', shield: 'shield', full: 'full pair', oracle: 'oracle' };
const CLEAN_W = 1e-6;                     // a tone counts as clean when the fade does not touch it

/* ---------------- one contest, every method (runs in a worker) ---------------- */
function contestAll(seed, kind) {
  const depths = P.depthsFor(seed), worlds = [];
  for (let gen = 0; gen < P.ROUNDS; gen++) worlds.push(P.roundWorlds(seed, gen, depths[gen], kind));
  const traj = (mode, share) => worlds.map((ws) => ws.map((w) => P.trajectory(w, mode, share)));
  const score = (decide, shielded) => {
    const hist = worlds.map((ws, g) => P.roundRecord(ws, ws.map((w, e) => decide(w, g, e)), shielded));
    const s = P.summarize(hist), sum = (k) => hist.reduce((a, h) => a + h[k], 0);
    return { score: s.score, T: s.T, F: s.F, missed: s.missed, decl: sum('decl'), onFade: sum('onFade'), held: sum('held') };
  };
  const res = {}, unsh = {};
  const byTh = (trs, vote, shielded) => THS.map((th) => score((w, g, e) => P.decide(w, trs[g][e], th, vote), shielded));
  res['random|0'] = [score((w) => P.randomDecide(w), false)];
  res['alone|0'] = byTh(traj('solo', 1), 'none', false);
  res['oracle|0'] = byTh(traj('oracle', 1), 'oracle', true);
  for (const s of SHARES) {
    const raw = traj('raw', s), eq = traj('eq', s);
    res['ticks|' + s] = byTh(raw, 'none', false);
    res['shield|' + s] = byTh(raw, 'cal', true);
    res['eq|' + s] = byTh(eq, 'none', false);
    res['full|' + s] = byTh(eq, 'cal', true);
    unsh[s] = byTh(eq, 'cal', false).map((r) => r.score);     // the full pair's outputs, scored as if unshielded
  }
  // the calibration check: per share and frequency, clean and faded reading errors
  const cal = {};
  let rankSum = 0, fades = 0;
  worlds.forEach((ws) => ws.forEach((w) => { if (w.fade) { rankSum += w.fade.rank; fades++; } }));
  for (const s of SHARES) {
    const clean = P.FREQS.map(() => [0, 0]), faded = P.FREQS.map(() => [0, 0]), all = [0, 0];
    worlds.forEach((ws) => ws.forEach((w) => {
      const top = w.fade ? P.fadedTone(w.fade) : -1;
      P.calibratorErrors(w, s, (f, err, wt) => {
        if (wt < CLEAN_W) { clean[f][0] += err; clean[f][1]++; }
        if (f === top) { faded[f][0] += err; faded[f][1]++; all[0] += err; all[1]++; }
      });
    }));
    cal[s] = { clean: clean, faded: faded, fadedAll: all };
  }
  return { seed, kind, res, unsh, cal, rank: fades ? rankSum / fades : 0, fades };
}

if (!isMainThread) {
  for (const job of workerData.jobs) parentPort.postMessage(contestAll(job.seed, job.kind));
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}

/* ---------------- statistics ---------------- */
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); }
function boot(values, name) {
  const rng = G.makeRng(BOOT_SEED + '/' + name), n = values.length, ms = new Float64Array(BOOT);
  for (let b = 0; b < BOOT; b++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)]; ms[b] = s / n; }
  ms.sort();
  return { mean: mean(values), lo: ms[Math.floor(0.025 * BOOT)], hi: ms[Math.ceil(0.975 * BOOT) - 1], n };
}
function paired(a, b, name) {
  const d = a.map((x, i) => x - b[i]), ci = boot(d, name), s = sd(d);
  return Object.assign(ci, { dz: s > 0 ? ci.mean / s : 0, above: d.filter((x) => x > 1e-12).length,
    equal: d.filter((x) => Math.abs(x) <= 1e-12).length, below: d.filter((x) => x < -1e-12).length });
}
function verdict(c, want) {   // want: -1 expects A < B, +1 expects A > B
  if (c.lo > 0) return want > 0 ? 'supported' : 'opposite direction';
  if (c.hi < 0) return want < 0 ? 'supported' : 'opposite direction';
  return 'no detectable difference';
}

/* ---------------- main ---------------- */
async function runAll(seeds) {
  const jobs = [];
  for (const seed of seeds) for (const kind of KINDS) jobs.push({ seed, kind });
  const nw = Math.max(1, Math.min(os.cpus().length, 8)), parts = Array.from({ length: nw }, () => []);
  jobs.forEach((j, k) => parts[k % nw].push(j));
  const out = {};
  await Promise.all(parts.map((part) => new Promise((resolve, reject) => {
    if (!part.length) return resolve();
    const w = new Worker(__filename, { workerData: { jobs: part } });
    w.on('message', (m) => { out[m.seed + '|' + m.kind] = m; });
    w.on('error', reject);
    w.on('exit', (code) => (code ? reject(new Error('worker exit ' + code)) : resolve()));
  })));
  return out;
}
function keyList() {
  const keys = ['random|0', 'alone|0'];
  for (const s of SHARES) for (const m of ['ticks', 'eq', 'shield', 'full']) keys.push(m + '|' + s);
  keys.push('oracle|0');
  return keys;
}

async function main() {
  const args = process.argv.slice(2), write = args.includes('--write'), verify = args.includes('--verify');
  if (CAL.some((s) => TEST.includes(s))) throw new Error('calibration and held-out seeds overlap');
  if (SMOKE && (write || verify)) throw new Error('smoke runs cannot write or verify');
  const protocolSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'docs/PAIR-PROTOCOL.md'))).digest('hex');
  const t0 = Date.now();
  process.stderr.write('calibration seeds...\n');
  const calRuns = await runAll(CAL);
  // 1. thresholds from the calibration seeds only
  const chosen = {};
  for (const kind of KINDS) {
    chosen[kind] = {};
    for (const key of keyList()) {
      if (key === 'random|0') { chosen[kind][key] = null; continue; }
      let best = -1, bi = 0;
      THS.forEach((th, i) => { const m = mean(CAL.map((s) => calRuns[s + '|' + kind].res[key][i].score)); if (m > best + 1e-9) { best = m; bi = i; } });
      chosen[kind][key] = THS[bi];
    }
  }
  process.stderr.write('held-out seeds...\n');
  const runs = await runAll(TEST);
  const thIdx = (kind, key) => (key === 'random|0' ? 0 : THS.indexOf(chosen[kind][key]));
  const col = (kind, key, field, thi) => TEST.map((s) => {
    const r = runs[s + '|' + kind].res[key][thi === undefined ? thIdx(kind, key) : thi];
    return field === 'onFadePct' ? (r.decl ? 100 * r.onFade / r.decl : NaN) : r[field];
  });
  // 2. summaries
  const FIELDS = ['score', 'F', 'T', 'missed', 'decl', 'held', 'onFadePct'];
  const summary = {};
  for (const kind of KINDS) {
    summary[kind] = {};
    for (const key of keyList()) {
      const o = { threshold: chosen[kind][key] };
      for (const f of FIELDS) { const v = col(kind, key, f).filter((x) => !isNaN(x)); o[f] = boot(v, kind + '/' + key + '/' + f); }
      summary[kind][key] = o;
    }
  }
  // 3. hypotheses and comparisons (s = 2)
  const S = '|' + PRIMARY, comps = {};
  const both = (fn) => { const o = {}; for (const kind of KINDS) o[kind] = fn(kind); return o; };
  const pairNaN = (a, b, name) => {
    const idx = a.map((x, i) => (!isNaN(x) && !isNaN(b[i]) ? i : -1)).filter((i) => i >= 0);
    return Object.assign(paired(idx.map((i) => a[i]), idx.map((i) => b[i]), name), { seeds: idx.length });
  };
  comps.H1 = both((k) => paired(col(k, 'full' + S, 'F'), col(k, 'alone|0', 'F'), 'H1/' + k));
  comps.H2 = both((k) => paired(col(k, 'full' + S, 'score'), col(k, 'alone|0', 'score'), 'H2/' + k));
  comps.H3 = both((k) => pairNaN(col(k, 'eq' + S, 'onFadePct'), col(k, 'ticks' + S, 'onFadePct'), 'H3/' + k));
  const fullTh = (k) => THS.indexOf(chosen[k]['full' + S]);
  comps.H4 = both((k) => paired(col(k, 'eq' + S, 'F', fullTh(k)), col(k, 'full' + S, 'F', fullTh(k)), 'H4/' + k));
  const decomp = both((k) => {
    const full = col(k, 'full' + S, 'score', fullTh(k)), eqAt = col(k, 'eq' + S, 'score', fullTh(k));
    const un = TEST.map((s) => runs[s + '|' + k].unsh[PRIMARY][fullTh(k)]);
    const eqT = col(k, 'eq' + S, 'T', fullTh(k)), fT = col(k, 'full' + S, 'T', fullTh(k));
    return { total: paired(full, eqAt, 'D/total/' + k), filtering: paired(un, eqAt, 'D/filter/' + k), weighting: paired(full, un, 'D/weight/' + k),
      heldTrue: paired(eqT, fT, 'D/heldTrue/' + k) };
  });
  const benefit = (k, f) => { const a = col(k, 'full' + S, f), b = col(k, 'alone|0', f); return a.map((x, i) => x - b[i]); };
  comps.H5 = { score: paired(benefit('grid', 'score'), benefit('off', 'score'), 'H5/score'), F: paired(benefit('grid', 'F'), benefit('off', 'F'), 'H5/F') };
  comps.extra = both((k) => ({
    fullVsOracle: paired(col(k, 'full' + S, 'score'), col(k, 'oracle|0', 'score'), 'X/oracle/' + k),
    fullVsRandom: paired(col(k, 'full' + S, 'score'), col(k, 'random|0', 'score'), 'X/random/' + k),
    eqVsTicks: paired(col(k, 'eq' + S, 'score'), col(k, 'ticks' + S, 'score'), 'X/eqticks/' + k),
    shieldVsTicks: paired(col(k, 'shield' + S, 'F'), col(k, 'ticks' + S, 'F'), 'X/shieldticks/' + k),
    ticksVsAlone: paired(col(k, 'ticks' + S, 'score'), col(k, 'alone|0', 'score'), 'X/ticksalone/' + k)
  }));
  // 4. the calibration check (H6)
  const calib = {};
  for (const kind of KINDS) {
    calib[kind] = {};
    const per = (s, part, f) => TEST.map((sd_) => (f === undefined ? runs[sd_ + '|' + kind].cal[s][part] : runs[sd_ + '|' + kind].cal[s][part][f])).filter((q) => q[1] > 0).map((q) => q[0] / q[1]);
    for (const s of SHARES) {
      const clean = P.FREQS.map((f) => { const v = per(s, 'clean', f); return v.length ? boot(v, 'C/' + kind + '/' + s + '/' + f) : null; });
      const faded = P.FREQS.map((f) => { const v = per(s, 'faded', f); return v.length >= 10 ? boot(v, 'F/' + kind + '/' + s + '/' + f) : null; });
      calib[kind][s] = { clean, faded, fadedAll: boot(per(s, 'fadedAll'), 'FA/' + kind + '/' + s) };
    }
    calib[kind].growth = paired(per(4, 'fadedAll'), per(1, 'fadedAll'), 'G/' + kind);
  }
  const rank = both((k) => boot(TEST.map((s) => runs[s + '|' + k].rank), 'rank/' + k));

  /* ---------------- the report ---------------- */
  const L = [], o = (s) => L.push(s);
  const z = (x, d) => (Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x).toFixed(d);
  const f1 = (x) => z(x, 1), f2 = (x) => z(x, 2), f3 = (x) => z(x, 3), f4 = (x) => z(x, 4);
  const ci1 = (c) => f1(c.mean) + ' [' + f1(c.lo) + ', ' + f1(c.hi) + ']';
  const ci2 = (c) => f2(c.mean) + ' [' + f2(c.lo) + ', ' + f2(c.hi) + ']';
  const ci4 = (c) => f4(c.mean) + ' [' + f4(c.lo) + ', ' + f4(c.hi) + ']';
  const cmp = (c, fmt) => (fmt || ci2)(c) + ', d_z ' + f2(c.dz) + ', seeds A>B/=/< ' + c.above + '/' + c.equal + '/' + c.below;
  const name = (key) => { const [m, s] = key.split('|'); return LABEL[m] + (SHARED[m] ? ' s' + s : ''); };
  const KN = (k) => (k === 'grid' ? 'on-grid' : 'off-grid');
  o('Reverse Pair evaluation report, v' + P.VERSION + '. SYNTHETIC classical simulation; no physical claims.');
  o('Protocol: docs/PAIR-PROTOCOL.md, SHA-256 ' + protocolSha + '.');
  o('Generator ' + P.GEN + '. Calibration seeds cal-000 to cal-039 (40 contests), used only to choose thresholds.');
  o('Held-out seeds test-000 to test-119 (120 contests), never used for tuning; the two sets are disjoint.');
  o('One contest: 12 rounds of 8 episodes (48 planted dark patterns, 48 noise-only). Every method meets the same worlds and noise per seed.');
  o('Intervals: 95% percentile bootstrap over seeds, ' + BOOT + ' resamples, bootstrap seed "' + BOOT_SEED + '". Paired differences are A minus B.');
  o('');
  o('1. Thresholds chosen on the calibration seeds (max mean score, ties to the lower threshold)');
  o('   method          on-grid  off-grid');
  for (const key of keyList()) o('   ' + name(key).padEnd(16) + (chosen.grid[key] === null ? '     -' : f2(chosen.grid[key]).padStart(6)) + '   ' + (chosen.off[key] === null ? '     -' : f2(chosen.off[key]).padStart(6)));
  o('');
  o('2. Held-out results at the primary share s = 2 (mean per contest [95% CI])');
  for (const kind of KINDS) {
    o('   ' + (kind === 'grid' ? 'On-grid fades' : 'Off-grid fades') + ' (mean fade rank ' + f2(rank[kind].mean) + ' of 16)');
    o('   method        score                false outputs     true outputs        on-fade % of declarations');
    for (const key of ['random|0', 'alone|0', 'ticks' + S, 'eq' + S, 'shield' + S, 'full' + S, 'oracle|0']) {
      const r = summary[kind][key];
      o('   ' + name(key).padEnd(13) + ' ' + ci1(r.score).padEnd(20) + ' ' + ci1(r.F).padEnd(17) + ' ' + ci1(r.T).padEnd(19) + ' ' + ci1(r.onFadePct));
    }
    o('');
  }
  o('3. Hypotheses (s = 2; a difference counts only if its 95% interval excludes zero)');
  for (const kind of KINDS) {
    const K = KN(kind);
    o('   H1 ' + K + ': false outputs, full pair - alone = ' + cmp(comps.H1[kind]) + ': ' + verdict(comps.H1[kind], -1));
    o('   H2 ' + K + ': score, full pair - alone = ' + cmp(comps.H2[kind]) + ': ' + verdict(comps.H2[kind], +1));
    o('   H3 ' + K + ': on-fade %, eq - ticks only = ' + cmp(comps.H3[kind]) + ' (' + comps.H3[kind].seeds + ' seeds with declarations in both): ' + verdict(comps.H3[kind], -1));
    o('   H4 ' + K + ': false declarations the shield stopped (eq - full pair at ' + f2(chosen[kind]['full' + S]) + ') = ' + cmp(comps.H4[kind]) + ': ' + verdict(comps.H4[kind], +1));
  }
  o('   H5: pair benefit in score, on-grid - off-grid = ' + cmp(comps.H5.score) + ': ' + verdict(comps.H5.score, +1));
  o('   H5: pair change in false outputs, on-grid - off-grid = ' + cmp(comps.H5.F) + ': ' + verdict(comps.H5.F, -1));
  o('');
  o('4. The shield: filtering against the scoring rule (s = 2, at the full pair\'s threshold)');
  for (const kind of KINDS) {
    const d = decomp[kind], K = KN(kind);
    o('   ' + K + ': score, full pair - eq = ' + ci2(d.total) + ' = filtering ' + ci2(d.filtering) + ' + weighting ' + ci2(d.weighting) + '.');
    o('   ' + K + ': false outputs stopped ' + ci2(comps.H4[kind]) + ' per contest; true outputs stopped ' + ci2(d.heldTrue) + ' per contest.');
  }
  o('   The weighting part comes only from the arena rule that unshielded outputs count a third.');
  o('');
  o('5. Other paired comparisons (s = 2, descriptive)');
  for (const kind of KINDS) {
    const x = comps.extra[kind], K = KN(kind);
    o('   ' + K + ': score, full pair - oracle = ' + cmp(x.fullVsOracle));
    o('   ' + K + ': score, full pair - random = ' + cmp(x.fullVsRandom));
    o('   ' + K + ': score, eq - ticks only = ' + cmp(x.eqVsTicks));
    o('   ' + K + ': false outputs, shield - ticks only = ' + cmp(x.shieldVsTicks));
    o('   ' + K + ': score, ticks only - alone (the cost of giving ticks away) = ' + cmp(x.ticksVsAlone));
  }
  o('');
  o('6. All tick shares, held-out, at each method\'s chosen threshold (mean score [95% CI] / mean false outputs)');
  for (const kind of KINDS) {
    o('   ' + (kind === 'grid' ? 'On-grid' : 'Off-grid'));
    for (const m of ['ticks', 'eq', 'shield', 'full']) o('   ' + LABEL[m].padEnd(11) + SHARES.map((s) => 's' + s + ' ' + ci1(summary[kind][m + '|' + s].score) + ' / ' + f1(summary[kind][m + '|' + s].F.mean)).join('   '));
  }
  o('');
  o('7. Calibration check (H6): mean absolute reading error, measured [95% CI] against predicted');
  o('   Clean tones (untouched by the fade, or no fade). Predicted: ' + f4(P.PRED_ERR) + ' (0.05 x sqrt(2/pi)).');
  const cleanMet = {};
  for (const kind of KINDS) {
    let met = 0, total = 0;
    for (const s of SHARES) calib[kind][s].clean.forEach((c) => { if (c) { total++; if (c.lo <= P.PRED_ERR && P.PRED_ERR <= c.hi) met++; } });
    cleanMet[kind] = { met, total };
    o('   ' + (kind === 'grid' ? 'On-grid' : 'Off-grid') + ': prediction inside the interval for ' + met + ' of ' + total + ' frequency-share cells.');
    for (const s of SHARES) o('   s' + s + '  ' + calib[kind][s].clean.map((c, f) => 'f' + f + ' ' + (c ? ci4(c) : '-')).join('  '));
    o('   Faded tone (the tone most inside the fade): error including stale readings, by share');
    for (const s of SHARES) o('   s' + s + '  all ' + ci4(calib[kind][s].fadedAll) + '   ' + calib[kind][s].faded.map((c, f) => (c ? 'f' + f + ' ' + f3(c.mean) : '')).filter(Boolean).join('  '));
    o('   Growth, s4 - s1 = ' + cmp(calib[kind].growth, ci4) + ': ' + verdict(calib[kind].growth, +1));
  }
  o('');
  o('8. Notes');
  o('   The on-fade rule (at least 0.5 of a vector\'s energy in the fade subspace) is not adjusted for the fade\'s rank. Off-grid fades');
  o('   span ' + f2(rank.off.mean) + ' of 16 dimensions on average, so a vector can be "on the fade" by chance. The random');
  o('   baseline\'s on-fade % is that chance level: on-grid ' + f1(summary.grid['random|0'].onFadePct.mean) + '%, off-grid ' + f1(summary.off['random|0'].onFadePct.mean) + '%. The oracle\'s veto uses the same rule.');
  o('   Results apply to this simulation only.');
  const report = L.join('\n') + '\n';

  /* ---------------- results files ---------------- */
  const round = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x);
  const tidy = (v) => JSON.parse(JSON.stringify(v, (k, x) => round(x)));
  const results = tidy({ version: P.VERSION, generator: P.GEN, protocolSha256: protocolSha, primaryShare: PRIMARY, thresholds: THS,
    bootstrap: { resamples: BOOT, seed: BOOT_SEED, interval: '95% percentile' }, chosen, summary, comparisons: comps, decomposition: decomp,
    calibration: calib, cleanPredictionMet: cleanMet, predictedCleanError: P.PRED_ERR, fadeRank: rank });
  const csv = ['seed,fade,method,share,threshold,score,true,false,missed,declared,on_fade,held'];
  for (const kind of KINDS) for (const key of keyList()) for (const s of TEST) {
    const r = runs[s + '|' + kind].res[key][thIdx(kind, key)], [m, sh] = key.split('|');
    csv.push([s, kind, m, sh, chosen[kind][key] === null ? '' : chosen[kind][key], round(r.score), r.T, r.F, r.missed, r.decl, r.onFade, r.held].join(','));
  }
  const files = { 'docs/pair-check.txt': report, 'docs/pair-results.json': JSON.stringify(results, null, 1) + '\n', 'docs/pair-results.csv': csv.join('\n') + '\n' };
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const inputs = ['game.js', 'reverse.js', 'pair.js', 'scripts/pair-check.js', 'docs/PAIR-PROTOCOL.md'];
  const manifest = { version: P.VERSION, generator: P.GEN, command: 'node scripts/pair-check.js --write',
    seeds: { calibration: CAL, heldOut: TEST }, kinds: KINDS, shares: SHARES, primaryShare: PRIMARY, thresholds: THS,
    bootstrap: { resamples: BOOT, seed: BOOT_SEED },
    inputs: Object.fromEntries(inputs.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f)))])),
    outputs: Object.fromEntries(Object.entries(files).map(([f, s]) => [f, sha(s)])),
    // where the written files were made; --verify ignores this entry, so any Node version can check them
    generatedWith: { node: process.version, platform: process.platform + '-' + process.arch } };
  files['docs/pair-manifest.json'] = JSON.stringify(manifest, null, 1) + '\n';
  const comparable = (f, s) => {
    if (f !== 'docs/pair-manifest.json' || !s) return s;
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
