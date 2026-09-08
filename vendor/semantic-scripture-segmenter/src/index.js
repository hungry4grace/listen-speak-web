import {
  DEFAULT_PROTECTED_TERMS,
  PROTECTED_TERMS_VERSION
} from '../data/protected-terms.zh-Hant.js';

export const NORMALIZATION_VERSION = 'semantic-normalization-v1';
export const SEGMENTATION_VERSION = 'semantic-segmentation-v1';
export const DEFAULT_TARGET_LENGTH = 8;
export const DEFAULT_MAXIMUM_LENGTH = 10;

const EDITORIAL_MARKER = /(?:或譯|或作|有古卷|古卷(?:作|有)?|原文(?:作|是|直譯)?|小字|另作|註(?:：|:)?|意即|作：)/u;
const TRANSLATION_LABEL = /(?:中文)?(?:新標點)?和合本|和合本修訂版|現代中文譯本(?:\s*1995)?|CUV|CUNP|RCUV|TCV/iu;
const PSALM_SUPERSCRIPTION_MARKER = /(?:大衛|亞薩|可拉後裔|所羅門|摩西|希幔|以探|耶杜頓|伶長|詩|歌|金詩|訓誨詩|上行之詩|調用|記念詩|安息日)/u;
const NON_SCRIPTURE_ONLY = /^(?:[a-z]|[*†‡]+)$/iu;
const VISIBLE_CHARACTER = /[\p{L}\p{N}\p{Script=Han}]/u;
const SENTENCE_END = new Set(Array.from('。！？!?'));
const CLAUSE_END = new Set(Array.from('；：;:'));
const PHRASE_END = new Set(Array.from('，、,'));
const TRAILING_CLOSERS = new Set(Array.from('」』》〉】）)]}'));
const LEADING_BOUNDARY_PUNCTUATION = /^[，、。；：！？，,;:!?」』》〉】）)\]}]/u;
const DEPENDENT_FRAGMENT_START = /^的/u;
const LITURGICAL_CONTINUATION = /^[（(]細拉[）)]/u;
const DANGLING_FRAGMENT_END = /(?:所以|因為|但是|然而|因此|於是|並且|若是|倘若|只是|不但|而且|或者)$/u;

const SEMANTIC_CLAUSE_STARTS = Object.freeze([
  '所以', '因為', '但是', '然而', '因此', '於是', '並且', '如今', '若是', '倘若',
  '只是', '不但', '而且', '或者'
]);

const SAFE_MEMORY_UNIT_STARTS = Object.freeze([
  '有兩個', '去見', '召了', '攻取', '按著', '賣銀', '殺敗', '只結',
  '最尊大', '轄制', '就是', '所生', '其餘', '分定', '照以',
  '用刀', '用精金', '比眾', '引導'
]);

const SAFE_SINGLE_CHARACTER_WORDS = new Set(Array.from(
  '在的和並又也就都而與及或從向到將把被為所要必可使叫讓給因若但其他你我誰此那各每'
));

function configuredLength(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

export function visibleOptionText(value) {
  return String(value || '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function visibleLength(value) {
  return Array.from(String(value || ''))
    .filter((character) => VISIBLE_CHARACTER.test(character)).length;
}

function hasIncompleteSemanticEnd(value) {
  return DANGLING_FRAGMENT_END.test(visibleOptionText(value));
}

function removeMarkedParentheses(value, open, close) {
  let text = String(value || '');
  let changed = true;
  while (changed) {
    changed = false;
    let start = -1;
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === open) start = index;
      if (text[index] !== close || start < 0) continue;
      const content = text.slice(start + 1, index);
      if (EDITORIAL_MARKER.test(content)) {
        text = text.slice(0, start) + text.slice(index + 1);
        changed = true;
      }
      start = -1;
      if (changed) break;
    }
  }
  return text;
}

