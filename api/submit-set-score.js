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

  const { setId, name, score, mode, passedCount, totalCount, date } = req.body;

  if (!setId || !name || typeof score !== 'number') {
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

    const zsetKey = `leaderboard:set:${setId}`;
    const metaKey = `leaderboard_meta:set:${setId}`;

    const currentScore = await redis.zscore(zsetKey, name);
    const prevScoreNum = currentScore === null ? -1 : parseFloat(currentScore);
    
    // Only update if it's their first time OR their new score is strictly better
    if (currentScore === null || score > prevScoreNum) {
        await redis.zadd(zsetKey, { score: score, member: name });
        
        const metadata = JSON.stringify({
            mode: mode || '',
            passedCount: passedCount || 0,
            totalCount: totalCount || 0,
            date: date || new Date().toISOString()
        });
        await redis.hset(metaKey, { [name]: metadata });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to submit set score", error);
    res.status(500).json({ error: error.message });
  }
}
