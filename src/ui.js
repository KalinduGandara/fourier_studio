// Fourier Circle Studio — interactive page controls (index.html).
// All drawing lives in studio.js; this file only maps form controls to the studio API,
// plays the procedural soundtrack, and records the canvas with MediaRecorder.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const num = id => parseFloat($(id).value);
  const MIME_TYPES = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

  let studio = null, recorder = null;
  let audioCtx = null, soundSrc = null, soundCache = { key: '', buffer: null };

  FourierStudio.create({ container: 'stage', playing: true, onEvent }).then(s => {
    studio = s;
    studio.configure(readConfig());
    fitCanvas();
    bindUI();
    afterNewDrawing('Demo heart loaded — upload an image or SVG to trace your own.');
  });

  function readConfig() {
    return {
      format: $('format').value, duration: num('duration'), buildUp: $('buildUp').checked,
      circles: parseInt($('circles').value, 10) || Infinity, zoom: num('zoom'), color: $('color').value,
      rainbow: $('rainbow').checked, title: $('title').value, showCount: $('showCount').checked,
    };
  }

  function bindUI() {
    $('imageUpload').addEventListener('change', e => loadFile(e.target.files[0]));
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

    $('threshold').addEventListener('change', retrace);
    $('invert').addEventListener('change', retrace);
    $('format').addEventListener('change', apply);
    $('circles').addEventListener('input', apply);
    $('buildUp').addEventListener('change', () => { $('circles').disabled = $('buildUp').checked; apply(); });
    $('duration').addEventListener('change', apply);
    for (const id of ['zoom', 'color', 'rainbow', 'title', 'showCount']) $(id).addEventListener('input', () => studio.configure(readConfig()));
    $('sound').addEventListener('change', () => ($('sound').checked ? restart() : stopSound()));
    $('record').addEventListener('click', () => (recorder ? recorder.stop() : startRecording()));
    for (const id of ['threshold', 'circles', 'duration', 'zoom']) $(id).addEventListener('input', updateLabels);
    window.addEventListener('resize', fitCanvas);
    updateLabels();
  }

  // Timing-affecting change: reconfigure and restart animation + sound together.
  function apply() {
    studio.configure(readConfig());
    fitCanvas();
    restart();
  }

  function restart() {
    studio.reset();
    startSound();
  }

  function onEvent(type, data) {
    if (type === 'loop') startSound();
    if (type === 'cycleend' && data.last && recorder) recorder.stop();
  }

  function updateLabels() {
    $('thresholdVal').textContent = $('threshold').value;
    $('circlesVal').textContent = studio ? `${$('circles').value} / ${studio.circles}` : '';
    $('durationVal').textContent = `${$('duration').value}s`;
    $('zoomVal').textContent = num('zoom') === 1 ? 'off' : `${$('zoom').value}×`;
  }

  function setStatus(msg, kind = '') {
    $('status').textContent = msg;
    $('status').className = kind;
  }

  function fitCanvas() {
    if (!studio) return;
    const stage = $('stage'), c = studio.canvas;
    const s = Math.min((stage.clientWidth - 24) / c.width, (stage.clientHeight - 24) / c.height);
    c.style.width = `${c.width * s}px`;
    c.style.height = `${c.height * s}px`;
  }

  // A new drawing was traced: the circle slider spans all of its circles.
  function afterNewDrawing(msg) {
    $('circles').max = studio.circles;
    $('circles').value = studio.circles;
    apply();
    updateLabels();
    setStatus(msg);
  }

  // ---------- Sound (same synth as the CLI) ----------

  function startSound(dest) {
    stopSound();
    if (!$('sound').checked) return;
    audioCtx = audioCtx || new AudioContext({ sampleRate: FourierAudio.SAMPLE_RATE });
    const info = studio.info();
    const key = JSON.stringify([info.timeline, studio.circles, info.fourier[0]]);
    if (soundCache.key !== key) {
      const { left, right, sampleRate } = FourierAudio.synthesize({ fourier: info.fourier, timeline: info.timeline });
      const buffer = audioCtx.createBuffer(2, left.length, sampleRate);
      buffer.copyToChannel(left, 0);
      buffer.copyToChannel(right, 1);
      soundCache = { key, buffer };
    }
    soundSrc = audioCtx.createBufferSource();
    soundSrc.buffer = soundCache.buffer;
    soundSrc.connect(audioCtx.destination);
    if (dest) soundSrc.connect(dest);
    soundSrc.start();
  }

  function stopSound() {
    if (soundSrc) { soundSrc.stop(); soundSrc.disconnect(); soundSrc = null; }
  }

  // ---------- Recording ----------

  function startRecording() {
    const canvas = studio.canvas;
    if (!window.MediaRecorder || !canvas.captureStream) {
      setStatus('Recording is not supported in this browser.', 'error');
      return;
    }
    const fps = studio.config.fps;
    const stream = canvas.captureStream(fps);
    let dest = null;
    if ($('sound').checked) {
      audioCtx = audioCtx || new AudioContext({ sampleRate: FourierAudio.SAMPLE_RATE });
      dest = audioCtx.createMediaStreamDestination();
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }
    const mimeType = MIME_TYPES.find(m => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: 16e6 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const type = rec.mimeType || 'video/webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type }));
      a.download = `fourier-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      recorder = null;
      $('record').textContent = '● Record video';
      $('record').classList.remove('recording');
      setStatus(`Saved ${a.download}`);
    };

    studio.reset();
    startSound(dest);
    rec.start();
    recorder = rec;
    const seconds = Math.round(studio.totalFrames() / fps);
    $('record').textContent = '■ Stop & save';
    $('record').classList.add('recording');
    setStatus(`Recording… about ${seconds}s`, 'warn');
  }

  // ---------- Input ----------

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setStatus('Please choose an image file.', 'error');
      return;
    }
    if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      setStatus('Tracing SVG…', 'warn');
      file.text().then(text => {
        let n = null;
        try { n = studio.loadSvgText(text); } catch (err) { console.error(err); }
        if (n) afterNewDrawing(`Traced SVG with ${n} circles.`);
        else setStatus('No drawable shapes found in that SVG.', 'error');
      });
      return;
    }
    const url = URL.createObjectURL(file);
    setStatus('Tracing image…', 'warn');
    studio.loadImageUrl(url, traceOptions())
      .then(n => (n ? afterNewDrawing(`Traced with ${n} circles.`) : noLines()))
      .catch(() => setStatus('Could not read that image.', 'error'))
      .finally(() => URL.revokeObjectURL(url));
  }

  function traceOptions() {
    return { threshold: num('threshold'), invert: $('invert').checked };
  }

  function retrace() {
    setStatus('Tracing image…', 'warn');
    setTimeout(() => {   // let the status paint before the heavy work
      const n = studio.retrace(traceOptions());
      if (n) afterNewDrawing(`Traced with ${n} circles.`);
      else if (n === null) noLines();
      else setStatus('Threshold and light/dark only apply to bitmap images.');
    }, 30);
  }

  function noLines() {
    setStatus('No lines found — try moving the threshold or toggling the light/dark option.', 'error');
  }
})();
