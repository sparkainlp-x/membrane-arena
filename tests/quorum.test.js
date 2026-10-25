'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../game.js');
const B = require('../brain.js');
const Q = require('../quorum.js');
const VOTERS = ['sensory', 'gate', 'integrator'];
const voters = (arch) => arch.membranes.filter((x) => VOTERS.includes(x.kind));
// every placement allowed by a threat, by brute force over subsets
function brute(arch, mode, threat) {
  const units = voters(arch), t = Q.sanitizeThreat(arch, threat), counts = { true: 0, false: 0, none: 0 };
  let minFool = null, minNone = null;
  for (let mask = 0; mask < 1 << units.length; mask++) {
    const fs_ = {}, per = {}; let tot = 0, g = 0, it = 0;
    units.forEach((u, i) => {
      if (!(mask & (1 << i))) return;
      fs_[u.id] = true; tot++;
      if (u.kind === 'gate') g++; else if (u.kind === 'integrator') it++; else per[u.column] = (per[u.column] || 0) + 1;
    });
    if (tot > t.total || g > t.gates || it > t.integrators || Object.values(per).some((v) => v > t.perColumn)) continue;
    const o = Q.evaluate(arch, mode, fs_).outcome;
    counts[o]++;
    if (o === 'false' && (minFool === null || tot < minFool)) minFool = tot;
    if (o === 'none' && (minNone === null || tot < minNone)) minNone = tot;
  }
  return { counts, minFool, minNone };
}
const sym = (s, t) => ({ s, t });

test('a vote releases at the first check where a strict majority agrees, and never twice', () => {
  const C = G.CHECK;
  assert.deepEqual(Q.voteSym([sym('T', C), sym('T', C), sym('F', C)], 2), { s: 'T', t: C });
  assert.deepEqual(Q.voteSym([sym('F', C), sym('F', C), sym('T', C)], 2), { s: 'F', t: C });
  assert.equal(Q.voteSym([sym('T', C), null, null], 2), null, 'one vote of three is not a majority');
  assert.equal(Q.voteSym([sym('T', C), sym('T', C), sym('F', C), sym('F', C)], 3), null, 'a 2-2 split releases nothing');
  // a later arrival completes the majority at its own check time
  assert.deepEqual(Q.voteSym([sym('T', C), sym('T', 3 * C), sym('F', C)], 2), { s: 'T', t: 3 * C });
  // stuck faults carry distinct wrong symbols that never pool together
  assert.equal(Q.voteSym([sym('F1', C), sym('F2', C), sym('T', C)], 2), null);
});

test('the symbolic evaluator gives the same outcome as the brain page logic on 2000 random brains and placements', () => {
  const rng = G.makeRng('quorum-equivalence');
  let n = 0;
  for (let trial = 0; trial < 2000; trial++) {
    const spec = { perColumn: 1 + Math.floor(rng() * 5), columns: 1 + Math.floor(rng() * 4), integrators: 1 + Math.floor(rng() * 3), stabilizer: rng() < 0.5,
      delays: { sg: Math.floor(rng() * 3), gi: Math.floor(rng() * 4), io: Math.floor(rng() * 3) } };
    const arch = B.buildArchitecture(spec), mode = B.MODES[Math.floor(rng() * 3)], faulty = {};
    voters(arch).forEach((x) => { if (rng() < 0.3) faulty[x.id] = true; });
    assert.equal(Q.evaluate(arch, mode, faulty).outcome, B.logicOutcome(arch, { mode }, faulty), `${JSON.stringify(spec)} ${mode} ${Object.keys(faulty)}`);
    n++;
  }
  assert.equal(n, 2000);
});

test('the adversary\'s grouped search counts exactly the placements a brute force over subsets finds', () => {
  const archs = [[3, 1, 1], [2, 2, 1], [3, 3, 1], [1, 3, 3], [2, 3, 2], [4, 2, 1], [3, 2, 3], [1, 5, 3]];
  const threats = [{ total: 1, perColumn: 1, gates: 1, integrators: 1 }, { total: 99, perColumn: 1, gates: 1, integrators: 0 },
    { total: 2, perColumn: 2, gates: 2, integrators: 2 }, { total: 3, perColumn: 3, gates: 0, integrators: 0 }];
  let cases = 0;
  for (const [m, C, I] of archs) for (const mode of B.MODES) for (const T of threats) {
    const arch = B.buildArchitecture({ perColumn: m, columns: C, integrators: I, stabilizer: false });
    const a = brute(arch, mode, T), adv = Q.adversary(arch, mode, T);
    assert.deepEqual(adv.counts, a.counts, `${m}x${C},${I} ${mode} ${JSON.stringify(T)}`);
    assert.equal(adv.total, a.counts.true + a.counts.false + a.counts.none);
    assert.equal(adv.holds, a.counts.false === 0 && a.counts.none === 0);
    // the counterexamples it shows are real, and the smallest of their kind
    if (adv.fool) { assert.equal(Q.evaluate(arch, mode, adv.fool.faulty).outcome, 'false'); assert.equal(adv.fool.faults, a.minFool); }
    else assert.equal(a.minFool, null);
    if (adv.silence) { assert.equal(Q.evaluate(arch, mode, adv.silence.faulty).outcome, 'none'); assert.equal(adv.silence.faults, a.minNone); }
    else assert.equal(a.minNone, null);
    cases++;
  }
  assert.equal(cases, archs.length * 3 * threats.length);
});

