// English translations for the built-in 《唐詩三百首》, newer than the 1929
// Bynner lines baked into tangPoems.js. Keyed by "<set id>|<item reference>".
// Where a poem has more than one translation, the newest one is used.
//
// Betty Tseng 曾培慈, 英譯唐詩三百首 English Translation of 320 Tang Poems
// (2009–2011), https://28utscprojects.wordpress.com/ — licensed under
// Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported.
// Lines are joined two to a couplet so they line up with the Chinese.
export const TSENG_2011 = {
  translator: 'Betty Tseng 曾培慈',
  year: 2011,
  license: 'CC BY-NC-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
};

export const TANG_TRANSLATIONS = {
  'tang300-wuyan-gushi|送別 · 王維': {
    ...TSENG_2011,
    url: 'https://28utscprojects.wordpress.com/2011/01/21/013/',
    textEn: [
      'I invited you to dismount and have some wine, "Where to from here?" I enquired.',
      "You acknowledged you weren't having your moment, To the foot of the Zhongnan Mountains you wished to retire.",
      "Off you went and I asked no further, I knew you'd find in observing white clouds everlasting delight.",
    ].join('\n'),
  },
};

// The set with every translation laid over its items (the translator travels
// with the item so the reader can credit it).
export function withTranslations(set) {
  if (!set?.verses?.some(v => TANG_TRANSLATIONS[`${set.id}|${v.reference}`])) return set;
  return {
    ...set,
    verses: set.verses.map((v) => {
      const tr = TANG_TRANSLATIONS[`${set.id}|${v.reference}`];
      if (!tr) return v;
      const { textEn, ...credit } = tr;
      return { ...v, textEn, translation: credit };
    }),
  };
}
