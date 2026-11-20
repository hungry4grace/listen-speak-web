// Read-along timing: which character (or word) is being read right now?
//
// The player knows when each PHRASE starts and ends (recordings: voiceAlign
// units; computer voice: utterance start/end). Inside a phrase there is no
// finer timing, so it is modelled: every unit gets a weight (how long it takes
// to say) and time is spread over the weights.
//   - recording: fraction of the phrase's voiced time → unit
//   - computer voice: a pace estimate, re-anchored by the engine's `boundary`
//     events where the device fires them
// The unit is one CHARACTER for Chinese and Japanese (no word spaces) and one
// WORD for scripts written with spaces (English, Hebrew, Korean, Arabic, …) —
// see unitModeOf.
// Pure functions only; the DOM side is readAlongDom.js.
// Tests: node --test src/lib/readAlong.test.mjs
//
// The character half of this file is shared with creativechinese-web.

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
// Japanese: hiragana and katakana letters. The small ones (きゃ, ファ) belong
// to the mora before them, so they are never pointed at on their own.
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/;
const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/;
const LONG_PAUSE = /[。！？!?…；;]/;
const SHORT_PAUSE = /[，、：:,]/;

export function isCjkChar(ch) { return CJK.test(ch || ''); }

// Weight and "can be pointed at" for one character of a phrase written
// without word spaces. `ja` = the phrase has kana: a kanji then stands for
// one to three morae (地 chi, 神 kami, 光 hikari) — 1.7 on average in Bible
// text — against one per kana.
function charUnit(ch, ja, pauseWeights) {
  if (CJK.test(ch)) return { w: ja ? 1.7 : 1, hl: true };
  if (ja && SMALL_KANA.test(ch)) return { w: 0.2, hl: false };
  if (ja && KANA.test(ch)) return { w: 1, hl: true };
  if (ja && ch === 'ー') return { w: 1, hl: false };
  if (/[0-9０-９]/.test(ch)) return { w: 1.2, hl: false };
  if (/[A-Za-z]/.test(ch)) return { w: 0.3, hl: false };
  if (pauseWeights && LONG_PAUSE.test(ch)) return { w: 1.2, hl: false };
  if (pauseWeights && SHORT_PAUSE.test(ch)) return { w: 0.6, hl: false };
  return { w: 0, hl: false };
}

// One slot per code point of `text` (same indexing as annotate.js tokens and
// Annotated's data-ci). `hl` marks characters that can be highlighted (Chinese
// characters, and kana in Japanese); punctuation carries pause weight, Latin
// letters and digits carry time but are never highlighted. `u16` is the
// UTF-16 offset (what the speech engine's boundary event reports).
export function charSlots(text, { pauseWeights = true } = {}) {
  const str = String(text || '');
  const ja = KANA.test(str);
  const slots = [];
  let u16 = 0;
  let acc = 0;
  let ci = 0;
  for (const ch of str) {
    const { w, hl } = charUnit(ch, ja, pauseWeights);
    slots.push({ ci, u16, w, hl, acc });
    acc += w;
    u16 += ch.length;
    ci += 1;
  }
  return { slots, total: acc };
}

// ── Words (scripts written with spaces) ─────────────────────────────────────

// 'char' when the text has Chinese characters or kana, otherwise 'word'.
export function unitModeOf(text) {
  const s = String(text || '');
  return CJK.test(s) || KANA.test(s) ? 'char' : 'word';
}

