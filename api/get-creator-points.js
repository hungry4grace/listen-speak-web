import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { author, stats, history } = req.query;
  if (!author && !stats) return res.status(400).json({ error: 'Missing author or stats query' });

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ points: 0, mocked: true, allScores: [] });

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });
    
    if (stats === 'true') {
      // Fetch all scores from the zset
      const allData = await redis.zrange('verse_stats:creator_points', 0, -1, { withScores: true });
      // Upstash zrange withScores returns [member1, score1, member2, score2, ...]
      const scores = [];
      for (let i = 1; i < allData.length; i += 2) {
        scores.push(parseFloat(allData[i]) || 0);
      }
      return res.status(200).json({ allScores: scores });
    }

    const pPts = redis.zscore('verse_stats:creator_points', author);
    const pRef = redis.zscore('gamification:referrals:alltime', author);
    const [pts, refPts] = await Promise.all([pPts, pRef]);
    
    let creatorHistory = [];
    let referralHistory = [];
    
    if (history === 'true') {
      const p1 = redis.lrange(`gamification:history:creator:${author}`, 0, 499);
      const p2 = redis.lrange(`gamification:history:referral:${author}`, 0, 499);
      const p3 = redis.hgetall('player_mapping');
      const [cHist, rHist, mappings] = await Promise.all([p1, p2, p3]);
      
      const mappingDict = mappings || {};
      
      creatorHistory = (cHist || []).map(s => typeof s === 'string' ? JSON.parse(s) : s);
      referralHistory = (rHist || []).map(s => {
        const item = typeof s === 'string' ? JSON.parse(s) : s;
        if (item.player && mappingDict[item.player]) {
          item.player = mappingDict[item.player]; // Resolve nickname
        }
        return item;
      });
    }

    res.status(200).json({ 
      points: parseFloat(pts) || 0,
      referralPoints: parseFloat(refPts) || 0,
      creatorHistory,
      referralHistory
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
