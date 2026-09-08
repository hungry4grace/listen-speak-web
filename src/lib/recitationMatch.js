// Recitation matching — judges whether a spoken transcript matches a known
// target phrase. The key insight: the system ALWAYS knows the expected answer,
// so scoring exploits it aggressively instead of hoping the ASR transcript
// matches the target's surface form:
//
//   zh  (zh-TW / zh-CN): every target char accepts ALL of its readings
//        (pinyin-pro `polyphonic` — 行 passes as xing/hang/heng regardless of
//        how the recognizer segmented the heard sentence), readings are folded
//        through fuzzy-pinyin equivalence classes (zh=z, sh=s, n=l=r, ang=an…)
//        to tolerate accents, both sides are folded traditional→simplified
//        (opencc-js) so recognizer script choice never matters, and Arabic
//        digit runs are expanded to 中文數字 ("40" ↔ 四十).
//   word (en/es/de/tr/vi/id/ms): whitespace tokens, case/punctuation
//        insensitive, digits expanded to English words, Levenshtein ≤ 1 for
//        tokens of length ≥ 5 (savior/saviour, ASR near-misses).
//   char (ja/ko/he/fa/ar/my): script-preserving char match. \p{M} stripping
//        also removes Hebrew niqqud / Arabic harakat, so pointed Bible text
//        matches the recognizer's unpointed output.
//
// Alignment is a proper LCS dynamic program (order-preserving, insertions in
// the heard text are free — "嗯 那個" prefixes and continuous-mode leftovers
// never hurt), replacing the old greedy subsequence which could mis-consume.
// Score = matched/target (recall), same semantics the game always had.
//
// Pure logic, no React. Tests: node --test src/lib/recitationMatch.test.mjs

import { pinyin, polyphonic } from 'pinyin-pro';
import * as OpenCC from 'opencc-js';

// Raised from the old 60: that threshold compensated for massive false
// negatives (wrong recognizer lang, single-reading pinyin, no t2s folding).
// With pronunciation-set matching a correct recitation scores 90–100 even
// with a heavy accent, so 70 restores precision while still tolerating one
// dropped syllable in a 4-unit phrase (3/4 = 75).
export const PASS_THRESHOLD = 70;

export function matchKindForLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (/^(en|es|de|tr|vi|id|ms)/.test(l)) return 'word';
  return 'char';
}

// ── Fuzzy pinyin equivalence ─────────────────────────────────────────────
// Ordered folds; both target readings and heard readings pass through the
// same function, giving symmetric equivalence classes. Tone is already
// discarded upstream (toneType:'none').
export function fuzzyKey(py) {
  let s = String(py || '').toLowerCase();
  s = s.replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's'); // retroflex/dental
  s = s.replace(/^r/, 'l');       // r/l — 熱/樂 (aggressive; remove if false positives)
  s = s.replace(/^l/, 'n');       // l/n — 樂/怒 southern accents
  s = s.replace(/^f/, 'h');       // f/h — 福/湖 (aggressive; remove if false positives)
  s = s.replace(/v/g, 'u');       // ü spelled v by pinyin-pro's v:true
  s = s.replace(/ang$/, 'an').replace(/eng$/, 'en').replace(/ing$/, 'in'); // nasals (iang/uang covered as suffixes)
  return s;
}

// ── Digit expansion ──────────────────────────────────────────────────────
const ZH_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function zhNum(n) {
  if (n === 0) return '零';
  let s = '';
  const th = Math.floor(n / 1000); n %= 1000;
  const hu = Math.floor(n / 100); n %= 100;
  const te = Math.floor(n / 10);
  const on = n % 10;
  if (th) s += ZH_DIGIT[th] + '千';
  if (hu) s += ZH_DIGIT[hu] + '百';
  else if (th && (te || on)) s += '零';
  if (te) s += (te === 1 && !th && !hu ? '' : ZH_DIGIT[te]) + '十'; // 10-19 → 十X
  else if (hu && on) s += '零';
  if (on) s += ZH_DIGIT[on];
  return s;
}

export function zhDigitsToWords(str) {
  return String(str).replace(/[0-9]+/g, (run) => {
    const n = parseInt(run, 10);
    return n <= 9999 ? zhNum(n) : run;
  });
}

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enNum(n) {
  if (n < 20) return EN_ONES[n];
  if (n < 100) return EN_TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + EN_ONES[n % 10] : '');
  if (n < 1000) return EN_ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + enNum(n % 100) : '');
  return EN_ONES[Math.floor(n / 1000)] + ' thousand' + (n % 1000 ? ' ' + enNum(n % 1000) : '');
}

