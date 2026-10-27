/*
 * Membrane Arena: Wave Pulse page (SYNTHETIC classical simulation).
 *
 * One canvas scene: the membrane grid with its edge sensors, and the sensors' recordings. While a
 * pulse is being heard the grid is covered: only the sensors light up, in the order the ripple
 * reaches them. The player taps where they think it started (or moves a marker with the arrow
 * keys), optionally with the locator's hint and 90% region, and confirms. Then the ripple is replayed
 * on the grid in a Great Wave colour style (deep blue troughs, foam-white crests), with the true
 * start, the guess and the locator's answer. "Free waves" lets the player tap anywhere to send an
 * unscored ripple. Also the heads-up display, the pulse log, the end-of-run comparison, the
 * plain-text score card with its replay code, and the replay check for links that carry a code.
 * No network, no storage.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var PU = window.ArenaPulse, G = window.ArenaGame, LANGS = window.PulseI18n.LANGS;
  var $ = function (id) { return document.getElementById(id); };
  var hash = PU.parseHash(location.hash);
  var lang = hash.lang === 'fr' ? 'fr' : 'en', hc = false;
  var today = PU.dailySeed(G.localDateString(new Date()));
  var seed = hash.seed || today;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var BASE_TPS = 26;                       // ticks per second at normal speed while listening
  var REVEAL_TPS = 11;                     // slower while the ripple is replayed, so the rings can be followed
  var REVEAL_END = 92;                     // the reveal stops here: the first pass across the grid, before the walls' echoes pile up
  var CAL = PU.calib();
  var REGION_CAL = window.ArenaPulseRegionCalib || null;
  var mode = 'play', phase = 'idle', run = null, A = null, entry = null, tick = 0, speed = 2, hintOn = false;
  var marker = null, raf = 0, lastTs = 0, freeSim = null, freeN = 0, freePatchy = false;
  var FREE_PATCH = PU.spec('free-patch').patch;
  var replayCode = hash.replay || null;
  var verifyRes = hash.replay && hash.seed ? PU.replayRun(hash.seed, hash.replay) : null;
  var canvas = $('scene'), ctx = canvas.getContext('2d'), cssW = 0, cssH = 0, phone = false, L = null;
  function t(k, vars) { var s = (LANGS[lang] && LANGS[lang][k]) || LANGS.en[k] || k; return G.fmt(s, vars); }
  function text(el, s) { el.textContent = s; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function num(x, d) { var s = x.toFixed(d === undefined ? 1 : d); return lang === 'fr' ? s.replace('.', ',') : s; }
  function setHash() {
    var h = PU.buildHash({ seed: seed, lang: lang, replay: replayCode });
    if (history.replaceState) history.replaceState(null, '', h || location.pathname);
  }
  /* ---------- colours: a Great Wave style palette ---------- */
  var C = {}, PAL = [];
  function hex(h) { var n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function readColors() {
    var cs = getComputedStyle(document.documentElement), v = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    C = { bg: hc ? '#000000' : '#071a30', cover: hc ? '#000000' : '#0b1f38', line: v('--line', '#2a3b6e'), text: v('--text', '#eef2ff'),
      muted: v('--muted', '#b3bedb'), gold: v('--gold', '#c9a84c'), goldB: v('--gold-bright', '#e0c36a'), cyan: v('--cyan', '#40d0e0'),
      aqua: v('--aqua', '#5ee6b8'), danger: v('--danger', '#ff9a9a'), foam: hc ? '#ffffff' : '#f4ecd8', seal: hc ? '#ff6b6b' : '#c9302c', lw: hc ? 2 : 1 };
    var stops = hc ? [[-1, '#000000'], [-0.3, '#001a66'], [0, '#0044aa'], [0.45, '#00ffff'], [1, '#ffffff']]
      : [[-1, '#04162b'], [-0.4, '#0b2a4a'], [0, '#1f4f78'], [0.4, '#5d8fb3'], [0.75, '#b9d3e0'], [1, '#f4ecd8']];
    PAL = []; PALRGB = [];
    for (var i = 0; i <= 64; i++) {
      var x = -1 + i / 32, j = 0;
      while (j < stops.length - 2 && x > stops[j + 1][0]) j++;
      var a = hex(stops[j][1]), b = hex(stops[j + 1][1]), u = Math.max(0, Math.min(1, (x - stops[j][0]) / (stops[j + 1][0] - stops[j][0])));
      var rgb = [Math.round(a[0] + (b[0] - a[0]) * u), Math.round(a[1] + (b[1] - a[1]) * u), Math.round(a[2] + (b[2] - a[2]) * u)];
      PALRGB.push(rgb); PAL.push('rgb(' + rgb.join(',') + ')');
    }
  }
  function rgba(h, a) { var c = hex(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  /* ---------- layout ---------- */
  function layout() {
    var pad = 10, n = mode === 'play' && A ? A.sensors.length : 8;
    if (phone) {
      var gw = cssW - 2 * pad, cs = gw / PU.W, gh = cs * PU.H, rowH = 26;
      return { gx: pad, gy: pad + 18, cs: cs, gw: gw, gh: gh, tr: { x: pad, y: pad + 18 + gh + 26, w: gw, h: n * rowH + 6, rowH: rowH } };
    }
    var gw2 = Math.round(cssW * 0.64), cs2 = gw2 / PU.W, gh2 = cs2 * PU.H, tx = pad + gw2 + 16;
    return { gx: pad, gy: pad + 18, cs: cs2, gw: gw2, gh: gh2, tr: { x: tx, y: pad + 18, w: cssW - tx - pad, h: gh2, rowH: gh2 / n } };
  }
  function resize() {
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    cssW = Math.max(280, Math.floor(canvas.parentNode.clientWidth));
    phone = cssW < 620;
    var n = mode === 'play' && A ? A.sensors.length : 8;
    var gh = (phone ? cssW - 20 : Math.round(cssW * 0.64)) * PU.H / PU.W;
    cssH = Math.round(phone ? 28 + gh + 26 + n * 26 + 18 : 28 + gh + 12);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    L = layout();
    draw();
  }
  function cellX(x) { return L.gx + (x + 0.5) * L.cs; }
  function cellY(y) { return L.gy + (y + 0.5) * L.cs; }
  /* ---------- drawing ---------- */
  var off = document.createElement('canvas'), offCtx, offImg, PALRGB = [];
  off.width = PU.W; off.height = PU.H; offCtx = off.getContext('2d'); offImg = offCtx.createImageData(PU.W, PU.H);
  function drawField(frames, tk) {
    var base = tk * PU.NC, cs = L.cs, foam = [], m = 0, i;
    for (i = 0; i < PU.NC; i++) m = Math.max(m, Math.abs(frames[base + i]));
    // each frame is scaled to its own peak (with a floor), so a spreading ring keeps its foam
    var scale = Math.max(0.02, 0.8 * m), d = offImg.data;
    for (i = 0; i < PU.NC; i++) {
      var v = frames[base + i] / scale, k = Math.max(0, Math.min(64, Math.round((v + 1) * 32))), c = PALRGB[k];
      d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
      if (v > 0.72 && ((i % PU.W) + Math.floor(i / PU.W)) % 2 === 0) foam.push([i % PU.W, Math.floor(i / PU.W)]);
    }
    offCtx.putImageData(offImg, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, L.gx, L.gy, L.gw, L.gh); ctx.restore();
    // foam curls on the crests: a colour style only
    ctx.strokeStyle = C.foam; ctx.lineWidth = Math.max(1, cs * 0.12); ctx.lineCap = 'round';
    foam.forEach(function (p) {
      ctx.beginPath(); ctx.arc(cellX(p[0]) + cs * 0.15, cellY(p[1]) + cs * 0.1, cs * 0.34, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
    });
    ctx.lineCap = 'butt';
  }
  function drawCover() {
    ctx.fillStyle = C.cover; ctx.fillRect(L.gx, L.gy, L.gw, L.gh);
    ctx.strokeStyle = rgba(hc ? '#ffffff' : '#5d8fb3', hc ? 0.35 : 0.14); ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x <= PU.W; x += 2) { ctx.moveTo(L.gx + x * L.cs, L.gy); ctx.lineTo(L.gx + x * L.cs, L.gy + L.gh); }
    for (var y = 0; y <= PU.H; y += 2) { ctx.moveTo(L.gx, L.gy + y * L.cs); ctx.lineTo(L.gx + L.gw, L.gy + y * L.cs); }
    ctx.stroke();
  }
  function arrivalOrder() {
    var order = {}, list = [];
    A.arrivals.forEach(function (a, j) { if (a >= 0 && a <= tick) list.push([a, j]); });
    list.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    list.forEach(function (p, r) { order[p[1]] = r + 1; });
    return order;
  }
  function drawSensors(idx, arrivals, tk, order) {
    var r = Math.max(6, L.cs * 0.55);
    idx.forEach(function (k, j) {
      var s = PU.SENSORS[k], x = cellX(s[0]), y = cellY(s[1]), a = arrivals ? arrivals[j] : -1, heard = a >= 0 && tk >= a;
      if (heard && tk - a < 10 && !reduce) {
        ctx.strokeStyle = rgba(C.goldB, 1 - (tk - a) / 10); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + (tk - a) * 1.6, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.fillStyle = heard ? C.goldB : (hc ? '#000' : '#0b2a4a');
      ctx.strokeStyle = C.goldB; ctx.lineWidth = 2.5;
      if (arrivals && a < 0 && tk >= PU.TICKS - 1) ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (order && order[j]) {
        ctx.fillStyle = '#000'; ctx.font = '700 ' + Math.round(r * 1.2) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(order[j]), x, y + 1);
      }
    });
  }
  function drawRegion(faint) {
    var hs = L.cs / 2, gw = 2 * PU.W - 1;
    ctx.fillStyle = rgba(C.goldB, faint ? (hc ? 0.3 : 0.18) : (hc ? 0.45 : 0.3));
    A.region.cells.forEach(function (c) { var gx = c % gw, gy = Math.floor(c / gw); ctx.fillRect(cellX(gx / 2) - hs / 2, cellY(gy / 2) - hs / 2, hs, hs); });
  }
  function drawX(p, col, label) {
    var x = cellX(p[0]), y = cellY(p[1]), r = Math.max(6, L.cs * 0.6);
    ctx.strokeStyle = hc ? '#000' : '#04162b'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
    if (label) tag(label, x - r - 6, y + 8, col, 'right');
  }
  function drawRing(p, col, label) {
    var x = cellX(p[0]), y = cellY(p[1]), r = Math.max(7, L.cs * 0.75);
    ctx.lineWidth = 6; ctx.strokeStyle = hc ? '#000' : '#04162b';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.moveTo(x, y - r * 0.5); ctx.lineTo(x, y + r * 0.5); ctx.lineWidth = 2; ctx.stroke();
    if (label) tag(label, x, y + r + 14, col);
  }
  function drawTarget(p) {
    var x = cellX(p[0]), y = cellY(p[1]), r = Math.max(7, L.cs * 0.7);
    ctx.fillStyle = C.seal; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = C.foam; ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r * 0.9; ctx[i ? 'lineTo' : 'moveTo'](x + rr * Math.cos(a), y + rr * Math.sin(a)); }
    ctx.closePath(); ctx.fill();
    tag(t('scene.start'), x, y - r - 4, C.foam);
  }
  function tag(s, x, y, col, side) {
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    var w = ctx.measureText(s).width + 8;
    if (side === 'right') x -= w / 2;
    x = Math.max(L.gx + w / 2, Math.min(L.gx + L.gw - w / 2, x)); y = Math.max(L.gy + 16, Math.min(L.gy + L.gh, y));
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - w / 2, y - 15, w, 16);
    ctx.fillStyle = col; ctx.fillText(s, x, y);
  }
  function drawPatch(p) {
    ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = C.text; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cellX(p.cx), cellY(p.cy), p.ax * L.cs, p.ay * L.cs, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.restore();
  }
  function drawTraces(idx, traces, arrivals, tk, order, cursor) {
    var tr = L.tr;
    if (cursor >= 0) {
      var cx = tr.x + 28 + (tr.w - 30) * cursor / (PU.TICKS - 1);
      ctx.strokeStyle = rgba(C.foam, 0.7); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, tr.y); ctx.lineTo(cx, tr.y + idx.length * tr.rowH); ctx.stroke();
    }
    ctx.fillStyle = C.muted; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('scene.traces'), tr.x, tr.y - 4);
    idx.forEach(function (k, j) {
      var y0 = tr.y + j * tr.rowH, mid = y0 + tr.rowH / 2, lx = tr.x + 28, w = tr.w - 30, x;
      ctx.strokeStyle = rgba(C.line, 1); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx, mid); ctx.lineTo(lx + w, mid); ctx.stroke();
      ctx.fillStyle = order && order[j] ? C.goldB : C.muted; ctx.font = '700 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText('S' + (k + 1), tr.x, mid);
      if (!traces) return;
      var tr0 = traces[j], sc = 0.04;
      for (var i = 0; i < tr0.length; i++) sc = Math.max(sc, Math.abs(tr0[i]));
      var amp = tr.rowH * 0.45 / sc;
      ctx.strokeStyle = C.cyan; ctx.lineWidth = C.lw * 1.2; ctx.beginPath();
      for (var s = 0; s <= tk && s < tr0.length; s++) { x = lx + w * s / (PU.TICKS - 1); ctx[s ? 'lineTo' : 'moveTo'](x, mid - tr0[s] * amp); }
      ctx.stroke();
      var a = arrivals[j];
      if (a >= 0 && tk >= a) {
        x = lx + w * a / (PU.TICKS - 1);
        ctx.strokeStyle = C.goldB; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y0 + tr.rowH - 2); ctx.stroke();
      }
    });
  }
  function draw() {
    if (!L) return;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, cssW, cssH);
    ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillStyle = C.muted;
    if (mode === 'free') {
      if (freeSim) drawField(freeSim.frames, Math.floor(tick)); else drawCover();
      if (freePatchy) drawPatch(FREE_PATCH);
      drawSensors(PU.SENSOR_SETS[8], freeSim ? freeSim.arrivals : null, tick, null);
      if (freeSim) { drawTarget(freeSim.target); ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(t('scene.tick', { t: Math.floor(tick) }), L.gx, L.gy - 3); }
      drawTraces(PU.SENSOR_SETS[8], freeSim ? freeSim.traces : null, freeSim ? freeSim.arrivals : [], tick, null, -1);
      return;
    }
    if (!A) return;
    var tk = Math.floor(tick), order = arrivalOrder(), revealed = phase === 'reveal' || phase === 'revealed' || phase === 'end';
    if (revealed) drawField(A.sim.frames, tk); else drawCover();
    if (revealed && A.setting.floor === 'patchy') drawPatch(A.spec.patch);
    if ((hintOn && phase === 'guess') || revealed) drawRegion(revealed);
    drawSensors(A.sensors, A.arrivals, phase === 'guess' ? PU.TICKS : tk, order);
    if ((hintOn && phase === 'guess') || revealed) drawX(A.answers.locator, C.cyan, t('scene.loc'));
    if (revealed && entry) {
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.foam; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cellX(entry.guess[0]), cellY(entry.guess[1])); ctx.lineTo(cellX(A.target[0]), cellY(A.target[1])); ctx.stroke(); ctx.restore();
      drawRing(entry.guess, C.aqua, t('scene.you'));
      drawTarget(A.target);
    } else if (marker) drawRing(marker, C.aqua, t('scene.you'));
    ctx.fillStyle = C.muted; ctx.font = '600 12px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(t('scene.tick', { t: revealed ? tk : Math.min(tk, PU.TICKS - 1) }) + ' \u00B7 ' + t('kind.' + A.setting.kind), L.gx, L.gy - 3);
    if (phase === 'listen' || phase === 'idle' || (phase === 'guess' && !marker)) {
      var msg = phase === 'guess' ? t('scene.tap') : t('scene.covered');
      ctx.font = '700 ' + (phone ? 15 : 18) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var w = ctx.measureText(msg).width + 20;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(L.gx + L.gw / 2 - w / 2, L.gy + L.gh / 2 - 16, w, 32);
      ctx.fillStyle = C.text; ctx.fillText(msg, L.gx + L.gw / 2, L.gy + L.gh / 2);
    }
    drawTraces(A.sensors, phase === 'idle' ? null : A.traces, A.arrivals, revealed ? PU.TICKS : tk, order, revealed ? tk : -1);
  }
  /* ---------- animation ---------- */
  function loop(ts) {
    raf = 0;
    var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    var running = (mode === 'play' && (phase === 'listen' || phase === 'reveal')) || (mode === 'free' && !!freeSim && tick < PU.TICKS - 1);
    if (!running) { lastTs = 0; return; }
    var listening = mode === 'play' && phase === 'listen', stop = listening ? PU.TICKS - 1 : mode === 'play' ? REVEAL_END : PU.TICKS - 1;
    tick = Math.min(stop, tick + dt * (listening ? BASE_TPS : REVEAL_TPS) * speed);
    if (tick >= stop) {
      if (listening) { phase = 'guess'; renderAll(); }
      else if (mode === 'play' && phase === 'reveal') { phase = 'revealed'; renderAll(); }
    }
    draw(); renderStatus();
    if (tick < stop) raf = requestAnimationFrame(loop); else lastTs = 0;
  }
  function kick() { if (!raf) { lastTs = 0; raf = requestAnimationFrame(loop); } }
  /* ---------- game flow ---------- */
  function startRun(s, keepReplay) {
    seed = s; run = PU.createRun(seed); entry = null; marker = null;
    if (!keepReplay) replayCode = null;
    $('end').hidden = true;
    loadPulse(); setHash(); renderAll();
  }
  function loadPulse() {
    A = PU.preparePulse(run, run.log.length, CAL);
    if (REGION_CAL && REGION_CAL.calibrated && REGION_CAL.rhoBySetting) {
      var id = PU.settingId(A.setting);
      if (Object.prototype.hasOwnProperty.call(REGION_CAL.rhoBySetting, id)) {
        var rho = REGION_CAL.rhoBySetting[id];
        A.region = Number.isFinite(rho) ? PU.region(A.sensors, A.arrivals, CAL.c, rho, A.loc) : { cells: [], area: 0 };
        A.covered = Number.isFinite(rho) && PU.covers(A.sensors, A.arrivals, CAL.c, rho, A.loc, A.target);
      }
    }
    phase = 'idle'; tick = 0; marker = null; entry = null; resize();
  }
  function listen() {
    if (mode !== 'play' || phase !== 'idle') return;
    phase = 'listen'; tick = 0;
    if (reduce) { tick = PU.TICKS - 1; phase = 'guess'; }
    renderAll(); draw(); kick();
  }
  function setMarker(x, y) {
    if (mode !== 'play' || phase !== 'guess') return;
    marker = [Math.max(0, Math.min(PU.W - 1, Math.round(x * 2) / 2)), Math.max(0, Math.min(PU.H - 1, Math.round(y * 2) / 2))];
    renderAll(); draw();
  }
  function confirm() {
    if (mode !== 'play' || phase !== 'guess' || !marker) return;
    entry = PU.guess(run, A, marker[0], marker[1]);
    replayCode = PU.encodeRun(seed, run.log);
    phase = 'reveal'; tick = PU.PRE;
    if (reduce) { tick = PU.PRE + 45; phase = 'revealed'; }
    pop(entry.points);
    setHash(); renderAll(); draw(); kick();
  }
  function next() {
    if (mode !== 'play' || (phase !== 'revealed' && phase !== 'reveal')) return;
    if (PU.done(run)) { phase = 'end'; tick = REVEAL_END; renderAll(); draw(); $('end').hidden = false; return; }
    loadPulse(); renderAll();
  }
  function pop(p) {
    var el = $('pop');
    el.className = 'pop'; void el.offsetWidth;
    text(el, '+' + p);
    el.className = 'pop show ' + (p >= 80 ? 'good' : p >= 40 ? 'meh' : 'bad');
  }
  /* ---------- free waves ---------- */
  function freeWave(sp, kind) {
    var floor = freePatchy ? 'patchy' : 'even';
    sp.patch = FREE_PATCH;
    var sim = PU.simulate(sp, kind, floor, true), idx = PU.SENSOR_SETS[8];
    freeSim = { frames: sim.frames, target: PU.target(sp, kind), kind: kind,
      traces: idx.map(function (k) { return sim.clean[k]; }), arrivals: idx.map(function (k) { return PU.detectClean(sim.clean[k], CAL.k * PU.NOISE.calm); }) };
    tick = reduce ? PU.PRE + 45 : PU.PRE;
    renderStatus(); draw(); kick();
  }
  function freeAt(x, y) { freeWave({ x: Math.max(1, Math.min(PU.W - 2, x)), y: Math.max(1, Math.min(PU.H - 2, y)), bumps: [] }, 'win'); }
  function setMode(m) {
    mode = m;
    $('mode-play').setAttribute('aria-pressed', m === 'play' ? 'true' : 'false');
    $('mode-free').setAttribute('aria-pressed', m === 'free' ? 'true' : 'false');
    $('play-controls').hidden = m !== 'play'; $('free-controls').hidden = m !== 'free';
    if (m === 'free') { freeSim = null; tick = 0; } else tick = phase === 'listen' ? tick : phase === 'idle' ? 0 : phase === 'guess' ? PU.TICKS - 1 : REVEAL_END;
    resize(); renderAll();
    if (m === 'play' && phase === 'listen') kick();
  }
  /* ---------- rendering of the text parts ---------- */
  function statusText() {
    if (mode === 'free') return freeSim ? t('status.freeplay', { x: num(freeSim.target[0]), y: num(freeSim.target[1]), t: Math.floor(tick), T: PU.TICKS - 1 }) : t('status.free');
    if (phase === 'end') { var s = PU.summarize(run.log); return t('status.done', { p: s.points, l: s.locator }); }
    if (phase === 'idle') return t('status.idle', { i: run.log.length + 1, n: PU.TOTAL });
    if (phase === 'listen') return t('status.listen', { t: Math.floor(tick), T: PU.TICKS - 1 });
    if (phase === 'guess') return marker ? t('status.guessed', { x: num(marker[0]), y: num(marker[1]) }) : t('status.guess');
    var msg = t('status.reveal', { e: num(entry.err), p: entry.points, le: num(entry.locator.err), lp: entry.locator.points });
    return entry.fallback ? msg + ' ' + t('status.fallback') : msg;
  }
  function renderStatus() {
    var s = statusText();
    if ($('status').textContent !== s) text($('status'), s);
    canvas.setAttribute('aria-label', t('scene.aria', { s: s }));
    var el = $('arrivals');
    if (mode === 'free' || !A || phase === 'idle') { text(el, ''); return; }
    var lim = phase === 'listen' ? Math.floor(tick) : PU.TICKS, parts = [];
    A.sensors.forEach(function (k, j) {
      var a = A.arrivals[j];
      if (a >= 0 && a <= lim) parts.push('S' + (k + 1) + ' ' + a);
      else if (phase !== 'listen') parts.push('S' + (k + 1) + ' ' + t('arr.miss'));
    });
    text(el, parts.length ? t('arr.label') + ' ' + parts.join(' \u00B7 ') : t('arr.none'));
  }
  function renderHud() {
    var s = PU.summarize(run.log), stage = A ? PU.STAGES[A.stage] : null;
    text($('hud-pulse'), mode === 'free' ? '\u2013' : t('hud.pulse.v', { i: Math.min(PU.TOTAL, run.log.length + (phase === 'idle' || phase === 'listen' || phase === 'guess' ? 1 : 0)), n: PU.TOTAL }));
    text($('hud-stage'), mode === 'free' ? t('stage.free') : stage ? t('stage.' + stage.id) : '');
    text($('hud-points'), String(s.points));
    text($('hud-locator'), String(s.locator));
    var b = mode === 'free' ? t('banner.free') : stage ? t('banner.' + stage.id) : '';
    if (!CAL.calibrated) b += ' ' + t('banner.nocalib');
    if (!REGION_CAL || !REGION_CAL.calibrated) b += ' ' + t('banner.noregion');
    else if (A && REGION_CAL.rhoBySetting && Object.prototype.hasOwnProperty.call(REGION_CAL.rhoBySetting, PU.settingId(A.setting)) && REGION_CAL.rhoBySetting[PU.settingId(A.setting)] === null) b += ' ' + t('banner.regionfit');
    text($('banner'), b);
  }
  function renderControls() {
    var go = $('btn-go');
    if (phase === 'idle') { text(go, t('btn.listen')); go.disabled = false; }
    else if (phase === 'listen') { text(go, t('btn.listening')); go.disabled = true; }
    else if (phase === 'guess') { text(go, t('btn.listening')); go.disabled = true; }
    else if (phase === 'reveal' || phase === 'revealed') { text(go, PU.done(run) ? t('btn.finish') : t('btn.next')); go.disabled = false; }
    else { text(go, t('btn.next')); go.disabled = true; }
    $('btn-confirm').disabled = !(phase === 'guess' && marker);
    $('hint').checked = hintOn;
  }
  function renderLog() {
    var tb = $('log').querySelector('tbody');
    clear(tb);
    run.log.forEach(function (e) {
      var tr = document.createElement('tr');
      [String(e.i + 1), t('kind.' + e.setting.kind), num(e.err), String(e.points), num(e.locator.err), String(e.locator.points)].forEach(function (v, c) {
        var td = document.createElement('td'); td.textContent = v;
        if (c === 3) td.className = e.points >= e.locator.points ? 'good' : '';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    $('log-empty').hidden = run.log.length > 0;
  }
  function renderEnd() {
    if (phase !== 'end') { $('end').hidden = true; return; }
    $('end').hidden = false;
    var s = PU.summarize(run.log), log = run.log, tb = $('end-table').querySelector('tbody');
    var hits = function (k) { return log.filter(function (e) { return e[k].err <= PU.HIT; }).length; };
    var merr = function (k) { return log.reduce(function (a, e) { return a + e[k].err; }, 0) / log.length; };
    clear(tb);
    [['who.you', s.points, s.hits, s.meanErr, true], ['who.locator', s.locator, s.locHits, s.meanLocErr],
      ['who.early', s.early, hits('early'), merr('early')], ['who.center', s.center, hits('center'), merr('center')]].forEach(function (r) {
      var tr = document.createElement('tr'); if (r[4]) tr.className = 'you';
      [t(r[0]), String(r[1]), r[2] + ' / ' + log.length, num(r[3])].forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    text($('end-rank'), t('end.rank.' + PU.rank(s)));
    text($('end-note'), t('end.note'));
    var code = PU.encodeRun(seed, log);
    text($('end-code'), code);
    $('end-link').setAttribute('href', location.pathname + PU.buildHash({ seed: seed, lang: lang, replay: code }));
    text($('share'), PU.shareText({ seed: seed, summary: s, log: log, code: code }, t));
  }
  function renderVerify() {
    var sec = $('verify');
    if (!verifyRes) { sec.hidden = true; return; }
    sec.hidden = false;
    sec.classList.toggle('bad', !verifyRes.ok);
    text($('verify-msg'), verifyRes.ok ? t('verify.ok', { seed: hash.seed, p: verifyRes.summary.points, n: verifyRes.summary.pulses })
      : t('verify.bad', { seed: hash.seed, why: t('verify.why.' + verifyRes.error) }));
  }
  function renderAll() {
    renderHud(); renderControls(); renderStatus(); renderLog(); renderEnd(); renderVerify();
    text($('seed-line'), t('seed.line', { seed: seed }));
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    text(document.querySelector('[data-i18n="how.p2"]'), t('how.p2', { k: CAL.k }));
    document.title = t('page.title');
    document.querySelector('.hud').setAttribute('aria-label', t('sec.game'));
    text($('footer-version'), 'pulse regions 0.3.5 / engine ' + PU.VERSION + ' / arena ' + G.BUILD);
    setHash(); renderAll(); draw();
  }
  /* ---------- input ---------- */
  function gridPoint(ev) {
    var r = canvas.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (px < L.gx || py < L.gy || px > L.gx + L.gw || py > L.gy + L.gh) return null;
    return [(px - L.gx) / L.cs - 0.5, (py - L.gy) / L.cs - 0.5];
  }
  canvas.addEventListener('click', function (ev) {
    var p = gridPoint(ev);
    if (!p) return;
    if (mode === 'free') freeAt(p[0], p[1]);
    else setMarker(p[0], p[1]);
  });
  $('btn-go').addEventListener('click', function () { if (phase === 'idle') listen(); else next(); });
  $('btn-confirm').addEventListener('click', confirm);
  $('hint').addEventListener('change', function () { hintOn = this.checked; draw(); });
  $('speed').addEventListener('change', function () { speed = +this.value || 2; });
  $('mode-play').addEventListener('click', function () { setMode('play'); });
  $('mode-free').addEventListener('click', function () { setMode('free'); });
  $('free-win').addEventListener('click', function () {
    var sp = PU.spec('free-' + (++freeN) + '-' + seed); freeWave({ x: sp.x, y: sp.y, bumps: [] }, 'win');
  });
  $('free-cheer').addEventListener('click', function () { freeWave(PU.spec('free-' + (++freeN) + '-' + seed), 'cheer'); });
  $('free-patchy').addEventListener('change', function () { freePatchy = this.checked; draw(); });
  $('btn-again').addEventListener('click', function () { setMode('play'); startRun(seed); });
  $('btn-today').addEventListener('click', function () { setMode('play'); startRun(today); });
  $('btn-new').addEventListener('click', function () { setMode('play'); startRun('p' + Math.floor(Math.random() * 1e9).toString(36)); });
  $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); });
  $('btn-contrast').addEventListener('click', function () {
    hc = !hc;
    document.documentElement.classList.toggle('hc', hc);
    this.setAttribute('aria-pressed', hc ? 'true' : 'false');
    readColors(); draw();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    var tag = ev.target && ev.target.tagName, key = ev.key;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ((key === ' ' || key === 'Enter') && (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY')) return;
    if (mode !== 'play') return;
    var step = ev.shiftKey ? 2 : 0.5, m = marker || [PU.CENTER[0], PU.CENTER[1]];
    if (phase === 'guess' && /^Arrow/.test(key)) {
      if (key === 'ArrowLeft') setMarker(m[0] - step, m[1]);
      else if (key === 'ArrowRight') setMarker(m[0] + step, m[1]);
      else if (key === 'ArrowUp') setMarker(m[0], m[1] - step);
      else setMarker(m[0], m[1] + step);
      ev.preventDefault();
    } else if (key === 'Enter' && phase === 'guess') { confirm(); ev.preventDefault(); }
    else if (key === ' ') { if (phase === 'idle') listen(); else if (phase === 'reveal' || phase === 'revealed') next(); ev.preventDefault(); }
    else if (key === 'h' || key === 'H') { hintOn = !hintOn; renderControls(); draw(); }
  });
  window.addEventListener('resize', resize);
  if (reduce) { speed = 4; $('speed').value = '4'; }
  // read-only state for the headless-browser check
  window.WavePulseState = function () {
    return { mode: mode, phase: phase, tick: tick, idx: run.log.length, marker: marker, hint: hintOn, calibrated: !!CAL.calibrated, regionCalibrated: !!(REGION_CAL && REGION_CAL.calibrated),
      points: PU.summarize(run.log).points, locatorPoints: PU.summarize(run.log).locator,
      log: run.log.map(function (e) { return { points: e.points, err: e.err, locPoints: e.locator.points, kind: e.setting.kind }; }),
      grid: L ? { x: L.gx, y: L.gy, cs: L.cs } : null, setting: A ? A.setting : null, arrivals: A ? A.arrivals.slice() : null,
      target: A && (phase === 'reveal' || phase === 'revealed' || phase === 'end') ? A.target : null, region: A ? A.region.cells.length : 0,
      free: freeSim ? { target: freeSim.target, kind: freeSim.kind } : null, replay: replayCode,
      verify: verifyRes ? { ok: verifyRes.ok, error: verifyRes.error || null, points: verifyRes.ok ? verifyRes.summary.points : null } : null };
  };
  readColors();
  startRun(seed, true);
  applyLang();
  resize();
})();