function removeLeadingTranslationLabels(value) {
  let text = String(value || '').trimStart();
  let removed = false;
  let changed = true;
  while (changed && text) {
    changed = false;
    const bracketed = text.match(/^[【[]\s*([^】\]]+)\s*[】\]]\s*/u);
    if (bracketed && TRANSLATION_LABEL.test(bracketed[1])) {
      text = text.slice(bracketed[0].length).trimStart();
      removed = true;
      changed = true;
      continue;
    }
    const line = text.match(/^([^\r\n：:|｜]{1,40})(?:\r?\n|[：:|｜]\s*)/u);
    if (line && TRANSLATION_LABEL.test(line[1])) {
      text = text.slice(line[0].length).trimStart();
      removed = true;
      changed = true;
    }
  }
  return { text, removed };
}

export function removeLeadingGameSuperscription(value) {
  let text = String(value || '').trimStart();
  const pairs = [['（', '）'], ['(', ')']];
  let removed = false;
  let inspecting = true;
  while (inspecting) {
    inspecting = false;
    for (const [open, close] of pairs) {
      if (!text.startsWith(open)) continue;
      const end = text.indexOf(close, open.length);
      if (end < 0) continue;
      const heading = text.slice(open.length, end);
      if (!PSALM_SUPERSCRIPTION_MARKER.test(heading)) continue;
      text = text.slice(end + close.length)
        .trimStart()
        .replace(/^[。．.:：]\s*/u, '');
      removed = true;
      inspecting = true;
      break;
    }
  }
  return { text, removed };
}

export function normalizeScriptureText(value) {
  const rawText = String(value || '').trim();
  const metadata = removeLeadingTranslationLabels(rawText);
  const withoutChineseNotes = removeMarkedParentheses(metadata.text, '（', '）');
  const withoutEnglishNotes = removeMarkedParentheses(withoutChineseNotes, '(', ')');
  const superscription = removeLeadingGameSuperscription(withoutEnglishNotes);
  const normalizedText = superscription.text
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
  const nonScriptureOnly = NON_SCRIPTURE_ONLY.test(normalizedText);
  const displayText = nonScriptureOnly ? '' : normalizedText;
  return {
    rawText,
    displayText,
    normalizationVersion: NORMALIZATION_VERSION,
    superscriptionRemoved: superscription.removed,
    nonScriptureMetadataRemoved: metadata.removed || nonScriptureOnly,
    nonScriptureOnly
  };
}

export function defaultProtectedTerms() {
  return DEFAULT_PROTECTED_TERMS.map((item) => ({ ...item }));
}

function normalizeProtectedTerms(terms) {
  return [...new Map((terms || [])
    .map((item) => typeof item === 'string' ? { term: item } : item)
    .map((item) => ({ ...item, term: String(item?.term || '').trim() }))
    .filter((item) => item.term)
    .map((item) => [item.term, item])).values()]
    .sort((left, right) => right.term.length - left.term.length
      || left.term.localeCompare(right.term, 'zh-Hant'));
}

function findProtectedSpans(text, terms) {
  const spans = [];
  for (const item of normalizeProtectedTerms(terms)) {
    let start = text.indexOf(item.term);
    while (start >= 0) {
      spans.push({
        term: item.term,
        start,
        end: start + item.term.length,
        source: 'LEXICON',
        category: String(item.category || ''),
        isolate: item.isolate === true
      });
      start = text.indexOf(item.term, start + 1);
    }
  }
  return spans.sort((left, right) => left.start - right.start || right.end - left.end);
}

function intlProtectedSpans(text) {
  if (typeof Intl?.Segmenter !== 'function') return [];
  const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
  return [...segmenter.segment(text)]
    .filter((item) => item.isWordLike && visibleLength(item.segment) >= 2)
    .map((item) => ({
      term: String(item.segment),
      start: Number(item.index),
      end: Number(item.index) + String(item.segment).length,
      source: 'INTL',
      category: '',
      isolate: false
    }));
}

function protectedAtOffset(spans, offset) {
  return spans.find((span) => offset > span.start && offset < span.end) || null;
}

function addBoundary(map, offset, kind, priority, extra = {}) {
  if (!Number.isInteger(offset) || offset <= 0) return;
  const current = map.get(offset);
  if (!current || priority > current.priority) {
    map.set(offset, { id: `b${offset}`, offset, kind, priority, ...extra });
  }
}

function codePointOffsets(text) {
  const offsets = [];
  let offset = 0;
  for (const character of text) {
    offsets.push({ character, start: offset, end: offset + character.length });
    offset += character.length;
  }
  return offsets;
}

