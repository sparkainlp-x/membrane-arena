'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../scene.js');
const G = require('../game.js');

function rec(seed, o) {
  const s = Object.assign({}, G.DEFAULTS, o || {});
  const c = G.createContest(seed, s);
  return G.stepGeneration(c, s);
}
// a canvas whose 2d context accepts every call
function stubCanvas(w, h) {
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return typeof t[k] === 'undefined' ? () => {} : t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  ctx.calls = 0;
  return { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: w, height: h }) };
}

test('layout keeps every membrane, its ring and its arc inside the canvas for phone and desktop sizes', () => {
  for (const [w, h] of [[320, 336], [360, 378], [390, 410], [768, 480], [900, 562], [1100, 688], [1180, 738]]) {
    const L = S.layout(w, h);
    assert.equal(L.m.length, 3);
    L.m.forEach((m) => {
      const r = L.rm * 1.22 + 2;
      assert.ok(m.x - r >= 0 && m.x + r <= w, `x out at ${w}x${h}`);
      assert.ok(m.y - r >= 0 && m.y + r <= h, `y out at ${w}x${h}: ${m.y - r} ${m.y + r}`);
    });
  }
});

test('membranes form an equilateral triangle around the source', () => {
  const L = S.layout(900, 560), d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(Math.abs(d(L.m[0], L.m[1]) - d(L.m[1], L.m[2])) < 1e-6);
  assert.ok(Math.abs(d(L.m[0], L.m[1]) - d(L.m[0], L.m[2])) < 1e-6);
  assert.ok(L.m[0].y < L.m[1].y);
});

test('timeline: sorted events, one out per episode, one decl per declaration, gen event last', () => {
  const r = rec('tl');
  const tl = S.buildTimeline(r);
  for (let i = 1; i < tl.events.length; i++) assert.ok(tl.events[i].t >= tl.events[i - 1].t);
  assert.equal(tl.events.filter((e) => e.type === 'out').length, 8);
  const decls = r.episodes.reduce((a, e) => a + e.declStep.filter((d) => d !== null).length, 0);
  assert.equal(tl.events.filter((e) => e.type === 'decl').length, decls);
  assert.equal(tl.events[tl.events.length - 1].type, 'gen');
  assert.ok(Math.abs(tl.duration - (8 * (1 + S.EP_GAP) + S.INTERMISSION)) < 1e-9);
  tl.events.filter((e) => e.type === 'decl').forEach((e) => assert.equal(e.truth, r.episodes[e.ep].truth[e.i]));
});

test('eventsBetween: consecutive windows return every event exactly once', () => {
  const tl = S.buildTimeline(rec('win'));
  for (const dt of [0.016, 0.05, 0.37]) {
    let t = 0, n = 0;
    while (t < tl.duration + 1) { n += S.eventsBetween(tl, t, t + dt).length; t += dt; }
    assert.equal(n, tl.events.length);
  }
});

test('locate: episode index, step and phases', () => {
  const tl = S.buildTimeline(rec('loc'));
  assert.deepEqual([S.locate(tl, 0).ep, S.locate(tl, 0).step], [0, 0]);
  const mid = S.locate(tl, 0.5);
  assert.equal(mid.ep, 0);
  assert.ok(Math.abs(mid.step - 30) < 1e-9);
  assert.ok(S.locate(tl, 1.1).gap);
  assert.equal(S.locate(tl, tl.slot * 3 + 0.1).ep, 3);
  const end = S.locate(tl, tl.duration);
  assert.equal(end.ep, 7);
  assert.ok(end.inter);
  assert.equal(end.step, 60);
  assert.equal(S.locate(tl, -5).ep, 0);
});

test('hex lattice: nearest first, inside the radius, neighbours at one spacing, at most 6 each', () => {
  const sp = 12, pts = S.hexPoints(60, sp);
  assert.equal(pts[0].d, 0);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].d >= pts[i - 1].d);
  assert.ok(pts.every((p) => p.d <= 60 + 1e-9));
  const edges = S.hexEdges(pts, sp), deg = new Array(pts.length).fill(0);
  edges.forEach(([a, b]) => { deg[a]++; deg[b]++; assert.ok(Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y) <= sp * 1.05 + 1e-9); });
  assert.ok(deg.every((d) => d <= 6));
  assert.equal(deg[0], 6);
  assert.ok(pts.length > 50 && pts.length < 120);
});

