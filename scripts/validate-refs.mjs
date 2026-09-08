#!/usr/bin/env node
// Validate that every verse reference across every verses_*.js (and verses.js,
// verses_cuvs.js) can be resolved to a numeric Bible book id by the App's
// normalizeVerseReferenceKey logic.
//
// Why this exists: secondary-language display (bilingual mode + bolls/getbible
// fallback) requires the reference to normalize to "<bookId>|<chap>:<verse>".
// If the bookPart doesn't resolve to a numeric id, the entire bilingual path
// silently fails — no error, just an invisible blank under the primary line.
// This script catches that BEFORE the change lands in main.
//
// Run: `npm run validate-refs` (or `node scripts/validate-refs.mjs`).
// Exits non-zero if any reference fails to normalize or any in-use secondary
// language has no fetch source (bolls slug OR getbible slug).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const APP_JSX = path.join(SRC_DIR, 'App.jsx');

// ── Map extraction ─────────────────────────────────────────────────────────
// Parse the App.jsx source so we don't have to keep this script's maps in
// sync with the App. The regex matches each `const NAME = { ... };` block
// at top-level (no leading whitespace before `const`), grabs the body, then
// `new Function('return {...}')` parses it as a JS literal.
function extractObjectMap(src, name) {
  const re = new RegExp(`^const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)^\\};`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`Could not find map "${name}" in App.jsx — the parser regex needs an update.`);
  try { return (new Function(`return {${m[1]}}`))(); }
  catch (e) { throw new Error(`Failed to parse map "${name}": ${e.message}`); }
}

const appSrc = fs.readFileSync(APP_JSX, 'utf8');
const HEBREW_FULL_BOOK_ID = extractObjectMap(appSrc, 'HEBREW_FULL_BOOK_ID');
const KOREAN_FULL_BOOK_ID = extractObjectMap(appSrc, 'KOREAN_FULL_BOOK_ID');
const KOREAN_NUMERIC_VARIANTS = extractObjectMap(appSrc, 'KOREAN_NUMERIC_VARIANTS');
const MULTILANG_FULL_BOOK_ID = extractObjectMap(appSrc, 'MULTILANG_FULL_BOOK_ID');
const BOLLS_TRANSLATIONS = extractObjectMap(appSrc, 'BOLLS_TRANSLATIONS');
const GETBIBLE_TRANSLATIONS = extractObjectMap(appSrc, 'GETBIBLE_TRANSLATIONS');

// BIBLE_BOOKS lives in its own ESM file — import directly.
const { BIBLE_BOOKS } = await import(pathToFileURL(path.join(SRC_DIR, 'bibleDictionary.js')).href);

// ── Normalize logic (mirrors App.jsx) ──────────────────────────────────────
function asciifyDigits(s) {
  if (!s) return s;
  return s
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[၀-၉]/g, d => String(d.charCodeAt(0) - 0x1040));
}
function normalizeBookKey(s) {
  if (!s) return '';
  return asciifyDigits(String(s).toLowerCase()).replace(/[-\s.'']+/g, '');
}
const HEBREW_NORM = Object.fromEntries(Object.entries(HEBREW_FULL_BOOK_ID).map(([k, v]) => [normalizeBookKey(k), v]));
const KOREAN_NORM = Object.fromEntries(Object.entries(KOREAN_FULL_BOOK_ID).map(([k, v]) => [normalizeBookKey(k), v]));
for (const [k, v] of Object.entries(KOREAN_NUMERIC_VARIANTS)) KOREAN_NORM[normalizeBookKey(k)] = v;
const MULTI_NORM = Object.fromEntries(Object.entries(MULTILANG_FULL_BOOK_ID).map(([k, v]) => [normalizeBookKey(k), v]));

function lookupFullBookId(p) {
  if (!p) return undefined;
  const t = p.trim(), k = normalizeBookKey(p);
  return (
    HEBREW_FULL_BOOK_ID[p] ?? HEBREW_FULL_BOOK_ID[t] ?? HEBREW_NORM[k]
    ?? KOREAN_FULL_BOOK_ID[p] ?? KOREAN_FULL_BOOK_ID[t] ?? KOREAN_NORM[k]
    ?? MULTILANG_FULL_BOOK_ID[p] ?? MULTILANG_FULL_BOOK_ID[t] ?? MULTI_NORM[k]
  );
}
function lookupBookId(bookRaw) {
  const n = bookRaw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  const b = BIBLE_BOOKS.find(bk => [
    ...(bk.names || []), ...(bk.cn || []),
    bk.ja, bk.ko, bk.es, bk.de, bk.tr, bk.fa, bk.ar, bk.he, bk.my, bk.vi, bk.idn, bk.msy,
  ].filter(Boolean).some(name => {
    const nn = String(name).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    return n === nn || n.endsWith(' ' + nn);
  }));
  return b?.id ?? lookupFullBookId(bookRaw);
}
function normalizesToNumericBookId(reference) {
  const v = asciifyDigits(String(reference || '')).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (!v) return false;
  // Hebrew gematria — assume any ref that matches the `[א-ת]+:[א-ת]+` pattern
  // resolves via HEBREW_FULL_BOOK_ID lookup (already covered).
  if (/^.+?\s+[א-ת]+\s*[:׃]\s*[א-ת]+/.test(v)) {
    const bookRaw = v.match(/^(.+?)\s+[א-ת]+/)[1].trim();
    return Boolean(HEBREW_FULL_BOOK_ID[bookRaw] ?? BIBLE_BOOKS.find(b => b.he === bookRaw)?.id);
  }
  const vm = v.match(/(\d+)\s*:\s*([\d,\-\s]+)/);
  let bookPart;
  if (vm) {
    bookPart = v.slice(0, vm.index).trim().replace(/[：:]+$/, '');
  } else {
    const cm = v.match(/^(\d\s+)?([^\d]+?)\s+(\d+)$/);
    if (!cm) return true; // No book-form recognizable (e.g. non-Bible ref) — skip.
    bookPart = ((cm[1]?.trim() || '') + cm[2]).trim();
  }
  return Boolean(lookupBookId(bookPart));
}