// A word: letters, digits and the marks riding on them (Hebrew points and
// cantillation, Arabic vowel signs, Devanagari vowel signs, accents), with
// apostrophes / hyphens allowed INSIDE (God's, well-being) and the zero-width
// joiners Persian and Hindi put inside a word (می‌خواهم). Punctuation around
// it is not part of the word. The Hebrew maqqef (־) is punctuation, so
// כָּל־הָאָרֶץ is two words — as it is read.
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:(?:['’-]|\u200c|\u200d)[\p{L}\p{N}\p{M}]+)*/gu;
// ׃ sof pasuq · ؛ ؟ ۔ Arabic / Persian · । ॥ Hindi danda
const WORD_LONG_PAUSE = /[.!?;…。！？；\u05C3\u061B\u061F\u06D4\u0964\u0965]/;
// ׀ paseq · ، Arabic comma
const WORD_SHORT_PAUSE = /[,:，、：—–\u05C0\u060C]/;

// [{ start, end, text }] — UTF-16 offsets of every word in `text`.
export function wordSpans(text) {
  const s = String(text || '');
  const out = [];
  for (const m of s.matchAll(WORD_RE)) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  return out;
}

// Letters that don't decompose into a plain a–z letter plus an accent.
const LATIN_FOLD = { 'ı': 'i', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'đ': 'd', 'ł': 'l' };
const count = (str, re) => (str.match(re) || []).length;

// Syllables of a word in Latin letters. Vowel groups, with the silent endings
// of English (love, called) and French (père, portes). Elsewhere y is a
// consonant (Spanish yo, Turkish yol, Indonesian yang).
function latinSyllables(word, lang) {
  const s = word.toLowerCase().replace(/[ıøæœßđł]/g, (c) => LATIN_FOLD[c]).normalize('NFD').replace(/[^a-z]/g, '');
  if (!s) return 0;
  // Vietnamese writes every syllable as its own word.
  if (lang === 'vi') return 1;
  const en = lang === 'en';
  const fr = lang === 'fr';
  let n = count(s, en || fr ? /[aeiouy]+/g : /[aeiou]+/g);
  if (en && n > 1 && /[^aeiouyl]e$/.test(s)) n -= 1;                 // love, grace
  if (en && n > 1 && /[^aeiouytd]ed$/.test(s)) n -= 1;               // loved, called
  if (fr && n > 1 && /[^aeiouy]es?$/.test(s)) n -= 1;                // père, portes
  return Math.max(1, n);
}

// How long a word takes to say, in syllables (roughly — what matters is that
// a long word gets more of the phrase's time than a short one). `lang` is the
// speech locale ('en-US', 'fr', …); without it Latin words are read as English.
export function wordWeight(word, lang = 'en') {
  const w = String(word || '');
  const l = String(lang || 'en').slice(0, 2).toLowerCase();
  // Hebrew: counted from the consonants, because the text comes both pointed
  // and unpointed. בְּרֵאשִׁית (6 letters) is 3 syllables, אֵת (2) is 1.
  const he = count(w, /[\u05D0-\u05EA]/g);
  if (he) return Math.max(1, he * 0.6);
  // Korean: one Hangul block is one syllable.
  const ko = count(w, /[\uAC00-\uD7A3]/g);
  if (ko) return ko;
  // Arabic script: with vowel signs (the Arabic Bible is fully marked) every
  // short vowel is a syllable; without them (Persian) about one per two letters.
  const ar = count(w, /[\u0621-\u064A\u066E-\u06D3\u06FA-\u06FC]/g);
  if (ar) return count(w, /[\u064B-\u0650]/g) || Math.max(1, ar * 0.5);
  // Cyrillic: a syllable per vowel.
  if (/[\u0400-\u04FF]/.test(w)) return Math.max(1, count(w.toLowerCase(), /[аеёиоуыэюяіїєў]/g));
  // Devanagari: a syllable per consonant or independent vowel, less the
  // consonants a virama joins to the next one (क्या is one).
  const dev = count(w, /[\u0904-\u0939\u0958-\u0961]/g);
  if (dev) return Math.max(1, dev - count(w, /\u094D/g));
  const latin = latinSyllables(w, l);
  const digits = count(w, /\p{Nd}/gu);
  if (latin || digits) return latin + digits * 1.2;
  return Math.max(1, count(w, /\p{L}/gu) / 2.5);
}

// Same model shape as charSlots, with one highlightable slot per WORD (its
// `ci` is the word's ordinal — Annotated's data-ci in word mode) and a
// non-highlightable slot for the pause after a word that ends a clause.
export function wordSlots(text, { pauseWeights = true, lang = 'en' } = {}) {
  const s = String(text || '');
  const words = wordSpans(s);
  const slots = [];
  let acc = 0;
  words.forEach((wd, k) => {
    const w = wordWeight(wd.text, lang);
    slots.push({ ci: k, u16: wd.start, u16End: wd.end, w, hl: true, acc });
    acc += w;
    const gap = s.slice(wd.end, k + 1 < words.length ? words[k + 1].start : s.length);
    const pause = !pauseWeights ? 0 : WORD_LONG_PAUSE.test(gap) ? 1.2 : WORD_SHORT_PAUSE.test(gap) ? 0.6 : 0;
    if (pause) { slots.push({ ci: -1, u16: wd.end, w: pause, hl: false, acc }); acc += pause; }
  });
  return { slots, total: acc };
}

// The timing model for a phrase in whichever unit suits its script.
export function readSlots(text, opts) {
  const mode = unitModeOf(text);
  return { ...(mode === 'char' ? charSlots(text, opts) : wordSlots(text, opts)), mode };
}

// `text` cut into the pieces the screen wraps: [{ text, ci }] where ci is the
// unit's index (the same index readSlots uses) or null for the text in
// between — punctuation, spaces, and Latin text inside a Chinese phrase.
export function unitSegments(text) {
  const s = String(text || '');
  const out = [];
  const plain = (t) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.ci === null) last.text += t; else out.push({ text: t, ci: null });
  };
  if (unitModeOf(s) === 'char') {
    const ja = KANA.test(s);
    let ci = 0;
    for (const ch of s) {
      if (charUnit(ch, ja, false).hl) out.push({ text: ch, ci }); else plain(ch);
      ci += 1;
    }
    return out;
  }
  let at = 0;
  wordSpans(s).forEach((wd, k) => {
    plain(s.slice(at, wd.start));
    out.push({ text: wd.text, ci: k });
    at = wd.end;
  });
  plain(s.slice(at));
  return out;
}

