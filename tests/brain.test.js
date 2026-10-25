'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const B = require('../brain.js');

const unit = (n, k, im) => { const v = { r: new Float64Array(n), i: new Float64Array(n) }; (im ? v.i : v.r)[k] = 1; return v; };
const subsets = (n) => { const out = []; for (let mask = 0; mask < 1 << n; mask++) { const s = []; for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(i); out.push(s); } return out; };

test('counting rules: 2f + 1 voters with a strict majority are necessary and sufficient for f faults', () => {
  for (let n = 1; n <= 15; n++) {
    const q = B.quorum(n), f = B.tolerated(n);
    assert.ok(2 * q > n, 'two quorums always overlap');
    assert.ok(f < q, `n=${n}: f faulty voters cannot reach the quorum alone`);
    assert.ok(n - f >= q, `n=${n}: the honest voters still reach it`);
    assert.ok(!(f + 1 < q && n - f - 1 >= q), `n=${n}: one more fault breaks safety or liveness`);
  }
  for (let f = 0; f <= 5; f++) {
    const n = B.replicasFor(f);
    assert.equal(n, 2 * f + 1);
    assert.equal(B.tolerated(n), f);
    assert.equal(B.tolerated(n - 1), f - 1 < 0 ? -1 : (n - 1 === 0 ? -1 : f - 1 + (f === 0 ? 0 : 0)), 'one fewer voter tolerates fewer faults');
    // the smallest n with safety and liveness for f colluding faults
    let min = null;
    for (let m = 1; m <= 15 && min === null; m++) if (f < B.quorum(m) && m - f >= B.quorum(m)) min = m;
    assert.equal(min, 2 * f + 1);
  }
  assert.equal(B.tolerated(0), -1);
  assert.equal(B.quorum(3), 2, 'matches the 2-of-3 shield');
});

test('planArchitecture: counts of every membrane kind and microtubule follow the rules', () => {
  for (let f = 0; f <= 3; f++) for (let g = 0; g <= 2; g++) for (let h = 0; h <= 2; h++) for (const stab of [true, false]) for (const mem of [true, false]) {
    const a = B.planArchitecture({ sensoryFaults: f, columnFaults: g, integratorFaults: h, stabilizer: stab, memory: mem });
    const m = 2 * f + 1, C = 2 * g + 1, I = 2 * h + 1;
    assert.deepEqual([a.perColumn, a.columns, a.integrators], [m, C, I]);
    assert.equal(a.counts.sensory, C * m);
    assert.equal(a.counts.gate, C);
    assert.equal(a.counts.integrator, I);
    assert.equal(a.counts.output, 1);
    assert.equal(a.counts.inhibitory, stab ? 1 : 0);
    assert.equal(a.counts.memory, mem ? 1 : 0);
    assert.equal(a.counts.total, C * m + C + I + 1 + (stab ? 1 : 0) + (mem ? 1 : 0));
    assert.equal(a.tubes.signal, C * m + C * I + I);
    assert.equal(a.tubes.modulatory, (stab ? 1 + C : 0) + (mem ? 1 + C : 0));
    assert.deepEqual(a.quorum, { gate: B.quorum(m), integrator: B.quorum(C), output: B.quorum(I) });
    assert.equal(a.plan.reduce((s, x) => s + x.count, 0), a.counts.total);
    const ck = B.checkArchitecture(a, a.req);
    assert.ok(ck.ok, JSON.stringify(ck.problems));
    assert.deepEqual(ck.tolerance, { sensory: f, column: g, integrator: h });
  }
  const d = B.planArchitecture({});
  assert.equal(d.counts.total, 15);
  assert.equal(d.tubes.total, 17);
  assert.equal(d.spec.c, 0, 'coupling defaults to 0 in the brain');
});

