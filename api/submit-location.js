import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, score, lat, lng, country, city, verseRef, roomId } = req.body;

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (!name || isNaN(latNum) || isNaN(lngNum)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ success: true, mocked: true });

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });

    // Always update to latest location & best score
    const playerKey = `map:player:${name}`;
    const existing = await redis.hgetall(playerKey);
    const existingScore = existing ? parseFloat(existing.score || 0) : 0;
    const bestScore = Math.max(existingScore, score || 0);

    await redis.hset(playerKey, {
      name,
      score: bestScore,
      lat: latNum.toFixed(4),
      lng: lngNum.toFixed(4),
      country: country || '',
      city: city || '',
      verseRef: verseRef || '',
      roomId: roomId || '',
      updatedAt: Date.now()
    });
    // Keep a set of all player keys for easy retrieval
    await redis.sadd('map:players', name);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Failed to submit location', error);
    res.status(500).json({ error: error.message });
  }
}
