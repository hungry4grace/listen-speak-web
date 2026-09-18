import { Redis } from '@upstash/redis';
import { prefixedRedis } from '../lib/redisPrefix.js';

// Index a web-push subscription by the device's personalCode so referral
// milestone / cheer notifications can reach it. Stored as a hash keyed by the
// subscription endpoint (so re-subscribing the same device de-dupes).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, subscription } = req.body || {};
  if (!code || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Missing code or subscription' });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ success: true, mocked: true });

  try {
    const redis = prefixedRedis(new Redis({ url: redisUrl, token: redisToken }));
    await redis.hset(`pushsubs:${code}`, { [subscription.endpoint]: JSON.stringify(subscription) });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
