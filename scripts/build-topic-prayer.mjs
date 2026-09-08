#!/usr/bin/env node
// Build & publish 「主題：禱告 / Topic: Prayer」 — a 10-passage prayer
// curriculum for new believers, in EVERY app language.
//
// Set ids: base `topic-prayer` (cuv) + `topic-prayer-<lang>` variants, so
// the bilingual pairing (`<primaryId>-<secondaryVersion>`) resolves across
// all languages.
//
// Text sources per language:
//   bolls.life  — cuv/cuvs/ko/ja/de/es/fa/ar/vi/id/ms/kjv/esv/niv/he
//   getbible.net — tr (turkish), my (judson)
//   lingshyang.com 台語漢字本 — tw (via scripts/taibible.mjs)
//
// Usage:
//   node scripts/build-topic-prayer.mjs            dry run → .topic-prayer.json
//   node scripts/build-topic-prayer.mjs --publish  POST all sets to PartyKit

import fs from 'node:fs';
import path from 'node:path';
import { taiwaneseTextForReference, unknownGlyphs } from './taibible.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HOST = 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db';
const PUBLISH = process.argv.includes('--publish');

// ── The 10 prayer passages ────────────────────────────────────────────────
// book = standard 1-66 id. verses joined in order.
const PASSAGES = [
  { book: 40, chapter: 6, verses: [9, 10, 11, 12, 13], key: 'lords-prayer' },
  { book: 40, chapter: 6, verses: [6, 7, 8], key: 'pray-in-secret' },
  { book: 40, chapter: 7, verses: [7, 8, 9, 10, 11], key: 'ask-seek-knock' },
  { book: 50, chapter: 4, verses: [6, 7], key: 'anxious-for-nothing' },
  { book: 52, chapter: 5, verses: [16, 17, 18], key: 'pray-without-ceasing' },
  { book: 41, chapter: 11, verses: [22, 23, 24], key: 'prayer-of-faith' },
  { book: 62, chapter: 1, verses: [9], key: 'confess-sin' },
  { book: 24, chapter: 33, verses: [3], key: 'call-and-answer' },
  { book: 45, chapter: 8, verses: [26, 27], key: 'spirit-helps' },
  { book: 59, chapter: 5, verses: [13, 14, 15, 16], key: 'righteous-prayer' },
];

