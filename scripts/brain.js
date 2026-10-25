'use strict';
/*
 * Plan, check and run a brain architecture from the command line (SYNTHETIC classical simulation).
 *
 *   node scripts/brain.js                                  plan with f=1, g=1, h=0 and run 200 episodes
 *   node scripts/brain.js --f 2 --g 1 --h 1 --mem          bigger plan, memory membrane on
 *   node scripts/brain.js --fault-sensory 1 --fault-columns 1 --mode collude
 *   node scripts/brain.js --gi 3 --jitter 0.1 --c 0.05     slower, noisier links, coupling on
 *   node scripts/brain.js --json                           machine-readable record
 *   node scripts/brain.js --svg out.svg                    write the diagram
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const B = require('../brain.js');
const L = require('../brain-i18n.js').LANGS.en;
const G = require('../game.js');

function parse(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2), nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) a[key] = true; else { a[key] = nxt; i++; }
  }
  return a;
}
const a = parse(process.argv.slice(2));
if (a.help) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).map((s) => s.replace(/^ \* ?/, '')).join('\n'));
  process.exit(0);
}
const num = (k, d) => (a[k] === undefined ? d : Number(a[k]));
const req = {
  sensoryFaults: num('f', 1), columnFaults: num('g', 1), integratorFaults: num('h', 0),
  stabilizer: !a['no-stab'], memory: !!a.mem, fuse: !a['no-fuse'],
  delays: { sg: num('sg', 0), gi: num('gi', 1), io: num('io', 0) },
  jitter: num('jitter', 0), c: num('c', 0), th: num('th', 0.5), g: num('gain', 1)
};
const arch = B.planArchitecture(req);
const check = B.checkArchitecture(arch, arch.req);
const faults = { sensory: num('fault-sensory', 0), columns: num('fault-columns', 0), integrators: num('fault-integrators', 0), mode: a.mode || 'collude' };
const opts = { seed: typeof a.seed === 'string' ? a.seed : 'brain1', episodes: num('episodes', 200), faults };

if (a.svg) fs.writeFileSync(a.svg, B.renderSvg(arch, { faults }) + '\n');
const t0 = process.hrtime.bigint();
const run = check.ok ? B.runBrain(arch, opts) : null;
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

if (a.json) {
  console.log(run ? B.toJSON(run) : JSON.stringify({ spec: arch.spec, check }, null, 2));
  process.exit(check.ok ? 0 : 1);
}
const out = [];
out.push('Brain architecture (SYNTHETIC classical simulation, brain ' + B.VERSION + ')');
out.push(B.describe(arch));
out.push('');
out.push('Necessary membranes:');
arch.plan.forEach((p) => out.push('  ' + (L['kind.' + p.kind] + '          ').slice(0, 11) + String(p.count).padStart(3) + '  ' + G.fmt(L['rule.' + p.rule], p.vars)));
out.push('');
out.push('Checks:');
check.problems.forEach((p) => {
  const v = Object.assign({}, p.vars);
  if (v.layer) v.layer = L['layer.' + v.layer];
  out.push('  ' + L['level.' + p.level] + ': ' + G.fmt(L['prob.' + p.code], v));
});
if (!run) { console.log(out.join('\n')); process.exit(1); }
const s = run.summary, w = (x) => x.p.toFixed(3) + ' [' + x.lo.toFixed(3) + ', ' + x.hi.toFixed(3) + ']';
out.push('');
out.push(`Run: seed ${run.opts.seed}, ${s.episodes} episodes (${s.planted} planted), faults ${JSON.stringify(run.opts.faults)}`);
out.push(`  brain output   true ${s.T}, false ${s.F} (on noise ${s.Fnoise}), recall ${w(s.recall)}, false per episode ${w(s.falseRate)}`);
out.push(`                 mean fidelity ${s.meanFidelity === null ? 'n/a' : s.meanFidelity.toFixed(3)}, mean output step ${s.meanLatency === null ? 'n/a' : s.meanLatency.toFixed(1)}, lost ${s.lost} of ${s.lost + s.moved} transported vectors`);
out.push(`  one membrane   true ${s.single.T}, false ${s.single.F}, recall ${w(s.single.recall)}, false per episode ${w(s.single.falseRate)}${s.single.honest ? '' : ' (this membrane is faulty)'}`);
out.push(`  work           ${s.ojaUpdates} Oja updates of a 32-dimensional complex vector, ${ms.toFixed(0)} ms on this machine (Node ${process.version})`);
console.log(out.join('\n'));
