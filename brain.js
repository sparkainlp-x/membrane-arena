/*
 * Membrane Arena: brain architecture of many membranes joined by microtubules
 * (SYNTHETIC classical simulation).
 *
 * A layered network built from the same Oja-rule membrane as game.js:
 *
 *   sensory membranes  -> learn the planted pattern from noisy observations
 *   gate membranes     -> one per column, release a vector when a strict
 *                         majority of the column's sensory membranes agree
 *   integrator         -> release a vector when a strict majority of columns agree
 *   output membrane    -> release the final event when a strict majority of
 *                         integrators agree
 *   inhibitory         -> optional; the stabilizer of game.js (leaky output
 *                         rate scales every sensory gain)
 *   memory             -> optional; the capped amplifier of game.js (warm start
 *                         from the last output)
 *
 * A "microtubule" here is a directed transport link between two membranes with
 * a delay (in check periods of 10 steps) and an optional transport noise. The
 * name borrows the cell's transport filaments as a metaphor; nothing here is a
 * model of real microtubules, neurons or a brain.
 *
 * How many membranes of each kind are necessary follows from counting votes:
 * a layer of n voters with a strict-majority quorum q = floor(n / 2) + 1 keeps
 * f faulty voters from releasing anything on their own (f < q) and still lets
 * the honest ones release (n - f >= q) exactly when n >= 2f + 1. The planner
 * therefore uses 2f + 1 sensory membranes per column, 2g + 1 columns and
 * 2h + 1 integrators for f, g and h tolerated faults. tests/brain.test.js
 * checks this by exhaustive enumeration with the same quorum code.
 *
 * Pure functions, no DOM, no network, no storage.
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game.js'), require('./stats.js'));
  else root.ArenaBrain = factory(root.ArenaGame, root.ArenaStats);
})(typeof self !== 'undefined' ? self : this, function (G, ST) {
  'use strict';
  var VERSION = '0.3.0';
  var NS = 'membrane-arena/brain/v1/';      // generator namespace for brain runs
  var KINDS = ['sensory', 'gate', 'integrator', 'output', 'inhibitory', 'memory'];
  var MODES = ['collude', 'stuck', 'silent'];
  var CHECKS = G.STEPS / G.CHECK;            // 6 check points per episode
  var LIMITS = { f: 3, g: 2, h: 2, perColumn: 9, columns: 7, integrators: 5, delay: 5, jitter: 0.3, episodes: 2000 };
  var SP = 0.5;                              // self-knowledge held at the game's starting value

  // the truth label of game.js: planted episode and fidelity to the pattern at least 0.5
  function isTrueEvent(vec, pat) { return !!vec && !!pat && G.fidelity(vec, pat) >= G.TRUTH; }

  /* ---------- counting rules ---------- */
  function replicasFor(f) { return 2 * f + 1; }
  function quorum(n) { return Math.floor(n / 2) + 1; }
  function tolerated(n) { return n >= 1 ? Math.floor((n - 1) / 2) : -1; }

  function int(v, lo, hi, dv) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dv; }
  function num(v, lo, hi, dv) { v = Number(v); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dv; }
  function bool(v, dv) { return v === undefined ? dv : !!v; }

  var DEFAULT_REQ = {
    sensoryFaults: 1, columnFaults: 1, integratorFaults: 0, stabilizer: true, memory: false, fuse: true,
    delays: { sg: 0, gi: 1, io: 0 }, jitter: 0, th: G.DEFAULTS.th, c: 0, g: G.DEFAULTS.g
  };
  // Coupling defaults to 0 here (the game's start is 0.05): coupling pulls each membrane toward its
  // peers' states, so a faulty peer's vector leaks into honest voters and the vote count no longer
  // bounds what faults can do. docs/brain-check.txt measures this.

  function sanitizeDelays(d, dv) {
    d = d && typeof d === 'object' ? d : {};
    return { sg: int(d.sg, 0, LIMITS.delay, dv.sg), gi: int(d.gi, 0, LIMITS.delay, dv.gi), io: int(d.io, 0, LIMITS.delay, dv.io) };
  }
  function sanitizeCommon(r, out) {
    var d = DEFAULT_REQ;
    out.stabilizer = bool(r.stabilizer, d.stabilizer);
    out.memory = bool(r.memory, d.memory);
    out.fuse = bool(r.fuse, d.fuse);
    out.delays = sanitizeDelays(r.delays, d.delays);
    out.jitter = num(r.jitter, 0, LIMITS.jitter, d.jitter);
    out.th = num(r.th, 0.1, 1.2, d.th);
    out.c = num(r.c, 0, 0.5, d.c);
    out.g = num(r.g, 0.5, 2, d.g);
    return out;
  }
  function sanitizeRequirements(r) {
    r = r && typeof r === 'object' ? r : {};
    var d = DEFAULT_REQ;
    return sanitizeCommon(r, {
      sensoryFaults: int(r.sensoryFaults, 0, LIMITS.f, d.sensoryFaults),
      columnFaults: int(r.columnFaults, 0, LIMITS.g, d.columnFaults),
      integratorFaults: int(r.integratorFaults, 0, LIMITS.h, d.integratorFaults)
    });
  }
  function sanitizeSpec(s) {
    s = s && typeof s === 'object' ? s : {};
    return sanitizeCommon(s, {
      perColumn: int(s.perColumn, 1, LIMITS.perColumn, 3),
      columns: int(s.columns, 1, LIMITS.columns, 3),
      integrators: int(s.integrators, 1, LIMITS.integrators, 1)
    });
  }

  /* ---------- architecture: membranes and microtubules ---------- */
  function sid(k, i) { return 's' + k + '.' + i; }
  function buildArchitecture(spec) {
    var s = sanitizeSpec(spec), C = s.columns, m = s.perColumn, I = s.integrators, k, i, j;
    var mem = [], mt = [];
    var add = function (from, to, kind, delay, jitter) {
      mt.push({ id: 'mt' + mt.length, from: from, to: to, kind: kind, delay: delay, jitter: jitter });
    };
    for (k = 0; k < C; k++) for (i = 0; i < m; i++) mem.push({ id: sid(k, i), kind: 'sensory', layer: 0, column: k, index: i });
    for (k = 0; k < C; k++) mem.push({ id: 'g' + k, kind: 'gate', layer: 1, column: k, index: k });
    for (j = 0; j < I; j++) mem.push({ id: 'i' + j, kind: 'integrator', layer: 2, column: null, index: j });
    mem.push({ id: 'o', kind: 'output', layer: 3, column: null, index: 0 });
    if (s.stabilizer) mem.push({ id: 'z', kind: 'inhibitory', layer: -1, column: null, index: 0 });
    if (s.memory) mem.push({ id: 'mem', kind: 'memory', layer: -1, column: null, index: 0 });
    for (k = 0; k < C; k++) for (i = 0; i < m; i++) add(sid(k, i), 'g' + k, 'signal', s.delays.sg, 0);
    for (k = 0; k < C; k++) for (j = 0; j < I; j++) add('g' + k, 'i' + j, 'signal', s.delays.gi, s.jitter);
    for (j = 0; j < I; j++) add('i' + j, 'o', 'signal', s.delays.io, 0);
    if (s.stabilizer) { add('o', 'z', 'modulatory', 0, 0); for (k = 0; k < C; k++) add('z', 'g' + k, 'modulatory', 0, 0); }
    if (s.memory) { add('o', 'mem', 'modulatory', 0, 0); for (k = 0; k < C; k++) add('mem', 'g' + k, 'modulatory', 0, 0); }
    var counts = { total: mem.length };
    KINDS.forEach(function (kd) { counts[kd] = mem.filter(function (x) { return x.kind === kd; }).length; });
    var sig = mt.filter(function (e) { return e.kind === 'signal'; }).length;
    return {
      version: VERSION, spec: s, columns: C, perColumn: m, integrators: I,
      membranes: mem, microtubules: mt,
      quorum: { gate: quorum(m), integrator: quorum(C), output: quorum(I) },
      counts: counts, tubes: { signal: sig, modulatory: mt.length - sig, total: mt.length },
      plan: null
    };
  }

  // The smallest architecture that meets the requirements, with the rule behind each count.
  function planArchitecture(req) {
    var r = sanitizeRequirements(req);
    var m = replicasFor(r.sensoryFaults), C = replicasFor(r.columnFaults), I = replicasFor(r.integratorFaults);
    var arch = buildArchitecture({
      perColumn: m, columns: C, integrators: I, stabilizer: r.stabilizer, memory: r.memory, fuse: r.fuse,
      delays: r.delays, jitter: r.jitter, th: r.th, c: r.c, g: r.g
    });
    arch.req = r;
    arch.plan = [
      { kind: 'sensory', count: C * m, rule: 'sensory', vars: { f: r.sensoryFaults, n: m, q: quorum(m), cols: C } },
      { kind: 'gate', count: C, rule: 'gate', vars: { cols: C, q: quorum(m) } },
      { kind: 'integrator', count: I, rule: 'integrator', vars: { h: r.integratorFaults, n: I, g: r.columnFaults, cols: C, q: quorum(C) } },
      { kind: 'output', count: 1, rule: 'output', vars: { q: quorum(I), n: I } },
      { kind: 'inhibitory', count: r.stabilizer ? 1 : 0, rule: r.stabilizer ? 'inhibitory' : 'inhibitory_off', vars: {} },
      { kind: 'memory', count: r.memory ? 1 : 0, rule: r.memory ? 'memory' : 'memory_off', vars: {} }
    ];
    return arch;
  }

  /* ---------- structural checks ---------- */
  function signalGraph(arch) {
    var ids = {}, out = {}, indeg = {}, bad = [];
    arch.membranes.forEach(function (x) { ids[x.id] = x; out[x.id] = []; indeg[x.id] = 0; });
    arch.microtubules.forEach(function (e) {
      if (!ids[e.from] || !ids[e.to]) { bad.push(e.id); return; }
      if (e.kind !== 'signal') return;
      out[e.from].push(e); indeg[e.to]++;
    });
    return { ids: ids, out: out, indeg: indeg, dangling: bad };
  }
  // Kahn's algorithm; returns the order, or null when the signal graph has a cycle.
  function topoOrder(gr) {
    var indeg = {}, q = [], order = [];
    Object.keys(gr.indeg).forEach(function (k) { indeg[k] = gr.indeg[k]; if (!indeg[k]) q.push(k); });
    while (q.length) {
      var u = q.shift(); order.push(u);
      gr.out[u].forEach(function (e) { if (--indeg[e.to] === 0) q.push(e.to); });
    }
    return order.length === Object.keys(indeg).length ? order : null;
  }

  function checkArchitecture(arch, req) {
    var problems = [], gr = signalGraph(arch), order = topoOrder(gr);
    var err = function (code, vars) { problems.push({ level: 'error', code: code, vars: vars || {} }); };
    var warn = function (code, vars) { problems.push({ level: 'warning', code: code, vars: vars || {} }); };
    var note = function (code, vars) { problems.push({ level: 'note', code: code, vars: vars || {} }); };
    var layers = [['sensory', arch.perColumn], ['column', arch.columns], ['integrator', arch.integrators]];
    var tol = { sensory: tolerated(arch.perColumn), column: tolerated(arch.columns), integrator: tolerated(arch.integrators) };
    layers.forEach(function (L) {
      if (!(L[1] >= 1)) err('empty_layer', { layer: L[0] });
      else if (L[1] % 2 === 0) warn('even', { layer: L[0], n: L[1], f: tolerated(L[1]) });
    });
    if (arch.counts.output !== 1) err('output_count', { n: arch.counts.output });
    if (gr.dangling.length) err('dangling', { ids: gr.dangling.join(', ') });
    var longest = null;
    if (!order) err('cycle');
    else {
      // longest signal delay from any sensory membrane to the output, and reachability
      var dist = {};
      order.forEach(function (u) {
        if (gr.ids[u].kind === 'sensory') dist[u] = 0;
        if (dist[u] === undefined) return;
        gr.out[u].forEach(function (e) { var d = dist[u] + e.delay; if (dist[e.to] === undefined || d > dist[e.to]) dist[e.to] = d; });
      });
      var cut = arch.membranes.filter(function (x) {
        if (x.kind !== 'sensory') return false;
        var seen = {}, st = [x.id];
        while (st.length) { var u = st.pop(); if (seen[u]) continue; seen[u] = true; gr.out[u].forEach(function (e) { st.push(e.to); }); }
        return !seen.o;
      });
      if (cut.length) err('unreachable', { n: cut.length });
      longest = dist.o === undefined ? null : dist.o;
      // the first declaration can happen at the first check; every later hop adds delay * CHECK steps
      if (longest !== null && 1 + longest > CHECKS) err('deadline', { d: longest, max: CHECKS - 1 });
      else if (longest !== null) note('slack', { d: longest, slack: CHECKS - 1 - longest });
    }
    if (arch.spec.c > 0 && arch.perColumn > 1) {
      var needF = req ? sanitizeRequirements(req).sensoryFaults : 0;
      (needF > 0 ? err : warn)('coupling_channel', { c: arch.spec.c });
    }
    if (req) {
      var r = sanitizeRequirements(req);
      [['sensory', r.sensoryFaults], ['column', r.columnFaults], ['integrator', r.integratorFaults]].forEach(function (x) {
        var have = tol[x[0]];
        if (have < x[1]) err('below_requirement', { layer: x[0], need: x[1], have: Math.max(0, have) });
        else if (have > x[1]) note('above_requirement', { layer: x[0], need: x[1], have: have });
      });
    }
    note('single_points', { kinds: ['output'].concat(arch.spec.stabilizer ? ['inhibitory'] : [], arch.spec.memory ? ['memory'] : []).join(', ') });
    return {
      ok: !problems.some(function (p) { return p.level === 'error'; }),
      problems: problems, tolerance: tol, longestDelay: longest,
      slack: longest === null ? null : CHECKS - 1 - longest
    };
  }

  /* ---------- one column of coupled sensory membranes ---------- */
  // Mirrors game.js episode() draw for draw: with 3 honest members it gives the same declarations.
  // Coupling to each peer is scaled by 2 / (m - 1), so the total pull matches the three-membrane case.
  // faulty[i]: membrane i ignores its observations; bogus[i] is the vector it declares at the first
  // check (null means it stays silent). Its state vector is that bogus vector, so peers are pulled to it.
  function columnEpisode(n, pat, sigma, P, warm, amp, rng, faulty, bogus) {
    var m = P.length, cs = m > 1 ? 2 / (m - 1) : 0, vs = [], win = [], decl = [], declStep = [], thr = [], i, j, k, t;
    faulty = faulty || []; bogus = bogus || [];
    for (i = 0; i < m; i++) { vs.push(G.warmStart(G.rvec(n, rng), warm, amp)); win.push([]); decl.push(null); declStep.push(null); }
    for (i = 0; i < m; i++) if (faulty[i] && bogus[i]) vs[i] = G.copyVec(bogus[i]);
    for (i = 0; i < m; i++) thr.push(G.scaledThreshold(Math.min(1.5, P[i].th * (2 - P[i].sp)), n, sigma));
    var updates = 0;
    for (t = 1; t <= G.STEPS; t++) {
      for (i = 0; i < m; i++) {
        if (decl[i]) continue;
        var x = pat ? G.noisy(pat, sigma, rng) : G.rvec(n, rng);
        if (faulty[i]) continue;
        var y = G.inner(x, vs[i]);
        win[i].push(y.re * y.re + y.im * y.im);
        if (win[i].length > 5) win[i].shift();
        var v = { r: new Float64Array(n), i: new Float64Array(n) }, c = P[i].c * cs;
        for (k = 0; k < n; k++) {
          v.r[k] = vs[i].r[k] + 0.5 * (x.r[k] * y.re - x.i[k] * y.im);
          v.i[k] = vs[i].i[k] + 0.5 * (x.r[k] * y.im + x.i[k] * y.re);
        }
        if (c > 0) {
          for (j = 0; j < m; j++) {
            if (j === i) continue;
            var ph = G.inner(vs[j], v), mg = Math.sqrt(ph.re * ph.re + ph.im * ph.im), pr = 1, pi = 0;
            if (mg > 0) { pr = ph.re / mg; pi = ph.im / mg; }
            for (k = 0; k < n; k++) {
              v.r[k] += c * (pr * vs[j].r[k] - pi * vs[j].i[k]);
              v.i[k] += c * (pr * vs[j].i[k] + pi * vs[j].r[k]);
            }
          }
        }
        vs[i] = G.normalize(v);
        updates++;
      }
      if (t % G.CHECK === 0) {
        for (i = 0; i < m; i++) {
          if (decl[i]) continue;
          if (faulty[i]) { if (bogus[i]) { decl[i] = G.copyVec(bogus[i]); declStep[i] = t; } continue; }
          if (P[i].geff * G.energyRatio(win[i], n) >= thr[i]) { decl[i] = G.copyVec(vs[i]); declStep[i] = t; }
        }
      }
    }
    return { decl: decl, declStep: declStep, thr: thr, updates: updates };
  }

  /* ---------- quorum, fusion and transport ---------- */
  // Phase-align every vector to the first and average: the direction a few Oja steps on them would reach.
  function fuseVecs(vecs) {
    var ref = vecs[0], n = ref.r.length, o = { r: new Float64Array(n), i: new Float64Array(n) };
    vecs.forEach(function (v) {
      var z = G.inner(v, ref), mg = Math.sqrt(z.re * z.re + z.im * z.im), pr = 1, pi = 0;
      if (mg > 0) { pr = z.re / mg; pi = z.im / mg; }
      for (var k = 0; k < n; k++) { o.r[k] += pr * v.r[k] - pi * v.i[k]; o.i[k] += pr * v.i[k] + pi * v.r[k]; }
    });
    return G.normalize(o);
  }
  // inputs: one entry per voter, in index order, {vec, t} or null. A release happens at the earliest
  // time t at which some available vector is matched (fidelity >= AGREE, itself included) by at least q
  // available vectors; the lowest such index leads. One release per episode, as with the 2-of-3 shield.
  function quorumRelease(inputs, q, fuse) {
    var times = [], i, j;
    inputs.forEach(function (x) { if (x && x.vec && times.indexOf(x.t) < 0) times.push(x.t); });
    times.sort(function (a, b) { return a - b; });
    for (var a = 0; a < times.length; a++) {
      var t = times[a], avail = [];
      for (i = 0; i < inputs.length; i++) if (inputs[i] && inputs[i].vec && inputs[i].t <= t) avail.push(i);
      for (var b = 0; b < avail.length; b++) {
        i = avail[b];
        var S = [];
        for (var c = 0; c < avail.length; c++) { j = avail[c]; if (G.fidelity(inputs[i].vec, inputs[j].vec) >= G.AGREE) S.push(j); }
        if (S.length >= q) {
          // put the leader first so fusion aligns to it
          var vs = [inputs[i].vec].concat(S.filter(function (x) { return x !== i; }).map(function (x) { return inputs[x].vec; }));
          return { t: t, vec: fuse ? fuseVecs(vs) : G.copyVec(inputs[i].vec), members: S, lead: i };
        }
      }
    }
    return null;
  }
  function transport(item, edge, trng, tally) {
    if (!item || !item.vec) return null;
    var t = item.t + edge.delay * G.CHECK;
    if (t > G.STEPS) { tally.lost++; return null; }
    tally.moved++;
    return { t: t, vec: edge.jitter > 0 ? G.noisy(item.vec, edge.jitter, trng) : item.vec };
  }
  function edgeIndex(arch) {
    var idx = {};
    arch.microtubules.forEach(function (e) { if (e.kind === 'signal') idx[e.from + '>' + e.to] = e; });
    return idx;
  }
  // From the sensory declarations to the output. cols[k] = {decl, declStep}; faultyGate[k] / faultyInt[j]
  // are vectors a compromised gate / integrator emits at the first check (null: honest or silent).
  function runPipeline(arch, cols, faultyGate, faultyInt, trng, gateSilent, intSilent) {
    var E = edgeIndex(arch), fuse = arch.spec.fuse, tally = { lost: 0, moved: 0 }, gates = [], ints = [], k, i, j;
    faultyGate = faultyGate || []; faultyInt = faultyInt || []; gateSilent = gateSilent || []; intSilent = intSilent || [];
    for (k = 0; k < arch.columns; k++) {
      if (faultyGate[k] || gateSilent[k]) { gates.push(faultyGate[k] ? { t: G.CHECK, vec: faultyGate[k], members: [], lead: -1 } : null); continue; }
      var ins = [];
      for (i = 0; i < arch.perColumn; i++) ins.push(transport({ vec: cols[k].decl[i], t: cols[k].declStep[i] }, E[sid(k, i) + '>g' + k], trng, tally));
      gates.push(quorumRelease(ins, arch.quorum.gate, fuse));
    }
    for (j = 0; j < arch.integrators; j++) {
      if (faultyInt[j] || intSilent[j]) { ints.push(faultyInt[j] ? { t: G.CHECK, vec: faultyInt[j], members: [], lead: -1 } : null); continue; }
      var gin = [];
      for (k = 0; k < arch.columns; k++) gin.push(transport(gates[k], E['g' + k + '>i' + j], trng, tally));
      ints.push(quorumRelease(gin, arch.quorum.integrator, fuse));
    }
    var oin = [];
    for (j = 0; j < arch.integrators; j++) oin.push(transport(ints[j], E['i' + j + '>o'], trng, tally));
    return { out: quorumRelease(oin, arch.quorum.output, fuse), gates: gates, ints: ints, lost: tally.lost, moved: tally.moved };
  }

  /* ---------- fault placement ---------- */
  function sanitizeFaults(arch, f) {
    f = f && typeof f === 'object' ? f : {};
    return {
      sensory: int(f.sensory, 0, arch.perColumn, 0),
      sensoryColumns: int(f.sensoryColumns, 0, arch.columns, arch.columns),
      columns: int(f.columns, 0, arch.columns, 0),
      integrators: int(f.integrators, 0, arch.integrators, 0),
      mode: MODES.indexOf(f.mode) >= 0 ? f.mode : 'collude'
    };
  }
  // Faulty units take the lowest indices, the worst place for them because a quorum's leader is the
  // lowest qualifying index. Faulty sensory membranes sit in the first `sensoryColumns` columns.
  function faultMap(arch, faults) {
    var F = sanitizeFaults(arch, faults), map = {}, k, i;
    for (k = 0; k < F.sensoryColumns; k++) for (i = 0; i < F.sensory; i++) map[sid(k, i)] = true;
    for (k = 0; k < F.columns; k++) map['g' + k] = true;
    for (k = 0; k < F.integrators; k++) map['i' + k] = true;
    return { spec: F, map: map };
  }

  /* ---------- logic-level evaluation (no learning, symbolic votes) ---------- */
  // Every honest sensory membrane declares the true vector at the first check; faulty units act by
  // mode. Returns 'true', 'false' or 'none' for the output. Used to check the counting rules exhaustively.
  function logicOutcome(arch, faults, faultySet) {
    // one dimension per possible faulty unit, so stuck units never agree with each other or with T and A
    var n = 2 + LIMITS.perColumn * LIMITS.columns + LIMITS.columns + LIMITS.integrators, F = sanitizeFaults(arch, faults), fm = faultySet || faultMap(arch, F).map;
    var T = { r: new Float64Array(n), i: new Float64Array(n) }, A = { r: new Float64Array(n), i: new Float64Array(n) };
    T.r[0] = 1; A.r[1] = 1;
    var junk = 2, bog = function () {
      if (F.mode === 'silent') return null;
      if (F.mode === 'collude') return A;
      var v = { r: new Float64Array(n), i: new Float64Array(n) }; v.r[junk] = 1; junk++; return v;
    };
    var cols = [], fg = [], fi = [], gs = [], is = [], k, i;
    for (k = 0; k < arch.columns; k++) {
      var d = [], s = [];
      for (i = 0; i < arch.perColumn; i++) {
        var b = fm[sid(k, i)] ? bog() : T;
        d.push(b); s.push(b ? G.CHECK : null);
      }
      cols.push({ decl: d, declStep: s });
      fg.push(fm['g' + k] ? bog() : null); gs.push(!!fm['g' + k] && F.mode === 'silent');
    }
    for (k = 0; k < arch.integrators; k++) { fi.push(fm['i' + k] ? bog() : null); is.push(!!fm['i' + k] && F.mode === 'silent'); }
    var res = runPipeline(arch, cols, fg, fi, null, gs, is);
    if (!res.out) return 'none';
    return G.fidelity(res.out.vec, T) >= G.TRUTH ? 'true' : 'false';
  }

  /* ---------- simulation ---------- */
  function sanitizeRun(arch, o) {
    o = o && typeof o === 'object' ? o : {};
    return {
      seed: typeof o.seed === 'string' && o.seed.length <= 40 ? o.seed : 'brain1',
      episodes: int(o.episodes, 2, LIMITS.episodes, 100),
      faults: sanitizeFaults(arch, o.faults)
    };
  }
  // A run that can be stepped a few episodes at a time (the page does this to stay responsive).
  function createBrainRun(arch, opts) {
    var o = sanitizeRun(arch, opts), fm = faultMap(arch, o.faults).map, s = arch.spec;
    return {
      arch: arch, opts: o, fm: fm, e: 0, episodes: [], rateEma: G.TARGET, warm: null,
      g: s.stabilizer ? G.clampGain(s.g) : s.g, main: G.makeRng(NS + o.seed + '/main'),
      refK: arch.columns - 1, refI: arch.perColumn - 1                 // the reference membrane
    };
  }
  function brainDone(R) { return R.e >= R.opts.episodes; }
  function stepBrainRun(R, count) {
    var arch = R.arch, s = arch.spec, F = R.opts.faults, fm = R.fm, n = G.N, sigma = G.sigmaFor(n), seed = R.opts.seed, k, i;
    count = Math.max(1, count || 1);
    for (var step = 0; step < count && !brainDone(R); step++) {
      var e = R.e, planted = e % 2 === 0, pat = planted ? G.rvec(n, R.main) : null;
      var frng = G.makeRng(NS + seed + '/e' + e + '/fault'), trng = G.makeRng(NS + seed + '/e' + e + '/mt');
      var A = F.mode === 'collude' ? G.rvec(n, frng) : null;
      var bog = function () { return F.mode === 'silent' ? null : F.mode === 'collude' ? G.copyVec(A) : G.rvec(n, frng); };
      var geff = R.g * (s.stabilizer ? G.stabilizerFactor(R.rateEma) : 1), cols = [], updates = 0, declN = 0, declT = 0;
      for (k = 0; k < arch.columns; k++) {
        var P = [], fl = [], bg = [];
        for (i = 0; i < arch.perColumn; i++) {
          P.push({ th: s.th, c: s.c, g: R.g, sp: SP, geff: geff });
          fl.push(!!fm[sid(k, i)]); bg.push(fl[i] ? bog() : null);
        }
        var ce = columnEpisode(n, pat, sigma, P, s.memory ? R.warm : null, s.memory ? G.AMP_CAP : 0, G.makeRng(NS + seed + '/e' + e + '/c' + k), fl, bg);
        cols.push(ce); updates += ce.updates;
        for (i = 0; i < arch.perColumn; i++) if (ce.decl[i] && !fl[i]) { declN++; if (isTrueEvent(ce.decl[i], pat)) declT++; }
      }
      var fg = [], fi = [], gs = [], is = [];
      for (k = 0; k < arch.columns; k++) { var gf = fm['g' + k] ? bog() : null; fg.push(gf); gs.push(!!fm['g' + k] && !gf); }
      for (k = 0; k < arch.integrators; k++) { var jf = fm['i' + k] ? bog() : null; fi.push(jf); is.push(!!fm['i' + k] && !jf); }
      var res = runPipeline(arch, cols, fg, fi, trng, gs, is);
      var refDecl = cols[R.refK].decl[R.refI];
      R.episodes.push({
        planted: planted, out: !!res.out, outTrue: !!res.out && isTrueEvent(res.out.vec, pat), outStep: res.out ? res.out.t : null,
        outFid: res.out && pat ? Math.sqrt(G.fidelity(res.out.vec, pat)) : null,
        gatesReleased: res.gates.filter(Boolean).length,
        gatesTrue: res.gates.filter(function (x) { return x && isTrueEvent(x.vec, pat); }).length,
        lost: res.lost, moved: res.moved, honestDecl: declN, honestTrue: declT,
        ref: { decl: !!refDecl, true: isTrueEvent(refDecl, pat), fid: refDecl && pat ? Math.sqrt(G.fidelity(refDecl, pat)) : null },
        geff: geff, rateEma: R.rateEma, updates: updates
      });
      if (s.stabilizer) R.rateEma = G.leakyUpdate(R.rateEma, res.out ? 1 : 0);
      if (s.memory) R.warm = res.out ? res.out.vec : null;
      R.e++;
    }
    return R;
  }
  function finishBrainRun(R) {
    return { arch: R.arch, opts: R.opts, episodes: R.episodes, summary: summarizeBrain(R.episodes, !R.fm[sid(R.refK, R.refI)]) };
  }
  function runBrain(arch, opts) {
    var R = createBrainRun(arch, opts);
    while (!brainDone(R)) stepBrainRun(R, 50);
    return finishBrainRun(R);
  }

  function summarizeBrain(eps, refHonest) {
    var planted = 0, T = 0, F = 0, Fn = 0, Fp = 0, lat = [], fid = [], lost = 0, moved = 0, upd = 0;
    var rT = 0, rF = 0, rfid = [];
    eps.forEach(function (x) {
      if (x.planted) planted++;
      if (x.out) { lat.push(x.outStep); if (x.outTrue) T++; else { F++; if (x.planted) Fp++; else Fn++; } }
      if (x.outFid !== null && x.out) fid.push(x.outFid);
      if (x.ref.decl) { if (x.ref.true) rT++; else rF++; if (x.ref.fid !== null) rfid.push(x.ref.fid); }
      lost += x.lost; moved += x.moved; upd += x.updates;
    });
    var N = eps.length, mean = function (a) { return a.length ? ST.mean(a) : null; };
    return {
      episodes: N, planted: planted, noise: N - planted, T: T, F: F, Fplanted: Fp, Fnoise: Fn,
      precision: T + F > 0 ? T / (T + F) : 0,
      recall: ST.wilson(T, planted), falseRate: ST.wilson(F, N), falseNoise: ST.wilson(Fn, N - planted),
      meanLatency: mean(lat), meanFidelity: mean(fid), lost: lost, moved: moved, ojaUpdates: upd,
      single: { honest: refHonest, T: rT, F: rF, precision: rT + rF > 0 ? rT / (rT + rF) : 0, recall: ST.wilson(rT, planted), falseRate: ST.wilson(rF, N), meanFidelity: mean(rfid) }
    };
  }

  /* ---------- drawing: an SVG string, no DOM ---------- */
  var COLORS = { sensory: '#40d0e0', gate: '#c9a84c', integrator: '#7aa8ff', output: '#e0c36a', inhibitory: '#ff9a9a', memory: '#5ee6b8', tube: '#b3bedb', bg: '#0a1330', text: '#eef2ff' };
  var HC = { sensory: '#ffffff', gate: '#ffffff', integrator: '#ffffff', output: '#ffffff', inhibitory: '#ffffff', memory: '#ffffff', tube: '#ffffff', bg: '#000000', text: '#ffffff' };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function layout(arch) {
    var C = arch.columns, m = arch.perColumn, gap = 34, colW = Math.max(m * gap, 70) + 30;
    var side = (arch.spec.stabilizer || arch.spec.memory) ? 150 : 0;
    var W = Math.max(520, C * colW + 40 + side), inner = W - side, pos = {}, k, i;
    var x0 = (inner - C * colW) / 2;
    for (k = 0; k < C; k++) {
      var cx = x0 + k * colW + colW / 2;
      for (i = 0; i < m; i++) pos[sid(k, i)] = { x: cx + (i - (m - 1) / 2) * gap, y: 70 };
      pos['g' + k] = { x: cx, y: 175 };
    }
    for (k = 0; k < arch.integrators; k++) pos['i' + k] = { x: inner / 2 + (k - (arch.integrators - 1) / 2) * 90, y: 280 };
    pos.o = { x: inner / 2, y: 375 };
    if (arch.spec.stabilizer) pos.z = { x: inner + side / 2, y: 230 };
    if (arch.spec.memory) pos.mem = { x: inner + side / 2, y: 330 };
    return { W: W, H: 430, pos: pos, colW: colW, x0: x0 };
  }
  function shape(kind, x, y, col, fill) {
    var p = function (pts) { return '<polygon points="' + pts.map(function (q) { return r1(q[0]) + ',' + r1(q[1]); }).join(' ') + '" fill="' + fill + '" stroke="' + col + '" stroke-width="2"/>'; };
    if (kind === 'sensory') return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="11" fill="' + fill + '" stroke="' + col + '" stroke-width="2"/>';
    if (kind === 'gate') return p([[x, y - 15], [x + 15, y], [x, y + 15], [x - 15, y]]);
    if (kind === 'integrator') { var h = []; for (var a = 0; a < 6; a++) h.push([x + 18 * Math.cos(Math.PI / 3 * a), y + 18 * Math.sin(Math.PI / 3 * a)]); return p(h); }
    if (kind === 'output') return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="18" fill="' + fill + '" stroke="' + col + '" stroke-width="2"/><circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="11" fill="none" stroke="' + col + '" stroke-width="2"/>';
    if (kind === 'inhibitory') return '<rect x="' + r1(x - 14) + '" y="' + r1(y - 14) + '" width="28" height="28" fill="' + fill + '" stroke="' + col + '" stroke-width="2"/>';
    return '<rect x="' + r1(x - 15) + '" y="' + r1(y - 12) + '" width="30" height="24" rx="8" fill="' + fill + '" stroke="' + col + '" stroke-width="2"/>';
  }
  // opts: {faults, hc, title, desc, labels: {kind: text}}
  function renderSvg(arch, opts) {
    opts = opts || {};
    var L = layout(arch), P = L.pos, pal = opts.hc ? HC : COLORS, fm = opts.faults ? faultMap(arch, opts.faults).map : {}, out = [];
    var labels = opts.labels || {};
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + L.W + ' ' + L.H + '" width="' + L.W + '" height="' + L.H + '" role="img" aria-labelledby="bt bd">');
    out.push('<title id="bt">' + esc(opts.title || 'Brain architecture') + '</title><desc id="bd">' + esc(opts.desc || describe(arch)) + '</desc>');
    out.push('<rect width="100%" height="100%" fill="' + pal.bg + '"/>');
    // column frames
    for (var k = 0; k < arch.columns; k++) {
      var fx = L.x0 + k * L.colW + 4;
      out.push('<rect x="' + r1(fx) + '" y="40" width="' + r1(L.colW - 8) + '" height="165" rx="10" fill="none" stroke="' + pal.tube + '" stroke-opacity="0.35" stroke-dasharray="3 4"/>');
      out.push('<text x="' + r1(fx + 8) + '" y="34" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc((labels.column || 'column') + ' ' + (k + 1)) + '</text>');
    }
    // microtubules: a tube (wide pale stroke) with a core line; modulatory ones dashed
    arch.microtubules.forEach(function (e) {
      var a = P[e.from], b = P[e.to];
      if (!a || !b) return;
      var dash = e.kind === 'modulatory' ? ' stroke-dasharray="6 5"' : '';
      out.push('<g class="mt" data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '">');
      if (e.kind === 'signal') out.push('<line x1="' + r1(a.x) + '" y1="' + r1(a.y) + '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '" stroke="' + pal.tube + '" stroke-opacity="0.18" stroke-width="7" stroke-linecap="round"/>');
      out.push('<line x1="' + r1(a.x) + '" y1="' + r1(a.y) + '" x2="' + r1(b.x) + '" y2="' + r1(b.y) + '" stroke="' + pal.tube + '" stroke-opacity="0.8" stroke-width="1.4"' + dash + '/>');
      if (e.kind === 'signal' && e.delay > 0 && e.from.charAt(0) !== 's') {
        var mx = a.x + (b.x - a.x) * 0.55, my = a.y + (b.y - a.y) * 0.55;
        out.push('<text x="' + r1(mx + 4) + '" y="' + r1(my) + '" fill="' + pal.text + '" font-size="10" font-family="system-ui, sans-serif">+' + e.delay + '</text>');
      }
      out.push('</g>');
    });
    arch.membranes.forEach(function (x) {
      var p = P[x.id], col = pal[x.kind], bad = !!fm[x.id];
      out.push('<g class="membrane" data-id="' + esc(x.id) + '" data-kind="' + x.kind + '"' + (bad ? ' data-faulty="1"' : '') + '>');
      out.push(shape(x.kind, p.x, p.y, col, pal.bg));
      if (bad) out.push('<path d="M' + r1(p.x - 8) + ' ' + r1(p.y - 8) + 'L' + r1(p.x + 8) + ' ' + r1(p.y + 8) + 'M' + r1(p.x + 8) + ' ' + r1(p.y - 8) + 'L' + r1(p.x - 8) + ' ' + r1(p.y + 8) + '" stroke="' + (opts.hc ? '#ffffff' : '#ff9a9a') + '" stroke-width="3"/>');
      out.push('</g>');
    });
    // layer labels
    var lab = function (txt, y) { out.push('<text x="8" y="' + y + '" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc(txt) + '</text>'); };
    lab((labels.gate || 'gate') + ' ' + arch.quorum.gate + '/' + arch.perColumn, 200);
    lab((labels.integrator || 'integrator') + ' ' + arch.quorum.integrator + '/' + arch.columns, 305);
    lab((labels.output || 'output') + ' ' + arch.quorum.output + '/' + arch.integrators, 400);
    if (P.z) out.push('<text x="' + r1(P.z.x) + '" y="' + r1(P.z.y + 30) + '" text-anchor="middle" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc(labels.inhibitory || 'inhibitory') + '</text>');
    if (P.mem) out.push('<text x="' + r1(P.mem.x) + '" y="' + r1(P.mem.y + 28) + '" text-anchor="middle" fill="' + pal.text + '" font-size="11" font-family="system-ui, sans-serif">' + esc(labels.memory || 'memory') + '</text>');
    out.push('</svg>');
    return out.join('');
  }

  function describe(arch) {
    var c = arch.counts;
    return arch.columns + ' columns of ' + arch.perColumn + ' sensory membranes (' + c.sensory + ' in all), ' + c.gate + ' gates (quorum ' +
      arch.quorum.gate + ' of ' + arch.perColumn + '), ' + c.integrator + ' integrator' + (c.integrator > 1 ? 's' : '') + ' (quorum ' + arch.quorum.integrator +
      ' of ' + arch.columns + ' columns), 1 output (quorum ' + arch.quorum.output + ' of ' + arch.integrators + ')' +
      (c.inhibitory ? ', 1 inhibitory' : '') + (c.memory ? ', 1 memory' : '') + '; ' + c.total + ' membranes and ' +
      arch.tubes.total + ' microtubules (' + arch.tubes.signal + ' signal, ' + arch.tubes.modulatory + ' modulatory).';
  }

  function toJSON(run) {
    return JSON.stringify({
      tool: 'membrane-arena brain', version: VERSION, synthetic: true,
      spec: run.arch.spec, req: run.arch.req || null, counts: run.arch.counts, tubes: run.arch.tubes, quorum: run.arch.quorum,
      run: run.opts, summary: run.summary
    }, null, 2);
  }

  return {
    VERSION: VERSION, KINDS: KINDS, MODES: MODES, LIMITS: LIMITS, CHECKS: CHECKS, DEFAULT_REQ: DEFAULT_REQ,
    replicasFor: replicasFor, quorum: quorum, tolerated: tolerated,
    sanitizeRequirements: sanitizeRequirements, sanitizeSpec: sanitizeSpec, sanitizeFaults: sanitizeFaults,
    buildArchitecture: buildArchitecture, planArchitecture: planArchitecture, checkArchitecture: checkArchitecture,
    columnEpisode: columnEpisode, fuseVecs: fuseVecs, quorumRelease: quorumRelease, runPipeline: runPipeline,
    faultMap: faultMap, logicOutcome: logicOutcome, runBrain: runBrain,
    createBrainRun: createBrainRun, stepBrainRun: stepBrainRun, brainDone: brainDone, finishBrainRun: finishBrainRun, summarizeBrain: summarizeBrain,
    layout: layout, renderSvg: renderSvg, describe: describe, toJSON: toJSON, topoOrder: topoOrder, signalGraph: signalGraph
  };
});
