// GET /lc  (rewritten to /api/listen-card)
// Open Graph link card for listen-mode (經文組聆聽) share links.
//
// The SPA serves one static index.html for every URL, so LINE/WhatsApp/
// Facebook previews of /?listenSet=… links all showed the generic site
// title. Share buttons now emit /lc links instead: crawlers read the
// per-set OG tags below, humans get bounced straight into the SPA's
// listen deep link.
//
// Query params — short links preferred:
//   set     setId (required for a useful redirect)
//   i       verse index within the set (server resolves ref + text)
//   verse   verse reference (fallback when i is absent)
//   version bible version (optional, e.g. cuv)
//   title   optional inline override for the set title
//   vtext   optional inline override for the description snippet
//
// The share buttons push the full set to PartyKit's /share-set right
// before emitting an /lc link, so this endpoint can resolve the set's
// title and the verse's reference/text server-side — keeping the shared
// URL short (no URL-encoded Chinese in the query).

import { BIBLE_BOOKS } from '../src/bibleDictionary.js';

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 「賽 60:1-3」→「以賽亞書 60:1-3」— expand Chinese book abbreviations to
// the full book name for the link preview. Non-Chinese refs pass through.
function expandReferenceForDisplay(ref) {
  const m = String(ref || '').match(/^(\S+?)\s*(\d.*)$/);
  if (!m) return ref;
  const [, book, rest] = m;
  for (const b of BIBLE_BOOKS) {
    const zhFull = b.names?.[0];
    const zhAbbr = b.names?.[1];
    if (book === zhAbbr || book === zhFull) return `${zhFull} ${rest}`;
    const cnFull = b.cn?.[0];
    const cnAbbr = b.cn?.[1];
    if (cnFull && (book === cnAbbr || book === cnFull)) return `${cnFull} ${rest}`;
  }
  return ref;
}