// ── Scan verse files ───────────────────────────────────────────────────────
// We avoid `import(verses_*.js)` because verses.js uses extensionless imports
// (`./verses_psalms`) that Vite resolves but Node ESM does not. Regex over
// the source is sufficient — every entry has `reference: "..."` or
// `"reference": "..."` and we don't need the full structured data.
const verseFiles = fs.readdirSync(SRC_DIR)
  .filter(f => /^verses(?:_[a-z0-9]+)?\.js$/.test(f))
  .map(f => path.join(SRC_DIR, f));

const REF_RE = /["']?reference["']?\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
const LANG_RE = /["']?language["']?\s*:\s*"([^"]+)"/g;

const failures = [];
let totalRefs = 0;
const secondaryVersionsSeen = new Set();

for (const file of verseFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(LANG_RE)) secondaryVersionsSeen.add(m[1]);
  for (const m of src.matchAll(REF_RE)) {
    const ref = m[1];
    if (!ref) continue;
    totalRefs++;
    if (!normalizesToNumericBookId(ref)) {
      failures.push({ file: path.basename(file), ref });
    }
  }
}

// ── Verify each language version has SOME fetch path ───────────────────────
// English versions (kjv/esv/niv) use a dedicated API path in App.jsx so they
// don't need a bolls / getbible slug. 'he' is handled specially in
// getBollsSlug (HAC / DHNT by testament).
const ENGLISH_API_VERSIONS = new Set(['kjv', 'esv', 'niv']);
const SPECIAL_HANDLING = new Set(['he']);
// Local-bundle-only languages: no online Bible API carries them, so there is
// deliberately no bolls/getbible slug. Bilingual display works only through
// paired topic sets (<id>-<lang>) bundled in verses_<lang>.js.
// 'tw' = 台語漢字本 (Taiwanese Hokkien, Barclay Han-character edition).
const LOCAL_BUNDLE_ONLY = new Set(['tw']);
// `set.language` in verse files isn't always the same identifier as
// `bilingualSecondaryVersion` in App.jsx state. These aliases map verse-file
// `language` strings to the underlying fetch-version code. Update this when
// a new alias appears.
const LANG_ALIASES = {
  'zh-TW': 'cuv',
  'zh-CN': 'cuvs',
  'en': 'kjv', // generic English label — App picks among kjv/esv/niv at runtime
};
const missingFetchPath = [];
for (const raw of secondaryVersionsSeen) {
  const v = LANG_ALIASES[raw] || raw;
  if (ENGLISH_API_VERSIONS.has(v) || SPECIAL_HANDLING.has(v) || LOCAL_BUNDLE_ONLY.has(v)) continue;
  if (!BOLLS_TRANSLATIONS[v] && !GETBIBLE_TRANSLATIONS[v]) {
    missingFetchPath.push(raw);
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`Scanned ${verseFiles.length} verse files, ${totalRefs} references, ${secondaryVersionsSeen.size} languages.`);
console.log(`Languages: ${[...secondaryVersionsSeen].sort().join(', ')}`);

let exitCode = 0;
if (failures.length) {
  exitCode = 1;
  console.error(`\n❌ ${failures.length} reference(s) failed to normalize:`);
  // Group by bookPart for actionable output
  const byRef = new Map();
  for (const f of failures) {
    if (!byRef.has(f.ref)) byRef.set(f.ref, []);
    byRef.get(f.ref).push(f);
  }
  for (const [ref, list] of byRef) {
    console.error(`  "${ref}"  (${list.length}× — first in: ${list[0].file})`);
  }
  console.error(`\nFix: add the book name to MULTILANG_FULL_BOOK_ID in App.jsx, OR if it's a digit-only issue, extend asciifyDigits.`);
}
if (missingFetchPath.length) {
  exitCode = 1;
  console.error(`\n❌ Languages with verse sets but no secondary fetch path: ${missingFetchPath.join(', ')}`);
  console.error(`Fix: add to BOLLS_TRANSLATIONS or GETBIBLE_TRANSLATIONS in App.jsx (or document why bilingual is skipped).`);
}

if (exitCode === 0) {
  console.log(`\n✅ All references resolve; all languages have a fetch path.`);
}
process.exit(exitCode);
