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

  const { name, score, verseRef, mode } = req.body;

  if (!name || typeof score !== 'number' || !verseRef) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    // Just mock success
    return res.status(200).json({ success: true, mocked: true });
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    const allTimeKey = `leaderboard:${verseRef}`;
    const monthlyKey = `leaderboard:monthly:${month}:${verseRef}`;
    const dailyKey = `leaderboard:daily:${today}:${verseRef}`;

    async function updateZset(key, verseMetaKey, sumPrefix, clearsPrefix) {
        const currentScore = await redis.zscore(key, name);
        const prevScoreNum = currentScore === null ? 0 : parseFloat(currentScore);
        
        if (currentScore === null || score > prevScoreNum) {
            await redis.zadd(key, { score: score, member: name });
            if (mode && verseMetaKey) {
               await redis.hset(`leaderboard_meta:${verseMetaKey}`, { [name]: mode });
            }

            const scoreDelta = score - prevScoreNum;
            if (scoreDelta > 0 && sumPrefix) {
               await redis.zincrby(`${sumPrefix}`, scoreDelta, name);
            }
            if (currentScore === null && clearsPrefix) {
               await redis.zincrby(`${clearsPrefix}`, 1, name);
            }
        }
    }

    await Promise.all([
        updateZset(allTimeKey, verseRef, 'leaderboard_sum:alltime', 'leaderboard_clears:alltime'),
        updateZset(monthlyKey, verseRef, `leaderboard_sum:monthly:${month}`, `leaderboard_clears:monthly:${month}`),
        updateZset(dailyKey, verseRef, `leaderboard_sum:daily:${today}`, `leaderboard_clears:daily:${today}`),
        // global tracks the single highest score across any verse (not a sum)
        updateZset("leaderboard:global", 'global', null, null),
        updateZset(`leaderboard:monthly:${month}:global`, 'global', null, null),
        updateZset(`leaderboard:daily:${today}:global`, 'global', null, null)
    ]);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to submit score", error);
    res.status(500).json({ error: error.message });
  }
}
