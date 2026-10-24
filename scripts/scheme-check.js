'use strict';
/*
 * What the arena's reward-scheme term does in this port (an arena extension, not a repository measurement).
 *   node scripts/scheme-check.js [seeds]     (default 40; writes docs/scheme-check.txt)
 * Runs each scheme with the shield on and off at w = 0.5 and reports mean counts and game score.
 */
const fs = require('node:fs');
const path = require('node:path');
const G = require('../game.js');

const seeds = Math.max(5, parseInt(process.argv[2], 10) || 40);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const lines = ['Reward-scheme term in the arena port (not measured in the repository). w = 0.5, ' + seeds + ' seeds, evolution on.', '',
  'shield  scheme       T       F       precision  score'];
for (const shield of [true, false]) for (const scheme of G.SCHEMES) {
  const s = Object.assign({}, G.DEFAULTS, { scheme, shield, w: 0.5 });
  const T = [], F = [], P = [], S = [];
  for (let k = 0; k < seeds; k++) {
    const c = G.createContest('sc' + k, s);
    while (!G.done(c)) G.stepGeneration(c, s);
    const r = G.summarize(c.hist);
    T.push(r.T); F.push(r.F); P.push(r.precision); S.push(r.score);
  }
  lines.push(`${shield ? 'on ' : 'off'}     ${scheme.padEnd(11)} ${mean(T).toFixed(1).padStart(6)}  ${mean(F).toFixed(1).padStart(6)}  ${mean(P).toFixed(3).padStart(9)}  ${mean(S).toFixed(1).padStart(6)}`);
}
const text = lines.join('\n') + '\n';
process.stdout.write(text);
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'scheme-check.txt'), text);
