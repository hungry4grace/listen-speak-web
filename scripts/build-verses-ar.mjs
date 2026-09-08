#!/usr/bin/env node
// Build verses_ar.js by mirroring the KJV topical-set structure and pulling
// each verse's Arabic text from bolls.life SVD (Smith and Van Dyke 1865 —
// the most widely-used Arabic Bible in Protestant churches).
//
// Run: node scripts/build-verses-ar.mjs > src/verses_ar.js

import fs from 'node:fs';
import path from 'node:path';

const BOLLS_SLUG = 'SVD';
const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');

// English book name → bolls book id. Same numbering as Protestant Bible.
const BOOK_ID = {
  Genesis:1, Exodus:2, Leviticus:3, Numbers:4, Deuteronomy:5,
  Joshua:6, Judges:7, Ruth:8,
  '1 Samuel':9, '2 Samuel':10, '1 Kings':11, '2 Kings':12,
  '1 Chronicles':13, '2 Chronicles':14, Ezra:15, Nehemiah:16, Esther:17,
  Job:18, Psalms:19, Psalm:19, Proverbs:20, Ecclesiastes:21,
  'Song of Solomon':22, 'Song of Songs':22,
  Isaiah:23, Jeremiah:24, Lamentations:25, Ezekiel:26, Daniel:27,
  Hosea:28, Joel:29, Amos:30, Obadiah:31, Jonah:32, Micah:33,
  Nahum:34, Habakkuk:35, Zephaniah:36, Haggai:37, Zechariah:38, Malachi:39,
  Matthew:40, Mark:41, Luke:42, John:43, Acts:44, Romans:45,
  '1 Corinthians':46, '2 Corinthians':47, Galatians:48, Ephesians:49,
  Philippians:50, Colossians:51,
  '1 Thessalonians':52, '2 Thessalonians':53,
  '1 Timothy':54, '2 Timothy':55, Titus:56, Philemon:57,
  Hebrews:58, James:59, '1 Peter':60, '2 Peter':61,
  '1 John':62, '2 John':63, '3 John':64, Jude:65, Revelation:66,
  // Chinese single-char abbreviations appearing in verses_kjv.js
  '詩':19, '耶':24, '番':36, '賽':23, '弗':49, '羅':45,
  '約':43, '民':4, '腓':50, '出':2, '申':5, '書':6,
  '太':40, '林後':47, '林前':46, '約一':62, '約二':63, '約三':64,
};

// English book name → Arabic SVD book name (used for reference field, so the
// normalize pipeline can match it against MULTILANG_FULL_BOOK_ID).
const BOOK_AR = {
  1:'تكوين',2:'خروج',3:'لاويين',4:'عدد',5:'تثنية',
  6:'يشوع',7:'قضاة',8:'راعوث',9:'1صموئيل',10:'2صموئيل',
  11:'1ملوك',12:'2ملوك',13:'1أخبار',14:'2أخبار',
  15:'عزرا',16:'نحميا',17:'أستير',18:'أيوب',19:'مزامير',20:'أمثال',
  21:'جامعة',22:'نشيد الأنشاد',23:'إشعياء',24:'إرميا',25:'مراثي إرميا',
  26:'حزقيال',27:'دانيال',28:'هوشع',29:'يوئيل',30:'عاموس',
  31:'عوبديا',32:'يونان',33:'ميخا',34:'ناحوم',35:'حبقوق',
  36:'صفنيا',37:'حجي',38:'زكريا',39:'ملاخي',
  40:'متى',41:'مرقس',42:'لوقا',43:'يوحنا',44:'أعمال الرسل',
  45:'رومية',46:'1كورنثوس',47:'2كورنثوس',48:'غلاطية',49:'أفسس',
  50:'فيلبي',51:'كولوسي',52:'1تسالونيكي',53:'2تسالونيكي',
  54:'1تيموثاوس',55:'2تيموثاوس',56:'تيطس',57:'فليمون',
  58:'عبرانيين',59:'يعقوب',60:'1بطرس',61:'2بطرس',
  62:'1يوحنا',63:'2يوحنا',64:'3يوحنا',65:'يهوذا',66:'رؤيا يوحنا',
};

