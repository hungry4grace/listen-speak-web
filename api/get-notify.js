import { Redis } from '@upstash/redis';
import { prefixedRedis } from '../lib/redisPrefix.js';

// Read a user's personalCode-keyed notification inbox (referral milestones the
// people they invited reached, and cheers they received). Returns newest-first
// items plus the lastReadAt timestamp so the client can compute the 🔔 badge.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,GET');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ items: [], lastReadAt: '', mocked: true });

  try {
    const redis = prefixedRedis(new Redis({ url: redisUrl, token: redisToken }));
    const [rows, lastReadAt] = await Promise.all([
      redis.lrange(`gamification:notify:${code}`, 0, 49),
      redis.get(`notify-read:${code}`),
    ]);
    const items = (rows || []).map((s) => {
      try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; }
    }).filter(Boolean);
    res.status(200).json({ items, lastReadAt: lastReadAt || '' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