// Wording for the link preview + interstitial, keyed by the sender's UI
// language (?lang=…, stamped on every share URL the app emits). A share sent
// from an English/Vietnamese/… session must not greet the recipient in Chinese.
const CARD_STRINGS = {
  zh: { htmlLang: 'zh-Hant', dir: 'ltr', site: 'VerseRain — 澆灌心田，結出生命果子', tap: '（點擊可以聆聽）', desc: '點開聆聽這個經文組', open: '開啟 VerseRain 聆聽 →' },
  cuvs: { htmlLang: 'zh-Hans', dir: 'ltr', site: 'VerseRain — 浇灌心田，结出生命果子', tap: '（点击可以聆听）', desc: '点开聆听这个经文组', open: '打开 VerseRain 聆听 →' },
  en: { htmlLang: 'en', dir: 'ltr', site: 'VerseRain — Water your heart, bear the fruit of life', tap: ' (tap to listen)', desc: 'Tap to listen to this verse set', open: 'Open VerseRain and listen →' },
  ja: { htmlLang: 'ja', dir: 'ltr', site: 'VerseRain — 心に潤いを、いのちの実を', tap: '（タップして聴く）', desc: 'この聖句セットをタップして聴く', open: 'VerseRain を開いて聴く →' },
  ko: { htmlLang: 'ko', dir: 'ltr', site: 'VerseRain — 마음에 물을 주어 생명의 열매를', tap: ' (눌러서 듣기)', desc: '이 말씀 세트를 눌러 들어보세요', open: 'VerseRain 열고 듣기 →' },
  es: { htmlLang: 'es', dir: 'ltr', site: 'VerseRain — Riega tu corazón y da fruto de vida', tap: ' (toca para escuchar)', desc: 'Toca para escuchar este conjunto de versículos', open: 'Abrir VerseRain y escuchar →' },
  de: { htmlLang: 'de', dir: 'ltr', site: 'VerseRain — Bewässere dein Herz, bringe Frucht des Lebens', tap: ' (zum Anhören tippen)', desc: 'Tippe, um diese Verssammlung anzuhören', open: 'VerseRain öffnen und anhören →' },
  tr: { htmlLang: 'tr', dir: 'ltr', site: 'VerseRain — Kalbini sula, yaşam meyvesi ver', tap: ' (dinlemek için dokun)', desc: 'Bu ayet setini dinlemek için dokun', open: "VerseRain'i aç ve dinle →" },
  vi: { htmlLang: 'vi', dir: 'ltr', site: 'VerseRain — Tưới mát tâm hồn, kết trái sự sống', tap: ' (chạm để nghe)', desc: 'Chạm để nghe bộ câu Kinh Thánh này', open: 'Mở VerseRain và nghe →' },
  id: { htmlLang: 'id', dir: 'ltr', site: 'VerseRain — Siram hatimu, hasilkan buah kehidupan', tap: ' (ketuk untuk mendengarkan)', desc: 'Ketuk untuk mendengarkan kumpulan ayat ini', open: 'Buka VerseRain dan dengarkan →' },
  ms: { htmlLang: 'ms', dir: 'ltr', site: 'VerseRain — Siram hatimu, hasilkan buah kehidupan', tap: ' (ketik untuk mendengar)', desc: 'Ketik untuk mendengar set ayat ini', open: 'Buka VerseRain dan dengar →' },
  my: { htmlLang: 'my', dir: 'ltr', site: 'VerseRain — နှလုံးသားကို ရေလောင်း၊ အသက်၏အသီးကို သီးပါစေ', tap: '（နှိပ်၍ နားထောင်ပါ）', desc: 'ဤကျမ်းချက်စုကို နားထောင်ရန် နှိပ်ပါ', open: 'VerseRain ကို ဖွင့်၍ နားထောင်ပါ →' },
  ar: { htmlLang: 'ar', dir: 'rtl', site: 'VerseRain — اسقِ قلبك ليُثمر ثمر الحياة', tap: ' (اضغط للاستماع)', desc: 'اضغط للاستماع إلى مجموعة الآيات هذه', open: '← افتح VerseRain واستمع' },
  he: { htmlLang: 'he', dir: 'rtl', site: 'VerseRain — השקו את הלב, הניבו פרי חיים', tap: ' (הקישו להאזנה)', desc: 'הקישו כדי להאזין לאוסף הפסוקים הזה', open: '← פתחו את VerseRain והאזינו' },
  fa: { htmlLang: 'fa', dir: 'rtl', site: 'VerseRain — دل خود را سیراب کن تا میوهٔ زندگی دهد', tap: ' (برای شنیدن ضربه بزنید)', desc: 'برای شنیدن این مجموعه آیات ضربه بزنید', open: '← VerseRain را باز کنید و گوش دهید' },
};

