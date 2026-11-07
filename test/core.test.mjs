import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Core = createRequire(import.meta.url)('../src/core.js');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('normalize centers the path and fits the larger side into [-1, 1]', () => {
  const pts = Core.normalize([[10, 10], [30, 10], [30, 20], [10, 20]]);
  assert.deepEqual(pts.map(p => [p.re, p.im]), [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]]);
});

test('normalize handles a single point without dividing by zero', () => {
  assert.deepEqual(Core.normalize([[5, 5]]), [{ re: 0, im: 0 }]);
});

test('dft of a unit circle is one circle at frequency 1', () => {
  const N = 64;
  const x = Array.from({ length: N }, (_, n) => ({ re: Math.cos(2 * Math.PI * n / N), im: Math.sin(2 * Math.PI * n / N) }));
  const out = Core.dft(x);
  close(out[1].amp, 1);
  assert.equal(out[1].freq, 1);
  for (const [k, c] of out.entries()) if (k !== 1) close(c.amp, 0);
});

test('dft uses signed frequencies above N/2', () => {
  const freqs = Core.dft(Array.from({ length: 6 }, () => ({ re: 0, im: 0 }))).map(c => c.freq);
  assert.deepEqual(freqs, [0, 1, 2, 3, -2, -1]);
});

test('full series reconstructs the input path exactly', () => {
  const pts = Core.heartPoints();
  const norm = Core.normalize(pts);
  const series = Core.fourierSeries(pts);
  for (const n of [0, 37, 250]) {
    const p = Core.tip(series, 2 * Math.PI * n / pts.length, series.length);
    close(p.x, norm[n].re, 1e-9);
    close(p.y, norm[n].im, 1e-9);
  }
  assert.ok(series.every((c, i) => i === 0 || series[i - 1].amp >= c.amp), 'sorted by amplitude');
});

test('chain ends at tip and starts at the origin', () => {
  const series = Core.fourierSeries(Core.heartPoints());
  const joints = Core.chain(series, 1.234, 50, 300);
  const tip = Core.tip(series, 1.234, 50, 300);
  assert.equal(joints.length, 51);
  assert.deepEqual(joints[0], { x: 0, y: 0, r: 0 });
  close(joints[50].x, tip.x, 1e-6);
  close(joints[50].y, tip.y, 1e-6);
});

test('evenlySample keeps short arrays and caps long ones', () => {
  assert.deepEqual(Core.evenlySample([1, 2, 3], 5), [1, 2, 3]);
  assert.deepEqual(Core.evenlySample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5), [0, 2, 4, 6, 8]);
});

test('nearestNeighborOrder walks neighbours and keeps every point', () => {
  const pts = [[5, 0], [1, 0], [3, 0], [2, 0], [4, 0], [0, 0]];   // starts from the last point
  const out = Core.nearestNeighborOrder(pts);
  assert.equal(out.length, pts.length);
  for (let i = 1; i < out.length; i++) assert.equal(Math.abs(out[i][0] - out[i - 1][0]), 1);
});

test('orderPieces chains pieces end-to-start, reversing when closer', () => {
  const a = [[0, 0], [1, 0]], b = [[10, 0], [11, 0]], c = [[5, 0], [2, 0]];
  const out = Core.orderPieces([a, b, c]);
  assert.deepEqual(out, [[[0, 0], [1, 0]], [[2, 0], [5, 0]], [[10, 0], [11, 0]]]);
  assert.deepEqual(c, [[5, 0], [2, 0]], 'input not mutated');
});

test('inkPoints finds the outline of a dark square and honours invert', () => {
  const w = 20, h = 20, px = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) px.fill(0, (x + y * w) * 4, (x + y * w) * 4 + 3);
  const pts = Core.inkPoints(px, w, h, { threshold: 128 });
  assert.equal(pts.length, 36);   // perimeter of a 10x10 square
  assert.ok(pts.every(([x, y]) => x === 5 || x === 14 || y === 5 || y === 14));
  assert.equal(Core.inkPoints(new Uint8ClampedArray(w * h * 4).fill(255), w, h), null);
  // inverted: the image border (76) plus the ring hugging the square, minus its 4 diagonal corners (40)
  assert.equal(Core.inkPoints(px, w, h, { invert: true }).length, 76 + 40);
});

test('buildLevels: single level or the build-up ladder', () => {
  assert.deepEqual(Core.buildLevels(400, false), [400]);
  assert.deepEqual(Core.buildLevels(400, false, 30), [30]);
  assert.deepEqual(Core.buildLevels(400, false, Infinity), [400]);
  assert.deepEqual(Core.buildLevels(400, true), [2, 10, 50, 200, 400]);
  assert.deepEqual(Core.buildLevels(40, true), [2, 10, 40]);
});

test('planTimeline frames add up and frameInfo covers every phase', () => {
  const tl = Core.planTimeline({ fps: 60, duration: 2, hold: 1, finalHold: 2, levels: [2, 10, 50], points: 1000 });
  assert.equal(tl.drawFrames, 120);
  assert.equal(tl.steps, 8);
  assert.equal(tl.totalFrames, 3 * 120 + 60 + 60 + 120);
  assert.deepEqual(tl.cycles.map(c => [c.start, c.drawEnd, c.end, c.last]), [[0, 120, 180, false], [180, 300, 360, false], [360, 480, 600, true]]);

  const first = Core.frameInfo(tl, 0);
  assert.equal(first.phase, 'draw');
  assert.equal(first.trailLength, 9);
  const lastDraw = Core.frameInfo(tl, 119);
  close(lastDraw.t, 2 * Math.PI);
  assert.equal(lastDraw.trailLength, 120 * 8 + 1);
  assert.deepEqual([Core.frameInfo(tl, 120).phase, Core.frameInfo(tl, 120).holdFrame], ['hold', 1]);
  assert.equal(Core.frameInfo(tl, 180).cycle.count, 10);
  assert.equal(Core.frameInfo(tl, 599).cycle.last, true);
});

test('cycleTrail spans one full loop', () => {
  const series = Core.fourierSeries(Core.heartPoints());
  const tl = Core.planTimeline({ fps: 30, duration: 1, levels: [series.length], points: series.length });
  const trail = Core.cycleTrail(series, tl, series.length, 1);
  assert.equal(trail.length, 30 * tl.steps + 1);
  close(trail[0].x, trail[trail.length - 1].x, 1e-9);
  close(trail[0].y, trail[trail.length - 1].y, 1e-9);
});
