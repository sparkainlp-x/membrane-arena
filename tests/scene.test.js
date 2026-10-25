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

/* ---------- v0.2 scene features ---------- */

function loggingCanvas(w, h) {
  const sets = [], calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'sets') return sets; if (k === 'calls') return calls;
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      return typeof t[k] === 'undefined' ? (...a) => { calls.push(k); } : t[k];
    },
    set(t, k, v) { t[k] = v; sets.push([k, v]); return true; }
  });
  return { width: 0, height: 0, getContext: () => ctx, getBoundingClientRect: () => ({ width: w, height: h }), ctx };
}

test('crystal: six-fold symmetric, deterministic in the seed, inside the radius, ordered by birth', () => {
  const a = S.crystalSegments(5, 100), b = S.crystalSegments(5, 100), c = S.crystalSegments(6, 100);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  assert.equal(a.length % 6, 0);
  a.forEach((g) => { assert.ok(Math.hypot(g.x1, g.y1) <= 100 + 1e-6); assert.ok(g.b0 >= 0 && g.b1 <= 1 + 1e-9); assert.ok(g.w > 0); });
  for (let i = 1; i < a.length; i++) assert.ok(a[i].b0 >= a[i - 1].b0 - 1e-12);
  const reach = (s) => Math.max(...s.map((g) => Math.max(Math.hypot(g.x0, g.y0), Math.hypot(g.x1, g.y1))));
  assert.ok(Math.abs(reach(a) - 100) < 1e-6, 'the stem reaches the radius');
  // the set of segment lengths is the same in every 60 degree sector
  const lens = a.map((g) => Math.round(Math.hypot(g.x1 - g.x0, g.y1 - g.y0) * 1000)).sort((x, y) => x - y);
  for (let k = 0; k < lens.length; k += 6) assert.ok(lens.slice(k, k + 6).every((v) => Math.abs(v - lens[k]) <= 2));
});

test('crystal growth: segments appear from the centre outward and never shrink as p rises', () => {
  const segs = S.crystalSegments(11, 80);
  let prevCount = 0, prevLen = 0;
  for (let p = 0; p <= 1.0001; p += 0.1) {
    let count = 0, len = 0;
    segs.forEach((g) => { const s = S.segmentAt(g, p); if (s) { count++; len += Math.hypot(s.x1 - s.x0, s.y1 - s.y0); } });
    assert.ok(count >= prevCount && len >= prevLen - 1e-9);
    prevCount = count; prevLen = len;
  }
  assert.equal(S.segmentAt(segs[0], 0), null);
  const full = S.segmentAt(segs[segs.length - 1], 1);
  assert.ok(Math.abs(full.x1 - segs[segs.length - 1].x1) < 1e-9);
});

test('compass angle: 0 when aligned, pi/2 when orthogonal, null in a noise episode, monotone', () => {
  assert.equal(S.dialAngle(1), 0);
  assert.ok(Math.abs(S.dialAngle(0) - Math.PI / 2) < 1e-12);
  assert.equal(S.dialAngle(-1), null);
  assert.equal(S.dialAngle(NaN), null);
  assert.ok(S.dialAngle(0.9) < S.dialAngle(0.5));
  assert.equal(S.dialAngle(1.0000001), 0);
});

test('replay position: index and (generation, episode, step) round-trip and cover the whole contest', () => {
  assert.equal(S.TOTAL_STEPS, 5760);
  for (const idx of [0, 1, 59, 60, 479, 480, 481, 2500, 5759, 5760]) {
    const p = S.indexToPos(idx);
    assert.ok(p.gen >= 0 && p.gen <= 11 && p.ep >= 0 && p.ep <= 7 && p.step >= 0 && p.step <= 60);
    if (idx < 5760) assert.equal(S.posToIndex(p), idx);
  }
  assert.deepEqual(S.indexToPos(5760), { gen: 11, ep: 7, step: 60 });
  assert.deepEqual(S.indexToPos(-4), { gen: 0, ep: 0, step: 0 });
  assert.deepEqual(S.indexToPos(61), { gen: 0, ep: 1, step: 1 });
  assert.deepEqual(S.indexToPos(481), { gen: 1, ep: 0, step: 1 });
});

test('snapshot: numbers come from the record, truth only after the declaration, no alignment in noise', () => {
  const r = rec('snap', { shield: true });
  r.episodes.forEach((ep, e) => {
    const end = S.snapshotAt(r, e, 60);
    assert.equal(end.planted, ep.planted);
    for (let i = 0; i < 3; i++) {
      assert.equal(end.declared[i], ep.declStep[i] !== null);
      assert.equal(end.truth[i], ep.declStep[i] !== null ? ep.truth[i] : null);
      if (!ep.planted) assert.equal(end.align[i], null);
      if (ep.declStep[i] !== null && ep.declStep[i] > 1) {
        const before = S.snapshotAt(r, e, ep.declStep[i] - 1);
        assert.equal(before.declared[i], false); assert.equal(before.truth[i], null);
      }
    }
    const start = S.snapshotAt(r, e, 0);
    assert.deepEqual(start.energy, [0, 0, 0]); assert.deepEqual(start.align, [null, null, null]);
  });
});