test('exhaustive: one column, every placement of colluding, stuck and silent faults (1 to 7 members)', () => {
  for (let m = 1; m <= 7; m++) {
    const arch = B.buildArchitecture({ perColumn: m, columns: 1, integrators: 1, stabilizer: false });
    const q = B.quorum(m);
    for (const S of subsets(m)) {
      const set = {}; S.forEach((i) => { set['s0.' + i] = true; });
      const honest = m - S.length;
      const c = B.logicOutcome(arch, { mode: 'collude' }, set);
      assert.equal(c, S.length >= q ? 'false' : honest >= q ? 'true' : 'none', `m=${m} faulty=${S}`);
      // stuck units never agree with one another, so they release only when one vote is a quorum (m = 1)
      const stuck = B.logicOutcome(arch, { mode: 'stuck' }, set);
      assert.equal(stuck, q === 1 && S.includes(0) ? 'false' : honest >= q ? 'true' : 'none', `stuck m=${m} faulty=${S}`);
      assert.equal(B.logicOutcome(arch, { mode: 'silent' }, set), honest >= q ? 'true' : 'none', `silent m=${m} faulty=${S}`);
    }
  }
});

test('exhaustive: 3 columns of 3, every placement of faulty sensory membranes and gates (4096 cases)', () => {
  const arch = B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, integratorFaults: 0, stabilizer: false });
  let within = 0;
  for (let mask = 0; mask < 1 << 12; mask++) {
    const set = {}, colBad = [0, 0, 0], gateBad = [false, false, false];
    for (let b = 0; b < 9; b++) if (mask & (1 << b)) { set['s' + Math.floor(b / 3) + '.' + (b % 3)] = true; colBad[Math.floor(b / 3)]++; }
    for (let k = 0; k < 3; k++) if (mask & (1 << (9 + k))) { set['g' + k] = true; gateBad[k] = true; }
    // expected, by hand: a column says A when its gate is faulty or 2+ members are; T when 2+ members are honest
    const col = [0, 1, 2].map((k) => gateBad[k] || colBad[k] >= 2 ? 'A' : 'T');
    const nA = col.filter((x) => x === 'A').length, exp = nA >= 2 ? 'false' : 'true';
    assert.equal(B.logicOutcome(arch, { mode: 'collude' }, set), exp, `mask ${mask}`);
    if (nA <= 1) { within++; assert.equal(exp, 'true'); }
  }
  assert.ok(within > 0);
});

test('exhaustive: replicated integrators (3) with faulty gates and integrators, all modes', () => {
  const arch = B.planArchitecture({ sensoryFaults: 0, columnFaults: 1, integratorFaults: 1, stabilizer: false });
  assert.equal(arch.integrators, 3);
  for (let mask = 0; mask < 1 << 6; mask++) {
    const set = {}; let g = 0, h = 0;
    for (let k = 0; k < 3; k++) if (mask & (1 << k)) { set['g' + k] = true; g++; }
    for (let k = 0; k < 3; k++) if (mask & (1 << (3 + k))) { set['i' + k] = true; h++; }
    const o = B.logicOutcome(arch, { mode: 'collude' }, set);
    if (g <= 1 && h <= 1) assert.equal(o, 'true', `within bounds, mask ${mask}`);
    if (h >= 2) assert.equal(o, 'false', 'two colluding integrators out of three take the output');
    for (const mode of ['stuck', 'silent']) {
      const s = B.logicOutcome(arch, { mode }, set);
      assert.notEqual(s, 'false', 'non-colluding faults never agree on a wrong vector');
      if (g <= 1 && h <= 1) assert.equal(s, 'true');
    }
  }
});

test('a column of three honest membranes reproduces game.js episode() draw for draw', () => {
  const n = G.N, sigma = G.sigmaFor(n);
  for (let s = 0; s < 30; s++) {
    const pat = s % 2 ? null : G.rvec(n, G.makeRng('pat' + s));
    const P = () => [0, 1, 2].map((i) => ({ th: 0.35 + 0.1 * i, c: 0.04 * (i + 1), g: 1, sp: 0.5, geff: 0.9 + 0.1 * (s % 3) }));
    const warm = s % 4 === 0 ? G.rvec(n, G.makeRng('w' + s)) : null;
    const a = G.episode(n, pat, sigma, P(), warm, warm ? 0.5 : 0, G.makeRng('obs' + s), new Float32Array(G.STEPS * 3));
    const b = B.columnEpisode(n, pat, sigma, P(), warm, warm ? 0.5 : 0, G.makeRng('obs' + s));
    assert.deepEqual(b.declStep, a.declStep);
    a.decl.forEach((d, i) => {
      if (!d) { assert.equal(b.decl[i], null); return; }
      assert.deepEqual(Array.from(b.decl[i].r), Array.from(d.r));
      assert.deepEqual(Array.from(b.decl[i].i), Array.from(d.i));
    });
  }
});

