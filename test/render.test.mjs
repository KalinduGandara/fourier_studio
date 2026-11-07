// Smoke test: real headless render of a tiny clip, checked with ffprobe. Takes a few seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const render = (out, extra = []) => execFileSync('node', [join(ROOT, 'cli/render.mjs'), '--image', join(ROOT, 'samples/star.svg'),
  '--format', '1:1', '--fps', '20', '--duration', '1', '--hold', '0.2', '--final-hold', '0.5', '--build-up', '--out', out, ...extra], { encoding: 'utf8' });
const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');

test('headless render writes a valid, deterministic export pack', { timeout: 180000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'fourier-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = join(dir, 'a.mp4'), b = join(dir, 'b.mp4');
  render(a, ['--subject', 'star']);
  render(b, ['--subject', 'star']);

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', a], { encoding: 'utf8' }));
  const v = probe.streams.find(s => s.codec_type === 'video'), au = probe.streams.find(s => s.codec_type === 'audio');
  assert.equal(v.codec_name, 'h264');
  assert.equal(v.pix_fmt, 'yuv420p');
  assert.deepEqual([v.width, v.height, v.r_frame_rate], [1080, 1080, '20/1']);
  assert.equal(au.codec_name, 'aac');
  assert.deepEqual([au.sample_rate, au.channels], ['48000', 2]);
  const meta = JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8'));
  assert.ok(Math.abs(Number(probe.format.duration) - meta.duration_s) < 0.1);
  assert.deepEqual(meta.levels.slice(0, 3), [2, 10, 50]);

  const thumb = readFileSync(join(dir, 'a_thumb.png'));
  assert.equal(thumb.readUInt32BE(16), 1080);
  assert.equal(thumb.readUInt32BE(20), 1080);
  const post = JSON.parse(readFileSync(join(dir, 'a_post.json'), 'utf8'));
  assert.match(post.title, /^Drawing a star with \d+ circles$/);
  assert.ok(post.hashtags.length > 0 && post.platforms.youtube);

  assert.equal(sha(a), sha(b), 'identical video across runs');
  assert.equal(sha(join(dir, 'a_thumb.png')), sha(join(dir, 'b_thumb.png')));
});

test('--no-sound still writes a silent AAC track', { timeout: 120000 }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'fourier-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'silent.mp4');
  execFileSync('node', [join(ROOT, 'cli/render.mjs'), '--fps', '10', '--duration', '0.5', '--final-hold', '0.2', '--no-sound', '--out', out]);
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', out], { encoding: 'utf8' });
  assert.deepEqual(streams.trim().split('\n'), ['h264', 'aac']);
});
