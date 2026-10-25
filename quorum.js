/*
 * Membrane Arena: Quorum Keeper, a puzzle game on the brain architecture
 * (SYNTHETIC classical simulation). Pure logic: no DOM, no network, no storage.
 *
 * Two modes, both played on brain.js architectures (columns of sensory
 * membranes, one gate per column, integrators, one output):
 *
 *   build  The level names a threat (how many faulty units an adversary may
 *          place, where, and how they behave) and a membrane budget. The player
 *          sizes the layers. The adversary then tries every placement the
 *          threat allows. If none fools or silences the brain, a seeded
 *          simulation of the real learning membranes measures recall under the
 *          most fragile placement. Stars: 1 = the logic holds, 2 = recall meets
 *          the target, 3 = no more membranes than the par.
 *   break  The player is the adversary: mark up to k units faulty and attack.
 *          The goal is to fool the brain (a wrong output) or silence it (no
 *          output), or to claim correctly that it cannot be done.
 *
 * The logic layer is symbolic. Honest sensory membranes declare the truth T at
 * the first check, colluding faults all send the same wrong vector A, stuck
 * faults each send their own junk vector, silent faults send nothing. Every
 * vote then follows brain.js quorumRelease (strict majority, arrival times with
 * the microtubule delays, losses after step 60). tests/quorum.test.js checks
 * that this matches brain.js logicOutcome placement for placement.
 *
 * Members inside a column are interchangeable at the logic level, and so are
 * columns and integrators, so the adversary enumerates placements up to that
 * symmetry and weights each class by the number of placements it stands for.
 * A test compares this with brute force over every subset on small brains.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'), require('./brain.js'));
  else root.QuorumGame = factory(root.ArenaGame, root.ArenaBrain);
})(typeof self !== 'undefined' ? self : this, function (G, B) {
  'use strict';
  var VERSION = '0.3.3';
  var MODES = B.MODES;                         // collude, stuck, silent
  var GOALS = ['fool', 'silence'];
  var SIM_EPISODES = 60;                       // half planted
  var DESIGN_LIMITS = { perColumn: 9, columns: 7, integrators: 5 };
  var DEFAULT_DELAYS = { sg: 0, gi: 1, io: 0 };

  /* ---------- levels ---------- */
  // Build threats: total = most faulty units overall, perColumn = most faulty sensory members in any
  // one column, gates / integrators = most faulty gates / integrators. A cap of 0 shields that kind.
  // budget, par and recall were calibrated with scripts/quorum-check.js (docs/quorum-check.txt).
  var S0 = { perColumn: 1, columns: 1, integrators: 1, stabilizer: false };
  var BUILD = [
    { id: 'b1', mode: 'collude', threat: { total: 1, perColumn: 1, gates: 0, integrators: 0 }, budget: 8, par: 6, recall: 0.6, delays: DEFAULT_DELAYS, seed: 'qk-b1', start: S0 },
    { id: 'b2', mode: 'collude', threat: { total: 1, perColumn: 0, gates: 1, integrators: 0 }, budget: 10, par: 9, recall: 0.6, delays: DEFAULT_DELAYS, seed: 'qk-b2', start: S0 },
    { id: 'b3', mode: 'collude', threat: { total: 99, perColumn: 1, gates: 1, integrators: 0 }, budget: 22, par: 21, recall: 0.9, delays: DEFAULT_DELAYS, seed: 'qk-b3', start: S0 },
    { id: 'b4', mode: 'collude', threat: { total: 1, perColumn: 1, gates: 1, integrators: 1 }, budget: 14, par: 11, recall: 0.85, delays: DEFAULT_DELAYS, seed: 'qk-b4', start: S0 },
    { id: 'b5', mode: 'silent', threat: { total: 99, perColumn: 1, gates: 1, integrators: 0 }, budget: 28, par: 27, recall: 0.95, delays: DEFAULT_DELAYS, seed: 'qk-b5', start: S0 },
    { id: 'b6', mode: 'collude', threat: { total: 99, perColumn: 1, gates: 0, integrators: 0 }, budget: 16, par: 11, recall: 0.35, delays: { sg: 0, gi: 3, io: 0 }, seed: 'qk-b6', start: S0 },
    { id: 'b7', mode: 'collude', threat: { total: 2, perColumn: 2, gates: 2, integrators: 2 }, budget: 24, par: 17, recall: 0.95, delays: DEFAULT_DELAYS, seed: 'qk-b7', start: S0 }
  ];
  // Break levels: the brain is fixed; budget = most faults the player may place; kinds = what may be hit.
  var BREAK = [
    { id: 'x1', mode: 'collude', goal: 'silence', budget: 2, kinds: ['sensory'], spec: { perColumn: 4, columns: 1, integrators: 1 } },
    { id: 'x2', mode: 'collude', goal: 'fool', budget: 1, kinds: ['sensory', 'gate', 'integrator'], spec: { perColumn: 3, columns: 3, integrators: 1 } },
    { id: 'x3', mode: 'collude', goal: 'fool', budget: 4, kinds: ['sensory'], spec: { perColumn: 3, columns: 3, integrators: 1 } },
    { id: 'x4', mode: 'collude', goal: 'fool', budget: 3, kinds: ['sensory'], spec: { perColumn: 3, columns: 3, integrators: 1 } },
    { id: 'x5', mode: 'collude', goal: 'fool', budget: 3, kinds: ['sensory', 'gate', 'integrator'], spec: { perColumn: 3, columns: 5, integrators: 3 } },
    { id: 'x6', mode: 'stuck', goal: 'fool', budget: 3, kinds: ['sensory', 'gate', 'integrator'], spec: { perColumn: 3, columns: 3, integrators: 3 } },
    { id: 'x7', mode: 'silent', goal: 'silence', budget: 3, kinds: ['sensory', 'gate'], spec: { perColumn: 3, columns: 5, integrators: 1 } }
  ];
  var LEVELS = BUILD.map(function (l) { return Object.assign({ kind: 'build' }, l); })
    .concat(BREAK.map(function (l) { return Object.assign({ kind: 'break', delays: DEFAULT_DELAYS }, l); }));
  function getLevel(id) { for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return LEVELS[i]; return null; }

  /* ---------- helpers ---------- */
  function int(v, lo, hi, dv) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dv; }
  function sid(k, i) { return 's' + k + '.' + i; }
  function choose(n, k) { if (k < 0 || k > n) return 0; var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }
  function sanitizeDesign(d, level) {
    d = d && typeof d === 'object' ? d : {};
    var s = (level && level.start) || { perColumn: 1, columns: 1, integrators: 1, stabilizer: false };
    return {
      perColumn: int(d.perColumn, 1, DESIGN_LIMITS.perColumn, s.perColumn),
      columns: int(d.columns, 1, DESIGN_LIMITS.columns, s.columns),
      integrators: int(d.integrators, 1, DESIGN_LIMITS.integrators, s.integrators),
      stabilizer: d.stabilizer === undefined ? !!s.stabilizer : !!d.stabilizer
    };
  }
  function archFor(level, design) {
    var d = sanitizeDesign(design, level);
    return B.buildArchitecture({
      perColumn: d.perColumn, columns: d.columns, integrators: d.integrators, stabilizer: d.stabilizer,
      memory: false, fuse: true, delays: level.delays || DEFAULT_DELAYS, jitter: 0, c: 0
    });
  }
  function breakArch(level) { return archFor(level, Object.assign({ stabilizer: false }, level.spec)); }

  /* ---------- symbolic evaluation ---------- */
  // items: one per voter, {s: symbol, t: arrival step} or null. The symbol that reaches the quorum
  // (at most one can, since 2q > n) is released at the time its q-th copy arrives. Junk symbols are
  // unique, so they only ever release on their own when q = 1.
  function voteSym(items, q) {
    var by = {}, best = null;
    items.forEach(function (x) { if (x && x.s !== null) (by[x.s] = by[x.s] || []).push(x.t); });
    Object.keys(by).forEach(function (s) {
      if (by[s].length < q) return;
      var ts = by[s].sort(function (a, b) { return a - b; }), t = ts[q - 1];
      if (!best || t < best.t) best = { s: s, t: t };
    });
    return best;
  }
  function hop(item, delay) {
    if (!item) return null;
    var t = item.t + delay * G.CHECK;
    return t > G.STEPS ? null : { s: item.s, t: t };
  }
  // faulty: map unit id -> true. Returns every unit's released symbol (null for nothing) and the outcome.
  function evaluate(arch, mode, faulty) {
    faulty = faulty || {};
    var dl = arch.spec.delays, junk = 0, k, i, j;
    var bogus = function () { return mode === 'silent' ? null : mode === 'collude' ? 'A' : 'J' + (junk++); };
    var emit = function (id) {
      if (!faulty[id]) return { s: 'T', t: G.CHECK };
      var b = bogus();
      return b === null ? null : { s: b, t: G.CHECK };
    };
    var sens = {}, gates = [], ints = [];
    for (k = 0; k < arch.columns; k++) {
      var ins = [];
      for (i = 0; i < arch.perColumn; i++) { var e = emit(sid(k, i)); sens[sid(k, i)] = e; ins.push(hop(e, dl.sg)); }
      if (faulty['g' + k]) { var b = bogus(); gates.push(b === null ? null : { s: b, t: G.CHECK }); }
      else gates.push(voteSym(ins, arch.quorum.gate));
    }
    for (j = 0; j < arch.integrators; j++) {
      if (faulty['i' + j]) { var bi = bogus(); ints.push(bi === null ? null : { s: bi, t: G.CHECK }); continue; }
      ints.push(voteSym(gates.map(function (x) { return hop(x, dl.gi); }), arch.quorum.integrator));
    }
    var out = voteSym(ints.map(function (x) { return hop(x, dl.io); }), arch.quorum.output);
    var sym = {};
    Object.keys(sens).forEach(function (id) { sym[id] = sens[id] ? sens[id].s : null; });
    gates.forEach(function (x, kk) { sym['g' + kk] = x ? x.s : null; });
    ints.forEach(function (x, jj) { sym['i' + jj] = x ? x.s : null; });
    sym.o = out ? out.s : null;
    return { outcome: !out ? 'none' : out.s === 'T' ? 'true' : 'false', out: out, sym: sym, gates: gates, ints: ints };
  }
  function symClass(s) { return s === null || s === undefined ? 'none' : s === 'T' ? 'true' : 'false'; }

  /* ---------- threats and the adversary ---------- */
  function sanitizeThreat(arch, t) {
    t = t && typeof t === 'object' ? t : {};
    var total = int(t.total, 0, 999, 0);
    return {
      total: total,
      perColumn: Math.min(arch.perColumn, int(t.perColumn, 0, 99, 0)),
      gates: Math.min(arch.columns, int(t.gates, 0, 99, 0)),
      integrators: Math.min(arch.integrators, int(t.integrators, 0, 99, 0))
    };
  }
  // A break level's budget as a threat: up to `budget` units of the allowed kinds.
  function breakThreat(level, arch) {
    var has = function (k) { return level.kinds.indexOf(k) >= 0; };
    return sanitizeThreat(arch, { total: level.budget, perColumn: has('sensory') ? arch.perColumn : 0, gates: has('gate') ? arch.columns : 0, integrators: has('integrator') ? arch.integrators : 0 });
  }
  // Explicit faulty map for a class: column states [{s, g}] in order, then `ints` integrators.
  function placementMap(cls) {
    var map = {};
    cls.cols.forEach(function (c, k) { for (var i = 0; i < c.s; i++) map[sid(k, i)] = true; if (c.g) map['g' + k] = true; });
    for (var j = 0; j < cls.ints; j++) map['i' + j] = true;
    return map;
  }
  function classSize(cls) {
    return cls.cols.reduce(function (n, c) { return n + c.s + c.g; }, cls.ints);
  }
  // Every placement class the threat allows, with its weight (how many explicit placements it covers).
  function placementClasses(arch, threat) {
    var T = sanitizeThreat(arch, threat), m = arch.perColumn, C = arch.columns, I = arch.integrators;
    var states = [];
    for (var gg = 0; gg <= (T.gates > 0 ? 1 : 0); gg++) for (var s = 0; s <= T.perColumn; s++) states.push({ s: s, g: gg });
    // heavier states first, so faults sit in the lowest columns
    states.sort(function (a, b) { return (b.s + b.g) - (a.s + a.g) || b.g - a.g; });
    var out = [], seq = [];
    var fact = function (n) { var r = 1; for (var i = 2; i <= n; i++) r *= i; return r; };
    var rec = function (start, used, gatesUsed) {
      if (seq.length === C) {
        var mult = {}, w = fact(C);
        seq.forEach(function (x) { mult[x] = (mult[x] || 0) + 1; });
        Object.keys(mult).forEach(function (x) { w /= fact(mult[x]); });
        seq.forEach(function (x) { w *= choose(m, states[x].s); });
        for (var j = 0; j <= Math.min(T.integrators, T.total - used); j++) {
          var cls = { cols: seq.map(function (x) { return { s: states[x].s, g: states[x].g }; }), ints: j };
          out.push({ cls: cls, weight: Math.round(w * choose(I, j)), faults: used + j });
        }
        return;
      }
      for (var x = start; x < states.length; x++) {
        var c = states[x].s + states[x].g;
        if (used + c > T.total || gatesUsed + states[x].g > T.gates) continue;
        seq.push(x); rec(x, used + c, gatesUsed + states[x].g); seq.pop();
      }
    };
    rec(0, 0, 0);
    return out;
  }
  // How close a holding placement comes to failing: the smaller, the more fragile.
  function slack(arch, ev) {
    var tg = ev.gates.filter(function (x) { return x && x.s === 'T'; }).length;
    var ti = ev.ints.filter(function (x) { return x && x.s === 'T'; }).length, gs = 0;
    for (var k = 0; k < arch.columns; k++) {
      if (!ev.gates[k] || ev.gates[k].s !== 'T' || ev.sym['g' + k] !== 'T') continue;
      var h = 0;
      for (var i = 0; i < arch.perColumn; i++) if (ev.sym[sid(k, i)] === 'T') h++;
      gs += h - arch.quorum.gate;
    }
    return [ti - arch.quorum.output, tg - arch.quorum.integrator, gs];
  }
  function lexLess(a, b) { for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; }
  // Tries every placement. Counts are of explicit placements. `fool` / `silence` are the
  // smallest counterexamples (fewest faults), `fragile` the holding placement with the least slack.
  function adversary(arch, mode, threat) {
    var classes = placementClasses(arch, threat), res = { total: 0, classes: classes.length, counts: { 'true': 0, 'false': 0, none: 0 }, fool: null, silence: null, fragile: null };
    var fragSlack = null;
    classes.forEach(function (c) {
      var map = placementMap(c.cls), ev = evaluate(arch, mode, map);
      res.total += c.weight; res.counts[ev.outcome] += c.weight;
      var rec = { faulty: map, faults: c.faults, eval: ev };
      if (ev.outcome === 'false' && (!res.fool || c.faults < res.fool.faults)) res.fool = rec;
      if (ev.outcome === 'none' && (!res.silence || c.faults < res.silence.faults)) res.silence = rec;
      if (ev.outcome === 'true') {
        var sl = slack(arch, ev).concat([-c.faults]);
        if (!fragSlack || lexLess(sl, fragSlack)) { fragSlack = sl; res.fragile = rec; }
      }
    });
    res.holds = res.counts['false'] === 0 && res.counts.none === 0;
    res.worst = res.fool || res.silence || null;
    return res;
  }

  /* ---------- build mode ---------- */
  function cost(arch) { return arch.counts.total; }
  function evaluateBuild(level, design) {
    var d = sanitizeDesign(design, level), arch = archFor(level, d), ck = B.checkArchitecture(arch);
    var adv = ck.ok ? adversary(arch, level.mode, level.threat) : null, c = cost(arch);
    return {
      design: d, arch: arch, check: ck, cost: c, budget: level.budget, overBudget: c > level.budget,
      adversary: adv, logicOk: !!adv && adv.holds, pass: ck.ok && c <= level.budget && !!adv && adv.holds,
      simPlacement: adv && adv.holds ? (adv.fragile ? adv.fragile.faulty : {}) : null
    };
  }
  // A brain.js run whose faults are the given explicit placement (brain.js itself only places
  // faults at the lowest indices by layer, so the map is set after creation).
  function createSim(level, evaluation, episodes) {
    var R = B.createBrainRun(evaluation.arch, { seed: level.seed, episodes: episodes || SIM_EPISODES, faults: { mode: level.mode } });
    R.fm = Object.assign({}, evaluation.simPlacement || {});
    return R;
  }
  function simulate(level, evaluation, episodes) {
    var R = createSim(level, evaluation, episodes);
    while (!B.brainDone(R)) B.stepBrainRun(R, 20);
    return B.finishBrainRun(R).summary;
  }
  function scoreBuild(level, ev, summary) {
    var s1 = ev.pass && !!summary && summary.F === 0;
    var s2 = s1 && summary.recall.p >= level.recall - 1e-9;
    var s3 = s2 && ev.cost <= level.par;
    return { stars: s3 ? 3 : s2 ? 2 : s1 ? 1 : 0, logic: ev.logicOk, budget: !ev.overBudget, wiring: ev.check.ok, falseOut: summary ? summary.F : null, recall: summary ? summary.recall.p : null, par: s3 };
  }

  /* ---------- break mode ---------- */
  function sanitizePick(level, arch, picked) {
    var ok = {}, n = 0, ids = {};
    arch.membranes.forEach(function (x) { ids[x.id] = x.kind; });
    Object.keys(picked || {}).forEach(function (id) {
      if (!picked[id] || !ids[id] || level.kinds.indexOf(ids[id]) < 0 || n >= level.budget) return;
      ok[id] = true; n++;
    });
    return ok;
  }
  function canPick(level, kind) { return level.kinds.indexOf(kind) >= 0; }
  function attack(level, picked) {
    var arch = breakArch(level), map = sanitizePick(level, arch, picked), ev = evaluate(arch, level.mode, map);
    var n = Object.keys(map).length;
    var win = level.goal === 'fool' ? ev.outcome === 'false' : ev.outcome === 'none';
    return { arch: arch, faulty: map, used: n, eval: ev, outcome: ev.outcome, win: win };
  }
  function solveBreak(level) {
    var arch = breakArch(level), adv = adversary(arch, level.mode, breakThreat(level, arch));
    var ex = level.goal === 'fool' ? adv.fool : adv.silence;
    return { arch: arch, breakable: !!ex, minFaults: ex ? ex.faults : null, example: ex ? ex.faulty : null, total: adv.total, counts: adv.counts };
  }
  // state: {won, claimedSafe (true when the player claimed it cannot be broken and was right), misses, used}
  function scoreBreak(level, sol, state) {
    if (!state || !state.won) return { stars: 0 };
    var first = (state.misses || 0) === 0;
    var tight = sol.breakable ? state.used === sol.minFaults : true;
    return { stars: 1 + (first ? 1 : 0) + (tight ? 1 : 0), first: first, tight: tight };
  }

  /* ---------- drawing: an SVG string, no DOM ---------- */
  var PAL = { sensory: '#40d0e0', gate: '#c9a84c', integrator: '#7aa8ff', output: '#e0c36a', inhibitory: '#ff9a9a', memory: '#5ee6b8', tube: '#b3bedb', bg: '#0a1330', text: '#eef2ff', T: '#2fbf8f', F: '#e2504c', none: '#2a3866', fault: '#ffb0b0', pick: '#ffd36b' };
  var HCP = { sensory: '#ffffff', gate: '#ffffff', integrator: '#ffffff', output: '#ffffff', inhibitory: '#ffffff', memory: '#ffffff', tube: '#ffffff', bg: '#000000', text: '#ffffff', T: '#ffffff', F: '#000000', none: '#000000', fault: '#ffffff', pick: '#ffffff' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function shapeOf(kind, x, y, col, fill, sw) {
    var a = ' fill="' + fill + '" stroke="' + col + '" stroke-width="' + sw + '"';
    var poly = function (pts) { return '<polygon points="' + pts.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join(' ') + '"' + a + '/>'; };
    if (kind === 'sensory') return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="12"' + a + '/>';
    if (kind === 'gate') return poly([[x, y - 16], [x + 16, y], [x, y + 16], [x - 16, y]]);
    if (kind === 'integrator') { var h = []; for (var q = 0; q < 6; q++) h.push([x + 19 * Math.cos(Math.PI / 3 * q), y + 19 * Math.sin(Math.PI / 3 * q)]); return poly(h); }
    if (kind === 'output') return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="20"' + a + '/>';
    return '<rect x="' + r1(x - 14) + '" y="' + r1(y - 14) + '" width="28" height="28"' + a + '/>';
  }
  // opts: {faulty: map, sym: map id -> symbol (after a test or attack), hc, pickable: [kinds],
  //        labels: {column, gate, integrator, output, inhibitory, T, F, none}, unitLabel(id, kind) -> text,
  //        title, desc}
  function render(arch, opts) {
    opts = opts || {};
    var L = B.layout(arch), P = L.pos, pal = opts.hc ? HCP : PAL, fm = opts.faulty || {}, sym = opts.sym || null;
    var lab = opts.labels || {}, pick = opts.pickable || [], out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.W + ' ' + L.H + '" width="' + L.W + '" height="' + L.H + '" role="group" aria-labelledby="qt qd">');
    out.push('<title id="qt">' + esc(opts.title || 'Brain') + '</title><desc id="qd">' + esc(opts.desc || B.describe(arch)) + '</desc>');
    out.push('<rect width="100%" height="100%" fill="' + pal.bg + '"/>');
    for (var k = 0; k < arch.columns; k++) {
      var fx = L.x0 + k * L.colW + 4;
      out.push('<rect x="' + r1(fx) + '" y="40" width="' + r1(L.colW - 8) + '" height="165" rx="10" fill="none" stroke="' + pal.tube + '" stroke-opacity="0.35" stroke-dasharray="3 4"/>');
      out.push('<text x="' + r1(fx + 8) + '" y="34" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc((lab.column || 'column') + ' ' + (k + 1)) + '</text>');
    }
    arch.microtubules.forEach(function (e) {
      var a = P[e.from], b = P[e.to];
      if (!a || !b) return;
      var cls = sym && e.kind === 'signal' ? symClass(sym[e.from]) : 'idle';
      var col = cls === 'true' ? pal.T : cls === 'false' ? (opts.hc ? '#ffffff' : pal.F) : pal.tube;
      var op = cls === 'idle' ? 0.8 : cls === 'none' ? 0.25 : 1, w = cls === 'true' || cls === 'false' ? 2.6 : 1.4;
      var dash = e.kind === 'modulatory' ? ' stroke-dasharray="6 5"' : cls === 'false' && opts.hc ? ' stroke-dasharray="2 3"' : '';
      out.push('<g class="mt" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" data-carry="' + cls + '">');
      out.push('<line x1="' + r1(a.x) + '" y1="' + r1(a.y) + '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '" stroke="' + col + '" stroke-opacity="' + op + '" stroke-width="' + w + '"' + dash + '/>');
      if (e.kind === 'signal' && e.delay > 0 && e.from.charAt(0) !== 's') {
        var mx = a.x + (b.x - a.x) * 0.55, my = a.y + (b.y - a.y) * 0.55;
        out.push('<text x="' + r1(mx + 4) + '" y="' + r1(my) + '" fill="' + pal.text + '" font-size="10" font-family="system-ui, sans-serif">+' + e.delay + '</text>');
      }
      out.push('</g>');
    });
    arch.membranes.forEach(function (x) {
      var p = P[x.id], bad = !!fm[x.id], canPickIt = pick.indexOf(x.kind) >= 0, s = sym ? sym[x.id] : undefined;
      var cls = s === undefined ? 'idle' : symClass(s);
      var fill = cls === 'true' ? pal.T : cls === 'false' ? pal.F : pal.bg;
      var attrs = ' class="membrane' + (canPickIt ? ' pickable' : '') + '" data-id="' + esc(x.id) + '" data-kind="' + x.kind + '" data-sym="' + cls + '"' + (bad ? ' data-faulty="1"' : '');
      if (canPickIt) attrs += ' role="button" tabindex="0" aria-pressed="' + (bad ? 'true' : 'false') + '"';
      if (opts.unitLabel) attrs += ' aria-label="' + esc(opts.unitLabel(x.id, x.kind, bad, cls)) + '"';
      out.push('<g' + attrs + '>');
      if (canPickIt) out.push('<circle cx="' + r1(p.x) + '" cy="' + r1(p.y) + '" r="17" fill="' + pal.bg + '" fill-opacity="0.01" class="hit"/>');
      out.push(shapeOf(x.kind, p.x, p.y, bad ? pal.pick : pal[x.kind], fill, bad ? 3.5 : 2));
      if (cls === 'true' || cls === 'false') {
        var g = cls === 'true' ? (lab.T || 'T') : (lab.F || 'F');
        out.push('<text x="' + r1(p.x) + '" y="' + r1(p.y + 4) + '" text-anchor="middle" fill="' + (opts.hc ? (cls === 'true' ? '#000000' : '#ffffff') : '#06101f') + '" font-size="11" font-weight="700" font-family="system-ui, sans-serif">' + esc(g) + '</text>');
      }
      if (bad) out.push('<path d="M' + r1(p.x - 15) + ' ' + r1(p.y - 15) + 'l7 7M' + r1(p.x + 15) + ' ' + r1(p.y - 15) + 'l-7 7M' + r1(p.x - 15) + ' ' + r1(p.y + 15) + 'l7 -7M' + r1(p.x + 15) + ' ' + r1(p.y + 15) + 'l-7 -7" stroke="' + pal.pick + '" stroke-width="2.5"/>');
      out.push('</g>');
    });
    var tl = function (txt, y) { out.push('<text x="8" y="' + y + '" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc(txt) + '</text>'); };
    tl((lab.gate || 'gate') + ' ' + arch.quorum.gate + '/' + arch.perColumn, 200);
    tl((lab.integrator || 'integrator') + ' ' + arch.quorum.integrator + '/' + arch.columns, 305);
    tl((lab.output || 'output') + ' ' + arch.quorum.output + '/' + arch.integrators, 400);
    if (P.z) out.push('<text x="' + r1(P.z.x) + '" y="' + r1(P.z.y + 30) + '" text-anchor="middle" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc(lab.inhibitory || 'inhibitory') + '</text>');
    out.push('</svg>');
    return out.join('');
  }

  /* ---------- plain-text result card ---------- */
  function shareText(rows, t) {
    // rows: [{id, stars}], t: translate function
    var lines = [t('share.title'), t('share.tag')];
    rows.forEach(function (r) { lines.push(r.id.toUpperCase() + ' ' + '*'.repeat(r.stars) + '-'.repeat(3 - r.stars)); });
    var sum = rows.reduce(function (a, r) { return a + r.stars; }, 0);
    lines.push(t('share.total', { n: sum, max: 3 * rows.length }));
    return lines.join('\n');
  }

  return {
    VERSION: VERSION, MODES: MODES, GOALS: GOALS, LEVELS: LEVELS, SIM_EPISODES: SIM_EPISODES, DESIGN_LIMITS: DESIGN_LIMITS,
    getLevel: getLevel, sanitizeDesign: sanitizeDesign, archFor: archFor, breakArch: breakArch,
    voteSym: voteSym, evaluate: evaluate, symClass: symClass,
    sanitizeThreat: sanitizeThreat, breakThreat: breakThreat, placementClasses: placementClasses, placementMap: placementMap,
    classSize: classSize, adversary: adversary, slack: slack, choose: choose,
    cost: cost, evaluateBuild: evaluateBuild, createSim: createSim, simulate: simulate, scoreBuild: scoreBuild,
    sanitizePick: sanitizePick, canPick: canPick, attack: attack, solveBreak: solveBreak, scoreBreak: scoreBreak,
    render: render, shareText: shareText
  };
});
