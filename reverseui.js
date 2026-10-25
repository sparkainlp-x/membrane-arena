/*
 * Membrane Arena: Reverse Membranes page (SYNTHETIC classical simulation).
 *
 * Controls (polarity, opposite-energy threshold, echo, shield), the round-by-round contest, the
 * eight episode charts of the last round with a text line each, the rounds table, the mirror test
 * and the plain-text score card. A round takes a few milliseconds, so it runs in one go after the
 * page has painted the "running" message. No network, no storage: everything lives in this page.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var R = window.ArenaReverse, G = window.ArenaGame, LANGS = window.ReverseI18n.LANGS;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };
  var hash = R.parseHash(location.hash);
  var lang = hash.lang === 'fr' ? 'fr' : 'en', hc = false, busy = false;
  var today = R.dailySeed(G.localDateString(new Date()));
  var seed = hash.seed || today, contest = null, settings = null, last = null, refs = {}, mirror = null;
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
    var h = R.buildHash({ seed: seed, lang: lang });
    if (history.replaceState) history.replaceState(null, '', h || location.pathname);
  }
  function darkWord(d) { return t(d < 0.73 ? 'dark.faint' : d < 0.87 ? 'dark.clear' : 'dark.deep'); }
  /* ---------- controls ---------- */
  function readControls() {
    settings = R.sanitizeSettings({ polarity: $('pol').checked ? 'reverse' : 'forward', th: +$('th').value, echo: +$('e-val').value, shield: $('shield').checked });
    return settings;
  }
  function writeControls(s) {
    $('pol').checked = s.polarity === 'reverse';
    $('th').value = String(s.th);
    $('shield').checked = s.shield;
    text($('e-val'), String(s.echo));
    settings = R.sanitizeSettings(s);
    renderControls();
  }
  function renderControls() {
    var s = readControls();
    text($('th-val'), num(s.th));
    $('e-dec').disabled = busy || s.echo <= 0;
    $('e-inc').disabled = busy || s.echo >= R.ECHO_MAX;
  }
  function setBusy(b) {
    busy = b;
    var over = R.done(contest);
    $('btn-run').disabled = b || over;
    $('btn-rest').disabled = b || over;
    ['btn-again', 'btn-today', 'btn-new', 'btn-mirror'].forEach(function (id) { $(id).disabled = b; });
    renderControls();
  }
  /* ---------- contest ---------- */
  function start(newSeed) {
    seed = newSeed; contest = R.createContest(seed); last = null; mirror = null;
    writeControls(R.startFor(seed));
    setHash(); renderAll(); setBusy(false);
  }
  function refScore() {
    if (refs[seed] === undefined) {
      var c = R.createContest(seed);
      while (!R.done(c)) R.stepRound(c, R.DEFAULTS);
      refs[seed] = R.summarize(c.hist).score;
    }
    return refs[seed];
  }
  function runRounds(all) {
    if (busy || R.done(contest)) return;
    setBusy(true);
    var box = $('res-text');
    clear(box); para(box, t('res.running', { r: contest.gen + 1 }));
    var step = function () {
      last = R.stepRound(contest, readControls());
      if (all && !R.done(contest)) { renderAll(); clear(box); para(box, t('res.running', { r: contest.gen + 1 })); setTimeout(step, 30); return; }
      if (R.done(contest)) refScore();
      setBusy(false); renderAll();
    };
    setTimeout(step, 30);
  }
  /* ---------- rendering ---------- */
  function renderForecast() {
    var n = R.ROUNDS, tide = $('tide');
    text($('forecast'), R.done(contest) ? t('forecast.done', { n: n }) :
      t('forecast.round', { r: contest.gen + 1, n: n, d: num(contest.depths[contest.gen]), word: darkWord(contest.depths[contest.gen]) }));
    clear(tide);
    contest.depths.forEach(function (d, k) {
      var li = document.createElement('li');
      li.style.height = Math.round(20 + 80 * (d - R.DEPTH_MIN) / (R.DEPTH_MAX - R.DEPTH_MIN)) + '%';
      if (k < contest.gen) li.className = 'played';
      if (k === contest.gen) li.className = 'cur';
      tide.appendChild(li);
    });
    text($('seed'), t(seed === today ? 'seed.daily' : 'seed.other', { seed: seed }));
  }
  function renderScore() {
    var s = R.summarize(contest.hist), box = $('res-text');
    text($('score'), contest.hist.length ? String(Math.round(s.score)) : '0');
    text($('tally'), t('tally', { t: s.T, f: s.F, m: s.missed, p: s.planted }));
    if (busy) return;
    clear(box);
    if (!last) { para(box, t('res.start')); return; }
    para(box, t('res.round', { r: last.gen + 1, t: last.outT, f: last.outF, m: last.missed }));
    var declared = last.episodes.some(function (e) { return e.declStep.some(function (x) { return x !== null; }); });
    if (!declared) para(box, t(last.settings.polarity === 'forward' ? 'res.zero.forward' : last.settings.echo === 0 ? 'res.zero.echo' : 'res.zero.deep'), 'warn');
    else if (last.settings.polarity === 'forward' && last.outT === 0) para(box, t('res.zero.forward'), 'warn');
    if (last.outF > 0) { para(box, t('res.false'), 'warn'); if (!last.settings.shield) para(box, t('res.noshield')); }
    if (R.done(contest)) {
      var ref = refScore();
      para(box, t('res.final', { score: Math.round(s.score) }), 'good');
      para(box, t('res.parts', { net: num(s.parts.net, 1), prec: num(s.parts.precision, 1), st: num(s.parts.steadiness, 1) }));
      para(box, t('res.ref', { ref: Math.round(ref) }));
      para(box, t(s.score > ref ? 'res.beat' : 'res.below'), s.score > ref ? 'good' : null);
    }
  }
  function epChart(ep, k, s) {
    var div = document.createElement('div'), h = document.createElement('h3');
    var W = 200, H = 110, L = 4, Rm = 4, T0 = 6, B = 6, lo = -1, hi = 1.5, sign = R.SIGN[s.polarity];
    var x = function (step) { return L + (W - L - Rm) * (step - 1) / (R.STEPS - 1); };
    var y = function (v) { v = Math.min(hi, Math.max(lo, v)); return T0 + (H - T0 - B) * (hi - v) / (hi - lo); };
    var cls = ep.evT > 0 ? 't' : ep.evF > 0 ? 'f' : 'n';
    div.className = 'ep ' + cls;
    h.textContent = t(ep.planted ? 'ep.dark' : 'ep.noise', { e: k + 1 });
    div.appendChild(h);
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', focusable: 'false' }, div);
    svg('line', { x1: L, x2: W - Rm, y1: y(0), y2: y(0), 'class': 'chance' }, root);
    var thv = sign * s.th;   // ratio - 1 at the threshold: below chance for reverse (1 - ratio = th), above for forward
    svg('line', { x1: L, x2: W - Rm, y1: y(thv), y2: y(thv), 'class': 'thr' }, root);
    var decls = [];
    for (var i = 0; i < 3; i++) {
      var pts = [];
      for (var st = 1; st <= R.STEPS; st++) pts.push(x(st).toFixed(1) + ',' + y(sign * ep.trace[(st - 1) * 3 + i]).toFixed(1));
      svg('polyline', { points: pts.join(' '), 'class': 'tr m' + (i + 1) }, root);
      var d = ep.declStep[i];
      if (d !== null) {
        svg('circle', { cx: x(d), cy: y(sign * ep.trace[(d - 1) * 3 + i]), r: 3.6, 'class': 'dot m' + (i + 1) }, root);
        decls.push(t('ep.decl', { i: i + 1, s: d }));
      }
    }
    var out = cls === 't' ? 'out.true' : cls === 'f' ? 'out.false' : ep.dropped ? 'out.held' : 'out.none';
    para(div, cap(t(out)) + '. ' + cap(decls.length ? decls.join(', ') : t('ep.nodecl')) + '.', 'out');
    return div;
  }
  function renderEpisodes() {
    var box = $('episodes');
    clear(box);
    if (!last) { para(box, t('chart.empty'), 'empty'); return; }
    last.episodes.forEach(function (ep, k) { box.appendChild(epChart(ep, k, last.settings)); });
  }
  function renderRounds() {
    var body = $('rounds-body');
    clear(body);
    contest.hist.forEach(function (h) {
      var tr = document.createElement('tr'), s = h.settings;
      if (last && h.gen === last.gen) tr.className = 'cur';
      [String(h.gen + 1), num(h.depth), t('setup.row', { pol: t('pol.' + s.polarity), th: num(s.th), e: s.echo }) + (s.shield ? t('setup.shield') : ''),
        String(h.outT), String(h.outF), String(h.missed)].forEach(function (v, j) {
        var td = document.createElement('td'); td.textContent = v; if (j !== 2) td.className = 'n'; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }
  function renderMirror() {
    var body = $('mirror-body');
    clear(body);
    if (!mirror) return;
    R.WORLDS.forEach(function (w) {
      var tr = document.createElement('tr'), th = document.createElement('th');
      th.scope = 'row'; th.textContent = t('mirror.' + w); tr.appendChild(th);
      R.POLARITIES.forEach(function (p) {
        var c = mirror.filter(function (x) { return x.world === w && x.polarity === p; })[0], td = document.createElement('td');
        td.textContent = t('mirror.cell', { t: c.T, f: c.F, p: c.planted });
        td.className = c.T > 0 ? 'hit' : 'miss';
        td.setAttribute('data-world', w); td.setAttribute('data-polarity', p);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }
  function runMirror() {
    if (busy) return;
    setBusy(true);
    text($('mirror-text'), t('mirror.running'));
    setTimeout(function () {
      mirror = R.mirrorTest(readControls(), seed, 2 * R.EP);
      setBusy(false);
      renderMirror();
      text($('mirror-text'), t('mirror.done'));
    }, 30);
  }
  function renderShare() {
    if (!contest.hist.length) { text($('share'), t('chart.empty')); return; }
    text($('share'), R.shareText({ seed: seed, result: R.summarize(contest.hist), settings: contest.hist[contest.hist.length - 1].settings, depths: contest.depths }, t));
  }
  function renderAll() { renderForecast(); renderScore(); renderEpisodes(); renderRounds(); renderMirror(); renderShare(); }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = t('page.title');
    $('e-dec').setAttribute('aria-label', t('ctl.echo.dec'));
    $('e-inc').setAttribute('aria-label', t('ctl.echo.inc'));
    text($('footer-version'), 'reverse ' + R.VERSION + ' / arena ' + G.BUILD);
    if (mirror) text($('mirror-text'), t('mirror.done'));
    renderControls(); setHash(); renderAll();
  }
  /* ---------- wiring ---------- */
  $('pol').addEventListener('change', renderControls);
  $('shield').addEventListener('change', renderControls);
  $('th').addEventListener('input', renderControls);
  $('e-dec').addEventListener('click', function () { text($('e-val'), String(Math.max(0, +$('e-val').textContent - 1))); renderControls(); });
  $('e-inc').addEventListener('click', function () { text($('e-val'), String(Math.min(R.ECHO_MAX, +$('e-val').textContent + 1))); renderControls(); });
  $('btn-run').addEventListener('click', function () { runRounds(false); });
  $('btn-rest').addEventListener('click', function () { runRounds(true); });
  $('btn-again').addEventListener('click', function () { start(seed); });
  $('btn-today').addEventListener('click', function () { start(today); });
  $('btn-new').addEventListener('click', function () { start('r' + Math.floor(Math.random() * 1e9).toString(36)); });
  $('btn-mirror').addEventListener('click', runMirror);
  $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); });
  $('btn-contrast').addEventListener('click', function () {
    hc = !hc;
    document.documentElement.classList.toggle('hc', hc);
    this.setAttribute('aria-pressed', hc ? 'true' : 'false');
  });
  contest = R.createContest(seed);
  writeControls(R.startFor(seed));
  applyLang();
  setBusy(false);
})();
