// Shared 台語漢字本 scraping helpers — used by build-verses-tw.mjs (local
// topic files) and build-topic-sets-tw.mjs (PartyKit published topic sets).
// Source: lingshyang.com/taiwan_Bible. Chapter pages cache under
// .cache-taibible/ next to this file.

import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CACHE = path.join(HERE, '.cache-taibible');
const BASE = 'https://lingshyang.com/taiwan_Bible';

// ── Site book codes ────────────────────────────────────────────────────────
export const BOOK_CODE = {
  '創世記': 'gen', '創世紀': 'gen', '出埃及記': 'exo', '利未記': 'lev', '民數記': 'num',
  '申命記': 'deu', '約書亞記': 'jos', '士師記': 'jug', '路得記': 'rut',
  '撒母耳記上': '1sa', '撒母耳記下': '2sa', '列王紀上': '1ki', '列王記上': '1ki',
  '列王紀下': '2ki', '列王記下': '2ki', '歷代志上': '1ch', '歷代志下': '2ch',
  '以斯拉記': 'ezr', '尼希米記': 'neh', '以斯帖記': 'est', '約伯記': 'job',
  '詩篇': 'psm', '箴言': 'pro', '傳道書': 'ecc', '雅歌': 'son',
  '以賽亞書': 'isa', '耶利米書': 'jer', '耶利米哀歌': 'lam', '以西結書': 'eze',
  '但以理書': 'dan', '何西阿書': 'hos', '約珥書': 'joe', '阿摩司書': 'amo',
  '俄巴底亞書': 'oba', '約拿書': 'jon', '彌迦書': 'mic', '那鴻書': 'nah',
  '哈巴谷書': 'hab', '西番雅書': 'zep', '哈該書': 'hag', '撒迦利亞書': 'zec',
  '撒迦利亞': 'zec', '瑪拉基書': 'mal',
  '馬太福音': 'mat', '馬可福音': 'mak', '路加福音': 'luk', '約翰福音': 'jhn',
  '使徒行傳': 'act', '羅馬書': 'rom', '哥林多前書': '1co', '歌林多前書': '1co',
  '哥林多後書': '2co', '歌林多後書': '2co', '加拉太書': 'gal', '以弗所書': 'eph',
  '腓立比書': 'phl', '腓利比書': 'phl', '歌羅西書': 'col',
  '帖撒羅尼迦前書': '1ts', '帖撒羅尼迦後書': '2ts',
  '提摩太前書': '1ti', '提摩太後書': '2ti', '提多書': 'tit', '腓利門書': 'mon',
  '希伯來書': 'heb', '雅各書': 'jas', '彼得前書': '1pe', '彼得後書': '2pe',
  '約翰一書': '1jn', '約翰二書': '2jn', '約翰三書': '3jn', '猶大書': 'jud',
  '啟示錄': 'rev',
  // Short forms used by some sets in verses.js
  '約': 'jhn', '耶': 'jer', '羅': 'rom', '約一': '1jn', '弗': 'eph', '賽': 'isa',
  '書': 'jos', '申': 'deu', '詩': 'psm', '腓': 'phl', '太': 'mat', '林後': '2co',
  '出': 'exo', '番': 'zep', '民': 'num', '創': 'gen', '利': 'lev', '箴': 'pro',
  '路': 'luk', '可': 'mak', '徒': 'act', '來': 'heb', '彼前': '1pe', '彼後': '2pe',
  '雅': 'jas', '西': 'col', '加': 'gal', '帖前': '1ts', '帖後': '2ts', '提前': '1ti',
  '提後': '2ti', '林前': '1co', '啟': 'rev', '但': 'dan', '結': 'eze', '珥': 'joe',
};

// ── Image-glyph → Unicode ─────────────────────────────────────────────────
// Each mapping was determined from in-context readings (the site glosses
// most of them with POJ romanization). Where the authentic rare character
// has poor font coverage, a common readable variant is used instead.
export const GLYPH_MAP = {
  boe: '袂',    // bē — cannot
  in: '𪜶',     // in — they/their (MOE official)
  tiam: '踮',   // tiàm — at/stay
  tiau: '牢',   // tiâu — pen/stable; 徛袂牢
  gau: '賢',    // gâu — capable ("賢交戰")
  hiat: '㧒',   // hiat — throw ("㧒佇海中")
  ki: '基',     // 基路兵 (cherubim) first syllable
  lo: '路',     // 基路兵 second syllable
  ko: '哥',     // thái-ko 癩哥 — leprosy
  lut: '甪',    // lut — slip off ("對恩典的位甪落")
  moa: '幔',    // moa — cover/cloak
  nit: '躡',    // nih — blink ("目躡")
  nith: '躡',   // same glyph, alt filename
  oh: '僫',     // oh — difficult ("入上帝的國僫啊")
  poa: '盤',    // pôaⁿ — cross over ("盤過")
  sui: '遂',    // 半遂 — paralyzed
  teh: '啲',    // teh — progressive particle (site prints 啲 elsewhere)
  teng: '碇',   // tēng — hard ("碇石")
  thang: '迵',  // thàng — all the way through ("行未迵")
  thoa: '豸',   // thōa — 蟲豸 worm
  thun: '踐',   // thún — trample ("踐踏")
  ti: '蹬',     // 腳後蹬 — heel
  to: '杜',     // 杜蚓 — earthworm
  tok: '度',    // 測度 — to measure
  phoe: '頰',   // phóe — cheek ("嘴頰")
  chhih: '匆',  // chhih-chhih — bustling ("無閒匆匆", 詩39:6)
  nih: '躡',    // nih — blink (一目躡久, 路4:5)
  tioh: '著',   // tio̍h — 著舌根 tongue-tied (賽32:4)
  chong: '傱',  // chông — rush/dash (傱落山崁, 路8:33)
};

