// Built-in content packs. Every pack is bilingual (see lib/content.js), so
// the same sets are returned for every language; `localizeSet` picks the side.
import { TANG_POEM_SETS } from './content/tangPoems.js';

export const loadLanguageSets = async () => {
  const sets = TANG_POEM_SETS;
  return { sets, verses: sets.flatMap(s => s.verses) };
};