test('the 2f + 1 rule holds in the game: colluding faults within the bound never fool or silence a minimal brain, one more does', () => {
  for (let f = 1; f <= 3; f++) {
    const n = 2 * f + 1;
    const arch = B.buildArchitecture({ perColumn: n, columns: 1, integrators: 1, stabilizer: false });
    assert.ok(Q.adversary(arch, 'collude', { total: 99, perColumn: f, gates: 0, integrators: 0 }).holds, `f=${f}`);
    const over = Q.adversary(arch, 'collude', { total: 99, perColumn: f + 1, gates: 0, integrators: 0 });
    assert.ok(over.fool && over.fool.faults === f + 1, `f=${f}: f + 1 colluding members fool it`);
  }
  // silent faults can starve a brain but never make it lie
  for (const [m, C, I] of [[3, 3, 1], [1, 5, 3], [4, 2, 2]]) {
    const arch = B.buildArchitecture({ perColumn: m, columns: C, integrators: I, stabilizer: false });
    assert.equal(Q.adversary(arch, 'silent', { total: 99, perColumn: m, gates: C, integrators: I }).counts['false'], 0);
  }
});

test('every Build level: the start fails, the published par design costs the par and earns 3 stars', () => {
  const PAR = { b1: [3, 1, 1, false], b2: [1, 3, 1, true], b3: [5, 3, 1, true], b4: [1, 3, 3, true], b5: [7, 3, 1, true], b6: [7, 1, 1, true], b7: [1, 5, 5, true] };
  const builds = Q.LEVELS.filter((L) => L.kind === 'build');
  assert.equal(builds.length, 7);
  for (const L of builds) {
    assert.ok(!Q.evaluateBuild(L, L.start).logicOk, `${L.id}: the starting design is not already safe`);
    const [m, C, I, stab] = PAR[L.id], d = { perColumn: m, columns: C, integrators: I, stabilizer: stab };
    const ev = Q.evaluateBuild(L, d);
    assert.ok(ev.pass, `${L.id}: par design passes the logic and budget`);
    assert.equal(ev.cost, L.par, `${L.id}: par design costs the par`);
    assert.ok(L.par <= L.budget);
    const s = Q.simulate(L, ev);
    assert.equal(s.F, 0, `${L.id}: no false outputs`);
    assert.ok(s.recall.p >= L.recall, `${L.id}: recall ${s.recall.p} >= ${L.recall}`);
    assert.equal(Q.scoreBuild(L, ev, s).stars, 3, L.id);
  }
});

test('the calibration report agrees with the level table and says every level is consistent', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'quorum-check.txt'), 'utf8');
  assert.match(doc, /All build levels consistent: yes/);
  for (const L of Q.LEVELS.filter((x) => x.kind === 'build')) {
    const m = new RegExp(`^${L.id} .*budget (\\d+), recall target ([\\d.]+), par (\\d+)`, 'm').exec(doc.replace(/\n(?=\S)(?![bx]\d )/g, ''));
    assert.ok(m, `${L.id} in report`);
    assert.deepEqual([+m[1], +m[2], +m[3]], [L.budget, L.recall, L.par], L.id);
  }
});

test('every Break level: the intended answer works and the minimum number of faults matches the search', () => {
  const ANSWER = { x1: ['s0.0', 's0.1'], x2: ['i0'], x3: ['s0.0', 's0.1', 's1.0', 's1.1'], x4: null, x5: ['i0', 'i1'], x6: null, x7: ['g0', 'g1', 'g2'] };
  const breaks = Q.LEVELS.filter((L) => L.kind === 'break');
  assert.equal(breaks.length, 7);
  for (const L of breaks) {
    const sol = Q.solveBreak(L), a = ANSWER[L.id];
    if (a === null) { assert.ok(!sol.breakable, `${L.id} cannot be broken`); continue; }
    assert.ok(sol.breakable, L.id);
    assert.equal(sol.minFaults, a.length, `${L.id} minimum`);
    const pick = {}; a.forEach((id) => { pick[id] = true; });
    const r = Q.attack(L, pick);
    assert.ok(r.win, `${L.id}: the intended answer reaches the goal (${r.outcome})`);
    assert.equal(r.outcome, L.goal === 'fool' ? 'false' : 'none');
    // the shown example is itself a winning attack of minimum size
    const ex = Q.attack(L, sol.example);
    assert.ok(ex.win && ex.used === sol.minFaults, `${L.id} example`);
    // and, on the brains small enough to try every subset, the brute force agrees on the minimum
    if (voters(sol.arch).length <= 16) {
      const bf = brute(sol.arch, L.mode, Q.breakThreat(L, sol.arch));
      assert.equal(L.goal === 'fool' ? bf.minFool : bf.minNone, sol.minFaults, `${L.id} brute force`);
    }
  }
});

