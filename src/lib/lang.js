// 聽&說 language model. Seven picker options; only three underlying scripts.
//   value            script   annotation   UI dictionary
//   cuv              zh-TW    —            zh (Traditional source strings)
//   cuvs             zh-CN    —            cuvs (zhcnDict)
//   cuv-bpmf         zh-TW    bopomofo     zh
//   cuv-pinyin       zh-TW    pinyin       zh
//   cuvs-pinyin      zh-CN    pinyin       cuvs
//   cuv-yue          zh-TW    —            zh   (read aloud in Cantonese, zh-HK)
//   en               en       —            en
// The internal ids stay `cuv` / `cuvs` / `en` so the rest of the app (set
// language tags, share links, per-player multiplayer versions) needs no
// migration; annotated variants are `<base>-<annotation>`.
export const LANG_OPTIONS = [
  { value: 'cuv', label: '繁體中文' },
  { value: 'cuvs', label: '简体中文' },
  { value: 'cuv-bpmf', label: '繁注' },
  { value: 'cuv-pinyin', label: '繁拼' },
  { value: 'cuv-yue', label: '繁體（粵語）' },
  { value: 'cuvs-pinyin', label: '简拼' },
  { value: 'en', label: 'English' },
];
export const BASE_LANGS = ['cuv', 'cuvs', 'en'];
const LEGACY_EN = new Set(['kjv', 'esv', 'niv']);
export function baseLang(v) {
  const s = String(v || 'cuv');
  if (LEGACY_EN.has(s)) return 'en';
  if (s.startsWith('cuvs')) return 'cuvs';
  if (s === 'en') return 'en';
  return 'cuv';
}
export function annotationOf(v) {
  const s = String(v || '');
  if (s.endsWith('-bpmf')) return 'bpmf';
  if (s.endsWith('-pinyin')) return 'pinyin';
  return null;
}
export function isEnglishLang(v) { return baseLang(v) === 'en'; }
// 繁體（粵語）: the same 繁體 text, read aloud and recited in Cantonese (zh-HK).
// Sets and text are 繁體's; only the voice — and whose recordings play — differ.
export const CANTONESE_VERSION = 'cuv-yue';
export function isCantoneseVersion(v) { return v === CANTONESE_VERSION; }
// Where recordings for a set live for someone reading `version`. Cantonese
// readers get their own bucket (`<id>@yue`) so a Mandarin recording never
// plays for them (and theirs never for Mandarin readers). Idempotent.
export function voiceBucketFor(id, version) {
  if (!id) return id || null;
  const s = String(id);
  if (!isCantoneseVersion(version) || s.includes('@')) return s;
  return `${s}@yue`;
}
// UI dictionary id for a version: 'zh' (Traditional), 'cuvs' (Simplified), 'en'.
export function uiLangFor(v) {
  const b = baseLang(v);
  return b === 'en' ? 'en' : b === 'cuvs' ? 'cuvs' : 'zh';
}
export function langLabel(v) { return (LANG_OPTIONS.find(o => o.value === v) || {}).label || String(v); }