// The speech engine reports boundaries as offsets into the SPOKEN string,
// which is not always the displayed one: Hebrew reads the divine name יהוה as
// אֲדֹנָי, a word of a different length. Words still pair up one to one, so
// the offset is turned into a word ordinal and looked up in the model.
// Returns u16 → weight already spoken, or null when the two strings don't
// have the same number of words (then boundaries can't be trusted; the pace
// estimate carries the phrase alone).
export function spokenWeightMapper(model, spokenText) {
  const units = model.slots.filter((x) => x.hl);
  const spoken = wordSpans(spokenText);
  if (!units.length || spoken.length !== units.length) return null;
  return (u16) => {
    for (let k = 0; k < spoken.length; k++) if (spoken[k].start >= u16) return units[k].acc;
    return model.total;
  };
}

// Index (ci) of the highlightable unit being read when `w` weight units of
// the phrase have gone by. During a pause or a Latin word it stays on the
// last unit read; before the first one it is the first. -1 if the phrase has
// nothing to highlight.
export function indexAtWeight(model, w) {
  let last = -1;
  let first = -1;
  for (const s of model.slots) {
    if (!s.hl) continue;
    if (first < 0) first = s.ci;
    if (s.acc <= w) last = s.ci; else break;
  }
  return last >= 0 ? last : first;
}
export function indexAtFraction(model, f) {
  const frac = Math.max(0, Math.min(1, Number.isFinite(f) ? f : 0));
  // Just under the total so f = 1 lands on the last unit, not past it.
  return indexAtWeight(model, Math.min(frac * model.total, model.total - 1e-6));
}
// Weight already spoken when the engine reports a boundary at UTF-16 offset u16.
export function weightAtUtf16(model, u16) {
  let w = model.total;
  for (const s of model.slots) { if (s.u16 >= u16) { w = s.acc; break; } }
  return w;
}

// Fraction of a unit's VOICED time gone by at time t: the measured pauses
// inside [start, end] don't count, so the pointer waits through them instead
// of drifting ahead. pauses = [[s, e], …] in seconds (voiceAnalysis).
export function voicedFraction(t, start, end, pauses = null) {
  if (!(end > start)) return t >= end ? 1 : 0;
  const clamp = (x) => Math.max(start, Math.min(end, x));
  let silentTotal = 0;
  let silentBefore = 0;
  for (const p of pauses || []) {
    const s = clamp(p[0]);
    const e = clamp(p[1]);
    if (e <= s) continue;
    silentTotal += e - s;
    silentBefore += Math.max(0, Math.min(e, clamp(t)) - s);
  }
  const voiced = (end - start) - silentTotal;
  if (voiced <= 0.05) return Math.max(0, Math.min(1, (t - start) / (end - start)));
  return Math.max(0, Math.min(1, ((clamp(t) - start) - silentBefore) / voiced));
}

