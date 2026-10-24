/*
 * Membrane Arena: canvas scene (SYNTHETIC classical simulation).
 *
 * Pure helpers (layout, timeline, colours, lattice, cracks) are exported for
 * tests and need no DOM. createArena() draws three rippling membranes, pooled
 * flow particles, pooled lattice / crack bursts and the shield flash on a
 * canvas. drawFitness() and drawScience() draw the two chart canvases.
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
  var MAX_PARTICLES = 320, MAX_BURSTS = 6;
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

  /* ---------- the arena ---------- */

  function createArena(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var st = {
      w: 300, h: 300, dpr: 1, lay: layout(300, 300), reduced: !!opts.reduced,
      rec: null, tl: null, t: 0, speed: 4, playing: false,
      pulse: [0, 0, 0], shown: [0, 0, 0], settings: null, c: 0.05,
      px: new Float32Array(MAX_PARTICLES * 6), pn: 0,         // u, speed, membrane/pair id, kind, jitter, seed
      bursts: [], flashes: [], clock: 0, lattice: null,
      frames: 0, frameMs: 0, worstMs: 0, lastDraw: 0, evCount: 0, rnd: lcg(12345)
    };

    function resize() {
      var r = canvas.getBoundingClientRect(), w = Math.max(160, Math.round(r.width)), h = Math.max(160, Math.round(r.height));
      var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      st.w = w; st.h = h; st.dpr = dpr; st.lay = layout(w, h);
      var spacing = Math.max(10, st.lay.rm * 0.34), R = st.lay.rm * 1.9, pts = hexPoints(R, spacing);
      st.lattice = { pts: pts, edges: hexEdges(pts, spacing), R: R, spacing: spacing };
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
      st.rec = rec; st.tl = buildTimeline(rec); st.t = 0; st.settings = settings || null;
      st.c = rec.params.reduce(function (a, p) { return a + p.c; }, 0) / 3;
      st.bursts.length = 0; st.flashes.length = 0;
    }
    function clearGeneration() { st.rec = null; st.tl = null; st.t = 0; st.bursts.length = 0; st.flashes.length = 0; }
    function setPlaying(p) { st.playing = !!p; }
    function setSpeed(s) { st.speed = clamp(Number(s) || 1, 0.25, 16); }
    function setReduced(r) { st.reduced = !!r; if (r) st.pn = 0; }
    function genDone() { return !!st.tl && st.t >= st.tl.duration; }

    function addBurst(i, truth) {
      for (var k = st.bursts.length - 1; k >= 0; k--) if (st.bursts[k].i === i) st.bursts.splice(k, 1);
      if (st.bursts.length >= MAX_BURSTS) st.bursts.shift();
      var life = 2.0 / Math.sqrt(Math.max(1, st.speed));
      st.bursts.push({ i: i, truth: truth, t0: st.clock, life: life, seed: (st.evCount * 2654435761) >>> 0 });
      st.evCount++;
    }
    function addFlash(pass) { st.flashes.push({ pass: pass, t0: st.clock, life: 1.1 / Math.sqrt(Math.max(1, st.speed)) + 0.25 }); if (st.flashes.length > 4) st.flashes.shift(); }

    // advance by dt real seconds; returns the timeline events fired
    function update(dt) {
      dt = clamp(dt, 0, 0.05);
      st.clock += dt;
      var fired = [], i, n;
      if (st.playing && st.tl && st.t < st.tl.duration) {
        var t0 = st.t, t1 = Math.min(st.tl.duration, t0 + dt * st.speed);
        st.t = t1;
        fired = eventsBetween(st.tl, t0, t1);
        fired.forEach(function (e) {
          if (e.type === 'decl') { addBurst(e.i, e.truth); st.pulse[e.i] = 1; }
          else if (e.type === 'out' && e.shield) { if (e.passed !== null) addFlash(true); else if (e.dropped) addFlash(false); }
        });
      }
      var now = st.rec && st.tl ? locate(st.tl, st.t) : null;
      for (i = 0; i < 3; i++) {
        st.pulse[i] = Math.max(0, st.pulse[i] - dt * 1.6);
        var e = 0.2;
        if (now) e = energyOf(now, i);
        st.shown[i] += (e - st.shown[i]) * Math.min(1, dt * 10);
      }
      if (!st.reduced) {
        var lay = st.lay, rate = 12 * Math.sqrt(Math.min(st.speed, 4)), active = !st.rec || (st.playing && now && !now.gap);
        if (active) {
          for (i = 0; i < 3; i++) {
            var dec = st.rec && now && st.rec.episodes[now.ep].declStep[i] !== null && st.rec.episodes[now.ep].declStep[i] <= now.step;
            if (dec) continue;
            n = rate * dt; while (n > 0) { if (st.rnd() < n) spawn(0, i); n -= 1; }
          }
          var lr = st.c * 70 * Math.sqrt(Math.min(st.speed, 4)) * dt, pair;
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

    function background() {
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

    function drawEdges(lay) {
      ctx.lineWidth = 1;
      for (var a = 0; a < 3; a++) for (var b = a + 1; b < 3; b++) {
        ctx.strokeStyle = rgba(mix(DIM, [122, 168, 255], 0.35 + st.c), 0.28 + st.c * 1.2);
        ctx.beginPath(); ctx.moveTo(lay.m[a].x, lay.m[a].y); ctx.lineTo(lay.m[b].x, lay.m[b].y); ctx.stroke();
      }
    }

    function drawParticles(lay) {
      if (st.reduced) return;
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < st.pn; i++) {
        var k = i * 6, u = st.px[k], kind = st.px[k + 3], id = st.px[k + 2], x, y, col, a;
        if (kind === 0) {
          var m = lay.m[id], sx = lay.cx, sy = lay.cy + lay.rt * 0.0;
          var px = -(m.y - sy), py = m.x - sx, pl = Math.sqrt(px * px + py * py) || 1, wob = Math.sin(st.px[k + 5] + u * 9) * 5 * st.px[k + 4];
          x = sx + (m.x - sx) * u + px / pl * wob; y = sy + (m.y - sy) * u + py / pl * wob;
          col = HUES[id]; a = Math.sin(u * Math.PI) * 0.9;
        } else {
          var pr = pairIndex(id), A = lay.m[pr[0]], B = lay.m[pr[1]];
          var ox = -(B.y - A.y), oy = B.x - A.x, ol = Math.sqrt(ox * ox + oy * oy) || 1, off = Math.sin(u * Math.PI) * 7 * (st.px[k + 4] > 0 ? 1 : -1);
          x = A.x + (B.x - A.x) * u + ox / ol * off; y = A.y + (B.y - A.y) * u + oy / ol * off;
          col = mix(HUES[pr[0]], HUES[pr[1]], u); a = Math.sin(u * Math.PI) * 0.75;
        }
        ctx.fillStyle = rgba(col, a);
        ctx.beginPath(); ctx.arc(x, y, kind === 0 ? 1.8 : 1.5, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawMembrane(i, lay, now) {
      var m = lay.m[i], rm = lay.rm, e = st.shown[i], pulse = st.pulse[i], t = st.clock;
      var declared = !!(st.rec && now && st.rec.episodes[now.ep].declStep[i] !== null && st.rec.episodes[now.ep].declStep[i] <= now.step);
      var truth = declared && st.rec.episodes[now.ep].truth[i];
      var col = declared ? (truth ? GOLD : GREY) : energyColor(i, e);
      var glow = ctx.createRadialGradient(m.x, m.y, rm * 0.2, m.x, m.y, rm * 1.75);
      glow.addColorStop(0, rgba(col, 0.22 + 0.25 * clamp(e, 0, 1.3) + pulse * 0.2));
      glow.addColorStop(1, rgba(col, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(m.x, m.y, rm * 1.75, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      var rings = 6, seg = 72, k, j;
      var amp = st.reduced ? 0 : rm * 0.028 * (1 + 2.2 * clamp(e, 0, 1.4) + pulse * 1.5);
      for (k = 0; k < rings; k++) {
        var rr = rm * (0.38 + 0.125 * k), harm = 3 + k, dir = k % 2 ? 1 : -1, ph = t * (0.8 + 0.22 * k) * dir + i * 2.1 + k;
        ctx.beginPath();
        for (j = 0; j <= seg; j++) {
          var a = (j / seg) * TAU, r = rr + amp * Math.sin(harm * a + ph) + amp * 0.5 * Math.sin((harm + 2) * a - ph * 1.3);
          var x = m.x + Math.cos(a) * r, y = m.y + Math.sin(a) * r;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.lineWidth = k === rings - 1 ? 2.2 : 1.2;
        ctx.strokeStyle = rgba(k === rings - 1 ? col : mix(col, DIM, k * 0.1), (0.35 + 0.5 * (k / rings)) * (declared ? 1 : 0.55 + 0.45 * clamp(e, 0, 1)));
        ctx.stroke();
      }
      // threshold progress arc and tick
      var prog = clamp(e, 0, 1);
      ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      ctx.strokeStyle = rgba(DIM, 0.8);
      ctx.beginPath(); ctx.arc(m.x, m.y, rm * 1.22, -Math.PI / 2, -Math.PI / 2 + TAU); ctx.stroke();
      if (prog > 0.005) {
        ctx.strokeStyle = rgba(declared ? col : mix(HUES[i], GOLD, e >= 1 ? 0.8 : 0), 0.95);
        ctx.beginPath(); ctx.arc(m.x, m.y, rm * 1.22, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.fillStyle = rgba([238, 242, 255], 0.9);
      ctx.font = '600 ' + Math.round(Math.max(12, rm * 0.3)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ABC'.charAt(i), m.x, m.y);
    }

    function drawBursts(lay) {
      var L = st.lattice;
      for (var b = st.bursts.length - 1; b >= 0; b--) {
        var br = st.bursts[b], age = st.clock - br.t0;
        if (age > br.life) { st.bursts.splice(b, 1); continue; }
        var m = lay.m[br.i], p = st.reduced ? 1 : clamp(age / (br.life * 0.45), 0, 1), fade = clamp(1 - (age / br.life - 0.55) / 0.45, 0, 1);
        if (st.reduced) fade = clamp(1 - age / br.life, 0, 1);
        if (br.truth) {
          var reach = L.R * p, i, e;
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineWidth = 1;
          ctx.strokeStyle = rgba(GOLD, 0.55 * fade);
          ctx.beginPath();
          for (e = 0; e < L.edges.length; e++) {
            var A = L.pts[L.edges[e][0]], B = L.pts[L.edges[e][1]];
            if (B.d > reach || A.d > reach) continue;
            ctx.moveTo(m.x + A.x, m.y + A.y); ctx.lineTo(m.x + B.x, m.y + B.y);
          }
          ctx.stroke();
          ctx.fillStyle = rgba([255, 236, 170], 0.95 * fade);
          for (i = 0; i < L.pts.length; i++) {
            if (L.pts[i].d > reach) break;
            ctx.beginPath(); ctx.arc(m.x + L.pts[i].x, m.y + L.pts[i].y, 2.1, 0, TAU); ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
        } else {
          var paths = crackPaths(br.seed, L.R * 0.9, 7), q, s, rnd = lcg(br.seed ^ 77);
          ctx.lineWidth = 1.4; ctx.strokeStyle = rgba(WARN, 0.75 * fade); ctx.lineJoin = 'round';
          for (q = 0; q < paths.length; q++) {
            var path = paths[q], upto = Math.max(1, Math.round(p * (path.length - 1)));
            ctx.beginPath(); ctx.moveTo(m.x, m.y);
            for (s = 1; s <= upto; s++) ctx.lineTo(m.x + path[s].x, m.y + path[s].y);
            ctx.stroke();
          }
          ctx.fillStyle = rgba(GREY, 0.55 * fade);
          for (q = 0; q < 34; q++) {
            var ang = rnd() * TAU, rad = L.R * (0.2 + rnd() * 0.7) * (0.4 + 0.6 * p);
            ctx.fillRect(m.x + Math.cos(ang) * rad + (rnd() - 0.5) * 6, m.y + Math.sin(ang) * rad + (rnd() - 0.5) * 6, 1.8, 1.8);
          }
        }
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
          ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(GOLD, 0.9 * a); ctx.stroke();
        } else {
          ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(GREY, 0.7 * a); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }

    function draw() {
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      var lay = st.lay, now = st.rec && st.tl ? locate(st.tl, st.t) : null;
      background();
      drawEdges(lay);
      // source
      var sg = ctx.createRadialGradient(lay.cx, lay.cy, 0, lay.cx, lay.cy, lay.rm * 0.45);
      sg.addColorStop(0, 'rgba(238,242,255,0.55)'); sg.addColorStop(1, 'rgba(238,242,255,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(lay.cx, lay.cy, lay.rm * 0.45, 0, TAU); ctx.fill();
      drawParticles(lay);
      for (var i = 0; i < 3; i++) drawMembrane(i, lay, now);
      drawBursts(lay);
      drawFlashes(lay);
      var dtm = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      st.frames++; st.frameMs = st.frameMs * 0.95 + dtm * 0.05; if (dtm > st.worstMs) st.worstMs = dtm;
    }

    function stats() { return { frames: st.frames, drawMs: st.frameMs, worstDrawMs: st.worstMs, particles: st.pn, bursts: st.bursts.length, t: st.t }; }
    function resetStats() { st.frames = 0; st.worstMs = 0; }
    function position() { return st.rec && st.tl ? locate(st.tl, st.t) : null; }

    resize();
    return { resize: resize, setGeneration: setGeneration, clearGeneration: clearGeneration, setPlaying: setPlaying, setSpeed: setSpeed,
      setReduced: setReduced, update: update, draw: draw, genDone: genDone, stats: stats, resetStats: resetStats, position: position,
      state: function () { return st; } };
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
    for (var q = 0; q <= 4; q++) { var y = y1 - (y1 - y0) * q / 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.fillText((ytop * q / 4).toFixed(ytop <= 2 ? 1 : 0), x0 - 4, y); }
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
    createArena: createArena, drawFitness: drawFitness, drawScience: drawScience
  };
});
