'use strict';
/*
 * Reverse Membranes check (SYNTHETIC classical simulation). Measures, with fixed seeds:
 *   A. the mirror test: dark and bright worlds against reverse and forward membranes;
 *   B. true and false outputs per darkness and threshold, with echo 0, 1 and 2 (shield on);
 *   C. whole contests on 20 seeds: fixed settings against a threshold that follows the darkness;
 *   D. the shield on and off;
 *   E. why the width is 16: one reverse membrane's fidelity after 60 steps at widths 16 and 32.
 *   node scripts/reverse-check.js          print the report
 *   node scripts/reverse-check.js --write  also write docs/reverse-check.txt
 *
 * Copyright (c) 2026 Jean-François Brisson, Spark AI NLP. AGPL-3.0-only.
 */
const fs = require('node:fs');
const path = require('node:path');
const G = require('../game.js');
const R = require('../reverse.js');
const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
const pad = (s, n) => String(s).padStart(n);
const t0 = Date.now();
say('Reverse Membranes check (SYNTHETIC classical simulation, reverse.js ' + R.VERSION + ')');
say(`Width ${R.N}, ${R.STEPS} steps, check every ${R.CHECK}, window ${R.WINDOW}, eta forward ${R.ETA.forward}, reverse ${R.ETA.reverse}.`);
say('A true output is a declaration with fidelity >= ' + R.TRUTH + ' to the hidden pattern; anything else output is false.');
say('');
say('A. Mirror test: 200 episodes per cell (100 with a pattern, darkness 0.8 in the dark world), threshold 0.6, echo 1');
for (const shield of [true, false]) {
  const cells = R.mirrorTest({ th: 0.6, echo: 1, shield }, 'check-mirror', 200);
  say(`   shield ${shield ? 'on ' : 'off'}  ` + cells.map((c) => `${c.world}/${c.polarity}: T ${c.T} F ${c.F}`).join(' | '));
}
say('');
say('B. True/false outputs per 60 planted + 60 noise episodes, shield on (rows: darkness, columns: threshold)');
const THS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const bestTh = {};
for (const echo of [0, 1, 2]) {
  say(`   echo ${echo}   ` + THS.map((t) => pad(t.toFixed(1), 7)).join(''));
  for (const depth of [0.6, 0.7, 0.8, 0.9, 1.0]) {
    const row = [];
    let best = null;
    for (const th of THS) {
      const rng = G.makeRng('check-depth/' + depth + '/' + echo);
      const P = R.sanitizeSettings({ th, echo, shield: true });
      let T = 0, F = 0;
      for (let e = 0; e < 120; e++) {
        const pat = e % 2 === 0 ? G.rvec(R.N, rng) : null;
        const r = R.episode({ world: 'dark', pat, depth, P }, rng, null);
        const j = R.judge(r.decl, pat, true);
        T += j.evT; F += j.evF;
      }
      row.push(pad(`${T}/${F}`, 7));
      if (!best || T - 2 * F > best.v) best = { v: T - 2 * F, th };
    }
    if (echo === 1) bestTh[depth] = best.th;
    say(`   d ${depth.toFixed(1)}    ` + row.join(''));
  }
}
say('   With echo 1, the threshold with the most true minus twice false outputs: ' +
  [0.6, 0.7, 0.8, 0.9, 1.0].map((d) => `darkness ${d.toFixed(1)} -> ${bestTh[d].toFixed(1)}`).join(', '));
say('');
const SEEDS = Array.from({ length: 20 }, (_, k) => 'check-' + (k + 1));
function contest(seed, policy) {
  const c = R.createContest(seed);
  while (!R.done(c)) R.stepRound(c, policy(c.depths[c.gen]));
  return R.summarize(c.hist);
}
function row(name, policy) {
  const rs = SEEDS.map((s) => contest(s, policy));
  const m = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const sc = rs.map((r) => r.score).sort((a, b) => a - b);
  say(`   ${name.padEnd(46)} score ${m((r) => r.score).toFixed(1).padStart(5)} (min ${sc[0].toFixed(1)}, max ${sc[sc.length - 1].toFixed(1)})  T ${m((r) => r.T).toFixed(1).padStart(5)}  F ${m((r) => r.F).toFixed(1).padStart(5)}  missed ${m((r) => r.missed).toFixed(1).padStart(5)} of ${R.ROUNDS * R.EP / 2}`);
  return m((r) => r.score);
}
say(`C. Whole contests (${R.ROUNDS} rounds of ${R.EP} episodes), mean over ${SEEDS.length} seeds, shield on`);
row('forward membranes, threshold 0.6, echo 1', () => ({ polarity: 'forward', th: 0.6, echo: 1 }));
for (const echo of [0, 1, 2]) for (const th of [0.4, 0.6, 0.8]) row(`reverse, fixed threshold ${th.toFixed(1)}, echo ${echo}`, () => ({ th, echo }));
row('reverse, threshold = darkness - 0.1, echo 1', (d) => ({ th: Math.max(0.2, d - 0.1), echo: 1 }));
row('reverse, threshold = darkness - 0.2, echo 1', (d) => ({ th: Math.max(0.2, d - 0.2), echo: 1 }));
row('reverse, threshold = darkness - 0.1, echo 2', (d) => ({ th: Math.max(0.2, d - 0.1), echo: 2 }));
{
  let win = 0, tie = 0;
  for (const sd of SEEDS) {
    const a = Math.round(contest(sd, (d) => ({ th: Math.max(0.2, Math.round(20 * (d - 0.1)) / 20), echo: 1 })).score);
    const b = Math.round(contest(sd, () => ({ th: 0.6, echo: 1 })).score);
    if (a > b) win++; else if (a === b) tie++;
  }
  say(`   Threshold = darkness - 0.1 (on the slider's 0.05 grid) against fixed 0.6, echo 1, rounded scores: higher on ${win} of ${SEEDS.length} seeds, equal on ${tie}, lower on ${SEEDS.length - win - tie}.`);
}
say('');
say('D. The shield (2 of 3 must agree), reverse, threshold 0.6, echo 1');
row('shield on', () => ({ th: 0.6, echo: 1, shield: true }));
row('shield off', () => ({ th: 0.6, echo: 1, shield: false }));
row('shield off, threshold 0.8', () => ({ th: 0.8, echo: 1, shield: false }));
say('');
say('E. One reverse membrane, darkness 1, 60 steps, mean fidelity to the hidden pattern over 60 episodes');
for (const n of [16, 32]) {
  const cells = [];
  for (const echo of [0, 1, 2]) {
    const rng = G.makeRng('check-width/' + n + '/' + echo);
    let f = 0;
    for (let e = 0; e < 60; e++) {
      const pat = G.rvec(n, rng), v = G.rvec(n, rng), buf = [];
      for (let t = 1; t <= R.STEPS; t++) {
        const x = R.darkSample(pat, 1, rng);
        buf.push(x); if (buf.length > R.WINDOW) buf.shift();
        R.update(v, x, -1, R.ETA.reverse);
        for (let r = 0; r < echo; r++) for (const b of buf) R.update(v, b, -1, R.ETA.reverse);
      }
      f += G.fidelity(v, pat);
    }
    cells.push(`echo ${echo}: ${(f / 60).toFixed(2)}`);
  }
  say(`   width ${String(n).padStart(2)}   ` + cells.join('   '));
}
say('');
say(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'reverse-check.txt'), lines.filter((l) => !/^\(\d+ s\)$/.test(l)).join('\n') + '\n');
  console.log('wrote docs/reverse-check.txt');
}