test('quorumRelease with three simultaneous votes and no fusion picks the same membrane as the game shield', () => {
  const rng = G.makeRng('shield-eq'), n = 32;
  for (let t = 0; t < 400; t++) {
    const base = G.rvec(n, rng), d = [0, 1, 2].map(() => {
      const u = rng();
      return u < 0.25 ? null : u < 0.7 ? G.noisy(base, 0.05 + 0.25 * rng(), rng) : G.rvec(n, rng);
    });
    const r = B.quorumRelease(d.map((v) => v ? { vec: v, t: 60 } : null), 2, false);
    const k = G.systemEvent(d, G.AGREE);
    assert.equal(r ? r.lead : null, k);
  }
});

test('quorumRelease: earliest time, lowest leader, one release; fusion is phase-invariant and helps', () => {
  const n = 16, T = unit(n, 0), A = unit(n, 1);
  const ins = [{ vec: A, t: 10 }, { vec: T, t: 20 }, { vec: T, t: 30 }, { vec: A, t: 40 }, { vec: T, t: 50 }];
  const r = B.quorumRelease(ins, 3, false);
  assert.equal(r.t, 50); assert.equal(r.lead, 1); assert.deepEqual(r.members, [1, 2, 4]);
  assert.equal(B.quorumRelease([{ vec: T, t: 10 }, null, { vec: A, t: 10 }], 2, true), null);
  assert.equal(B.quorumRelease([], 1, true), null);
  const rng = G.makeRng('fuse');
  let better = 0;
  for (let k = 0; k < 200; k++) {
    const pat = G.rvec(32, rng), vs = [0, 1, 2, 3, 4].map(() => G.noisy(pat, 0.12, rng));
    const f1 = G.fidelity(B.fuseVecs(vs), pat), mean = vs.reduce((s, v) => s + G.fidelity(v, pat), 0) / vs.length;
    if (f1 > mean) better++;
    // rotate one member's global phase: the fused direction is unchanged
    const th = 2 * Math.PI * rng(), c = Math.cos(th), s = Math.sin(th), w = { r: Float64Array.from(vs[2].r), i: Float64Array.from(vs[2].i) };
    for (let j = 0; j < 32; j++) { w.r[j] = c * vs[2].r[j] - s * vs[2].i[j]; w.i[j] = s * vs[2].r[j] + c * vs[2].i[j]; }
    const vs2 = vs.slice(); vs2[2] = w;
    assert.ok(Math.abs(G.fidelity(B.fuseVecs(vs2), B.fuseVecs(vs)) - 1) < 1e-9);
  }
  assert.ok(better >= 195, `fusion beat the members' mean fidelity in ${better} of 200`);
});

test('microtubule delays: cargo past step 60 is lost and the checker computes the deadline', () => {
  for (let d = 0; d <= 5; d++) {
    const arch = B.buildArchitecture({ perColumn: 1, columns: 1, integrators: 1, stabilizer: false, delays: { sg: 0, gi: d, io: 0 } });
    const T = unit(8, 0);
    for (let t0 = 10; t0 <= 60; t0 += 10) {
      const res = B.runPipeline(arch, [{ decl: [T], declStep: [t0] }], [], [], null);
      const arrives = t0 + d * 10 <= 60;
      assert.equal(!!res.out, arrives, `delay ${d} start ${t0}`);
      if (arrives) assert.equal(res.out.t, t0 + d * 10);
      else assert.equal(res.lost, 1);
    }
    const ck = B.checkArchitecture(arch);
    assert.equal(ck.longestDelay, d);
    assert.equal(ck.slack, 5 - d);
  }
  const tooSlow = B.planArchitecture({ delays: { sg: 2, gi: 2, io: 2 } });
  const ck = B.checkArchitecture(tooSlow, tooSlow.req);
  assert.equal(ck.ok, false);
  assert.ok(ck.problems.some((p) => p.code === 'deadline' && p.vars.d === 6));
});