function segmenterCandidates(text, boundaries) {
  if (typeof Intl?.Segmenter !== 'function') return;
  const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });
  for (const item of segmenter.segment(text)) {
    const segment = String(item.segment || '');
    const end = Number(item.index) + segment.length;
    const count = visibleLength(segment);
    if (item.isWordLike && (count >= 2 || SAFE_SINGLE_CHARACTER_WORDS.has(segment))) {
      addBoundary(boundaries, end, 'WORD', 40, { segment });
    }
  }
}

function semanticClauseCandidates(text, boundaries) {
  for (const connector of SEMANTIC_CLAUSE_STARTS) {
    let start = text.indexOf(connector);
    while (start >= 0) {
      if (start > 0) addBoundary(boundaries, start, 'SEMANTIC_CLAUSE', 50, { connector });
      start = text.indexOf(connector, start + 1);
    }
  }
}

function safeMemoryUnitCandidates(text, boundaries) {
  for (const marker of SAFE_MEMORY_UNIT_STARTS) {
    let start = text.indexOf(marker);
    while (start >= 0) {
      if (start > 0) addBoundary(boundaries, start, 'MEMORY_UNIT_START', 72, { marker });
      start = text.indexOf(marker, start + 1);
    }
  }
}

function parentheticalCandidates(text, boundaries) {
  const pairs = new Map([['（', '）'], ['(', ')'], ['〈', '〉']]);
  const closers = new Set(pairs.values());
  for (const { character, start, end } of codePointOffsets(text)) {
    if (pairs.has(character)) addBoundary(boundaries, start, 'PARENTHETICAL_START', 94);
    if (closers.has(character)) addBoundary(boundaries, end, 'PARENTHETICAL_END', 94);
  }
}

function candidateBoundaries(text, spans) {
  const boundaries = new Map();
  for (const { character, end } of codePointOffsets(text)) {
    let boundaryEnd = end;
    while (boundaryEnd < text.length) {
      const next = String.fromCodePoint(text.codePointAt(boundaryEnd));
      if (!TRAILING_CLOSERS.has(next)) break;
      boundaryEnd += next.length;
    }
    if (SENTENCE_END.has(character)) addBoundary(boundaries, boundaryEnd, 'SENTENCE', 112);
    else if (CLAUSE_END.has(character)) addBoundary(boundaries, boundaryEnd, 'CLAUSE', 104);
    else if (PHRASE_END.has(character)) addBoundary(boundaries, boundaryEnd, 'PHRASE', 96);
  }

  segmenterCandidates(text, boundaries);
  semanticClauseCandidates(text, boundaries);
  safeMemoryUnitCandidates(text, boundaries);
  parentheticalCandidates(text, boundaries);

  const genealogyLike = /(?:生|所生|兒子|女兒|長子|次子|子孫|後裔|宗族)/u.test(text)
    && spans.some((item) => item.category === 'PERSON');
  if (genealogyLike) {
    for (const span of spans.filter((item) => item.category === 'PERSON')) {
      const suffixLength = text.slice(span.end).startsWith('的') ? 1 : 0;
      addBoundary(boundaries, span.end + suffixLength, 'ROSTER_TERM', 90, { term: span.term });
    }
  }

  for (const span of spans.filter((item) => item.isolate)) {
    addBoundary(boundaries, span.start, 'ENTITY_START', 115, { term: span.term });
    addBoundary(boundaries, span.end, 'ENTITY_END', 115, { term: span.term });
  }

  for (const span of spans.filter((item) => item.source === 'LEXICON')) {
    addBoundary(boundaries, span.start, 'ENTITY_TERM_START', 76, { term: span.term });
    const suffixLength = text.slice(span.end).startsWith('的') ? 1 : 0;
    addBoundary(boundaries, span.end + suffixLength, 'ENTITY_TERM_END', 76, { term: span.term });
  }

  addBoundary(boundaries, text.length, 'END', 120);
  return [...boundaries.values()]
    .filter((boundary) => {
      if (boundary.offset > text.length) return false;
      const protectedSpan = protectedAtOffset(spans, boundary.offset);
      if (!protectedSpan) return true;
      if (protectedSpan.source === 'LEXICON') return false;
      return [
        'MEMORY_UNIT_START',
        'PARENTHETICAL_START',
        'PARENTHETICAL_END',
        'ENTITY_TERM_START',
        'ENTITY_TERM_END'
      ].includes(boundary.kind);
    })
    .filter((boundary) => boundary.kind === 'END'
      || !LEADING_BOUNDARY_PUNCTUATION.test(text.slice(boundary.offset).trimStart()))
    .filter((boundary) => boundary.kind !== 'PARENTHETICAL_END'
      || !/^的/u.test(text.slice(boundary.offset).trimStart()))
    .filter((boundary) => boundary.kind === 'END'
      || !hasIncompleteSemanticEnd(text.slice(0, boundary.offset)))
    .filter((boundary) => boundary.kind === 'END'
      || boundary.kind === 'ENTITY_END'
      || boundary.kind === 'ENTITY_TERM_END'
      || boundary.kind === 'PARENTHETICAL_END'
      || boundary.kind === 'ROSTER_TERM'
      || !DEPENDENT_FRAGMENT_START.test(visibleOptionText(text.slice(boundary.offset))))
    .filter((boundary) => boundary.kind === 'END'
      || !LITURGICAL_CONTINUATION.test(text.slice(boundary.offset).trimStart()))
    .sort((left, right) => left.offset - right.offset);
}

