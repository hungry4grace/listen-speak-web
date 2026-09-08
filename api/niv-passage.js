// API.Bible NIV passage fetcher
// Bible ID for NIV (2011) on API.Bible
const NIV_BIBLE_ID = '78a9f6124f344018-01';

// Map English book abbreviations / names to OSIS IDs used by API.Bible
const BOOK_OSIS = {
  'gen': 'GEN', 'genesis': 'GEN',
  'exo': 'EXO', 'exod': 'EXO', 'exodus': 'EXO',
  'lev': 'LEV', 'leviticus': 'LEV',
  'num': 'NUM', 'numbers': 'NUM',
  'deut': 'DEU', 'deu': 'DEU', 'deuteronomy': 'DEU',
  'josh': 'JOS', 'jos': 'JOS', 'joshua': 'JOS',
  'judg': 'JDG', 'judges': 'JDG',
  'ruth': 'RUT', 'ru': 'RUT',
  '1sam': '1SA', '1 sam': '1SA', '1samuel': '1SA',
  '2sam': '2SA', '2 sam': '2SA', '2samuel': '2SA',
  '1kgs': '1KI', '1 kgs': '1KI', '1kings': '1KI', '1 kings': '1KI',
  '2kgs': '2KI', '2 kgs': '2KI', '2kings': '2KI', '2 kings': '2KI',
  '1chr': '1CH', '1 chr': '1CH', '1chronicles': '1CH', '1 chronicles': '1CH',
  '2chr': '2CH', '2 chr': '2CH', '2chronicles': '2CH', '2 chronicles': '2CH',
  'ezra': 'EZR', 'ezr': 'EZR',
  'neh': 'NEH', 'nehemiah': 'NEH',
  'esth': 'EST', 'est': 'EST', 'esther': 'EST',
  'job': 'JOB', 'jb': 'JOB',
  'ps': 'PSA', 'psa': 'PSA', 'psalm': 'PSA', 'psalms': 'PSA',
  'prv': 'PRO', 'prov': 'PRO', 'proverbs': 'PRO',
  'eccl': 'ECC', 'ecc': 'ECC', 'ecclesiastes': 'ECC',
  'song': 'SNG', 'sng': 'SNG', 'sos': 'SNG',
  'isa': 'ISA', 'isaiah': 'ISA',
  'jer': 'JER', 'jeremiah': 'JER',
  'lam': 'LAM', 'lamentations': 'LAM',
  'ezek': 'EZK', 'ezk': 'EZK', 'ezekiel': 'EZK',
  'dan': 'DAN', 'daniel': 'DAN',
  'hos': 'HOS', 'hosea': 'HOS',
  'joel': 'JOL', 'jol': 'JOL',
  'amos': 'AMO', 'am': 'AMO',
  'obad': 'OBA', 'oba': 'OBA', 'obadiah': 'OBA',
  'jonah': 'JON', 'jon': 'JON',
  'mic': 'MIC', 'micah': 'MIC',
  'nah': 'NAM', 'nahum': 'NAM',
  'hab': 'HAB', 'habakkuk': 'HAB',
  'zeph': 'ZEP', 'zep': 'ZEP', 'zephaniah': 'ZEP',
  'hag': 'HAG', 'haggai': 'HAG',
  'zech': 'ZEC', 'zec': 'ZEC', 'zechariah': 'ZEC',
  'mal': 'MAL', 'malachi': 'MAL',
  'matt': 'MAT', 'mat': 'MAT', 'matthew': 'MAT',
  'mark': 'MRK', 'mrk': 'MRK', 'mk': 'MRK',
  'luke': 'LUK', 'luk': 'LUK', 'lk': 'LUK',
  'john': 'JHN', 'jhn': 'JHN', 'jn': 'JHN', 'joh': 'JHN',
  'acts': 'ACT', 'act': 'ACT',
  'rom': 'ROM', 'romans': 'ROM',
  '1cor': '1CO', '1 cor': '1CO', '1corinthians': '1CO', '1 corinthians': '1CO',
  '2cor': '2CO', '2 cor': '2CO', '2corinthians': '2CO', '2 corinthians': '2CO',
  'gal': 'GAL', 'galatians': 'GAL',
  'eph': 'EPH', 'ephesians': 'EPH',
  'phil': 'PHP', 'php': 'PHP', 'philippians': 'PHP',
  'col': 'COL', 'colossians': 'COL',
  '1thess': '1TH', '1 thess': '1TH', '1thessalonians': '1TH',
  '2thess': '2TH', '2 thess': '2TH', '2thessalonians': '2TH',
  '1tim': '1TI', '1 tim': '1TI', '1timothy': '1TI',
  '2tim': '2TI', '2 tim': '2TI', '2timothy': '2TI',
  'titus': 'TIT', 'tit': 'TIT',
  'phlm': 'PHM', 'philem': 'PHM', 'philemon': 'PHM',
  'heb': 'HEB', 'hebrews': 'HEB',
  'jas': 'JAS', 'james': 'JAS',
  '1pet': '1PE', '1 pet': '1PE', '1peter': '1PE',
  '2pet': '2PE', '2 pet': '2PE', '2peter': '2PE',
  '1john': '1JN', '1 john': '1JN', '1jn': '1JN',
  '2john': '2JN', '2 john': '2JN', '2jn': '2JN',
  '3john': '3JN', '3 john': '3JN', '3jn': '3JN',
  'jude': 'JUD',
  'rev': 'REV', 'revelation': 'REV',
};