const PARTY_BASE = (process.env.PARTY_BASE || 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db').replace(/\/+$/, '');

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.verserain.com';
  const origin = `https://${host}`;
  const q = req.query || {};

  const set = String(q.set || '');
  let verse = String(q.verse || '');
  const version = String(q.version || '');
  let title = String(q.title || '').slice(0, 60);
  let vtext = String(q.vtext || '').slice(0, 160);
  const idx = /^\d+$/.test(String(q.i || '')) ? Number(q.i) : null;
  // Sender's UI language — falls back to zh for links minted before ?lang= existed.
  const lang = Object.prototype.hasOwnProperty.call(CARD_STRINGS, String(q.lang || ''))
    ? String(q.lang)
    : 'zh';
  const L = CARD_STRINGS[lang];

  // Resolve title / verse text from the shared set when not passed inline.
  if (set && (!title || (!vtext && (idx !== null || verse)))) {
    try {
      const r = await fetch(`${PARTY_BASE}/share-set?id=${encodeURIComponent(set)}`, { signal: AbortSignal.timeout(3500) });
      if (r.ok) {
        const data = await r.json();
        const s = data?.set;
        if (s) {
          if (!title && s.title) title = String(s.title).slice(0, 60);
          const verses = Array.isArray(s.verses) ? s.verses : [];
          const target = idx !== null
            ? verses[idx]
            : (verse ? verses.find(v => v?.reference === verse) : null);
          if (target) {
            if (!verse && target.reference) verse = String(target.reference);
            if (!vtext && target.text) vtext = String(target.text).slice(0, 160);
          }
        }
      }
    } catch { /* preview degrades gracefully; redirect still works */ }
  }

  // Real destination inside the app.
  const dest = new URL(`${origin}/`);
  if (set) dest.searchParams.set('listenSet', set);
  if (verse) dest.searchParams.set('listenVerse', verse);
  // Carry the verse index straight through: for large sets that exceed
  // /share-set's 128KB cap the fetch above can't resolve idx → reference, so
  // `verse` stays empty and listenVerse would be dropped — leaving the app to
  // pick a random verse. The SPA has the full set locally and pins verses[i].
  if (idx !== null) dest.searchParams.set('listenIndex', String(idx));
  if (version) dest.searchParams.set('version', version);
  // vo = opaque voice-owner id → recipient hears the sender's personal
  // recording for this verse (their voice › set owner › TTS).
  if (/^[a-f0-9]{16}$/.test(String(q.vo || ''))) dest.searchParams.set('vo', String(q.vo));
  // Carry the language through to the SPA so the app's own directions
  // (Start Listening / Stop / …) render in the language the link was sent in.
  if (q.lang) dest.searchParams.set('lang', lang);
  // order=seq → the app plays the whole set in canonical order.
  if (['seq', 'sequential'].includes(String(q.order || ''))) dest.searchParams.set('listenOrder', 'seq');
  const destUrl = dest.toString();

  const normalize = (s) => String(s || '').replace(/\s+/g, '');
  const refDisplay = verse ? expandReferenceForDisplay(verse) : '';
  // Single-verse shares use the reference AS the set title — showing both
  // reads as「賽 60:1-3 · 賽 60:1-3」. Collapse to one full-name reference.
  const titleIsRef = title && verse
    && (normalize(title) === normalize(verse) || normalize(title) === normalize(refDisplay));
  const ogTitle = (refDisplay && (!title || titleIsRef))
    ? `📖 ${refDisplay}${L.tap}`
    : title
      ? (refDisplay ? `📖 ${title} · ${refDisplay}` : `📖 ${title}`)
      : L.site;
  const quote = (lang === 'zh' || lang === 'cuvs' || lang === 'ja')
    ? `「${vtext}」`
    : `“${vtext}”`;
  const ogDesc = vtext ? quote : L.desc;
  // 經文雨-branded card — the listen share is VerseRain, not 雲端家人 (that's the
  // /fc Cloud Family feature, which keeps og-family.png). A distinct filename
  // also dodges LINE/Facebook's per-URL OG-image cache for the switchover.
  const ogImage = `${origin}/og-verserain.png`;
  const pageUrl = `${origin}${req.url || '/lc'}`;

  const html = `<!doctype html>
<html lang="${esc(L.htmlLang)}" dir="${L.dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(ogTitle)}</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="VerseRain" />
<meta property="og:title" content="${esc(ogTitle)}" />
<meta property="og:description" content="${esc(ogDesc)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${esc(pageUrl)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(ogTitle)}" />
<meta name="twitter:description" content="${esc(ogDesc)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
<meta http-equiv="refresh" content="0; url=${esc(destUrl)}" />
<link rel="canonical" href="${esc(destUrl)}" />
<script>location.replace(${JSON.stringify(destUrl)});</script>
<style>
  body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;
       display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
  a{color:#93c5fd}
</style>
</head>
<body>
  <div>
    <h1 style="font-size:1.4rem;margin:0 0 .5rem">${esc(ogTitle)}</h1>
    <p style="color:#cbd5e1;max-width:32rem">${esc(ogDesc)}</p>
    <p style="margin-top:1.25rem"><a href="${esc(destUrl)}">${esc(L.open)}</a></p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(html);
}
