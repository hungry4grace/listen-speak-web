// Text fix-ups applied to Chinese text right before it goes to the browser's
// speech engine. The engine (Apple / Google TTS) picks heteronym readings on
// its own and we can't pass phonetics through the Web Speech API, so the only
// lever is swapping a character for an unambiguous homophone in the SPOKEN
// string. The displayed text is never touched.
//
// 地: engines see 「承受地土為業」 and read 地 as the adverbial particle "de"
// (like 慢慢地). We replace noun-地 (dì) with 第, which every engine reads dì,
// and leave adverbial 地 alone so it still reads "de". Decision order:
//   1. next character makes a noun compound (地上 地土 地方 地球 地板 …) → dì
//   2. reduplication / 然 / 切 before it (平平安安地, 笑嘻嘻地, 熱切地) → de
//   3. previous character makes a noun compound (大地 天地 全地 陸地 各地 …) → dì
//   4. end of clause (遍地，) → dì
//   5. otherwise `defaultReading`: 'di' for Bible text (地 is almost always the
//      noun there) or 'de' for textbook prose (開心地笑了, 溫柔地告訴 …).
//
// 和 in 耶和華 (God's name) is hé, but Taiwan voices read 和 as the
// conjunction "hàn" (你和我). The name is never anything else, so 耶和華 is
// spoken as 耶合華 (合 is always hé).
//
// This file is shared verbatim between verserain-web, creativechinese-web and
// listen-speak-web.
// Tests: node --test src/lib/speechText.test.mjs

const NOUN_NEXT = new Set('上土極裡下面基獄步方震底位界主產業名中間球帶區點契圖質表層勢段形域殼洞穴皮板標址鐵毯窖攤瓜雷勤理政稅貌心');
const NOUN_PREV = new Set('大天全遍土陸平草田場各空高沙雪綠濕領基聖盆山林墓耕農荒之此當本外兩內異滿落倒著就席掃種佔占墾谷窪陣營用工戰境低乾濕餘寸尺坡林窪灘園');
const ADVERB_PREV = /[然切]$/;
const CLAUSE_END = /^[，。、；：！？!?,.;:\s「」『』（）()…—]$/;

function isReduplicated(before) {
  // AA地 (慢慢地), AABB地 (平平安安地), ABAB地 (認真認真地), ABB地 (笑嘻嘻地)
  const n = before.length;
  if (n >= 2 && before[n - 1] === before[n - 2]) return true;
  if (n >= 4 && before[n - 1] === before[n - 3] && before[n - 2] === before[n - 4]) return true;
  return false;
}

export function fixChineseHeteronymsForSpeech(text, { defaultReading = 'di' } = {}) {
  const s = String(text || '');
  if (!s.includes('地')) return s;
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '地') continue;
    const next = chars[i + 1] || '';
    const prev = chars[i - 1] || '';
    const before = chars.slice(Math.max(0, i - 4), i).join('');
    let di;
    if (NOUN_NEXT.has(next)) di = true;
    else if (isReduplicated(before) || ADVERB_PREV.test(before)) di = false;
    else if (NOUN_PREV.has(prev)) di = true;
    else if (!next || CLAUSE_END.test(next)) di = true;
    else di = defaultReading === 'di';
    if (di) chars[i] = '第';
  }
  return chars.join('');
}

export function fixChineseNamesForSpeech(text) {
  return String(text || '').replace(/耶和(?=[華华])/g, '耶合');
}

// Hebrew: the divine name יהוה is never pronounced. Reading Scripture aloud,
// Jews say Adonai (אֲדֹנָי) — the vowels the Masoretes put on the name — and
// Elohim (אֱלֹהִים) where it stands next to אדני (אֲדֹנָי יְהוִה, "Lord GOD"), so
// it isn't read "Adonai Adonai". Prefix letters stay (וַיהוָה → וַאֲדֹנָי, "va-
// Adonai"); their pointing already matches Adonai. Works on pointed and
// unpointed text. No lookbehind: older iOS Safari can't parse it.
const HE_MARKS = '\\u0591-\\u05BD\\u05BF\\u05C1\\u05C2\\u05C4\\u05C5\\u05C7';
const M = `[${HE_MARKS}]*`;
const NOT_WORD = `(^|[^\\u05D0-\\u05EA${HE_MARKS}])`;
const WORD_END = '(?![\\u05D0-\\u05EA])';
const NAME = `י${M}ה${M}ו${M}ה${M}`;
const ADNY = `א${M}ד${M}נ${M}י${M}`;
const SEP = '[\\s\\u05BE]+';
const ADONAI = 'אֲדֹנָי';
const ELOHIM = 'אֱלֹהִים';
// The classes list Hebrew points/cantillation on purpose (each is matched as
// its own code point), which this rule can't tell from a mistake.
/* eslint-disable no-misleading-character-class */
const RE_ADNY_NAME = new RegExp(`${NOT_WORD}(${ADNY}${SEP})${NAME}${WORD_END}`, 'g');
const RE_NAME_ADNY = new RegExp(`${NOT_WORD}${NAME}(${SEP}${ADNY})${WORD_END}`, 'g');
const RE_NAME = new RegExp(`${NOT_WORD}((?:[ובכלמש]${M}){0,3})${NAME}${WORD_END}`, 'g');
/* eslint-enable no-misleading-character-class */

export function fixHebrewDivineNameForSpeech(text) {
  return String(text || '')
    .replace(RE_ADNY_NAME, `$1$2${ELOHIM}`)
    .replace(RE_NAME_ADNY, `$1${ELOHIM}$2`)
    .replace(RE_NAME, `$1$2${ADONAI}`);
}

// Entry point for every utterance: Chinese and Hebrew get substitutions.
export function toSpeechText(text, lang, opts) {
  const l = String(lang || '');
  if (l.startsWith('he')) return fixHebrewDivineNameForSpeech(text);
  if (!l.startsWith('zh')) return String(text || '');
  return fixChineseHeteronymsForSpeech(fixChineseNamesForSpeech(text), opts);
}