function parseReference(ref) {
  // Handles: "Psalms 23:1", "Ps 23:1", "1 Cor 13:4", "John 3:16-17",
  //          "Proverbs 1" (whole chapter), "Leviticus 25:10, 23" (comma-separated verses)
  const clean = String(ref || '').replace(/[–—]/g, '-').trim();

  // Try full chapter reference: "Proverbs 1", "Genesis 1"
  const chapterOnly = clean.match(/^(\d\s*)?([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+)$/);
  if (chapterOnly) {
    const num = chapterOnly[1] ? chapterOnly[1].trim() : '';
    const bookRaw = (num + chapterOnly[2]).toLowerCase().replace(/\s+/g, ' ').trim();
    const book = BOOK_OSIS[bookRaw] || BOOK_OSIS[bookRaw.replace(/\s/g, '')] || null;
    if (book) return { book, chapter: chapterOnly[3], verse: null }; // whole chapter
  }

  // Try verse reference (with optional comma-separated: "Lev 25:10, 23")
  const m = clean.match(/^(\d\s*)?([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d+)\s*:\s*([\d,\s\-]+)$/);
  if (!m) return null;
  const num = m[1] ? m[1].trim() : '';
  const bookRaw = (num + m[2]).toLowerCase().replace(/\s+/g, ' ').trim();
  const book = BOOK_OSIS[bookRaw] || BOOK_OSIS[bookRaw.replace(/\s/g, '')] || null;
  if (!book) return null;
  const chapter = m[3];
  // Normalize comma-separated verses like "10, 23" into range "10-23"
  const rawVerse = m[4].trim();
  const verse = rawVerse.includes(',')
    ? rawVerse.split(',').map(v => v.trim()).filter(Boolean).join('-').replace(/(\d+)-(\d+)-(\d+)/, (_, a, _b, c) => `${a}-${c}`)
    : rawVerse.replace(/\s/g, '');
  return { book, chapter, verse };
}

function buildPassageId(parsed) {
  // API.Bible passage ID format: BOOK.chapter or BOOK.chapter.verse or range
  const { book, chapter, verse } = parsed;
  if (!verse) return `${book}.${chapter}`; // whole chapter
  if (verse.includes('-')) {
    const [start, end] = verse.split('-');
    return `${book}.${chapter}.${start}-${book}.${chapter}.${end}`;
  }
  return `${book}.${chapter}.${verse}`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const query = req.method === 'GET' ? (req.query || {}) : {};
  const reference = String(query.reference || '').trim();

  if (!reference) return res.status(400).json({ error: 'Missing reference' });

  const apiKey = process.env.NIV_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'NIV_API_KEY not configured' });

  const parsed = parseReference(reference);
  if (!parsed) return res.status(400).json({ error: `Cannot parse reference: ${reference}` });

  const passageId = buildPassageId(parsed);
  const url = `https://rest.api.bible/v1/bibles/${NIV_BIBLE_ID}/passages/${encodeURIComponent(passageId)}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=false&include-verse-spans=false`;

  try {
    const response = await fetch(url, {
      headers: { 'api-key': apiKey }
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: `API.Bible error: ${err}` });
    }
    const data = await response.json();
    const rawText = data?.data?.content || '';
    const text = stripHtml(rawText).replace(/\s+/g, ' ').trim();
    if (!text) return res.status(404).json({ error: 'No text returned' });
    return res.status(200).json({ text, reference });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch NIV passage' });
  }
}
