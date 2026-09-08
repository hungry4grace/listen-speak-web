import { PARTY_DB } from './lib/partyHost.js';
// 題庫創作者親聲朗讀 — client API for per-verse creator recordings on
// custom verse sets. Keyed by (setId, reference): the same verse in two
// different sets carries two independent recordings. One recording per
// (set, verse); re-recording replaces (server enforces same-email).
//
// Audio rides the same chunked-base64 pattern as team voice messages:
// upload slices → register the pointer → listeners fetch + reassemble.

const HOST = PARTY_DB;

async function jpost(path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

async function jget(path) {
  const res = await fetch(`${HOST}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const setVoiceApi = {
  uploadChunk: (email, setId, voiceId, index, total, data) =>
    jpost('/sets/verse-voice/chunk', { email, setId, voiceId, index, total, data }),
  register: (email, setId, reference, { voiceId, voiceMime, voiceDur, recordedBy }) =>
    jpost('/sets/verse-voice/set', { email, setId, reference, voiceId, voiceMime, voiceDur, recordedBy }),
  // { voices: { [reference]: { voiceId, voiceMime, voiceDur, recordedBy, at } } }
  getAll: (setId) =>
    jget(`/sets/verse-voices?setId=${encodeURIComponent(setId)}`),
  // The newest PUBLIC human recording per verse across the author + all
  // contributors, so the player can default to a real voice over TTS.
  // { latest: { [reference]: { ownerId, recordedBy, voiceId, voiceMime, voiceDur, at, source } } }
  getLatest: (setId) =>
    jget(`/sets/voice-latest?setId=${encodeURIComponent(setId)}`),
  getAudio: (setId, voiceId) =>
    jget(`/sets/voice?setId=${encodeURIComponent(setId)}&voiceId=${encodeURIComponent(voiceId)}`),
};

// ─── Set assets (自訂背景圖 / 背景音樂) ─────────────────────────────────
// Chunked base64 blobs keyed to a set; the set object carries the pointer
// ('custom:<assetId>') and mime. kind: 'image' (≤6 chunks) | 'music' (≤72).

export const setAssetApi = {
  getAsset: (setId, assetId) =>
    jget(`/sets/asset?setId=${encodeURIComponent(setId)}&assetId=${encodeURIComponent(assetId)}`),
};

// Fetch a custom asset as a data URL, cached per session so switching
// verses doesn't refetch multi-MB music/images.
const assetDataUrlCache = new Map();
export async function getSetAssetDataUrl(setId, assetId, mime) {
  const key = `${setId}|${assetId}`;
  if (assetDataUrlCache.has(key)) return assetDataUrlCache.get(key);
  const res = await setAssetApi.getAsset(setId, assetId);
  if (!res?.data) throw new Error('asset not found');
  const dataUrl = `data:${mime || 'application/octet-stream'};base64,${res.data}`;
  assetDataUrlCache.set(key, dataUrl);
  return dataUrl;
}

export async function uploadSetAsset({ email, setId, blob, kind }) {
  const base64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  const CHUNK = 100000;
  const total = Math.ceil(base64.length / CHUNK);
  const maxChunks = kind === 'music' ? 72 : 6;
  if (total > maxChunks) {
    throw new Error(kind === 'music'
      ? 'Music file too large — keep it under 5MB.'
      : 'Image too large after compression.');
  }
  const assetId = 'a_' + Math.random().toString(36).slice(2, 12);
  for (let i = 0; i < total; i++) {
    await jpost('/sets/asset/chunk', {
      email, setId, assetId, kind, index: i, total,
      data: base64.slice(i * CHUNK, (i + 1) * CHUNK),
    });
  }
  return assetId;
}

// Resize + re-encode an image file to a web-friendly background
// (max 1600px wide, WebP/JPEG ≤ ~420KB so it fits the 6-chunk cap).
export async function compressBackgroundImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const tryEncode = (type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));
  for (const [type, quality] of [['image/webp', 0.82], ['image/webp', 0.6], ['image/jpeg', 0.75], ['image/jpeg', 0.55]]) {
    const blob = await tryEncode(type, quality);
    if (blob && blob.size <= 420000) return blob;
  }
  const last = await tryEncode('image/jpeg', 0.4);
  if (last && last.size <= 420000) return last;
  throw new Error('Image too large — please choose a smaller photo.');
}

// Convenience: record-blob → chunk upload → register, in one call.
// Returns the registered meta. Throws with a readable message on failure
// (including the 403 "someone else recorded this" case).
export async function uploadVerseVoice({ email, setId, reference, blob, mime, dur, recordedBy }) {
  const base64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  const CHUNK = 100000; // chars — under the backend's 110000 cap
  const total = Math.ceil(base64.length / CHUNK);
  // 120-chunk backend cap ≈ 27 min at 48kbps — recordings of any practical
  // length chunk automatically; only truly runaway sessions are rejected.
  if (total > 120) throw new Error('Recording too long — keep it under 25 minutes.');
  const voiceId = 'v_' + Math.random().toString(36).slice(2, 12);
  for (let i = 0; i < total; i++) {
    await setVoiceApi.uploadChunk(email, setId, voiceId, i, total, base64.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  const res = await setVoiceApi.register(email, setId, reference, {
    voiceId, voiceMime: mime, voiceDur: dur, recordedBy,
  });
  return res.verseVoice;
}

// ─── 個人親聲朗讀 (personal voice) ──────────────────────────────────────
// A second voice layer parallel to the set owner's recording. Any logged-in
// listener records their own reading; it never overwrites the owner's slot.
// Keyed by an opaque ownerId (sha256(email) prefix) so share links can carry
// "whose voice" without exposing the email. Audio reuses the shared
// set-voice:* store, so recording reuses the same chunk-upload path.
// Playback priority (client): personal › owner › TTS.

// Must match the server's voiceOwnerId() exactly.
export async function voiceOwnerId(email) {
  const data = new TextEncoder().encode(String(email || '').toLowerCase().trim());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export const userVoiceApi = {
  register: (email, setId, reference, { voiceId, voiceMime, voiceDur, recordedBy, public: isPublic }) =>
    jpost('/sets/user-verse-voice/set', { email, setId, reference, voiceId, voiceMime, voiceDur, recordedBy, public: isPublic }),
  // { voices: { [reference]: meta } } — for one owner (self, or a share's vo=).
  getAll: (setId, owner) =>
    jget(`/sets/user-verse-voices?setId=${encodeURIComponent(setId)}&owner=${encodeURIComponent(owner)}`),
  remove: (email, setId, reference) =>
    jpost('/sets/user-verse-voice/delete', { email, setId, reference }),
  // Play-time picker: who has shared recordings for this set.
  // { contributors: [{ ownerId, recordedBy, count }] }.
  getContributors: (setId) =>
    jget(`/sets/voice-contributors?setId=${encodeURIComponent(setId)}`),
  // Every reference with ANY recording (author + public contributors), for the
  // set-detail ⭐. { refs: [reference, …] }.
  getVoiceRefs: (setId) =>
    jget(`/sets/voice-refs?setId=${encodeURIComponent(setId)}`),
  // Moderation: hide (or un-hide) one contributor. Auth = admin, or the set's
  // publisher (requesterEmail must match the set's ownerEmail).
  hideContributor: (setId, ownerId, { requesterEmail, requesterName, hidden = true } = {}) =>
    jpost('/sets/voice-contributor/hide', { setId, ownerId, requesterEmail, requesterName, hidden }),
};

// Record-blob → chunk upload (shared store) → register under the caller's
// personal namespace. Returns { ...meta, ownerId }.
export async function uploadUserVerseVoice({ email, setId, reference, blob, mime, dur, recordedBy, public: isPublic = true }) {
  const base64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  const CHUNK = 100000; // chars — under the backend's 110000 cap
  const total = Math.ceil(base64.length / CHUNK);
  // 120-chunk backend cap ≈ 27 min at 48kbps — recordings of any practical
  // length chunk automatically; only truly runaway sessions are rejected.
  if (total > 120) throw new Error('Recording too long — keep it under 25 minutes.');
  const voiceId = 'v_' + Math.random().toString(36).slice(2, 12);
  for (let i = 0; i < total; i++) {
    await setVoiceApi.uploadChunk(email, setId, voiceId, i, total, base64.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  const res = await userVoiceApi.register(email, setId, reference, {
    voiceId, voiceMime: mime, voiceDur: dur, recordedBy, public: isPublic,
  });
  return { ...(res.verseVoice || {}), ownerId: res.ownerId };
}

// ── 錄音留言 / 鼓勵 (voice-recording comments) ─────────────────────────
// YouTube-style feedback attached to ONE recording, identified by
// (setId, reference, targetOwnerId). targetOwnerId is a contributor's ownerId
// or the set author's byOwnerId (both surfaced by the picker). Text + audio
// comments, per-comment reactions, plus a recording-level like. Audio reuses
// the same content-addressed chunk store as recordings.
export const voiceCommentApi = {
  createText: (email, name, setId, reference, targetOwnerId, text) =>
    jpost('/sets/voice-comment/create', { email, name, setId, reference, targetOwnerId, type: 'text', text }),
  // { comments: [...], recordingReactions: [...] }
  list: (setId, reference, targetOwnerId) =>
    jget(`/sets/voice-comments?setId=${encodeURIComponent(setId)}&reference=${encodeURIComponent(reference)}&targetOwnerId=${encodeURIComponent(targetOwnerId)}`),
  remove: (email, name, setId, reference, targetOwnerId, cid) =>
    jpost('/sets/voice-comment/delete', { email, name, setId, reference, targetOwnerId, cid }),
  reactComment: (email, setId, reference, targetOwnerId, cid, emoji) =>
    jpost('/sets/voice-comment/react', { email, setId, reference, targetOwnerId, cid, emoji }),
  reactRecording: (email, name, setId, reference, targetOwnerId, emoji) =>
    jpost('/sets/voice-recording/react', { email, name, setId, reference, targetOwnerId, emoji }),
  // { counts: { `${reference}||${ownerId}`: { comments, likes } } } — one round trip.
  getCounts: (setId) =>
    jget(`/sets/voice-comment-counts?setId=${encodeURIComponent(setId)}`),
  // Encouragement inbox for a recorder (by their own ownerId).
  getEncouragement: (owner) =>
    jget(`/sets/voice-encourage?owner=${encodeURIComponent(owner)}`),
  markEncouragementRead: (owner) =>
    jpost('/sets/voice-encourage/read', { owner }),
};

// Record-blob → chunk upload (shared set-voice store) → create a VOICE comment
// on a recording. Mirrors uploadUserVerseVoice but writes a comment doc.
export async function uploadVoiceComment({ email, name, setId, reference, targetOwnerId, blob, mime, dur }) {
  const base64 = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  const CHUNK = 100000;
  const total = Math.ceil(base64.length / CHUNK);
  if (total > 120) throw new Error('Recording too long — keep it under 25 minutes.');
  const voiceId = 'v_' + Math.random().toString(36).slice(2, 12);
  for (let i = 0; i < total; i++) {
    await setVoiceApi.uploadChunk(email, setId, voiceId, i, total, base64.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  const res = await jpost('/sets/voice-comment/create', {
    email, name, setId, reference, targetOwnerId,
    type: 'voice', voiceId, voiceMime: mime, voiceDur: dur,
  });
  return res.comment;
}
