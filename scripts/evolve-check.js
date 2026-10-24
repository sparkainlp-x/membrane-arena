'use strict';
/*
 * What the (1+1) evolution step does in this port, from several starting points (measured here, not in the repository).
 *   node scripts/evolve-check.js [seeds]     (default 30; writes docs/evolve-check.txt)
 * Scheme "random" (no extra term), w = 0.5, shield on. Starts are (threshold, coupling, gain).
 */
const fs = require('node:fs');
const path = require('node:path');
const G = require('../game.js');

const seeds = Math.max(5, parseInt(process.argv[2], 10) || 30);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const starts = [[0.5, 0.05, 1.0, 'repository defaults'], [0.8, 0.05, 1.0, 'threshold too high'], [0.3, 0.05, 1.0, 'threshold low'], [0.5, 0.05, 1.8, 'gain too high'], [0.5, 0.05, 0.6, 'gain too low']];
const lines = ['Evolution step in the arena port (measured in this port, not in the repository).',
  `Shield on, scheme none, w = 0.5, ${seeds} seeds. Mean game score (0 to 100) with evolution off and on.`, '',
  'start (th, c, g)            note                  off     on'];
for (const [th, c, g, note] of starts) {
  const row = [];
  for (const evolve of [false, true]) {
    const sc = [];
    for (let k = 0; k < seeds; k++) {
      const s = Object.assign({}, G.DEFAULTS, { scheme: 'random', shield: true, evolve, th, c, g });
      const ct = G.createContest('ev' + k, s);
      while (!G.done(ct)) G.stepGeneration(ct, s);
      sc.push(G.summarize(ct.hist).score);
    }
    row.push(mean(sc));
  }
  lines.push(`(${th.toFixed(2)}, ${c.toFixed(2)}, ${g.toFixed(2)})`.padEnd(28) + note.padEnd(22) + row[0].toFixed(1).padStart(5) + row[1].toFixed(1).padStart(8));
}
const text = lines.join('\n') + '\n';
process.stdout.write(text);
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'evolve-check.txt'), text);