function fragmentCost(fragment, boundary, targetLength, maximumLength, absoluteStart, isolatedSpans) {
  const length = visibleLength(fragment);
  if (length === 0) return Number.POSITIVE_INFINITY;
  const distance = Math.abs(targetLength - length);
  let cost = distance * 2;
  if (length < Math.ceil(targetLength / 2)) cost += (targetLength - length) * 7;
  if (/[（(〈]/u.test(fragment.slice(1))) cost += 250;
  if (length > maximumLength) cost += 1_000 + (length - maximumLength) * 100;

  const absoluteEnd = absoluteStart + fragment.length;
  for (const span of isolatedSpans) {
    const overlaps = absoluteStart < span.end && absoluteEnd > span.start;
    if (!overlaps) continue;
    const isExactEntity = absoluteStart === span.start && absoluteEnd === span.end;
    const suffix = absoluteStart === span.start
      ? fragment.slice(span.end - absoluteStart)
      : '';
    const hasShortPossessiveTail = /^的[\p{Script=Han}]{1,2}[\p{P}\p{S}]*$/u.test(suffix);
    if (!isExactEntity && !hasShortPossessiveTail) cost += 2_000;
  }
  return cost - Math.min(14, (boundary?.priority || 0) / 8);
}

function chooseBoundaries(text, candidates, decisions, targetLength, maximumLength, isolatedSpans) {
  const points = [{ id: 'b0', offset: 0, kind: 'START', priority: 120 }, ...candidates];
  const sentenceOffsets = points
    .filter((point) => point.kind === 'SENTENCE')
    .map((point) => point.offset);
  const best = new Array(points.length).fill(null);
  best[0] = { cost: 0, previous: -1 };

  for (let endIndex = 1; endIndex < points.length; endIndex += 1) {
    const end = points[endIndex];
    if (decisions[end.id] === 'FORBID' && end.offset !== text.length) continue;
    for (let startIndex = 0; startIndex < endIndex; startIndex += 1) {
      if (!best[startIndex]) continue;
      const start = points[startIndex];
      if (sentenceOffsets.some((offset) => offset > start.offset && offset < end.offset)) continue;
      const fragment = text.slice(start.offset, end.offset);
      let cost = best[startIndex].cost + fragmentCost(
        fragment,
        end,
        targetLength,
        maximumLength,
        start.offset,
        isolatedSpans
      );
      if (!Number.isFinite(cost)) continue;
      if (decisions[end.id] === 'PREFER') cost -= 18;
      if (decisions[end.id] === 'KEEP') cost -= 8;
      const next = { cost, previous: startIndex };
      if (!best[endIndex] || next.cost < best[endIndex].cost) best[endIndex] = next;
    }
  }

  const endIndex = points.length - 1;
  if (!best[endIndex]) return [];
  const chosen = [];
  let cursor = endIndex;
  while (cursor > 0) {
    chosen.push(points[cursor]);
    cursor = best[cursor].previous;
  }
  return chosen.reverse();
}

function offsetsForFragments(fragments) {
  let offset = 0;
  return fragments.map((fragment) => {
    offset += String(fragment).length;
    return offset;
  });
}

export function validateSegmentation({
  text,
  fragments,
  boundaryOffsets,
  protectedTerms = [],
  includeIntlProtectedTerms = false
}) {
  const errors = [];
  const source = String(text || '');
  const offsets = Array.isArray(boundaryOffsets) ? boundaryOffsets : [];

  if (source.length === 0 && Array.isArray(fragments)
    && fragments.length === 0 && offsets.length === 0) {
    return { valid: true, errors: [], brokenTerms: [] };
  }
  if (!Array.isArray(fragments) || fragments.length === 0) errors.push('NO_FRAGMENTS');
  if ((fragments || []).join('') !== source) errors.push('EXACT_REASSEMBLY_FAILED');
  if ((fragments || []).some((fragment) => !visibleOptionText(fragment))) {
    errors.push('EMPTY_VISIBLE_FRAGMENT');
  }
  if ((fragments || []).slice(1)
    .some((fragment) => LEADING_BOUNDARY_PUNCTUATION.test(String(fragment || '').trimStart()))) {
    errors.push('LEADING_BOUNDARY_PUNCTUATION');
  }
  if (offsets.some((offset, index) => !Number.isInteger(offset)
    || offset <= (index === 0 ? 0 : offsets[index - 1])
    || offset > source.length)) {
    errors.push('INVALID_BOUNDARY_SEQUENCE');
  }
  if (offsets.at(-1) !== source.length) errors.push('MISSING_FINAL_BOUNDARY');

  const spans = [
    ...findProtectedSpans(source, protectedTerms),
    ...(includeIntlProtectedTerms ? intlProtectedSpans(source) : [])
  ];
  const brokenTerms = offsets
    .slice(0, -1)
    .map((offset) => protectedAtOffset(spans, offset))
    .filter(Boolean)
    .map((span) => span.term);
  if (brokenTerms.length) errors.push('PROTECTED_TERM_SPLIT');

  const semanticFragments = (fragments || []).map(visibleOptionText);
  const standaloneNames = new Set((protectedTerms || [])
    .filter((item) => typeof item === 'object' && item?.isolate === true)
    .map((item) => visibleOptionText(item.term)));
  const dependentWithoutStandaloneName = semanticFragments.some((fragment, index) => (
    index > 0
    && DEPENDENT_FRAGMENT_START.test(fragment)
    && !standaloneNames.has(semanticFragments[index - 1])
  ));
  if ((fragments || []).slice(0, -1).some((fragment) => hasIncompleteSemanticEnd(fragment))
    || dependentWithoutStandaloneName) {
    errors.push('INCOMPLETE_SEMANTIC_FRAGMENT');
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    brokenTerms: [...new Set(brokenTerms)]
  };
}

function resultFromFragments({
  normalization,
  fragments,
  candidates,
  selectedBoundaries,
  spans,
  protectedTerms,
  targetLength,
  maximumLength,
  approved
}) {
  const boundaryOffsets = selectedBoundaries.map((boundary) => boundary.offset);
  const validation = validateSegmentation({
    text: normalization.displayText,
    fragments,
    boundaryOffsets,
    protectedTerms
  });
  const longFragments = fragments.filter((fragment) => visibleLength(fragment) > maximumLength);
  const issues = [...validation.errors];
  if (approved) issues.push('APPROVED_SEGMENTATION');
  if (longFragments.length) issues.push('LONG_FRAGMENT_EXCEPTION');
  const healthState = !validation.valid
    ? 'NEEDS_REPAIR'
    : longFragments.length ? 'VALID_LONG' : 'VALID';

  return {
    ...normalization,
    fragments,
    boundaryOffsets,
    candidateBoundaries: candidates,
    selectedBoundaries,
    protectedSpans: spans,
    healthState,
    confidence: healthState === 'VALID' ? 'HIGH' : healthState === 'VALID_LONG' ? 'MEDIUM' : 'LOW',
    issues: [...new Set(issues)],
    targetLength,
    maximumLength,
    voiceReady: healthState === 'VALID',
    ruleVersion: `${SEGMENTATION_VERSION}-t${targetLength}-m${maximumLength}`,
    lexiconVersion: PROTECTED_TERMS_VERSION
  };
}

export function segmentScripture(sourceText, {
  protectedTerms = defaultProtectedTerms(),
  boundaryDecisions = {},
  approvedFragments = null,
  targetLength = DEFAULT_TARGET_LENGTH,
  maximumLength = DEFAULT_MAXIMUM_LENGTH
} = {}) {
  const preferredLength = configuredLength(targetLength, DEFAULT_TARGET_LENGTH, 4, 16);
  const allowedLength = configuredLength(maximumLength, DEFAULT_MAXIMUM_LENGTH, 4, 32);
  const normalization = normalizeScriptureText(sourceText);
  const text = normalization.displayText;

  if (!text) {
    const omittedIssue = normalization.nonScriptureOnly
      ? 'NON_SCRIPTURE_TEXT_OMITTED'
      : 'EDITORIAL_NOTE_ONLY_TEXT';
    return {
      ...normalization,
      fragments: [],
      boundaryOffsets: [],
      candidateBoundaries: [],
      selectedBoundaries: [],
      protectedSpans: [],
      healthState: 'VALID',
      confidence: 'HIGH',
      issues: [omittedIssue],
      targetLength: preferredLength,
      maximumLength: allowedLength,
      voiceReady: true,
      ruleVersion: `${SEGMENTATION_VERSION}-t${preferredLength}-m${allowedLength}`,
      lexiconVersion: PROTECTED_TERMS_VERSION
    };
  }

  const spans = [
    ...findProtectedSpans(text, protectedTerms),
    ...intlProtectedSpans(text)
  ];
  const candidates = candidateBoundaries(text, spans);

  if (Array.isArray(approvedFragments)) {
    const fragments = approvedFragments.map(String);
    const offsets = offsetsForFragments(fragments);
    const selectedBoundaries = offsets.map((offset) => ({
      id: `approved-${offset}`,
      offset,
      kind: offset === text.length ? 'END' : 'APPROVED',
      priority: 120
    }));
    return resultFromFragments({
      normalization,
      fragments,
      candidates,
      selectedBoundaries,
      spans,
      protectedTerms,
      targetLength: preferredLength,
      maximumLength: allowedLength,
      approved: true
    });
  }

  const selectedBoundaries = chooseBoundaries(
    text,
    candidates,
    boundaryDecisions,
    preferredLength,
    allowedLength,
    spans.filter((span) => span.isolate)
  );
  const fragments = [];
  let start = 0;
  for (const boundary of selectedBoundaries) {
    fragments.push(text.slice(start, boundary.offset));
    start = boundary.offset;
  }

  return resultFromFragments({
    normalization,
    fragments,
    candidates,
    selectedBoundaries,
    spans,
    protectedTerms,
    targetLength: preferredLength,
    maximumLength: allowedLength,
    approved: false
  });
}

export function mergePassageSegmentations(perVerse = [], {
  maximumLength = DEFAULT_MAXIMUM_LENGTH
} = {}) {
  const allowedLength = configuredLength(maximumLength, DEFAULT_MAXIMUM_LENGTH, 4, 32);
  const merged = [];
  for (const verse of perVerse) {
    const verseFragments = Array.isArray(verse?.fragments)
      ? verse.fragments.filter(Boolean)
      : [];
    for (let index = 0; index < verseFragments.length; index += 1) {
      const fragment = String(verseFragments[index]);
      const previousIndex = merged.length - 1;
      const previous = merged[previousIndex] || '';
      if (index === 0 && previous && /[：:]\s*$/u.test(previous)
        && visibleLength(previous + fragment) <= allowedLength) {
        merged[previousIndex] = previous + fragment;
      } else {
        merged.push(fragment);
      }
    }
  }
  return merged;
}

export default segmentScripture;
