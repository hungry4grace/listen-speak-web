import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json([]);

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });

    const playerNames = await redis.smembers('map:players');
    if (!playerNames || playerNames.length === 0) return res.status(200).json([]);

    const pipeline = redis.pipeline();
    for (const name of playerNames) {
      pipeline.hgetall(`map:player:${name}`);
    }
    const results = await pipeline.exec();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const players = results
      .filter(r => r && r.lat && r.lng && !uuidRegex.test(r.name))
      .map(r => {
        const updatedAt = r.updatedAt ? parseInt(r.updatedAt) : 0;
        // If the player's last update was more than 15 minutes ago, they are no longer in an active room
        const isStale = (Date.now() - updatedAt) > 15 * 60 * 1000;
        return {
          name: r.name,
          score: parseFloat(r.score || 0),
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lng),
          country: r.country || '',
          city: r.city || '',
          verseRef: r.verseRef || '',
          roomId: isStale ? null : (r.roomId || null),
          updatedAt
        };
      });

    res.status(200).json(players);
  } catch (error) {
    console.error('Failed to get player map', error);
    res.status(500).json({ error: error.message });
  }
}