test('arena replay: showAt freezes the clock at the exact episode and step, spawns nothing, and every position draws', () => {
  const r = rec('replay', { shield: true });
  const a = S.createArena(stubCanvas(900, 562), {});
  a.showAt(r, 3, 25, {});
  const pos = a.position();
  assert.equal(pos.ep, 3); assert.ok(Math.abs(pos.step - 25) < 1e-6);
  for (let i = 0; i < 100; i++) { a.update(1 / 60); a.draw(); }
  assert.equal(a.stats().particles, 0);
  assert.equal(a.position().ep, 3); assert.ok(Math.abs(a.position().step - 25) < 1e-6, 'does not advance');
  assert.equal(a.snapshot().step, 25); assert.equal(a.snapshot().ep, 4);
  for (let ep = 0; ep < 8; ep++) for (const step of [0, 1, 10, 33, 60]) { a.showAt(r, ep, step, {}); a.update(0.016); a.draw(); }
  a.leaveScrub(); assert.equal(a.state().scrub, null);
});

test('arena replay draws grown crystals and cracks for declared membranes and nothing before the declaration', () => {
  const r = rec('replay2', { shield: true });
  let e = r.episodes.findIndex((ep) => ep.declStep.some((d) => d !== null));
  assert.ok(e >= 0);
  const ep = r.episodes[e], first = Math.min(...ep.declStep.filter((d) => d !== null));
  const count = (step) => { const cv = loggingCanvas(900, 562), a = S.createArena(cv, {}); a.showAt(r, e, step, {}); for (let i = 0; i < 20; i++) a.update(0.016); cv.ctx.calls.length = 0; a.draw(); return cv.ctx.calls.length; };
  assert.ok(count(Math.min(60, first + 20)) > count(Math.max(0, first - 1)), 'a declared membrane adds drawing');
});

test('arena intro: plays for its duration, can be skipped, calls back once, and is off in reduced motion', () => {
  const a = S.createArena(stubCanvas(900, 562), {});
  let done = 0;
  assert.equal(a.playIntro({ title: 'T', sub: 'S', done: () => { done++; } }), true);
  assert.equal(a.stats().intro, true);
  let guard = 0;
  while (a.stats().intro && guard++ < 1000) { a.update(1 / 30); a.draw(); }
  assert.equal(done, 1); assert.ok(guard * (1 / 30) >= S.INTRO_DUR - 0.1);
  a.playIntro({ title: 'T', sub: 'S', done: () => { done++; } }); a.skipIntro(); a.skipIntro();
  assert.equal(done, 2); assert.equal(a.stats().intro, false);
  const b = S.createArena(stubCanvas(600, 400), { reduced: true });
  assert.equal(b.playIntro({ title: 'T', sub: 'S' }), false);
  assert.equal(b.stats().intro, false);
});

test('high contrast: no additive glow, black background, still draws a full generation', () => {
  const r = rec('hc', { shield: true });
  const cv = loggingCanvas(900, 562), a = S.createArena(cv, { contrast: true });
  a.setGeneration(r, {}); a.setSpeed(16); a.setPlaying(true);
  let guard = 0;
  while (!a.genDone() && guard++ < 3000) { a.update(1 / 30); a.draw(); }
  assert.ok(a.genDone());
  assert.ok(!cv.ctx.sets.some(([k, v]) => k === 'globalCompositeOperation' && v === 'lighter'), 'no additive blending');
  assert.ok(cv.ctx.sets.some(([k, v]) => k === 'fillStyle' && v === '#000'));
  const cv2 = loggingCanvas(900, 562), b = S.createArena(cv2, {});
  b.setGeneration(r, {}); b.setSpeed(16); b.setPlaying(true);
  for (let i = 0; i < 200; i++) { b.update(1 / 30); b.draw(); }
  assert.ok(cv2.ctx.sets.some(([k, v]) => k === 'globalCompositeOperation' && v === 'lighter'));
  b.setContrast(true); b.draw();
});

test('shield gate follows a pass (open) and a hold (shut) and returns to rest', () => {
  const r = rec('gate', { shield: true });
  const a = S.createArena(stubCanvas(900, 562), {});
  a.setGeneration(r, { shield: true }); a.setSpeed(4); a.setPlaying(true);
  let sawOpen = false, guard = 0;
  while (!a.genDone() && guard++ < 4000) { a.update(1 / 30); a.draw(); if (a.state().gate > 0.3) sawOpen = true; }
  assert.ok(sawOpen, 'the gate opened for a released output');
  a.setPlaying(false);
  for (let i = 0; i < 300; i++) { a.update(1 / 30); a.draw(); }
  assert.ok(Math.abs(a.state().gate) < 0.05);
});

test('draw cost stays small in the stub canvas (no per-frame allocation blow-up): 300 frames of a busy generation', () => {
  const a = S.createArena(stubCanvas(1180, 738), {});
  a.setGeneration(rec('busy', { c: 0.4, th: 0.2 }), { shield: true }); a.setSpeed(8); a.setPlaying(true);
  const t0 = Date.now();
  for (let i = 0; i < 300; i++) { a.update(1 / 60); a.draw(); }
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  assert.ok(a.stats().particles <= 360);
});
