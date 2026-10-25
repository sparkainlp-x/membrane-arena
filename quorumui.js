/*
 * Membrane Arena: Quorum Keeper page (SYNTHETIC classical simulation).
 *
 * Level picker, the Build controls (layer sizes, inhibitory membrane, cost), the Break controls
 * (mark faulty units, attack, claim), the diagram with the released symbols, and the result.
 * The simulation runs a few episodes at a time so the page stays responsive.
 * No network, no storage: progress lives in this page only.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var Q = window.QuorumGame, B = window.ArenaBrain, G = window.ArenaGame, LANGS = window.QuorumI18n.LANGS;
  var $ = function (id) { return document.getElementById(id); };
  var hashLv = /(^|[#&])lv=([a-z0-9]+)(&|$)/.exec(location.hash);
  var lang = /(^|[#&])l=fr(&|$)/.test(location.hash) ? 'fr' : 'en', hc = false;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var levelId = hashLv && Q.getLevel(hashLv[2]) ? hashLv[2] : 'b1';
  var designs = {}, picks = {}, best = {}, misses = {}, solutions = {};
  var view = null, result = null, timer = null, anim = null;
  function t(k, vars) { var s = (LANGS[lang] && LANGS[lang][k]) || LANGS.en[k] || k; return G.fmt(s, vars); }
  function pl(key, n, vars) { return t(key + (n === 1 ? '.1' : '.n'), Object.assign({ n: n }, vars || {})); }
  function text(el, s) { el.textContent = s; }
  function level() { return Q.getLevel(levelId); }
  function starStr(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '\u2605' : '\u2606'; return s; }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function para(parent, s, cls) { var p = document.createElement('p'); if (cls) p.className = cls; p.textContent = s; parent.appendChild(p); return p; }
  function setHash() {
    var h = '#lv=' + levelId + (lang === 'fr' ? '&l=fr' : '');
    if (history.replaceState) history.replaceState(null, '', h);
  }
  /* ---------- words ---------- */
  function threatText(L) {
    var th = L.threat, parts = [];
    if (th.perColumn > 0) parts.push(pl('thr.perColumn', th.perColumn));
    if (th.gates > 0) parts.push(pl('thr.gates', th.gates));
    if (th.integrators > 0) parts.push(pl('thr.integrators', th.integrators));
    if (th.total < 99) parts.push(pl('thr.total', th.total));
    return parts.join('; ');
  }
  function where(arch, faulty) {
    var parts = [], k, i;
    for (k = 0; k < arch.columns; k++) {
      var n = 0;
      for (i = 0; i < arch.perColumn; i++) if (faulty['s' + k + '.' + i]) n++;
      if (n) parts.push(pl('where.sensory', n, { k: k + 1 }));
      if (faulty['g' + k]) parts.push(t('where.gate', { k: k + 1 }));
    }
    for (k = 0; k < arch.integrators; k++) if (faulty['i' + k]) parts.push(t('where.int', { j: k + 1 }));
    return parts.length ? parts.join(', ') : t('where.none');
  }
  function unitLabel(id, kind, bad, cls) {
    var m = /^s(\d+)\.(\d+)$/.exec(id), s;
    if (m) s = t('unit.sensory', { i: +m[2] + 1, k: +m[1] + 1 });
    else if (kind === 'gate') s = t('unit.gate', { k: +id.slice(1) + 1 });
    else if (kind === 'integrator') s = t('unit.integrator', { j: +id.slice(1) + 1 });
    else if (kind === 'output') s = t('unit.output');
    else s = t('unit.inhibitory');
    if (bad) s += t('unit.faulty');
    if (cls === 'true' || cls === 'false' || cls === 'none') s += t('unit.' + cls);
    return s;
  }
  /* ---------- level list and card ---------- */
  function renderLevels() {
    [['build', $('lv-build')], ['break', $('lv-break')]].forEach(function (g) {
      clear(g[1]);
      Q.LEVELS.filter(function (L) { return L.kind === g[0]; }).forEach(function (L) {
        var li = document.createElement('li'), b = document.createElement('button'), a = document.createElement('span'), s = document.createElement('span');
        b.type = 'button'; b.className = 'btn'; b.setAttribute('data-level', L.id);
        a.className = 'lvid'; a.textContent = L.id.toUpperCase();
        s.className = 'lvstars'; s.textContent = starStr(best[L.id] || 0);
        b.appendChild(a); b.appendChild(s);
        b.setAttribute('aria-label', t('lv.aria', { id: L.id.toUpperCase(), title: t(L.id + '.title'), n: best[L.id] || 0 }));
        if (L.id === levelId) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', function () { selectLevel(L.id); });
        li.appendChild(b); g[1].appendChild(li);
      });
    });
  }
  function renderCard() {
    var L = level(), ul = $('lv-facts');
    text($('lv-title'), L.id.toUpperCase() + '. ' + t(L.id + '.title'));
    text($('lv-brief'), t(L.id + '.brief'));
    text($('lv-hint'), t(L.id + '.hint'));
    clear(ul);
    var facts = L.kind === 'build' ? [
      t('fact.threat', { text: threatText(L) }), t('fact.mode', { mode: t('mode.' + L.mode) }),
      t('fact.budget', { budget: L.budget, par: L.par }), t('fact.delays', L.delays),
      t('fact.stars', { r: L.recall.toFixed(2), par: L.par }), t('fact.safe')
    ] : [
      t('fact.goal', { goal: t('goal.' + L.goal) }), t('fact.mode', { mode: t('mode.' + L.mode) }),
      t('fact.pick', { n: L.budget, kinds: L.kinds.map(function (k) { return t('kind.' + k); }).join(', ') }), t('fact.bstars')
    ];
    facts.forEach(function (f) { var li = document.createElement('li'); li.textContent = f; ul.appendChild(li); });
    $('build-controls').hidden = L.kind !== 'build';
    $('break-controls').hidden = L.kind !== 'break';
  }
  /* ---------- diagram ---------- */
  function currentArch() { var L = level(); return L.kind === 'build' ? Q.archFor(L, designs[L.id]) : Q.breakArch(L); }
  function drawDiagram(symOverride) {
    var L = level(), arch = currentArch(), faulty = view ? view.faulty : (L.kind === 'break' ? (picks[L.id] || {}) : {});
    var sym = symOverride !== undefined ? symOverride : (view ? view.sym : null);
    var focused = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-id') : null;
    $('diagram').innerHTML = Q.render(arch, {   // the SVG is built from numbers and escaped strings only (quorum.js render)
      faulty: faulty, sym: sym, hc: hc, pickable: L.kind === 'break' ? L.kinds : [],
      labels: { column: t('kind.column'), gate: t('kind.gate'), integrator: t('kind.integrator'), output: t('kind.output'), inhibitory: t('kind.inhibitory'), T: t('sym.T'), F: t('sym.F') },
      unitLabel: unitLabel, title: t('sec.diagram'), desc: B.describe(arch)
    });
    if (focused) { var el = $('diagram').querySelector('[data-id="' + focused + '"]'); if (el && el.focus) el.focus(); }
  }
  // reveal the released symbols layer by layer: sensory, gates, integrators, output
  function reveal(arch, faulty, sym, done) {
    if (anim) { clearTimeout(anim); anim = null; }
    view = { faulty: faulty, sym: sym };
    if (reduce) { drawDiagram(); if (done) done(); return; }
    var order = [/^s/, /^g/, /^i/, /^o$/], step = 0;
    var tick = function () {
      var part = {};
      Object.keys(sym).forEach(function (id) { for (var q = 0; q <= step; q++) if (order[q].test(id)) part[id] = sym[id]; });
      drawDiagram(part);
      step++;
      if (step < order.length) anim = setTimeout(tick, 260);
      else { anim = null; if (done) done(); }
    };
    tick();
  }
  /* ---------- result ---------- */
  function showResult() {
    var box = $('res-text'), st = $('res-stars'), L = level(), next = $('btn-next');
    clear(box);
    st.classList.remove('pop');
    if (!result || result.level !== L.id) {
      text(st, best[L.id] ? starStr(best[L.id]) : '');
      para(box, t('res.idle'));
      if (best[L.id]) para(box, t('res.best', { n: best[L.id] }), 'muted');
      next.hidden = !best[L.id];
      return;
    }
    var r = result;
    if (r.busy) { text(st, ''); para(box, r.busy === 'search' ? t('status.search') : t('status.sim', { done: r.done, total: r.total })); next.hidden = true; return; }
    text(st, starStr(r.stars || 0));
    if (r.stars && !reduce) { void st.offsetWidth; st.classList.add('pop'); }
    r.lines.forEach(function (ln) { para(box, t(ln[0], ln[1]), ln[2]); });
    if (r.stars) para(box, t('res.stars', { n: r.stars }), 'win');
    if (best[L.id] && best[L.id] > (r.stars || 0)) para(box, t('res.best', { n: best[L.id] }), 'muted');
    next.hidden = !best[L.id];
  }
  function award(id, n) {
    if (n > (best[id] || 0)) best[id] = n;
    renderLevels(); renderShare();
  }
  function renderShare() {
    text($('share'), Q.shareText(Q.LEVELS.map(function (L) { return { id: L.id, stars: best[L.id] || 0 }; }), t));
  }
  /* ---------- build mode ---------- */
  function design() { var L = level(); designs[L.id] = Q.sanitizeDesign(designs[L.id] || L.start, L); return designs[L.id]; }
  function renderDesign() {
    var L = level(), d = design(), lim = Q.DESIGN_LIMITS, arch = Q.archFor(L, d), ck = B.checkArchitecture(arch), c = Q.cost(arch);
    text($('m-val'), String(d.perColumn)); text($('c-val'), String(d.columns)); text($('i-val'), String(d.integrators));
    $('stab').checked = d.stabilizer;
    [['m', 'perColumn', 'design.m'], ['c', 'columns', 'design.C'], ['i', 'integrators', 'design.I']].forEach(function (x) {
      var what = t(x[2]).toLowerCase();
      $(x[0] + '-dec').disabled = d[x[1]] <= 1 || !!timer;
      $(x[0] + '-inc').disabled = d[x[1]] >= lim[x[1]] || !!timer;
      $(x[0] + '-dec').setAttribute('aria-label', t('design.dec', { what: what }));
      $(x[0] + '-inc').setAttribute('aria-label', t('design.inc', { what: what }));
    });
    $('stab').disabled = !!timer;
    var p = $('cost'); clear(p);
    var add = function (s, cls) { var sp = document.createElement('span'); sp.textContent = s; if (cls) sp.className = cls; p.appendChild(sp); p.appendChild(document.createTextNode(' ')); };
    add(t('cost.line', { n: c, budget: L.budget, t: arch.tubes.total }));
    if (c > L.budget) add(t('cost.over', { n: c - L.budget }), 'over');
    else if (c <= L.par) add(t('cost.par'), 'ok');
    else add(t('cost.above', { n: c - L.par }));
    if (!ck.ok) add(t('cost.slow'), 'slow');
    $('btn-test').disabled = !!timer;
  }
  function changeDesign(key, delta) {
    if (timer) return;
    var L = level(), d = design();
    if (key === 'stabilizer') d.stabilizer = !!delta; else d[key] = d[key] + delta;
    designs[L.id] = Q.sanitizeDesign(d, L);
    view = null; if (result && result.level === L.id) result = null;
    renderDesign(); drawDiagram(); showResult();
  }
  function runTest() {
    if (timer) return;
    var L = level(), ev = Q.evaluateBuild(L, design()), lines = [];
    if (!ev.check.ok) {
      var msgs = ev.check.problems.filter(function (p) { return p.level === 'error'; }).map(function (p) { return p.code === 'deadline' ? t('cost.slow') : p.code; });
      result = { level: L.id, stars: 0, lines: [['res.wiring', { msg: msgs.join(' ') }, 'lose']] }; showResult(); return;
    }
    if (ev.overBudget) { result = { level: L.id, stars: 0, lines: [['res.budget', { n: ev.cost, budget: L.budget }, 'lose']] }; showResult(); return; }
    var adv = ev.adversary;
    if (!adv.holds) {
      var w = adv.worst, fooled = !!adv.fool;
      lines.push([fooled ? 'res.fooled' : 'res.silenced', { count: fooled ? adv.counts['false'] : adv.counts.none, total: adv.total, where: where(ev.arch, w.faulty) }, 'lose']);
      result = { level: L.id, stars: 0, lines: lines };
      reveal(ev.arch, w.faulty, w.eval.sym, showResult);
      return;
    }
    lines.push(['res.holds', { total: adv.total }, 'win']);
    var R = Q.createSim(L, ev), total = R.opts.episodes, prog = $('sim-progress');
    prog.max = total; prog.value = 0;
    result = { level: L.id, busy: 'sim', done: 0, total: total };
    var place = ev.simPlacement || {}, symb = Q.evaluate(ev.arch, L.mode, place).sym;
    view = { faulty: place, sym: null }; drawDiagram();
    var slice = function () {
      var s0 = performance.now();
      while (!B.brainDone(R) && performance.now() - s0 < 14) B.stepBrainRun(R, 1);
      prog.value = R.e;
      if (!B.brainDone(R)) { result.done = R.e; showResult(); timer = setTimeout(slice, 0); return; }
      timer = null;
      var sum = B.finishBrainRun(R).summary, sc = Q.scoreBuild(L, ev, sum);
      lines.push(['res.sim', { n: total, seed: L.seed, where: where(ev.arch, place), r: sum.recall.p.toFixed(2), target: L.recall.toFixed(2), F: sum.F }]);
      if (sum.F > 0) lines.push(['res.simFalse', { F: sum.F }, 'lose']);
      else if (sc.stars === 1) lines.push(['res.missRecall', {}]);
      else if (sc.stars === 2) lines.push(['res.missPar', { n: ev.cost, par: L.par }]);
      else if (sc.stars === 3) lines.push(['res.perfect', {}]);
      result = { level: L.id, stars: sc.stars, lines: lines };
      award(L.id, sc.stars);
      renderDesign();
      reveal(ev.arch, place, symb, showResult);
    };
    renderDesign(); showResult();
    timer = setTimeout(slice, 0);
  }
  /* ---------- break mode ---------- */
  function solution(L) { if (!solutions[L.id]) solutions[L.id] = Q.solveBreak(L); return solutions[L.id]; }
  function renderPicked() {
    var L = level(), n = Object.keys(picks[L.id] || {}).length;
    text($('picked'), t('picked', { n: n, k: L.budget }));
    $('btn-solution').hidden = !(misses[L.id] > 0);
  }
  function toggleUnit(id) {
    var L = level();
    if (L.kind !== 'break') return;
    var arch = Q.breakArch(L), unit = arch.membranes.filter(function (x) { return x.id === id; })[0];
    if (!unit) return;
    var cur = Object.assign({}, picks[L.id] || {});
    if (view) { view = null; result = null; }
    if (!Q.canPick(L, unit.kind)) { result = { level: L.id, stars: 0, lines: [['pick.shielded', {}]] }; drawDiagram(); showResult(); return; }
    if (cur[id]) delete cur[id];
    else if (Object.keys(cur).length >= L.budget) { result = { level: L.id, stars: 0, lines: [['pick.full', { k: L.budget }]] }; drawDiagram(); showResult(); return; }
    else cur[id] = true;
    picks[L.id] = cur;
    renderPicked(); drawDiagram(); showResult();
  }
  function winBreak(L, used, lines) {
    var sol = solution(L), sc = Q.scoreBreak(L, sol, { won: true, misses: misses[L.id] || 0, used: used });
    if (sol.breakable && used > sol.minFaults) lines.push(['res.min', { n: sol.minFaults }]);
    result = { level: L.id, stars: sc.stars, lines: lines };
    award(L.id, sc.stars);
  }
  function doAttack() {
    var L = level(), p = picks[L.id] || {};
    if (!Object.keys(p).length) { result = { level: L.id, stars: 0, lines: [['res.bempty', {}]] }; showResult(); return; }
    var r = Q.attack(L, p);
    if (r.win) winBreak(L, r.used, [['res.bwin.' + L.goal, { n: r.used }, 'win']]);
    else {
      misses[L.id] = (misses[L.id] || 0) + 1;
      result = { level: L.id, stars: 0, lines: [['res.blose', { outcome: t('outcome.' + r.outcome) }, 'lose']] };
    }
    renderPicked();
    reveal(r.arch, r.faulty, r.eval.sym, showResult);
  }
  function doClaim() {
    var L = level(), sol = solution(L);
    view = null;
    if (!sol.breakable) winBreak(L, 0, [['res.claimRight', { total: sol.total }, 'win']]);
    else { misses[L.id] = (misses[L.id] || 0) + 1; result = { level: L.id, stars: 0, lines: [['res.claimWrong', {}, 'lose']] }; }
    renderPicked(); drawDiagram(); showResult();
  }
  function doSolution() {
    var L = level(), sol = solution(L);
    if (!sol.breakable) { result = { level: L.id, stars: 0, lines: [['res.claimRight', { total: sol.total }]] }; view = null; drawDiagram(); showResult(); return; }
    picks[L.id] = Object.assign({}, sol.example);
    var r = Q.attack(L, picks[L.id]);
    result = { level: L.id, stars: 0, lines: [['res.shown', { n: sol.minFaults, where: where(r.arch, r.faulty) }]] };
    renderPicked();
    reveal(r.arch, r.faulty, r.eval.sym, showResult);
  }
  function doClear() { var L = level(); picks[L.id] = {}; view = null; result = null; renderPicked(); drawDiagram(); showResult(); }
  /* ---------- wiring ---------- */
  function selectLevel(id) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (anim) { clearTimeout(anim); anim = null; }
    levelId = id; view = null; result = null;
    setHash(); renderAll();
  }
  function renderAll() {
    renderLevels(); renderCard();
    if (level().kind === 'build') renderDesign(); else renderPicked();
    drawDiagram(); showResult(); renderShare();
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('.sw-t').forEach(function (el) { el.textContent = t('sym.T'); });
    document.querySelectorAll('.sw-f').forEach(function (el) { el.textContent = t('sym.F'); });
    text($('how-p3'), t('how.p3', { n: Q.SIM_EPISODES }));
    document.title = t('page.title');
    text($('footer-version'), 'quorum ' + Q.VERSION + ' / brain ' + B.VERSION + ' / arena ' + G.BUILD);
    setHash(); renderAll();
  }
  $('m-dec').addEventListener('click', function () { changeDesign('perColumn', -1); });
  $('m-inc').addEventListener('click', function () { changeDesign('perColumn', 1); });
  $('c-dec').addEventListener('click', function () { changeDesign('columns', -1); });
  $('c-inc').addEventListener('click', function () { changeDesign('columns', 1); });
  $('i-dec').addEventListener('click', function () { changeDesign('integrators', -1); });
  $('i-inc').addEventListener('click', function () { changeDesign('integrators', 1); });
  $('stab').addEventListener('change', function () { changeDesign('stabilizer', this.checked); });
  $('btn-test').addEventListener('click', runTest);
  $('btn-attack').addEventListener('click', doAttack);
  $('btn-claim').addEventListener('click', doClaim);
  $('btn-clear').addEventListener('click', doClear);
  $('btn-solution').addEventListener('click', doSolution);
  $('btn-next').addEventListener('click', function () {
    var i = Q.LEVELS.indexOf(level());
    selectLevel(Q.LEVELS[(i + 1) % Q.LEVELS.length].id);
  });
  var unitFrom = function (ev) { var el = ev.target && ev.target.closest ? ev.target.closest('.membrane') : null; return el ? el.getAttribute('data-id') : null; };
  $('diagram').addEventListener('click', function (ev) { var id = unitFrom(ev); if (id) toggleUnit(id); });
  $('diagram').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var id = unitFrom(ev); if (!id) return;
    ev.preventDefault(); toggleUnit(id);
  });
  $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); });
  $('btn-contrast').addEventListener('click', function () {
    hc = !hc;
    document.documentElement.classList.toggle('hc', hc);
    this.setAttribute('aria-pressed', hc ? 'true' : 'false');
    drawDiagram();
  });
  applyLang();
})();
