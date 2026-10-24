'use strict';
/*
 * Compare the JavaScript port with the repository's measured width-32 means.
 *   node scripts/port-check.js [seeds]      (default 100; writes docs/port-check.txt)
 * The Python original used its own random generator, so only statistical
 * agreement is expected. The table reports the difference in units of the
 * combined standard error; it is a description of agreement, not a pass mark.
 */
const fs = require('node:fs');
const path = require('node:path');
const G = require('../game.js');

const seeds = Math.max(5, parseInt(process.argv[2], 10) || 100);
const REF_SEEDS = G.baselines.CONTEST32[0].seeds;
const lines = [];
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / Math.max(1, a.length - 1)); };

lines.push(`Port check: JavaScript port vs ${G.baselines.SOURCE.contest} (width 32, ${REF_SEEDS} Python seeds per row)`);
lines.push(`JavaScript seeds per row: ${seeds}. Scheme "random" (reward 0) is the repository's contest with no extra term, fcost 0, evolution on.`);
lines.push('z = (JS mean - repo mean) / sqrt(sdJS^2/seeds + sdRepo^2/' + REF_SEEDS + ')');
lines.push('');
lines.push('w     cfg   metric   repo     js       z');
let worst = 0, cnt = 0, over2 = 0;
for (const row of G.baselines.CONTEST32) {
  const s = Object.assign({}, G.DEFAULTS, { scheme: 'random', w: row.w, shield: row.cfg[0] === 'S', amp: row.cfg[1] === 'A', stab: row.cfg[2] === 'Z' });
  const T = [], F = [], P = [];
  for (let k = 0; k < seeds; k++) {
    const c = G.createContest('pc' + k, s);
    while (!G.done(c)) G.stepGeneration(c, s);
    const r = G.summarize(c.hist);
    T.push(r.T); F.push(r.F); P.push(r.precision);
  }
  const rows = [['T', row.T, row.Tsd, T], ['F', row.F, row.Fsd, F], ['P', row.P, row.Psd, P]];
  for (const [name, ref, refSd, js] of rows) {
    const z = (mean(js) - ref) / Math.sqrt(sd(js) ** 2 / seeds + refSd ** 2 / REF_SEEDS);
    worst = Math.max(worst, Math.abs(z)); cnt++; if (Math.abs(z) > 2) over2++;
    lines.push(`${row.w.toFixed(1)}   ${row.cfg}   ${name}      ${ref.toFixed(3).padEnd(8)} ${mean(js).toFixed(3).padEnd(8)} ${z.toFixed(2)}`);
  }
}
lines.push('');
lines.push(`${cnt} comparisons; ${over2} with |z| > 2; largest |z| = ${worst.toFixed(2)}`);
const text = lines.join('\n') + '\n';
process.stdout.write(text);
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'port-check.txt'), text);
