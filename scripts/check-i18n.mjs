#!/usr/bin/env node
// npm run check:i18n
//
// Every user-facing string in App.jsx goes through t(zh, en). When a language's
// dictionary lacks the key, t() silently falls back — to the English gloss for
// most languages, and to Traditional Chinese for ja/ko/cuvs. That fallback is
// invisible in code review, which is how a Hebrew user came to read
// "Cloud Family" and "Multiplayer" on an otherwise-Hebrew lobby.
//
// This script parses App.jsx, collects every t() key and every dictionary key
// (literal dicts + Object.assign patches + the generated i18nFillins tables),
// and exits non-zero if any language is missing a key. Run it before release.
//
// Usage:
//   npm run check:i18n           # report + fail on gaps
//   npm run check:i18n -- --json # machine-readable, for tooling
//
// When it fails: add the missing strings to src/i18nFillins.js (per language),
// or to the hand-written dictionaries in App.jsx.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { Parser } from 'acorn';
import acornJsx from 'acorn-jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');
const APP = resolve(SRC, 'App.jsx');

// The dictionaries live in App.jsx, but `t` is passed as a prop into
// TeamsModal, BlindModeGame, VerseVoiceRecorder, SetPicker … — their keys hit
// the same dictionaries, so every source file has to be scanned for t() calls.
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.endsWith('.test.mjs')) out.push(path);
  }
  return out;
}

// Languages t() can render, and the dictionary variable backing each one.
// 'en' and 'zh' need no dictionary: they ARE the two arguments to t().
const LANGS = {
  he: 'heDict', fa: 'faDict', ar: 'arDict', ja: 'jaDict', ko: 'koDict',
  es: 'esDict', tr: 'trDict', de: 'deDict', my: 'myDict', vi: 'viDict',
  id: 'idDict', ms: 'msDict', cuvs: 'zhcnDict',
};

// Keys t() answers inline with a per-language switch instead of a dictionary.
const INLINE_KEYS = new Set(['活動']);

const JsxParser = Parser.extend(acornJsx());
const parse = (file) =>
  JsxParser.parse(readFileSync(file, 'utf8'), { ecmaVersion: 2022, sourceType: 'module' });

// Generic walk — no acorn-walk visitor tables, so JSX node types traverse fine.
function visit(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => c && typeof c.type === 'string' && visit(c, fn));
    else if (child && typeof child.type === 'string') visit(child, fn);
  }
}

const objectKeys = (node) =>
  node.properties
    .filter((p) => p.type === 'Property')
    .map((p) => (p.key.type === 'Literal' ? p.key.value : p.key.name));

const dicts = {};
const record = (name, keys) => {
  (dicts[name] ??= new Set());
  for (const k of keys) dicts[name].add(k);
};

// t() keys → their English gloss (null when t() was called with one argument).
const used = new Map();
// t() key → the files that render it, for the failure report.
const usedIn = new Map();
// t(`已匯入 ${n} 節`) — a key built at runtime can never match a dictionary, so
// the string is untranslatable no matter how many translations we write. These
// must be rewritten as a static key + {placeholder} + .replace().
const dynamicKeys = [];

// Dictionaries: App.jsx only.
visit(parse(APP), (node) => {
  // const xDict = { … }
  if (
    node.type === 'VariableDeclarator' &&
    node.id.type === 'Identifier' &&
    node.id.name.endsWith('Dict') &&
    node.init?.type === 'ObjectExpression'
  ) {
    record(node.id.name, objectKeys(node.init));
  }

  if (node.type !== 'CallExpression') return;
  const callee = node.callee;

  // Object.assign(xDict, { … }) — several dictionaries are patched in place.
  if (
    callee.type === 'MemberExpression' &&
    callee.object.name === 'Object' &&
    callee.property.name === 'assign' &&
    node.arguments[0]?.name &&
    node.arguments[1]?.type === 'ObjectExpression'
  ) {
    record(node.arguments[0].name, objectKeys(node.arguments[1]));
  }

  // fillMissing(xDict, { … }) — the in-component backfill helper.
  if (
    callee.type === 'Identifier' &&
    callee.name === 'fillMissing' &&
    node.arguments[0]?.name &&
    node.arguments[1]?.type === 'ObjectExpression'
  ) {
    record(node.arguments[0].name, objectKeys(node.arguments[1]));
  }
});

