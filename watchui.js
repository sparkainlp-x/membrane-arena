/*
 * Membrane Arena: Pair Watch page (SYNTHETIC classical simulation).
 *
 * Draws one canvas scene: the tick rail, the observer membrane (its dark core is the opposite energy,
 * the dashed ring the threshold, its bulges the lanes its find uses), the calibrator's nine lanes (its
 * readings, the tone it is playing, the 0.7 faded line and, after the call, the true channel) and the
 * opposite-energy trace. Plays each wave tick by tick, stops at a declaration for the player's call,
 * then reveals the truth. Also the heads-up display, the wave log, the end-of-run comparison with the
 * calibrator's shield and the coach, the plain-text score card with its replay code, and the replay check
 * for links that carry a code. No network, no storage.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var W = window.ArenaWatch, P = window.ArenaPair, G = window.ArenaGame, LANGS = window.WatchI18n.LANGS;
  var $ = function (id) { return document.getElementById(id); };
  var hash = W.parseHash(location.hash);
  var lang = hash.lang === 'fr' ? 'fr' : 'en', hc = false;
  var today = W.dailySeed(G.localDateString(new Date()));
  var seed = hash.seed || today;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var BASE_TPS = 12;                 // ticks per second at 1x
  var run = null, wave = null, phase = 'idle', cur = 0, shown = 0, paused = false, speed = 2;
  var share = 2, eqPref = true, entry = null, prevStage = -1;
  var pulses = [], parts = [], raf = 0, lastTs = 0, revealT = 0;
  var statusFn = null, bannerFn = null;
  // the coach (off by default) and the replay code; a link with a code is checked on load
  var COACH = W.COACH, coachOn = false, coachShown = 0, replayCode = hash.replay || null;
  var verifyRes = hash.replay && hash.seed ? W.replayRun(hash.seed, hash.replay) : null;
  var canvas = $('scene'), ctx = canvas.getContext('2d'), cssW = 0, cssH = 0, phone = false;

  function t(k, vars) { var s = (LANGS[lang] && LANGS[lang][k]) || LANGS.en[k] || k; return G.fmt(s, vars); }
  function text(el, s) { el.textContent = s; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function num(x, d) { var s = x.toFixed(d === undefined ? 2 : d); return lang === 'fr' ? s.replace('.', ',') : s; }
  function signed(p) { return (p > 0 ? '+' : p < 0 ? '\u2212' : '') + Math.abs(p); }
  function setHash() {
    var h = W.buildHash({ seed: seed, lang: lang, replay: replayCode });
    if (history.replaceState) history.replaceState(null, '', h || location.pathname);
  }

  /* ---------- colours ---------- */
  var C = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement), v = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    C = { bg: hc ? '#000000' : '#050a1c', panel: hc ? '#000000' : '#0d1838', line: v('--line', '#2a3b6e'), text: v('--text', '#eef2ff'),
      muted: v('--muted', '#b3bedb'), gold: v('--gold', '#c9a84c'), goldB: v('--gold-bright', '#e0c36a'), cyan: v('--cyan', '#40d0e0'),
      aqua: v('--aqua', '#5ee6b8'), danger: v('--danger', '#ff9a9a'), lw: hc ? 2 : 1 };
  }
  function rgba(hex, a) {
    var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- layout ---------- */
  function resize() {
    var wrap = canvas.parentNode, dpr = Math.min(3, window.devicePixelRatio || 1);
    cssW = Math.max(280, Math.floor(wrap.clientWidth));
    phone = cssW < 620;
    cssH = phone ? Math.round(cssW * 1.62) : Math.round(Math.max(380, cssW * 0.56));
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }
  function boxes() {
    var pad = 12, railH = 34, top = pad + railH + 12, sparkH = phone ? 74 : 86;
    if (phone) {
      var mh = Math.round(cssW * 0.54), lh = cssH - top - mh - sparkH - 2 * pad;
      return { rail: { x: pad, y: pad, w: cssW - 2 * pad, h: railH }, mem: { x: pad, y: top, w: cssW - 2 * pad, h: mh },
        lanes: { x: pad, y: top + mh + pad, w: cssW - 2 * pad, h: lh }, spark: { x: pad, y: cssH - sparkH - pad, w: cssW - 2 * pad, h: sparkH } };
    }
    var mw = Math.round(cssW * 0.34), bodyH = cssH - top - sparkH - 2 * pad;
    return { rail: { x: pad, y: pad, w: cssW - 2 * pad, h: railH }, mem: { x: pad, y: top, w: mw, h: bodyH },
      lanes: { x: pad + mw + 16, y: top, w: cssW - 2 * pad - mw - 16, h: bodyH }, spark: { x: pad, y: cssH - sparkH - pad, w: cssW - 2 * pad, h: sparkH } };
  }

  /* ---------- the state shown ---------- */
  function endTick() { return wave ? (wave.declTick || P.TICKS) : 0; }
  function frameAt(k) { return wave && k >= 1 ? wave.frames[k - 1] : null; }
  function view() {
    var fr = frameAt(shown), lastRead = [], k;
    for (k = 0; k < W.NF; k++) lastRead.push(0);
    if (wave) for (k = 1; k <= shown; k++) { var f = wave.frames[k - 1]; if (f.f >= 0) lastRead[f.f] = k; }
    var est = fr ? fr.est : null, spec = fr ? fr.spec : null, inF = 0;
    if (est && spec) for (k = 0; k < W.NF; k++) if (est[k] < P.FADED) inF += spec[k];
    return { fr: fr, E: fr ? fr.E : 0, est: est, spec: spec, lastRead: lastRead, inFaded: inF };
  }
  function th() { return wave ? wave.th : P.TUNED[W.stageOf(run).off ? 'off' : 'grid']; }

  /* ---------- drawing ---------- */
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function label(s, x, y, o) {
    o = o || {};
    ctx.font = (o.bold ? '600 ' : '') + (o.size || 12) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    if (o.pill) {
      var w = ctx.measureText(s).width, sz = o.size || 12, x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      rr(x0 - 4, y - sz, w + 8, sz + 5, 4); ctx.fillStyle = hc ? '#000000' : 'rgba(5,10,28,0.88)'; ctx.fill();
    }
    ctx.fillStyle = o.color || C.muted; ctx.textAlign = o.align || 'left'; ctx.textBaseline = o.base || 'alphabetic';
    ctx.fillText(s, x, y);
  }
  function drawRail(b) {
    var n = phone ? 24 : 40, start = 0, step = b.w / n, r = Math.min(step * 0.38, 9), i;
    if (wave) start = Math.max(0, Math.min(P.TICKS - n, shown - Math.floor(n * 0.6)));
    for (i = 0; i < n; i++) {
      var k = start + i + 1, x = b.x + (i + 0.5) * step, y = b.y + b.h / 2 - 3;
      var who = wave ? wave.frames[k - 1].who : P.owner(k, share), played = wave && k <= shown;
      var col = who === 'o' ? C.cyan : C.gold, rad = k === shown ? r * 1.25 : r;
      ctx.globalAlpha = played ? 1 : 0.28;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 2 * Math.PI); ctx.fillStyle = col; ctx.fill();
      if (who === 'c' && r >= 6.5) {
        var f = wave ? wave.frames[k - 1].f : null;
        if (f !== null) label(String(f), x, y + 0.5, { color: '#0a1330', size: Math.round(r * 1.25), align: 'center', base: 'middle', bold: true });
      }
      ctx.globalAlpha = 1;
      if (k % P.CHECK === 0) { ctx.fillStyle = C.muted; ctx.fillRect(x - 1, y + r + 3, 2, 5); }
      if (k === shown) { ctx.beginPath(); ctx.arc(x, y, rad + 3, 0, 2 * Math.PI); ctx.strokeStyle = C.text; ctx.lineWidth = 1.5 * C.lw; ctx.stroke(); }
      if (wave && wave.declTick === k && shown >= k) { ctx.beginPath(); ctx.arc(x, y, rad + 6, 0, 2 * Math.PI); ctx.strokeStyle = C.goldB; ctx.lineWidth = 2 * C.lw; ctx.stroke(); }
    }
  }
  function drawMembrane(b, vw, now) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2 + 8, R = Math.min(b.w, b.h) * 0.36, i, k;
    var spec = vw.spec, E = Math.max(0, Math.min(1, vw.E)), declared = wave && wave.declTick && shown >= wave.declTick;
    var wob = (phase === 'play' && !paused && !reduce) ? now / 1000 : 0;
    label(t('scene.obs'), b.x + 4, b.y + 14, { color: C.text, bold: true, size: 13 });
    label(t('scene.tick', { t: shown, n: P.TICKS }), b.x + b.w - 4, b.y + 14, { align: 'right' });
    // outline: lobes toward the lanes the find uses
    ctx.beginPath();
    for (i = 0; i <= 96; i++) {
      var a = 2 * Math.PI * i / 96, rr0 = 1;
      if (spec) for (k = 1; k < W.NF; k++) rr0 += 0.22 * spec[k] * Math.cos(k * a + 0.9 * k);
      rr0 += 0.012 * Math.sin(3 * a + 2.1 * wob) + 0.008 * Math.sin(5 * a - 1.3 * wob);
      var x = cx + R * rr0 * Math.cos(a), y = cy + R * rr0 * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    var g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.15);
    g.addColorStop(0, hc ? '#003a3a' : '#123a66'); g.addColorStop(1, rgba(C.cyan, hc ? 0.5 : 0.35));
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = C.cyan; ctx.lineWidth = 2.5 * C.lw; ctx.stroke();
    // the dark core: opposite energy
    var core = R * 0.82 * E;
    if (core > 0.5) {
      var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, core);
      cg.addColorStop(0, '#000000'); cg.addColorStop(0.85, 'rgba(2,4,12,0.96)'); cg.addColorStop(1, 'rgba(2,4,12,0.6)');
      ctx.beginPath(); ctx.arc(cx, cy, core, 0, 2 * Math.PI); ctx.fillStyle = cg; ctx.fill();
      if (E >= th()) { ctx.strokeStyle = C.goldB; ctx.lineWidth = 2 * C.lw; ctx.stroke(); }
    }
    // the threshold ring
    ctx.save(); ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.82 * th(), 0, 2 * Math.PI); ctx.strokeStyle = C.goldB; ctx.lineWidth = 1.5 * C.lw; ctx.stroke();
    ctx.restore();
    var ly = Math.min(b.y + b.h - 6, cy + R * 1.32 + 14);
    label(t('scene.oe') + ' ' + num(vw.E) + '  \u00B7  ' + t('scene.th') + ' ' + num(th()), cx, ly, { align: 'center', color: C.text, size: 13 });
    if (declared) {
      if (phone) label(t('scene.decl'), b.x + 4, b.y + 32, { color: C.goldB, bold: true, size: 14 });
      else label(t('scene.decl'), cx, cy - R * 1.2 - 2, { align: 'center', color: C.goldB, bold: true, size: 14 });
    }
    return { cx: cx, cy: cy, R: R };
  }
  function laneGeom(b) {
    var top = b.y + (phone ? 42 : 26), bottom = b.y + b.h - 22, lw = b.w / W.NF;
    return { top: top, bottom: bottom, h: bottom - top, lw: lw, y: function (v) { return bottom - Math.max(0, Math.min(1.2, v)) / 1.2 * (bottom - top); } };
  }
  function drawLanes(b, vw, now) {
    var L = laneGeom(b), k, share0 = wave ? wave.settings.share : share;
    label(t('scene.cal'), b.x + 2, b.y + 14, { color: C.text, bold: true, size: 13 });
    if (vw.spec) label(t('scene.inFaded', { p: Math.round(100 * vw.inFaded) }), phone ? b.x + 2 : b.x + b.w - 2, phone ? b.y + 31 : b.y + 14,
      { align: phone ? 'left' : 'right', color: vw.inFaded >= 0.5 ? C.danger : C.muted, size: 12, bold: vw.inFaded >= 0.5 });
    var maxAge = W.NF * (share0 + 1) * 1.5;
    for (k = 0; k < W.NF; k++) {
      var x0 = b.x + k * L.lw, cx = x0 + L.lw / 2, bw = Math.max(8, L.lw * 0.5);
      rr(cx - bw / 2 - 3, L.top, bw + 6, L.h, 6); ctx.fillStyle = C.panel; ctx.fill();
      if (hc) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke(); }
      // the find, lane by lane
      if (vw.spec) {
        var s = vw.spec[k], gr = Math.max(0, Math.min(1, Math.sqrt(s * 2.2))) * L.lw * 0.62;
        if (gr > 1) {
          var gy = L.bottom - 8, g = ctx.createRadialGradient(cx, gy, 0, cx, gy, gr);
          g.addColorStop(0, rgba(C.cyan, hc ? 1 : 0.95)); g.addColorStop(1, rgba(C.cyan, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, gy, gr, 0, 2 * Math.PI); ctx.fill();
        }
      }
      // the reading
      if (vw.est && vw.lastRead[k]) {
        var v = vw.est[k], age = shown - vw.lastRead[k], fresh = Math.max(0, 1 - age / maxAge), yv = L.y(v);
        ctx.globalAlpha = 0.3 + 0.7 * fresh;
        rr(cx - bw / 2, yv, bw, L.bottom - yv, 4); ctx.fillStyle = v < P.FADED ? C.danger : C.gold; ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.text; ctx.fillRect(cx - bw / 2, yv - 1, bw, 2);
      } else {
        ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(C.gold, 0.7); ctx.lineWidth = 1;
        rr(cx - bw / 2, L.y(1), bw, L.bottom - L.y(1), 4); ctx.stroke(); ctx.restore();
      }
      // the true channel, after the call
      if ((phase === 'reveal' || phase === 'end') && vw.fr && revealT > 0) {
        var yt = L.y(vw.fr.gain[k]);
        ctx.save(); ctx.globalAlpha = Math.min(1, revealT); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.text; ctx.lineWidth = 2 * C.lw;
        ctx.beginPath(); ctx.moveTo(cx - bw / 2 - 5, yt); ctx.lineTo(cx + bw / 2 + 5, yt); ctx.stroke(); ctx.restore();
      }
      label(String(P.FREQS[k]), cx, b.y + b.h - 6, { align: 'center', color: C.muted, size: 12 });
    }
    // guide lines: 1 (clean) and 0.7 (faded)
    var y1 = L.y(1), y7 = L.y(P.FADED);
    ctx.strokeStyle = rgba(C.text, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x, y1); ctx.lineTo(b.x + b.w, y1); ctx.stroke();
    ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = C.danger; ctx.lineWidth = 1.5 * C.lw;
    ctx.beginPath(); ctx.moveTo(b.x, y7); ctx.lineTo(b.x + b.w, y7); ctx.stroke(); ctx.restore();
    label('0' + (lang === 'fr' ? ',' : '.') + '7 ' + t('scene.faded'), b.x + b.w - 2, y7 - 5, { align: 'right', color: C.danger, size: 11, pill: true });
    if ((phase === 'reveal' || phase === 'end') && revealT > 0) label('- - ' + t('scene.truth'), b.x + 6, y1 - 5, { color: C.text, size: 11, pill: true });
    // tone pulses: the calibrator plays a known sine tone down one lane
    pulses = pulses.filter(function (p) { return now - p.t0 < p.dur; });
    pulses.forEach(function (p) {
      var age = (now - p.t0) / p.dur, cx = b.x + (p.f + 0.5) * L.lw, amp = L.lw * 0.32 * (1 - age), i;
      ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = C.goldB; ctx.lineWidth = 2 * C.lw; ctx.beginPath();
      for (i = 0; i <= 60; i++) {
        var u = i / 60, y = L.top + u * L.h, sx = p.f === 0 ? 0 : Math.sin(2 * Math.PI * P.FREQS[p.f] * (u + 0.5 / 16) - age * 6) * amp;
        if (i === 0) ctx.moveTo(cx + sx, y); else ctx.lineTo(cx + sx, y);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, L.top + 10, 4 + 8 * age, 0, 2 * Math.PI); ctx.stroke();
      ctx.restore();
    });
    return L;
  }
  function drawSpark(b) {
    rr(b.x, b.y, b.w, b.h, 8); ctx.fillStyle = C.panel; ctx.fill();
    if (hc) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke(); }
    var x0 = b.x + 8, x1 = b.x + b.w - 8, y0 = b.y + 20, y1 = b.y + b.h - 8, lo = -0.25, hi = 1;
    var X = function (k) { return x0 + (k - 1) / (P.TICKS - 1) * (x1 - x0); }, Y = function (e) { return y1 - (Math.max(lo, Math.min(hi, e)) - lo) / (hi - lo) * (y1 - y0); };
    label(t('scene.oe'), b.x + 8, b.y + 14, { size: 12, color: C.text });
    var k;
    ctx.fillStyle = rgba(C.text, 0.35);
    for (k = P.CHECK; k <= P.TICKS; k += P.CHECK) ctx.fillRect(X(k) - 0.5, y0, 1, y1 - y0);
    ctx.strokeStyle = rgba(C.text, 0.3); ctx.beginPath(); ctx.moveTo(x0, Y(0)); ctx.lineTo(x1, Y(0)); ctx.stroke();
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = C.goldB; ctx.lineWidth = 1.5 * C.lw;
    ctx.beginPath(); ctx.moveTo(x0, Y(th())); ctx.lineTo(x1, Y(th())); ctx.stroke(); ctx.restore();
    label(t('scene.th') + ' ' + num(th()), x1, Y(th()) - 4, { align: 'right', color: C.goldB, size: 11, pill: true });
    if (wave && shown > 0) {
      ctx.beginPath();
      for (k = 1; k <= shown; k++) { var x = X(k), y = Y(wave.frames[k - 1].E); if (k === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 2 * C.lw; ctx.stroke();
      if (wave.declTick && shown >= wave.declTick) {
        ctx.beginPath(); ctx.arc(X(wave.declTick), Y(wave.frames[wave.declTick - 1].E), 5, 0, 2 * Math.PI); ctx.fillStyle = C.goldB; ctx.fill();
      }
    }
  }
  function drawParts(dt) {
    parts = parts.filter(function (p) { return p.life > 0; });
    parts.forEach(function (p) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.life -= dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillStyle = p.c; ctx.beginPath();
      if (p.shard) { ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 3, p.y); ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 3, p.y); ctx.closePath(); }
      else ctx.arc(p.x, p.y, 2.2, 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  var memGeom = null;
  function burst(color, n, shard) {
    if (reduce || !memGeom) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 2 * Math.PI, sp = 60 + Math.random() * 140;
      parts.push({ x: memGeom.cx + Math.cos(a) * memGeom.R * 0.5, y: memGeom.cy + Math.sin(a) * memGeom.R * 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        life: 0.7 + Math.random() * 0.6, c: color, shard: !!shard });
    }
    kick();
  }
  function draw(now) {
    if (!cssW) return;
    var vw = view(), bx = boxes();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, cssW, cssH);
    drawRail(bx.rail);
    memGeom = drawMembrane(bx.mem, vw, now);
    drawLanes(bx.lanes, vw, now);
    drawSpark(bx.spark);
    drawParts(lastTs ? Math.min(0.05, (now - lastTs) / 1000) : 0);
    canvas.setAttribute('aria-label', ariaScene(vw));
  }
  function ariaScene(vw) {
    if (!wave || !shown) return t('scene.aria.idle');
    var r = [], f = [], k, idx = [];
    for (k = 0; k < W.NF; k++) { r.push(vw.lastRead[k] ? num(vw.est[k]) : '?'); idx.push(k); }
    idx.sort(function (a, b) { return vw.spec[b] - vw.spec[a]; });
    for (k = 0; k < 3; k++) f.push(idx[k] + ' (' + Math.round(100 * vw.spec[idx[k]]) + '%)');
    return t('scene.aria', { t: shown, n: P.TICKS, e: num(vw.E), th: num(th()), r: r.join(', '), f: f.join(', ') });
  }

  /* ---------- the loop ---------- */
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  function loop(ts) {
    raf = 0;
    var dt = lastTs ? Math.min(100, ts - lastTs) : 0;
    if (phase === 'play' && !paused) {
      cur += dt / 1000 * BASE_TPS * speed;
      advanceTo(Math.min(endTick(), Math.floor(cur)), ts);
    }
    if (phase === 'reveal' && revealT < 1) revealT = Math.min(1, revealT + dt / 600);
    draw(ts);
    lastTs = ts;
    if ((phase === 'play' && !paused) || pulses.length || parts.length || (phase === 'reveal' && revealT < 1)) kick();
    else lastTs = 0;
  }
  function advanceTo(k, ts) {
    var last = -1;
    while (shown < k) {
      shown++;
      var fr = wave.frames[shown - 1];
      if (fr.f >= 0) last = fr.f;
      if (fr.f >= 0 && !reduce && k - shown < 3) pulses.push({ f: fr.f, t0: ts, dur: Math.max(250, 900 / speed) });
    }
    if (shown >= endTick() && phase === 'play') {
      if (wave.declTick) enterDecide(); else finishWave(null);
    }
    return last;
  }

  /* ---------- phases ---------- */
  function stageIdx() { return run ? Math.min(W.STAGES.length - 1, Math.floor(run.idx / W.WAVES)) : 0; }
  function startRun(s, keepCode) {
    seed = s; run = W.createRun(seed); wave = null; entry = null; phase = 'idle'; shown = 0; cur = 0; paused = false; prevStage = -1;
    pulses = []; parts = []; revealT = 0; coachShown = 0;
    if (!keepCode) { replayCode = null; verifyRes = null; }
    $('end').hidden = true;
    setHash(); toIdle();
  }
  function toIdle() {
    phase = 'idle'; wave = null; shown = 0; cur = 0; entry = null; revealT = 0;
    var si = stageIdx();
    if (si !== prevStage) { prevStage = si; bannerFn = function () { return t('stage.' + W.STAGES[si].id); }; }
    statusFn = function () { return t('status.ready', { n: run.idx + 1, total: W.TOTAL }); };
    $('decide').hidden = true;
    renderAll(); kick();
  }
  function startWave() {
    if (phase !== 'idle' || W.done(run)) return;
    wave = W.playWave(run, { share: share, eq: eqPref });
    phase = 'play'; shown = 0; cur = 0; paused = false; lastTs = 0;
    statusFn = function () { return t('status.play', { n: wave.index + 1, s: wave.settings.share, eq: t(wave.settings.eq ? 'word.on' : 'word.off') }); };
    renderAll(); kick();
  }
  function enterDecide() {
    phase = 'decide';
    var fr = wave.frames[wave.declTick - 1];
    var q = function () { return t('decide.q', { t: wave.declTick }); };
    var d = function () { return t('decide.detail', { e: num(fr.E), th: num(wave.th), p: Math.round(100 * view().inFaded) }); };
    statusFn = function () { return q() + ' ' + d(); };
    burst(C.goldB, 18, false);
    renderAll();
    $('decide').focus();
  }
  function outcomeText(e) {
    var parts0 = [], key = 'out.' + e.kind;
    if (e.kind === 'acceptFalse' || e.kind === 'vetoFalse') key += '.' + (e.reason || 'noise');
    parts0.push(t(key));
    parts0.push(t('out.points', { p: signed(e.points) }));
    if (e.bonus) parts0.push(t('out.streak', { n: e.streak, b: e.bonus }));
    var f = wave.fade;
    if (!f) parts0.push(t('out.fade.none'));
    else if (f.kind === 'grid') parts0.push(t('out.fade.grid', { f: f.band, d: num(f.depth) }));
    else parts0.push(t('out.fade.off', { c: num(f.center, 1), d: num(f.depth) }));
    if (e.declTick) parts0.push(t(e.calVote ? 'out.shield.accept' : 'out.shield.veto'));
    if (e.declTick && e.coachSaid !== null && e.coachSaid !== undefined) parts0.push(t(e.coachSaid ? 'out.coach.accept' : 'out.coach.veto'));
    return parts0.join(' ');
  }
  function finishWave(call) {
    entry = W.resolve(run, wave, call);
    // the coach's advice is shown, never applied: the call above is the player's
    entry.coachSaid = call && coachOn && COACH ? W.coachAccepts(COACH, entry) : null;
    if (entry.coachSaid !== null) coachShown++;
    phase = 'reveal'; revealT = reduce ? 1 : 0;
    var e = entry;
    statusFn = function () { return outcomeText(e); };
    var pop = $('pop');
    pop.className = 'pop'; void pop.offsetWidth;
    text(pop, signed(e.points));
    pop.className = 'pop show ' + (e.good ? 'good' : e.points === 0 ? 'meh' : 'bad');
    if (e.good && e.declTick) burst(C.aqua, 26, true); else if (!e.good && e.declTick) burst(C.danger, 26, true);
    renderAll(); kick();
    $('btn-go').focus();
  }
  function next() {
    if (phase !== 'reveal') return;
    if (W.done(run)) showEnd(); else toIdle();
  }
  function showEnd() {
    phase = 'end';
    replayCode = W.encodeRun(seed, run.log); setHash();
    statusFn = function () { return t('status.end'); };
    bannerFn = null;
    renderAll(); kick();
    $('end').hidden = false;
    $('end-h').setAttribute('tabindex', '-1'); $('end-h').focus();
  }
  function call(c) { if (phase === 'decide') finishWave(c); }
  function skip() {
    if (phase !== 'play') return;
    cur = endTick(); advanceTo(endTick(), performance.now()); kick();
  }
  function togglePause() {
    if (phase !== 'play') return;
    paused = !paused; lastTs = 0;
    if (paused) statusFn = function () { return t('status.paused', { t: shown }); };
    else statusFn = function () { return t('status.play', { n: wave.index + 1, s: wave.settings.share, eq: t(wave.settings.eq ? 'word.on' : 'word.off') }); };
    renderAll(); kick();
  }

  /* ---------- page text ---------- */
  function renderHud() {
    var si = stageIdx(), inStage = run.idx - si * W.WAVES, s = W.summarize(run.log);
    var waveNo = phase === 'end' ? W.WAVES : Math.min(W.WAVES, inStage + (phase === 'reveal' ? 0 : 1));
    if (phase === 'reveal') { si = entry.stage; waveNo = entry.index - si * W.WAVES + 1; }
    text($('hud-stage'), (si + 1) + ' / ' + W.STAGES.length);
    text($('hud-wave'), waveNo + ' / ' + W.WAVES);
    var hp = $('hud-points'); text(hp, String(s.points).replace('-', '\u2212'));
    hp.className = 'hud-v' + (entry ? (entry.points > 0 ? ' up' : entry.points < 0 ? ' down' : '') : '');
    var st = run.log.length ? run.log[run.log.length - 1].streak : 0;
    text($('hud-streak'), st ? '\u00D7' + st : '\u2013');
  }
  function renderControls() {
    var st = W.stageOf(run), idle = phase === 'idle';
    text($('s-val'), String(share));
    text($('s-ratio'), t('ctl.ratio', { s: share }));
    $('s-dec').disabled = !idle || share <= 1; $('s-inc').disabled = !idle || share >= P.SHARE_MAX;
    var eq = $('eq');
    if (phase === 'reveal' && entry) st = W.STAGES[entry.stage];
    eq.disabled = !idle || !st.eq;
    eq.checked = st.eq ? (wave ? wave.settings.eq : eqPref) : false;
    text($('eq-note'), !st.eq ? t('ctl.eq.locked') : t(eq.checked ? 'ctl.eq.on' : 'ctl.eq.off'));
    var go = $('btn-go');
    go.disabled = phase === 'play' || phase === 'decide' || phase === 'end';
    text(go, phase === 'idle' ? t('btn.play', { n: run.idx + 1 }) : phase === 'play' ? t('btn.watching') : phase === 'decide' ? t('btn.decide')
      : phase === 'reveal' ? t(W.done(run) ? 'btn.end' : 'btn.next') : t('btn.done'));
    $('btn-pause').disabled = phase !== 'play';
    $('btn-pause').setAttribute('aria-pressed', paused && phase === 'play' ? 'true' : 'false');
    text($('btn-pause'), t(paused && phase === 'play' ? 'btn.resume' : 'btn.pause'));
    $('btn-skip').disabled = phase !== 'play';
  }
  function kindLabel(e) { return t('kind.' + e.kind); }
  function renderLog() {
    var box = $('log'); clear(box);
    W.STAGES.forEach(function (stg, si) {
      var row = document.createElement('div'); row.className = 'log-row';
      var k = document.createElement('span'); k.className = 'log-k'; k.textContent = t('log.stage', { n: stg.id }); row.appendChild(k);
      for (var i = 0; i < W.WAVES; i++) {
        var idx = si * W.WAVES + i, e = run.log[idx], c = document.createElement('span');
        c.className = 'chip ' + (e ? (e.good ? 'good' : e.points === 0 ? 'meh' : 'bad') : 'todo') + (idx === run.idx && phase !== 'end' && phase !== 'reveal' ? ' cur' : '');
        c.textContent = e ? W.GLYPH[e.kind] : String(i + 1);
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', e ? t('log.chip', { n: idx + 1, what: kindLabel(e), p: signed(e.points) }) : t('log.todo', { n: idx + 1 }));
        row.appendChild(c);
      }
      box.appendChild(row);
    });
  }
  function renderEnd() {
    if (phase !== 'end') return;
    var s = W.summarize(run.log), body = $('end-body'); clear(body);
    tableRows(body, s, true);
    text($('end-rank'), t('rank.' + W.rank(s)));
    text($('end-note'), t('end.note', { a: s.agreeShield, d: s.declared }));
    text($('end-link'), replayCode ? t('end.link', { code: replayCode }) : '');
    var card = W.shareText({ seed: seed, summary: s, log: run.log, code: replayCode }, t);
    if (coachShown) card = card.replace(t('share.tag'), t('share.coach', { n: coachShown, d: s.declared }) + '\n' + t('share.tag'));
    text($('share'), card);
  }
  // the comparison rows: every policy plays the same waves with the same settings; only the calls differ
  function tableRows(body, s, bonusRow) {
    var rows = [['end.you', s.base, true]];
    if (bonusRow) rows.push(['end.youBonus', s.points, false]);
    rows.push(['end.shield', s.shield]);
    if (s.coach !== null && s.coach !== undefined) rows.push(['end.coach', s.coach]);
    rows.push(['end.acceptAll', s.acceptAll], ['end.vetoAll', s.vetoAll], ['end.best', s.best]);
    rows.forEach(function (r) {
      var tr = document.createElement('tr'); if (r[2]) tr.className = 'you';
      var a = document.createElement('td'); a.textContent = t(r[0]); var b = document.createElement('td'); b.className = 'n'; b.textContent = String(r[1]).replace('-', '\u2212');
      tr.appendChild(a); tr.appendChild(b); body.appendChild(tr);
    });
  }
  function renderVerify() {
    var box = $('verify'), body = $('verify-body');
    box.hidden = !verifyRes; if (!verifyRes) return;
    clear(body);
    var r = verifyRes;
    box.classList.toggle('bad', !r.ok);
    $('verify-tablewrap').hidden = !r.ok;
    if (!r.ok) { text($('verify-msg'), t('verify.err.' + r.error, { n: (r.at || 0) + 1, seed: hash.seed })); return; }
    var s = r.summary;
    text($('verify-msg'), t('verify.ok', { seed: hash.seed, n: s.waves, p: s.points, b: s.base }) + (r.complete ? '' : ' ' + t('verify.partial', { n: s.waves, total: W.TOTAL })));
    tableRows(body, s, false);
  }
  function renderCoach(showD) {
    var box = $('coach-box'), on = showD && coachOn;
    box.hidden = !on; if (!on) return;
    var q = COACH ? W.predict(COACH, wave) : null;
    box.querySelector('.meter').hidden = !q; $('coach-scale').hidden = !q;
    if (!q) { text($('coach-p'), t('coach.none')); return; }
    var pc = function (x) { return Math.round(100 * x); }, be = pc(W.BREAK_EVEN), acc = q.p > W.BREAK_EVEN;
    text($('coach-p'), t('coach.p', { p: pc(q.p), lo: pc(q.lo), hi: pc(q.hi), be: be, what: t(acc ? 'coach.accept' : 'coach.veto') }));
    $('coach-bar').style.width = (100 * q.p).toFixed(1) + '%';
    $('coach-ci').style.left = (100 * q.lo).toFixed(1) + '%'; $('coach-ci').style.width = (100 * (q.hi - q.lo)).toFixed(1) + '%';
    $('coach-be').style.left = be + '%';
    text($('coach-scale'), t('coach.scale', { be: be }));
    box.classList.toggle('acc', acc);
  }
  function renderAll() {
    text($('status'), statusFn ? statusFn() : '');
    $('status').classList.toggle('sr-only', phase === 'decide');   // the decision panel shows it
    text($('banner'), bannerFn ? bannerFn() : '');
    var showD = phase === 'decide';
    $('decide').hidden = !showD;
    if (showD) {
      var fr = wave.frames[wave.declTick - 1];
      text($('decide-q'), t('decide.q', { t: wave.declTick }) + ' ' + t('decide.detail', { e: num(fr.E), th: num(wave.th), p: Math.round(100 * view().inFaded) }));
    }
    renderCoach(showD);
    renderHud(); renderControls(); renderLog(); renderEnd(); renderVerify();
    text($('seed-line'), t('seed.line', { seed: seed }));
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = t('page.title');
    $('s-dec').setAttribute('aria-label', t('ctl.share.dec'));
    $('s-inc').setAttribute('aria-label', t('ctl.share.inc'));
    document.querySelector('.hud').setAttribute('aria-label', t('sec.game'));
    text($('footer-version'), 'watch ' + W.VERSION + ' / arena ' + G.BUILD);
    setHash(); renderAll(); draw(performance.now());
  }

  /* ---------- wiring ---------- */
  $('decide').setAttribute('tabindex', '-1');
  $('btn-accept').addEventListener('click', function () { call('accept'); });
  $('btn-veto').addEventListener('click', function () { call('veto'); });
  $('btn-go').addEventListener('click', function () { if (phase === 'idle') startWave(); else if (phase === 'reveal') next(); });
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-skip').addEventListener('click', skip);
  $('speed').addEventListener('change', function () { speed = +this.value || 2; });
  $('s-dec').addEventListener('click', function () { share = Math.max(1, share - 1); renderControls(); kick(); });
  $('s-inc').addEventListener('click', function () { share = Math.min(P.SHARE_MAX, share + 1); renderControls(); kick(); });
  $('eq').addEventListener('change', function () { eqPref = this.checked; renderControls(); });
  $('coach').disabled = !COACH;
  $('coach').addEventListener('change', function () { coachOn = this.checked && !!COACH; renderAll(); });
  $('btn-again').addEventListener('click', function () { startRun(seed); });
  $('btn-today').addEventListener('click', function () { startRun(today); });
  $('btn-new').addEventListener('click', function () { startRun('w' + Math.floor(Math.random() * 1e9).toString(36)); });
  $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); });
  $('btn-contrast').addEventListener('click', function () {
    hc = !hc;
    document.documentElement.classList.toggle('hc', hc);
    this.setAttribute('aria-pressed', hc ? 'true' : 'false');
    readColors(); draw(performance.now());
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var tag = ev.target && ev.target.tagName, key = ev.key.toLowerCase();
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((key === ' ' || key === 'enter') && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return;
    if (key === 'a' && phase === 'decide') { call('accept'); ev.preventDefault(); }
    else if (key === 'v' && phase === 'decide') { call('veto'); ev.preventDefault(); }
    else if (key === ' ') { if (phase === 'play') togglePause(); else if (phase === 'idle') startWave(); else if (phase === 'reveal') next(); ev.preventDefault(); }
    else if (key === 's' && phase === 'play') { skip(); ev.preventDefault(); }
    else if (key === 'n' && phase === 'reveal') { next(); ev.preventDefault(); }
  });
  window.addEventListener('resize', resize);
  if (reduce) { speed = 4; $('speed').value = '4'; }
  // read-only state for the headless-browser check
  window.PairWatchState = function () {
    return { phase: phase, shown: shown, idx: run.idx, declTick: wave ? wave.declTick : null, points: W.summarize(run.log).points,
      log: run.log.map(function (e) { return { kind: e.kind, points: e.points, call: e.call, coachSaid: e.coachSaid }; }),
      coachOn: coachOn, coachShown: coachShown, coachP: phase === 'decide' && COACH ? W.predict(COACH, wave).p : null,
      replay: replayCode, verify: verifyRes ? { ok: verifyRes.ok, error: verifyRes.error || null, points: verifyRes.ok ? verifyRes.summary.points : null } : null };
  };
  readColors();
  run = W.createRun(seed);
  applyLang();
  startRun(seed, true);
  resize();
})();
