const VERSION_TO_TRANSLATE_LANG = {
  cuv: 'zh-TW',
  zh: 'zh-TW',
  cuvs: 'zh-CN',
  tw: 'zh-TW',   // Taiwanese Hokkien has no reliable MT target — best-effort 繁中 title
  kjv: 'en',
  esv: 'en',
  niv: 'en',
  fa: 'fa',
  he: 'he',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  tr: 'tr',
  de: 'de',
  my: 'my',
  vi: 'vi',
  ar: 'ar',
  pt: 'pt',
  fr: 'fr',
  ru: 'ru',
  hi: 'hi',
  id: 'id',
  ms: 'ms'
};

function getTranslateLanguage(version) {
  return VERSION_TO_TRANSLATE_LANG[String(version || '').toLowerCase()] || null;
}

function getRequestPayload(req) {
  if (req.method === 'GET') return req.query || {};
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function chunkText(text, maxLength = 1400) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return [];
  const tokens = value.split(/(\s+)/);
  const chunks = [];
  let current = '';

  for (const token of tokens) {
    if (!token) continue;
    if (token.length > maxLength) {
      if (current.trim()) chunks.push(current.trim());
      current = '';
      for (let i = 0; i < token.length; i += maxLength) {
        chunks.push(token.slice(i, i + maxLength));
      }
      continue;
    }
    if ((current + token).length > maxLength && current.trim()) {
      chunks.push(current.trim());
      current = token.trimStart();
    } else {
      current += token;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function parseGoogleTranslateResponse(data) {
  if (!Array.isArray(data?.[0])) return '';
  return data[0]
    .map(part => Array.isArray(part) ? part[0] : '')
    .join('');
}

function cleanTranslatedText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?，。！？；：])/g, '$1')
    .replace(/([「『“‘（(])\s+/g, '$1')
    .replace(/\s+([」』”’）)])/g, '$1')
    .replace(/([\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])\s+(?=[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])/g, '$1')
    .trim();
}

async function translateChunk(chunk, targetLanguage, sourceLanguage) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: sourceLanguage || 'auto',
    tl: targetLanguage,
    dt: 't',
    q: chunk
  });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`Translate API ${response.status}`);
  const data = await response.json();
  return parseGoogleTranslateResponse(data);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = getRequestPayload(req);
  const text = String(payload.text || '').trim();
  const targetVersion = String(payload.targetVersion || '').toLowerCase();
  const sourceVersion = String(payload.sourceVersion || '').toLowerCase();
  const targetLanguage = getTranslateLanguage(targetVersion);
  const sourceLanguage = getTranslateLanguage(sourceVersion);

  if (!text) return res.status(400).json({ error: 'Missing text' });
  if (!targetLanguage) return res.status(400).json({ error: 'Unsupported targetVersion' });
  if (text.length > 12000) return res.status(413).json({ error: 'Text is too long' });

  try {
    const chunks = chunkText(text);
    const translatedChunks = [];
    for (const chunk of chunks) {
      translatedChunks.push(await translateChunk(chunk, targetLanguage, sourceLanguage));
    }
    const translated = cleanTranslatedText(translatedChunks.join(' '));
    if (!translated) return res.status(404).json({ error: 'Translation not found' });
    return res.status(200).json({ text: translated, targetLanguage });
  } catch {
    return res.status(502).json({ error: 'Failed to translate passage' });
  }
}
