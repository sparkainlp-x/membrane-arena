'use strict';
/*
 * Measure the brain architecture in this simulation and write docs/brain-check.txt
 * (SYNTHETIC classical simulation; about 3 minutes on one machine).
 *
 *   node scripts/brain-check.js            write docs/brain-check.txt
 *   node scripts/brain-check.js --quick    1 seed per row, print only
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../brain.js');
const ST = require('../stats.js');

const quick = process.argv.includes('--quick');
const SEEDS = quick ? ['chk1'] : ['chk1', 'chk2', 'chk3', 'chk4', 'chk5'];
const EPISODES = 200;
const lines = [];
const say = (s) => { lines.push(s); if (quick) console.log(s); else process.stdout.write('.'); };
const t0 = Date.now();

function pooled(arch, faults) {
  const eps = [];
  let ms = 0;
  for (const seed of SEEDS) {
    const a = Date.now();
    eps.push(...B.runBrain(arch, { seed, episodes: EPISODES, faults }).episodes);
    ms += Date.now() - a;
  }
  const s = B.summarizeBrain(eps, true);
  s.ms = ms;
  return s;
}
const w = (x) => `${x.p.toFixed(3)} [${x.lo.toFixed(3)}, ${x.hi.toFixed(3)}]`;
const f3 = (x) => (x === null ? '  n/a' : x.toFixed(3));
const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n);

say('Brain architecture check (SYNTHETIC classical simulation)');
say(`brain ${B.VERSION}; Node ${process.version}; seeds ${SEEDS.join(', ')}; ${EPISODES} episodes per seed (half planted).`);
say('Counts are pooled over seeds. Wilson 95 percent intervals treat episodes as independent; the stabilizer links');
say('consecutive episodes, so the intervals are approximate. Nothing here measures a physical or biological system.');
say('');

/* ---- A: counting rule, exhaustive over placements ---- */
say('A. Counting rule, logic level (no learning): one column of m voters, every placement of k colluding faults.');
say('   Entry: what the output does in the worst placement. T = releases the true vector, F = can release the');
say('   faults\' vector, - = can release nothing.');
let header = '   m \\ k ';
for (let k = 0; k <= 7; k++) header += pad(k, 3);
say(header);
for (let m = 1; m <= 7; m++) {
  const arch = B.buildArchitecture({ perColumn: m, columns: 1, integrators: 1, stabilizer: false });
  let row = '   ' + pad(m, 6);
  for (let k = 0; k <= m; k++) {
    let worst = 'T';
    for (let mask = 0; mask < 1 << m; mask++) {
      let bits = 0; const set = {};
      for (let i = 0; i < m; i++) if (mask & (1 << i)) { bits++; set['s0.' + i] = true; }
      if (bits !== k) continue;
      const o = B.logicOutcome(arch, { mode: 'collude' }, set);
      if (o === 'false') worst = 'F'; else if (o === 'none' && worst === 'T') worst = '-';
    }
    row += pad(worst, 3);
  }
  say(row + `  quorum ${B.quorum(m)}, tolerates ${B.tolerated(m)}`);
}
say('   Reading: T in every column up to k = f needs m >= 2f + 1. Even m adds no tolerance over m - 1.');
say('');

/* ---- B: simulation under faults ---- */
const plan = B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, integratorFaults: 0 });
say('B. Simulation, planned architecture for f = 1, g = 1, h = 0: ' + B.describe(plan));
say('   Coupling 0, threshold 0.5, gain 1, stabilizer on, fusion on, delays sensory>gate 0, gate>integrator 1, integrator>output 0.');
const scen = [
  ['no faults', {}],
  ['1 colluding member per column', { sensory: 1, mode: 'collude' }],
  ['1 colluding member per column + 1 column', { sensory: 1, columns: 1, mode: 'collude' }],
  ['1 stuck member per column + 1 column', { sensory: 1, columns: 1, mode: 'stuck' }],
  ['1 silent member per column + 1 column', { sensory: 1, columns: 1, mode: 'silent' }],
  ['PAST BOUND: 2 colluding members per column', { sensory: 2, mode: 'collude' }],
  ['PAST BOUND: 2 colluding columns', { columns: 2, mode: 'collude' }]
];
say('   ' + pad('scenario', 46) + pad('true', 6) + pad('false', 6) + pad('recall', 24) + pad('false per episode', 24) + pad('fid', 7) + pad('step', 6) + 'lost');
let first = null;
for (const [name, f] of scen) {
  const s = pooled(plan, f);
  if (!first) first = s;
  say('   ' + pad(name, 46) + pad(s.T, 6) + pad(s.F, 6) + pad(w(s.recall), 24) + pad(w(s.falseRate), 24) + pad(f3(s.meanFidelity), 7) + pad(s.meanLatency === null ? 'n/a' : s.meanLatency.toFixed(1), 6) + `${(100 * s.lost / Math.max(1, s.lost + s.moved)).toFixed(1)}%`);
}
say('   One honest sensory membrane alone, same runs without faults: true ' + first.single.T + ', false ' + first.single.F + ', recall ' + w(first.single.recall) + ', mean fidelity ' + f3(first.single.meanFidelity) + '.');
say('');

