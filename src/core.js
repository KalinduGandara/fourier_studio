// Fourier Circle Studio — pure logic shared by the browser page and the Node CLI.
// No DOM, no p5, no randomness: everything here is deterministic and unit-tested.
// Loaded as a classic <script> (exposes window.FourierCore) or require()d from Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FourierCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TWO_PI = Math.PI * 2;
  const SIZES = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] };
  const MAX_EDGE_POINTS = 5000;   // cap before ordering (greedy ordering is O(n²))
  const MAX_POINTS = 1000;        // cap before the DFT (O(n²))
  const BUILD_UP_LEVELS = [2, 10, 50, 200];
  const TRACE_SIZE = 400;         // raster images are traced at this size (longest side)

  function evenlySample(arr, max) {
    if (arr.length <= max) return arr;
    const step = arr.length / max;
    return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
  }

  // Greedy nearest-neighbor tour so the pen travels between nearby points.
  function nearestNeighborOrder(pts) {
    const rest = pts.slice();
    const out = [rest.pop()];
    while (rest.length) {
      const [cx, cy] = out[out.length - 1];
      let best = 0, bestD = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const dx = rest[i][0] - cx, dy = rest[i][1] - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; if (d <= 1) break; }   // adjacent pixel: can't do better
      }
      out.push(rest[best]);
      rest[best] = rest[rest.length - 1];
      rest.pop();
    }
    return out;
  }

  // Chain polylines so each starts near where the previous one ended (reversing when that's closer).
  function orderPieces(pieces) {
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const rest = pieces.map(p => p.slice());
    const out = [rest.shift()];
    while (rest.length) {
      const last = out[out.length - 1];
      const end = last[last.length - 1];
      let best = 0, bestD = Infinity, reverse = false;
      rest.forEach((p, i) => {
        const ds = d2(end, p[0]), de = d2(end, p[p.length - 1]);
        if (ds < bestD) { bestD = ds; best = i; reverse = false; }
        if (de < bestD) { bestD = de; best = i; reverse = true; }
      });
      const [next] = rest.splice(best, 1);
      out.push(reverse ? next.reverse() : next);
    }
    return out;
  }

  // Outline pixels of the "ink" regions of an RGBA buffer, ordered into one continuous path.
  function inkPoints(pixels, w, h, { threshold = 128, invert = false } = {}) {
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      if (pixels[j + 3] < 128) continue;   // transparent = background
      const lum = 0.299 * pixels[j] + 0.587 * pixels[j + 1] + 0.114 * pixels[j + 2];
      ink[i] = (invert ? lum > threshold : lum < threshold) ? 1 : 0;
    }
    let edges = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = x + y * w;
        if (!ink[i]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
            !ink[i - 1] || !ink[i + 1] || !ink[i - w] || !ink[i + w]) edges.push([x, y]);
      }
    }
    if (!edges.length) return null;
    edges = evenlySample(edges, MAX_EDGE_POINTS);
    return evenlySample(nearestNeighborOrder(edges), MAX_POINTS);
  }

  // Center the path and scale it so its larger side spans [-1, 1].
  function normalize(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
    return points.map(([x, y]) => ({ re: (x - cx) / half, im: (y - cy) / half }));
  }

  function dft(x) {
    const N = x.length, out = [];
    for (let k = 0; k < N; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const p = (TWO_PI * k * n) / N, c = Math.cos(p), s = Math.sin(p);
        re += x[n].re * c + x[n].im * s;
        im += x[n].im * c - x[n].re * s;
      }
      re /= N;
      im /= N;
      // Signed frequency: bins above N/2 are negative frequencies. Without this,
      // a truncated series (fewer circles) doesn't approximate the shape.
      out.push({ freq: k <= N / 2 ? k : k - N, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
    }
    return out;
  }

  // Epicycles for a path of [x, y] points, largest circle first.
  function fourierSeries(points) {
    return dft(normalize(points)).sort((a, b) => b.amp - a.amp);
  }

  // Joint positions of the first `count` epicycles at time t, scaled by S.
  function chain(fourier, t, count, S = 1) {
    let x = 0, y = 0;
    const pts = [{ x, y, r: 0 }];
    for (let i = 0; i < count; i++) {
      const f = fourier[i];
      const r = f.amp * S;
      const a = f.freq * t + f.phase;
      x += r * Math.cos(a);
      y += r * Math.sin(a);
      pts.push({ x, y, r });
    }
    return pts;
  }

  // Pen tip only (no allocation per joint).
  function tip(fourier, t, count, S = 1) {
    let x = 0, y = 0;
    for (let i = 0; i < count; i++) {
      const f = fourier[i], a = f.freq * t + f.phase;
      x += f.amp * Math.cos(a);
      y += f.amp * Math.sin(a);
    }
    return { x: x * S, y: y * S };
  }

  // Circle counts per drawing cycle.
  function buildLevels(total, buildUp, circles = total) {
    if (!buildUp) return [Math.max(1, Math.min(total, Math.round(circles)))];
    return BUILD_UP_LEVELS.filter(n => n < total).concat(total);
  }

  // Frame plan for one full run. Every cycle draws for `duration` seconds, then holds the
  // finished drawing for `hold` seconds (`finalHold` for the last cycle).
  function planTimeline({ fps = 60, duration = 10, hold = 1.5, finalHold = 2.5, levels, points }) {
    const drawFrames = Math.max(1, Math.round(duration * fps));
    // Sub-step so the trail stays smooth when there are more points than frames.
    const steps = Math.min(8, Math.max(1, Math.ceil(points / drawFrames)));
    const cycles = [];
    let start = 0;
    levels.forEach((count, i) => {
      const last = i === levels.length - 1;
      const holdFrames = Math.max(1, Math.round((last ? finalHold : hold) * fps));
      cycles.push({ index: i, count, start, drawEnd: start + drawFrames, end: start + drawFrames + holdFrames, last });
      start += drawFrames + holdFrames;
    });
    return { fps, drawFrames, steps, cycles, totalFrames: start };
  }

  // State of frame f (0-based). During drawing, `trailLength` points of the cycle trail are visible.
  function frameInfo(timeline, f) {
    const { cycles, drawFrames, steps } = timeline;
    const cycle = cycles.find(c => f < c.end) || cycles[cycles.length - 1];
    const local = f - cycle.start;
    if (local < drawFrames) {
      const k = (local + 1) * steps;
      return { cycle, phase: 'draw', local, t: TWO_PI * (local + 1) / drawFrames, trailLength: k + 1, holdFrame: 0 };
    }
    return { cycle, phase: 'hold', local, t: TWO_PI, trailLength: drawFrames * steps + 1, holdFrame: local - drawFrames + 1 };
  }

  // Every trail point of one cycle (drawFrames * steps + 1 of them), scaled by S.
  function cycleTrail(fourier, timeline, count, S = 1) {
    const n = timeline.drawFrames * timeline.steps;
    return Array.from({ length: n + 1 }, (_, k) => tip(fourier, TWO_PI * k / n, count, S));
  }

  function heartPoints() {
    return Array.from({ length: 400 }, (_, i) => {
      const a = (i / 400) * TWO_PI;
      return [16 * Math.sin(a) ** 3, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))];
    });
  }

  return {
    TWO_PI, SIZES, MAX_EDGE_POINTS, MAX_POINTS, BUILD_UP_LEVELS, TRACE_SIZE,
    evenlySample, nearestNeighborOrder, orderPieces, inkPoints, normalize, dft, fourierSeries,
    chain, tip, buildLevels, planTimeline, frameInfo, cycleTrail, heartPoints,
  };
});
