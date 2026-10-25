/*
 * Membrane Arena: small statistics toolkit (SYNTHETIC classical simulation).
 *
 * Wilson score interval for a proportion, Student-t interval for a mean,
 * percentile bootstrap for a mean, paired difference with both intervals,
 * histograms and quantiles. Pure functions, no DOM, no storage. Every
 * interval is 95 percent two-sided. Bootstrap resampling takes a seeded
 * generator, so a result is reproducible.
 *
 * Wilson, E. B. (1927), J. Am. Stat. Assoc. 22, 209-212.
 * Efron, B. (1979), Ann. Stat. 7, 1-26.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArenaStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var Z95 = 1.959964;
  // two-sided 95 percent critical values of Student's t, df = 1..30, then 40, 60, 120, infinity
  var T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101,
    2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  var T95_TAIL = [[40, 2.021], [60, 2.000], [120, 1.980]];

  function tCrit95(df) {
    df = Math.floor(df);
    if (!(df >= 1)) return NaN;
    if (df <= 30) return T95[df - 1];
    for (var k = 0; k < T95_TAIL.length; k++) if (df <= T95_TAIL[k][0]) return T95_TAIL[k][1];
    return df <= 120 ? 1.980 : Z95;
  }

  function sum(a) { var s = 0; for (var k = 0; k < a.length; k++) s += a[k]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }
  function sd(a) {                                   // sample standard deviation (n - 1)
    if (a.length < 2) return 0;
    var m = mean(a), s = 0;
    for (var k = 0; k < a.length; k++) s += (a[k] - m) * (a[k] - m);
    return Math.sqrt(s / (a.length - 1));
  }
  function sem(a) { return a.length ? sd(a) / Math.sqrt(a.length) : NaN; }

  // Wilson score interval for k successes in n trials
  function wilson(k, n, z) {
    z = z || Z95;
    if (!(n > 0)) return { p: 0, lo: 0, hi: 1, n: 0 };
    k = Math.min(n, Math.max(0, k));
    var p = k / n, z2 = z * z, den = 1 + z2 / n, c = p + z2 / (2 * n);
    var h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
    return { p: p, lo: Math.max(0, (c - h) / den), hi: Math.min(1, (c + h) / den), n: n };
  }

  // Student-t interval for the mean of a
  function tCI(a) {
    var n = a.length, m = mean(a);
    if (n < 2) return { mean: m, lo: m, hi: m, half: 0, n: n, sd: 0 };
    var half = tCrit95(n - 1) * sd(a) / Math.sqrt(n);
    return { mean: m, lo: m - half, hi: m + half, half: half, n: n, sd: sd(a) };
  }

  function quantile(sorted, q) {                     // linear interpolation between order statistics, sorted ascending
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * Math.min(1, Math.max(0, q)), lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // percentile bootstrap of the mean; rng() must return uniform [0,1)
  function bootstrapCI(a, rng, B) {
    var n = a.length, m = mean(a);
    if (n < 2) return { mean: m, lo: m, hi: m, B: 0 };
    B = B || 1000;
    var means = new Array(B), b, k, s;
    for (b = 0; b < B; b++) {
      s = 0;
      for (k = 0; k < n; k++) s += a[Math.floor(rng() * n)];
      means[b] = s / n;
    }
    means.sort(function (x, y) { return x - y; });
    return { mean: m, lo: quantile(means, 0.025), hi: quantile(means, 0.975), B: B };
  }

  // paired difference a[k] - b[k] with the t interval, the bootstrap interval and a standardised effect (mean / sd of the differences)
  function paired(a, b, rng, B) {
    if (a.length !== b.length) throw new Error('paired samples need equal length');
    var d = [], k;
    for (k = 0; k < a.length; k++) d.push(a[k] - b[k]);
    var t = tCI(d), bs = rng ? bootstrapCI(d, rng, B) : null, wins = 0, ties = 0;
    for (k = 0; k < d.length; k++) { if (d[k] > 0) wins++; else if (d[k] === 0) ties++; }
    return {
      n: d.length, diffs: d, mean: t.mean, sd: t.sd, lo: t.lo, hi: t.hi, half: t.half,
      excludesZero: t.n >= 2 && (t.lo > 0 || t.hi < 0), boot: bs,
      effect: t.sd > 0 ? t.mean / t.sd : 0, aWins: wins, ties: ties
    };
  }

  // counts of values in `bins` equal-width bins over [lo, hi]; values outside are clipped into the end bins
  function histogram(values, lo, hi, bins) {
    var out = new Array(bins), k;
    for (k = 0; k < bins; k++) out[k] = 0;
    var w = (hi - lo) / bins;
    for (k = 0; k < values.length; k++) {
      var v = values[k];
      if (!isFinite(v)) continue;
      var i = Math.floor((v - lo) / w);
      out[Math.min(bins - 1, Math.max(0, i))]++;
    }
    return out;
  }

  // five-number style description used by the text equivalents
  function describe(a) {
    if (!a.length) return { n: 0, mean: NaN, sd: 0, min: NaN, max: NaN, median: NaN };
    var s = a.slice().sort(function (x, y) { return x - y; });
    return { n: a.length, mean: mean(a), sd: sd(a), min: s[0], max: s[s.length - 1], median: quantile(s, 0.5) };
  }

  return {
    Z95: Z95, tCrit95: tCrit95, mean: mean, sd: sd, sem: sem, wilson: wilson, tCI: tCI, quantile: quantile,
    bootstrapCI: bootstrapCI, paired: paired, histogram: histogram, describe: describe
  };
});
