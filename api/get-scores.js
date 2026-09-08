import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const verseRef = req.query.verseRef || 'global';

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!redisUrl || !redisToken) {
    console.log("Mocking scores because Upstash is not yet connected");
    return res.status(200).json([
      { name: "👑 虛位以待", score: 5000, date: Date.now() },
      { name: "趕快去申請資料庫", score: 3000, date: Date.now() - 100000 }
    ]);
  }

  try {
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });

    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    let allTimeKey = `leaderboard:${verseRef}`;
    let monthlyKey = `leaderboard:monthly:${month}:${verseRef}`;
    let dailyKey = `leaderboard:daily:${today}:${verseRef}`;

    if (verseRef === 'sum') {
      allTimeKey = 'leaderboard_sum:alltime';
      monthlyKey = `leaderboard_sum:monthly:${month}`;
      dailyKey = `leaderboard_sum:daily:${today}`;
    }

    const metas = await redis.hgetall(`leaderboard_meta:${verseRef}`) || {};

    async function getFormatted(key) {
      const elements = await redis.zrange(key, 0, 99, { rev: true, withScores: true });
      const result = [];
      // Strict regex for 10-char alphanumeric personal codes (must have upper, lower, and digit from specific charset)
      const codeRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[2-9])[A-HJ-NP-Za-km-z2-9]{10}$/; 
      if (elements.length > 0 && typeof elements[0] === 'object') {
         elements.forEach(el => {
           if (!codeRegex.test(el.member)) {
             result.push({ name: el.member, score: el.score, mode: metas[el.member] || 'rain' });
           }
         });
      } else {
         for (let i = 0; i < elements.length; i += 2) {
           const member = elements[i];
           if (!codeRegex.test(member)) {
             result.push({ name: member, score: elements[i + 1], mode: metas[member] || 'rain' });
           }
         }
      }
      return result.slice(0, 50); // Return top 50 valid names
    }

    const [alltime, monthly, daily] = await Promise.all([
       getFormatted(allTimeKey),
       getFormatted(monthlyKey),
       getFormatted(dailyKey)
    ]);

    res.status(200).json({ alltime, monthly, daily });
  } catch (error) {
    console.error("Failed to get scores", error);
    res.status(500).json({ error: error.message });
  }
}