// Speaking pace of the computer voice, learned from the phrases already read.
//
// What we can time is start-event → end-event, and that is NOT n × per-unit:
// engines add a fixed overhead (start-up latency plus trailing silence —
// 0.2 to 0.6 s between the events on Apple voices). Dividing the whole duration by the unit count
// therefore reads slow — badly so for short phrases — and the pointer lags.
// So the model is   duration = overhead + unitMs × units / rate   and both
// numbers are fitted: a straight-line fit once enough phrases of clearly
// different lengths have been seen, before that the overhead prior is
// subtracted. How fast a phrase is spoken also depends on its words, so one
// phrase is weak evidence: the estimate moves a third of the way each time.
// `store` ({ get(), set(obj) }) remembers the fit between sessions.
export function createPace({ unitMs = 225, overheadMs = 450, min = 120, max = 420, store = null } = {}) {
  let b = unitMs;      // ms per weight unit at rate 1
  let a = overheadMs;  // ms of per-utterance overhead
  try {
    const saved = store?.get?.();
    if (saved && saved.b >= min && saved.b <= max && saved.a >= 0 && saved.a <= 900) { b = saved.b; a = saved.a; }
  } catch { /* noop */ }
  const seen = []; // { x: units / rate, y: ms }, most recent last
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    msPerUnit: (rate = 1) => b / Math.max(0.3, rate || 1),
    observe({ units, ms: took, rate = 1 }) {
      if (!(units >= 2) || !(took > 0)) return;
      seen.push({ x: units / Math.max(0.3, rate || 1), y: took });
      if (seen.length > 12) seen.shift();
      const n = seen.length;
      const mx = seen.reduce((t, p) => t + p.x, 0) / n;
      const my = seen.reduce((t, p) => t + p.y, 0) / n;
      const xs = seen.map((p) => p.x);
      let fitB = null;
      if (n >= 6 && Math.max(...xs) - Math.min(...xs) >= 4) {
        const sxx = seen.reduce((t, p) => t + (p.x - mx) ** 2, 0);
        const sxy = seen.reduce((t, p) => t + (p.x - mx) * (p.y - my), 0);
        const slope = sxy / sxx;
        const intercept = my - slope * mx;
        // Trust the fit only when it is physically sensible.
        if (slope >= min && slope <= max && intercept >= 0 && intercept <= 900) { fitB = slope; a = intercept; }
      }
      const target = fitB ?? clamp((my - a) / mx, min, max);
      b = b * 0.7 + target * 0.3;
      try { store?.set?.({ b: Math.round(b), a: Math.round(a) }); } catch { /* noop */ }
    },
    get value() { return b; },
    get overhead() { return a; },
  };
}

// Follows one utterance. start(t) when it begins; boundary(t, u16) whenever
// the engine reports a word boundary; indexAt(t) → ci.
//
// Position comes from the pace estimate. Boundary events only CORRECT it, and
// only while they agree with it: engines differ wildly in what they report.
// Chromium fires every boundary of the utterance in the first 100 ms; iOS
// reports them as the audio is synthesised, ahead of when it is heard. Taken
// at face value either one throws the pointer to the end of the phrase, where
// it then sits while the voice catches up. So a boundary is used only when it
// lands near where the estimate already is (within `tolerance` of the weight,
// plus one unit); two that don't, or two different positions in the same
// instant, and this utterance ignores boundaries altogether.
// `leadMs` runs the pointer that much ahead of the estimate: the mark is drawn
// a timer tick late and the hand then slides to it, and a pointer that arrives
// just before the sound is easier to follow than one that trails it.
// `toWeight` (u16 → weight) replaces the plain offset lookup when the spoken
// string differs from the displayed one (spokenWeightMapper).
export function createTtsFollower(model, { msPerUnit = 270, lookahead = 3, leadMs = 0, tolerance = 0.35, toWeight = null } = {}) {
  let began = null;   // when the utterance started
  let t0 = null;      // current anchor: weight w0 was reached at time t0
  let w0 = 0;
  let anchored = false;
  let unreliable = false;
  let lastT = -Infinity;
  let lastW = -1;
  let misses = 0;
  const stats = { boundaries: 0, used: 0, distrusted: false, first: [] };
  const distrust = () => { unreliable = true; anchored = false; t0 = began; w0 = 0; stats.distrusted = true; };
  return {
    stats,
    start(t) { if (t0 === null) { began = t; t0 = t; w0 = 0; } },
    boundary(t, u16) {
      if (t0 === null) this.start(t);
      const w = toWeight ? toWeight(u16) : weightAtUtf16(model, u16);
      stats.boundaries += 1;
      if (stats.first.length < 8) stats.first.push(`${u16}@${Math.round(t - began)}`);
      if (unreliable) return;
      if (w > lastW && lastW >= 0 && t - lastT < 30) { distrust(); return; } // a burst
      lastT = t; lastW = w;
      if (w === 0) return; // "starting now": the start event already said so
      const expected = (t - began) / msPerUnit; // where the plain estimate is
      if (Math.abs(w - expected) > expected * tolerance + 1) {
        misses += 1;
        if (misses >= 2) distrust();
        return;
      }
      if (w < w0) return; // a repeat of an earlier boundary
      t0 = t; w0 = w; anchored = true; stats.used += 1;
    },
    weightAt(t) {
      if (t0 === null) return 0;
      let w = w0 + Math.max(0, t + leadMs - t0) / msPerUnit;
      if (anchored) w = Math.min(w, w0 + lookahead);
      return Math.min(w, model.total);
    },
    indexAt(t) { return indexAtWeight(model, Math.min(this.weightAt(t), model.total - 1e-6)); },
  };
}