// ── Fetch with cache ───────────────────────────────────────────────────────
fs.mkdirSync(CACHE, { recursive: true });
export async function fetchChapter(code, chapter) {
  const key = `${code}${chapter}.htm`;
  const cached = path.join(CACHE, key);
  if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8');
  const url = `${BASE}/${code}/${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  if (!/：|:/.test(html)) throw new Error(`Suspicious empty page: ${url}`);
  fs.writeFileSync(cached, html);
  await new Promise(r => setTimeout(r, 250)); // be polite to the host
  return html;
}

// ── Chapter HTML → { verseNum: text } ─────────────────────────────────────
export const unknownGlyphs = new Set();
export function parseChapter(html, chapter) {
  // Mark image glyphs as placeholders first (some sit INSIDE romanization
  // glosses that get stripped below — those never need a mapping).
  let s = html.replace(/<img\s[^>]*src="\.\.\/([a-z0-9]+)\.jpg"[^>]*\/?>/gi, (_, name) => `⟦${name}⟧`);
  const out = {};
  // <td> may carry attributes (highlighted "golden verses" get bgcolor).
  const re = new RegExp(`${chapter}:(\\d+)\\s*</font>\\s*<td[^>]*>([\\s\\S]*?)(?=<tr>|</table>|</TABLE>|$)`, 'g');
  let m;
  while ((m = re.exec(s)) !== null) {
    const v = parseInt(m[1], 10);
    let text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, '')
      // Drop inline POJ pronunciation glosses like (tiâu) / （nih）— they
      // may themselves contain glyph placeholders for POJ letters.
      .replace(/[（(][^（()）]*[A-Za-zÀ-ɏ][^（()）]*[）)]/g, '')
      // Unterminated gloss (site markup glitch, e.g. "牨(káng…") — drop the
      // open paren + latin run.
      .replace(/[（(][A-Za-zÀ-ɏ·ⁿ\-\s]+/g, '')
      .replace(/⟦([a-z0-9]+)⟧/g, (_, name) => {
        if (GLYPH_MAP[name]) return GLYPH_MAP[name];
        unknownGlyphs.add(name);
        return `⟦${name}⟧`;
      })
      // A few pages type POJ words as plain text instead of glyph images.
      .replace(/bõe|boe/g, '袂')
      .replace(/teh/g, '啲')
      .replace(/in/g, '𪜶')
      .replace(/i(?=𪜶)/g, '')
      // Catch-all: any remaining stray latin run is markup debris.
      .replace(/[A-Za-zÀ-ɏõ]+/g, '')
      .trim();
    if (text) out[v] = text;
  }
  return out;
}

// ── Reference parsing ──────────────────────────────────────────────────────
// Handles: "約翰福音 3:16", "馬太福音28:19-20" (no space), "詩篇 1" (whole
// chapter), en/em dashes, comma lists "3:16,18".
export function parseReference(refRaw) {
  const ref = String(refRaw).replace(/[–—]/g, '-').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFF10)).trim();
  const m = ref.match(/^(.+?)\s*(\d+)(?::([\d,\-\s]+))?\s*$/);
  if (!m) throw new Error(`Unparseable reference: "${refRaw}"`);
  const book = m[1].trim();
  const code = BOOK_CODE[book];
  if (!code) throw new Error(`Unknown book "${book}" in reference "${refRaw}"`);
  const chapter = parseInt(m[2], 10);
  let verses = null; // null → whole chapter
  if (m[3]) {
    verses = [];
    for (const part of m[3].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const r = p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (r) { for (let i = +r[1]; i <= +r[2]; i++) verses.push(i); }
      else verses.push(parseInt(p, 10));
    }
  }
  return { book, code, chapter, verses };
}


// Chapter-level memo on top of the disk cache.
const chapterMemo = new Map();
export async function getChapter(code, chapter) {
  const key = `${code}|${chapter}`;
  if (!chapterMemo.has(key)) {
    chapterMemo.set(key, parseChapter(await fetchChapter(code, chapter), chapter));
  }
  return chapterMemo.get(key);
}

// reference → Taiwanese text ('' on failure; caller reports misses).
export async function taiwaneseTextForReference(reference, misses = []) {
  let parsed;
  try { parsed = parseReference(reference); }
  catch (e) { misses.push(e.message); return ''; }
  try {
    const chap = await getChapter(parsed.code, parsed.chapter);
    const nums = parsed.verses || Object.keys(chap).map(Number).sort((a, b) => a - b);
    const parts = nums.map(n => chap[n]).filter(Boolean);
    if (!parts.length || (parsed.verses && parts.length < parsed.verses.length)) {
      misses.push(`${reference} — got ${parts.length}/${nums.length} verses`);
    }
    return parts.join('');
  } catch (e) { misses.push(`${reference} — ${e.message}`); return ''; }
}
