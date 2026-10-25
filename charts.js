/*
 * Membrane Arena: Lab charts (SYNTHETIC classical simulation).
 *
 * Canvas drawing for the Lab instruments. Every chart takes the data object
 * produced by lab.js and draws nothing that is not in it. `opts.hc` switches
 * to the high-contrast palette (white on black, heavier lines, dashes as well
 * as colour). `opts.labels` supplies the translated legend and axis words.
 * Pure helpers (scales, ticks, jitter) are exported for the tests.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stats.js'));
  else root.ArenaCharts = factory(root.ArenaStats);
})(typeof self !== 'undefined' ? self : this, function (ST) {
  'use strict';

  var TAU = Math.PI * 2;
  var PAL = {
    bg: '#070e26', grid: 'rgba(122,168,255,0.22)', axis: 'rgba(122,168,255,0.5)', text: 'rgba(179,190,219,0.95)', lw: 1.8,
    cyan: [64, 208, 224], blue: [122, 168, 255], aqua: [94, 230, 184], gold: [201, 168, 76], warn: [255, 154, 154], grey: [138, 147, 168], white: [238, 242, 255]
  };
  var HC = {
    bg: '#000000', grid: 'rgba(255,255,255,0.35)', axis: '#ffffff', text: '#ffffff', lw: 2.8,
    cyan: [0, 255, 255], blue: [120, 170, 255], aqua: [0, 255, 150], gold: [255, 220, 0], warn: [255, 110, 110], grey: [220, 220, 220], white: [255, 255, 255]
  };
  var AGENTS = ['cyan', 'blue', 'aqua'];

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : clamp(a, 0, 1)) + ')'; }
  function pal(o) { return o && o.hc ? HC : PAL; }

  // a linear scale from the data range to the pixel range
  function scale(d0, d1, p0, p1) {
    var span = d1 - d0 || 1;
    var fn = function (v) { return p0 + (v - d0) / span * (p1 - p0); };
    fn.d0 = d0; fn.d1 = d1; fn.p0 = p0; fn.p1 = p1;
    return fn;
  }
  // "nice" tick values between lo and hi, about n of them
  function ticks(lo, hi, n) {
    n = n || 4;
    var span = hi - lo;
    if (!(span > 0)) return [lo];
    var raw = span / n, pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), m = raw / pow;
    var step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * pow, out = [], v = Math.ceil(lo / step - 1e-9) * step;
    for (; v <= hi + step * 1e-9; v += step) out.push(parseFloat((Math.round(v / step) * step).toFixed(10)) + 0);
    return out;
  }
  function fmtTick(v) {
    if (Math.abs(v) >= 100) return String(Math.round(v));
    var s = (Math.round(v * 1000) / 1000).toString();
    return s;
  }
  // deterministic jitter in [-1, 1] for the k-th dot of a strip
  function jitter(k) { var x = Math.sin((k + 1) * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
  // colour of a score between lo and hi: navy blue -> cyan -> gold
  function scoreColor(v, lo, hi) {
    var t = hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5, a = [60, 90, 190], b = PAL.cyan, c = PAL.gold;
    var m = function (p, q, u) { return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u].map(Math.round); };
    return t < 0.5 ? m(a, b, t * 2) : m(b, c, (t - 0.5) * 2);
  }

  function prep(canvas, minH) {
    var r = canvas.getBoundingClientRect(), w = Math.max(160, Math.round(r.width)), h = Math.max(minH || 100, Math.round(r.height));
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1), ctx = canvas.getContext('2d');
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function clear(p, o) { p.ctx.fillStyle = pal(o).bg; p.ctx.fillRect(0, 0, p.w, p.h); }

  // grid, ticks and axis labels; returns the x and y scales
  function frame(ctx, box, xr, yr, o, xl, yl) {
    var P = pal(o), sx = scale(xr[0], xr[1], box.x0, box.x1), sy = scale(yr[0], yr[1], box.y1, box.y0);
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = P.text; ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ticks(yr[0], yr[1], 4).forEach(function (v) {
      var y = sy(v); ctx.beginPath(); ctx.moveTo(box.x0, y); ctx.lineTo(box.x1, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(fmtTick(v), box.x0 - 4, y);
    });
    ticks(xr[0], xr[1], 6).forEach(function (v) {
      var x = sx(v); ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fmtTick(v), x, box.y1 + 3);
      ctx.beginPath(); ctx.moveTo(x, box.y1); ctx.lineTo(x, box.y1 + 3); ctx.strokeStyle = P.axis; ctx.stroke(); ctx.strokeStyle = P.grid;
    });
    ctx.strokeStyle = P.axis; ctx.beginPath(); ctx.moveTo(box.x0, box.y0); ctx.lineTo(box.x0, box.y1); ctx.lineTo(box.x1, box.y1); ctx.stroke();
    if (xl) { ctx.fillStyle = P.text; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(xl, box.x1, box.y1 + 30); }
    if (yl) { ctx.fillStyle = P.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(yl, box.x0 + 4, box.y0 - 1); }
    return { sx: sx, sy: sy };
  }
  function boxFor(p, bottom) { return { x0: 38, x1: p.w - 10, y0: 16, y1: p.h - (bottom || 36) }; }
  function legend(ctx, items, x, y, o) {
    var P = pal(o);
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    items.forEach(function (it) {
      ctx.strokeStyle = rgba(P[it.c] || it.c, 1); ctx.fillStyle = rgba(P[it.c] || it.c, 1); ctx.lineWidth = P.lw;
      if (it.dash) ctx.setLineDash(it.dash); else ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 16, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = P.text; ctx.fillText(it.label, x + 20, y);
      x += 26 + ctx.measureText(it.label).width + 8;
    });
  }
  function polyline(ctx, pts, color, width, dash) {
    if (!pts.length) return;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    pts.forEach(function (q, k) { if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  function band(ctx, up, down, color) {
    if (!up.length) return;
    ctx.fillStyle = color; ctx.beginPath();
    up.forEach(function (q, k) { if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); });
    for (var k = down.length - 1; k >= 0; k--) ctx.lineTo(down[k][0], down[k][1]);
    ctx.closePath(); ctx.fill();
  }
  function empty(p, o, text) {
    clear(p, o);
    p.ctx.fillStyle = pal(o).text; p.ctx.font = '13px system-ui, sans-serif'; p.ctx.textAlign = 'center'; p.ctx.textBaseline = 'middle';
    p.ctx.fillText(text || '', p.w / 2, p.h / 2);
  }
  var L = function (o, k, d) { return o && o.labels && o.labels[k] !== undefined ? o.labels[k] : d; };

  /* ---------- 1. rates with Wilson bands ---------- */

  function drawRates(canvas, series, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!series.length) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var box = boxFor(p), fr = frame(ctx, box, [1, 12], [0, 1], o, L(o, 'gen', 'generation'), null);
    var mk = function (key, field) { return series.map(function (r) { return [fr.sx(r.gen), fr.sy(r[key][field])]; }); };
    band(ctx, mk('tr', 'hi'), mk('tr', 'lo'), rgba(P.cyan, 0.22));
    band(ctx, mk('fr', 'hi'), mk('fr', 'lo'), rgba(P.warn, 0.22));
    polyline(ctx, mk('tr', 'p'), rgba(P.cyan, 1), P.lw);
    polyline(ctx, mk('fr', 'p'), rgba(P.warn, 1), P.lw, [6, 4]);
    mk('tr', 'p').forEach(function (q) { ctx.fillStyle = rgba(P.cyan, 1); ctx.beginPath(); ctx.arc(q[0], q[1], 2.6, 0, TAU); ctx.fill(); });
    legend(ctx, [{ c: 'cyan', label: L(o, 'trueRate', 'true-event rate') }, { c: 'warn', label: L(o, 'falseRate', 'false-event rate'), dash: [6, 4] }], box.x0 + 8, box.y0 + 8, o);
  }

  /* ---------- 2. alignment ---------- */

  function drawAlignment(canvas, al, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!al) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var box = boxFor(p), fr = frame(ctx, box, [0, al.steps], [0, 1], o, L(o, 'step', 'step'), null);
    ctx.setLineDash([2, 4]); ctx.strokeStyle = P.grid;
    for (var c = 10; c <= al.steps; c += 10) { ctx.beginPath(); ctx.moveTo(fr.sx(c), box.y0); ctx.lineTo(fr.sx(c), box.y1); ctx.stroke(); }
    ctx.setLineDash([]);
    for (var i = 0; i < 3; i++) {
      var col = P[AGENTS[i]], up = [], dn = [], mid = [];
      for (var t = 0; t < al.steps; t++) {
        var m = al.mean[i][t], s = al.sd[i][t];
        up.push([fr.sx(t + 1), fr.sy(clamp(m + s, 0, 1))]); dn.push([fr.sx(t + 1), fr.sy(clamp(m - s, 0, 1))]); mid.push([fr.sx(t + 1), fr.sy(m)]);
      }
      band(ctx, up, dn, rgba(col, 0.16));
      polyline(ctx, mid, rgba(col, 1), P.lw, i === 1 ? [7, 3] : (i === 2 ? [2, 3] : null));
    }
    legend(ctx, [{ c: 'cyan', label: 'A' }, { c: 'blue', label: 'B', dash: [7, 3] }, { c: 'aqua', label: 'C', dash: [2, 3] }], box.x0 + 8, box.y0 + 8, o);
  }

  /* ---------- 3. energy-ratio histogram ---------- */

  function drawHist(canvas, h, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!h) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var ymax = 1, k;
    for (k = 0; k < h.bins; k++) ymax = Math.max(ymax, h.planted[k], h.noise[k]);
    var box = boxFor(p), fr = frame(ctx, box, [h.lo, h.hi], [0, ymax], o, L(o, 'ratio', 'gain x energy ratio'), null);
    var bw = (box.x1 - box.x0) / h.bins;
    for (k = 0; k < h.bins; k++) {
      var x = box.x0 + k * bw;
      ctx.fillStyle = rgba(P.grey, o && o.hc ? 0.9 : 0.55); ctx.fillRect(x + 1, fr.sy(h.noise[k]), bw * 0.46, box.y1 - fr.sy(h.noise[k]));
      ctx.fillStyle = rgba(P.cyan, 0.95); ctx.fillRect(x + bw * 0.5, fr.sy(h.planted[k]), bw * 0.46, box.y1 - fr.sy(h.planted[k]));
    }
    h.thr.forEach(function (t, i) {
      ctx.strokeStyle = rgba(P.gold, 1); ctx.lineWidth = P.lw; ctx.setLineDash(i === 0 ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(fr.sx(t), box.y0); ctx.lineTo(fr.sx(t), box.y1); ctx.stroke(); ctx.setLineDash([]);
    });
    legend(ctx, [{ c: 'grey', label: L(o, 'noise', 'noise episodes') }, { c: 'cyan', label: L(o, 'planted', 'planted episodes') }, { c: 'gold', label: L(o, 'threshold', 'threshold') }], box.x0 + 8, box.y0 + 8, o);
  }

  /* ---------- 4. precision / recall sweep ---------- */

  function drawSweep(canvas, sw, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!sw || !sw.points.length) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var box = boxFor(p), fr = frame(ctx, box, [1, sw.hi], [0, 1], o, L(o, 'threshold', 'threshold'), null);
    var mk = function (fn) { return sw.points.map(function (q) { return [fr.sx(q.th), fr.sy(fn(q))]; }); };
    band(ctx, mk(function (q) { return q.recallCI.hi; }), mk(function (q) { return q.recallCI.lo; }), rgba(P.cyan, 0.2));
    band(ctx, mk(function (q) { return Math.min(1, q.falseCI.hi); }), mk(function (q) { return q.falseCI.lo; }), rgba(P.warn, 0.2));
    polyline(ctx, mk(function (q) { return q.recall; }), rgba(P.cyan, 1), P.lw);
    polyline(ctx, mk(function (q) { return q.falseRate; }), rgba(P.warn, 1), P.lw, [6, 4]);
    var pr = sw.points.filter(function (q) { return q.precision !== null; }).map(function (q) { return [fr.sx(q.th), fr.sy(q.precision)]; });
    polyline(ctx, pr, rgba(P.gold, 1), P.lw, [2, 3]);
    sw.thr.forEach(function (t, i) {
      ctx.strokeStyle = rgba(P.white, 0.9); ctx.lineWidth = 1.2; ctx.setLineDash(i === 0 ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(fr.sx(t), box.y0); ctx.lineTo(fr.sx(t), box.y1); ctx.stroke(); ctx.setLineDash([]);
    });
    legend(ctx, [{ c: 'cyan', label: L(o, 'recall', 'recall') }, { c: 'warn', label: L(o, 'falsePer', 'false per agent-episode'), dash: [6, 4] }, { c: 'gold', label: L(o, 'precision', 'precision'), dash: [2, 3] }], box.x0 + 8, box.y0 + 8, o);
  }

  /* ---------- 5. shield counts ---------- */

  function drawShield(canvas, sc, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!sc.gens.length) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var ymax = 4;
    sc.gens.forEach(function (g) { if (g.declared > ymax) ymax = g.declared; });
    ymax = Math.ceil(ymax / 4) * 4;
    var box = boxFor(p), fr = frame(ctx, box, [0.5, 12.5], [0, ymax], o, L(o, 'gen', 'generation'), null);
    var bw = Math.max(5, (box.x1 - box.x0) / 12 * 0.62);
    sc.gens.forEach(function (g) {
      var x = fr.sx(g.gen) - bw / 2, y = box.y1, segs = [['truePassed', P.cyan, 0.95], ['falsePassed', P.warn, 1], ['trueRedundant', P.blue, 0.4], ['trueHeld', P.grey, 0.7], ['falseHeld', P.grey, 0.7], ['falseRedundant', P.warn, 0.4]];
      segs.forEach(function (sg, si) {
        var v = g[sg[0]]; if (!v) return;
        var hgt = (box.y1 - box.y0) * v / ymax;
        ctx.fillStyle = rgba(sg[1], sg[2]); ctx.fillRect(x, y - hgt, bw, hgt);
        if (si >= 3) { ctx.strokeStyle = rgba(P.white, 0.8); ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(x + 0.5, y - hgt + 0.5, bw - 1, hgt - 1); ctx.setLineDash([]); }
        y -= hgt;
      });
    });
    legend(ctx, [{ c: 'cyan', label: L(o, 'sh_true_pass', 'true, left') }, { c: 'warn', label: L(o, 'sh_false_pass', 'false, left') }, { c: 'grey', label: L(o, 'sh_held', 'held (no 2-of-3)'), dash: [3, 2] }, { c: 'blue', label: L(o, 'sh_redundant', 'redundant') }], box.x0 + 8, box.y0 + 8, o);
  }

  /* ---------- 6. stabilizer gain trace ---------- */

  function drawGain(canvas, gt, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!gt.x.length) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var split = Math.round(p.h * 0.64), n = gt.x.length;
    var top = { x0: 38, x1: p.w - 10, y0: 14, y1: split - 18 }, bot = { x0: 38, x1: p.w - 10, y0: split + 6, y1: p.h - 34 };
    var gmax = Math.max(3.4, Math.ceil(gt.gmax * 2) / 2);
    var f1 = frame(ctx, top, [0, n - 1], [0, gmax], o, null, null);
    if (gt.stab) {
      ctx.strokeStyle = rgba(P.gold, 1); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      [gt.min, gt.max].forEach(function (v) { ctx.beginPath(); ctx.moveTo(top.x0, f1.sy(v)); ctx.lineTo(top.x1, f1.sy(v)); ctx.stroke(); });
      ctx.setLineDash([]);
    }
    for (var i = 0; i < 3; i++) polyline(ctx, gt.geff[i].map(function (v, k) { return [f1.sx(k), f1.sy(v)]; }), rgba(P[AGENTS[i]], 0.95), P.lw * 0.8, i === 1 ? [7, 3] : (i === 2 ? [2, 3] : null));
    for (var g = 1; g < 12; g++) { ctx.strokeStyle = P.grid; ctx.setLineDash([1, 5]); ctx.beginPath(); ctx.moveTo(f1.sx(g * 8), top.y0); ctx.lineTo(f1.sx(g * 8), bot.y1); ctx.stroke(); ctx.setLineDash([]); }
    var f2 = frame(ctx, bot, [0, n - 1], [0, 1], o, L(o, 'episode', 'episode'), null);
    ctx.strokeStyle = rgba(P.gold, 1); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(bot.x0, f2.sy(gt.target)); ctx.lineTo(bot.x1, f2.sy(gt.target)); ctx.stroke(); ctx.setLineDash([]);
    polyline(ctx, gt.rate.map(function (v, k) { return [f2.sx(k), f2.sy(v)]; }), rgba(P.white, 0.95), P.lw * 0.9);
    ctx.fillStyle = P.text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(L(o, 'gain', 'effective gain'), top.x0 + 6, top.y0 + 1);
    ctx.fillText(L(o, 'rate', 'output rate (leaky mean)'), bot.x0 + 6, bot.y0 + 1);
  }

  /* ---------- 7. (1+1)-ES parameter trials ---------- */

  var RANGES = { th: [0, 1.6], c: [0, 0.5], g: [0, 3.4] };
  function drawLandscape(canvas, ls, ax, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!ls.trials) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    ax = ax || { x: 'th', y: 'g' };
    var box = boxFor(p, 38), fr = frame(ctx, box, RANGES[ax.x], RANGES[ax.y], o, L(o, 'p_' + ax.x, ax.x), L(o, 'p_' + ax.y, ax.y));
    var lo = Infinity, hi = -Infinity;
    ls.points.forEach(function (q) { if (q.score < lo) lo = q.score; if (q.score > hi) hi = q.score; });
    for (var i = 0; i < 3; i++) {
      var path = ls.points.filter(function (q) { return q.i === i && q.accepted; }).map(function (q) { return [fr.sx(q[ax.x]), fr.sy(q[ax.y])]; });
      polyline(ctx, path, rgba(P[AGENTS[i]], 0.5), 1.2);
    }
    ls.points.forEach(function (q) {
      var x = fr.sx(q[ax.x]), y = fr.sy(q[ax.y]), col = o && o.hc ? P[AGENTS[q.i]] : scoreColor(q.score, lo, hi);
      ctx.beginPath();
      if (q.i === 0) ctx.arc(x, y, 4.2, 0, TAU);
      else if (q.i === 1) { ctx.rect(x - 3.6, y - 3.6, 7.2, 7.2); }
      else { ctx.moveTo(x, y - 4.8); ctx.lineTo(x + 4.4, y + 3.4); ctx.lineTo(x - 4.4, y + 3.4); ctx.closePath(); }
      if (q.accepted) { ctx.fillStyle = rgba(col, 0.95); ctx.fill(); ctx.strokeStyle = rgba(P.white, 0.85); ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.4; ctx.stroke(); }
    });
    ctx.fillStyle = P.text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(L(o, 'land_key', 'A circle, B square, C triangle; filled = kept'), box.x1 - 4, box.y0 + 1);
  }

  /* ---------- 8. ensemble: interval per metric, seeds as dots, repository baseline ---------- */

  var ENS_ROWS = [['T', 0], ['F', 0], ['precision', 3], ['rateVar', 3], ['score', 0]];
  function drawEnsemble(canvas, sum, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!sum || !sum.n) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var rows = ENS_ROWS, rh = (p.h - 8) / rows.length, x0 = 118, x1 = p.w - 14;
    rows.forEach(function (rw, r) {
      var m = sum.metrics[rw[0]], b = sum.baseline ? sum.baseline[rw[0]] : null;
      var lo = Math.min.apply(null, m.values), hi = Math.max.apply(null, m.values);
      if (b && b.lo !== null) { lo = Math.min(lo, b.lo); hi = Math.max(hi, b.hi); } else if (b) { lo = Math.min(lo, b.mean); hi = Math.max(hi, b.mean); }
      var pad = (hi - lo) * 0.08 || 0.5; lo -= pad; hi += pad;
      var sx = scale(lo, hi, x0, x1), cy = 4 + rh * r + rh * 0.5;
      ctx.fillStyle = P.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(L(o, 'm_' + rw[0], rw[0]), 6, cy);
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
      m.values.forEach(function (v, k) { ctx.fillStyle = rgba(P.grey, o && o.hc ? 0.9 : 0.6); ctx.beginPath(); ctx.arc(sx(v), cy + jitter(k) * rh * 0.28, 2, 0, TAU); ctx.fill(); });
      ctx.strokeStyle = rgba(P.cyan, 1); ctx.lineWidth = P.lw + 1.2;
      ctx.beginPath(); ctx.moveTo(sx(m.t.lo), cy); ctx.lineTo(sx(m.t.hi), cy); ctx.stroke();
      ctx.fillStyle = rgba(P.cyan, 1); ctx.beginPath(); ctx.arc(sx(m.t.mean), cy, 4.5, 0, TAU); ctx.fill();
      if (b) {
        ctx.strokeStyle = rgba(P.gold, 1); ctx.fillStyle = rgba(P.gold, 1); ctx.lineWidth = 2;
        if (b.lo !== null) { ctx.beginPath(); ctx.moveTo(sx(b.lo), cy + rh * 0.34); ctx.lineTo(sx(b.hi), cy + rh * 0.34); ctx.stroke(); }
        var bx = sx(b.mean), by = cy + rh * 0.34;
        ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx + 5, by); ctx.lineTo(bx, by + 5); ctx.lineTo(bx - 5, by); ctx.closePath();
        if (b.approx) { ctx.lineWidth = 1.4; ctx.stroke(); } else ctx.fill();
      }
      ctx.fillStyle = P.text; ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(fmtTick(lo + pad), x0, cy + rh * 0.4); ctx.textAlign = 'right'; ctx.fillText(fmtTick(hi - pad), x1, cy + rh * 0.4);
    });
  }

  /* ---------- 9. A/B: paired score per seed, and the paired difference with its interval ---------- */

  function drawPaired(canvas, sum, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!sum || sum.n < 2) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var half = Math.round(p.w * 0.36), rows = ENS_ROWS, k;
    // left: slope chart of the game score, A on the left axis, B on the right
    var va = sum.metrics.score.va, vb = sum.metrics.score.vb, lo = Math.min.apply(null, va.concat(vb)), hi = Math.max.apply(null, va.concat(vb));
    var pad = (hi - lo) * 0.06 || 1, sy = scale(lo - pad, hi + pad, p.h - 26, 18), xa = 30, xb = half - 14;
    ctx.fillStyle = P.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(L(o, 'labA', 'A'), xa, p.h - 22); ctx.fillText(L(o, 'labB', 'B'), xb, p.h - 22);
    ctx.textBaseline = 'bottom'; ctx.fillText(L(o, 'm_score', 'score'), (xa + xb) / 2, 14);
    for (k = 0; k < va.length; k++) {
      var up = vb[k] > va[k];
      ctx.strokeStyle = rgba(up ? P.cyan : P.warn, o && o.hc ? 0.9 : 0.45); ctx.lineWidth = 1; ctx.setLineDash(up ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(xa, sy(va[k])); ctx.lineTo(xb, sy(vb[k])); ctx.stroke(); ctx.setLineDash([]);
    }
    [[xa, va, 'cyan'], [xb, vb, 'blue']].forEach(function (g) { g[1].forEach(function (v) { ctx.fillStyle = rgba(P[g[2]], 0.95); ctx.beginPath(); ctx.arc(g[0], sy(v), 2.4, 0, TAU); ctx.fill(); }); });
    // right: difference A - B per metric, 95 percent t interval and bootstrap interval, zero line
    var x0 = half + 70, x1 = p.w - 14, rh = (p.h - 8) / rows.length;
    rows.forEach(function (rw, r) {
      var d = sum.metrics[rw[0]].diff, cy = 4 + rh * r + rh * 0.5;
      var ext = Math.max(Math.abs(d.lo), Math.abs(d.hi), (d.boot ? Math.max(Math.abs(d.boot.lo), Math.abs(d.boot.hi)) : 0), 1e-6) * 1.15, sx = scale(-ext, ext, x0, x1);
      ctx.fillStyle = P.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(L(o, 'm_' + rw[0], rw[0]), half + 8, cy);
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1, cy); ctx.stroke();
      ctx.strokeStyle = rgba(P.gold, 1); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(sx(0), cy - rh * 0.38); ctx.lineTo(sx(0), cy + rh * 0.38); ctx.stroke(); ctx.setLineDash([]);
      var col = d.excludesZero ? P.cyan : P.grey;
      ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = P.lw + 1.2; ctx.beginPath(); ctx.moveTo(sx(d.lo), cy); ctx.lineTo(sx(d.hi), cy); ctx.stroke();
      ctx.fillStyle = rgba(col, 1); ctx.beginPath(); ctx.arc(sx(d.mean), cy, 4.5, 0, TAU); ctx.fill();
      if (d.boot) { ctx.strokeStyle = rgba(P.white, 0.9); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sx(d.boot.lo), cy + rh * 0.3); ctx.lineTo(sx(d.boot.hi), cy + rh * 0.3); ctx.stroke(); }
    });
  }

  /* ---------- 10. amplifier: the repository's S-- against SA-, precision with 95 percent intervals ---------- */

  function drawAmp(canvas, ab, o) {
    var p = prep(canvas), ctx = p.ctx, P = pal(o);
    if (!ab.rows.length) return empty(p, o, L(o, 'empty', ''));
    clear(p, o);
    var box = { x0: 44, x1: p.w - 10, y0: 14, y1: p.h - 34 };
    var ci = function (r) { return ST_t(r.seeds) * r.Psd / Math.sqrt(r.seeds); };
    var lo = Infinity, hi = -Infinity;
    ab.rows.forEach(function (r) { [r.off, r.on].forEach(function (q) { lo = Math.min(lo, q.P - ci(q)); hi = Math.max(hi, q.P + ci(q)); }); });
    var pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    var fr = frame(ctx, box, [0, ab.rows.length], [lo, hi], o, null, L(o, 'precision', 'precision'));
    ab.rows.forEach(function (r, k) {
      var cx = fr.sx(k + 0.5), dx = (box.x1 - box.x0) / ab.rows.length * 0.16;
      [[r.off, -dx, 'grey'], [r.on, dx, 'cyan']].forEach(function (g) {
        var q = g[0], x = cx + g[1], h = ci(q);
        ctx.strokeStyle = rgba(P[g[2]], 1); ctx.lineWidth = P.lw + 0.6; ctx.beginPath(); ctx.moveTo(x, fr.sy(q.P - h)); ctx.lineTo(x, fr.sy(q.P + h)); ctx.stroke();
        ctx.fillStyle = rgba(P[g[2]], 1); ctx.beginPath(); ctx.arc(x, fr.sy(q.P), 4.2, 0, TAU); ctx.fill();
      });
      ctx.fillStyle = P.text; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(L(o, 'w', 'cooperation') + ' ' + Math.round(r.w * 100) + '%', cx, box.y1 + 6);
    });
    legend(ctx, [{ c: 'grey', label: L(o, 'amp_off', 'amplifier off') }, { c: 'cyan', label: L(o, 'amp_on', 'amplifier on') }], box.x0 + 8, box.y0 + 8, o);
  }
  function ST_t(n) { return ST.tCrit95(n - 1); }

  /* ---------- 11. replay rail: every declaration of the whole contest ---------- */

  function drawRail(canvas, hist, cursor, o) {
    var p = prep(canvas, 36), ctx = p.ctx, P = pal(o);
    clear(p, o);
    var total = 12 * 8 * 60, x0 = 6, x1 = p.w - 6, sx = scale(0, total, x0, x1), y0 = 6, y1 = p.h - 6;
    for (var g = 0; g <= 12; g++) { ctx.strokeStyle = g % 4 === 0 ? P.axis : P.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx(g * 480), y0); ctx.lineTo(sx(g * 480), y1); ctx.stroke(); }
    hist.forEach(function (h, gi) {
      h.episodes.forEach(function (ep, ei) {
        var base = (gi * 8 + ei) * 60;
        if (ep.planted) { ctx.fillStyle = rgba(P.blue, 0.1); ctx.fillRect(sx(base), y0, sx(base + 60) - sx(base), y1 - y0); }
        for (var i = 0; i < 3; i++) {
          if (ep.declStep[i] === null) continue;
          var x = sx(base + ep.declStep[i]), y = y0 + (y1 - y0) * (0.2 + 0.3 * i);
          var out = ep.outs.indexOf(i) >= 0;
          ctx.fillStyle = rgba(ep.truth[i] ? P.gold : P.grey, out ? 1 : 0.55);
          ctx.beginPath(); ctx.arc(x, y, out ? 2.8 : 1.8, 0, TAU); ctx.fill();
        }
      });
    });
    if (cursor !== null && cursor !== undefined) {
      ctx.strokeStyle = rgba(P.white, 1); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(cursor), 0); ctx.lineTo(sx(cursor), p.h); ctx.stroke();
    }
  }

  return {
    PAL: PAL, HC: HC, RANGES: RANGES, scale: scale, ticks: ticks, fmtTick: fmtTick, jitter: jitter, scoreColor: scoreColor, clamp: clamp,
    drawRates: drawRates, drawAlignment: drawAlignment, drawHist: drawHist, drawSweep: drawSweep, drawShield: drawShield, drawGain: drawGain,
    drawLandscape: drawLandscape, drawEnsemble: drawEnsemble, drawPaired: drawPaired, drawAmp: drawAmp, drawRail: drawRail
  };
});
