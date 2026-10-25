/*
 * Membrane Arena: brain architecture page (SYNTHETIC classical simulation).
 *
 * Reads the requirements, plans the necessary membranes with brain.js, prints
 * the plan and the checks, draws the diagram, and runs the simulation a few
 * episodes at a time so the page stays responsive. No network, no storage.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function () {
  'use strict';
  var B = window.ArenaBrain, G = window.ArenaGame, LANGS = window.BrainI18n.LANGS;
  var $ = function (id) { return document.getElementById(id); };
  var lang = /(^|[#&])l=fr(&|$)/.test(location.hash) ? 'fr' : 'en', hc = false, arch = null, last = null, timer = null;

  function t(k, vars) { var s = (LANGS[lang] && LANGS[lang][k]) || LANGS.en[k] || k; return G.fmt(s, vars); }
  function text(el, s) { el.textContent = s; }
  function f2(x) { return x === null || x === undefined || !isFinite(x) ? t('res.na') : x.toFixed(2); }
  function ci(w) { return w.n ? w.p.toFixed(2) + ' [' + w.lo.toFixed(2) + ', ' + w.hi.toFixed(2) + ']' : t('res.na'); }

  function readReq() {
    return {
      sensoryFaults: +$('f').value, columnFaults: +$('g').value, integratorFaults: +$('h').value,
      stabilizer: $('stab').checked, memory: $('mem').checked, fuse: $('fuse').checked,
      delays: { sg: +$('sg').value, gi: +$('gi').value, io: +$('io').value },
      jitter: +$('jitter').value, c: +$('c').value, th: +$('th').value, g: +$('gain').value
    };
  }
  function readFaults() { return { sensory: +$('fs').value, columns: +$('fc').value, integrators: +$('fi').value, mode: $('mode').value }; }
  function fillSelect(sel, max) {
    var keep = Math.min(+sel.value || 0, max);
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    for (var k = 0; k <= max; k++) { var o = document.createElement('option'); o.value = String(k); o.textContent = String(k); sel.appendChild(o); }
    sel.value = String(keep);
  }
  function layerName(v) { return v.layer ? t('layer.' + v.layer) : v.layer; }
  function kindsList(s) { return String(s).split(', ').map(function (k) { return t('kind.' + k); }).join(', '); }

  function renderPlan() {
    arch = B.planArchitecture(readReq());
    fillSelect($('fs'), arch.perColumn); fillSelect($('fc'), arch.columns); fillSelect($('fi'), arch.integrators);
    var body = $('plan-body');
    while (body.firstChild) body.removeChild(body.firstChild);
    arch.plan.forEach(function (p) {
      var tr = document.createElement('tr');
      [t('kind.' + p.kind), String(p.count), t('rule.' + p.rule, p.vars)].forEach(function (s, i) {
        var td = document.createElement(i === 0 ? 'th' : 'td'); if (i === 0) td.scope = 'row'; td.textContent = s; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    text($('plan-total'), t('plan.total', { m: arch.counts.total, t: arch.tubes.total, s: arch.tubes.signal, d: arch.tubes.modulatory }));
    var ck = B.checkArchitecture(arch, arch.req), ul = $('checks');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    ck.problems.forEach(function (p) {
      var li = document.createElement('li'), v = {};
      Object.keys(p.vars).forEach(function (k) { v[k] = p.vars[k]; });
      if (v.layer) v.layer = layerName(p.vars);
      if (p.code === 'single_points') v.kinds = kindsList(p.vars.kinds);
      li.className = p.level;
      li.textContent = t('level.' + p.level) + ': ' + t('prob.' + p.code, v);
      ul.appendChild(li);
    });
    $('btn-run').disabled = !ck.ok;
    renderDiagram();
    return ck;
  }
  function renderDiagram() {
    if (!arch) return;
    var labels = { column: t('kind.column'), gate: t('kind.gate'), integrator: t('kind.integrator'), output: t('kind.output'), inhibitory: t('kind.inhibitory'), memory: t('kind.memory') };
    var desc = B.describe(arch);
    // the SVG is built from numbers and escaped strings only (brain.js renderSvg)
    $('diagram').innerHTML = B.renderSvg(arch, { faults: readFaults(), hc: hc, labels: labels, title: t('sec.diagram'), desc: desc });
    text($('diagram-desc'), desc);
  }

  function renderResults(run, ms) {
    var s = run.summary, body = $('results-body'), one = s.single;
    while (body.firstChild) body.removeChild(body.firstChild);
    var rows = [
      ['res.true', String(s.T), String(one.T)],
      ['res.false', String(s.F), String(one.F)],
      ['res.recall', ci(s.recall), ci(one.recall)],
      ['res.falseRate', ci(s.falseRate), ci(one.falseRate)],
      ['res.precision', f2(s.T + s.F ? s.precision : null), f2(one.T + one.F ? one.precision : null)],
      ['res.fidelity', f2(s.meanFidelity), f2(one.meanFidelity)],
      ['res.latency', s.meanLatency === null ? t('res.na') : s.meanLatency.toFixed(1), t('res.na')],
      ['res.lost', s.lost + ' / ' + (s.lost + s.moved), t('res.na')],
      ['res.updates', String(s.ojaUpdates), t('res.na')]
    ];
    rows.forEach(function (r) {
      var tr = document.createElement('tr'), th = document.createElement('th');
      th.scope = 'row'; th.textContent = t(r[0]); tr.appendChild(th);
      [r[1], r[2]].forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); });
      body.appendChild(tr);
    });
    text($('results-note'), one.honest ? '' : t('res.ref_faulty'));
    text($('json'), B.toJSON(run));
    text($('run-status'), t('run.done', { total: s.episodes, ms: Math.round(ms) }));
  }

  function run() {
    if (timer) { clearTimeout(timer); timer = null; }
    var ck = renderPlan();
    if (!ck.ok) return;
    var seed = $('seed').value;
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(seed)) { seed = 'brain1'; $('seed').value = seed; }
    var R = B.createBrainRun(arch, { seed: seed, episodes: +$('episodes').value, faults: readFaults() });
    var t0 = performance.now(), total = R.opts.episodes, btn = $('btn-run'), prog = $('run-progress');
    btn.disabled = true; prog.max = total; prog.value = 0;
    var slice = function () {
      var s0 = performance.now();
      while (!B.brainDone(R) && performance.now() - s0 < 14) B.stepBrainRun(R, 1);
      prog.value = R.e;
      if (B.brainDone(R)) { timer = null; btn.disabled = false; last = B.finishBrainRun(R); renderResults(last, performance.now() - t0); return; }
      text($('run-status'), t('run.busy', { done: R.e, total: total }));
      timer = setTimeout(slice, 0);
    };
    slice();
  }

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.title = t('page.title');
    renderPlan();
    if (last) renderResults(last, 0);
    text($('footer-version'), 'brain ' + B.VERSION + ' / arena ' + G.BUILD);
  }

  function bindSlider(id) {
    var el = $(id), out = $(id + '-val');
    var upd = function () { out.textContent = (+el.value).toFixed(2); renderPlan(); };
    el.addEventListener('input', upd);
  }

  ['f', 'g', 'h', 'sg', 'gi', 'io', 'stab', 'mem', 'fuse'].forEach(function (id) { $(id).addEventListener('change', renderPlan); });
  ['fs', 'fc', 'fi', 'mode'].forEach(function (id) { $(id).addEventListener('change', renderDiagram); });
  ['jitter', 'c', 'th', 'gain'].forEach(bindSlider);
  $('brain-form').addEventListener('submit', function (ev) { ev.preventDefault(); run(); });
  $('btn-lang').addEventListener('click', function () { lang = lang === 'en' ? 'fr' : 'en'; applyLang(); });
  $('btn-contrast').addEventListener('click', function () {
    hc = !hc;
    document.documentElement.classList.toggle('hc', hc);
    this.setAttribute('aria-pressed', hc ? 'true' : 'false');
    renderDiagram();
  });
  applyLang();
})();
