// Pure, testable phrase splitting shared by the rain player and challenge mode.
//
// Traditional-Chinese verses additionally route through the opt-in semantic
// segmenter in contrib/ (see splitChineseSemantic below): it groups clauses to
// a readable length and protects Biblical names, falling back to the
// punctuation rules here on any failure so nothing ever regresses.
//
// A verse becomes one falling block per phrase, so how the text is cut decides
// whether the game is readable. Three scripts need three different rules, and
// getting any of them wrong is very visible:
//
//   Latin/Hebrew/Arabic — words are space-delimited, so ONLY punctuation may
//     split. Splitting on spaces would produce one block per word.
//
//   Chinese / Japanese  — no spaces inside words, so a space IS a clause
//     boundary (CUV uses it that way) and counts alongside punctuation.
//     Japanese leans on 、(U+3001) and often has no 。at all — omitting it
//     collapsed a whole chapter into a single block.
//
//   Korean — the hard case. Bible Korean (개역/개역개정) carries almost no
//     punctuation (잠언 1: 1351 chars, 354 words, 3 commas, 0 periods) yet puts
//     a space between every word. Punctuation-only leaves one giant block;
//     space-splitting yields 354 one-word blocks. Korean marks clause
//     boundaries with VERB ENDINGS (어미) instead, so that is what we split on.

// The segmenter is vendored at the repo root, one level above this app's Vite
// root; the relative path reaches it and Rollup bundles it at build time.
import segmentScripture from '../../../contrib/semantic-scripture-segmenter/src/index.js';

// Quote/bracket characters are stripped from phrase edges rather than split on,
// so an opening 「 doesn't produce an empty leading block.
const EDGE_TRIM = /^[「」『』《》〈〉“”"‘’'（）()【】[\]\s]+|[「」『』《》〈〉“”"‘’'（）()【】[\]\s]+$/gu;

export function cleanPhraseBlock(phrase = '') {
  return String(phrase || '').trim().replace(EDGE_TRIM, '').trim();
}

// Keeps blocks that contain an actual letter/number/ideograph — filters out
// stray punctuation-only fragments left behind by a split.
export function hasReadablePhraseContent(phrase = '') {
  return /[\p{L}\p{N}㐀-鿿]/u.test(String(phrase || ''));
}

// Deliberately excludes the straight apostrophe and double quote: splitting on
// those would cut English "LORD's" into "LORD" + "s" and break contractions.
// CJK quotation marks are safe to split on — they never appear in Latin text.
const PUNCT_CORE = ',，、。；؛၊။،;:：﹕︰\\.\\?!！？؟';
const PUNCT_CJK_QUOTES = '「」『』《》〈〉';

const isCjkNoSpaceScript = (s) => /[぀-ヿ㐀-鿿]/u.test(s);
export const isKoreanText = (s) => /[가-힯]/u.test(String(s || ''));
export const isHebrewText = (s) => /[֐-׿]/u.test(String(s || ''));
// Chinese Han text with no Japanese kana — the segmenter is tuned for Chinese
// Scripture, so Japanese (which mixes kana with kanji) stays on the generic
// CJK punctuation path below.
const hasKana = (s) => /[぀-ヿ]/u.test(String(s || ''));
export const isChineseHanText = (s) =>
  /[㐀-鿿]/u.test(String(s || '')) && !hasKana(s) && !isKoreanText(s);

// ─── Hebrew ───────────────────────────────────────────────────────────────
// Hebrew ships its own clause division and we only have to stop discarding it.
// The Masoretic caesura arrives from bolls as a run of non-breaking spaces,
// which bibleTextMarkup.js now preserves as a double space:
//   "שמע ישראל  יהוה אלהינו יהוה אחד"   ← the Shema, divided where tradition reads it
// Everything below that is a fallback for verses carrying no gap at all
// (roughly 2 in 9 — typically short ones that need no division).
//
// The one hard rule is negative: never break at maqqef ־ (U+05BE). It is not a
// hyphen but a joiner that binds words into a single accentual unit
// (ועשה־טוב, יירשו־ארץ), so a break there splits a word group in half.
// ؛ (Arabic semicolon) is what fetchVerseFromBolls joins a whole chapter's
// verses with, so it has to count here too — otherwise a chapter reference
// renders phrases with a stray "؛" sitting mid-block.
const HEBREW_BOUNDARY = /\s{2,}|--+|[׃׀]|[—–]|[.,;:!?؛،]/u;
const MAQQEF = '־';

export function splitHebrewClauses(text, { target = 24, max = 42 } = {}) {
  const out = [];
  for (const part of String(text || '').split(HEBREW_BOUNDARY)) {
    const words = String(part).trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    // Short enough to stand alone — keep the authored division intact.
    if (words.join(' ').length <= max) { pushPhrase(out, words.join(' ')); continue; }
    // Long, gap-free stretch: fall back to width, breaking only where it does
    // not strand a maqqef-joined pair.
    let buffer = [];
    for (const word of words) {
      buffer.push(word);
      const line = buffer.join(' ');
      if (line.length >= target && !word.endsWith(MAQQEF) && !word.endsWith('-')) {
        pushPhrase(out, line);
        buffer = [];
      } else if (line.length >= max) {
        pushPhrase(out, line);
        buffer = [];
      }
    }
    if (buffer.length) pushPhrase(out, buffer.join(' '));
  }
  return out;
}

function pushPhrase(list, raw) {
  const phrase = cleanPhraseBlock(raw);
  if (phrase && hasReadablePhraseContent(phrase)) list.push(phrase);
}

// ─── Korean ───────────────────────────────────────────────────────────────
// Suffix patterns, not an enumerated vocabulary: the ending is a productive
// morpheme, so a regex generalises far better. Measured over all 30 Korean
// Proverbs chapters, patterns raised boundary density 11.2% → 18.1% and cut
// length-valve fallbacks from 34% → 14% versus a hand-listed word set.
const KOREAN_CLAUSE_ENDINGS = [
  /(느니라|니라|리라|로다|도다|지라)$/,             // sentence-final
  /(으며|하며|이며|되며|지며|며)$/,                  // "and" connective
  /(거늘|어늘)$/,                                    // contrastive
  /(이요|으요|요)$/,                                 // enumerating
  /(으니|이니|하니|되니|니)$/,                       // causal
  /(말라|하라|으라|아라|어라)$/,                     // imperative
  /(이라|하여|되어|하고|되고|이고|고)$/,             // misc connective
  /(면|자|사|나)$/,                                  // conditional / propositive
];
const TRAILING_PUNCT = /[,，、。；;:：.?!！？]+$/u;

const endsKoreanClause = (word) => KOREAN_CLAUSE_ENDINGS.some((re) => re.test(word));

// minChars stops short fragments (지혜롭게,) becoming their own block — they get
// absorbed into the next one. maxChars is a safety valve for the ~14% of runs
// that reach no ending at all; without it a clause-free stretch stays unsplit.
export function splitKoreanClauses(text, { minChars = 8, maxChars = 30 } = {}) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const phrase = cleanPhraseBlock(buffer.join(' ').replace(TRAILING_PUNCT, ''));
    if (phrase && hasReadablePhraseContent(phrase)) out.push(phrase);
    buffer = [];
  };

  for (const word of words) {
    buffer.push(word);
    const length = buffer.join(' ').length;
    const bare = word.replace(TRAILING_PUNCT, '');
    // A comma is a real boundary too, on the rare occasions Korean text has one.
    const isBoundary = endsKoreanClause(bare) || TRAILING_PUNCT.test(word);
    if (isBoundary && length >= minChars) flush();
    else if (length >= maxChars) flush();
  }
  flush();
  return out;
}

