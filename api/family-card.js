// GET /fc  (rewritten to /api/family-card)
// Open Graph link card for Cloud Family daily shares.
//
// LINE / WhatsApp / Facebook crawlers read the OG/Twitter meta tags below to
// render a rich preview (verse title + text + image). Human visitors don't
// stop here — an immediate redirect bounces them into the SPA deep link, which
// credits today's reading and offers the one-tap Amen.
//
// Query params (all optional except set+team for a useful redirect):
//   team   teamId        set  setId         i    verse/day index
//   ref    verse ref     t    verse text    title passage title
//   amen   "1" to offer the one-tap Amen on arrival
//
// No secrets, no DB call: everything needed for the preview is in the URL, so
// this stays a fast static-ish response.

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PARTY_BASE = (process.env.PARTY_BASE || 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db').replace(/\/+$/, '');

export default async function handler(req, res) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'www.verserain.com';
  const origin = `https://${host}`;
  const q = req.query || {};

  const team = String(q.team || '');
  const set = String(q.set || '');
  const i = /^\d+$/.test(String(q.i || '')) ? String(q.i) : '0';
  // Verse text/reference/title may be passed inline (vref/vtext/title) for a
  // self-contained card, but we prefer SHORT links: when they're absent, we
  // resolve them server-side from (team, set, i) so the shared URL stays tidy.
  // (vref/vtext are used instead of ref/t — short names like `ref` get stripped
  // by some crawlers.)
  let ref = String(q.vref || q.ref || '');
  let text = String(q.vtext || q.t || '');
  let title = String(q.title || '');
  if ((!text || !title) && team && set) {
    try {
      const r = await fetch(`${PARTY_BASE}/teams/day-verse?teamId=${encodeURIComponent(team)}&setId=${encodeURIComponent(set)}&i=${encodeURIComponent(i)}`);
      if (r.ok) {
        const d = await r.json();
        if (d && d.success) {
          ref = ref || d.reference || '';
          text = text || d.text || '';
          title = title || d.title || '';
        }
      }
    } catch { /* fall back to whatever we have / generic */ }
  }
  if (!title) title = 'VerseRain';
  const wantAmen = String(q.amen || '') === '1';

  // The real destination inside the app.
  const dest = new URL(`${origin}/`);
  if (set) dest.searchParams.set('startSet', set);
  dest.searchParams.set('mode', 'campaign');
  if (team) dest.searchParams.set('teamId', team);
  dest.searchParams.set('verseIndex', i);
  if (wantAmen) dest.searchParams.set('amen', '1');
  const destUrl = dest.toString();

  const ogTitle = ref ? `📖 ${title} · ${ref}` : `📖 ${title}`;
  const ogDesc = text ? `「${text}」` : '雲端家人 — 一起讀今天的經文 · Read today\'s verse together';
  const ogImage = `${origin}/og-family.png`;
  const pageUrl = `${origin}${req.url || '/fc'}`;

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="VerseRain · 雲端家人" />
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
    <p style="margin-top:1.25rem"><a href="${esc(destUrl)}">開啟 VerseRain · Open the verse →</a></p>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short cache: a crawler revisit within the day still gets today's card,
  // but stale previews don't linger for long.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.status(200).send(html);
}