// Hand-translated set titles + descriptions (mirrors what other languages
// already do — see verses_tr.js / verses_fa.js).
const SET_META = {
  'mutualized-economics-kjv': {
    id: 'mutualized-economics-ar',
    title: 'الاقتصاد التشاركي (آيات رئيسية)',
    description: 'مبادئ صورة الله والوكالة وآلية اليوبيل وإعادة الضبط.',
  },
  'gospel-of-john-kjv': {
    id: 'gospel-of-john-ar',
    title: 'إنجيل يوحنا (آيات أساسية)',
    description: 'إعلانات ووعود وحقائق مختارة من إنجيل يوحنا.',
  },
  'matthew-important-kjv': {
    id: 'matthew-important-ar',
    title: 'إنجيل متى (آيات مهمة)',
    description: 'آيات رئيسية من إنجيل متى للدراسة والحفظ.',
  },
  'sid-roth-healing-kjv': {
    id: 'sid-roth-healing-ar',
    title: 'آيات تأمل الشفاء',
    description: 'مجموعة آيات للتأمل في الشفاء والإيمان.',
  },
  'chiayi-children-kjv': {
    id: 'chiayi-children-ar',
    title: 'مدرسة الأحد للأطفال',
    description: 'آيات أساسية لأطفال مدرسة الأحد.',
  },
  'psalm18-kjv': {
    id: 'psalm18-ar',
    title: 'المزمور الثامن عشر',
    description: 'المزمور 18 كاملاً (50 آية).',
  },
  'rain-verses': {
    id: 'rain-verses-ar',
    title: 'آيات عن المطر',
    description: 'مجموعة آيات تشبّه كلمة الله بالمطر والندى — تجلب الحياة والنمو.',
  },
  'fathers-love-en': {
    id: 'fathers-love-ar',
    title: 'كلمات محبة الآب',
    description: 'آيات عن محبة الآب السماوي لأبنائه.',
  },
  'identity-manifestation-mission-en': {
    id: 'identity-manifestation-mission-ar',
    title: 'إيقاظ الهوية لظهور المجد',
    description: 'من إعلان البنوة إلى الإرسالية — اكتشف هويتك في المسيح.',
  },
  'power-of-words-en': {
    id: 'power-of-words-ar',
    title: 'موضوع: قدرة الكلام',
    description: 'الموت والحياة في سلطان اللسان — إطلاق قدرة الكلمة الإلهية.',
  },
  'psalms-1-41-kjv': {
    id: 'psalms-book-i-ar',
    title: 'المزامير — السفر الأول (1–41)',
    description: 'السفر الأول من المزامير، معظمه لداود — صلاة شخصية، معاناة، وعهد مع الله.',
  },
  'psalms-42-72-kjv': {
    id: 'psalms-book-ii-ar',
    title: 'المزامير — السفر الثاني (42–72)',
    description: 'السفر الثاني — مزامير بني قورح ومجموعة داودية ثانية، تختتم بـ «تَمَّتْ صَلَوَاتُ دَاوُدَ بْنِ يَسَّى» (72:20).',
  },
  'psalms-73-89-kjv': {
    id: 'psalms-book-iii-ar',
    title: 'المزامير — السفر الثالث (73–89)',
    description: 'السفر الثالث — أصاف يهيمن عليه (73–83)، يصارع أزمة وطنية ويتشبث بالعهد.',
  },
  'psalms-90-106-kjv': {
    id: 'psalms-book-iv-ar',
    title: 'المزامير — السفر الرابع (90–106)',
    description: 'سفر «ملكوت الرب» — يبدأ بصلاة موسى (90) ويرتفع إلى مزامير الملك «الرب قد ملك» (93, 96, 97, 99).',
  },
  'psalms-107-150-kjv': {
    id: 'psalms-book-v-ar',
    title: 'المزامير — السفر الخامس (107–150)',
    description: 'السفر الخامس والأطول — مزامير الهلل (113–118)، مزامير المصاعد (120–134)، المزمور 119، وتسبيح الختام (146–150).',
  },
};

// ── Parse references ──────────────────────────────────────────────────────
// "Genesis 1:26-28" → { bookId: 1, chapter: 1, verses: [26,27,28] }
// "Leviticus 25:10, 23" → { bookId: 3, chapter: 25, verses: [10,23] }
// "Psalm 18" (chapter-only) → { bookId: 19, chapter: 18, verses: null }
function parseRef(ref) {
  const v = String(ref).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  // book is everything up to last numeric+colon section
  const m = v.match(/^(.+?)\s+(\d+)(?::([\d,\-\s]+))?$/);
  if (!m) throw new Error(`Cannot parse reference "${ref}"`);
  const bookRaw = m[1].trim();
  const chapter = parseInt(m[2], 10);
  const versePart = m[3];
  const bookId = BOOK_ID[bookRaw];
  if (!bookId) throw new Error(`Unknown book "${bookRaw}" in ref "${ref}"`);
  if (!versePart) return { bookId, chapter, verses: null };
  // expand ranges and commas
  const verses = [];
  for (const seg of versePart.split(',').map(s => s.trim()).filter(Boolean)) {
    if (seg.includes('-')) {
      const [a, b] = seg.split('-').map(s => parseInt(s.trim(), 10));
      for (let i = a; i <= b; i++) verses.push(i);
    } else {
      verses.push(parseInt(seg, 10));
    }
  }
  return { bookId, chapter, verses };
}

