import webpush from 'web-push';
import { Redis } from '@upstash/redis';
import { prefixedRedis } from '../../lib/redisPrefix.js';

// Shared helper: send a web-push notification to every subscription a user has
// registered under their personalCode (see api/save-push-code.js), and prune
// any that Apple/Google report as gone (404/410). Files under api/_lib are not
// treated as routes by Vercel. Fails soft — a missing env or empty inbox is a
// no-op, never an error, so the caller's main work (the LPUSH) is unaffected.
export async function sendReferralPush(code, { title, body, url, tag } = {}) {
  if (!code || !title || !body) return { sent: 0 };

  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !redisUrl || !redisToken) return { sent: 0, mocked: true };

  const redis = prefixedRedis(new Redis({ url: redisUrl, token: redisToken }));
  const key = `pushsubs:${code}`;
  let rows = {};
  try { rows = (await redis.hgetall(key)) || {}; } catch { return { sent: 0 }; }
  const entries = Object.entries(rows);
  if (!entries.length) return { sent: 0 };

  webpush.setVapidDetails('mailto:hungry4grace@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);
  const payload = JSON.stringify({
    title,
    body: body.length > 200 ? body.slice(0, 200) + '…' : body,
    url: url || 'https://www.verserain.com/',
    tag: tag || `verserain-referral-${Date.now()}`,
  });

  let sent = 0;
  const expired = [];
  await Promise.all(entries.map(async ([endpoint, val]) => {
    let sub;
    try { sub = typeof val === 'string' ? JSON.parse(val) : val; } catch { return; }
    if (!sub || !sub.endpoint) return;
    try {
      await webpush.sendNotification(sub, payload, { TTL: 6 * 60 * 60 });
      sent++;
    } catch (err) {
      const c = err && err.statusCode ? err.statusCode : 0;
      if (c === 404 || c === 410) expired.push(endpoint);
    }
  }));
  if (expired.length) { try { await redis.hdel(key, ...expired); } catch { /* ignore */ } }
  return { sent, expired: expired.length };
}
