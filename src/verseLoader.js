// Built-in content packs. Every pack is bilingual (see lib/content.js), so
// the same sets are returned for every language; `localizeSet` picks the side.
import { TANG_POEM_SETS } from './content/tangPoems.js';
import { DAODEJING_SETS } from './content/daodejing.js';

// Each built-in set shows a classical Chinese painting behind it
// (see BUILT_IN_BACKGROUNDS in setBackgrounds.js).
export const BUILT_IN_SET_BACKGROUNDS = {
  'tang300-wuyan-jueju': 'guofeng-wujue',
  'tang300-qiyan-jueju': 'guofeng-qijue',
  'tang300-wuyan-lushi': 'guofeng-wulu',
  'tang300-qiyan-lushi': 'guofeng-qilu',
  'tang300-wuyan-gushi': 'guofeng-wugu',
  'tang300-qiyan-gushi': 'guofeng-qigu',
  'tang300-yuefu': 'guofeng-yuefu',
  daodejing: 'guofeng-dao',
};

const withBackground = (set) => (BUILT_IN_SET_BACKGROUNDS[set.id] && !set.background
  ? { ...set, background: `preset:${BUILT_IN_SET_BACKGROUNDS[set.id]}` }
  : set);

export const loadLanguageSets = async () => {
  const sets = [...DAODEJING_SETS, ...TANG_POEM_SETS].map(withBackground);
  return { sets, verses: sets.flatMap(s => s.verses) };
};