// Authors used to sprinkle spaces INTO Chinese verse text to coax the old
// punctuation splitter into breaking at a good spot (e.g. "遵守 我的道"). The
// semantic segmenter reads a space between two Han characters as a hard
// boundary, so those hints now PREVENT it from choosing a better cut. Strip
// them before segmenting — but only whitespace flanked by Han on both sides, so
// a space beside an embedded Latin word or number is left intact. No lookbehind
// (older Safari lacks it); loop until no inter-Han gap remains ("一 二 三").
const INTER_CJK_SPACE = /([㐀-鿿])[ \t 　]+([㐀-鿿])/gu;
function stripInterCjkSpaces(text) {
  let out = String(text || '');
  let prev;
  do { prev = out; out = out.replace(INTER_CJK_SPACE, '$1$2'); } while (out !== prev);
  return out;
}

// ─── Chinese (semantic) ─────────────────────────────────────────────────────
// Opt-in delegation to the isolated segmenter under
// contrib/semantic-scripture-segmenter/. It returns fragments that reconstruct
// the source exactly (punctuation kept), so we strip trailing punctuation and
// edge quotes to match the house block style, exactly as the Korean path does.
// Any throw or empty/degraded result returns null → caller falls back to the
// punctuation rules, so a bad segmentation can never break the reader.
function splitChineseSemantic(text) {
  try {
    const result = segmentScripture(stripInterCjkSpaces(text));
    if (!result || !Array.isArray(result.fragments) || !result.fragments.length) return null;
    // NEEDS_REPAIR means the segmenter could not produce a safe cut; don't
    // show a questionable result — fall back to punctuation splitting instead.
    if (result.healthState === 'NEEDS_REPAIR') return null;
    const out = result.fragments
      .map((fragment) => cleanPhraseBlock(String(fragment).replace(TRAILING_PUNCT, '')))
      .filter((phrase) => phrase && hasReadablePhraseContent(phrase));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────
// Script is detected from the text, not from a version code. That matters for
// the bilingual secondary line, which renders text whose version the caller
// doesn't always know, and it means one call site can't drift from another by
// passing the wrong label.
//
// semantic: opt Chinese verses into the semantic segmenter. Default on for
// monolingual reading. The bilingual view pairs each primary block with a
// secondary-language block BY INDEX, and the semantic segmenter merges clauses
// (fewer, longer blocks) while the other scripts still split per clause — so a
// bilingual caller passes semantic:false to keep the Chinese side on the same
// punctuation rules as its partner and preserve 1:1 alignment.
export function splitVersePhrases(text, { semantic = true } = {}) {
  const source = String(text || '');
  if (!source.trim()) return [];

  if (isKoreanText(source)) return splitKoreanClauses(source);
  if (isHebrewText(source)) return splitHebrewClauses(source);
  if (semantic && isChineseHanText(source)) {
    const segmented = splitChineseSemantic(source);
    if (segmented) return segmented;
    // else fall through to the generic CJK punctuation path
  }

  const cjk = isCjkNoSpaceScript(source);
  const charClass = `[${PUNCT_CORE}${cjk ? PUNCT_CJK_QUOTES : ''}]`;
  const regex = new RegExp(`\\.{2,}|${charClass}${cjk ? '|\\s+' : ''}`);

  return source
    .split(regex)
    .map(cleanPhraseBlock)
    .filter((phrase) => phrase && hasReadablePhraseContent(phrase));
}
