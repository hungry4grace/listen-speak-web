// Measure a reading: how long it really is, where the voice starts and stops,
// and every pause in between. voiceAlign.js then matches the pauses to the
// phrases. The measurement is stored with the recording (it doesn't depend on
// how the text is split); the matching runs at playback.
//
//   { v, dur, speech: [start, end], pauses: [[start, end], …] }   (seconds)
//
// analyzePcm is pure (also used by scripts/ with ffmpeg-decoded audio); the
// browser helpers decode a Blob / data URL first.

// Bump when the measurement changes: older analyses are then redone.
export const ANALYSIS_VERSION = 1;

const FRAME = 0.01; // s
const MIN_PAUSE = 0.12; // s
const r2 = (x) => Math.round(x * 100) / 100;

// Silence = 16 dB under the recording's average loudness (kept between
// −55 and −28 dB), like ffmpeg volumedetect + silencedetect in scripts/.
export function analyzePcm(samples, sampleRate) {
  const n = samples.length;
  const dur = n / sampleRate;
  const hop = Math.max(1, Math.round(sampleRate * FRAME));
  const frames = Math.ceil(n / hop);
  const db = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f += 1) {
    let e = 0;
    const end = Math.min(n, (f + 1) * hop);
    for (let i = f * hop; i < end; i += 1) e += samples[i] * samples[i];
    sum += e;
    db[f] = 10 * Math.log10(e / Math.max(1, end - f * hop) + 1e-12);
  }
  const mean = 10 * Math.log10(sum / Math.max(1, n) + 1e-12);
  const thr = Math.max(-55, Math.min(-28, Math.round(mean - 16)));
  // Voiced runs, in frames.
  let runs = [];
  for (let f = 0; f < frames; f += 1) {
    if (db[f] < thr) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] === f) last[1] = f + 1; else runs.push([f, f + 1]);
  }
  // A click or breath on its own (short, with silence well around it) isn't speech.
  const blip = Math.round(0.12 / FRAME);
  const apart = Math.round(0.5 / FRAME);
  runs = runs.filter((r, i) => {
    if (r[1] - r[0] >= blip) return true;
    const before = i > 0 ? r[0] - runs[i - 1][1] : Infinity;
    const after = i < runs.length - 1 ? runs[i + 1][0] - r[1] : Infinity;
    return before < apart && after < apart;
  });
  if (!runs.length) return { v: ANALYSIS_VERSION, dur: r2(dur), speech: [0, r2(dur)], pauses: [] };
  const pauses = [];
  for (let i = 1; i < runs.length; i += 1) {
    const s = runs[i - 1][1] * FRAME;
    const e = runs[i][0] * FRAME;
    if (e - s >= MIN_PAUSE) pauses.push([r2(s), r2(e)]);
  }
  return { v: ANALYSIS_VERSION, dur: r2(dur), speech: [r2(runs[0][0] * FRAME), r2(Math.min(dur, runs[runs.length - 1][1] * FRAME))], pauses };
}

// Accept an analysis only if it is well-formed (server side for uploads,
// client side for the local cache). Returns a clean copy or null.
export function cleanVoiceAnalysis(a) {
  if (!a || typeof a !== 'object') return null;
  const v = Number(a.v);
  const dur = Number(a.dur);
  if (!Number.isInteger(v) || v < 1 || v > 99 || !(dur > 0) || dur > 1800) return null;
  const sp = Array.isArray(a.speech) ? a.speech.map(Number) : [];
  if (sp.length !== 2 || !(sp[0] >= 0) || !(sp[1] > sp[0]) || sp[1] > dur + 0.05) return null;
  if (!Array.isArray(a.pauses) || a.pauses.length > 5000) return null;
  const pauses = [];
  let prev = sp[0];
  for (const p of a.pauses) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const s = Number(p[0]);
    const e = Number(p[1]);
    if (!(s >= prev) || !(e > s) || e > sp[1]) return null;
    pauses.push([r2(s), r2(e)]);
    prev = e;
  }
  return { v, dur: r2(dur), speech: [r2(sp[0]), r2(sp[1])], pauses };
}

// ── Browser ───────────────────────────────────────────────────────────────

async function decode(arrayBuffer) {
  const Ctx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('no Web Audio');
  const ctx = new Ctx(1, 1, 44100);
  // Older Safari only has the callback form.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
}

export async function analyzeArrayBuffer(arrayBuffer) {
  const buf = await decode(arrayBuffer);
  let samples = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) {
    const mix = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c += 1) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i += 1) mix[i] += ch[i] / buf.numberOfChannels;
    }
    samples = mix;
  }
  return analyzePcm(samples, buf.sampleRate);
}

export async function analyzeBlob(blob) {
  return analyzeArrayBuffer(await blob.arrayBuffer());
}

export async function analyzeDataUrl(dataUrl) {
  const b64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return analyzeArrayBuffer(bytes.buffer);
}

// Analyses computed on this device for recordings stored without one (or
// with an older version), keyed by voiceId.
const CACHE_KEY = 'ls_voice_analysis_v1';
const CACHE_MAX = 200;
function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { return {}; }
}
export function cachedAnalysis(voiceId) {
  const a = cleanVoiceAnalysis(readCache()[voiceId]);
  return a && a.v === ANALYSIS_VERSION ? a : null;
}
export function cacheAnalysis(voiceId, analysis) {
  try {
    const c = readCache();
    delete c[voiceId];
    c[voiceId] = analysis;
    const keys = Object.keys(c);
    for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete c[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* storage full or blocked — just recompute next time */ }
}
export function forgetCachedAnalysis(voiceId) {
  try {
    const c = readCache();
    delete c[voiceId];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* noop */ }
}
