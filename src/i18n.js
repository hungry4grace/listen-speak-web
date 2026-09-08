// Shared i18n helpers for screens that live OUTSIDE the main App component.
//
// App.jsx owns the big hand-written dictionaries and passes its `t` down as a
// prop (TeamsModal, BlindModeGame, WorldMap, …). But /blind renders
// BlindScriptureApp as its own root — it never sees App's `t`, which is why all
// of its prompts were hardcoded Traditional Chinese regardless of the user's
// language. createT() gives those standalone roots the same translation
// behaviour, backed by the generated tables in i18nFillins.js.

// Explicit .js extension: Vite would resolve it either way, but this module is
// also loaded by scripts/check-i18n.mjs under plain Node ESM, which won't.
import I18N_FILLINS from './i18nFillins.js';

// UI language → the key used inside I18N_FILLINS. 'en' and 'zh' need no table:
// they are the two arguments to t() itself.
const TABLE_BY_LANG = {
  he: 'he', fa: 'fa', ar: 'ar', ja: 'ja', ko: 'ko', es: 'es', tr: 'tr',
  de: 'de', my: 'my', vi: 'vi', id: 'id', ms: 'ms', cuvs: 'zhcn',
};

export const SUPPORTED_UI_LANGS = ['zh', 'cuvs', 'en', ...Object.keys(TABLE_BY_LANG).filter((l) => l !== 'cuvs')];

// BCP-47 tags for speech synthesis / recognition. The accessible mode reads
// verses aloud and listens for the recitation, so a Korean user must get a
// Korean voice — not the zh-TW one that used to be hardcoded.
export const SPEECH_LANG = {
  zh: 'zh-TW', cuvs: 'zh-CN', en: 'en-US', he: 'he-IL', fa: 'fa-IR', ar: 'ar-SA',
  ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', tr: 'tr-TR', de: 'de-DE', my: 'my-MM',
  vi: 'vi-VN', id: 'id-ID', ms: 'ms-MY',
};

// The user's UI language: a share link's ?lang= wins (so a link opens in the
// language it was sent in), then their saved preference, then Traditional
// Chinese — matching App.jsx's own resolution order.
export function resolveUiLang() {
  try {
    const linkLang = new URLSearchParams(window.location.search).get('lang');
    if (linkLang && SUPPORTED_UI_LANGS.includes(linkLang)) return linkLang;
    const stored = localStorage.getItem('verseRain_uiLang');
    if (stored && SUPPORTED_UI_LANGS.includes(stored)) return stored;
  } catch { /* SSR / storage disabled */ }
  return 'zh';
}

// t(zh, en) — same contract as App.jsx's t: Traditional Chinese key, English
// gloss as the fallback. ja/ko/cuvs fall back to the Chinese key (their scripts
// are closer to it than to English) exactly as App.jsx does.
export function createT(uiLang) {
  const table = I18N_FILLINS[TABLE_BY_LANG[uiLang]];
  return (zh, en) => {
    if (uiLang === 'en') return en || zh;
    if (uiLang === 'zh') return zh;
    const hit = table?.[zh];
    if (hit) return hit;
    return ['ja', 'ko', 'cuvs'].includes(uiLang) ? zh : (en || zh);
  };
}
