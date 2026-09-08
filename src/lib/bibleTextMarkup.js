// bolls.life embeds translator markup inside the verse text. Stripping it
// wrongly is not cosmetic: an earlier version of this logic removed only the
// TAGS and left their contents, which is how src/verses_kjv.js came to ship
// verses reading "What man376 is he that feareth3373 the LORD3068" — the
// numbers are Strong's Concordance references that were never meant to be seen.
//
// Imported by both src/App.jsx (runtime secondary-language fetch) and
// scripts/build-inherit-land.mjs (data generation), so the two can't drift.

export function stripBollsMarkup(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, ' ')
    // Contents-and-all: <S>3068</S> is a reference number, not a word.
    .replace(/<S>\s*\d+\s*<\/S>/gi, '')
    .replace(/<sup>[\s\S]*?<\/sup>/gi, '')
    // Every other tag keeps its contents. <i> in CUV wraps words the
    // translators supplied; those are part of the verse and must stay.
    .replace(/<[^>]+>/g, '')
    // KJV carries translator notes appended AFTER the verse:
    //   "…shall inherit the earth. dwell: Heb. lodge in goodness"
    // Match on the marker rather than the colon, so real mid-verse colons
    // ("for our iniquities: the chastisement of our peace") survive.
    .replace(/\s+\S+:\s+(?:Heb\.|Gr\.|Chal\.|or,)[\s\S]*$/u, '')
    // CUV marks an alternative rendering inline with lenticular brackets:
    //   "救我們脫離凶惡〔或作「脫離惡者」〕。"
    // Only 或作/或譯 notes are removed. A bare 〔…〕 can hold words the
    // translators supplied that ARE part of the reading, so it is left alone.
    .replace(/〔\s*或[作译譯][\s\S]*?〕/gu, '')
    .replace(/\s+([,.;:?!])/g, '$1')
    // Runs of 2+ whitespace are STRUCTURE, not sloppy formatting. bolls' Hebrew
    // text (HAC) encodes the Masoretic caesura as a run of non-breaking spaces:
    //   "כז··סור מרע ועשה־טוב····ושכן לעולם"
    //   "ד שמע ישראל··יהוה אלהינו יהוה אחד"   ← the Shema, split where tradition does
    // Collapsing that to a single space — which this function used to do — threw
    // away the only clause division Hebrew ships with. Preserved here as a
    // double space: invisible in HTML (which collapses whitespace when
    // rendering) but detectable by the phrase splitter.
    .replace(/[\s ]{2,}/g, '  ')
    .replace(/[\s ]/g, ' ')
    .trim();
}

// ─── Hebrew verse numerals ────────────────────────────────────────────────
// bolls prefixes every Hebrew verse with its number written in Hebrew letters,
// separated by the same gap it uses for the caesura:
//   "א··בני אם־תקח אמרי····ומצותי תצפן אתך"
// Left alone, those letters render as if they were scripture — a lone א sitting
// in the middle of Proverbs 2.
//
// They CANNOT be identified by shape: כה (25) is also "thus", לא (31) is "not",
// לו (36) is "to him" — all ordinary words, and all three really do open a verse
// somewhere in Psalm 119. Removal is only safe because the caller knows which
// verse it just fetched: we match ONE exact expected numeral, and only when the
// structural gap follows it.
const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

export function hebrewVerseNumeral(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 499) return '';
  const out = HUNDREDS[Math.floor(num / 100)] || '';
  const rest = num % 100;
  // 15 and 16 are written טו / טז, never יה / יו — those spell the divine name.
  if (rest === 15) return out + 'טו';
  if (rest === 16) return out + 'טז';
  return out + (TENS[Math.floor(rest / 10)] || '') + (ONES[rest % 10] || '');
}

export function stripLeadingVerseNumeral(text, verseNumber) {
  const numeral = hebrewVerseNumeral(verseNumber);
  if (!numeral) return String(text || '');
  // The trailing gap is what proves it is a marker and not the first word.
  return String(text || '').replace(new RegExp(`^${numeral}\\s{2,}`, 'u'), '');
}
