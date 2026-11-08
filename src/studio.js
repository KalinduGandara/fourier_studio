// Fourier Circle Studio — the p5.js sketch (instance mode) behind both the interactive
// page (index.html) and the headless renderer (render.html + cli/render.mjs).
//
// Rendering is frame-indexed, never wall-clock: frame f of a run always looks the same,
// so a headless render driven with renderFrame() is reproducible.
//
//   const studio = await FourierStudio.create({ container, playing: true, onEvent });
//   studio.configure({ format: '9:16', duration: 10, buildUp: true, ... });
//   await studio.loadImageUrl(url, { threshold, invert });   // or loadSvgText(text) / setPoints(pts)
//   studio.reset(); studio.renderFrame();                     // headless: one frame per call
(function (root) {
  'use strict';
  const Core = root.FourierCore;

  const DEFAULTS = {
    format: '9:16', fps: 60, duration: 10, hold: 1.5, finalHold: 2.5,
    buildUp: false, circles: Infinity, zoom: 1, color: '#ff3366', rainbow: false,
    title: '', showCount: true, background: 11,
    levels: null,   // custom circle counts per pass, e.g. [2, 5, 10, 20, 1e9]
    guess: '',      // guess mode: prompt shown on every pass until the final drawing is done
    reveal: '',     // guess mode: answer shown on the final hold
  };

  function create({ container, playing = false, onEvent = () => {} } = {}) {
    return new Promise(resolve => {
      new p5(p => { // eslint-disable-line no-new
        const cfg = { ...DEFAULTS };
        let fourier = [], levels = [1], timeline = null;
        let frame = -1, cam = { x: 0, y: 0, z: 1 };
        let trailCache = { cycle: -1, pts: [] };
        let sourceImage = null, cnv = null;

        // ---------- setup / draw ----------

        p.setup = () => {
          p.pixelDensity(1);                 // canvas pixels == video pixels
          cnv = p.createCanvas(...Core.SIZES[cfg.format]);
          if (container) cnv.parent(container);
          p.frameRate(cfg.fps);
          if (!playing) p.noLoop();
          setPoints(Core.heartPoints());
          resolve(api);
        };

        p.draw = () => {
          if (playing && timeline) advance();
          render();
        };

        // ---------- configuration & input ----------

        function configure(opts = {}) {
          const before = JSON.stringify([cfg.format, cfg.fps, cfg.duration, cfg.hold, cfg.finalHold, cfg.buildUp, cfg.circles, cfg.levels]);
          const [w, h] = Core.SIZES[opts.format || cfg.format];
          Object.assign(cfg, opts);
          if (cnv && (w !== p.width || h !== p.height)) p.resizeCanvas(w, h);
          if (opts.fps) p.frameRate(cfg.fps);
          const after = JSON.stringify([cfg.format, cfg.fps, cfg.duration, cfg.hold, cfg.finalHold, cfg.buildUp, cfg.circles, cfg.levels]);
          if (before !== after && fourier.length) rebuild();
          return api;
        }

        function setPoints(points) {
          fourier = Core.fourierSeries(points);
          rebuild();
          return fourier.length;
        }

        function rebuild() {
          levels = Core.buildLevels(fourier.length, cfg.buildUp, cfg.circles, cfg.levels);
          timeline = Core.planTimeline({ fps: cfg.fps, duration: cfg.duration, hold: cfg.hold, finalHold: cfg.finalHold, levels, points: fourier.length });
          reset();
        }

        function reset() {
          frame = -1;
          cam = { x: 0, y: 0, z: 1 };
          trailCache = { cycle: -1, pts: [] };
        }

        // Raster image → traced outline. Resolves to the circle count, or null when nothing was found.
        function loadImageUrl(url, { threshold = 128, invert = false } = {}) {
          return new Promise((res, rej) => p.loadImage(url, img => { sourceImage = img; res(retrace({ threshold, invert })); }, rej));
        }

        function retrace({ threshold = 128, invert = false } = {}) {
          if (!sourceImage) return undefined;   // nothing to retrace (SVG or demo)
          const img = sourceImage.get();
          const sc = Core.TRACE_SIZE / Math.max(img.width, img.height);
          img.resize(Math.max(1, Math.round(img.width * sc)), Math.max(1, Math.round(img.height * sc)));
          img.loadPixels();
          const pts = Core.inkPoints(img.pixels, img.width, img.height, { threshold, invert });
          return pts ? setPoints(pts) : null;
        }

        // Vector input: sample the real curves instead of rasterizing, so the path is smooth.
        function loadSvgText(text) {
          sourceImage = null;   // threshold / invert only apply to bitmaps
          const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
          if (doc.documentElement.nodeName !== 'svg') return null;
          // The SVG must be in the live document for lengths and transforms to work.
          const host = document.createElement('div');
          host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden';
          host.appendChild(document.importNode(doc.documentElement, true));
          document.body.appendChild(host);
          try {
            const shapes = [...host.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon')]
              .filter(el => !el.closest('defs, clipPath, mask, symbol, marker, pattern'))
              .map(el => ({ el, len: el.getTotalLength() }))
              .filter(s => s.len > 0);
            if (!shapes.length) return null;
            // Spread points over shapes in proportion to their length, evenly along each one.
            const total = shapes.reduce((sum, s) => sum + s.len, 0);
            const pieces = shapes.map(({ el, len }) => {
              const n = Math.max(2, Math.round(Core.MAX_POINTS * len / total));
              const ctm = el.getCTM();
              return Array.from({ length: n }, (_, j) => {
                const pt = el.getPointAtLength(len * j / (n - 1)).matrixTransform(ctm);
                return [pt.x, pt.y];
              });
            });
            return setPoints(Core.evenlySample(Core.orderPieces(pieces).flat(), Core.MAX_POINTS));
          } finally {
            host.remove();
          }
        }

        // ---------- frame stepping ----------

        function advance() {
          frame++;
          if (frame >= timeline.totalFrames) { frame = 0; onEvent('loop', {}); }
          const info = Core.frameInfo(timeline, frame);
          const S = Math.min(p.width, p.height) * 0.42;
          const tip = Core.tip(fourier, info.t, info.cycle.count, S);
          // Camera: follow the pen while drawing, ease back out to reveal the result.
          // Per-frame easing is normalized to 60 fps so motion looks the same at any fps.
          const follow = info.phase === 'draw' && cfg.zoom > 1;
          const ease = k => 1 - (1 - k) ** (60 / cfg.fps);
          const posK = ease(follow ? 0.5 : 0.08), zK = ease(0.08);
          cam.x += ((follow ? tip.x : 0) - cam.x) * posK;
          cam.y += ((follow ? tip.y : 0) - cam.y) * posK;
          cam.z += ((follow ? cfg.zoom : 1) - cam.z) * zK;
          if (frame === info.cycle.end - 1) onEvent('cycleend', { cycle: info.cycle.index, last: info.cycle.last });
        }

        // Headless: advance one frame and draw it synchronously.
        function renderFrame() {
          advance();
          p.redraw();
          return frame;
        }

        function render() {
          p.background(cfg.background);
          if (!timeline || frame < 0) return;
          const info = Core.frameInfo(timeline, frame);
          const count = info.cycle.count;
          const S = Math.min(p.width, p.height) * 0.42;
          if (trailCache.cycle !== info.cycle.index || trailCache.S !== S) {
            trailCache = { cycle: info.cycle.index, S, pts: Core.cycleTrail(fourier, timeline, count, S) };
          }
          const joints = Core.chain(fourier, info.t, count, S);

          p.push();
          p.translate(p.width / 2, p.height / 2);
          p.scale(cam.z);
          p.translate(-cam.x, -cam.y);
          drawTrail(trailCache.pts, info.trailLength, cam.z);
          const circleAlpha = info.phase === 'draw' ? 1 : Math.max(0, 1 - info.holdFrame / (cfg.fps / 3));
          if (circleAlpha > 0) drawEpicycles(joints, circleAlpha, cam.z);
          p.pop();

          drawOverlay(info);
        }

        function drawEpicycles(pts, alpha, z) {
          p.noFill();
          for (let i = 1; i < pts.length; i++) {
            const { r } = pts[i];
            if (r * z < 0.5) continue;
            p.strokeWeight(1.5 / z);
            p.stroke(255, 55 * alpha);
            p.circle(pts[i - 1].x, pts[i - 1].y, r * 2);
            p.stroke(255, 150 * alpha);
            p.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
          }
          const tip = pts[pts.length - 1];
          p.noStroke();
          p.fill(255, 255 * alpha);
          p.circle(tip.x, tip.y, 10 / z);
        }

        function drawTrail(all, n, z) {
          if (n < 2) return;
          const chunk = Math.max(2, Math.ceil(n / 150));   // color changes per chunk, not per segment
          p.noFill();
          p.strokeJoin(p.ROUND);
          p.strokeCap(p.ROUND);
          // Pass 0: wide translucent glow. Pass 1: crisp core line.
          for (const [w, a] of [[16, 45], [4, 255]]) {
            p.strokeWeight(w / z);
            for (let s = 0; s < n - 1; s += chunk) {
              const c = p.color(cfg.rainbow ? `hsl(${Math.round(s / n * 360)}, 100%, 60%)` : cfg.color);
              c.setAlpha(a);
              p.stroke(c);
              p.beginShape();
              for (let i = s; i <= Math.min(s + chunk, n - 1); i++) p.vertex(all[i].x, all[i].y);
              p.endShape();
            }
          }
        }

        function drawOverlay(info) {
          const count = info.cycle.count;
          const size = Math.min(p.width, p.height) * 0.06;
          const revealing = Boolean(cfg.reveal) && info.cycle.last && info.phase === 'hold';
          const title = revealing ? '' : String(cfg.guess || cfg.title || '').trim();
          const layout = Core.overlayLayout(p.width, p.height);
          p.noStroke();
          p.fill(255);
          p.textStyle(p.BOLD);
          p.drawingContext.shadowColor = 'rgba(0,0,0,0.85)';
          p.drawingContext.shadowBlur = 14;
          if (title) {
            p.textSize(size);
            p.textAlign(p.CENTER, p.TOP);
            p.text(title, p.width * 0.06, p.height * layout.titleTop, p.width * 0.88);
          }
          if (revealing) {
            // answer pops in over a quarter second (frame-based, fps-normalized)
            const k = Math.min(1, info.holdFrame / (cfg.fps * 0.25));
            const pop = 0.6 + 0.4 * (1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2);   // ease-out-back
            p.fill('#ffd43b');
            p.textSize(size * 1.5 * pop);
            p.textAlign(p.CENTER, p.TOP);
            p.text(String(cfg.reveal), p.width * 0.04, p.height * layout.titleTop, p.width * 0.92);
            p.fill(255);
          }
          if (cfg.showCount) {
            const guessing = cfg.guess && !info.cycle.last && info.phase === 'hold';
            p.textSize(size * 0.9);
            p.textAlign(p.CENTER, p.BOTTOM);
            p.text(`${count} circle${count === 1 ? '' : 's'}${guessing ? ' · guess?' : ''}`, p.width / 2, p.height * layout.countBottom);
          }
          p.drawingContext.shadowBlur = 0;
        }

        // ---------- public API ----------

        const api = {
          configure, setPoints, loadImageUrl, loadSvgText, retrace, reset, renderFrame,
          get canvas() { return cnv.elt; },
          get config() { return { ...cfg }; },
          get frame() { return frame; },
          get circles() { return fourier.length; },
          totalFrames: () => timeline.totalFrames,
          // Everything the Node side needs to synthesize the soundtrack.
          info: () => ({ fourier, levels, timeline, width: p.width, height: p.height, fps: cfg.fps }),
          play() { playing = true; p.loop(); },
          pause() { playing = false; p.noLoop(); },
        };
      });
    });
  }

  root.FourierStudio = { create, DEFAULTS };
})(typeof self !== 'undefined' ? self : this);