test('crack paths are deterministic in the seed, differ across seeds, and start at the origin', () => {
  const a = S.crackPaths(7, 100, 7), b = S.crackPaths(7, 100, 7), c = S.crackPaths(8, 100, 7);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 7);
  a.forEach((p) => { assert.deepEqual(p[0], { x: 0, y: 0 }); assert.ok(p.length >= 5); });
});

test('energy colour: channels in range; brightness rises with energy up to the threshold', () => {
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  for (let i = 0; i < 3; i++) {
    let prev = -1;
    for (let e = 0; e <= 1.7; e += 0.1) {
      const c = S.energyColor(i, e);
      c.forEach((v) => assert.ok(v >= 0 && v <= 255));
      if (e <= 1) { assert.ok(lum(c) >= prev - 1e-9); prev = lum(c); }
    }
  }
  assert.match(S.rgba([1, 2, 3], 2), /^rgba\(1,2,3,1/);
  assert.equal(S.clamp(5, 0, 1), 1);
});

test('arena: plays a whole generation, firing each timeline event once, in order, then reports done', () => {
  const r = rec('arena');
  const arena = S.createArena(stubCanvas(900, 562), {});
  arena.setGeneration(r, {});
  arena.setSpeed(8); arena.setPlaying(true);
  const tl = S.buildTimeline(r), seen = [];
  let guard = 0;
  while (!arena.genDone() && guard++ < 5000) { seen.push(...arena.update(1 / 60)); arena.draw(); }
  assert.ok(arena.genDone());
  assert.equal(seen.length, tl.events.length);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].t >= seen[i - 1].t);
  assert.equal(seen[seen.length - 1].type, 'gen');
  assert.equal(arena.update(1 / 60).length, 0, 'nothing fires after the end');
});

test('arena: paused arena fires nothing and does not advance time', () => {
  const arena = S.createArena(stubCanvas(600, 400), {});
  arena.setGeneration(rec('p'), {});
  for (let i = 0; i < 30; i++) assert.equal(arena.update(1 / 60).length, 0);
  assert.equal(arena.state().t, 0);
});

test('arena: particle pool is bounded; reduced motion spawns none', () => {
  const r = rec('pool', { c: 0.5 });
  const a = S.createArena(stubCanvas(900, 562), {});
  a.setGeneration(r, {}); a.setSpeed(16); a.setPlaying(true);
  for (let i = 0; i < 600; i++) { a.update(1 / 30); a.draw(); assert.ok(a.stats().particles <= 320); }
  const b = S.createArena(stubCanvas(900, 562), { reduced: true });
  b.setGeneration(r, {}); b.setSpeed(1); b.setPlaying(true);
  for (let i = 0; i < 200; i++) { b.update(1 / 60); b.draw(); }
  assert.equal(b.stats().particles, 0);
  b.setReduced(false);
  for (let i = 0; i < 200; i++) b.update(1 / 60);
  assert.ok(b.stats().particles > 0);
});

test('arena: bursts are bounded and expire', () => {
  const a = S.createArena(stubCanvas(900, 562), {});
  a.setGeneration(rec('burst', { th: 0.2 }), {}); a.setSpeed(8); a.setPlaying(true);
  let max = 0;
  for (let i = 0; i < 400; i++) { a.update(1 / 60); a.draw(); max = Math.max(max, a.stats().bursts); }
  assert.ok(max >= 1 && max <= 6);
  a.setPlaying(false);
  for (let i = 0; i < 400; i++) a.update(1 / 60);
  assert.equal(a.stats().bursts, 0);
});

test('arena: resize rebuilds the layout and tolerates tiny canvases; idle arena draws without a generation', () => {
  const c = stubCanvas(100, 100);
  const a = S.createArena(c, {});
  assert.ok(a.state().w >= 160);
  a.update(0.016); a.draw();
  a.clearGeneration();
  assert.equal(a.position(), null);
});

test('chart drawing accepts empty and full histories without throwing', () => {
  const s = Object.assign({}, G.DEFAULTS), c = G.createContest('chart', s);
  while (!G.done(c)) G.stepGeneration(c, s);
  S.drawFitness(stubCanvas(500, 190), [], 12);
  S.drawFitness(stubCanvas(500, 190), c.hist, 12);
  S.drawScience(stubCanvas(500, 340), [], 12, null);
  S.drawScience(stubCanvas(500, 340), c.hist, 12, G.baselineFor(s).row);
});