export function enDigitsToWords(str) {
  return String(str).replace(/[0-9]+/g, (run) => {
    const n = parseInt(run, 10);
    return n <= 9999 ? enNum(n) : run;
  });
}

// ── Traditional → simplified folding (per char, keeps indices 1:1) ───────
let t2sConverter = null;
const t2sCache = new Map();
function foldT2S(ch) {
  let out = t2sCache.get(ch);
  if (out !== undefined) return out;
  if (!t2sConverter) t2sConverter = OpenCC.Converter({ from: 't', to: 'cn' });
  const conv = t2sConverter(ch);
  out = conv.length === 1 ? conv : ch; // rare multi-char conversions: keep original
  if (t2sCache.size > 4000) t2sCache.clear();
  t2sCache.set(ch, out);
  return out;
}

// ── Normalization ────────────────────────────────────────────────────────
// Strips punctuation/symbols/spaces/controls/marks but KEEPS every script
// (the old /[^\w一-龥]/ deleted Korean/kana/Hebrew targets outright, making
// those languages unwinnable). Returns units with rawEnd = index in the raw
// string of the unit's last source char, so consumed-length is exact.
const STRIP_RE = /[\p{P}\p{S}\p{Z}\p{C}\p{M}]/u;
const HAN_RE = /\p{Script=Han}/u;

function normalizeUnits(raw, kind) {
  const chars = Array.from(String(raw));
  const units = [];
  if (kind === 'word') {
    let token = '';
    let end = 0;
    const flush = () => {
      if (!token) return;
      // Expand digit tokens to English words ("40" → "forty"), possibly
      // multiple tokens; all inherit the source run's end index.
      for (const w of enDigitsToWords(token).split(' ')) {
        if (w) units.push({ ch: w, rawEnd: end });
      }
      token = '';
    };
    let idx = 0;
    for (const c of chars) {
      if (STRIP_RE.test(c)) { flush(); } else { token += c.toLowerCase(); end = idx + c.length - 1; }
      idx += c.length; // index in UTF-16 units, matching substring() in callers
    }
    flush();
    return units;
  }
  // zh / char kinds: one unit per char.
  let idx = 0;
  let digitRun = '';
  let digitEnd = 0;
  const flushDigits = () => {
    if (!digitRun) return;
    if (kind === 'zh') {
      for (const zc of zhDigitsToWords(digitRun)) units.push({ ch: zc, rawEnd: digitEnd });
    } else {
      for (const dc of digitRun) units.push({ ch: dc, rawEnd: digitEnd });
    }
    digitRun = '';
  };
  for (const c of chars) {
    if (kind === 'zh' && c >= '0' && c <= '9') {
      digitRun += c;
      digitEnd = idx + c.length - 1;
      idx += c.length;
      continue;
    }
    flushDigits();
    if (!STRIP_RE.test(c)) {
      const low = c.toLowerCase();
      units.push({ ch: kind === 'zh' ? foldT2S(low) : low, rawEnd: idx + c.length - 1 });
    }
    idx += c.length;
  }
  flushDigits();
  return units;
}

// Contextual per-char readings for a heard char array (zh). One pinyin() call
// over the joined string; defensive per-char fallback if alignment drifts.
function heardKeysFor(charList) {
  const joined = charList.join('');
  let readings = pinyin(joined, { toneType: 'none', type: 'array', v: true });
  if (readings.length !== charList.length) {
    readings = charList.map((c) => {
      const r = pinyin(c, { toneType: 'none', type: 'array', v: true });
      return (r && r[0]) || c;
    });
  }
  return readings.map(fuzzyKey);
}

// ── Target preparation (memoized) ────────────────────────────────────────
const targetCache = new Map();
const TARGET_CACHE_MAX = 200;