/* ---- C: coupling as a fault channel ---- */
say('C. Coupling inside a column, same plan. Within the bound (1 colluding member per column) the vote count only');
say('   protects the output when the honest members are independent of the faulty one.');
say('   ' + pad('coupling', 10) + pad('faults', 30) + pad('true', 6) + pad('false', 6) + pad('recall', 24) + 'false per episode');
for (const c of [0, 0.02, 0.05]) {
  const a = B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, c });
  for (const [name, f] of [['none', {}], ['1 colluding member per column', { sensory: 1, mode: 'collude' }]]) {
    const s = pooled(a, f);
    say('   ' + pad(c.toFixed(2), 10) + pad(name, 30) + pad(s.T, 6) + pad(s.F, 6) + pad(w(s.recall), 24) + w(s.falseRate));
  }
}
say('   The checker reports coupling above 0 as an error whenever faults must be tolerated.');
say('');

/* ---- D: microtubule delay ---- */
say('D. Delay on the gate to integrator microtubules (check periods of 10 steps), same plan.');
say('   ' + pad('delay', 7) + pad('faults', 42) + pad('recall', 24) + pad('step', 7) + 'lost');
for (const d of [0, 1, 2, 3, 4]) {
  const a = B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, delays: { sg: 0, gi: d, io: 0 } });
  for (const [name, f] of [['none', {}], ['1 colluding member per column + 1 column', { sensory: 1, columns: 1, mode: 'collude' }]]) {
    const s = pooled(a, f);
    say('   ' + pad(d, 7) + pad(name, 42) + pad(w(s.recall), 24) + pad(s.meanLatency === null ? 'n/a' : s.meanLatency.toFixed(1), 7) + `${(100 * s.lost / Math.max(1, s.lost + s.moved)).toFixed(1)}%`);
  }
}
say('   A delay of 5 is rejected by the checker: the first declaration is at step 10 and nothing can arrive by step 60.');
say('');

/* ---- E: fusion ---- */
say('E. Fusing agreeing vectors at each gate and integrator, against passing the leader\'s vector, no faults.');
for (const fuse of [true, false]) {
  const s = pooled(B.planArchitecture({ sensoryFaults: 1, columnFaults: 1, fuse }), {});
  say(`   fuse ${pad(fuse ? 'on' : 'off', 4)} true ${pad(s.T, 5)} false ${pad(s.F, 4)} recall ${w(s.recall)} mean fidelity of the output ${f3(s.meanFidelity)}`);
}
say('');

/* ---- F: size and work ---- */
say('F. Size of the plan as requirements grow (membranes / microtubules), and work in the no-fault run of B.');
for (const [f, g, h] of [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 1, 0], [2, 2, 1], [3, 2, 2]]) {
  const a = B.planArchitecture({ sensoryFaults: f, columnFaults: g, integratorFaults: h });
  say(`   f=${f} g=${g} h=${h}: ${pad(a.counts.total, 4)} membranes (${a.counts.sensory} sensory, ${a.counts.gate} gates, ${a.counts.integrator} integrators, 1 output, ${a.counts.inhibitory} inhibitory), ${a.tubes.total} microtubules`);
}
say(`   No-fault run of B: ${first.ojaUpdates} Oja updates for ${first.episodes} episodes, ${first.ms} ms of wall time in Node on this`);
say('   machine (single thread). This is a software timing, not a hardware measurement.');
say('');
say(`Total run time ${((Date.now() - t0) / 1000).toFixed(0)} s.`);

if (!quick) {
  const out = path.join(__dirname, '..', 'docs', 'brain-check.txt');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log('\nwrote docs/brain-check.txt');
}
