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

  const { setId, limit = 10, offset = 0 } = req.query;

  if (!setId) {
    return res.status(400).json({ error: 'Missing setId' });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(200).json({ records: [], totalRecords: 0 });
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    const zsetKey = `leaderboard:set:${setId}`;
    const metaKey = `leaderboard_meta:set:${setId}`;

    // Get total count
    const totalRecords = await redis.zcard(zsetKey);

    if (totalRecords === 0) {
        return res.status(200).json({ records: [], totalRecords: 0 });
    }

    // Fetch players and scores
    const topPlayers = await redis.zrange(zsetKey, offset, parseInt(offset) + parseInt(limit) - 1, { rev: true, withScores: true });
    
    // ZRANGE withScores returns [member1, score1, member2, score2, ...]
    const parsedPlayers = [];
    for (let i = 0; i < topPlayers.length; i += 2) {
      parsedPlayers.push({
        name: topPlayers[i],
        score: topPlayers[i + 1]
      });
    }

    // Fetch metadata for these players
    const members = parsedPlayers.map(p => p.name);
    let metadataArray = [];
    if (members.length > 0) {
      metadataArray = await redis.hmget(metaKey, ...members);
    }

    const records = parsedPlayers.map((player) => {
      let meta = {};
      try {
        if (metadataArray && metadataArray[player.name]) {
            let rawMeta = metadataArray[player.name];
            meta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
        }
      } catch (e) {
        // Ignore parse error
      }
      return {
        name: player.name,
        score: player.score,
        mode: meta.mode || '未知 (Unknown)',
        passedCount: meta.passedCount || 0,
        totalCount: meta.totalCount || 0,
        date: meta.date || null
      };
    });

    res.status(200).json({ records, totalRecords });
  } catch (error) {
    console.error("Failed to fetch set scores", error);
    res.status(500).json({ error: error.message });
  }
}
