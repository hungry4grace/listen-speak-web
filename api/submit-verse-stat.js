import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ref, type, amount = 1 } = req.body;

  if (!ref || !type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(200).json({ success: true, mocked: true });
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    // types: "plays" or "completes"
    const scoreIncr = amount;

    await Promise.all([
      redis.zincrby(`verse_stats:alltime:${type}`, scoreIncr, ref),
      redis.zincrby(`verse_stats:monthly:${month}:${type}`, scoreIncr, ref),
      redis.zincrby(`verse_stats:daily:${today}:${type}`, scoreIncr, ref)
    ]);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to submit verse stat", error);
    res.status(500).json({ error: error.message });
  }
}
