// Align a reading to its text without speech recognition: the reader's pauses
// (voiceAnalysis.js in the browser, ffmpeg silencedetect in scripts/) are
// matched to the text's natural breaks — phrase ends, weighted by how long
// each piece should take to say (syllables). Pure functions, shared by the
// listen player and scripts/verse-short.

// Rough syllable count: Latin words by vowel groups, CJK / kana / Hangul one
// per character. Only the ratios matter.
export function syllables(text) {
  const s = String(text || '');
  let n = 0;
  for (const w of s.match(/[A-Za-zÀ-ÿ']+/g) || []) {
    const groups = (w.toLowerCase().match(/[aeiouy]+/g) || []).length;
    const silentE = /[^aeiou]e$/i.test(w) && groups > 1 ? 1 : 0;
    n += Math.max(1, groups - silentE);
  }
  n += (s.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
  // A number is said as words: "23" → twenty-three.
  for (const d of s.match(/\d+/g) || []) n += Math.ceil(d.length * 1.6);
  return Math.max(1, n);
}

// Silences → pauses inside [from, to] (ignoring the edges) and the voiced
// region (first sound → last sound).
export function speechRegion(silences, duration) {
  let start = 0;
  let end = duration;
  for (const s of silences) {
    if (s.start <= 0.05 && s.end > start) start = s.end;
    if (s.end >= duration - 0.05 && s.start < end) end = s.start;
  }
  return { start, end: Math.max(start, end) };
}
export function pausesWithin(silences, from, to, minLen = 0) {
  return silences
    .filter(s => s.start > from + 0.05 && s.end < to - 0.05 && s.end - s.start >= minLen)
    .map(s => ({ start: s.start, end: s.end, len: s.end - s.start }));
}

// Split [from, to] into weights.length pieces at the reader's pauses.
// Each piece should last about its share of the speech (weights × the
// reader's average pace, pauses left out); what is scored is each piece's own
// length against that — not where it falls overall — so a reader who speeds
// up or slows down along the way doesn't push everything after off by one.
// Every boundary sits on a pause (long ones earn a bonus, scaled by
// strengths[j] — a full stop expects a pause, a comma maybe not), or, where
// the reader ran straight on, inside a stretch shared by up to `maxJoin`
// pieces (missPenalty each), split by weight.
// Returns { units: [{ start, end, onPause }], cost }.
export function alignUnits({ from, to, weights, pauses, strengths, pauseBonus = 2.5, missPenalty = 6, maxJoin = 6, spread = 0.4 }) {
  const k = weights.length;
  if (k === 0) return { units: [], cost: 0 };
  if (k === 1) return { units: [{ start: from, end: to, onPause: false }], cost: 0 };
  const P = pauses.filter(p => p.start > from && p.end < to).sort((a, b) => a.start - b.start);
  const m = P.length;
  // Voiced time from `from` up to the start of pause i (or the end).
  const cum = [0];
  for (let i = 0; i < m; i += 1) cum.push(cum[i] + (P[i].start - (i ? P[i - 1].end : from)));
  const voicedTotal = Math.max(0.01, cum[m] + (to - (m ? P[m - 1].end : from)));
  const vAt = (i) => (i === m ? voicedTotal : cum[i + 1]); // voiced time at the start of pause i / the end
  const vFrom = (i) => (i < 0 ? 0 : cum[i + 1]); // voiced time just after pause i (= at its start)
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const rate = voicedTotal / wSum;
  const prefW = [0];
  weights.forEach((x, i) => prefW.push(prefW[i] + x));
  const lenCost = (d, w) => {
    const e = Math.max(0.05, w * rate);
    const sd = spread + 0.5 / (e + 0.5);
    const z = Math.log(Math.max(0.02, d) / e) / sd;
    return 0.5 * z * z;
  };
  const bonus = (i, j) => pauseBonus * (strengths?.[j] ?? 1) * Math.min(P[i].len ?? (P[i].end - P[i].start), 1.5) / 1.5;
  // D[j][i]: pieces 0..j placed, piece j ends at pause i (i = m: at `to`).
  const D = Array.from({ length: k }, () => new Float64Array(m + 1).fill(Infinity));
  const B = Array.from({ length: k }, () => new Int32Array(m + 1).fill(-2));
  const R = Array.from({ length: k }, () => new Int8Array(m + 1));
  for (let j = 0; j < k; j += 1) {
    for (let i = 0; i <= m; i += 1) {
      if (j === k - 1 && i !== m) continue;
      if (j < k - 1 && i === m) continue;
      let best = Infinity;
      let arg = -2;
      let argR = 0;
      // Pieces j-r+1 … j share the stretch from pause i' to pause i.
      for (let r = 1; r <= Math.min(maxJoin, j + 1); r += 1) {
        const j0 = j - r + 1;
        const w = prefW[j + 1] - prefW[j0];
        const hiV = vAt(i);
        for (let ip = i - 1; ip >= (j0 === 0 ? -1 : 0); ip -= 1) {
          if (j0 === 0 && ip !== -1) continue;
          const d = hiV - vFrom(ip);
          if (d > w * rate * 6 + 3) break; // far too long; earlier pauses only longer
          const prev = j0 === 0 ? 0 : D[j0 - 1][ip];
          if (!Number.isFinite(prev)) continue;
          const c = prev + lenCost(d, w) + (r - 1) * missPenalty - (i < m ? bonus(i, j) : 0);
          if (c < best) { best = c; arg = ip; argR = r; }
          if (j0 === 0) break;
        }
      }
      D[j][i] = best;
      B[j][i] = arg;
      R[j][i] = argR;
    }
  }
  const cost = D[k - 1][m];
  if (!Number.isFinite(cost)) {
    // Can only happen with absurd input: fall back to pure proportions.
    const units = [];
    for (let j = 0; j < k; j += 1) units.push({ start: from + (to - from) * prefW[j] / wSum, end: from + (to - from) * prefW[j + 1] / wSum, onPause: j === k - 1 });
    return { units, cost: Infinity };
  }
  // Walk back; split shared stretches by weight (in voiced time).
  const realAt = (v) => {
    let t = from + v;
    for (const p of P) { if (p.start <= t) t += p.end - p.start; else break; }
    return t;
  };
  const units = new Array(k);
  let j = k - 1;
  let i = m;
  while (j >= 0) {
    const r = R[j][i];
    const ip = B[j][i];
    const j0 = j - r + 1;
    const v0 = vFrom(ip);
    const v1 = vAt(i);
    const w = prefW[j + 1] - prefW[j0];
    for (let q = j0; q <= j; q += 1) {
      const a = q === j0 ? (ip < 0 ? from : P[ip].end) : realAt(v0 + (v1 - v0) * (prefW[q] - prefW[j0]) / w);
      const e = q === j ? (i === m ? to : P[i].start) : realAt(v0 + (v1 - v0) * (prefW[q + 1] - prefW[j0]) / w);
      units[q] = { start: a, end: e, onPause: q === j };
    }
    j = j0 - 1;
    i = ip;
  }
  return { units, cost };
}

// Whole-chapter recording → one span per verse. Readers often announce the
// chapter first ("Song of Solomon, chapter 1"); try with and without such an
// intro and keep whichever fits the pauses better. `weights` (how long each
// piece should take, any unit) replaces the syllable count of `verses`;
// `introWeight` then sizes the intro in the same unit.
export function alignChapter({ silences, duration, verses, weights, introText = '', introWeight, minPause = 0.3 }) {
  const region = speechRegion(silences, duration);
  const pauses = pausesWithin(silences, region.start, region.end, minPause);
  const w = weights || verses.map(v => syllables(v));
  const plain = alignUnits({ from: region.start, to: region.end, weights: w, pauses, pauseBonus: 4 });
  let best = { ...plain, intro: null };
  const iw = introWeight ?? (introText ? syllables(introText) : 0);
  if (iw > 0) {
    const withIntro = alignUnits({ from: region.start, to: region.end, weights: [iw, ...w], pauses, pauseBonus: 4 });
    // The intro adds a boundary; compare per-boundary cost.
    if (withIntro.units.length && withIntro.cost / w.length < plain.cost / Math.max(1, w.length - 1) && withIntro.units[0].onPause) {
      best = { units: withIntro.units.slice(1), cost: withIntro.cost, intro: withIntro.units[0] };
    }
  }
  return { region, ...best };
}

// One verse → one span per phrase, using the finer pauses (`weights` as in alignChapter).
export function alignPhrases({ from, to, phrases, weights, silences, minPause = 0.12 }) {
  const pauses = pausesWithin(silences, from, to, minPause);
  return alignUnits({ from, to, weights: weights || phrases.map(p => syllables(p)), pauses, pauseBonus: 2, missPenalty: 3 }).units;
}

// Pages: consecutive phrases of one verse that fit maxLines lines. A page
// stays on screen until its last phrase has been read: it changes holdAfter
// seconds after that phrase ends, but never later than leadBefore seconds
// before the next phrase starts (and never before the phrase ends).
export function pageTimes(pages, { holdAfter = 0.3, leadBefore = 0.15, endAt } = {}) {
  return pages.map((pg, i) => {
    const last = pg.phrases[pg.phrases.length - 1];
    const next = pages[i + 1];
    const nextStart = next ? next.phrases[0].start : (endAt ?? last.end + 2);
    let change = Math.min(last.end + holdAfter, nextStart - leadBefore);
    change = Math.max(change, last.end + 0.05);
    return { ...pg, lastEnd: last.end, changeAt: change };
  }).map((pg, i, all) => ({ ...pg, showFrom: i === 0 ? (pg.showFrom ?? 0) : all[i - 1].changeAt, showTo: pg.changeAt }));
}

// ── The listen player ─────────────────────────────────────────────────────

const STRONG = /[.;:?!。；：？！؛…]/;
// Put the punctuation the splitter dropped back on each phrase by walking the
// original text: a phrase runs through the next letters/digits it names, plus
// any punctuation and closing quotes that follow.
export function phrasesWithPunctuation(text, phrases) {
  const src = String(text || '');
  const isWord = (ch) => /[\p{L}\p{N}]/u.test(ch);
  let pos = 0;
  const out = [];
  phrases.forEach((ph, i) => {
    const want = [...String(ph)].filter(isWord).map(c => c.toLowerCase());
    while (pos < src.length && /\s/.test(src[pos])) pos += 1;
    const begin = pos;
    let k = 0;
    while (pos < src.length && k < want.length) {
      if (isWord(src[pos])) { if (src[pos].toLowerCase() === want[k]) k += 1; else break; }
      pos += 1;
    }
    if (i === phrases.length - 1) pos = src.length;
    else while (pos < src.length && !isWord(src[pos]) && !/\s/.test(src[pos])) pos += 1;
    const piece = src.slice(begin, pos).trim();
    out.push(piece || String(ph));
  });
  return out;
}

// One value per boundary between phrases: 1 after a full stop / semicolon /
// colon / question mark (readers pause there), 0.6 after a comma or nothing.
export function boundaryStrengths(text, phrases) {
  const withPunct = phrasesWithPunctuation(text, phrases);
  return withPunct.slice(0, -1).map(p => (STRONG.test(p.replace(/[\s"'”’」』）)\]]+$/u, '').slice(-1)) ? 1 : 0.6));
}

function voicedLength(from, to, pauses) {
  let v = to - from;
  for (const p of pauses) if (p.start >= from && p.end <= to) v -= p.end - p.start;
  return Math.max(0.01, v);
}

// A recording (analysis: { dur, speech: [start, end], pauses: [[s, e], …] })
// + the phrases shown → { units: [{ start, end, onPause }], intro, cost }.
// The end of the speech anchors the last phrase; the start is open — the
// reader may first say the reference ("Psalm 23"), a heading, or nothing —
// so the text is tried starting at the speech start and after each of the
// first few pauses, and the best fit wins (an intro much longer than the
// spoken reference costs a little extra).
export function alignReading({ analysis, phrases, weights, strengths, introText = "", maxIntro = 8, missPenalty = 2, pauseBonus = 2, spread = 0.4 }) {
  const w = weights || phrases.map(p => syllables(p));
  const [s0, s1] = analysis.speech;
  const all = (analysis.pauses || []).map(([start, end]) => ({ start, end, len: end - start }))
    .filter(p => p.start > s0 + 0.05 && p.end < s1 - 0.05);
  const fine = all.filter(p => p.len >= 0.12);
  const run = (from) => alignUnits({ from, to: s1, weights: w, pauses: fine.filter(p => p.start > from), strengths, pauseBonus, missPenalty, spread });
  let best = { ...run(s0), intro: null };
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const introW = introText ? syllables(introText) : 2;
  const firstQuarter = s0 + (s1 - s0) * 0.25;
  const cands = fine.filter(p => p.len >= 0.25 && p.start < firstQuarter).slice(0, maxIntro);
  for (const p of cands) {
    const r = run(p.end);
    // How long the intro "should" take at this reader's pace vs how long it did.
    const rate = voicedLength(p.end, s1, fine) / total;
    const ratio = voicedLength(s0, p.start, fine) / Math.max(0.3, introW * rate);
    // The pauses up to the text (after the reference, inside a heading) are
    // breaks like any other — the same bonus as in alignUnits; an intro far
    // shorter or longer than the reference costs a little.
    const off = Math.max(0, Math.log(Math.max(ratio / 2.5, 0.5 / ratio, 1)));
    const breaks = fine.filter(q => q.end <= p.end).reduce((a, q) => a + pauseBonus * Math.min(q.len, 1.5) / 1.5, 0);
    const penalty = 0.3 + Math.min(4, 3 * off * off) - breaks;
    if (r.cost + penalty < best.cost) best = { ...r, cost: r.cost + penalty, intro: { start: s0, end: p.start } };
  }
  return best;
}

// No usable analysis: spread the phrases over the speech (or the whole clip)
// by syllables — leaving room for a spoken reference first.
export function estimateReading({ dur, speech, phrases, weights, introText = '' }) {
  const w = weights || phrases.map(p => syllables(p));
  const [from, to] = speech || [0, dur];
  const introW = introText ? syllables(introText) * 1.3 : 0;
  const total = introW + w.reduce((a, b) => a + b, 0) || 1;
  let t = from + (to - from) * introW / total;
  return w.map((x) => {
    const start = t;
    t += (to - from) * x / total;
    return { start, end: t, onPause: false };
  });
}

// When phrase i should appear: `lead` s before it is heard — but the first
// phrase of a page only after the previous phrase has been read (the page
// must not flip away from text still being read).
export function phraseShowTime(units, i, { pageStart = false, lead = 0.1, gap = 0.05, estimated = false } = {}) {
  let t = units[i].start - lead;
  if (pageStart && i > 0) t = Math.max(t, units[i - 1].end + (estimated ? 0.3 : gap));
  return Math.max(0, t);
}
