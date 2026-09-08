import { Redis } from '@upstash/redis';

// GET /api/get-name-by-code?code=XXXXXXXXXX
// Returns { name } for a known personalCode → playerName mapping. Used by
// the "我的推薦人" widget in the garden so a 10-char invite code can be
// shown as a friendly display name.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Missing code' });

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ name: null, mocked: true });

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    const name = await redis.hget('player_mapping', code);
    return res.status(200).json({ name: name || null });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
