export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = process.env.ESV_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'Missing ESV_API_TOKEN' });

  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });

  try {
    const url = new URL('https://api.esv.org/v3/passage/text/');
    url.searchParams.set('q', q);
    url.searchParams.set('include-passage-references', 'false');
    url.searchParams.set('include-verse-numbers', 'false');
    url.searchParams.set('include-first-verse-numbers', 'false');
    url.searchParams.set('include-footnotes', 'false');
    url.searchParams.set('include-footnote-body', 'false');
    url.searchParams.set('include-headings', 'false');
    url.searchParams.set('include-short-copyright', 'false');
    url.searchParams.set('include-copyright', 'false');

    const r = await fetch(url.toString(), {
      headers: { Authorization: `Token ${token}` }
    });
    if (!r.ok) return res.status(r.status).json({ error: `ESV API ${r.status}` });
    const data = await r.json();
    const text = String(data?.passages?.[0] || '').replace(/\s+/g, ' ').trim();
    if (!text) return res.status(404).json({ error: 'Passage not found' });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to fetch ESV passage' });
  }
}
