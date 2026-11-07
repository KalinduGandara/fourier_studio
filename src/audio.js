// Fourier Circle Studio — deterministic procedural soundtrack, rendered offline.
// Pure JS (no WebAudio), so Node and the browser produce identical samples.
// Requires FourierCore (core.js). Exposes window.FourierAudio or module.exports.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.FourierAudio = factory(root.FourierCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const SAMPLE_RATE = 48000;
  const D3 = 146.832;                 // key of D major
  const PENTA = [0, 2, 4, 7, 9];      // major pentatonic, semitones
  // Pad voicings (semitones from D3): Dmaj7, Bm7, Gmaj7, Asus — the last cycle always resolves to D.
  const CHORDS = [[-12, 4, 7, 11], [-15, 0, 4, 7], [-7, -3, 0, 4], [-5, 2, 7, 11]];
  const BELL = [[1, 1, 1], [2, 0.45, 0.6], [2.76, 0.3, 0.45], [5.4, 0.15, 0.25], [8.93, 0.06, 0.15]];
  const PLUCK = [[1, 1, 1], [2, 0.3, 0.5], [3, 0.1, 0.3]];
  const PAD = [[1, 1, 1], [2, 0.2, 1], [3, 0.06, 1]];

  const semi = (base, s) => base * 2 ** (s / 12);
  const penta = (base, degree) => semi(base, PENTA[((degree % 5) + 5) % 5] + 12 * Math.floor(degree / 5));

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Add one note. With `decay` the envelope is percussive (exp decay); otherwise it is
  // sustained with linear attack/release inside `dur`.
  function addTone(L, R, sr, { start, dur, freq, amp, attack = 0.005, decay = 0, release = 0.05, pan = 0, partials = [[1, 1, 1]] }) {
    const s0 = Math.max(0, Math.round(start * sr));
    const s1 = Math.min(L.length, Math.round((start + dur) * sr));
    const gl = amp * Math.cos((pan + 1) * Math.PI / 4), gr = amp * Math.sin((pan + 1) * Math.PI / 4);
    const offset = start * sr;
    for (const [mult, pAmp, pDecay] of partials) {
      const w = 2 * Math.PI * freq * mult / sr;
      if (freq * mult >= sr / 2) continue;
      for (let i = s0; i < s1; i++) {
        const t = (i - offset) / sr;
        let env = t < attack ? t / attack : 1;
        if (decay) env *= Math.exp(-t / (decay * pDecay));
        else if (dur - t < release) env *= Math.max(0, (dur - t) / release);
        const v = pAmp * env * Math.sin(w * (i - offset));
        L[i] += v * gl;
        R[i] += v * gr;
      }
    }
  }

  // Per-frame pen speed (0..1) and position for the drawing phases of a timeline.
  function penMotion(fourier, timeline) {
    const n = timeline.totalFrames;
    const speed = new Float32Array(n), x = new Float32Array(n), y = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      const info = Core.frameInfo(timeline, f);
      const count = info.cycle.count;
      const p = Core.tip(fourier, info.t, count);
      x[f] = p.x; y[f] = p.y;
      if (info.phase === 'draw') {
        const q = Core.tip(fourier, Core.TWO_PI * info.local / timeline.drawFrames, count);
        speed[f] = Math.hypot(p.x - q.x, p.y - q.y);
      }
    }
    const sorted = Array.from(speed).filter(v => v > 0).sort((a, b) => a - b);
    const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] || 1 : 1;
    for (let f = 0; f < n; f++) speed[f] = Math.min(1, speed[f] / ref);
    return { speed, x, y };
  }

  // Render the soundtrack for one full run of `timeline`. Returns { left, right, sampleRate }.
  function synthesize({ fourier, timeline, sampleRate = SAMPLE_RATE, seed = 1 }) {
    const sr = sampleRate, fps = timeline.fps;
    const seconds = timeline.totalFrames / fps;
    const len = Math.round(seconds * sr);
    const L = new Float32Array(len), R = new Float32Array(len);
    const motion = penMotion(fourier, timeline);
    const cycles = timeline.cycles;

    // 1. Soft pad: one chord per drawing cycle, cross-fading into the next.
    cycles.forEach((c, i) => {
      const chord = c.last ? CHORDS[0] : CHORDS[i % CHORDS.length];
      const start = Math.max(0, c.start / fps - 0.4);
      const dur = c.last ? seconds - start : (c.end - c.start) / fps + 1.2;
      chord.forEach((s, v) => addTone(L, R, sr, {
        start, dur, freq: semi(D3, s), amp: 0.045, attack: 1.0, release: 1.4,
        pan: (v / (chord.length - 1)) * 0.8 - 0.4, partials: PAD,
      }));
    });

    // 2. Plucked pentatonic arpeggio while drawing: pitch follows pen height, loudness its speed.
    const every = Math.max(1, Math.round(fps / 4));
    let prevDegree = null;
    for (let f = 0; f < timeline.totalFrames; f++) {
      const info = Core.frameInfo(timeline, f);
      if (info.phase !== 'draw' || info.local % every) continue;
      let degree = Math.round((1 - (motion.y[f] + 1) / 2) * 9);
      if (degree === prevDegree) degree += (f / every) % 2 ? 2 : -2;   // keep the melody moving
      prevDegree = degree;
      addTone(L, R, sr, {
        start: f / fps, dur: 1.6, freq: penta(semi(D3, 12), degree), amp: 0.07 * (0.3 + 0.7 * motion.speed[f]),
        attack: 0.004, decay: 0.45, pan: Math.max(-0.7, Math.min(0.7, motion.x[f] * 0.7)), partials: PLUCK,
      });
    }

    // 3. Pencil hiss: band-passed noise following pen speed.
    const rand = mulberry32(seed);
    const kHi = 1 - Math.exp(-2 * Math.PI * 5000 / sr), kLo = 1 - Math.exp(-2 * Math.PI * 900 / sr);
    const kEnv = 1 - Math.exp(-1 / (0.03 * sr));
    let lpHi = 0, lpLo = 0, env = 0;
    for (let i = 0; i < len; i++) {
      const f = Math.min(timeline.totalFrames - 1, Math.floor(i / sr * fps));
      env += kEnv * (motion.speed[f] - env);
      const w = rand() * 2 - 1;
      lpHi += kHi * (w - lpHi);
      lpLo += kLo * (lpHi - lpLo);
      const v = (lpHi - lpLo) * env * 0.05;
      L[i] += v; R[i] += v;
    }

    // 4. Chimes: a bell when each drawing completes (a chord on the last one), a softer one on level changes.
    cycles.forEach((c, i) => {
      const t = c.drawEnd / fps;
      const notes = c.last ? [0, 4, 7, 12] : [PENTA[i % 5]];
      notes.forEach((s, j) => addTone(L, R, sr, {
        start: t + j * 0.09, dur: 4, freq: semi(D3, 24 + s), amp: c.last ? 0.11 : 0.12,
        attack: 0.002, decay: 1.4, pan: notes.length > 1 ? j / (notes.length - 1) * 0.6 - 0.3 : 0, partials: BELL,
      }));
      if (i > 0) addTone(L, R, sr, { start: c.start / fps, dur: 3, freq: semi(D3, 12), amp: 0.06, attack: 0.01, decay: 1.0, partials: BELL });
    });

    // 5. Ping-pong echo for space.
    const d = Math.round(0.3 * sr);
    for (let i = d; i < len; i++) {
      L[i] += 0.28 * R[i - d];
      R[i] += 0.28 * L[i - d];
    }

    // 6. Master: short fade-in, fade-out, peak-normalize to -2 dBFS.
    const fadeIn = Math.round(0.02 * sr), fadeOut = Math.min(len, Math.round(0.6 * sr));
    let peak = 0;
    for (let i = 0; i < len; i++) {
      let g = 1;
      if (i < fadeIn) g = i / fadeIn;
      if (i > len - fadeOut) g *= (len - i) / fadeOut;
      L[i] *= g; R[i] *= g;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    if (peak > 0) {
      const k = 0.794 / peak;
      for (let i = 0; i < len; i++) { L[i] *= k; R[i] *= k; }
    }
    return { left: L, right: R, sampleRate: sr };
  }

  // 16-bit PCM stereo WAV.
  function encodeWav({ left, right, sampleRate }) {
    const n = left.length, bytes = 44 + n * 4;
    const buf = new ArrayBuffer(bytes), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 4, true);
    const q = x => Math.round(Math.max(-1, Math.min(1, x)) * 32767);
    for (let i = 0, o = 44; i < n; i++, o += 4) {
      v.setInt16(o, q(left[i]), true);
      v.setInt16(o + 2, q(right[i]), true);
    }
    return new Uint8Array(buf);
  }

  return { SAMPLE_RATE, synthesize, encodeWav, penMotion, mulberry32 };
});