// Per-language: topic title, description, book names (App-normalizable
// forms), chapter label style, per-passage teaching titles.
const LANGS = {
  cuv: {
    source: { api: 'bolls', slug: 'CUNP' },
    title: '主題：禱告',
    description: '十段教導禱告的經文，帶領剛信主的弟兄姊妹一步步學習禱告——從主耶穌親自教導的主禱文開始。',
    books: { 40: '馬太福音', 41: '馬可福音', 45: '羅馬書', 50: '腓立比書', 52: '帖撒羅尼迦前書', 59: '雅各書', 62: '約翰一書', 24: '耶利米書' },
    labels: ['主禱文', '在內室禱告', '祈求、尋找、叩門', '一無掛慮', '不住地禱告', '信心的禱告', '認罪的禱告', '求告我，我必應允', '聖靈幫助我們禱告', '義人的祈禱'],
  },
  cuvs: {
    source: { api: 'bolls', slug: 'CUNPS' },
    title: '主题：祷告',
    description: '十段教导祷告的经文，带领刚信主的弟兄姊妹一步步学习祷告——从主耶稣亲自教导的主祷文开始。',
    books: { 40: '马太福音', 41: '马可福音', 45: '罗马书', 50: '腓立比书', 52: '帖撒罗尼迦前书', 59: '雅各书', 62: '约翰一书', 24: '耶利米书' },
    labels: ['主祷文', '在内室祷告', '祈求、寻找、叩门', '一无挂虑', '不住地祷告', '信心的祷告', '认罪的祷告', '求告我，我必应允', '圣灵帮助我们祷告', '义人的祈祷'],
  },
  tw: {
    source: { api: 'taibible' },
    title: '主題：禱告（台語）',
    description: '十段教導祈禱的經文（台語漢字本），幫助拄信主的兄弟姊妹學習祈禱——對主耶穌親身教示的主禱文開始。',
    books: { 40: '馬太福音', 41: '馬可福音', 45: '羅馬書', 50: '腓立比書', 52: '帖撒羅尼迦前書', 59: '雅各書', 62: '約翰一書', 24: '耶利米書' },
    labels: ['主禱文', '佇內室祈禱', '求就互恁', '莫得掛慮', '祈禱無息', '信的祈禱', '認罪的祈禱', '求叫我，我欲應你', '聖神幫助咱祈禱', '義人的祈禱'],
  },
  kjv: {
    source: { api: 'bolls', slug: 'KJV' },
    title: 'Topic: Prayer',
    description: 'Ten passages that teach a new believer how to pray — starting with the Lord’s Prayer, taught by Jesus himself.',
    books: { 40: 'Matthew', 41: 'Mark', 45: 'Romans', 50: 'Philippians', 52: '1 Thessalonians', 59: 'James', 62: '1 John', 24: 'Jeremiah' },
    labels: ['The Lord’s Prayer', 'Pray in secret', 'Ask, seek, knock', 'Be anxious for nothing', 'Pray without ceasing', 'The prayer of faith', 'Confessing sin', 'Call to me and I will answer', 'The Spirit helps us pray', 'The prayer of the righteous'],
  },
  esv: { source: { api: 'bolls', slug: 'ESV' }, inherit: 'kjv' },
  niv: { source: { api: 'bolls', slug: 'NIV' }, inherit: 'kjv' },
  ja: {
    source: { api: 'bolls', slug: 'NJB' },
    title: 'テーマ：祈り',
    description: '祈りを教える十の聖句。信じたばかりの人がイエスさま自ら教えられた「主の祈り」から祈りを学べます。',
    books: { 40: 'マタイの福音書', 41: 'マルコの福音書', 45: 'ローマ人への手紙', 50: 'ピリピ人への手紙', 52: 'テサロニケ人への手紙 第一', 59: 'ヤコブの手紙', 62: 'ヨハネの手紙 第一', 24: 'エレミヤ書' },
    labels: ['主の祈り', '隠れた所で祈る', '求めなさい', '何も思い煩わない', '絶えず祈る', '信仰の祈り', '罪の告白', 'わたしを呼べ、答えよう', '御霊が祈りを助ける', '義人の祈り'],
  },
  ko: {
    source: { api: 'bolls', slug: 'KRV' },
    title: '주제: 기도',
    description: '기도를 가르치는 열 개의 말씀. 예수님께서 친히 가르치신 주기도문부터, 처음 믿는 분들이 기도를 배울 수 있습니다.',
    books: { 40: '마태복음', 41: '마가복음', 45: '로마서', 50: '빌립보서', 52: '데살로니가전서', 59: '야고보서', 62: '요한일서', 24: '예레미야' },
    labels: ['주기도문', '은밀한 중에 기도하라', '구하라 주실 것이요', '아무 것도 염려하지 말라', '쉬지 말고 기도하라', '믿음의 기도', '죄를 자백하는 기도', '내게 부르짖으라', '성령이 기도를 도우신다', '의인의 기도'],
  },
  es: {
    source: { api: 'bolls', slug: 'RV1960' },
    title: 'Tema: Oración',
    description: 'Diez pasajes que enseñan a orar al nuevo creyente, comenzando con el Padre Nuestro, enseñado por Jesús mismo.',
    books: { 40: 'Mateo', 41: 'Marcos', 45: 'Romanos', 50: 'Filipenses', 52: '1 Tesalonicenses', 59: 'Santiago', 62: '1 Juan', 24: 'Jeremías' },
    labels: ['El Padre Nuestro', 'Ora en secreto', 'Pedid y se os dará', 'Por nada estéis afanosos', 'Orad sin cesar', 'La oración de fe', 'Confesión de pecados', 'Clama a mí y te responderé', 'El Espíritu nos ayuda a orar', 'La oración del justo'],
  },
  de: {
    source: { api: 'bolls', slug: 'SCH' },
    title: 'Thema: Gebet',
    description: 'Zehn Bibelstellen, die neuen Gläubigen das Beten lehren — beginnend mit dem Vaterunser, das Jesus selbst gelehrt hat.',
    books: { 40: 'Matthäus', 41: 'Markus', 45: 'Römer', 50: 'Philipper', 52: '1. Thessalonicher', 59: 'Jakobus', 62: '1. Johannes', 24: 'Jeremia' },
    labels: ['Das Vaterunser', 'Bete im Verborgenen', 'Bittet, so wird euch gegeben', 'Sorgt euch um nichts', 'Betet ohne Unterlass', 'Das Gebet des Glaubens', 'Sündenbekenntnis', 'Rufe mich an, so will ich dir antworten', 'Der Geist hilft uns beten', 'Das Gebet des Gerechten'],
  },
  tr: {
    source: { api: 'getbible', slug: 'turkish' },
    title: 'Konu: Dua',
    description: 'Yeni iman edenlere dua etmeyi öğreten on bölüm — İsa’nın bizzat öğrettiği Rab’bin Duası ile başlar.',
    books: { 40: 'Matta', 41: 'Markos', 45: 'Romalılar', 50: 'Filipililer', 52: '1 Selanikliler', 59: 'Yakup', 62: '1 Yuhanna', 24: 'Yeremya' },
    labels: ['Rab’bin Duası', 'Gizlide dua et', 'Dileyin, size verilecek', 'Hiçbir şeyi kaygı edinmeyin', 'Durmadan dua edin', 'İman duası', 'Günah itirafı', 'Bana yakar, sana yanıt vereyim', 'Ruh dualarımıza yardım eder', 'Doğru kişinin duası'],
  },
  fa: {
    source: { api: 'bolls', slug: 'POV' },
    title: 'موضوع: دعا',
    description: 'ده بخش از کلام که به نوایمانان دعا کردن را می‌آموزد — با دعای ربانی که عیسی خود تعلیم داد آغاز می‌شود.',
    books: { 40: 'متی', 41: 'مرقس', 45: 'رومیان', 50: 'فیلیپیان', 52: 'اول تسالونیکیان', 59: 'یعقوب', 62: 'اول یوحنا', 24: 'ارمیا' },
    labels: ['دعای ربانی', 'در خلوت دعا کن', 'بطلبید تا به شما داده شود', 'برای هیچ‌چیز نگران نباشید', 'پیوسته دعا کنید', 'دعای ایمان', 'اعتراف به گناه', 'مرا بخوان تا اجابت کنم', 'روح در دعا یاری می‌دهد', 'دعای مرد عادل'],
  },
  ar: {
    source: { api: 'bolls', slug: 'SVD' },
    title: 'موضوع: الصلاة',
    description: 'عشرة مقاطع تعلّم المؤمن الجديد كيف يصلي — تبدأ بالصلاة الربانية التي علّمها يسوع بنفسه.',
    books: { 40: 'متى', 41: 'مرقس', 45: 'رومية', 50: 'فيلبي', 52: '1تسالونيكي', 59: 'يعقوب', 62: '1يوحنا', 24: 'إرميا' },
    labels: ['الصلاة الربانية', 'صلِّ في الخفاء', 'اسألوا تُعطَوا', 'لا تهتموا بشيء', 'صلّوا بلا انقطاع', 'صلاة الإيمان', 'الاعتراف بالخطية', 'ادعُني فأجيبك', 'الروح يعين في الصلاة', 'صلاة البار'],
  },
  he: {
    source: { api: 'bolls', slug: null }, // HAC (OT) / DHNT (NT), resolved per book
    title: 'נושא: תפילה',
    description: 'עשרה קטעים המלמדים מאמין חדש כיצד להתפלל — החל בתפילת האדון שלימד ישוע בעצמו.',
    books: { 40: 'מתי', 41: 'מרקוס', 45: 'רומים', 50: 'פיליפים', 52: 'תסלוניקים א', 59: 'יעקב', 62: 'יוחנן א', 24: 'ירמיהו' },
    labels: ['תפילת האדון', 'תפילה בסתר', 'בקשו ויינתן לכם', 'אל תדאגו לדבר', 'התפללו בלי הרף', 'תפילת האמונה', 'וידוי חטא', 'קרא אליי ואענך', 'הרוח עוזרת בתפילה', 'תפילת הצדיק'],
  },
  my: {
    source: { api: 'getbible', slug: 'judson' },
    title: 'ခေါင်းစဉ်: ဆုတောင်းခြင်း',
    description: 'ယုံကြည်သူသစ်များ ဆုတောင်းတတ်စေရန် သွန်သင်သော ကျမ်းပိုဒ် ဆယ်ပိုဒ် — သခင်ယေရှုကိုယ်တိုင် သွန်သင်သော ပတ္ထနာဖြင့် စတင်သည်။',
    books: { 40: 'မဿဲ', 41: 'မာကု', 45: 'ရောမ', 50: 'ဖိလိပ္ပိ', 52: '၁သက်သာလောနိတ်', 59: 'ယာကုပ်', 62: '၁ယောဟန်', 24: 'ယေရမိ' },
    labels: null, // per-verse titles fall back to the set title
  },
  vi: {
    source: { api: 'bolls', slug: 'VI1934' },
    title: 'Chủ đề: Cầu nguyện',
    description: 'Mười phân đoạn dạy người mới tin Chúa cầu nguyện — bắt đầu với Bài Cầu Nguyện Chung do chính Chúa Giê-xu dạy.',
    books: { 40: 'Ma-thi-ơ', 41: 'Mác', 45: 'Rô-ma', 50: 'Phi-líp', 52: '1 Tê-sa-lô-ni-ca', 59: 'Gia-cơ', 62: '1 Giăng', 24: 'Giê-rê-mi' },
    labels: ['Bài Cầu Nguyện Chung', 'Cầu nguyện nơi kín nhiệm', 'Hãy xin, sẽ được', 'Chớ lo phiền chi hết', 'Cầu nguyện không thôi', 'Lời cầu nguyện bởi đức tin', 'Xưng tội', 'Hãy kêu cầu Ta', 'Thánh Linh giúp chúng ta cầu nguyện', 'Lời cầu nguyện của người công bình'],
  },
  id: {
    source: { api: 'bolls', slug: 'TB' },
    title: 'Topic: Doa',
    description: 'Sepuluh bagian Alkitab yang mengajar orang percaya baru untuk berdoa — dimulai dengan Doa Bapa Kami yang diajarkan Yesus sendiri.',
    books: { 40: 'Matius', 41: 'Markus', 45: 'Roma', 50: 'Filipi', 52: '1 Tesalonika', 59: 'Yakobus', 62: '1 Yohanes', 24: 'Yeremia' },
    labels: ['Doa Bapa Kami', 'Berdoa di tempat tersembunyi', 'Mintalah, maka akan diberikan', 'Jangan kuatir tentang apa pun', 'Tetaplah berdoa', 'Doa yang penuh iman', 'Mengaku dosa', 'Berserulah kepada-Ku', 'Roh membantu kita berdoa', 'Doa orang benar'],
  },
  ms: { source: { api: 'bolls', slug: 'TB' }, inherit: 'id' },
};

