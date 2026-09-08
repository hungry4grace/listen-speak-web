import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST')
  
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let { author, amount = 1, player, verseSetName } = req.body;
  if (!author) return res.status(400).json({ error: 'Missing author' });

  // Transfer credit for 福音四步 back to the original creator EmilyWen
  if (verseSetName && verseSetName.includes('福音四步')) {
    author = 'EmilyWen';
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ success: true, mocked: true });

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    let actualAmount = 0;
    
    if (player && verseSetName) {
      // Check if this player has played this specific set before
      const setKey = `gamification:unique_players:${author}:${verseSetName}`;
      const isNew = await redis.sadd(setKey, player);
      
      if (isNew === 1) {
        actualAmount = 1; // Only give 1 point for the very first play
      }
    } else {
      // Fallback for older clients that don't send player/verseSetName
      actualAmount = 1;
    }

    const promises = [];
    
    if (actualAmount > 0) {
      promises.push(redis.zincrby('verse_stats:creator_points', actualAmount, author));
    }
    
    if (player && verseSetName) {
      const record = JSON.stringify({ player, verseSetName, amount: actualAmount, timestamp: Date.now() });
      promises.push(redis.lpush(`gamification:history:creator:${author}`, record));
    }
    
    await Promise.all(promises);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
