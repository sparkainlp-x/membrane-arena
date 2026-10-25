/*
 * Membrane Arena: canvas scene (SYNTHETIC classical simulation).
 *
 * Pure helpers (layout, timeline, colours, lattice, crystal and crack
 * geometry, compass angle, replay position, snapshot) are exported for tests
 * and need no DOM. createArena() draws three membranes as deforming meshes
 * with interference ripples, particle streaks that scale with energy, a
 * weight-vector compass per membrane, branching crystal growth on true events,
 * dull cracks on false ones, the shield gate, a cinematic intro and a
 * scrubbable replay. Every visual encodes a number from the simulation record
 * or is decoration, as listed in DESIGN.md. drawFitness() and drawScience()
 * draw two chart canvases.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArenaScene = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RATE = 60;            // simulation steps per second at 1x
  var STEPS = 60, EP = 8;
  var EP_GAP = 0.3;         // seconds between episodes at 1x
  var INTERMISSION = 0.7;   // seconds after the last episode of a generation at 1x
  var MAX_PARTICLES = 360, MAX_BURSTS = 6;
  var INTRO_DUR = 4.2;      // seconds of the cinematic intro
  var HUES = [[64, 208, 224], [122, 168, 255], [94, 230, 184]];   // cyan, blue, aqua
  var DIM = [28, 47, 102], GOLD = [201, 168, 76], GREY = [138, 147, 168], WARN = [190, 112, 112];
  var TAU = Math.PI * 2;

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function mix(a, b, t) { t = clamp(t, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgba(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : clamp(a, 0, 1).toFixed(3)) + ')'; }

  // colour of a membrane ring for energy e = (gain * energy ratio) / threshold: dim navy at 0, its hue at 1, toward white above
  function energyColor(i, e) {
    var h = HUES[i];
    if (e <= 1) return mix(DIM, h, e);
    return mix(h, [255, 255, 255], clamp((e - 1) * 0.5, 0, 0.45));
  }

  function layout(w, h) {
    var cx = w / 2, cy = h * 0.54, rt = Math.min(h * 0.3, w * 0.29), rm = Math.min(rt * 0.5, w * 0.16);
    var angles = [-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6];
    return {
      w: w, h: h, cx: cx, cy: cy, rt: rt, rm: rm,
      m: angles.map(function (a) { return { x: cx + rt * Math.cos(a), y: cy + rt * Math.sin(a) }; })
    };
  }

  /* ---------- timeline of one generation (time in seconds at 1x) ---------- */

  function buildTimeline(rec) {
    var epDur = STEPS / RATE, slot = epDur + EP_GAP, ev = [], e, i;
    for (e = 0; e < rec.episodes.length; e++) {
      var ep = rec.episodes[e], s0 = e * slot;
      for (i = 0; i < 3; i++) {
        if (ep.declStep[i] !== null) ev.push({ t: s0 + ep.declStep[i] / RATE, type: 'decl', ep: e, i: i, truth: ep.truth[i], planted: ep.planted });
      }
      ev.push({ t: s0 + epDur + 0.02, type: 'out', ep: e, outs: ep.outs, passed: ep.passed, dropped: ep.dropped, evT: ep.evT, evF: ep.evF, planted: ep.planted, shield: rec.shield });
    }
    var duration = rec.episodes.length * slot + INTERMISSION;
    ev.push({ t: duration, type: 'gen' });
    ev.sort(function (a, b) { return a.t - b.t; });
    return { events: ev, duration: duration, epDur: epDur, slot: slot };
  }
  // events with t0 < t <= t1
  function eventsBetween(tl, t0, t1) {
    var out = [];
    for (var k = 0; k < tl.events.length; k++) { var t = tl.events[k].t; if (t > t0 && t <= t1) out.push(tl.events[k]); }
    return out;
  }
  function locate(tl, t) {
    var nEp = EP, e = Math.min(nEp - 1, Math.max(0, Math.floor(t / tl.slot)));
    var local = t - e * tl.slot;
    return { ep: e, step: clamp(local * RATE, 0, STEPS), gap: local > tl.epDur, inter: t >= nEp * tl.slot };
  }

  /* ---------- lattice and cracks ---------- */

  // hexagonal lattice points within radius R, nearest first
  function hexPoints(R, spacing) {
    var pts = [], row, col, rows = Math.ceil(R / (spacing * 0.866)) + 1;
    for (row = -rows; row <= rows; row++) {
      for (col = -rows; col <= rows; col++) {
        var x = (col + (row & 1 ? 0.5 : 0)) * spacing, y = row * spacing * 0.866, d = Math.sqrt(x * x + y * y);
        if (d <= R) pts.push({ x: x, y: y, d: d });
      }
    }
    pts.sort(function (a, b) { return a.d - b.d; });
    return pts;
  }
  function hexEdges(pts, spacing) {
    var edges = [], a, b, lim = spacing * 1.05;
    for (a = 0; a < pts.length; a++) for (b = a + 1; b < pts.length; b++) {
      var dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y;
      if (dx * dx + dy * dy <= lim * lim) edges.push([a, b]);
    }
    return edges;
  }
  function lcg(seed) { var s = (seed >>> 0) || 1; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  // jagged polylines radiating from the origin; deterministic in the seed
  function crackPaths(seed, R, count) {
    var rnd = lcg(seed), paths = [], k, j;
    for (k = 0; k < count; k++) {
      var a = (k / count) * TAU + rnd() * 0.6, x = 0, y = 0, pts = [{ x: 0, y: 0 }], segs = 4 + Math.floor(rnd() * 3);
      for (j = 0; j < segs; j++) {
        a += (rnd() - 0.5) * 1.1;
        var len = R * (0.18 + rnd() * 0.16);
        x += Math.cos(a) * len; y += Math.sin(a) * len;
        pts.push({ x: x, y: y });
      }
      paths.push(pts);
    }
    return paths;
  }


  /* ---------- branching crystal (true events) ---------- */

  // A six-fold dendrite: one arm with side branches and twigs, rotated six times. Segments carry the radial
  // distance of their start and end (0..1 of R) so the growth reveals them from the centre outward.
  function crystalSegments(seed, R) {
    var rnd = lcg(seed), segs = [], arm = [], k, j;
    function add(x0, y0, x1, y1, w) { arm.push({ x0: x0, y0: y0, x1: x1, y1: y1, w: w }); }
    add(0, 0, R, 0, 2.2);
    var nb = 3 + Math.floor(rnd() * 2);
    for (k = 1; k <= nb; k++) {
      var pos = (k / (nb + 1)) * R * (0.85 + 0.15 * rnd()), len = (R - pos) * (0.42 + 0.2 * rnd()) + R * 0.06;
      for (j = -1; j <= 1; j += 2) {
        var a = j * (Math.PI / 3 + (rnd() - 0.5) * 0.25), ex = pos + Math.cos(a) * len, ey = Math.sin(a) * len;
        add(pos, 0, ex, ey, 1.5);
        var mx = pos + (ex - pos) * 0.55, my = ey * 0.55, tl = len * 0.38, ta = a + j * (Math.PI / 3);
        add(mx, my, mx + Math.cos(ta) * tl * -0.2 + Math.cos(a) * tl * 0.5, my + Math.sin(a) * tl * 0.5 + Math.sin(ta) * tl * 0.25, 1);
      }
    }
    for (k = 0; k < 6; k++) {
      var ca = Math.cos(k * Math.PI / 3), sa = Math.sin(k * Math.PI / 3);
      arm.forEach(function (g) {
        var x0 = g.x0 * ca - g.y0 * sa, y0 = g.x0 * sa + g.y0 * ca, x1 = g.x1 * ca - g.y1 * sa, y1 = g.x1 * sa + g.y1 * ca;
        segs.push({ x0: x0, y0: y0, x1: x1, y1: y1, w: g.w, b0: Math.hypot(x0, y0) / R, b1: Math.hypot(x1, y1) / R });
      });
    }
    segs.sort(function (p, q) { return p.b0 - q.b0; });
    return segs;
  }
  // the part of a segment that exists at growth p (0..1): null when it has not started
  function segmentAt(sg, p) {
    if (p <= sg.b0) return null;
    var u = sg.b1 > sg.b0 ? clamp((p - sg.b0) / (sg.b1 - sg.b0), 0, 1) : 1;
    return { x0: sg.x0, y0: sg.y0, x1: sg.x0 + (sg.x1 - sg.x0) * u, y1: sg.y0 + (sg.y1 - sg.y0) * u };
  }

  /* ---------- compass, replay position, snapshot ---------- */

  // angle of the weight vector away from the signal axis: 0 when |<v|s>| = 1, pi/2 when orthogonal; null in a noise episode
  function dialAngle(fid) { return fid < 0 || !isFinite(fid) ? null : Math.acos(clamp(fid, 0, 1)); }

  var TOTAL_STEPS = 12 * 8 * 60;
  // position in the whole contest (0 .. 5760) <-> generation, episode, step
  function indexToPos(idx) {
    idx = clamp(Math.round(idx), 0, TOTAL_STEPS);
    if (idx === TOTAL_STEPS) return { gen: 11, ep: 7, step: 60 };
    var gen = Math.floor(idx / 480), r = idx - gen * 480, ep = Math.floor(r / 60);
    return { gen: gen, ep: ep, step: r - ep * 60 };
  }
  function posToIndex(p) { return clamp(p.gen * 480 + p.ep * 60 + p.step, 0, TOTAL_STEPS); }

  // what the arena shows at (episode, step) of a record, as numbers: used for the accessible description and tests
  function snapshotAt(rec, ep, step) {
    var e = rec.episodes[ep], st = clamp(Math.round(step), 0, STEPS), out = { gen: rec.gen + 1, ep: ep + 1, step: st, planted: e.planted, energy: [], declared: [], truth: [], align: [] };
    for (var i = 0; i < 3; i++) {
      var k = (Math.max(1, st) - 1) * 3 + i;
      out.energy.push(st < 1 ? 0 : clamp(e.trace[k] / e.thr[i], 0, 9));
      var d = e.declStep[i] !== null && e.declStep[i] <= st;
      out.declared.push(d); out.truth.push(d ? !!e.truth[i] : null);
      out.align.push(st < 1 ? null : (e.fid[k] < 0 ? null : e.fid[k]));
    }
    return out;
  }


  /* ---------- the arena ---------- */

  function createArena(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var st = {
      w: 300, h: 300, dpr: 1, lay: layout(300, 300), reduced: !!opts.reduced, hc: !!opts.contrast,
      rec: null, tl: null, t: 0, speed: 4, playing: false, scrub: null, intro: null,
      pulse: [0, 0, 0], shown: [0, 0, 0], settings: null, c: 0.05,
      px: new Float32Array(MAX_PARTICLES * 6), pn: 0,         // u, speed, membrane/pair id, kind, jitter, seed
      bursts: [], flashes: [], clock: 0, lattice: null, gate: 0, gateState: 0,
      frames: 0, frameMs: 0, worstMs: 0, lastDraw: 0, evCount: 0, rnd: lcg(12345), cell: 18
    };

    function resize() {
      var r = canvas.getBoundingClientRect(), w = Math.max(160, Math.round(r.width)), h = Math.max(160, Math.round(r.height));
      var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      st.w = w; st.h = h; st.dpr = dpr; st.lay = layout(w, h);
      var spacing = Math.max(10, st.lay.rm * 0.34), R = st.lay.rm * 1.5, pts = hexPoints(R, spacing);
      st.lattice = { pts: pts, edges: hexEdges(pts, spacing), R: R, spacing: spacing };
      st.cell = w < 500 ? 22 : 18;
      st.bg = null;
    }

    function spawn(kind, id, u0) {
      if (st.pn >= MAX_PARTICLES) return;
      var k = st.pn * 6;
      st.px[k] = u0 || 0; st.px[k + 1] = 0.5 + st.rnd() * 0.6; st.px[k + 2] = id; st.px[k + 3] = kind; st.px[k + 4] = (st.rnd() - 0.5) * 2; st.px[k + 5] = st.rnd() * TAU;
      st.pn++;
    }
    function removeP(n) {
      var last = (st.pn - 1) * 6, k = n * 6;
      for (var q = 0; q < 6; q++) st.px[k + q] = st.px[last + q];
      st.pn--;
    }

    function setGeneration(rec, settings) {
      st.rec = rec; st.tl = buildTimeline(rec); st.t = 0; st.settings = settings || null; st.scrub = null;
      st.c = rec.params.reduce(function (a, p) { return a + p.c; }, 0) / 3;
      st.bursts.length = 0; st.flashes.length = 0;
    }
    function clearGeneration() { st.rec = null; st.tl = null; st.t = 0; st.scrub = null; st.bursts.length = 0; st.flashes.length = 0; }
    function setPlaying(p) { st.playing = !!p; }
    function setSpeed(s) { st.speed = clamp(Number(s) || 1, 0.25, 16); }
    function setReduced(r) { st.reduced = !!r; if (r) st.pn = 0; }
    function setContrast(c) { st.hc = !!c; st.bg = null; }
    function genDone() { return !!st.tl && st.t >= st.tl.duration; }

    // replay: show a record at an exact episode and step, nothing advances
    function showAt(rec, ep, step, settings) {
      if (st.rec !== rec) { st.rec = rec; st.tl = buildTimeline(rec); st.settings = settings || null; st.c = rec.params.reduce(function (a, p) { return a + p.c; }, 0) / 3; }
      st.playing = false; st.bursts.length = 0; st.flashes.length = 0;
      st.scrub = { ep: clamp(ep, 0, rec.episodes.length - 1), step: clamp(step, 0, STEPS) };
      st.t = st.scrub.ep * st.tl.slot + st.scrub.step / RATE;
    }
    function leaveScrub() { st.scrub = null; }

    function addBurst(i, truth) {
      for (var k = st.bursts.length - 1; k >= 0; k--) if (st.bursts[k].i === i) st.bursts.splice(k, 1);
      if (st.bursts.length >= MAX_BURSTS) st.bursts.shift();
      var life = 2.4 / Math.sqrt(Math.max(1, st.speed));
      var seed = (st.evCount * 2654435761) >>> 0;
      st.bursts.push({ i: i, truth: truth, t0: st.clock, life: life, seed: seed, segs: truth ? crystalSegments(seed, st.lattice.R * 1.15) : null });
      st.evCount++;
    }
    function addFlash(pass, who) { st.flashes.push({ pass: pass, who: who, t0: st.clock, life: 1.1 / Math.sqrt(Math.max(1, st.speed)) + 0.35 }); if (st.flashes.length > 4) st.flashes.shift(); }

    function playIntro(o) {
      if (st.reduced) return false;
      st.intro = { t: 0, title: (o && o.title) || '', sub: (o && o.sub) || '', done: (o && o.done) || null };
      return true;
    }
    function skipIntro() { if (st.intro) { var d = st.intro.done; st.intro = null; if (d) d(); } }

    // advance by dt real seconds; returns the timeline events fired
    function update(dt) {
      dt = clamp(dt, 0, 0.05);
      st.clock += dt;
      if (st.intro) { st.intro.t += dt; if (st.intro.t >= INTRO_DUR) skipIntro(); }
      var fired = [], i, n;
      if (st.playing && st.tl && st.t < st.tl.duration) {
        var t0 = st.t, t1 = Math.min(st.tl.duration, t0 + dt * st.speed);
        st.t = t1;
        fired = eventsBetween(st.tl, t0, t1);
        fired.forEach(function (e) {
          if (e.type === 'decl') { addBurst(e.i, e.truth); st.pulse[e.i] = 1; }
          else if (e.type === 'out' && e.shield) { if (e.passed !== null) addFlash(true, e.passed); else if (e.dropped) addFlash(false, -1); }
        });
      }
      var now = st.rec && st.tl ? locate(st.tl, st.t) : null;
      for (i = 0; i < 3; i++) {
        st.pulse[i] = Math.max(0, st.pulse[i] - dt * 1.6);
        var e = 0.2;
        if (now) e = energyOf(now, i);
        st.shown[i] += (e - st.shown[i]) * Math.min(1, dt * (st.scrub ? 30 : 10));
      }
      st.gate += (st.gateState - st.gate) * Math.min(1, dt * 6);
      if (!st.reduced && !st.scrub) {
        var lay = st.lay, spd = Math.sqrt(Math.min(st.speed, 4)), active = !st.rec || (st.playing && now && !now.gap);
        if (active) {
          for (i = 0; i < 3; i++) {
            var dec = st.rec && now && st.rec.episodes[now.ep].declStep[i] !== null && st.rec.episodes[now.ep].declStep[i] <= now.step;
            if (dec) continue;
            // the flow towards a membrane scales with its energy relative to the threshold
            var rate = 7 * spd * (0.35 + 1.15 * clamp(st.rec ? st.shown[i] : 0.3, 0, 1.4));
            n = rate * dt; while (n > 0) { if (st.rnd() < n) spawn(0, i); n -= 1; }
          }
          var lr = st.c * 70 * spd * dt, pair;
          for (pair = 0; pair < 6; pair++) { n = lr; while (n > 0) { if (st.rnd() < n) spawn(1, pair); n -= 1; } }
        }
        for (i = st.pn - 1; i >= 0; i--) {
          var k = i * 6;
          st.px[k] += dt * st.px[k + 1] * (st.px[k + 3] === 0 ? 0.9 : 1.1);
          if (st.px[k] >= 1) { if (st.px[k + 3] === 0) st.pulse[st.px[k + 2]] = Math.min(1, st.pulse[st.px[k + 2]] + 0.08); removeP(i); }
        }
      }
      return fired;
    }

    function energyOf(now, i) {
      var ep = st.rec.episodes[now.ep], step = Math.max(1, Math.min(STEPS, Math.floor(now.step)));
      if (now.step < 1) return 0.2;
      return clamp(ep.trace[(step - 1) * 3 + i] / ep.thr[i], 0, 1.7);
    }

    function pairIndex(id) { return [[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]][id]; }
    function A(a) { return st.hc ? Math.min(1, a * 0.5 + 0.55) : a; }       // alpha floor in high contrast
    function W(w) { return st.hc ? w * 1.7 : w; }
    function glowOK() { return !st.hc; }

    function background() {
      if (st.hc) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, st.w, st.h); return; }
      if (!st.bg) {
        var g = ctx.createRadialGradient(st.w / 2, st.h * 0.45, 10, st.w / 2, st.h * 0.5, Math.max(st.w, st.h) * 0.75);
        g.addColorStop(0, '#13234f'); g.addColorStop(1, '#0a1330');
        st.bg = g;
      }
      ctx.fillStyle = st.bg; ctx.fillRect(0, 0, st.w, st.h);
      ctx.fillStyle = 'rgba(122,168,255,0.07)';
      var step = 28, x, y;
      for (x = step / 2; x < st.w; x += step) for (y = step / 2; y < st.h; y += step) ctx.fillRect(x, y, 1.2, 1.2);
    }

    // interference of the three membranes' waves, sampled on a coarse grid; amplitude follows each membrane's energy
    function drawField(lay) {
      if (st.reduced || st.hc) return;
      var cell = st.cell, t = st.clock, x, y, m = lay.m, e0 = st.shown[0], e1 = st.shown[1], e2 = st.shown[2];
      var k = 0.075, om = 2.4, d0, d1, d2, v, a;
      ctx.globalCompositeOperation = 'lighter';
      for (x = cell / 2; x < st.w; x += cell) {
        for (y = cell / 2; y < st.h; y += cell) {
          d0 = Math.sqrt((x - m[0].x) * (x - m[0].x) + (y - m[0].y) * (y - m[0].y));
          d1 = Math.sqrt((x - m[1].x) * (x - m[1].x) + (y - m[1].y) * (y - m[1].y));
          d2 = Math.sqrt((x - m[2].x) * (x - m[2].x) + (y - m[2].y) * (y - m[2].y));
          v = (e0 * Math.sin(k * d0 - om * t) / (1 + d0 * 0.012) + e1 * Math.sin(k * d1 - om * t + 1.3) / (1 + d1 * 0.012) + e2 * Math.sin(k * d2 - om * t + 2.6) / (1 + d2 * 0.012));
          a = Math.abs(v) * 0.11;
          if (a < 0.02) continue;
          ctx.fillStyle = v > 0 ? 'rgba(64,208,224,' + Math.min(0.2, a).toFixed(3) + ')' : 'rgba(201,168,76,' + Math.min(0.14, a * 0.7).toFixed(3) + ')';
          ctx.fillRect(x - cell * 0.32, y - cell * 0.32, cell * 0.64, cell * 0.64);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawEdges(lay) {
      ctx.lineWidth = W(1);
      for (var a = 0; a < 3; a++) for (var b = a + 1; b < 3; b++) {
        ctx.strokeStyle = rgba(mix(DIM, [122, 168, 255], 0.35 + st.c), A(0.28 + st.c * 1.2));
        ctx.beginPath(); ctx.moveTo(lay.m[a].x, lay.m[a].y); ctx.lineTo(lay.m[b].x, lay.m[b].y); ctx.stroke();
      }
    }

    function particlePos(lay, k, u) {
      var kind = st.px[k + 3], id = st.px[k + 2], x, y;
      if (kind === 0) {
        var m = lay.m[id], sx = lay.cx, sy = lay.cy;
        var px = -(m.y - sy), py = m.x - sx, pl = Math.sqrt(px * px + py * py) || 1, wob = Math.sin(st.px[k + 5] + u * 9) * 5 * st.px[k + 4];
        x = sx + (m.x - sx) * u + px / pl * wob; y = sy + (m.y - sy) * u + py / pl * wob;
      } else {
        var pr = pairIndex(id), Am = lay.m[pr[0]], Bm = lay.m[pr[1]];
        var ox = -(Bm.y - Am.y), oy = Bm.x - Am.x, ol = Math.sqrt(ox * ox + oy * oy) || 1, off = Math.sin(u * Math.PI) * 7 * (st.px[k + 4] > 0 ? 1 : -1);
        x = Am.x + (Bm.x - Am.x) * u + ox / ol * off; y = Am.y + (Bm.y - Am.y) * u + oy / ol * off;
      }
      return [x, y];
    }
    // streaks: each particle draws a short glowing tail behind it
    function drawParticles(lay) {
      if (st.reduced) return;
      if (glowOK()) ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < st.pn; i++) {
        var k = i * 6, u = st.px[k], kind = st.px[k + 3], id = st.px[k + 2], col, a;
        var p1 = particlePos(lay, k, u), p0 = particlePos(lay, k, Math.max(0, u - 0.09));
        if (kind === 0) { col = HUES[id]; a = Math.sin(u * Math.PI) * 0.9; }
        else { var pr = pairIndex(id); col = mix(HUES[pr[0]], HUES[pr[1]], u); a = Math.sin(u * Math.PI) * 0.75; }
        ctx.strokeStyle = rgba(col, A(a * 0.55)); ctx.lineWidth = W(kind === 0 ? 1.6 : 1.2); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        ctx.fillStyle = rgba(col, A(a));
        ctx.beginPath(); ctx.arc(p1[0], p1[1], kind === 0 ? 1.9 : 1.5, 0, TAU); ctx.fill();
      }
      ctx.lineCap = 'butt';
      ctx.globalCompositeOperation = 'source-over';
    }

    // a vertex of membrane i at ring k, angle a: own ripple harmonics plus the interference of the other two membranes' waves
    function vertex(i, lay, rr, k, a, amp, t) {
      var m = lay.m[i], harm = 3 + k, dir = k % 2 ? 1 : -1, ph = t * (0.8 + 0.22 * k) * dir + i * 2.1 + k;
      var r = rr + amp * Math.sin(harm * a + ph) + amp * 0.5 * Math.sin((harm + 2) * a - ph * 1.3);
      var x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r;
      if (amp > 0) {
        for (var j = 0; j < 3; j++) {
          if (j === i) continue;
          var dx = x - lay.m[j].x, dy = y - lay.m[j].y, d = Math.sqrt(dx * dx + dy * dy);
          r += amp * 0.55 * clamp(st.shown[j], 0, 1.3) * Math.sin(0.075 * d - 2.4 * t + j) / (1 + d * 0.01);
        }
        x = m.x + Math.cos(a) * r; y = m.y + Math.sin(a) * r;
      }
      return [x, y];
    }

    function drawMembrane(i, lay, now) {
      var m = lay.m[i], rm = lay.rm, e = st.shown[i], pulse = st.pulse[i], t = st.clock;
      var epd = st.rec && now ? st.rec.episodes[now.ep] : null;
      var declared = !!(epd && epd.declStep[i] !== null && epd.declStep[i] <= now.step);
      var truth = declared && epd.truth[i];
      var col = declared ? (truth ? GOLD : GREY) : energyColor(i, e);
      if (glowOK()) {
        var glow = ctx.createRadialGradient(m.x, m.y, rm * 0.2, m.x, m.y, rm * 1.75);
        glow.addColorStop(0, rgba(col, 0.22 + 0.25 * clamp(e, 0, 1.3) + pulse * 0.2));
        glow.addColorStop(1, rgba(col, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(m.x, m.y, rm * 1.75, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      var rings = 6, seg = 72, k, j;
      var amp = st.reduced ? 0 : rm * 0.03 * (1 + 2.2 * clamp(e, 0, 1.4) + pulse * 1.5);
      var grid = [];
      for (k = 0; k < rings; k++) {
        var rr = rm * (0.38 + 0.125 * k), pts = [];
        for (j = 0; j < seg; j++) pts.push(vertex(i, lay, rr, k, (j / seg) * TAU, amp, t));
        grid.push(pts);
        ctx.beginPath();
        for (j = 0; j < seg; j++) { if (j === 0) ctx.moveTo(pts[j][0], pts[j][1]); else ctx.lineTo(pts[j][0], pts[j][1]); }
        ctx.closePath();
        ctx.lineWidth = W(k === rings - 1 ? 2.2 : 1.1);
        ctx.strokeStyle = rgba(k === rings - 1 ? col : mix(col, DIM, k * 0.1), A((0.3 + 0.5 * (k / rings)) * (declared ? 1 : 0.55 + 0.45 * clamp(e, 0, 1))));
        ctx.stroke();
      }
      // radial mesh: spokes join the rings, so the membrane reads as a deforming net
      ctx.lineWidth = W(0.8); ctx.strokeStyle = rgba(mix(col, DIM, 0.35), A(0.28 + 0.2 * clamp(e, 0, 1)));
      ctx.beginPath();
      for (j = 0; j < seg; j += 4) for (k = 0; k < rings - 1; k++) { ctx.moveTo(grid[k][j][0], grid[k][j][1]); ctx.lineTo(grid[k + 1][j][0], grid[k + 1][j][1]); }
      ctx.stroke();
      // threshold progress arc
      var prog = clamp(e, 0, 1);
      ctx.lineWidth = W(3.5); ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(DIM, st.hc ? 1 : 0.8);
      ctx.beginPath(); ctx.arc(m.x, m.y, rm * 1.22, -Math.PI / 2, -Math.PI / 2 + TAU); ctx.stroke();
      if (prog > 0.005) {
        ctx.strokeStyle = rgba(declared ? col : mix(HUES[i], GOLD, e >= 1 ? 0.8 : 0), 0.95);
        ctx.beginPath(); ctx.arc(m.x, m.y, rm * 1.22, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      drawDial(i, lay, now, col);
    }

    // weight-vector compass: the needle's angle from vertical is the angle between the membrane's vector and the signal
    function drawDial(i, lay, now, col) {
      var m = lay.m[i], rc = lay.rm * 0.33, ep = st.rec && now ? st.rec.episodes[now.ep] : null, step = now ? Math.max(1, Math.min(STEPS, Math.floor(now.step))) : 0;
      ctx.lineWidth = W(1.2); ctx.strokeStyle = rgba([238, 242, 255], A(0.5));
      ctx.beginPath(); ctx.arc(m.x, m.y, rc, 0, TAU); ctx.stroke();
      ctx.fillStyle = rgba([238, 242, 255], A(0.55)); ctx.font = '600 ' + Math.round(Math.max(10, rc * 0.78)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ABC'.charAt(i), m.x, m.y + rc * 0.42);
      // quarter scale: 0 at the top (aligned), 90 degrees at the right (orthogonal)
      ctx.strokeStyle = rgba(GOLD, A(0.9)); ctx.lineWidth = W(1.4);
      ctx.beginPath(); ctx.moveTo(m.x, m.y - rc); ctx.lineTo(m.x, m.y - rc * 0.78); ctx.stroke();
      ctx.strokeStyle = rgba([238, 242, 255], A(0.35)); ctx.lineWidth = W(1);
      ctx.beginPath(); ctx.arc(m.x, m.y, rc, -Math.PI / 2, 0); ctx.stroke();
      var ang = ep && now && ep.planted && now.step >= 1 ? dialAngle(ep.fid[(step - 1) * 3 + i]) : null;
      if (ang === null) {
        ctx.setLineDash([2, 3]); ctx.strokeStyle = rgba(GREY, A(0.7)); ctx.beginPath(); ctx.moveTo(m.x, m.y - rc * 0.1); ctx.lineTo(m.x + rc * 0.5, m.y - rc * 0.1); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      var a, q, tx, ty;
      for (q = 1; q <= 9 && step - q >= 1; q++) {         // glowing trail of the last steps
        a = dialAngle(ep.fid[(step - q - 1) * 3 + i]); if (a === null) break;
        tx = m.x + Math.sin(a) * rc * 0.92; ty = m.y - Math.cos(a) * rc * 0.92;
        ctx.fillStyle = rgba(mix(col, GOLD, 0.3), A(0.5 * (1 - q / 10))); ctx.beginPath(); ctx.arc(tx, ty, 1.8, 0, TAU); ctx.fill();
      }
      tx = m.x + Math.sin(ang) * rc * 0.92; ty = m.y - Math.cos(ang) * rc * 0.92;
      ctx.strokeStyle = rgba(mix(col, [255, 255, 255], 0.4), 1); ctx.lineWidth = W(2); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.lineCap = 'butt';
      ctx.fillStyle = rgba([255, 255, 255], 1); ctx.beginPath(); ctx.arc(tx, ty, 2.4, 0, TAU); ctx.fill();
    }

    // true event: a gold dendrite grows outward; false event: dull cracks, a dent and dust, no glow
    function drawBurst(br, p, fade, lay) {
      var L = st.lattice, m = lay.m[br.i], s, e, i, q;
      if (br.truth) {
        var segs = br.segs || (br.segs = crystalSegments(br.seed, L.R * 1.15));
        if (glowOK()) ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (s = 0; s < segs.length; s++) {
          var g = segmentAt(segs[s], p);
          if (!g) continue;
          ctx.lineWidth = W(segs[s].w * 1.2); ctx.strokeStyle = rgba(GOLD, A(0.85 * fade));
          ctx.beginPath(); ctx.moveTo(m.x + g.x0, m.y + g.y0); ctx.lineTo(m.x + g.x1, m.y + g.y1); ctx.stroke();
          if (segs[s].w < 1.3) { ctx.fillStyle = rgba([255, 236, 170], A(0.95 * fade)); ctx.beginPath(); ctx.arc(m.x + g.x1, m.y + g.y1, 1.7, 0, TAU); ctx.fill(); }
        }
        ctx.lineCap = 'butt';
        var reach = L.R * p;
        ctx.lineWidth = W(0.8); ctx.strokeStyle = rgba(GOLD, A(0.22 * fade)); ctx.beginPath();
        for (e = 0; e < L.edges.length; e++) {
          var P0 = L.pts[L.edges[e][0]], P1 = L.pts[L.edges[e][1]];
          if (P1.d > reach || P0.d > reach) continue;
          ctx.moveTo(m.x + P0.x, m.y + P0.y); ctx.lineTo(m.x + P1.x, m.y + P1.y);
        }
        ctx.stroke();
        ctx.fillStyle = rgba([255, 236, 170], A(0.9 * fade));
        for (i = 0; i < L.pts.length; i++) { if (L.pts[i].d > reach) break; ctx.beginPath(); ctx.arc(m.x + L.pts[i].x, m.y + L.pts[i].y, 1.7, 0, TAU); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      } else {
        var paths = crackPaths(br.seed, L.R * 0.9, 7), rnd = lcg(br.seed ^ 77);
        ctx.fillStyle = 'rgba(0,0,0,' + (0.32 * fade * p).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(m.x, m.y, lay.rm * 0.95, 0, TAU); ctx.fill();
        ctx.lineWidth = W(1.2); ctx.strokeStyle = rgba(st.hc ? [255, 255, 255] : WARN, A(0.7 * fade)); ctx.lineJoin = 'round';
        if (st.hc) ctx.setLineDash([5, 4]);
        for (q = 0; q < paths.length; q++) {
          var path = paths[q], upto = Math.max(1, Math.round(p * (path.length - 1)));
          ctx.beginPath(); ctx.moveTo(m.x, m.y);
          for (s = 1; s <= upto; s++) ctx.lineTo(m.x + path[s].x, m.y + path[s].y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(GREY, A(0.5 * fade));
        for (q = 0; q < 34; q++) {
          var ang = rnd() * TAU, rad = L.R * (0.2 + rnd() * 0.7) * (0.4 + 0.6 * p);
          ctx.fillRect(m.x + Math.cos(ang) * rad + (rnd() - 0.5) * 6, m.y + Math.sin(ang) * rad + (rnd() - 0.5) * 6, 1.8, 1.8);
        }
      }
    }
    function drawBursts(lay, now) {
      if (st.scrub && st.rec && now) {          // replay: growth is a function of the simulation step, so scrubbing animates it
        var ep = st.rec.episodes[now.ep], step = st.scrub.step;
        for (var i = 0; i < 3; i++) {
          if (ep.declStep[i] === null || ep.declStep[i] > step) continue;
          var age = (step - ep.declStep[i]) / RATE, seed = ((st.rec.gen * 8 + now.ep) * 3 + i + 1) * 2654435761 >>> 0;
          drawBurst({ i: i, truth: ep.truth[i], seed: seed, segs: null }, st.reduced ? 1 : clamp(age / 0.9, 0, 1), 0.9, lay);
        }
        return;
      }
      for (var b = st.bursts.length - 1; b >= 0; b--) {
        var br = st.bursts[b], ag = st.clock - br.t0;
        if (ag > br.life) { st.bursts.splice(b, 1); continue; }
        var p = st.reduced ? 1 : clamp(ag / (br.life * 0.5), 0, 1), fade = clamp(1 - (ag / br.life - 0.6) / 0.4, 0, 1);
        if (st.reduced) fade = clamp(1 - ag / br.life, 0, 1);
        drawBurst(br, p, fade, lay);
      }
    }

    // the shield gate: three leaves around the source; open (gold) when an output leaves, shut (grey cross) when it is held
    function drawGate(lay) {
      var shield = st.settings ? st.settings.shield : (st.rec ? st.rec.shield : true);
      if (!shield) return;
      var g = st.gate, r0 = lay.rm * 0.2, r1 = lay.rm * 0.46, a, k, open = Math.max(0, g), shut = Math.max(0, -g);
      for (k = 0; k < 3; k++) {
        a = -Math.PI / 2 + k * TAU / 3 + open * 0.55;
        ctx.strokeStyle = open > 0.05 ? rgba(GOLD, A(0.5 + open * 0.5)) : rgba(GREY, A(0.55 + shut * 0.4)); ctx.lineWidth = W(2 + open * 1.5); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(lay.cx, lay.cy, r1 * (1 + open * 0.25), a - 0.55, a + 0.55); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      if (shut > 0.1) {
        ctx.strokeStyle = rgba(GREY, A(shut)); ctx.lineWidth = W(2);
        ctx.beginPath(); ctx.moveTo(lay.cx - r0, lay.cy - r0); ctx.lineTo(lay.cx + r0, lay.cy + r0); ctx.moveTo(lay.cx + r0, lay.cy - r0); ctx.lineTo(lay.cx - r0, lay.cy + r0); ctx.stroke();
      }
    }
    function drawFlashes(lay) {
      for (var f = st.flashes.length - 1; f >= 0; f--) {
        var fl = st.flashes[f], age = st.clock - fl.t0;
        if (age > fl.life) { st.flashes.splice(f, 1); continue; }
        var a = 1 - age / fl.life, m = lay.m;
        ctx.beginPath(); ctx.moveTo(m[0].x, m[0].y); ctx.lineTo(m[1].x, m[1].y); ctx.lineTo(m[2].x, m[2].y); ctx.closePath();
        if (fl.pass) {
          ctx.fillStyle = rgba(GOLD, 0.10 * a); ctx.fill();
          ctx.lineWidth = W(2.5); ctx.strokeStyle = rgba(GOLD, A(0.9 * a)); ctx.stroke();
          if (fl.who >= 0) {                       // the released output travels from its membrane through the open gate
            var u = clamp(age / (fl.life * 0.6), 0, 1), w = m[fl.who];
            ctx.strokeStyle = rgba([255, 236, 170], A(0.9 * a)); ctx.lineWidth = W(2);
            ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(w.x + (lay.cx - w.x) * u, w.y + (lay.cy - w.y) * u); ctx.stroke();
          }
        } else {
          ctx.setLineDash([6, 6]); ctx.lineWidth = W(1.5); ctx.strokeStyle = rgba(GREY, A(0.7 * a)); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      // the gate follows the most recent flash while it lasts
      var last = st.flashes.length ? st.flashes[st.flashes.length - 1] : null;
      st.gateState = last ? (last.pass ? 1 : -1) : 0;
    }

    function drawIntro(lay) {
      var it = st.intro, t = it.t, k, u;
      ctx.fillStyle = 'rgba(7,14,38,' + clamp(0.9 - clamp((t - 2.6) / 1.2, 0, 1) * 0.9, 0, 0.9).toFixed(3) + ')'; ctx.fillRect(0, 0, st.w, st.h);
      // the three membranes spiral in from the corners, then ripple outward
      for (k = 0; k < 3; k++) {
        u = clamp((t - 0.15 * k) / 1.4, 0, 1); var ease = 1 - Math.pow(1 - u, 3), tgt = lay.m[k];
        var sx = k === 0 ? lay.cx : (k === 1 ? st.w * 1.05 : -st.w * 0.05), sy = k === 0 ? -st.h * 0.1 : st.h * 1.05, ang = (1 - ease) * 2.4;
        var dx = (sx - tgt.x) * (1 - ease), dy = (sy - tgt.y) * (1 - ease);
        var x = tgt.x + dx * Math.cos(ang) - dy * Math.sin(ang), y = tgt.y + dx * Math.sin(ang) + dy * Math.cos(ang);
        ctx.strokeStyle = rgba(HUES[k], A(0.25 + 0.7 * ease)); ctx.lineWidth = W(2);
        for (var r = 0; r < 4; r++) { ctx.beginPath(); ctx.arc(x, y, lay.rm * (0.4 + 0.2 * r) * (0.4 + 0.6 * ease), 0, TAU); ctx.stroke(); }
        if (t > 1.6) {
          var w = clamp((t - 1.6) / 1.6, 0, 1);
          ctx.strokeStyle = rgba(HUES[k], A((1 - w) * 0.7)); ctx.lineWidth = W(1.5);
          ctx.beginPath(); ctx.arc(x, y, lay.rm * (0.9 + w * 2.2), 0, TAU); ctx.stroke();
        }
      }
      if (t > 1.8) {                                   // a gold lattice flash at the source
        var q = clamp((t - 1.8) / 1.0, 0, 1), L = st.lattice;
        ctx.strokeStyle = rgba(GOLD, A((1 - q * 0.4) * 0.8)); ctx.lineWidth = W(1.2); ctx.beginPath();
        for (var e = 0; e < L.edges.length; e++) {
          var P0 = L.pts[L.edges[e][0]], P1 = L.pts[L.edges[e][1]];
          if (P1.d > L.R * q || P0.d > L.R * q) continue;
          ctx.moveTo(lay.cx + P0.x, lay.cy + P0.y); ctx.lineTo(lay.cx + P1.x, lay.cy + P1.y);
        }
        ctx.stroke();
      }
      var ta = clamp((t - 1.2) / 0.9, 0, 1) * (1 - clamp((t - 3.5) / 0.7, 0, 1));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(GOLD, A(ta)); ctx.font = '700 ' + Math.round(clamp(st.w * 0.062, 20, 46)) + 'px system-ui, sans-serif';
      ctx.fillText(it.title, st.w / 2, st.h * 0.2);
      ctx.fillStyle = rgba([64, 208, 224], A(ta)); ctx.font = '600 ' + Math.round(clamp(st.w * 0.026, 11, 17)) + 'px system-ui, sans-serif';
      ctx.fillText(it.sub, st.w / 2, st.h * 0.2 + clamp(st.w * 0.05, 22, 40));
    }

    function draw() {
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      var lay = st.lay, now = st.rec && st.tl ? locate(st.tl, st.t) : null;
      background();
      drawField(lay);
      drawEdges(lay);
      var sg = ctx.createRadialGradient(lay.cx, lay.cy, 0, lay.cx, lay.cy, lay.rm * 0.45);
      sg.addColorStop(0, 'rgba(238,242,255,0.55)'); sg.addColorStop(1, 'rgba(238,242,255,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(lay.cx, lay.cy, lay.rm * 0.45, 0, TAU); ctx.fill();
      drawParticles(lay);
      for (var i = 0; i < 3; i++) drawMembrane(i, lay, now);
      drawGate(lay);
      drawBursts(lay, now);
      drawFlashes(lay);
      if (st.intro) drawIntro(lay);
      var dtm = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      st.frames++; st.frameMs = st.frameMs * 0.95 + dtm * 0.05; if (dtm > st.worstMs) st.worstMs = dtm;
    }

    function stats() { return { frames: st.frames, drawMs: st.frameMs, worstDrawMs: st.worstMs, particles: st.pn, bursts: st.bursts.length, t: st.t, intro: !!st.intro }; }
    function resetStats() { st.frames = 0; st.worstMs = 0; }
    function position() { return st.rec && st.tl ? locate(st.tl, st.t) : null; }
    function snapshot() { var p = position(); return st.rec && p ? snapshotAt(st.rec, p.ep, p.step) : null; }

    resize();
    return { resize: resize, setGeneration: setGeneration, clearGeneration: clearGeneration, setPlaying: setPlaying, setSpeed: setSpeed,
      setReduced: setReduced, setContrast: setContrast, update: update, draw: draw, genDone: genDone, stats: stats, resetStats: resetStats, position: position,
      showAt: showAt, leaveScrub: leaveScrub, playIntro: playIntro, skipIntro: skipIntro, snapshot: snapshot, state: function () { return st; } };
  }

  /* ---------- chart canvases ---------- */

  function prep(canvas) {
    var r = canvas.getBoundingClientRect(), w = Math.max(160, Math.round(r.width)), h = Math.max(100, Math.round(r.height));
    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1), ctx = canvas.getContext('2d');
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function axes(ctx, x0, y0, x1, y1, gens, ymaxLabel, ytop) {
    ctx.strokeStyle = 'rgba(122,168,255,0.25)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(179,190,219,0.9)';
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var q = 0; q <= 4; q++) { var y = y1 - (y1 - y0) * q / 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); var v = ytop * q / 4; ctx.fillText(Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, ''), x0 - 4, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var g = 0; g < gens; g += 2) ctx.fillText(String(g + 1), x0 + (x1 - x0) * (g + 0.5) / gens, y1 + 3);
  }

  // best selection score of each membrane per generation, accepted mutations filled, rejected hollow
  function drawFitness(canvas, hist, gens) {
    var p = prep(canvas), ctx = p.ctx, x0 = 34, x1 = p.w - 10, y0 = 8, y1 = p.h - 20, i, g;
    var ymax = 1;
    hist.forEach(function (h) { h.best.forEach(function (b) { if (b > ymax) ymax = b; }); h.scores.forEach(function (b) { if (b > ymax) ymax = b; }); });
    ymax = Math.ceil(ymax * 2) / 2;
    axes(ctx, x0, y0, x1, y1, gens, '', ymax);
    for (i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(HUES[i], 0.95); ctx.lineWidth = 2; ctx.beginPath();
      hist.forEach(function (h, k) { var x = x0 + (x1 - x0) * (k + 0.5) / gens, y = y1 - (y1 - y0) * clamp(h.best[i], 0, ymax) / ymax; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
      hist.forEach(function (h, k) {
        var x = x0 + (x1 - x0) * (k + 0.5) / gens, ys = y1 - (y1 - y0) * clamp(h.scores[i], 0, ymax) / ymax;
        ctx.beginPath(); ctx.arc(x, ys, 3.2, 0, TAU);
        if (h.accepted[i]) { ctx.fillStyle = rgba(HUES[i], 1); ctx.fill(); } else { ctx.strokeStyle = rgba(HUES[i], 0.8); ctx.lineWidth = 1.2; ctx.stroke(); }
      });
    }
  }

  // cumulative precision per generation with the repository mean as a dashed line, and stacked true / false outputs
  function drawScience(canvas, hist, gens, base) {
    var p = prep(canvas), ctx = p.ctx, mid = Math.round(p.h * 0.5), g, T = 0, F = 0;
    var x0 = 34, x1 = p.w - 10;
    axes(ctx, x0, 8, x1, mid - 18, gens, '', 1);
    if (base) {
      var yb = (mid - 18) - (mid - 26) * base.P;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = rgba(GOLD, 0.95); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, yb); ctx.lineTo(x1, yb); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = rgba(HUES[0], 1); ctx.lineWidth = 2.2; ctx.beginPath();
    var pts = [];
    hist.forEach(function (h, k) {
      T += h.outT; F += h.outF;
      var pr = T + F > 0 ? T / (T + F) : 0, x = x0 + (x1 - x0) * (k + 0.5) / gens, y = (mid - 18) - (mid - 26) * pr;
      pts.push([x, y]); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    pts.forEach(function (q) { ctx.fillStyle = rgba(HUES[0], 1); ctx.beginPath(); ctx.arc(q[0], q[1], 2.6, 0, TAU); ctx.fill(); });
    var ymax = 1;
    hist.forEach(function (h) { if (h.outT + h.outF > ymax) ymax = h.outT + h.outF; });
    ymax = Math.max(4, Math.ceil(ymax / 4) * 4);
    var by0 = mid + 8, by1 = p.h - 20;
    axes(ctx, x0, by0, x1, by1, gens, '', ymax);
    var bw = Math.max(3, (x1 - x0) / gens * 0.6);
    hist.forEach(function (h, k) {
      var x = x0 + (x1 - x0) * (k + 0.5) / gens - bw / 2, ht = (by1 - by0) * h.outT / ymax, hf = (by1 - by0) * h.outF / ymax;
      ctx.fillStyle = rgba(HUES[0], 0.85); ctx.fillRect(x, by1 - ht, bw, ht);
      ctx.fillStyle = rgba(WARN, 0.95); ctx.fillRect(x, by1 - ht - hf, bw, hf);
    });
  }

  return {
    RATE: RATE, STEPS: STEPS, EP: EP, EP_GAP: EP_GAP, INTERMISSION: INTERMISSION, HUES: HUES, GOLD: GOLD,
    clamp: clamp, mix: mix, rgba: rgba, energyColor: energyColor, layout: layout, buildTimeline: buildTimeline,
    eventsBetween: eventsBetween, locate: locate, hexPoints: hexPoints, hexEdges: hexEdges, crackPaths: crackPaths, lcg: lcg,
    crystalSegments: crystalSegments, segmentAt: segmentAt, dialAngle: dialAngle, indexToPos: indexToPos, posToIndex: posToIndex, snapshotAt: snapshotAt, TOTAL_STEPS: TOTAL_STEPS, INTRO_DUR: INTRO_DUR,
    createArena: createArena, drawFitness: drawFitness, drawScience: drawScience
  };
});