// ── Fetch helpers (memoized per slug|book|chapter) ─────────────────────────
const memo = new Map();
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await new Promise(r => setTimeout(r, 200));
  return res.json();
}
function stripMarkup(t) {
  return String(t || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
async function chapterVerses(api, slug, book, chapter) {
  const key = `${api}|${slug}|${book}|${chapter}`;
  if (memo.has(key)) return memo.get(key);
  let map = {};
  if (api === 'bolls') {
    const rows = await fetchJson(`https://bolls.life/get-text/${slug}/${book}/${chapter}/`);
    for (const r of rows) map[r.verse] = stripMarkup(r.text);
  } else if (api === 'getbible') {
    const data = await fetchJson(`https://api.getbible.net/v2/${slug}/${book}/${chapter}.json`);
    for (const r of data.verses || []) map[r.verse] = stripMarkup(r.text);
  }
  memo.set(key, map);
  return map;
}

// ── Build every language set ───────────────────────────────────────────────
function resolved(langKey) {
  const raw = LANGS[langKey];
  return raw.inherit ? { ...LANGS[raw.inherit], ...raw } : raw;
}
const out = [];
const problems = [];
for (const langKey of Object.keys(LANGS)) {
  const cfg = resolved(langKey);
  const setId = langKey === 'cuv' ? 'topic-prayer' : `topic-prayer-${langKey}`;
  const verses = [];
  for (let i = 0; i < PASSAGES.length; i++) {
    const p = PASSAGES[i];
    const bookName = cfg.books[p.book];
    const refSpec = p.verses.length === 1
      ? `${p.chapter}:${p.verses[0]}`
      : `${p.chapter}:${p.verses[0]}-${p.verses[p.verses.length - 1]}`;
    const reference = `${bookName} ${refSpec}`;
    let text = '';
    try {
      if (cfg.source.api === 'taibible') {
        const misses = [];
        // taibible parses Chinese book names directly.
        text = await taiwaneseTextForReference(reference, misses);
        if (misses.length) problems.push(`${setId}: ${misses.join('; ')}`);
      } else {
        const slug = cfg.source.slug || (p.book <= 39 ? 'HAC' : 'DHNT'); // he
        const chap = await chapterVerses(cfg.source.api, slug, p.book, p.chapter);
        const parts = p.verses.map(n => chap[n]).filter(Boolean);
        if (parts.length < p.verses.length) problems.push(`${setId}: ${reference} — ${parts.length}/${p.verses.length}`);
        text = parts.join(' ');
      }
    } catch (e) {
      problems.push(`${setId}: ${reference} — ${e.message}`);
    }
    if (!text) continue;
    verses.push({
      id: `topic-prayer-${langKey}-${String(i + 1).padStart(2, '0')}`,
      reference,
      title: cfg.labels ? cfg.labels[i] : cfg.title,
      text,
    });
  }
  if (verses.length < PASSAGES.length) problems.push(`${setId}: only ${verses.length}/10 passages`);
  out.push({
    id: setId,
    title: cfg.title,
    description: cfg.description,
    language: langKey,
    isPublished: true,
    authorName: 'Verserain 官方',
    verses,
  });
  console.log(`  ${setId} — ${verses.length}/10 passages`);
}

if (unknownGlyphs.size) {
  console.error(`❌ Unmapped 台語 glyphs: ${[...unknownGlyphs].join(', ')}`);
  process.exit(1);
}
if (problems.length) {
  console.error(`\n⚠️  ${problems.length} problem(s):`);
  for (const p of problems) console.error('  ' + p);
}

const preview = path.join(HERE, '.topic-prayer.json');
fs.writeFileSync(preview, JSON.stringify(out, null, 2));
console.log(`\n${out.length} language sets → ${preview}`);

if (PUBLISH) {
  if (problems.length) { console.error('Refusing to publish with problems.'); process.exit(1); }
  const env = fs.readFileSync(path.join(HERE, '..', '.env.local'), 'utf8');
  const token = env.match(/^PARTYKIT_ADMIN_TOKEN=(.+)$/m)[1].trim();
  for (const set of out) {
    const res = await fetch(`${HOST}/custom-sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ ...set, adminEmail: 'hungry4grace@gmail.com', adminName: 'hungry@G' }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`  publish ${set.id}: ${res.status} ${JSON.stringify(data)}`);
    if (!res.ok) process.exit(1);
  }
  console.log('✅ Topic: Prayer published in all languages.');
} else {
  console.log('Dry run — re-run with --publish after checking the preview JSON.');
}
