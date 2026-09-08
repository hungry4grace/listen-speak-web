export const loadLanguageSets = async (lang) => {
  switch (lang) {
    case 'cuv': {
      const [m, p] = await Promise.all([import('./verses'), import('./verses_proverbs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_ZH, ...m.VERSE_SETS];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'tw': {
      const m = await import('./verses_tw.js');
      return { sets: m.VERSE_SETS_TW, verses: m.VERSE_SETS_TW.flatMap(s => s.verses) };
    }
    case 'kjv': {
      const [m, p] = await Promise.all([import('./verses_kjv'), import('./verses_proverbs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_KJV, ...m.VERSE_SETS_KJV];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'esv': {
      const m = await import('./verses_esv');
      return { sets: m.VERSE_SETS_ESV, verses: m.VERSE_SETS_ESV.flatMap(s => s.verses) };
    }
    case 'ja': {
      const [m, p] = await Promise.all([import('./verses_ja'), import('./verses_proverbs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_JA, ...m.VERSE_SETS_JA];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'ko': {
      const [m, p] = await Promise.all([import('./verses_ko'), import('./verses_proverbs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_KO, ...m.VERSE_SETS_KO];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'fa': {
      const m = await import('./verses_fa');
      return { sets: m.VERSE_SETS_FA, verses: m.VERSE_SETS_FA.flatMap(s => s.verses) };
    }
    case 'ar': {
      const m = await import('./verses_ar');
      return { sets: m.VERSE_SETS_AR, verses: m.VERSE_SETS_AR.flatMap(s => s.verses) };
    }
    case 'he': {
      const m = await import('./verses_he');
      return { sets: m.VERSE_SETS_HE, verses: m.VERSE_SETS_HE.flatMap(s => s.verses) };
    }
    case 'es': {
      const m = await import('./verses_es');
      return { sets: m.VERSE_SETS_ES, verses: m.VERSE_SETS_ES.flatMap(s => s.verses) };
    }
    case 'tr': {
      const m = await import('./verses_tr');
      return { sets: m.VERSE_SETS_TR, verses: m.VERSE_SETS_TR.flatMap(s => s.verses) };
    }
    case 'de': {
      const m = await import('./verses_de');
      return { sets: m.VERSE_SETS_DE, verses: m.VERSE_SETS_DE.flatMap(s => s.verses) };
    }
    case 'cuvs': {
      const [m, p] = await Promise.all([import('./verses_cuvs'), import('./verses_proverbs_cuvs')]);
      const sets = [...p.VERSE_SETS_PROVERBS_CUVS, ...m.VERSE_SETS_CUVS];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'my': {
      const m = await import('./verses_my');
      return { sets: m.VERSE_SETS_MY, verses: m.VERSE_SETS_MY.flatMap(s => s.verses) };
    }
    case 'vi': {
      const m = await import('./verses_vi');
      return { sets: m.VERSE_SETS_VI, verses: m.VERSE_SETS_VI.flatMap(s => s.verses) };
    }
    case 'niv': {
      const [m, p] = await Promise.all([import('./verses_niv'), import('./verses_proverbs_niv')]);
      const sets = [...p.VERSE_SETS_PROVERBS_NIV, ...m.VERSE_SETS_NIV];
      return { sets, verses: sets.flatMap(s => s.verses) };
    }
    case 'id': {
      const m = await import('./verses_id');
      return { sets: m.VERSE_SETS_ID, verses: m.VERSE_SETS_ID.flatMap(s => s.verses) };
    }
    case 'ms': {
      const m = await import('./verses_ms');
      return { sets: m.VERSE_SETS_MS, verses: m.VERSE_SETS_MS.flatMap(s => s.verses) };
    }
    case 'pt': {
      const m = await import('./verses_pt');
      return { sets: m.VERSE_SETS_PT, verses: m.VERSE_SETS_PT.flatMap(s => s.verses) };
    }
    case 'fr': {
      const m = await import('./verses_fr');
      return { sets: m.VERSE_SETS_FR, verses: m.VERSE_SETS_FR.flatMap(s => s.verses) };
    }
    case 'ru': {
      const m = await import('./verses_ru');
      return { sets: m.VERSE_SETS_RU, verses: m.VERSE_SETS_RU.flatMap(s => s.verses) };
    }
    case 'hi': {
      const m = await import('./verses_hi');
      return { sets: m.VERSE_SETS_HI, verses: m.VERSE_SETS_HI.flatMap(s => s.verses) };
    }
    default:
      return { sets: [], verses: [] };
  }
};