function stripMarkup(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Bolls fetch with caching ───────────────────────────────────────────────
const cache = new Map();
async function fetchChapter(bookId, chapter) {
  const k = `${bookId}|${chapter}`;
  if (cache.has(k)) return cache.get(k);
  const url = `https://bolls.life/get-text/${BOLLS_SLUG}/${bookId}/${chapter}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const arr = await res.json();
  cache.set(k, arr);
  return arr;
}

async function fetchArabicText(bookId, chapter, verses /* number[] | null */) {
  const arr = await fetchChapter(bookId, chapter);
  const map = new Map(arr.map(v => [Number(v.verse), stripMarkup(v.text)]));
  if (!verses) {
    // chapter-only — concat with spaces
    return arr.map(v => stripMarkup(v.text)).join(' ').trim();
  }
  const texts = verses.map(v => map.get(v) || '').filter(Boolean);
  return texts.join(' ').trim();
}

function arabicRef(bookId, chapter, verses) {
  const book = BOOK_AR[bookId];
  if (!verses) return `${book} ${chapter}`;
  // Format verses with same shape as input (preserve range if contiguous)
  if (verses.length === 1) return `${book} ${chapter}:${verses[0]}`;
  // Contiguous range?
  const sorted = [...verses].sort((a, b) => a - b);
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (contiguous) return `${book} ${chapter}:${sorted[0]}-${sorted[sorted.length - 1]}`;
  return `${book} ${chapter}:${sorted.join(',')}`;
}

// ── Load verses_kjv.js as data ─────────────────────────────────────────────
// Read the source and eval as an expression. KJV file is plain JS literal
// inside `export const VERSE_SETS_KJV = [...]`.
const kjvSrc = fs.readFileSync(path.join(SRC, 'verses_kjv.js'), 'utf8');
// Extract just the VERSE_SETS_KJV literal — the file has trailing exports
// and comments after it. Match from `[` after the assignment to the
// matching `];` on its own line.
const startIdx = kjvSrc.search(/export\s+const\s+VERSE_SETS_KJV\s*=\s*\[/);
if (startIdx < 0) throw new Error('Cannot locate VERSE_SETS_KJV');
const afterEq = kjvSrc.indexOf('[', startIdx);
// Find the matching `];` at start of a line near the end
const closeIdx = kjvSrc.lastIndexOf('\n];');
if (closeIdx < 0) throw new Error('Cannot find closing `];`');
const expr = kjvSrc.slice(afterEq, closeIdx + 2); // include `]`
const VERSE_SETS_KJV = new Function('return ' + expr)();

// ── Build verses_ar.js ─────────────────────────────────────────────────────
const out = [];
out.push('// Smith and Van Dyke (SVD) Arabic Bible verse sets, mirroring the');
out.push('// topical structure of verses_kjv.js. Generated by scripts/build-verses-ar.mjs.');
out.push('// Source: bolls.life /get-text/SVD/');
out.push('// Translation: SVD (الكتاب المقدس - فاندايك) — Smith & Van Dyke 1865,');
out.push('// the most widely-used Arabic Protestant Bible.');
out.push('');
out.push('export const VERSE_SETS_AR = [');

const orderedKjvIds = VERSE_SETS_KJV.map(s => s.id);
process.stderr.write(`KJV sets found: ${orderedKjvIds.join(', ')}\n`);

let setIdx = 0;
for (const kjvSet of VERSE_SETS_KJV) {
  const meta = SET_META[kjvSet.id];
  if (!meta) { process.stderr.write(`⚠ skip unknown set "${kjvSet.id}"\n`); continue; }
  process.stderr.write(`▸ ${meta.id} (${kjvSet.verses.length} verses)\n`);

  out.push(`  {`);
  out.push(`    id: "${meta.id}",`);
  const safeTitle = meta.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeDesc = meta.description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  out.push(`    title: "${safeTitle}",`);
  out.push(`    createdAt: "2026-06-07",`);
  out.push(`    description: "${safeDesc}",`);
  out.push(`    language: "ar",`);
  out.push(`    verses: [`);

  let i = 0;
  for (const v of kjvSet.verses) {
    i++;
    let parsed, text, ref;
    try {
      parsed = parseRef(v.reference);
      text = await fetchArabicText(parsed.bookId, parsed.chapter, parsed.verses);
      ref = arabicRef(parsed.bookId, parsed.chapter, parsed.verses);
    } catch (e) {
      process.stderr.write(`  ⚠ skip "${v.reference}": ${e.message}\n`);
      continue;
    }
    const id = `${meta.id}-${i}`;
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    out.push(`      { id: "${id}", reference: "${ref}", title: "${meta.title}", text: "${escaped}" },`);
  }
  out.push(`    ]`);
  out.push(`  }${setIdx === VERSE_SETS_KJV.length - 1 ? '' : ','}`);
  setIdx++;
}
out.push('];');
out.push('');

const final = out.join('\n');
process.stdout.write(final);
process.stderr.write(`\n✅ Done — ${final.length} bytes\n`);
