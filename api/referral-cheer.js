import { Redis } from '@upstash/redis';
import { prefixedRedis } from '../lib/redisPrefix.js';
import { sendReferralPush } from './_lib/webpush.js';

// A (the inviter) sends a 讚 / cheer back to referee B for a milestone. Drops a
// 'cheer' notification into B's personalCode-keyed inbox. Idempotent per
// (fromCode, toCode, milestone) so tapping 讚 twice doesn't double-notify.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fromCode, fromName, toCode, milestone } = req.body || {};
  if (!toCode) return res.status(400).json({ error: 'Missing toCode' });
  if (fromCode && fromCode === toCode) return res.status(200).json({ success: true, self: true });

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ success: true, mocked: true });

  try {
    const redis = prefixedRedis(new Redis({ url: redisUrl, token: redisToken }));
    const ms = Number(milestone) || 0;

    if (fromCode) {
      const added = await redis.sadd(`gamification:cheer-sent:${fromCode}`, `${toCode}:${ms}`);
      if (!added) return res.status(200).json({ success: true, duplicate: true });
    }

    const key = `gamification:notify:${toCode}`;
    const record = JSON.stringify({
      kind: 'cheer',
      fromCode: fromCode || '',
      fromName: fromName || '',
      milestone: ms,
      at: new Date().toISOString(),
    });
    await redis.lpush(key, record);
    await redis.ltrim(key, 0, 49);

    // Also push to the referee's phone (best-effort; never blocks the response).
    await sendReferralPush(toCode, {
      title: '👍 VerseRain',
      body: `${fromName || '邀請你的人'} 給你一個讚，鼓勵你繼續加油！`,
      url: 'https://www.verserain.com/?notify=1',
      tag: `verserain-cheer-${fromCode || ''}-${ms}`,
    }).catch(() => {});

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
