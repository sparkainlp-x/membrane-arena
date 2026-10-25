'use strict';
/*
 * Quorum Keeper level check (SYNTHETIC classical simulation). For every build level it tries every
 * design (members per column 1 to 9, columns 1 to 7, integrators 1 to 5, inhibitory membrane on or
 * off), keeps those whose logic holds against every placement within the budget, simulates them in
 * order of cost with the level's seed, and reports the cheapest design that earns each star. For
 * every break level it reports whether the goal can be reached and with how few faults.
 *   node scripts/quorum-check.js          print the report
 *   node scripts/quorum-check.js --write  also write docs/quorum-check.txt
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const path = require('node:path');
const Q = require('../quorum.js');
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const parDesigns = {};
const design = (ev) => ({ perColumn: ev.arch.perColumn, columns: ev.arch.columns, integrators: ev.arch.integrators, stabilizer: !!ev.arch.counts.inhibitory });
const t0 = Date.now();
const dname = (d) => `${d.perColumn}x${d.columns}, ${d.integrators} int${d.stabilizer ? ', inh' : ''}`;
say('Quorum Keeper level check (SYNTHETIC classical simulation, quorum.js ' + Q.VERSION + ')');
say('Every design: members per column 1-9, columns 1-7, integrators 1-5, inhibitory on/off.');
say(`Recall is measured over ${Q.SIM_EPISODES} episodes (half planted) with the level seed, under the most fragile placement.`);
say('');
say('A. Build levels');
let allOk = true;
for (const L of Q.LEVELS.filter((l) => l.kind === 'build')) {
  const pass = [];
  let tried = 0, logicMin = null;
  for (let m = 1; m <= 9; m++) for (let C = 1; C <= 7; C++) for (let I = 1; I <= 5; I++) for (const stab of [false, true]) {
    const d = { perColumn: m, columns: C, integrators: I, stabilizer: stab };
    // cheap filter before the adversary: the cost alone
    const cost = m * C + C + I + 1 + (stab ? 1 : 0);
    if (cost > L.budget) continue;
    tried++;
    const ev = Q.evaluateBuild(L, d);
    if (!ev.pass) continue;
    if (logicMin === null || ev.cost < logicMin.cost) logicMin = ev;
    pass.push(ev);
  }
  pass.sort((a, b) => a.cost - b.cost || a.design.stabilizer - b.design.stabilizer);
  let best2 = null, simulated = 0;
  const rows = [];
  // simulate in order of cost and stop at the first design that meets the recall target: it is
  // the cheapest one, so it fixes the par
  for (const ev of pass) {
    const s = Q.simulate(L, ev); simulated++;
    const sc = Q.scoreBuild(L, ev, s);
    rows.push({ ev, s, sc });
    if (sc.stars >= 2) { best2 = { ev, s }; parDesigns[L.id] = ev.design || design(ev); break; }
  }
  const threat = JSON.stringify(L.threat), d = L.delays;
  say(`${L.id}  mode ${L.mode}, threat ${threat}, delays sg ${d.sg} gi ${d.gi} io ${d.io}, budget ${L.budget}, recall target ${L.recall}, par ${L.par}`);
  say(`    designs within budget: ${tried}; logic holds for ${pass.length}`);
  if (logicMin) say(`    cheapest design whose logic holds: ${dname(logicMin.design)} = ${logicMin.cost} membranes (${logicMin.adversary.total} placements tried)`);
  else say('    NO design within budget holds');
  const falseAny = rows.reduce((a, r) => a + r.s.F, 0);
  say(`    simulated in order of cost until the recall target was met: ${simulated} designs, false outputs ${falseAny}`);
  for (const r of rows.slice(-8)) say(`      ${dname(r.ev.design).padEnd(22)} cost ${String(r.ev.cost).padStart(2)}  recall ${r.s.recall.p.toFixed(3)} [${r.s.recall.lo.toFixed(2)}, ${r.s.recall.hi.toFixed(2)}]  false ${r.s.F}  stars ${r.sc.stars}`);
  if (rows.length > 8) say(`      (the ${rows.length - 8} cheaper designs above these also missed the target)`);
  if (best2) say(`    cheapest design meeting the recall target: ${dname(best2.ev.design)} = ${best2.ev.cost} membranes, recall ${best2.s.recall.p.toFixed(3)}`);
  else say('    NO design within budget meets the recall target');
  const ok = !!best2 && best2.ev.cost === L.par && logicMin && logicMin.cost <= L.par && L.start && falseAny === 0;
  const startOk = !Q.evaluateBuild(L, L.start).pass;
  say(`    par equals the cheapest 3-star design: ${ok ? 'yes' : 'NO'}; the starting design fails the logic: ${startOk ? 'yes' : 'NO'}`);
  allOk = allOk && ok && startOk;
  say('');
}
say('B. Break levels');
for (const L of Q.LEVELS.filter((l) => l.kind === 'break')) {
  const sol = Q.solveBreak(L);
  const p = L.spec;
  say(`${L.id}  ${p.perColumn}x${p.columns}, ${p.integrators} int, mode ${L.mode}, goal ${L.goal}, up to ${L.budget} faults on ${L.kinds.join('/')}`);
  say(`    placements tried: ${sol.total} (true ${sol.counts.true}, false ${sol.counts.false}, none ${sol.counts.none})`);
  say(sol.breakable ? `    breakable with ${sol.minFaults} fault${sol.minFaults > 1 ? 's' : ''}: ${Object.keys(sol.example).join(', ')}` : '    cannot be broken: the right move is the claim');
}
say('');
// C. the inhibitory membrane at each par design, on and off, over the level seed and two more
say('C. Inhibitory membrane on and off at each par design (same layers), recall over three seeds');
for (const L of Q.LEVELS.filter((l) => l.kind === 'build')) {
  const par = parDesigns[L.id];
  if (!par) continue;
  const row = [];
  for (const stab of [false, true]) {
    const vals = [L.seed, 'qk-alt-1', 'qk-alt-2'].map((seed) => {
      const LS = Object.assign({}, L, { seed, budget: 99 });
      const ev = Q.evaluateBuild(LS, Object.assign({}, par, { stabilizer: stab }));
      return ev.pass ? Q.simulate(LS, ev).recall.p.toFixed(2) : 'n/a';
    });
    row.push(`${stab ? 'with' : 'without'} ${vals.join(' ')}`);
  }
  say(`${L.id}  ${par.perColumn}x${par.columns}, ${par.integrators} int: ${row.join(' | ')}`);
}
say(`All build levels consistent: ${allOk ? 'yes' : 'NO'}`);
say(`Wall time ${((Date.now() - t0) / 1000).toFixed(1)} s in Node ${process.version} (single thread).`);
if (process.argv.includes('--write')) fs.writeFileSync(path.join(__dirname, '..', 'docs', 'quorum-check.txt'), lines.join('\n').replace(/Wall time .*/, 'Wall time not recorded in the file (it varies by machine).') + '\n');
process.exit(allOk ? 0 : 1);
