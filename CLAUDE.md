# CLAUDE.md — fourier_studio

Fourier epicycle drawing videos for faceless social channels. The interactive p5.js page and the headless Node
renderer share one sketch. See README.md for user docs.

## Stack
- Browser: p5.js 1.11 in instance mode, vendored at `vendor/p5.min.js` (no CDN). Classic `<script>`s, so `index.html` works from `file://`.
- Node ≥ 20 (ESM `.mjs` for the CLI and tests), puppeteer (headless Chrome), ffmpeg/ffprobe on PATH.
- `src/core.js` and `src/audio.js` are UMD: they set `window.FourierCore` / `window.FourierAudio` in the browser and `module.exports` in Node (load them with `createRequire`). There is deliberately no `"type": "module"` in package.json.

## Commands
```bash
npm install                                   # PUPPETEER_SKIP_DOWNLOAD=1 is fine: the CLI falls back to ~/.cache/puppeteer
npm test                                      # all tests (~10 s, includes real renders)
npm run test:unit                             # pure logic only
node cli/render.mjs --help
node cli/render.mjs --image samples/cat.svg --duration 8 --rainbow   # -> out/cat.*
npm run vendor                                # refresh vendor/p5.min.js from node_modules
```

## Architecture
- `core.js`: pure and deterministic. Covers tracing (`inkPoints`), path ordering, `normalize`, `dft`, `fourierSeries`, `chain`/`tip`, `buildLevels`, `planTimeline`, `frameInfo` and `cycleTrail`. Every visual and audio decision is based on **frame index**.
- `studio.js`: `FourierStudio.create({container, playing, onEvent})` resolves to an API: `configure`, `setPoints`, `loadImageUrl`, `loadSvgText`, `retrace`, `reset`, `renderFrame`, `info`, `totalFrames`, `canvas`, `play`/`pause`. Events: `cycleend {cycle,last}` and `loop`.
- `audio.js`: `synthesize({fourier, timeline, seed})` returns `{left, right, sampleRate}`. `encodeWav` writes 16-bit stereo. The CLI synthesizes in Node from `studio.info()`. The UI uses the same function for its live preview.
- `cli/render.mjs`: steps `renderFrame()` → canvas PNG → ffmpeg `image2pipe`, muxes in the WAV and an optional ducked `--music`, then writes the export pack. `cli/post.mjs` builds `_post.json`.

## Conventions
- **Determinism is a feature.** Never use wall-clock time, `Math.random`, or `frameCount`-from-p5 in the sketch or the synth. Use `frameInfo(timeline, f)` and the seeded `mulberry32`. Per-frame easing is fps-normalized. Same inputs → byte-identical MP4 (asserted in `test/render.test.mjs`); keep the ffmpeg `bitexact` flags.
- **Export pack contract** (shared with the other tools in `/Users/kalindu/MyWork/videos`): `<stem>.mp4` (H.264 yuv420p +faststart, AAC 48 kHz stereo, 1080x1920@60 by default), `<stem>_thumb.png` (same size), `<stem>_post.json` (`title` ≤100, `description`, `hashtags` without `#`, optional `platforms.{youtube,tiktok,instagram,facebook}`), optional `<stem>.json` metadata. Output goes to `out/` (gitignored).
- The interactive UI must keep working (file://, sound toggle, MediaRecorder). After changing `studio.js` or `ui.js`, load `index.html` in headless Chrome and check that there are no page errors.
- Keep it simple. Pure logic goes in `core.js`/`audio.js` with node:test tests, and DOM/p5 code goes in `studio.js`.
- Sample inputs in `samples/` must be original or CC0.
- Commits: conventional commits. Never commit `out/`, `node_modules/`, or secrets.