test('checkArchitecture finds cycles, dangling and cut links, even layers, shortfalls and the coupling channel', () => {
  const base = () => B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, stabilizer: false });
  const codes = (a, r) => B.checkArchitecture(a, r).problems.map((p) => p.level + ':' + p.code);
  let a = base();
  a.microtubules.push({ id: 'x', from: 'o', to: 'g0', kind: 'signal', delay: 0, jitter: 0 });
  assert.ok(codes(a).includes('error:cycle'));
  a = base(); a.microtubules.push({ id: 'y', from: 'nowhere', to: 'o', kind: 'signal', delay: 0, jitter: 0 });
  assert.ok(codes(a).includes('error:dangling'));
  a = base(); a.microtubules = a.microtubules.filter((e) => e.from !== 'g2');
  assert.ok(codes(a).includes('error:unreachable'));
  const even = B.buildArchitecture({ perColumn: 4, columns: 2, integrators: 1 });
  const c2 = codes(even, { sensoryFaults: 2, columnFaults: 1 });
  assert.ok(c2.includes('warning:even'));
  assert.equal(c2.filter((x) => x === 'error:below_requirement').length, 2);
  const coupled = B.planArchitecture({ sensoryFaults: 1, c: 0.05 });
  assert.ok(codes(coupled, coupled.req).includes('error:coupling_channel'));
  const coupled0 = B.planArchitecture({ sensoryFaults: 0, c: 0.05 });
  assert.ok(codes(coupled0, coupled0.req).includes('warning:coupling_channel') === false, 'one member per column has no peer to couple to');
  const coupledNoReq = B.buildArchitecture({ perColumn: 3, c: 0.05 });
  assert.ok(codes(coupledNoReq).includes('warning:coupling_channel'));
  const big = B.buildArchitecture({ perColumn: 5, columns: 3 });
  assert.ok(codes(big, { sensoryFaults: 1, columnFaults: 1 }).includes('note:above_requirement'));
});

test('runBrain is seeded, deterministic and sanitizes hostile options', () => {
  const a = B.planArchitecture({});
  const r1 = B.runBrain(a, { seed: 'det', episodes: 30 }), r2 = B.runBrain(a, { seed: 'det', episodes: 30 });
  assert.deepEqual(r1.summary, r2.summary);
  const r3 = B.runBrain(a, { seed: 'other', episodes: 30 });
  assert.notDeepEqual(r1.episodes.map((e) => e.outStep), r3.episodes.map((e) => e.outStep));
  const h = B.createBrainRun(a, { seed: { toString: () => 'x' }, episodes: 'lots', faults: { sensory: 99, columns: -4, integrators: 'z', mode: '__proto__' } });
  assert.equal(h.opts.seed, 'brain1');
  assert.equal(h.opts.episodes, 100);
  assert.deepEqual(h.opts.faults, { sensory: 3, sensoryColumns: 3, columns: 0, integrators: 0, mode: 'collude' });
  assert.equal(B.createBrainRun(a, { episodes: 1e9 }).opts.episodes, B.LIMITS.episodes);
  // stepping in slices gives the same run as one call
  const R = B.createBrainRun(a, { seed: 'det', episodes: 30 });
  while (!B.brainDone(R)) B.stepBrainRun(R, 7);
  assert.deepEqual(B.finishBrainRun(R).summary, r1.summary);
  assert.equal(B.planArchitecture({ sensoryFaults: 99 }).perColumn, 2 * B.LIMITS.f + 1);
  assert.doesNotThrow(() => JSON.parse(B.toJSON(r1)));
});

