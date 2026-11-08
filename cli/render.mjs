#!/usr/bin/env node
// Headless, deterministic renderer for Fourier Circle Studio.
// Loads render.html in headless Chrome, steps the sketch one frame at a time, pipes each
// canvas frame (PNG) into ffmpeg, synthesizes the soundtrack offline, and writes the export pack:
//   <stem>.mp4  <stem>_thumb.png  <stem>_post.json  <stem>.json
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import puppeteer from 'puppeteer';
import { buildPost, subjectFromPath } from './post.mjs';

const require = createRequire(import.meta.url);
const Audio = require('../src/audio.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: node cli/render.mjs [--image file.svg|png|jpg] [options]

Input
  --image PATH          SVG (sampled as vectors) or bitmap (outline traced). Default: built-in heart
  --threshold N         bitmap darkness threshold 10-245 (default 128)
  --invert              bitmap has light lines on a dark background
Animation
  --format F            9:16 | 1:1 | 16:9 (default 9:16)
  --duration S          seconds per drawing (default 10)
  --hold S              pause on each finished drawing (default 1.5)
  --final-hold S        pause on the last finished drawing (default 2.5)
  --build-up            redraw with 2 -> 10 -> 50 -> 200 -> all circles
  --circles N           circles to use without --build-up (default all)
  --zoom Z              follow-the-pen zoom, 1 = off (default 1)
  --color HEX           trail color (default #ff3366)
  --rainbow             rainbow trail
  --title TEXT          title drawn on the video
  --no-count            hide the "N circles" caption
  --fps N               frames per second (default 60)
Sound
  --no-sound            no procedural soundtrack (silent track unless --music)
  --music FILE          music mixed under the soundtrack (ducked), looped/trimmed to length
  --music-volume V      music gain (default 0.35, or 1 with --no-sound)
  --seed N              noise seed for the soundtrack (default 1)
Export
  --out PATH            output .mp4 (default out/<input name>.mp4)
  --subject TEXT        subject for the post title (default: from file name)
  --post-title TEXT     override post title
  --post-description T  override post description
  --hashtags "a,b,c"    override hashtags
  --crf N               x264 quality (default 18)
  --chrome PATH         browser executable (or env FOURIER_CHROME)
`;

const OPTIONS = {
  image: { type: 'string' }, threshold: { type: 'string', default: '128' }, invert: { type: 'boolean', default: false },
  format: { type: 'string', default: '9:16' }, duration: { type: 'string', default: '10' },
  hold: { type: 'string', default: '1.5' }, 'final-hold': { type: 'string', default: '2.5' },
  'build-up': { type: 'boolean', default: false }, circles: { type: 'string' }, zoom: { type: 'string', default: '1' },
  color: { type: 'string', default: '#ff3366' }, rainbow: { type: 'boolean', default: false },
  title: { type: 'string', default: '' }, 'no-count': { type: 'boolean', default: false }, fps: { type: 'string', default: '60' },
  'no-sound': { type: 'boolean', default: false }, music: { type: 'string' }, 'music-volume': { type: 'string' },
  seed: { type: 'string', default: '1' }, out: { type: 'string' }, subject: { type: 'string' },
  'post-title': { type: 'string' }, 'post-description': { type: 'string' }, hashtags: { type: 'string' },
  crf: { type: 'string', default: '18' }, chrome: { type: 'string' }, help: { type: 'boolean', short: 'h', default: false },
};

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function numberOpt(values, name, min, max) {
  const v = Number(values[name]);
  if (!Number.isFinite(v) || v < min || v > max) fail(`--${name} must be a number in [${min}, ${max}]`);
  return v;
}

// Prefer puppeteer's own browser; otherwise reuse the newest one already in the puppeteer cache.
export function findBrowser(explicit) {
  if (explicit) return explicit;
  try {
    const p = puppeteer.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* not downloaded */ }
  const cache = process.env.PUPPETEER_CACHE_DIR || join(homedir(), '.cache', 'puppeteer');
  const byVersion = (a, b) => b.split('-').pop().localeCompare(a.split('-').pop(), undefined, { numeric: true });
  const candidates = [
    ['chrome-headless-shell', d => ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64'].map(x => join(d, x, 'chrome-headless-shell'))],
    ['chrome', d => ['chrome-mac-arm64', 'chrome-mac-x64'].map(x => join(d, x, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).concat(join(d, 'chrome-linux64', 'chrome'))],
  ];
  for (const [kind, paths] of candidates) {
    const dir = join(cache, kind);
    if (!existsSync(dir)) continue;
    for (const v of readdirSync(dir).sort(byVersion)) {
      const hit = paths(join(dir, v)).find(existsSync);
      if (hit) return hit;
    }
  }
  return undefined;   // let puppeteer report what is missing
}

function audioFilter({ sound, music, musicVolume, seconds }) {
  const fadeOut = Math.min(1.5, seconds / 4).toFixed(3), st = (seconds - fadeOut).toFixed(3);
  const m = `[2:a]aresample=48000,volume=${musicVolume},afade=t=in:d=0.5,afade=t=out:st=${st}:d=${fadeOut}`;
  if (sound && music) {
    // Duck the music under the soundtrack with a sidechain compressor.
    return `[1:a]aresample=48000,asplit[s0][s1];${m}[m];[m][s1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350[md];` +
      '[s0][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]';
  }
  if (music) return `${m.replace('[2:a]', '[1:a]')}[a]`;
  return null;
}

async function main() {
  const { values } = parseArgs({ options: OPTIONS, strict: true });
  if (values.help) { process.stdout.write(HELP); return; }

  const format = values.format;
  if (!['9:16', '1:1', '16:9'].includes(format)) fail('--format must be 9:16, 1:1 or 16:9');
  const fps = numberOpt(values, 'fps', 1, 120);
  const duration = numberOpt(values, 'duration', 0.5, 600);
  const threshold = numberOpt(values, 'threshold', 0, 255);
  const seed = Math.round(numberOpt(values, 'seed', 0, 2 ** 31));
  const sound = !values['no-sound'];
  // Music sits under the soundtrack by default, or plays at full level when it is the only audio.
  values['music-volume'] ??= sound ? '0.35' : '1';
  const musicVolume = numberOpt(values, 'music-volume', 0, 4);
  const image = values.image ? resolve(values.image) : null;
  if (image && !existsSync(image)) fail(`image not found: ${image}`);
  const music = values.music ? resolve(values.music) : null;
  if (music && !existsSync(music)) fail(`music not found: ${music}`);

  const stemName = image ? basename(image, extname(image)) : 'heart';
  const outPath = resolve(values.out || join(ROOT, 'out', `${stemName}.mp4`));
  const stem = outPath.replace(/\.mp4$/i, '');
  mkdirSync(dirname(outPath), { recursive: true });

  const config = {
    format, fps, duration,
    hold: numberOpt(values, 'hold', 0, 60), finalHold: numberOpt(values, 'final-hold', 0, 60),
    buildUp: values['build-up'], circles: values.circles ? numberOpt(values, 'circles', 1, 1e6) : Infinity,
    zoom: numberOpt(values, 'zoom', 1, 20), color: values.color, rainbow: values.rainbow,
    title: values.title, showCount: !values['no-count'],
  };

  const t0 = Date.now();
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: findBrowser(values.chrome || process.env.FOURIER_CHROME),
    args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--disable-gpu', '--font-render-hinting=none'],
  });
  const tmp = mkdtempSync(join(tmpdir(), 'fourier-'));
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(pathToFileURL(join(ROOT, 'render.html')).href);
    await page.waitForFunction(() => window.studio, { timeout: 30000 });
    await page.evaluate(c => { window.studio.configure({ ...c, circles: c.circles ?? Infinity }); }, { ...config, circles: Number.isFinite(config.circles) ? config.circles : null });

    // Load the drawing.
    let circles;
    if (!image) circles = await page.evaluate(() => window.studio.circles);
    else if (/\.svg$/i.test(image)) {
      circles = await page.evaluate(text => window.studio.loadSvgText(text), readFileSync(image, 'utf8'));
    } else {
      const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }[extname(image).toLowerCase()] || 'image/png';
      const url = `data:${mime};base64,${readFileSync(image).toString('base64')}`;
      circles = await page.evaluate((u, o) => window.studio.loadImageUrl(u, o), url, { threshold, invert: values.invert });
    }
    if (!circles) fail('no drawable lines found (try --threshold / --invert, or check the SVG)');

    const info = await page.evaluate(() => { window.studio.reset(); return window.studio.info(); });
    const { timeline, width, height, levels } = info;
    const total = timeline.totalFrames, seconds = total / fps;
    console.log(`${stemName}: ${circles} circles, levels [${levels.join(', ')}], ${width}x${height} @ ${fps} fps, ${total} frames (${seconds.toFixed(2)} s)`);

    // Soundtrack.
    const inputs = ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
    if (sound) {
      const wav = join(tmp, 'sound.wav');
      writeFileSync(wav, Audio.encodeWav(Audio.synthesize({ fourier: info.fourier, timeline, seed })));
      inputs.push('-i', wav);
    }
    if (music) inputs.push('-stream_loop', '-1', '-i', music);
    if (!sound && !music) inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    const filter = audioFilter({ sound, music, musicVolume, seconds });
    const audioMap = filter ? ['-filter_complex', filter, '-map', '[a]'] : ['-map', '1:a'];

    const ffArgs = [
      '-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-map', '0:v', ...audioMap,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(values.crf), '-pix_fmt', 'yuv420p', '-r', String(fps),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', seconds.toFixed(6),
      '-movflags', '+faststart', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
      outPath,
    ];
    const ff = spawn(process.env.FFMPEG || 'ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'inherit'] });
    const ffDone = once(ff, 'close');
    ff.stdin.on('error', () => {});   // ffmpeg died early: its exit code is reported below

    // Frames: deterministic stepping, one PNG per frame.
    let last = null, nextReport = 0.1;
    for (let i = 0; i < total; i++) {
      const b64 = await page.evaluate(() => { window.studio.renderFrame(); return window.studio.canvas.toDataURL('image/png').slice(22); });
      last = Buffer.from(b64, 'base64');
      if (ff.exitCode !== null) break;
      if (!ff.stdin.write(last)) await Promise.race([once(ff.stdin, 'drain'), ffDone]);
      if ((i + 1) / total >= nextReport) {
        process.stdout.write(`  ${Math.round((i + 1) / total * 100)}%`);
        nextReport += 0.1;
      }
    }
    ff.stdin.end();
    const [code] = await ffDone;
    process.stdout.write('\n');
    if (code !== 0) fail(`ffmpeg exited with code ${code}`);

    // Export pack: the finished drawing is the last frame (epicycles faded out).
    writeFileSync(`${stem}_thumb.png`, last);
    // Name the circles actually drawn (--circles 300 of 999 -> 300), not every coefficient.
    const post = buildPost({
      subject: values.subject || (image ? subjectFromPath(image) : 'heart'), circles: Math.max(...levels), format,
      buildUp: config.buildUp, levels,
      title: values['post-title'], description: values['post-description'], hashtags: values.hashtags,
    });
    writeFileSync(`${stem}_post.json`, `${JSON.stringify(post, null, 2)}\n`);
    const meta = {
      generator: 'fourier_studio', input: image ? basename(image) : 'builtin:heart',
      params: { ...config, circles: Number.isFinite(config.circles) ? config.circles : 'all', threshold, invert: values.invert, sound, music: music ? basename(music) : null, musicVolume, crf: Number(values.crf) },
      seed, circles, levels, width, height, fps, frames: total, duration_s: seconds,
    };
    writeFileSync(`${stem}.json`, `${JSON.stringify(meta, null, 2)}\n`);
    console.log(`wrote ${outPath} (+ _thumb.png, _post.json, .json) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } finally {
    await browser.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
