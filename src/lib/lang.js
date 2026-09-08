// 聽&說 language model. Five picker options; only three underlying scripts.
//   value            script   annotation   UI dictionary
//   cuv              zh-TW    —            zh (Traditional source strings)
//   cuvs             zh-CN    —            cuvs (zhcnDict)
//   cuv-bpmf         zh-TW    bopomofo     zh
//   cuvs-pinyin      zh-CN    pinyin       cuvs
//   en               en       —            en
// The internal ids stay `cuv` / `cuvs` / `en` so the rest of the app (set
// language tags, share links, per-player multiplayer versions) needs no
// migration; annotated variants are `<base>-<annotation>`.
export const LANG_OPTIONS = [
  { value: 'cuv', label: '繁體中文' },
  { value: 'cuvs', label: '简体中文' },
  { value: 'cuv-bpmf', label: '繁體與注音符號' },
  { value: 'cuvs-pinyin', label: '简体与罗马拼音' },
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
// UI dictionary id for a version: 'zh' (Traditional), 'cuvs' (Simplified), 'en'.
export function uiLangFor(v) {
  const b = baseLang(v);
  return b === 'en' ? 'en' : b === 'cuvs' ? 'cuvs' : 'zh';
}
export function langLabel(v) { return (LANG_OPTIONS.find(o => o.value === v) || {}).label || String(v); }
