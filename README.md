# Fourier Circle Studio

Spinning circles (epicycles) that draw a picture: a Fourier series of the picture's outline. Use it two ways:

- **Interactive page** (`index.html`): drop in an image, tweak it, preview it with sound, and record it in the browser.
- **Headless CLI** (`cli/render.mjs`): renders a reproducible MP4 with a procedural soundtrack, and writes the
  thumbnail and post metadata needed to publish it (the "export pack").

Both use the same sketch (`src/studio.js`), so what you preview is what the CLI renders.

## Setup

```bash
npm install            # puppeteer (headless Chrome) + p5 (dev, for vendoring)
npm test               # unit tests + a short real render checked with ffprobe
```

You also need `ffmpeg`/`ffprobe` on `PATH`. The CLI uses puppeteer's own Chrome. If that hasn't been downloaded
(for example after `PUPPETEER_SKIP_DOWNLOAD=1 npm install`), it uses the newest Chrome already in
`~/.cache/puppeteer`. To use a different browser, pass `--chrome PATH` or set `FOURIER_CHROME`.

## Interactive page

Open `index.html` in Chrome. It works from `file://`, and p5 is loaded from `vendor/`, so there's no server and no CDN.

| Control | What it does |
|---|---|
| Image | Upload or drop an image. An SVG is sampled along its real curves. A bitmap (PNG/JPG) is traced along the outline of its dark pixels. |
| Darkness threshold / Light lines | Bitmap tracing only. Sets which pixels count as "ink". |
| Video format | 9:16 (1080×1920), 1:1 (1080×1080) or 16:9 (1920×1080). |
| Circles / Build-up | Choose how many circles to use, or redraw with 2 → 10 → 50 → 200 → all circles. |
| Seconds per drawing | How long one drawing pass takes. |
| Follow-zoom | The camera follows the pen while it draws, then zooms back out to show the result. |
| Trail color / Rainbow | Color of the drawn line. |
| Title / Show circle count | Text drawn on the video. |
| Sound | Plays the same procedural soundtrack the CLI renders. It is also included when you record. |
| Record video | Restarts the animation, records one full run with MediaRecorder, then downloads it. |

## Headless CLI

```bash
node cli/render.mjs --image samples/butterfly.svg --duration 8 --zoom 2 --rainbow \
  --title "Can circles draw a butterfly?"
# -> out/butterfly.mp4, out/butterfly_thumb.png, out/butterfly_post.json, out/butterfly.json
```

`node cli/render.mjs --help` lists every flag. The main ones:

| Flag | Default | |
|---|---|---|
| `--image PATH` | built-in heart | `.svg` (vector) or a bitmap (`.png`/`.jpg`/`.webp`/…) |
| `--threshold N`, `--invert` | 128, off | settings for bitmap tracing |
| `--format` | `9:16` | `9:16`, `1:1` or `16:9` |
| `--duration S` | 10 | seconds per drawing |
| `--hold S`, `--final-hold S` | 1.5, 2.5 | pause on each finished drawing, and on the last one |
| `--build-up` | off | redraw with 2 → 10 → 50 → 200 → all circles |
| `--circles N` | all | how many circles to use (without `--build-up`) |
| `--zoom Z` | 1 | how far the camera zooms in to follow the pen |
| `--color HEX`, `--rainbow` | `#ff3366` | trail color |
| `--title TEXT`, `--no-count` | | text drawn on the video |
| `--fps N` | 60 | |
| `--no-sound` | | leave out the procedural soundtrack (the video then has a silent track unless `--music` is given) |
| `--music FILE`, `--music-volume V` | 0.35 (1 with `--no-sound`) | music under the soundtrack. It is ducked, looped or trimmed to fit, and fades out at the end. |
| `--seed N` | 1 | seed for the soundtrack's noise |
| `--out PATH` | `out/<image name>.mp4` | |
| `--subject`, `--post-title`, `--post-description`, `--hashtags "a,b"` | | override the generated post metadata |

Total length = (duration × number of drawings) + the holds. Example: one drawing with `--duration 8` gives 8 + 2.5 = 10.5 s.
With `--build-up` and 1000 circles there are 5 drawings, so keep `--duration` low (3–5 s) if you want a short video.

Rendering is fast: a 10.5 s, 1080×1920, 60 fps video takes about 15 s on an M1 Pro.

### How it works

1. `render.html` loads the sketch in headless Chrome. The sketch never runs on its own timer.
2. For every frame, the CLI calls `studio.renderFrame()`. That moves the animation forward exactly one frame and
   draws it. The CLI then reads the canvas as a PNG and pipes it to ffmpeg (`image2pipe` → libx264, yuv420p, `+faststart`).
3. The page returns the Fourier coefficients and the frame plan. Node uses them to compute the soundtrack
   (`src/audio.js`), writes it as a WAV file, and ffmpeg encodes it to AAC (48 kHz, stereo) and adds it to the MP4.

The same inputs and flags always produce a byte-identical MP4 (the smoke test checks this).

### Sound design

All sound is generated in code (`src/audio.js`) and tied to the drawing:

- **Pad**: a soft chord for each drawing pass (D major, then Bm7, Gmaj7, Asus). The last pass always ends on D.
- **Arpeggio**: plucked notes from a pentatonic scale, about 4 per second. Pitch follows how high the pen is, loudness
  follows how fast it moves, and stereo position follows its left/right position.
- **Pencil hiss**: quiet filtered noise that gets louder as the pen moves faster.
- **Chimes**: a bell when each drawing finishes, a full chord when the last one finishes, and a softer bell each
  time the circle count changes in build-up mode.
- A ping-pong echo, fade-in and fade-out, and peak normalization to −2 dBFS (about −15 LUFS).

## Export pack

Every render writes these files next to each other (this is the shared contract for all video tools in this workspace):

| File | Contents |
|---|---|
| `<stem>.mp4` | H.264 yuv420p, `+faststart`, AAC 48 kHz stereo |
| `<stem>_thumb.png` | the finished drawing (the last frame), same size as the video |
| `<stem>_post.json` | `title` (≤100 chars), `description`, `hashtags` (without `#`), and per-platform `platforms.youtube` / `tiktok` / `instagram` / `facebook` versions |
| `<stem>.json` | render metadata: input, all params, seed, circles, levels, frames, `duration_s` |

The default post title is "Drawing a/an `<subject>` with `<N>` circles". The subject comes from `--subject` or the
file name. YouTube defaults to `privacy: "private"`, category 27 (Education), and `made_for_kids: false`.

## Samples

`samples/` holds original line-art drawings (CC0) for testing and demos: `cat.svg`, `rocket.svg`, `star.svg`,
`butterfly.svg` and `notes.png` (a bitmap, to test tracing). The best results come from a drawing with a single
continuous outline. A drawing made of separate parts gets straight lines joining those parts.

## Layout

```
index.html        interactive page (UI only)
render.html       headless page used by the CLI
src/core.js       pure logic: tracing, path ordering, DFT, frame planning (shared, tested)
src/audio.js      procedural soundtrack + WAV encoder (shared, tested)
src/studio.js     p5 instance-mode sketch: draws any frame of a run
src/ui.js         form controls, live sound, MediaRecorder
cli/render.mjs    headless renderer → export pack
cli/post.mjs      post metadata builder
vendor/p5.min.js  p5 1.11 (refresh with `npm run vendor`)
samples/          example input drawings
test/             node:test unit tests + render smoke test
```
