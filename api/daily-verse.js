const VERSION_PATHS = {
  kjv: 'kjv',
  web: 'web',
  esv: 'esv',
  niv: '',
  cuv: 'tc',
  cuvs: 'tc',
  zh: 'tc',
  de: 'de',
  es: 'es'
};

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function decodeHtml(value = '') {
  const decoded = String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rdquo;/g, '”')
    .replace(/&ldquo;/g, '“')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/L ord/g, 'Lord')
    .replace(/\s+/g, ' ')
    .trim();
  return decoded
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/\s+([，。？！；：、])/g, '$1')
    .replace(/([（「『《])\s+/g, '$1')
    .trim();
}

function buildDailyVersesUrl(date, version) {
  const mapped = VERSION_PATHS[String(version || '').toLowerCase()];
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (version === 'cuvs') {
    return `https://dailyverses.net/tc/${year}/${month}/cuvs`;
  }
  if (mapped === 'tc' || mapped === 'de' || mapped === 'es') {
    return `https://dailyverses.net/${mapped}/${year}/${month}`;
  }
  if (mapped) {
    return `https://dailyverses.net/${year}/${month}/${mapped}`;
  }
  return `https://dailyverses.net/${year}/${month}`;
}

function parseArchive(html, year, month) {
  const entries = [];
  const sectionRegex = /<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>([\s\S]*?)(?=<h2>|<h1>|<h3>|<footer>|$)/gi;
  const monthIndex = new Date(Date.UTC(year, month - 1, 1)).getUTCMonth();

  let match;
  while ((match = sectionRegex.exec(html))) {
    const href = match[1];
    const heading = decodeHtml(match[2]);
    const section = match[3];
    const hrefDate = href.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/);
    const parsedDate = hrefDate
      ? new Date(Date.UTC(Number(hrefDate[1]), Number(hrefDate[2]) - 1, Number(hrefDate[3])))
      : new Date(`${heading} UTC`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.getUTCMonth() !== monthIndex) continue;

    const textMatch = section.match(/<span[^>]*class="v[12]"[^>]*>([\s\S]*?)<\/span>/i);
    const refMatch = section.match(/<a[^>]*class="vc"[^>]*>([\s\S]*?)<\/a>/i)
      || section.match(/<a[^>]*href="\/[^"]*"[^>]*>([1-3]?\s?[A-Za-z][^<]*\s\d[^<]*)<\/a>/i);
    if (!refMatch) continue;

    const reference = decodeHtml(refMatch[1]);
    const beforeReference = textMatch
      ? textMatch[1]
      : section
        .slice(0, section.indexOf(refMatch[0]))
        .replace(/<a[^>]*>\s*<img[\s\S]*?<\/a>/gi, ' ')
        .replace(/<img[\s\S]*?>/gi, ' ');
    const text = decodeHtml(beforeReference);
    if (!text) continue;

    entries.push({
      date: formatDate(parsedDate),
      reference,
      text,
      sourceUrl: `https://dailyverses.net${refMatch[0].match(/href="([^"]+)"/)?.[1] || href}`
    });
  }

  return entries;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const requestedDate = req.query.date ? new Date(`${req.query.date}T00:00:00Z`) : new Date();
  if (Number.isNaN(requestedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD.' });
  }

  const year = requestedDate.getUTCFullYear();
  const month = requestedDate.getUTCMonth() + 1;
  const version = String(req.query.version || 'niv').toLowerCase();
  const archiveUrl = buildDailyVersesUrl(requestedDate, version);

  try {
    const response = await fetch(archiveUrl, {
      headers: {
        'User-Agent': 'VerseRain/1.0 daily verse feature'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `DailyVerses returned ${response.status}` });
    }

    const html = await response.text();
    const entries = parseArchive(html, year, month).sort((a, b) => a.date.localeCompare(b.date));
    const target = formatDate(requestedDate);
    const exact = entries.find(entry => entry.date === target);
    const fallback = [...entries].reverse().find(entry => entry.date <= target) || entries[entries.length - 1];

    if (!exact && !fallback) {
      return res.status(404).json({ error: 'No daily verse found.' });
    }

    res.status(200).json({
      ...(exact || fallback),
      requestedDate: target,
      exact: Boolean(exact),
      translation: version,
      archiveUrl
    });
  } catch (error) {
    console.error('Failed to fetch DailyVerses archive', error);
    res.status(500).json({ error: error.message });
  }
}