test('Break scoring: a star for the goal, one for the first try, one for the fewest faults', () => {
  const L = Q.getLevel('x3'), sol = Q.solveBreak(L);
  assert.equal(Q.scoreBreak(L, sol, { won: false, misses: 0, used: 4 }).stars, 0);
  assert.equal(Q.scoreBreak(L, sol, { won: true, misses: 0, used: 4 }).stars, 3);
  assert.equal(Q.scoreBreak(L, sol, { won: true, misses: 1, used: 4 }).stars, 2);
  const L5 = Q.getLevel('x5'), s5 = Q.solveBreak(L5);
  assert.equal(Q.scoreBreak(L5, s5, { won: true, misses: 0, used: 3 }).stars, 2, 'a win with more faults than needed');
  const L4 = Q.getLevel('x4'), s4 = Q.solveBreak(L4);
  assert.equal(Q.scoreBreak(L4, s4, { won: true, misses: 0, used: 0 }).stars, 3, 'a right claim on the first try');
});

test('inputs are clamped: designs stay inside the limits and picks drop shielded kinds and anything over budget', () => {
  const L = Q.getLevel('b1'), lim = Q.DESIGN_LIMITS;
  const d = Q.sanitizeDesign({ perColumn: 99, columns: -4, integrators: 'x', stabilizer: 1 }, L);
  assert.equal(d.perColumn, lim.perColumn); assert.equal(d.columns, 1); assert.ok(d.integrators >= 1); assert.equal(d.stabilizer, true);
  const X = Q.getLevel('x3'), arch = Q.breakArch(X);
  const p = Q.sanitizePick(X, arch, { 'g0': true, 'i0': true, 's0.0': true, 's0.1': true, 's0.2': true, 's1.0': true, 's1.1': true, 'nope': true });
  assert.ok(!p.g0 && !p.i0 && !p.nope, 'gates and integrators are shielded in x3');
  assert.equal(Object.keys(p).length, X.budget);
  assert.ok(!Q.canPick(X, 'gate') && Q.canPick(X, 'sensory'));
});

test('the measured part is reproducible: the same level and design give the same summary', () => {
  const L = Q.getLevel('b2'), ev = Q.evaluateBuild(L, { perColumn: 1, columns: 3, integrators: 1, stabilizer: true });
  const a = Q.simulate(L, ev), b = Q.simulate(L, ev);
  assert.deepEqual([a.T, a.F, a.lost, a.recall.p, a.meanLatency], [b.T, b.F, b.lost, b.recall.p, b.meanLatency]);
  assert.equal(a.episodes, Q.SIM_EPISODES);
  assert.equal(a.planted + a.noise, a.episodes);
});

test('the diagram draws one shape per membrane, marks faults and symbols, escapes labels, and lets only allowed kinds be picked', () => {
  const X = Q.getLevel('x5'), arch = Q.breakArch(X), faulty = { i0: true, i1: true };
  const ev = Q.evaluate(arch, X.mode, faulty);
  const svg = Q.render(arch, { faulty, sym: ev.sym, pickable: X.kinds, labels: { column: '<b>&"col', T: 'T', F: 'F' }, title: 'a<b', desc: 'd' });
  assert.equal((svg.match(/class="membrane/g) || []).length, arch.membranes.length);
  assert.equal((svg.match(/data-faulty="1"/g) || []).length, 2);
  assert.equal((svg.match(/class="membrane pickable/g) || []).length, voters(arch).length);
  assert.ok(!/<b>/.test(svg) && svg.includes('&lt;b&gt;&amp;&quot;col'), 'labels are escaped');
  assert.ok(svg.includes('a&lt;b'));
  assert.ok(/data-sym="false"/.test(svg) && /data-sym="true"/.test(svg));
});

test('the score card is plain text, says SYNTHETIC and adds up the stars', () => {
  const t = (k, v) => G.fmt(require('../quorum-i18n.js').LANGS.en[k], v);
  const rows = Q.LEVELS.map((L, i) => ({ id: L.id, stars: i % 4 }));
  const s = Q.shareText(rows, t);
  const total = rows.reduce((a, r) => a + r.stars, 0);
  assert.match(s, /SYNTHETIC/);
  assert.ok(s.includes(`${total} of ${rows.length * 3} stars`), s);
  assert.ok(!/</.test(s));
});
