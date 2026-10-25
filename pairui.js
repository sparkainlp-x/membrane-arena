/*
 * Membrane Arena: Reverse Pair page (SYNTHETIC classical simulation).
 *
 * Controls (tick share, threshold, equalizer, 2-membrane shield, on-grid or off-grid fades), the tick strip, the calibrator's
 * nine tones, the round-by-round contest, the eight episode charts of the last round (the observer's
 * opposite energy, the calibrator's ticks, and the calibrator's readings against the true gains and
 * its prediction), the rounds table, the calibration check and the plain-text score card.
 * No network, no storage: everything lives in this page.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var P = window.ArenaPair, G = window.ArenaGame, LANGS = window.PairI18n.LANGS;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var hash = P.parseHash(location.hash);
  var lang = hash.lang === 'fr' ? 'fr' : 'en', hc = false, busy = false;
  var today = P.dailySeed(G.localDateString(new Date()));
  var seed = hash.seed || today, contest = null, settings = null, last = null, refs = {}, cal = null, calOff = false;
  function t(k, vars) { var s = (LANGS[lang] && LANGS[lang][k]) || LANGS.en[k] || k; return G.fmt(s, vars); }
  function text(el, s) { el.textContent = s; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function para(parent, s, cls) { var p = document.createElement('p'); if (cls) p.className = cls; p.textContent = s; parent.appendChild(p); return p; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function num(x, d) { var s = x.toFixed(d === undefined ? 2 : d); return lang === 'fr' ? s.replace('.', ',') : s; }
  function svg(tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }
  function setHash() {
    var h = P.buildHash({ seed: seed, lang: lang });
    if (history.replaceState) history.replaceState(null, '', h || location.pathname);
  }
  function darkWord(d) { return t(d < 0.73 ? 'dark.faint' : d < 0.87 ? 'dark.clear' : 'dark.deep'); }
  /* ---------- controls ---------- */
  function readControls() {
    settings = P.sanitizeSettings({ share: +$('s-val').textContent, th: +$('th').value, eq: $('eq').checked, shield: $('shield').checked, off: $('off').checked });
    return settings;
  }
  function writeControls(s) {
    text($('s-val'), String(s.share));
    $('th').value = String(s.th);
    $('eq').checked = s.eq;
    $('shield').checked = s.shield;
    $('off').checked = !!s.off;
    settings = P.sanitizeSettings(s);
    renderControls();
  }
  function renderTicks(s) {
    var box = $('ticks'), sweep = 0;
    clear(box);
    for (var tk = 1; tk <= 20; tk++) {
      var li = document.createElement('li'), who = P.owner(tk, s.share);
      li.className = who;
      li.textContent = who === 'o' ? t('tick.o') : String(P.FREQS[sweep++ % P.FREQS.length]);
      box.appendChild(li);
    }
    var c = P.TICKS / (s.share + 1);
    text($('ticks-text'), t('ticks.text', { o: P.TICKS - c, c: c, sw: num(c / P.FREQS.length, 1) }));
  }
  function renderControls() {
    var s = readControls();
    text($('th-val'), num(s.th));
    $('s-dec').disabled = busy || s.share <= 1;
    $('s-inc').disabled = busy || s.share >= P.SHARE_MAX;
    renderTicks(s);
  }
  function setBusy(b) {
    busy = b;
    var over = P.done(contest);
    $('btn-run').disabled = b || over;
    $('btn-rest').disabled = b || over;
    ['btn-again', 'btn-today', 'btn-new', 'btn-cal'].forEach(function (id) { $(id).disabled = b; });
    ['eq', 'shield', 'off', 'th'].forEach(function (id) { $(id).disabled = b; });
    renderControls();
  }
  /* ---------- contest ---------- */
  function start(newSeed) {
    seed = newSeed; contest = P.createContest(seed); last = null; cal = null;
    writeControls(P.startFor(seed));
    text($('cal-text'), '');
    setHash(); renderAll(); setBusy(false);
  }
  // the reference: the full pair at 2 : 1 with the calibration-seed threshold for the fades of the last round
  function refFor() { var h = contest.hist[contest.hist.length - 1]; return P.reference(!!(h && h.settings.off)); }
  function refScore() {
    var R0 = refFor(), key = seed + '|' + (R0.off ? 'off' : 'grid');
    if (refs[key] === undefined) {
      var c = P.createContest(seed);
      while (!P.done(c)) P.stepRound(c, R0);
      refs[key] = P.summarize(c.hist).score;
    }
    return refs[key];
  }
  function runRounds(all) {
    if (busy || P.done(contest)) return;
    setBusy(true);
    var box = $('res-text');
    clear(box); para(box, t('res.running', { r: contest.gen + 1 }));
    var step = function () {
      last = P.stepRound(contest, readControls());
      if (all && !P.done(contest)) { renderAll(); clear(box); para(box, t('res.running', { r: contest.gen + 1 })); setTimeout(step, 30); return; }
      if (P.done(contest)) refScore();
      setBusy(false); renderAll();
    };
    setTimeout(step, 30);
  }
  /* ---------- rendering ---------- */
  function renderForecast() {
    var n = P.ROUNDS, tide = $('tide');
    text($('forecast'), P.done(contest) ? t('forecast.done', { n: n }) :
      t('forecast.round', { r: contest.gen + 1, n: n, d: num(contest.depths[contest.gen]), word: darkWord(contest.depths[contest.gen]) }));
    clear(tide);
    contest.depths.forEach(function (d, k) {
      var li = document.createElement('li');
      li.style.height = Math.round(20 + 80 * (d - 0.6) / 0.4) + '%';
      if (k < contest.gen) li.className = 'played';
      if (k === contest.gen) li.className = 'cur';
      tide.appendChild(li);
    });
    text($('seed'), t(seed === today ? 'seed.daily' : 'seed.other', { seed: seed }));
  }
  function renderScore() {
    var s = P.summarize(contest.hist), box = $('res-text');
    text($('score'), contest.hist.length ? String(Math.round(s.score)) : '0');
    text($('tally'), t('tally', { t: s.T, f: s.F, m: s.missed, p: s.planted }));
    if (busy) return;
    clear(box);
    if (!last) { para(box, t('res.start')); return; }
    para(box, t('res.round', { r: last.gen + 1, t: last.outT, f: last.outF, m: last.missed, h: last.held }));
    if (last.outF > 0) para(box, t('res.false'), 'warn');
    if (!last.settings.eq) para(box, t('res.noeq'));
    if (!last.settings.shield) para(box, t('res.noshield'));
    else if (last.held > 0) para(box, t('res.held', { h: last.held }));
    if (P.done(contest)) {
      var ref = refScore();
      para(box, t('res.final', { score: Math.round(s.score) }), 'good');
      para(box, t('res.parts', { net: num(s.parts.net, 1), prec: num(s.parts.precision, 1), st: num(s.parts.steadiness, 1) }));
      para(box, t('res.ref', { ref: Math.round(ref), th: num(refFor().th) }));
      para(box, t(s.score > ref ? 'res.beat' : 'res.below'), s.score > ref ? 'good' : null);
    }
  }
  function renderTones() {
    var box = $('tones');
    clear(box);
    P.FREQS.forEach(function (f) {
      var div = document.createElement('div'), W = 96, H = 44, mid = H / 2, amp = 17, s = P.signedSine(f);
      div.className = 'tone';
      var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', focusable: 'false' }, div);
      svg('line', { x1: 2, x2: W - 2, y1: mid, y2: mid, 'class': 'axis' }, root);
      var xs = function (j) { return 5 + (W - 10) * j / (P.N - 1); }, pts = [];
      for (var q = 0; q <= 90; q++) {
        var jj = (P.N - 1) * q / 90, v = f === 0 ? 1 : f === P.N / 2 ? Math.cos(Math.PI * jj) : Math.sin(2 * Math.PI * f * (jj + 0.5) / P.N);
        pts.push(xs(jj).toFixed(1) + ',' + (mid - amp * v).toFixed(1));
      }
      if (f > 0 && f < P.N / 2) svg('polyline', { points: pts.join(' '), 'class': 'wave' }, root);
      s.forEach(function (v, j) {
        var neg = v < 0 ? ' neg' : '';
        svg('line', { x1: xs(j), x2: xs(j), y1: mid, y2: mid - amp * v, 'class': 'stem' + neg }, root);
        svg('circle', { cx: xs(j), cy: mid - amp * v, r: 1.6, 'class': 'tip' + neg }, root);
      });
      para(div, t('tone.label', { f: f }));
      box.appendChild(div);
    });
  }
  function epChart(ep, k, s) {
    var div = document.createElement('div'), h = document.createElement('h3');
    var W = 200, H = 92, L = 4, Rm = 4, T0 = 6, B = 10, lo = -0.6, hi = 1;
    var x = function (tk) { return L + (W - L - Rm) * (tk - 1) / (P.TICKS - 1); };
    var y = function (v) { v = Math.min(hi, Math.max(lo, v)); return T0 + (H - T0 - B) * (hi - v) / (hi - lo); };
    var cls = ep.out ? (ep.truth ? 't' : 'f') : ep.held ? 'h' : 'n';
    div.className = 'ep ' + cls;
    h.textContent = t(ep.planted ? 'ep.dark' : 'ep.noise', { e: k + 1 });
    div.appendChild(h);
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', focusable: 'false', 'class': 'trace' }, div);
    svg('line', { x1: L, x2: W - Rm, y1: y(0), y2: y(0), 'class': 'chance' }, root);
    svg('line', { x1: L, x2: W - Rm, y1: y(s.th), y2: y(s.th), 'class': 'thr' }, root);
    ep.readings.forEach(function (r) { svg('line', { x1: x(r.t), x2: x(r.t), y1: H - 7, y2: H - 1, 'class': 'ctick' }, root); });
    var end = ep.declTick || P.TICKS, pts = [];
    for (var tk = 1; tk <= end; tk++) pts.push(x(tk).toFixed(1) + ',' + y(ep.trace[tk - 1]).toFixed(1));
    svg('polyline', { points: pts.join(' '), 'class': 'obs' }, root);
    if (ep.declTick) svg('circle', { cx: x(ep.declTick), cy: y(ep.trace[ep.declTick - 1]), r: 3.6, 'class': 'dot obs' }, root);
    // the calibrator's readings at the declaration (or the end), against the true gains and the prediction (1)
    var BW = 200, BH = 50, top = 4, base = 38, scale = (base - top) / 1.2, slot = (BW - 8) / P.FREQS.length;
    var bars = svg('svg', { viewBox: '0 0 ' + BW + ' ' + BH, 'aria-hidden': 'true', focusable: 'false', 'class': 'bars' }, div);
    svg('line', { x1: 4, x2: BW - 4, y1: base - scale, y2: base - scale, 'class': 'pred' }, bars);
    P.FREQS.forEach(function (f, j) {
      var e = ep.snap.est[f], g = ep.snap.gain[f], bx = 4 + j * slot + slot * 0.2, bw = slot * 0.6;
      svg('rect', { x: bx.toFixed(1), y: (base - scale * e).toFixed(1), width: bw.toFixed(1), height: (scale * e).toFixed(1), 'class': 'bar' + (e < P.FADED ? ' faded' : '') }, bars);
      svg('line', { x1: (bx - 2).toFixed(1), x2: (bx + bw + 2).toFixed(1), y1: (base - scale * g).toFixed(1), y2: (base - scale * g).toFixed(1), 'class': 'truth' }, bars);
      var lab = svg('text', { x: (bx + bw / 2).toFixed(1), y: BH - 3, 'class': 'flabel' }, bars); lab.textContent = String(f);
    });
    var out = cls === 't' ? 'out.true' : cls === 'f' ? 'out.false' : cls === 'h' ? 'out.held' : 'out.none';
    var parts = [cap(t(out))];
    parts.push(cap(ep.declTick ? t('ep.decl', { t: ep.declTick }) + (ep.calVote ? t('ep.vote.yes') : t('ep.vote.no')) : t('ep.nodecl')));
    parts.push(cap(!ep.fade ? t('ep.clean') : ep.fade.kind === 'off' ? t('ep.fade.off', { f: num(ep.fade.center), w: num(ep.fade.bw, 1), c: num(ep.fade.f, 1) }) : t('ep.fade', { f: ep.fade.band, c: num(ep.fade.f, 1) })));
    para(div, parts.join('. ') + '.', 'out');
    return div;
  }
  function renderEpisodes() {
    var box = $('episodes');
    clear(box);
    if (!last) { para(box, t('chart.empty'), 'empty'); return; }
    last.episodes.forEach(function (ep, k) { box.appendChild(epChart(ep, k, last.settings)); });
  }
  function setupText(s) { return t('setup.row', { s: s.share, th: num(s.th) }) + (s.eq ? t('setup.eq') : '') + (s.shield ? t('setup.shield') : '') + (s.off ? t('setup.off') : ''); }
  function renderRounds() {
    var body = $('rounds-body');
    clear(body);
    contest.hist.forEach(function (h) {
      var tr = document.createElement('tr');
      if (last && h.gen === last.gen) tr.className = 'cur';
      [String(h.gen + 1), num(h.depth), setupText(h.settings), String(h.outT), String(h.outF), String(h.missed), String(h.held)].forEach(function (v, j) {
        var td = document.createElement('td'); td.textContent = v; if (j !== 2) td.className = 'n'; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }
  function renderCal() {
    var body = $('cal-body');
    clear(body);
    if (!cal) return;
    cal.forEach(function (r) {
      var tr = document.createElement('tr'), th = document.createElement('th');
      th.scope = 'row'; th.textContent = t('cal.row', { s: r.share }); tr.appendChild(th);
      if (settings && r.share === settings.share) tr.className = 'cur';
      [t('cal.ticks.cell', { o: r.obsTicks, c: r.calTicks }), num(r.fadeErr, 3), num(r.cleanErr, 3)].forEach(function (v) {
        var td = document.createElement('td'); td.className = 'n'; td.textContent = v; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }
  function calDone() { text($('cal-text'), t('cal.done', { pred: num(P.PRED_ERR, 3), kind: t(calOff ? 'cal.kind.off' : 'cal.kind.grid') })); }
  function runCal() {
    if (busy) return;
    setBusy(true);
    text($('cal-text'), t('cal.running'));
    setTimeout(function () {
      calOff = readControls().off;
      cal = P.calibrationCheck(seed, 48, calOff);
      setBusy(false);
      renderCal();
      calDone();
    }, 30);
  }
  function renderShare() {
    if (!contest.hist.length) { text($('share'), t('chart.empty')); return; }
    text($('share'), P.shareText({ seed: seed, result: P.summarize(contest.hist), settings: contest.hist[contest.hist.length - 1].settings }, t));
  }
  function renderAll() { renderForecast(); renderScore(); renderEpisodes(); renderRounds(); renderCal(); renderShare(); }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = t('page.title');
    $('s-dec').setAttribute('aria-label', t('ctl.share.dec'));
    $('s-inc').setAttribute('aria-label', t('ctl.share.inc'));
    text($('footer-version'), 'pair ' + P.VERSION + ' / arena ' + G.BUILD);
    if (cal) calDone();
    renderTones(); renderControls(); setHash(); renderAll();
  }
  /* ---------- wiring ---------- */
  $('eq').addEventListener('change', renderControls);
  $('shield').addEventListener('change', renderControls);
  $('off').addEventListener('change', renderControls);
  $('th').addEventListener('input', renderControls);
  $('s-dec').addEventListener('click', function () { text($('s-val'), String(Math.max(1, +$('s-val').textContent - 1))); renderControls(); renderCal(); });
  $('s-inc').addEventListener('click', function () { text($('s-val'), String(Math.min(P.SHARE_MAX, +$('s-val').textContent + 1))); renderControls(); renderCal(); });
  $('btn-run').addEventListener('click', function () { runRounds(false); });
  $('btn-rest').addEventListener('click', function () { runRounds(true); });
  $('btn-again').addEventListener('click', function () { start(seed); });
  $('btn-today').addEventListener('click', function () { start(today); });
  $('btn-new').addEventListener('click', function () { start('p' + Math.floor(Math.random() * 1e9).toString(36)); });
  $('btn-cal').addEventListener('click', runCal);
  $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); });
  $('btn-contrast').addEventListener('click', function () {
    hc = !hc;
    document.documentElement.classList.toggle('hc', hc);
    this.setAttribute('aria-pressed', hc ? 'true' : 'false');
  });
  contest = P.createContest(seed);
  writeControls(P.startFor(seed));
  applyLang();
  setBusy(false);
})();