test('simulation: within the fault bound no false output, past it the colluders take over (seeded)', () => {
  const a = B.planArchitecture({ sensoryFaults: 1, columnFaults: 1 });
  const clean = B.runBrain(a, { seed: 'sim', episodes: 120 }).summary;
  assert.equal(clean.F, 0);
  assert.ok(clean.recall.p > 0.8, `recall ${clean.recall.p}`);
  const inside = B.runBrain(a, { seed: 'sim', episodes: 120, faults: { sensory: 1, columns: 1, mode: 'collude' } }).summary;
  assert.equal(inside.F, 0, 'one bad member per column and one bad column release nothing false');
  const past = B.runBrain(a, { seed: 'sim', episodes: 120, faults: { sensory: 2, mode: 'collude' } }).summary;
  assert.ok(past.F > 100, `past the bound: ${past.F} false outputs of 120`);
  // with coupling on, a single faulty member per column leaks into its honest peers
  const coupled = B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, c: 0.05 });
  const leak = B.runBrain(coupled, { seed: 'sim', episodes: 120, faults: { sensory: 1, mode: 'collude' } }).summary;
  assert.ok(leak.F > 0, 'the coupling channel lets a within-bound fault through');
});

test('the inhibitory membrane applies the clamped, leaky stabilizer of game.js', () => {
  const a = B.planArchitecture({ g: 2, stabilizer: true });
  const r = B.runBrain(a, { seed: 'z', episodes: 12 });
  let ema = G.TARGET;
  r.episodes.forEach((e) => {
    assert.ok(Math.abs(e.rateEma - ema) < 1e-12);
    assert.ok(Math.abs(e.geff - G.clampGain(2) * G.stabilizerFactor(ema)) < 1e-12);
    ema = G.leakyUpdate(ema, e.out ? 1 : 0);
  });
  const off = B.runBrain(B.planArchitecture({ g: 2, stabilizer: false }), { seed: 'z', episodes: 4 });
  off.episodes.forEach((e) => assert.equal(e.geff, 2));
});

test('renderSvg: one shape per membrane, one link per microtubule, marked faults, escaped text, no remote URL', () => {
  const a = B.planArchitecture({ sensoryFaults: 2, columnFaults: 1, integratorFaults: 1, stabilizer: true, memory: true });
  const svg = B.renderSvg(a, { faults: { sensory: 1, columns: 1, integrators: 1 }, title: 'a <b> & "c"' });
  assert.equal((svg.match(/class="membrane"/g) || []).length, a.counts.total);
  assert.equal((svg.match(/class="mt"/g) || []).length, a.tubes.total);
  assert.equal((svg.match(/data-faulty="1"/g) || []).length, 3 + 1 + 1);
  assert.match(svg, /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(svg));
  assert.match(svg, /^<svg [^>]*role="img"/);
  const hc = B.renderSvg(a, { hc: true });
  assert.ok(!/#40d0e0/.test(hc), 'high contrast uses no hue');
  assert.match(B.describe(a), /5 sensory membranes/);
});

test('brain strings: English and French have the same keys and cover every rule and problem code', () => {
  const L = require('../brain-i18n.js').LANGS;
  assert.deepEqual(Object.keys(L.fr).sort(), Object.keys(L.en).sort());
  for (const lang of ['en', 'fr']) {
    for (const k of Object.keys(L[lang])) assert.ok(typeof L[lang][k] === 'string' && L[lang][k].length > 0, `${lang} ${k}`);
    for (const r of ['sensory', 'gate', 'integrator', 'output', 'inhibitory', 'inhibitory_off', 'memory', 'memory_off']) assert.ok(L[lang]['rule.' + r], `${lang} rule.${r}`);
    for (const p of ['empty_layer', 'even', 'output_count', 'dangling', 'cycle', 'unreachable', 'deadline', 'slack', 'below_requirement', 'above_requirement', 'single_points', 'coupling_channel']) assert.ok(L[lang]['prob.' + p], `${lang} prob.${p}`);
    for (const kd of B.KINDS) assert.ok(L[lang]['kind.' + kd], `${lang} kind.${kd}`);
  }
});
