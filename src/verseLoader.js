import { baseLang } from './lib/lang.js';

// Built-in content per base language. (Phase 1 still ships the VerseRain
// sets as placeholders; Phase 2 replaces them with the 聽&說 content packs.)
export const loadLanguageSets = async (lang) => {
  switch (baseLang(lang)) {
    case 'cuv': {
      const [m, p] = await Promise.all([import('./verses'), import('./verses_proverbs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_ZH, ...m.VERSE_SETS];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'cuvs': {
      const [m, p] = await Promise.all([import('./verses_cuvs'), import('./verses_proverbs_cuvs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_CUVS, ...m.VERSE_SETS_CUVS];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'en': {
      const [m, p] = await Promise.all([import('./verses_kjv'), import('./verses_proverbs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_KJV, ...m.VERSE_SETS_KJV];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    default:
      return { sets: [], verses: [] };
  }
};
