import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    return res.status(200).json({ alltime: [], monthly: [], daily: [] });
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    // We only need top 100 players from the pre-aggregated sum keys
    const [alltimeData, monthlyData, dailyData] = await Promise.all([
        redis.zrange('leaderboard_sum:alltime', 0, 99, { rev: true, withScores: true }).catch(() => []),
        redis.zrange(`leaderboard_sum:monthly:${month}`, 0, 99, { rev: true, withScores: true }).catch(() => []),
        redis.zrange(`leaderboard_sum:daily:${today}`, 0, 99, { rev: true, withScores: true }).catch(() => [])
    ]);

    const formatAggregatedData = async (sumDataArray, clearsKey) => {
        let players = [];
        const codeRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[2-9])[A-HJ-NP-Za-km-z2-9]{10}$/;
        if (sumDataArray.length > 0 && typeof sumDataArray[0] === 'object') {
            sumDataArray.forEach(el => {
                if (!codeRegex.test(el.member)) {
                    players.push({ name: el.member, total: el.score, clears: 0 });
                }
            });
        } else {
            for (let i = 0; i < sumDataArray.length; i += 2) {
                const member = sumDataArray[i];
                if (!codeRegex.test(member)) {
                    players.push({ name: member, total: parseFloat(sumDataArray[i + 1]), clears: 0 });
                }
            }
        }
        
        // Fetch clears for these specific players
        if (players.length > 0) {
            // Because Upstash Redis zmsore exists, but we can just use a pipeline or individual zscores
            // For simplicity and to avoid timeout, if it's less than 100, we can use a pipeline
            const p = redis.pipeline();
            players.forEach(player => p.zscore(clearsKey, player.name));
            const clearsScores = await p.exec().catch(() => []);
            players.forEach((player, idx) => {
                player.clears = parseFloat(clearsScores[idx]) || 0;
            });
        }
        return players;
    };

    const alltime = await formatAggregatedData(alltimeData, 'leaderboard_clears:alltime');
    const monthly = await formatAggregatedData(monthlyData, `leaderboard_clears:monthly:${month}`);
    const daily = await formatAggregatedData(dailyData, `leaderboard_clears:daily:${today}`);

    const [creatorData, referralData] = await Promise.all([
      redis.zrange('verse_stats:creator_points', 0, -1, { withScores: true }).catch(() => []),
      redis.zrange('gamification:referrals:alltime', 0, -1, { withScores: true }).catch(() => [])
    ]);

    const bonusFruitsMap = {};
    const processBonus = (data, key) => {
      let elements = [];
      if (data.length > 0 && typeof data[0] === 'object') {
        elements = data;
      } else {
        for (let i = 0; i < data.length; i += 2) {
          elements.push({ member: data[i], score: parseFloat(data[i + 1]) });
        }
      }
      elements.forEach(el => {
        if (!bonusFruitsMap[el.member]) bonusFruitsMap[el.member] = { creatorPoints: 0, referralPoints: 0 };
        bonusFruitsMap[el.member][key] = el.score;
      });
    };
    processBonus(creatorData, 'creatorPoints');
    processBonus(referralData, 'referralPoints');

    res.status(200).json({ alltime, monthly, daily, bonusFruitsMap });
  } catch (error) {
    console.error("Failed to get all scores", error);
    res.status(500).json({ error: error.message });
  }
}