// t('中文', 'English') — every source file, since `t` travels as a prop.
for (const file of sourceFiles(SRC)) {
  const where = relative(ROOT, file);
  visit(parse(file), (node) => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;
    const key = node.arguments[0];

    // Static key — the only kind that can hit a dictionary.
    if (key?.type === 'Literal' && typeof key.value === 'string') {
      const zh = key.value;
      const en = node.arguments[1]?.type === 'Literal' ? node.arguments[1].value : null;
      if (!used.has(zh) || (!used.get(zh) && en)) used.set(zh, en);
      (usedIn.get(zh) ?? usedIn.set(zh, new Set()).get(zh)).add(where);
      return;
    }

    // Interpolated key — untranslatable by construction.
    if (key?.type === 'TemplateLiteral' && key.expressions.length > 0) {
      dynamicKeys.push({ file: where, line: key.loc?.start.line, raw: key.quasis.map((q) => q.value.raw).join('${…}') });
    }
  });
}

// A translation has to carry every {placeholder} its key does — the call site
// does a literal .replace('{n}', value), so a dropped placeholder ships a
// literal "{n}" to the user, and a renamed one silently never substitutes.
const placeholders = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
const brokenPlaceholders = [];

// The generated backfill tables, merged the same way App.jsx merges them.
const fillins = (await import(pathToFileURL(resolve(ROOT, 'src/i18nFillins.js')).href)).default;
for (const [lang, entries] of Object.entries(fillins)) {
  record(lang === 'zhcn' ? 'zhcnDict' : `${lang}Dict`, Object.keys(entries));
  for (const [key, value] of Object.entries(entries)) {
    if (placeholders(key) !== placeholders(value)) {
      brokenPlaceholders.push({ lang, key, value });
    }
  }
}

const gaps = {};
for (const [lang, dictName] of Object.entries(LANGS)) {
  const known = dicts[dictName] ?? new Set();
  gaps[lang] = [...used.keys()].filter((k) => !known.has(k) && !INLINE_KEYS.has(k));
}

const total = Object.values(gaps).reduce((sum, list) => sum + list.length, 0);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ used: used.size, gaps, dynamicKeys, brokenPlaceholders }, null, 2));
} else {
  console.log(`i18n check — ${used.size} translatable strings across ${sourceFiles(SRC).length} source files\n`);
  for (const [lang, list] of Object.entries(gaps)) {
    console.log(`  ${lang.padEnd(5)} ${list.length === 0 ? 'ok' : `${list.length} MISSING`}`);
    for (const key of list.slice(0, 10)) {
      const where = [...(usedIn.get(key) ?? [])].join(', ');
      console.log(`        · ${key}  →  ${used.get(key) ?? '(no English gloss)'}   [${where}]`);
    }
    if (list.length > 10) console.log(`        … and ${list.length - 10} more`);
  }
  console.log();
}

let failed = false;

if (dynamicKeys.length > 0) {
  failed = true;
  console.error(`✗ ${dynamicKeys.length} t() call(s) build their key at runtime — these can never match a dictionary:`);
  for (const d of dynamicKeys) console.error(`    ${d.file}:${d.line}  t(\`${d.raw}\`)`);
  console.error('  Rewrite as a static key with a placeholder:');
  console.error("    t('已匯入 {n} 節經文', 'Imported {n} verses').replace('{n}', String(count))\n");
}

if (brokenPlaceholders.length > 0) {
  failed = true;
  console.error(`✗ ${brokenPlaceholders.length} translation(s) lost or renamed a {placeholder}:`);
  for (const b of brokenPlaceholders.slice(0, 20)) {
    console.error(`    [${b.lang}] ${b.key}\n              → ${b.value}`);
  }
  console.error('  The call site does a literal .replace(), so the value never substitutes.\n');
}

if (total > 0) {
  failed = true;
  console.error(
    `✗ ${total} untranslated string(s). Users of those languages will see English (or Chinese for ja/ko/cuvs).\n` +
    '  Add them to src/i18nFillins.js and re-run.',
  );
}

if (failed) process.exit(1);

console.log(`✓ every t() string is translated in all 13 languages`);
console.log('✓ no runtime-built t() keys, no dropped placeholders');
