/*
 * Membrane Arena: UI controller (SYNTHETIC classical simulation).
 * Wires the DOM to ArenaGame (logic) and ArenaScene (canvas). No network.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var G = ArenaGame, S = ArenaScene, I = ArenaI18n, B = ArenaBaselines, C = ArenaCharts, LU = ArenaLabUI;
  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'membrane-arena/v1';

  var lang = 'en', t = I.make('en');
  var store = G.sanitizeStore(null), storeOk = true;
  var seedInfo = null;                 // { seed, date, mode: 'daily' | 'practice' | 'challenge', best, preset }
  var contest = null, mode = 'idle';   // idle | running | paused | done
  var stepOnce = false, atBoundary = false, lessonIdx = 0, lastResult = null, counted = false;
  var doneT = 0, doneF = 0, curT = 0, curF = 0, curRec = null, shownEp = -1, pendingNote = false, tickerMsg = '';
  var arena = null, lastTs = 0, sysReduced = false, hc = false, still = false, labui = null, tutIdx = 0;
  var replayIdx = 0, replaying = false, descKey = '', TOTAL = S.TOTAL_STEPS, REPLAY_RATE = 240;
  function reducedNow() { return sysReduced || still; }

  /* ---------- storage, defensive ---------- */

  function loadStore() {
    try { return G.sanitizeStore(JSON.parse(window.localStorage.getItem(STORE_KEY))); }
    catch (e) { try { window.localStorage.getItem('x'); } catch (e2) { storeOk = false; } return G.sanitizeStore(null); }
  }
  function saveStore() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { storeOk = false; $('store-warn').hidden = false; }
  }

  /* ---------- text ---------- */

  function applyI18n() {
    document.documentElement.lang = lang;
    document.title = t('app.pagetitle');
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $('btn-lang').textContent = t('btn.lang');
    $('btn-lang').setAttribute('lang', lang === 'en' ? 'fr' : 'en');
    $('arena').setAttribute('aria-label', t('stage.aria'));
    $('fit').setAttribute('aria-label', t('fit.aria'));
    $('sci').setAttribute('aria-label', t('sci.aria'));
    $('ribbon').setAttribute('aria-label', t('hud.ribbon'));
    $('footer-version').textContent = t('footer.version', { v: G.BUILD });
    $('rail').setAttribute('aria-label', t('replay.rail_aria')); $('replay-pos').setAttribute('aria-label', t('replay.pos'));
    buildSchemeOptions();
    for (var i = 0; i < 3; i++) $('m-gain-' + i).setAttribute('aria-label', t('meters.gain', { m: 'ABC'.charAt(i) }));
    $('m-rate').setAttribute('aria-label', t('meters.rate'));
    renderMode(); renderControls(); renderCfgNote(); renderStats(); renderHud(); renderMeters(curRec); renderRibbon(); renderTutorial(); renderReplay();
    if (labui) labui.relabel();
    if (!contest || mode === 'idle') setTicker(t('hud.idle'));
    if (lastResult && mode === 'done') renderResult();
    drawCharts();
  }

  // the options are created once (so a preset can select one before the first render) and relabelled on a language change
  function buildSchemeOptions() {
    var sel = $('scheme');
    if (sel.options.length !== G.SCHEMES.length) {
      sel.innerHTML = '';
      G.SCHEMES.forEach(function (s) { var o = document.createElement('option'); o.value = s; sel.appendChild(o); });
      sel.value = G.DEFAULTS.scheme;
    }
    G.SCHEMES.forEach(function (s, i) { sel.options[i].textContent = t('scheme.' + s); });
  }

  function setTicker(msg) { tickerMsg = msg; $('ticker').textContent = msg; }
  function announce(msg) { $('sr-live').textContent = msg; }
  function say(msg, always) { setTicker(msg); if (always || (arena && arena.state().speed <= 2)) announce(msg); }
  function r1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function r2(x) { return (Math.round(x * 100) / 100).toFixed(2); }

  /* ---------- seed and mode ---------- */

  function today() { return G.localDateString(new Date()); }
  function newSeedInfo(kind, seed, extra) {
    var d = G.seedDate(seed);
    seedInfo = { seed: seed, date: d, mode: kind, best: null, preset: null };
    if (extra) { seedInfo.best = extra.best; seedInfo.preset = extra.preset; }
    var st = G.startFor(seed);
    setSlider('th', st.th); setSlider('c', st.c); setSlider('g', st.g);
    if (seedInfo.preset) applyPreset(seedInfo.preset);
    resetRun();
    renderMode(); renderCfgNote();
  }
  function startDaily() { var d = today(); newSeedInfo('daily', G.dailySeed(d)); }
  function startPractice() { newSeedInfo('practice', 'p' + Math.floor(Math.random() * 2176782336).toString(36)); }
  function applyHash() {
    var h = G.parseHash(window.location.hash);
    if (h.lang && I.supported.indexOf(h.lang) >= 0 && h.lang !== lang) { lang = h.lang; t = I.make(lang); }
    if (h.mode === 'challenge') newSeedInfo('challenge', h.seed, { best: h.best, preset: h.preset });
    else startDaily();
    applyI18n();
  }
  function renderMode() {
    if (!seedInfo) return;
    var txt;
    if (seedInfo.mode === 'daily') txt = t('mode.daily', { day: G.dayNumber(seedInfo.date), date: seedInfo.date });
    else if (seedInfo.mode === 'challenge') txt = seedInfo.best !== null ? t('mode.challenge_best', { best: seedInfo.best, seed: seedInfo.seed }) : t('mode.challenge', { seed: seedInfo.seed });
    else txt = t('mode.practice', { seed: seedInfo.seed });
    $('mode-line').textContent = txt;
    var rec = seedInfo.mode === 'daily' ? store.daily[seedInfo.date] : null;
    $('daily-done').hidden = !rec;
    if (rec) $('daily-done').textContent = t('daily.done', { score: Math.round(rec.score) });
  }

  /* ---------- controls ---------- */

  function setSlider(id, v) { var el = $(id); el.value = String(v); renderOutput(id); }
  function renderOutput(id) {
    var el = $(id), v = Number(el.value);
    $(id + '-val').textContent = id === 'w' ? Math.round(v * 100) + '%' : r2(v);
  }
  function readSettings() {
    return G.sanitizeSettings({
      scheme: $('scheme').value, w: Number($('w').value), shield: $('t-shield').checked, amp: $('t-amp').checked, stab: $('t-stab').checked,
      evolve: $('t-evolve').checked, fcost: Number($('fcost').value), th: Number($('th').value), c: Number($('c').value), g: Number($('g').value)
    });
  }
  function applyPreset(p) {
    $('scheme').value = p.scheme; setSlider('w', p.w);
    $('t-shield').checked = p.shield; $('t-amp').checked = p.amp; $('t-stab').checked = p.stab;
  }
  function renderControls() {
    ['w', 'th', 'c', 'g', 'fcost'].forEach(renderOutput);
    var locked = mode === 'running' || mode === 'paused';
    ['th', 'c', 'g', 'btn-defaults'].forEach(function (id) { $(id).disabled = locked; });
    $('adv-locked').hidden = !locked;
    var run = $('btn-run');
    run.textContent = mode === 'running' ? t('btn.pause') : mode === 'paused' ? t('btn.resume') : mode === 'done' ? t('btn.again') : t('btn.run');
    $('btn-step').disabled = mode === 'done';
    $('btn-finish').disabled = mode === 'done';
    $('btn-motion').textContent = t(still ? 'btn.motion_off' : 'btn.motion_on'); $('btn-motion').setAttribute('aria-pressed', still ? 'false' : 'true');
    $('btn-contrast').textContent = t(hc ? 'btn.contrast_on' : 'btn.contrast_off'); $('btn-contrast').setAttribute('aria-pressed', hc ? 'true' : 'false');
    $('hud-pending').hidden = !(pendingNote && locked);
  }
  function applySettings(o) {
    $('scheme').value = o.scheme; setSlider('w', o.w); setSlider('fcost', o.fcost);
    $('t-shield').checked = !!o.shield; $('t-amp').checked = !!o.amp; $('t-stab').checked = !!o.stab; $('t-evolve').checked = !!o.evolve;
    onControlChange();
  }
  function renderCfgNote() {
    var s = readSettings(), b = G.baselineFor(s);
    $('cfg-note').textContent = b ? t('cfg.measured', { tag: b.tag, w: b.w }) : t('cfg.unmeasured');
  }
  function onControlChange() {
    renderControls(); renderCfgNote();
    if (mode === 'running' || mode === 'paused') { pendingNote = true; $('hud-pending').hidden = false; }
  }

  /* ---------- HUD, ribbon, meters ---------- */

  function renderHud() {
    var T = doneT + curT, F = doneF + curF, hist = contest ? contest.hist : [];
    var gen = contest ? Math.min(G.GENS, curRec ? curRec.gen + 1 : contest.gen) : 0;
    $('hud-gen').textContent = contest && contest.hist.length ? t('hud.gen', { g: gen, max: G.GENS }) : t('hud.gen', { g: 0, max: G.GENS });
    $('hud-true').textContent = String(T); $('hud-false').textContent = String(F);
    $('hud-prec').textContent = T + F > 0 ? Math.round(100 * T / (T + F)) + '%' : '-';
    var done = hist.slice(0, mode === 'done' ? hist.length : Math.max(0, hist.length - (curRec && mode !== 'done' ? 1 : 0)));
    $('hud-score').textContent = done.length ? String(Math.round(G.summarize(done).score)) : '-';
    var pos = arena && arena.position(), rp = mode === 'done' && !$('replay').hidden ? S.indexToPos(replayIdx) : null;
    if (rp) $('hud-gen').textContent = t('hud.gen', { g: rp.gen + 1, max: G.GENS });
    $('hud-ep').textContent = t('hud.ep', { e: rp ? rp.ep + 1 : pos ? pos.ep + 1 : 0, max: G.EP });
  }
  var ribbonState = [];
  function renderRibbon() {
    var ol = $('ribbon');
    if (ol.children.length !== G.EP) { ol.innerHTML = ''; for (var k = 0; k < G.EP; k++) ol.appendChild(document.createElement('li')); }
    for (var i = 0; i < G.EP; i++) {
      var li = ol.children[i], st = ribbonState[i];
      li.className = st ? st.cls : '';
      li.textContent = st ? st.sym : '\u00b7';
      var label = t('stats.none') && (t('hud.ep', { e: i + 1, max: G.EP }) + ': ' + (st ? st.label : t('ribbon.pending')));
      li.setAttribute('aria-label', label); li.title = label;
      if (i === shownEp && mode !== 'done') li.classList.add('cur');
    }
  }
  function renderMeters(rec) {
    var stab = rec ? rec.settings.stab : $('t-stab').checked;
    for (var i = 0; i < 3; i++) {
      var g = rec ? rec.params[i].g : Number($('g').value), eff = rec ? rec.geff[i] : g, el = $('m-gain-' + i);
      $('m-fill-' + i).style.width = Math.min(100, g / 3.2 * 100) + '%';
      $('m-eff-' + i).style.left = 'calc(' + Math.min(100, eff / 3.2 * 100) + '% - 1.5px)';
      el.setAttribute('aria-valuenow', r2(g));
      el.setAttribute('aria-valuetext', r2(g) + ', ' + t('meters.eff') + ' ' + r2(eff) + (rec && rec.clamped[i] ? ', ' + t('meters.clamp') : ''));
      el.classList.toggle('off', !stab); el.classList.toggle('clamped', !!(rec && rec.clamped[i]));
      $('m-val-' + i).textContent = r2(g) + ' / ' + t('meters.eff_short') + ' ' + r2(eff) + (rec && rec.clamped[i] ? ' (' + t('meters.clamp') + ')' : '');
    }
    var rate = rec ? rec.rateEma : G.TARGET;
    $('m-rate-fill').style.width = Math.min(100, rate * 100) + '%';
    $('m-rate').setAttribute('aria-valuenow', r2(rate));
    $('m-rate-val').textContent = r2(rate);
    $('m-state').textContent = t(stab ? 'meters.stab_on' : 'meters.stab_off');
  }
  function doneHist() {
    var hist = contest ? contest.hist : [];
    return curRec && mode !== 'done' ? hist.slice(0, -1) : hist;
  }
  function drawFit() { try { S.drawFitness($('fit'), doneHist(), G.GENS); } catch (e) { /* decoration */ } }
  function drawSci() {
    try {
      var b = G.baselineFor(readSettings());
      S.drawScience($('sci'), doneHist(), G.GENS, b ? b.row : null);
      $('sci-base').textContent = b ? t('cfg.measured', { tag: b.tag, w: b.w }) + ' ' + b.file : t('sci.nobase');
    } catch (e) { /* decoration */ }
  }
  function drawCharts() {
    if (!labui) return;
    if (labui.activeTab() === 'meters') drawFit(); else labui.refresh();
    drawRail();
  }

  /* ---------- arena text equivalent, replay, motion and contrast ---------- */

  function renderArenaDesc(snap) {
    var el = $('arena-desc');
    if (!snap) { if (descKey !== 'none') { el.textContent = t('stage.aria'); descKey = 'none'; } return; }
    var key = snap.gen + ':' + snap.ep + ':' + snap.step + ':' + lang;
    if (key === descKey) return;
    descKey = key;
    var parts = [0, 1, 2].map(function (i) {
      var m = 'ABC'.charAt(i), en = Math.round(snap.energy[i] * 100);
      if (snap.declared[i]) return t(snap.truth[i] ? 'arena.m_decl_true' : 'arena.m_decl_false', { m: m });
      if (snap.align[i] === null && !snap.planted) return t('arena.m_run_noise', { m: m, en: en });
      return t('arena.m_run', { m: m, en: en, al: snap.align[i] === null ? '-' : r2(snap.align[i]) });
    });
    el.textContent = t('arena.desc', { g: snap.gen, e: snap.ep, kind: t(snap.planted ? 'arena.kind_planted' : 'arena.kind_noise'), s: snap.step, a: parts[0], b: parts[1], c: parts[2] });
  }
  function drawRail() {
    if ($('replay').hidden || !contest) return;
    try { C.drawRail($('rail'), contest.hist, replayIdx, { hc: hc }); } catch (e) { /* decoration */ }
  }
  function renderReplay() {
    $('btn-replay-play').textContent = t(replaying ? 'replay.pause' : 'replay.play');
    $('btn-replay-play').setAttribute('aria-pressed', replaying ? 'true' : 'false');
    var p = S.indexToPos(replayIdx);
    $('replay-text').textContent = t('replay.value', { g: p.gen + 1, e: p.ep + 1, s: p.step });
    $('replay-pos').setAttribute('aria-valuetext', t('replay.value', { g: p.gen + 1, e: p.ep + 1, s: p.step }));
    if (contest && !$('replay').hidden) {
      var d = 0, tr = 0, fl = 0, out = 0;
      contest.hist.forEach(function (h) { h.episodes.forEach(function (ep) { for (var i = 0; i < 3; i++) if (ep.declStep[i] !== null) { d++; if (ep.truth[i]) tr++; else fl++; } out += ep.outs.length; }); });
      $('replay-alt').textContent = t('replay.alt', { d: d, t: tr, f: fl, p: out });
    }
  }
  function setReplayIdx(i) {
    if (!contest || !contest.hist.length) return;
    replayIdx = Math.max(0, Math.min(TOTAL, Math.round(i)));
    var p = S.indexToPos(replayIdx), rec = contest.hist[Math.min(p.gen, contest.hist.length - 1)];
    $('replay-pos').value = String(replayIdx);
    if (arena && rec) { arena.showAt(rec, p.ep, p.step, rec.settings); renderArenaDesc(arena.snapshot()); }
    renderReplay(); drawRail(); renderHud();
  }
  function stopReplay() { replaying = false; renderReplay(); }
  function onReplayPlay() {
    if (replaying) { stopReplay(); return; }
    if (replayIdx >= TOTAL) replayIdx = 0;
    replaying = true; renderReplay();
  }
  function applyMotion() {
    document.documentElement.classList.toggle('still', still);
    if (arena) arena.setReduced(reducedNow());
  }
  function applyContrast() {
    document.documentElement.classList.toggle('hc', hc);
    if (arena) arena.setContrast(hc);
    drawCharts(); if (labui) labui.refresh();
  }

  /* ---------- intro and tutorial ---------- */

  function startIntro() {
    if (!arena) return false;
    return arena.playIntro({ title: t('app.title'), sub: t('intro.sub'), done: function () { store.introSeen = true; saveStore(); } });
  }
  function skipIntro() { if (arena && arena.stats().intro) arena.skipIntro(); }
  function renderTutorial() {
    var open = !$('tutorial').hidden;
    if (!open) return;
    var max = 5;
    $('tut-step').textContent = t('tut.step', { n: tutIdx + 1, max: max });
    var key = 'tut.s' + (tutIdx + 1);
    $('tut-text').textContent = t(key);
    $('btn-tut-next').textContent = t(tutIdx + 1 >= max ? 'tut.done' : 'tut.next');
  }
  function openTutorial() { tutIdx = 0; $('tutorial').hidden = false; renderTutorial(); }
  function closeTutorial() {
    var had = $('tutorial').contains(document.activeElement);
    $('tutorial').hidden = true;
    if (had) $('btn-run').focus();       // a hidden button must not keep the focus
    if (!store.tutorialSeen) { store.tutorialSeen = true; saveStore(); }
  }
  function nextTutorial() { if (tutIdx + 1 >= 5) { closeTutorial(); return; } tutIdx++; renderTutorial(); }

  /* ---------- the contest loop ---------- */

  function resetRun() {
    contest = null; mode = 'idle'; atBoundary = false; curRec = null; doneT = doneF = curT = curF = 0; ribbonState = []; shownEp = -1; stepOnce = false;
    pendingNote = false; lastResult = null;
    if (arena) { arena.clearGeneration(); arena.setPlaying(false); }
    $('s-result').hidden = true;
    renderControls(); renderHud(); renderRibbon(); renderMeters(null); setTicker(t('hud.idle')); announce('');
    stopReplay(); $('replay').hidden = true; if (arena) arena.leaveScrub(); descKey = ''; replayIdx = 0; renderArenaDesc(null);
    drawCharts();
  }
  function beginRun() {
    var d = today();
    if (seedInfo.mode === 'daily' && seedInfo.date !== d) { startDaily(); }
    resetRun();
    counted = seedInfo.mode === 'daily' && !store.daily[seedInfo.date];
    contest = G.createContest(seedInfo.seed, readSettings());
    mode = 'running';
    say(t('say.start'), true);
    nextGeneration();
  }
  function nextGeneration() {
    var s = readSettings();
    curRec = G.stepGeneration(contest, s);
    curT = curF = 0; ribbonState = []; shownEp = -1; pendingNote = false;
    if (arena) { arena.setGeneration(curRec, s); arena.setPlaying(mode === 'running'); }
    renderMeters(curRec); renderRibbon(); renderHud(); renderControls();
  }
  function onOut(e) {
    var rec = curRec, ep = rec.episodes[e.ep], st;
    if (e.shield && e.passed === null && e.dropped) st = { cls: 'h', sym: 'H', label: t('ribbon.held') };
    else if (e.evF > 0) st = { cls: 'f', sym: 'F', label: t('ribbon.false') };
    else if (e.evT > 0) st = { cls: 't', sym: 'T', label: t('ribbon.true') };
    else st = { cls: '', sym: '-', label: t('ribbon.none') };
    st.cls += (st.cls ? ' ' : '') + (ep.planted ? 'planted' : 'noise');
    st.label = t(ep.planted ? 'ribbon.planted' : 'ribbon.noise') + ', ' + st.label;
    ribbonState[e.ep] = st;
    curT += e.evT; curF += e.evF;
    var g = rec.gen + 1, n = e.ep + 1;
    if (e.shield && e.dropped && e.passed === null) say(t('say.held', { g: g, e: n }));
    else { if (e.evT > 0) say(t('say.true', { g: g, e: n })); if (e.evF > 0) say(t('say.false', { g: g, e: n })); }
    renderRibbon(); renderHud();
  }
  function onGenEnd() {
    var rec = curRec, dropped = 0;
    rec.episodes.forEach(function (ep) { if (ep.dropped) dropped++; });
    doneT += rec.outT; doneF += rec.outF; curT = curF = 0;
    say(t('say.gen', { g: rec.gen + 1, t: rec.outT, f: rec.outF, d: dropped }), true);
    var h = contest.hist; curRec = null;
    renderHud(); drawCharts();
    curRec = rec;
    if (G.done(contest)) { finish(); return; }
    if (stepOnce) { stepOnce = false; atBoundary = true; mode = 'paused'; if (arena) arena.setPlaying(false); curRec = rec; renderControls(); announce(t('say.paused')); return; }
    nextGeneration();
  }
  function frame(ts) {
    var dt = lastTs ? (ts - lastTs) / 1000 : 0.016;
    lastTs = ts;
    if (arena) {
      try {
        if (replaying) { replayIdx += dt * REPLAY_RATE; if (replayIdx >= TOTAL) { replayIdx = TOTAL; replaying = false; } setReplayIdx(replayIdx); }
        var fired = arena.update(dt);
        for (var k = 0; k < fired.length; k++) {
          if (fired[k].type === 'out') onOut(fired[k]);
          else if (fired[k].type === 'gen') { onGenEnd(); break; }
        }
        var pos = arena.position();
        if (pos && mode !== 'done' && pos.ep !== shownEp) { shownEp = pos.ep; renderRibbon(); renderHud(); renderArenaDesc(arena.snapshot()); }
        arena.draw();
      } catch (e) { arena = null; showCanvasError(); }
    }
    window.requestAnimationFrame(frame);
  }
  function showCanvasError() { $('canvas-msg').hidden = false; $('canvas-msg').textContent = t('err.canvas'); }

  // leave a pause: at a generation boundary the next generation starts, otherwise the current one carries on
  function resume() {
    mode = 'running';
    if (atBoundary) { atBoundary = false; nextGeneration(); } else if (arena) arena.setPlaying(true);
    renderControls();
  }
  function onRun() {
    skipIntro();
    if (mode === 'running') { mode = 'paused'; if (arena) arena.setPlaying(false); announce(t('say.paused')); renderControls(); return; }
    if (mode === 'paused') { resume(); return; }
    if (mode === 'done') resetRun();
    beginRun();
    if (!arena) onFinish();
  }
  function onStep() {
    if (mode === 'idle' || mode === 'done') { if (mode === 'done') resetRun(); stepOnce = true; beginRun(); if (!arena) onFinish(); return; }
    stepOnce = true;
    if (mode === 'paused') resume();
  }
  function onFinish() {
    if (mode === 'done') return;
    if (mode === 'idle') { if (seedInfo.mode === 'daily' && seedInfo.date !== today()) startDaily(); counted = seedInfo.mode === 'daily' && !store.daily[seedInfo.date]; contest = G.createContest(seedInfo.seed, readSettings()); }
    var s = readSettings();
    while (!G.done(contest)) G.stepGeneration(contest, s);
    curRec = null;
    var sum = G.summarize(contest.hist);
    doneT = sum.T; doneF = sum.F; curT = curF = 0;
    var last = contest.hist[contest.hist.length - 1];
    ribbonState = [];
    last.episodes.forEach(function (ep, i) {
      var held = last.shield && ep.dropped;
      ribbonState[i] = { cls: (held ? 'h' : ep.evF > 0 ? 'f' : ep.evT > 0 ? 't' : '') + ' ' + (ep.planted ? 'planted' : 'noise'), sym: held ? 'H' : ep.evF > 0 ? 'F' : ep.evT > 0 ? 'T' : '-',
        label: t(ep.planted ? 'ribbon.planted' : 'ribbon.noise') + ', ' + (held ? t('ribbon.held') : ep.evF > 0 ? t('ribbon.false') : ep.evT > 0 ? t('ribbon.true') : t('ribbon.none')) };
    });
    renderMeters(last);
    if (arena) { arena.clearGeneration(); arena.setPlaying(false); }
    finish();
  }
  function finish() {
    mode = 'done'; curRec = null;
    var sum = G.summarize(contest.hist);
    lastResult = sum;
    var s = readSettings(), score = Math.round(sum.score);
    if (counted) {
      store.daily[seedInfo.date] = { score: sum.score, T: sum.T, F: sum.F, precision: sum.precision, tag: G.cfgTag(contest.hist[contest.hist.length - 1].settings) };
      if (store.bestDaily === null || sum.score > store.bestDaily) store.bestDaily = sum.score;
    } else if (seedInfo.mode !== 'daily' && (store.bestPractice === null || sum.score > store.bestPractice)) store.bestPractice = sum.score;
    var lastSet = contest.hist[contest.hist.length - 1].settings;
    if (store.bestScheme[lastSet.scheme] === undefined || sum.score > store.bestScheme[lastSet.scheme]) store.bestScheme[lastSet.scheme] = sum.score;
    saveStore();
    lessonIdx = G.LESSON_IDS.indexOf(G.pickLesson(contest.hist[contest.hist.length - 1].settings, seedInfo.seed));
    renderControls(); renderHud(); renderMode(); renderStats(); renderRibbon(); drawCharts();
    renderResult();
    $('s-result').hidden = false;
    $('replay').hidden = false; setReplayIdx(TOTAL);
    var bl = G.baselineFor(lastSet);
    if (labui) labui.onPlayFinished(sum, bl ? G.baselineScore(bl) : null);
    announce(t('say.final', { score: score }));
    setTicker(t('say.final', { score: score }));
    try { $('result-title').focus({ preventScroll: false }); } catch (e) { /* focus is a courtesy */ }
    var el = $('s-result'); if (el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: reducedNow() ? 'auto' : 'smooth' });
  }

  /* ---------- result ---------- */

  function row(cells, head) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) { var td = document.createElement(head ? 'th' : 'td'); td.textContent = c; if (head) td.scope = 'col'; tr.appendChild(td); });
    return tr;
  }
  function labelsTable() { return I.LANGS[lang]; }
  function renderResult() {
    if (!lastResult || !contest) return;
    var r = lastResult, hist = contest.hist, lastS = hist[hist.length - 1].settings, i;
    $('result-score').textContent = t('result.score', { score: Math.round(r.score) });
    var parts = $('parts'); parts.innerHTML = '';
    [['part.net', r.parts.net, 50], ['part.precision', r.parts.precision, 25], ['part.steady', r.parts.steadiness, 25]].forEach(function (p) {
      var d = document.createElement('div'); d.className = 'part';
      var l = document.createElement('span'); l.textContent = t(p[0]);
      var bar = document.createElement('span'); bar.className = 'bar'; var f = document.createElement('span'); f.style.width = Math.round(100 * p[1] / p[2]) + '%'; bar.appendChild(f);
      var v = document.createElement('span'); v.className = 'v'; v.textContent = t('part.value', { v: r1(p[1]), max: p[2] });
      d.appendChild(l); d.appendChild(bar); d.appendChild(v); parts.appendChild(d);
    });
    var b = G.baselineFor(lastS), cmp = $('cmp'); cmp.innerHTML = '';
    cmp.appendChild(row([t('cmp.metric'), t('cmp.you'), t('cmp.repo')], true));
    var rr = b ? b.row : null, bs = G.baselineScore(b);
    cmp.appendChild(row([t('cmp.true'), String(r.T), rr ? rr.T + ' (sd ' + rr.Tsd + ')' : '-']));
    cmp.appendChild(row([t('cmp.false'), String(r.F), rr ? rr.F + ' (sd ' + rr.Fsd + ')' : '-']));
    cmp.appendChild(row([t('cmp.precision'), r2(r.precision), rr ? rr.P + ' (sd ' + rr.Psd + ')' : '-']));
    cmp.appendChild(row([t('cmp.ratevar'), r.rateVar.toFixed(3), rr ? rr.rv.toFixed(3) : '-']));
    cmp.appendChild(row([t('cmp.score'), String(Math.round(r.score)), bs === null ? '-' : String(Math.round(bs))]));
    var note = '';
    if (b) note = t('cmp.source', { file: b.file, seeds: rr.seeds, repo: B.SOURCE.repo, commit: B.SOURCE.commit.slice(0, 7) }) + (b.exactW ? '' : ' ' + t('cmp.nearw', { w: b.w }));
    else note = t('cmp.none');
    var mixed = hist.some(function (h) { return G.cfgTag(h.settings) !== G.cfgTag(lastS); });
    if (mixed) note += ' ' + t('cmp.mixed');
    $('cmp-note').textContent = note;
    var ch = $('challenge-result');
    if (seedInfo.mode === 'challenge' && seedInfo.best !== null) {
      ch.hidden = false;
      ch.textContent = Math.round(r.score) > seedInfo.best ? t('result.beat', { best: seedInfo.best }) : t('result.notbeat', { best: seedInfo.best, score: Math.round(r.score) });
    } else ch.hidden = true;
    var sc = $('schemes-table'); sc.innerHTML = '';
    sc.appendChild(row([t('scheme.label'), t('cmp.true'), t('cmp.false'), t('cmp.precision')], true));
    B.SCHEMES32.forEach(function (s) { sc.appendChild(row([t('scheme.' + s.scheme + '.short'), String(s.T), String(s.F), String(s.P)])); });
    $('schemes-source').textContent = t('cmp.schemes_source', { file: t('cmp.schemes_file') });
    renderLesson();
    var ul = $('params'); ul.innerHTML = '';
    var p0 = hist[0].params, p1 = contest.par;
    for (i = 0; i < 3; i++) {
      var li = document.createElement('li');
      li.textContent = t('params.line', { m: 'ABC'.charAt(i), th0: r2(p0[i].th), th1: r2(p1[i].th), c0: r2(p0[i].c), c1: r2(p1[i].c), g0: r2(p0[i].g), g1: r2(p1[i].g) });
      ul.appendChild(li);
    }
    $('share-text').textContent = shareText();
  }
  function renderLesson() {
    var id = G.LESSON_IDS[((lessonIdx % G.LESSON_IDS.length) + G.LESSON_IDS.length) % G.LESSON_IDS.length];
    $('lesson-title').textContent = t('lesson.' + id + '.title');
    $('lesson-body').textContent = G.fmt(t('lesson.' + id + '.body'), G.lessonVars());
  }
  function challengeUrl() {
    var h = contest ? contest.hist : [], s = h.length ? h[h.length - 1].settings : readSettings();
    var o = { settings: s, best: lastResult ? lastResult.score : null, lang: lang };
    if (seedInfo.date) o.date = seedInfo.date; else o.seed = seedInfo.seed;
    var base = window.location.href.split('#')[0];
    return base + G.buildChallengeHash(o);
  }
  function shareText() {
    var h = contest.hist, s = h[h.length - 1].settings, b = G.baselineFor(s);
    return G.buildShare({
      labels: labelsTable(), seed: seedInfo.date ? null : seedInfo.seed, day: seedInfo.date ? G.dayNumber(seedInfo.date) : 0, date: seedInfo.date,
      result: lastResult, settings: s, ref: b ? G.baselineScore(b) : null, url: challengeUrl()
    });
  }
  function copyText(text) {
    var st = $('copy-status');
    function fail() { st.textContent = t('copy.fail'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { st.textContent = t('copied'); }, fail);
      else fail();
    } catch (e) { fail(); }
  }

  function renderStats() {
    var ul = $('stats-list'); ul.innerHTML = '';
    var dates = Object.keys(store.daily), li;
    if (!dates.length) { li = document.createElement('li'); li.textContent = t('stats.none'); ul.appendChild(li); }
    else {
      var st = G.computeStreak(dates, today());
      li = document.createElement('li'); li.textContent = t('stats.streak', { cur: st.current, best: st.best }); ul.appendChild(li);
      li = document.createElement('li'); li.textContent = t('stats.best', { best: Math.round(store.bestDaily === null ? 0 : store.bestDaily) }); ul.appendChild(li);
    }
    var sk = G.SCHEMES.filter(function (k) { return store.bestScheme[k] !== undefined; });
    if (sk.length) {
      li = document.createElement('li');
      li.textContent = t('stats.byscheme', { list: sk.map(function (k) { return t('scheme.' + k + '.short') + ' ' + Math.round(store.bestScheme[k]); }).join(', ') });
      ul.appendChild(li);
    }
    $('store-warn').hidden = storeOk;
  }

  /* ---------- help dialog, keys ---------- */

  var lastFocus = null;
  function openHelp() { lastFocus = document.activeElement; $('help').hidden = false; $('help-title').focus(); }
  function closeHelp() { $('help').hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function onKey(e) {
    if (e.key === 'Escape' && arena && arena.stats().intro) { skipIntro(); return; }
    if (e.key === 'Escape' && !$('help').hidden) { closeHelp(); return; }
    if (!$('help').hidden && e.key === 'Tab') {
      var f = $('help').querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (f.length) { var first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || !$('help').hidden) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    // Space and Enter belong to a focused button, link or summary; the letter shortcuts do not conflict with them
    if ((tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === ' ') { e.preventDefault(); onRun(); }
    else if (e.key === 'g' || e.key === 'G') onStep();
    else if (e.key === 'f' || e.key === 'F') onFinish();
    else if (e.key === 's' || e.key === 'S') labui.showTab('lab', true);
  }

  /* ---------- boot ---------- */

  function init() {
    store = loadStore();
    if (store.lang && I.supported.indexOf(store.lang) >= 0) lang = store.lang;
    else if (/^fr/i.test(navigator.language || '')) lang = 'fr';
    t = I.make(lang);
    sysReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    hc = !!store.hc; still = !!store.still;
    document.documentElement.classList.toggle('hc', hc); document.documentElement.classList.toggle('still', still);
    try { arena = S.createArena($('arena'), { reduced: reducedNow(), contrast: hc }); } catch (e) { arena = null; showCanvasError(); }
    labui = LU.create({
      $: $, t: function () { return t; }, hc: function () { return hc; }, doneHist: doneHist, contest: function () { return contest; }, readSettings: readSettings,
      applySettings: applySettings, announce: announce, store: function () { return store; }, saveStore: saveStore, seedInfo: function () { return seedInfo; },
      running: function () { return mode === 'running' || mode === 'paused'; }, drawSci: drawSci, drawMeters: drawFit, onTab: function () { }
    });
    labui.init();
    if (arena) arena.setSpeed($('speed').value);
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onMq = function () { sysReduced = mq.matches; applyMotion(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
    }
    $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; t = I.make(lang); store.lang = lang; saveStore(); applyI18n(); });
    $('btn-help').addEventListener('click', openHelp);
    $('btn-help-close').addEventListener('click', closeHelp);
    $('help').addEventListener('click', function (e) { if (e.target === $('help')) closeHelp(); });
    $('btn-daily').addEventListener('click', function () { if (window.location.hash) { history.replaceState(null, '', window.location.pathname + window.location.search); } startDaily(); applyI18n(); });
    $('btn-practice').addEventListener('click', function () { startPractice(); applyI18n(); });
    $('btn-run').addEventListener('click', onRun);
    $('btn-step').addEventListener('click', onStep);
    $('btn-finish').addEventListener('click', onFinish);
    $('btn-again').addEventListener('click', function () { resetRun(); beginRun(); if (!arena) onFinish(); });
    $('btn-motion').addEventListener('click', function () { still = !still; store.still = still; saveStore(); applyMotion(); renderControls(); announce(t(still ? 'btn.motion_off' : 'btn.motion_on')); });
    $('btn-contrast').addEventListener('click', function () { hc = !hc; store.hc = hc; saveStore(); renderControls(); applyContrast(); announce(t(hc ? 'btn.contrast_on' : 'btn.contrast_off')); });
    $('btn-intro').addEventListener('click', function () { if (!startIntro()) announce(t('btn.motion_off')); openTutorial(); });
    $('btn-tut-next').addEventListener('click', nextTutorial);
    $('btn-tut-skip').addEventListener('click', closeTutorial);
    $('btn-replay-play').addEventListener('click', onReplayPlay);
    $('replay-pos').addEventListener('input', function () { stopReplay(); setReplayIdx(Number($('replay-pos').value)); });
    $('arena').addEventListener('click', skipIntro);
    $('speed').addEventListener('change', function () { if (arena) arena.setSpeed($('speed').value); });
    ['scheme', 'w', 'th', 'c', 'g', 'fcost', 't-shield', 't-amp', 't-stab', 't-evolve'].forEach(function (id) {
      $(id).addEventListener('input', onControlChange); $(id).addEventListener('change', onControlChange);
    });
    $('btn-defaults').addEventListener('click', function () { setSlider('th', G.DEFAULTS.th); setSlider('c', G.DEFAULTS.c); setSlider('g', G.DEFAULTS.g); onControlChange(); });
    $('btn-lesson-more').addEventListener('click', function () { lessonIdx++; renderLesson(); });
    $('btn-copy').addEventListener('click', function () { copyText($('share-text').textContent); });
    $('btn-link').addEventListener('click', function () { copyText(challengeUrl()); });
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', function () { applyHash(); });
    var rz = function () { if (arena) arena.resize(); drawCharts(); if (labui) labui.refresh(); };
    if (window.ResizeObserver) new ResizeObserver(rz).observe($('arena')); else window.addEventListener('resize', rz);
    document.addEventListener('visibilitychange', function () { lastTs = 0; });
    buildSchemeOptions();
    applyHash();
    if (!store.tutorialSeen) openTutorial();
    if (!store.introSeen && !reducedNow() && !window.location.hash) startIntro();
    window.__arena = {
      stats: function () { return arena ? arena.stats() : null; }, resetStats: function () { if (arena) arena.resetStats(); },
      contest: function () { return contest; }, mode: function () { return mode; }, lang: function () { return lang; },
      result: function () { return lastResult; }, seed: function () { return seedInfo; },
      labState: function () { var s = labui.state(); return { tab: labui.activeTab(), ensMs: s.ens.runMs, ensWallMs: s.ens.wallMs, abMs: s.ab.runMs, abWallMs: s.ab.wallMs, ensN: s.ens.summary ? s.ens.summary.n : 0, abN: s.ab.summary ? s.ab.summary.n : 0 }; },
      replayTo: setReplayIdx, replayIdx: function () { return replayIdx; }, desc: function () { return $('arena-desc').textContent; }, skipIntro: skipIntro,
      store: function () { return store; }, showTab: function (n) { labui.showTab(n, false); }, reduced: reducedNow, hc: function () { return hc; }
    };
    window.requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