export function prepareTarget(targetText, lang) {
  const key = `${lang}|${targetText}`;
  const hit = targetCache.get(key);
  if (hit) return hit;
  const kind = matchKindForLang(lang);
  const units = normalizeUnits(targetText, kind);
  let prepared;
  if (kind === 'zh') {
    // Every valid reading of every char, fuzzy-folded — the 多音字 fix.
    // (pinyin-pro's contextual pick is itself unreliable: 銀行 → "yin xing".)
    for (const u of units) {
      let keys;
      if (HAN_RE.test(u.ch)) {
        const poly = polyphonic(u.ch, { toneType: 'none', type: 'array', v: true });
        keys = new Set(((poly && poly[0]) || [u.ch]).map(fuzzyKey));
      } else {
        keys = new Set([fuzzyKey(u.ch)]);
      }
      u.keys = keys;
    }
    prepared = { kind, units, folded: units.map((u) => u.ch).join('') };
  } else {
    prepared = { kind, units, folded: units.map((u) => u.ch).join(kind === 'word' ? ' ' : '') };
  }
  if (targetCache.size >= TARGET_CACHE_MAX) {
    targetCache.delete(targetCache.keys().next().value); // FIFO evict
  }
  targetCache.set(key, prepared);
  return prepared;
}

// ── Scoring ──────────────────────────────────────────────────────────────
function lev1(a, b) { // is edit distance ≤ 1?
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) { i++; } else { j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

const HEARD_UNIT_CAP = 120; // bound DP cost if a transcript slice runs long

export function scoreRecitation(prepared, heardRaw) {
  const { kind, units: target } = prepared;
  const m = target.length;
  if (m === 0) return { score: 0, pass: false, consumedRawLength: 0 };
  let heard = normalizeUnits(heardRaw, kind);
  if (heard.length > HEARD_UNIT_CAP) heard = heard.slice(heard.length - HEARD_UNIT_CAP);
  const n = heard.length;
  if (n === 0) return { score: 0, pass: false, consumedRawLength: 0 };

  // Fast path (zh/char): folded heard contains folded target contiguously.
  if (kind !== 'word') {
    const heardFolded = heard.map((u) => u.ch).join('');
    const at = heardFolded.indexOf(prepared.folded);
    if (at !== -1) {
      const endUnit = heard[at + prepared.folded.length - 1];
      return { score: 100, pass: true, consumedRawLength: endUnit.rawEnd + 1 };
    }
  }

  let heardKeys = null;
  if (kind === 'zh') heardKeys = heardKeysFor(heard.map((u) => u.ch));

  const match = (i, j) => {
    const tu = target[i];
    const hu = heard[j];
    if (tu.ch === hu.ch) return true;
    if (kind === 'zh') return tu.keys.has(heardKeys[j]);
    if (kind === 'word') return tu.ch.length >= 5 && hu.ch.length >= 5 && lev1(tu.ch, hu.ch);
    return false;
  };

  // LCS DP: dp[i][j] = best match count of target[0..i) vs heard[0..j).
  const width = n + 1;
  let prev = new Array(width).fill(0);
  let curr = new Array(width).fill(0);
  const lastRow = [];
  for (let i = 1; i <= m; i++) {
    curr[0] = 0;
    for (let j = 1; j <= n; j++) {
      const diag = prev[j - 1] + (match(i - 1, j - 1) ? 1 : 0);
      curr[j] = Math.max(prev[j], curr[j - 1], diag);
    }
    [prev, curr] = [curr, prev];
  }
  for (let j = 0; j <= n; j++) lastRow[j] = prev[j];

  const best = lastRow[n];
  const score = Math.round((best / m) * 100);
  const pass = score >= PASS_THRESHOLD;
  let consumedRawLength = 0;
  if (pass) {
    let jStar = n;
    for (let j = 0; j <= n; j++) { // minimal j reaching the max → trailing junk unconsumed
      if (lastRow[j] === best) { jStar = j; break; }
    }
    consumedRawLength = jStar > 0 ? heard[jStar - 1].rawEnd + 1 : 0;
  }
  return { score, pass, consumedRawLength };
}

// Score several candidate transcripts (SpeechRecognition alternatives) and
// return the best; earliest index wins ties so the primary transcript (index
// 0, the only one with consumed-length bookkeeping) is preferred.
export function scoreBestCandidate(prepared, heardCandidates) {
  let best = { score: 0, pass: false, consumedRawLength: 0, candidateIndex: 0 };
  for (let i = 0; i < heardCandidates.length; i++) {
    const r = scoreRecitation(prepared, heardCandidates[i] || '');
    if (r.score > best.score) best = { ...r, candidateIndex: i };
    if (best.score === 100) break;
  }
  return best;
}
