// Shared voice-enhance chain, used by the recorder's live preview and by the
// background "bake" that renders the effect into the uploaded blob.
//
// Enhancer = voice-band EQ only (no reverb):
//   highpass 120Hz — cuts rumble / handling noise below the voice range
//   lowpass  9kHz  — cuts hiss above the voice range
//   peaking +2dB @2.5kHz — gentle presence lift for clarity
export function connectVoiceChain(ctx, src, destination, withEnhance) {
  if (!withEnhance) { src.connect(destination); return; }
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 120; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 9000; lp.Q.value = 0.7;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking'; presence.frequency.value = 2500; presence.Q.value = 1; presence.gain.value = 2;
  src.connect(hp); hp.connect(lp); lp.connect(presence);
  presence.connect(destination);
}

// Bake the enhance chain into a fresh 48kbps blob. This is a REALTIME re-encode
// (MediaRecorder can only capture in real time), so it takes roughly as long as
// the clip — which is exactly why the caller runs it in the background instead
// of blocking the recorder UI.
export async function bakeBeautifiedBlob(blob, mime = 'audio/webm') {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const srcBuf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = srcBuf;
    connectVoiceChain(ctx, src, dest, true);
    const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 48000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
    const done = new Promise((resolve) => { rec.onstop = resolve; });
    rec.start();
    src.start();
    src.onended = () => window.setTimeout(() => { try { rec.stop(); } catch { /* noop */ } }, 200);
    await done;
    return new Blob(parts, { type: mime });
  } finally {
    try { await ctx.close(); } catch { /* noop */ }
  }
}
