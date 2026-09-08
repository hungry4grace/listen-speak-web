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

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(200).json({ alltime: {}, monthly: {}, daily: {} });
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    const getTop = async (periodKey) => {
      // Fetch top 50 by plays
      const playsKey = `verse_stats:${periodKey}:plays`;
      const completesKey = `verse_stats:${periodKey}:completes`;
      
      const topPlays = await redis.zrange(playsKey, 0, 49, { rev: true, withScores: true });
      
      const results = {};
      // topPlays comes back as [ref, score, ref, score...]
      for (let i = 0; i < topPlays.length; i += 2) {
        const ref = topPlays[i];
        const plays = Number(topPlays[i+1]);
        results[ref] = { plays, completes: 0 };
      }

      // We also need completes. We can query the completes specifically for the top refs,
      // or we can just fetch top completes and merge.
      // Since it's a small app, let's fetch completes scores for the same refs.
      if (topPlays.length > 0) {
        const refs = Object.keys(results);
        const pipeline = redis.pipeline();
        refs.forEach(r => pipeline.zscore(completesKey, r));
        const completesScores = await pipeline.exec();
        
        refs.forEach((r, idx) => {
          results[r].completes = Number(completesScores[idx]) || 0;
        });
      }

      return results;
    };

    const [alltime, monthly, daily] = await Promise.all([
      getTop('alltime'),
      getTop(`monthly:${month}`),
      getTop(`daily:${today}`)
    ]);

    res.status(200).json({ alltime, monthly, daily });
  } catch (error) {
    console.error("Failed to get top verses", error);
    res.status(500).json({ error: error.message });
  }
}
