/*
 * Membrane Arena: Lab interface (SYNTHETIC classical simulation).
 *
 * Tabs, the Lab instruments, the multi-seed ensemble, the A/B test, the
 * missions and the export buttons. The numbers come from lab.js, the drawing
 * from charts.js; this file only wires them to the page. No network.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'), require('./lab.js'), require('./charts.js'));
  else root.ArenaLabUI = factory(root.ArenaGame, root.ArenaLab, root.ArenaCharts);
})(typeof self !== 'undefined' ? self : this, function (G, LAB, C) {
  'use strict';

  var TABS = ['meters', 'lab', 'ens', 'ab', 'missions', 'method'];
  var METRIC_KEYS = ['T', 'F', 'precision', 'rateVar', 'score'];
  var DIGITS = { T: 1, F: 1, precision: 3, rateVar: 3, score: 1 };
  var PROBE_K = 60;

  function create(env) {
    var $ = env.$, tab = 'meters';
    var lab = { probe: null, probeKey: '', token: 0 };
    var ens = { job: null, summary: null, results: null, settings: null, repo: true, running: false, t0: 0, runMs: 0, wallMs: 0 };
    var ab = { job: null, summary: null, meta: null, settings: null, running: false, t0: 0, runMs: 0, labels: null };

    function t(k, v) { return env.t()(k, v); }
    // keys assembled from a prefix, a name and a suffix (the page test checks the literal keys only)
    function tk(prefix, name, suffix, v) { return env.t()(prefix + name + (suffix || ''), v); }
    function f(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
    function labels() {
      var o = { empty: t('ch.empty'), gen: t('ch.gen'), step: t('ch.step'), trueRate: t('ch.true_rate'), falseRate: t('ch.false_rate'), ratio: t('ch.ratio'), noise: t('ch.noise'), planted: t('ch.planted'),
        threshold: t('ch.threshold'), recall: t('ch.recall'), falsePer: t('ch.false_per'), precision: t('ch.precision'), sh_true_pass: t('ch.sh_true_pass'), sh_false_pass: t('ch.sh_false_pass'),
        sh_held: t('ch.sh_held'), sh_redundant: t('ch.sh_redundant'), gain: t('ch.gain'), rate: t('ch.rate'), episode: t('ch.episode'), p_th: t('ch.p_th'), p_c: t('ch.p_c'), p_g: t('ch.p_g'),
        land_key: t('ch.land_key'), labA: t('ch.labA'), labB: t('ch.labB'), w: t('ch.w'), amp_off: t('ch.amp_off'), amp_on: t('ch.amp_on') };
      METRIC_KEYS.forEach(function (k) { o['m_' + k] = tk('ch.m_', k); });
      return o;
    }
    function copts() { return { hc: env.hc(), labels: labels() }; }
    function setAlt(id, text) { $(id).textContent = text; }

    /* ---------- tabs ---------- */

    function showTab(name, focus) {
      if (TABS.indexOf(name) < 0) return;
      tab = name;
      TABS.forEach(function (k) {
        var on = k === name;
        $('tab-' + k).setAttribute('aria-selected', on ? 'true' : 'false');
        $('tab-' + k).tabIndex = on ? 0 : -1;
        $('panel-' + k).hidden = !on;
      });
      if (focus) $('tab-' + name).focus();
      refresh();
      if (env.onTab) env.onTab(name);
    }
    function onTabKey(e) {
      var i = TABS.indexOf(tab), n = i;
      if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = TABS.length - 1;
      else return;
      e.preventDefault(); showTab(TABS[n], true);
    }

    /* ---------- Lab ---------- */

    function fillGenSelect(n) {
      var sel = $('lab-gen'), keep = sel.value, last = String(n);
      if (sel.options.length !== n) {
        sel.innerHTML = '';
        for (var g = 1; g <= n; g++) { var o = document.createElement('option'); o.value = String(g); o.textContent = String(g); sel.appendChild(o); }
        sel.value = last;
      } else if (keep) sel.value = keep;
      if (!sel.value && n) sel.value = last;
    }
    var AXES = { 'th-g': { x: 'th', y: 'g' }, 'th-c': { x: 'th', y: 'c' }, 'c-g': { x: 'c', y: 'g' } };

    function refreshLab() {
      var hist = env.doneHist(), has = hist.length > 0, o = copts(), tt = env.t();
      $('lab-empty').hidden = has;
      fillGenSelect(hist.length);
      var series = has ? LAB.rateSeries(hist) : [];
      C.drawRates($('lab-rates'), series, o); setAlt('alt-rates', has ? LAB.describeRates(tt, series) : '');
      var al = has ? LAB.alignment(hist, Math.max(0, Math.min(hist.length, Number($('lab-gen').value) || hist.length) - 1)) : null;
      C.drawAlignment($('lab-align'), al, o); setAlt('alt-align', has ? LAB.describeAlignment(tt, al) : '');
      var sc = LAB.shieldCounts(hist);
      C.drawShield($('lab-shield'), sc, o); setAlt('alt-shield', has ? LAB.describeShield(tt, sc) : '');
      var gt = LAB.gainTrace(hist);
      C.drawGain($('lab-gain'), gt, o); setAlt('alt-gain', has ? LAB.describeGain(tt, gt) : '');
      var ls = LAB.landscape(hist), axes = AXES[$('lab-axes').value] || AXES['th-g'];
      C.drawLandscape($('lab-land'), ls, axes, o); setAlt('alt-land', has ? LAB.describeLandscape(tt, ls) : '');
      var amp = LAB.ampBaseline();
      C.drawAmp($('lab-amp'), amp, o); setAlt('alt-amp', LAB.describeAmp(tt, amp));
      $('lab-amp-help').textContent = t('lab.amp.help', { file: amp.file, seeds: amp.seeds, dp: f(amp.maxDeltaP, 3) });
      $('lab-hist-help').textContent = t('lab.hist.help', { k: PROBE_K });
      if (env.drawSci) env.drawSci();
      refreshProbe(has);
    }
    // the probe costs about a tenth of a second, so it runs after the cheap charts and only when the contest changed
    function refreshProbe(has) {
      var c = env.contest(), o = copts(), tt = env.t(), hist = env.doneHist();
      if (!has || !c) { C.drawHist($('lab-hist'), null, o); C.drawSweep($('lab-sweep'), null, o); setAlt('alt-hist', ''); setAlt('alt-sweep', ''); return; }
      var last = hist[hist.length - 1].settings, key = c.seed + ':' + c.gen + ':' + last.stab + ':' + last.amp;
      var draw = function () {
        var h = LAB.ratioHistogram(lab.probe), sw = LAB.sweep(lab.probe, 40), cur = LAB.atThreshold(lab.probe, lab.probe.thr.reduce(function (a, b) { return a + b; }, 0) / 3);
        C.drawHist($('lab-hist'), h, o); setAlt('alt-hist', LAB.describeHist(tt, h));
        C.drawSweep($('lab-sweep'), sw, o); setAlt('alt-sweep', LAB.describeSweep(tt, sw, cur));
      };
      if (lab.probe && lab.probeKey === key) { draw(); return; }
      var token = ++lab.token;
      setTimeout(function () {
        if (token !== lab.token) return;
        lab.probe = LAB.probe(c, last, PROBE_K); lab.probeKey = key;
        draw();
      }, 0);
    }

    /* ---------- export ---------- */

    function download(name, mime, text) {
      var st = $('exp-status'), box = $('exp-text');
      try {
        var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        box.hidden = true; st.textContent = t('lab.export.done', { name: name });
      } catch (e) { box.hidden = false; box.value = text; st.textContent = t('lab.export.fail'); }
    }
    function stamp() { var d = env.seedInfo(); return d ? d.seed : 'run'; }

    /* ---------- tables ---------- */

    function row(cells, head) {
      var tr = document.createElement('tr');
      cells.forEach(function (c) { var td = document.createElement(head ? 'th' : 'td'); td.textContent = c; if (head) td.scope = 'col'; tr.appendChild(td); });
      return tr;
    }
    function ci(c, d) { return f(c.mean, d) + ' (' + f(c.lo, d) + ' to ' + f(c.hi, d) + ')'; }

    /* ---------- ensemble ---------- */

    function setProgress(id, v) { $(id).value = v; }
    function runEnsemble() {
      if (ens.running) return;
      var s = env.readSettings(), n = Number($('ens-n').value) || 20, repo = $('ens-repo').checked;
      ens.job = LAB.createEnsemble({ settings: s, n: n, repoStart: repo }); ens.settings = s; ens.repo = repo; ens.running = true; ens.t0 = Date.now();
      $('btn-ens-run').disabled = true; $('btn-ens-cancel').disabled = false;
      setProgress('ens-progress', 0); $('ens-status').textContent = t('ens.progress', { done: 0, n: n });
      var tick = function () {
        if (!ens.running) return;
        var r = ens.job.step(12);
        setProgress('ens-progress', r.progress);
        $('ens-status').textContent = t('ens.progress', { done: r.completed, n: n });
        if (r.done) finishEnsemble(); else setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
    }
    function finishEnsemble() {
      var st = ens.job.state(), cancelled = st.cancelled;
      ens.running = false; ens.results = ens.job.results(); ens.runMs = st.ms; ens.wallMs = Date.now() - ens.t0;
      $('btn-ens-run').disabled = false; $('btn-ens-cancel').disabled = true;
      if (!ens.results.length) { $('ens-status').textContent = t('ens.cancelled', { done: 0 }); return; }
      ens.summary = LAB.summarizeEnsemble(ens.results, ens.settings, ens.repo);
      $('ens-status').textContent = cancelled ? t('ens.cancelled', { done: ens.results.length }) : t('ens.done', { n: ens.results.length, sec: f(ens.wallMs / 1000, 1) });
      renderEnsemble();
      if (!cancelled) {
        var res = LAB.evaluateMission('repo', { summary: ens.summary });
        if (res && res.counts) record('repo', res, ens.summary.n);
      }
    }
    function renderEnsemble() {
      var sum = ens.summary;
      $('ens-empty').hidden = !!sum; $('ens-out').hidden = !sum;
      if (!sum) return;
      var tt = env.t();
      C.drawEnsemble($('ens-chart'), sum, copts());
      setAlt('ens-alt', LAB.describeEnsemble(tt, sum));
      $('ens-like').textContent = t(sum.like ? 'ens.like_note_yes' : 'ens.like_note_no');
      var tb = $('ens-table'); tb.innerHTML = '';
      tb.appendChild(row([t('ens.col.metric'), t('ens.col.t'), t('ens.col.boot'), t('ens.col.repo')], true));
      METRIC_KEYS.forEach(function (m) {
        var x = sum.metrics[m], b = sum.baseline ? sum.baseline[m] : null, d = DIGITS[m], repoCell = '-';
        if (b) repoCell = (b.approx ? '~' : '') + (b.lo === null ? f(b.mean, d) : ci(b, d));
        tb.appendChild(row([tk('ch.m_', m), ci(x.t, d), f(x.boot.lo, d) + ' to ' + f(x.boot.hi, d), repoCell]));
      });
      var note = sum.baseline ? t('ens.file', { file: sum.baseline.file, repo: G.baselines.SOURCE.repo, commit: G.baselines.SOURCE.commit.slice(0, 7) }) + ' ' + t('ens.score_note') : t('ens.nobase');
      var ag = LAB.agreementWithBaseline(sum);
      if (ag) note += ' ' + t('ens.agree', { n: ag.count });
      $('ens-note').textContent = note;
    }
    function matchRepository() {
      var s = LAB.matchRepository(env.readSettings());
      env.applySettings(s); $('ens-repo').checked = true;
    }

    /* ---------- A/B ---------- */

    function levelLabel(factor, v) {
      if (factor === 'scheme') return tk('scheme.', v, '.short');
      if (factor === 'w') return Math.round(v * 100) + '%';
      return t(v ? 'ab.level.on' : 'ab.level.off');
    }
    function levelsOf(factor) { return LAB.FACTORS[factor].levels; }
    function fillLevels() {
      var factor = $('ab-factor').value, lv = levelsOf(factor), a = $('ab-a'), b = $('ab-b'), ka = a.value, kb = b.value;
      [a, b].forEach(function (sel) {
        sel.innerHTML = '';
        lv.forEach(function (v, i) { var o = document.createElement('option'); o.value = String(i); o.textContent = levelLabel(factor, v); sel.appendChild(o); });
      });
      var defs = { scheme: ['consensus', 'individual'], w: [1, 0] };
      var ia = defs[factor] ? lv.indexOf(defs[factor][0]) : 0, ib = defs[factor] ? lv.indexOf(defs[factor][1]) : 1;
      a.value = ka && Number(ka) < lv.length && a.dataset.f === factor ? ka : String(ia);
      b.value = kb && Number(kb) < lv.length && b.dataset.f === factor ? kb : String(ib);
      a.dataset.f = factor; b.dataset.f = factor;
    }
    function relabelFactors() {
      var sel = $('ab-factor');
      Array.prototype.forEach.call(sel.options, function (o) { o.textContent = tk('ab.factor.', o.value); });
      var f0 = sel.value, ka = $('ab-a').value, kb = $('ab-b').value;
      fillLevels(); $('ab-a').value = ka; $('ab-b').value = kb; sel.value = f0;
      var ax = $('lab-axes');
      Array.prototype.forEach.call(ax.options, function (o) { o.textContent = tk('lab.axes.', o.value.replace('-', '_')); });
    }
    function setupAB(factor, a, b, n) {
      $('ab-factor').value = factor; $('ab-a').dataset.f = ''; $('ab-b').dataset.f = ''; fillLevels();
      var lv = levelsOf(factor);
      $('ab-a').value = String(lv.indexOf(a)); $('ab-b').value = String(lv.indexOf(b));
      $('ab-n').value = String(n); $('ab-repo').checked = true;
    }
    function runAB() {
      if (ab.running) return;
      var factor = $('ab-factor').value, lv = levelsOf(factor), a = lv[Number($('ab-a').value)], b = lv[Number($('ab-b').value)], n = Number($('ab-n').value) || 20;
      var s = env.readSettings();
      ab.job = LAB.createPaired({ settings: s, factor: factor, a: a, b: b, n: n, repoStart: $('ab-repo').checked });
      ab.meta = ab.job.meta; ab.settings = s; ab.running = true; ab.t0 = Date.now();
      $('btn-ab-run').disabled = true; $('btn-ab-cancel').disabled = false;
      setProgress('ab-progress', 0); $('ab-status').textContent = t('ens.progress', { done: 0, n: n });
      var tick = function () {
        if (!ab.running) return;
        var r = ab.job.step(12);
        setProgress('ab-progress', r.progress); $('ab-status').textContent = t('ens.progress', { done: r.completed, n: n });
        if (r.done) finishAB(); else setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
    }
    function finishAB() {
      var st = ab.job.state(), cancelled = st.a.cancelled;
      ab.running = false; ab.runMs = st.a.ms + st.b.ms; ab.wallMs = Date.now() - ab.t0;
      $('btn-ab-run').disabled = false; $('btn-ab-cancel').disabled = true;
      var ra = ab.job.a.results(), rb = ab.job.b.results();
      if (Math.min(ra.length, rb.length) < 2) { $('ab-status').textContent = t('ens.cancelled', { done: Math.min(ra.length, rb.length) }); return; }
      ab.summary = LAB.summarizePaired(ra, rb);
      ab.labels = { a: levelLabel(ab.meta.factor, ab.meta.a), b: levelLabel(ab.meta.factor, ab.meta.b) };
      $('ab-status').textContent = cancelled ? t('ens.cancelled', { done: ab.summary.n }) : t('ab.done', { n: ab.summary.n, sec: f(ab.wallMs / 1000, 1) });
      renderAB();
      MISSION_IDS_AB().forEach(function (id) {
        var res = LAB.evaluateMission(id, { meta: ab.meta, summary: ab.summary });
        if (res && res.counts) record(id, res, ab.summary.n);
      });
    }
    function MISSION_IDS_AB() { return LAB.MISSIONS.filter(function (m) { return m.kind === 'ab'; }).map(function (m) { return m.id; }); }
    function renderAB() {
      var sum = ab.summary;
      $('ab-empty').hidden = !!sum; $('ab-out').hidden = !sum;
      if (!sum) return;
      var tt = env.t();
      C.drawPaired($('ab-chart'), sum, copts());
      var lab2 = { a: levelLabel(ab.meta.factor, ab.meta.a), b: levelLabel(ab.meta.factor, ab.meta.b) };
      ab.labels = lab2;
      setAlt('ab-alt', LAB.describePaired(tt, sum, ab.meta, lab2));
      var ds = sum.metrics.score.diff;
      $('ab-verdict').textContent = t(ds.excludesZero ? 'ab.verdict_yes' : 'ab.verdict_no', { n: sum.n });
      var tb = $('ab-table'); tb.innerHTML = '';
      tb.appendChild(row([t('ab.col.metric'), t('ab.col.a') + ' (' + lab2.a + ')', t('ab.col.b') + ' (' + lab2.b + ')', t('ab.col.diff'), t('ab.col.t'), t('ab.col.boot'), t('ab.col.wins')], true));
      METRIC_KEYS.forEach(function (m) {
        var x = sum.metrics[m], d = DIGITS[m], df = x.diff;
        var wins = df.aWins;
        tb.appendChild(row([tk('ch.m_', m), f(x.a.mean, d), f(x.b.mean, d), f(df.mean, d), f(df.lo, d) + ' to ' + f(df.hi, d) + (df.excludesZero ? '' : ' ' + t('ab.ci_zero')), f(df.boot.lo, d) + ' to ' + f(df.boot.hi, d), wins + '/' + sum.n]));
      });
    }

    /* ---------- missions ---------- */

    function outcomeText(m) {
      var names = (m.metrics || []).map(function (k) { return tk('ch.m_', k); }).join(', ');
      var n = (m.n !== undefined ? m.n : 0);
      return tk('out.', m.outcome, '', { metrics: names, n: n });
    }
    function record(id, res, n) {
      var s = env.store(), out;
      if (res.outcome === 'partly') out = { outcome: 'partly', n: res.detail.count, metrics: [] };
      else out = { outcome: res.outcome, n: n || 0, metrics: res.detail && res.detail.metrics ? res.detail.metrics : [] };
      var o = {}; o[id] = out;
      s.missions[id] = G.sanitizeStore({ missions: o }).missions[id] || out;
      env.saveStore(); renderMissions();
      env.announce(tk('mis.', id, '.title') + ': ' + t('mis.done', { outcome: outcomeText(s.missions[id]) }));
    }
    function renderMissions() {
      var ol = $('missions-list'), s = env.store(), lv = G.lessonVars();
      ol.innerHTML = '';
      LAB.MISSIONS.forEach(function (m) {
        var li = document.createElement('li'), done = s.missions[m.id], h = document.createElement('h3'), p = document.createElement('p'), st = document.createElement('p'), b = document.createElement('button');
        li.className = 'mission' + (done ? ' done' : ''); li.id = 'mission-' + m.id;
        h.textContent = tk('mis.', m.id, '.title');
        p.textContent = G.fmt(tk('mis.', m.id, '.brief'), { low: lv.low, cells: lv.cells });
        st.className = 'status';
        st.textContent = done ? t('mis.done', { outcome: outcomeText(done) }) : t('mis.todo');
        b.type = 'button'; b.className = 'btn small'; b.textContent = t('mis.setup'); b.setAttribute('data-mission', m.id);
        b.addEventListener('click', function () { setupMission(m.id); });
        li.appendChild(h); li.appendChild(p); li.appendChild(st); li.appendChild(b); ol.appendChild(li);
      });
    }
    function setupMission(id) {
      var m = LAB.missionById(id);
      if (m.kind === 'ab') { setupAB(m.factor, m.a, m.b, m.minN); showTab('ab', true); }
      else if (m.kind === 'ens') { env.applySettings(LAB.matchRepository(Object.assign({}, env.readSettings(), { shield: true, amp: false, stab: false }))); $('ens-repo').checked = true; $('ens-n').value = String(m.minN); showTab('ens', true); }
      else { var el = $('main'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); $('btn-run').focus(); }
      $('mis-note').textContent = t('mis.wrong');
    }
    function onPlayFinished(result, ref) {
      var res = LAB.evaluateMission('play', { result: result, ref: ref });
      if (res && res.counts) record('play', res, 0);
    }

    /* ---------- refresh and relabel ---------- */

    function refresh() {
      if (tab === 'lab') refreshLab();
      else if (tab === 'ens') renderEnsemble();
      else if (tab === 'ab') renderAB();
      else if (tab === 'missions') renderMissions();
      else if (tab === 'meters' && env.drawMeters) env.drawMeters();
    }
    function relabel() {
      $('tablist').setAttribute('aria-label', t('tabs.aria'));
      var titles = { 'lab-rates': 'lab.rates.title', 'lab-align': 'lab.align.title', 'lab-hist': 'lab.hist.title', 'lab-sweep': 'lab.sweep.title', 'lab-shield': 'lab.shield.title', 'lab-gain': 'lab.gain.title',
        'lab-land': 'lab.land.title', 'lab-amp': 'lab.amp.title', 'ens-chart': 'ens.title', 'ab-chart': 'ab.title' };
      Object.keys(titles).forEach(function (id) { $(id).setAttribute('aria-label', t(titles[id])); });
      $('ens-progress').setAttribute('aria-label', t('ens.title')); $('ab-progress').setAttribute('aria-label', t('ab.title'));
      relabelFactors();
      renderMissions();
      if (ens.summary) renderEnsemble();
      if (ab.summary) renderAB();
      refresh();
    }

    function init() {
      TABS.forEach(function (k) { $('tab-' + k).addEventListener('click', function () { showTab(k, false); }); $('tab-' + k).addEventListener('keydown', onTabKey); });
      $('btn-ens-run').addEventListener('click', runEnsemble);
      $('btn-ens-cancel').addEventListener('click', function () { if (ens.job) ens.job.cancel(); });
      $('btn-ens-match').addEventListener('click', matchRepository);
      $('btn-ab-run').addEventListener('click', runAB);
      $('btn-ab-cancel').addEventListener('click', function () { if (ab.job) ab.job.cancel(); });
      $('ab-factor').addEventListener('change', fillLevels);
      $('lab-gen').addEventListener('change', refreshLab);
      $('lab-axes').addEventListener('change', refreshLab);
      $('btn-exp-run-csv').addEventListener('click', function () { var c = env.contest(); if (c) download('membrane-arena-' + stamp() + '.csv', 'text/csv', LAB.runCSV(env.doneHist())); });
      $('btn-exp-run-json').addEventListener('click', function () { var c = env.contest(); if (c) download('membrane-arena-' + stamp() + '.json', 'application/json', LAB.runJSON(c, env.seedInfo())); });
      $('btn-ens-csv').addEventListener('click', function () { if (ens.results) download('membrane-arena-ensemble.csv', 'text/csv', LAB.ensembleCSV(ens.results)); });
      $('btn-ens-json').addEventListener('click', function () { if (ens.summary) download('membrane-arena-ensemble.json', 'application/json', LAB.ensembleJSON(ens.results, ens.summary, ens.settings, ens.repo)); });
      $('btn-ab-csv').addEventListener('click', function () { if (ab.summary) download('membrane-arena-ab.csv', 'text/csv', LAB.pairedCSV(ab.job.a.results(), ab.job.b.results())); });
      $('btn-ab-json').addEventListener('click', function () { if (ab.summary) download('membrane-arena-ab.json', 'application/json', LAB.pairedJSON(ab.meta, ab.summary, ab.settings)); });
      relabelFactors();
    }

    return {
      init: init, showTab: showTab, refresh: refresh, relabel: relabel, onPlayFinished: onPlayFinished, activeTab: function () { return tab; },
      runEnsemble: runEnsemble, runAB: runAB, setupAB: setupAB, state: function () { return { ens: ens, ab: ab, lab: lab }; }
    };
  }

  return { create: create, TABS: TABS };
});
