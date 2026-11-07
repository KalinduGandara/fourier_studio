import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../src/core.js');
const Audio = require('../src/audio.js');

const series = Core.fourierSeries(Core.heartPoints());
const timeline = Core.planTimeline({ fps: 30, duration: 2, hold: 0.5, finalHold: 1, levels: Core.buildLevels(series.length, true), points: series.length });
const hash = s => createHash('sha256').update(Buffer.from(s.left.buffer)).update(Buffer.from(s.right.buffer)).digest('hex');

test('soundtrack length matches the video exactly', () => {
  const s = Audio.synthesize({ fourier: series, timeline });
  assert.equal(s.sampleRate, 48000);
  assert.equal(s.left.length, Math.round(timeline.totalFrames / 30 * 48000));
  assert.equal(s.right.length, s.left.length);
});

test('soundtrack is deterministic, seed-dependent, normalized and not silent', () => {
  const a = Audio.synthesize({ fourier: series, timeline, seed: 1 });
  const b = Audio.synthesize({ fourier: series, timeline, seed: 1 });
  const c = Audio.synthesize({ fourier: series, timeline, seed: 2 });
  assert.equal(hash(a), hash(b));
  assert.notEqual(hash(a), hash(c));
  let peak = 0, energy = 0;
  for (let i = 0; i < a.left.length; i++) {
    peak = Math.max(peak, Math.abs(a.left[i]), Math.abs(a.right[i]));
    energy += a.left[i] ** 2;
  }
  assert.ok(Math.abs(peak - 0.794) < 1e-3, `peak ${peak}`);
  assert.ok(Math.sqrt(energy / a.left.length) > 0.02, 'audible');
  assert.ok(Math.abs(a.left[a.left.length - 1]) < 1e-3, 'fades out');
});

test('penMotion speed is 0 while holding and within [0, 1] while drawing', () => {
  const { speed } = Audio.penMotion(series, timeline);
  const c = timeline.cycles[0];
  assert.equal(speed[c.drawEnd], 0);
  assert.ok(speed.every(v => v >= 0 && v <= 1));
  assert.equal(Math.max(...speed), 1);
  assert.ok(speed.slice(c.start, c.drawEnd).every(v => v > 0));
});

test('encodeWav writes a valid 16-bit stereo header', () => {
  const wav = Buffer.from(Audio.encodeWav({ left: new Float32Array([0, 1, -1]), right: new Float32Array([0.5, 0, 2]), sampleRate: 48000 }));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 48000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 12);
  assert.deepEqual([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48), wav.readInt16LE(54)], [0, 16384, 32767, 32767]);
});
