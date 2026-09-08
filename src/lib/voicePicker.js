// Pure helpers for the TTS voice picker.
//
// Two bugs this fixes (reported on Android, where the OS exposes several voices
// that share the same display name):
//   1. The list showed duplicate entries ("Chinese Hong Kong" twice) because we
//      keyed/labelled options by name (or name__lang), which isn't unique.
//   2. Selecting a different same-named voice didn't change the sound, because
//      voice lookup matched by name and always returned the FIRST match.
//
// Fix: identify each voice by its stable per-voice `voiceURI` (unique per voice
// object), dedupe by it, and match by it. We keep name__lang as a fallback for
// backward compatibility with previously-saved selections.

// Stable identity for a voice. Prefer voiceURI (unique); fall back to name__lang.
export function voiceId(v) {
  if (!v) return '';
  if (v.voiceURI) return `uri:${v.voiceURI}`;
  return `nl:${v.name || ''}__${v.lang || ''}`;
}

// Does a saved key refer to this voice? Accepts both the new voiceId form and
// the legacy `name__lang` form so old saved selections keep working.
export function voiceMatchesSavedKey(v, savedKey) {
  if (!v || !savedKey) return false;
  if (voiceId(v) === savedKey) return true;
  // Legacy: saved as "name__lang" (no prefix).
  if (savedKey === `${v.name || ''}__${v.lang || ''}`) return true;
  return false;
}

// Deduplicate a voice list by stable identity, preserving order. Some platforms
// list the exact same voice twice; this collapses them.
export function dedupeVoices(voices) {
  const seen = new Set();
  const out = [];
  for (const v of voices || []) {
    const id = voiceId(v);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(v);
  }
  return out;
}

// Build display options for a deduped list. When two DISTINCT voices still share
// the same display name (different voiceURI but identical name), disambiguate by
// appending a short suffix derived from the locale / uri tail so the user can
// tell them apart and pick reliably.
export function buildVoiceOptions(voices, { cloudLabel = '' } = {}) {
  const deduped = dedupeVoices(voices);
  const nameCounts = {};
  for (const v of deduped) nameCounts[v.name] = (nameCounts[v.name] || 0) + 1;
  const usedLabels = {};

  return deduped.map((v) => {
    let label = v.name || '(unnamed)';
    if (nameCounts[v.name] > 1) {
      // Disambiguate same-named distinct voices.
      const tail = (v.lang || '') ||
        (v.voiceURI ? v.voiceURI.split(/[.\/]/).pop() : '');
      if (tail) label = `${label} (${tail})`;
      // If even that collides, add a counter.
      if (usedLabels[label]) {
        usedLabels[label] += 1;
        label = `${label} #${usedLabels[label]}`;
      } else {
        usedLabels[label] = 1;
      }
    }
    if (cloudLabel && v.localService === false) label = `${label} ${cloudLabel}`;
    return { id: voiceId(v), label, voice: v };
  });
}
