// POST /api/get-team-set-status
// Body: { setIds: [string], names: [string] }
// Returns: { status: { [setId]: { [name]: { passedCount, totalCount, date, mode } } } }
//
// One round-trip per setId (Redis HMGET on all names against that set's
// leaderboard_meta hash). Used by the Companion Teams feature to derive
// per-member per-scheduled-set completion without each team rendering
// 1+N×M individual REST calls.

import { Redis } from '@upstash/redis';

const MAX_SETS = 50;
const MAX_NAMES = 250;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const setIds = Array.isArray(req.body?.setIds) ? req.body.setIds.filter(s => typeof s === 'string' && s).slice(0, MAX_SETS) : [];
  const names = Array.isArray(req.body?.names) ? req.body.names.filter(s => typeof s === 'string' && s).slice(0, MAX_NAMES) : [];

  if (setIds.length === 0 || names.length === 0) {
    return res.status(200).json({ status: {} });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return res.status(200).json({ status: {}, mocked: true });

  try {
    const redis = new Redis({ url: redisUrl, token: redisToken });

    const status = {};
    await Promise.all(setIds.map(async (setId) => {
      const metaKey = `leaderboard_meta:set:${setId}`;
      // hmget returns null for missing fields; preserves order with names[].
      const values = await redis.hmget(metaKey, ...names);
      const perName = {};
      // Upstash hmget returns an object keyed by field name in newer SDKs
      // (defensive: handle both array and object shapes).
      const asArray = Array.isArray(values) ? values : names.map(n => values?.[n] ?? null);
      asArray.forEach((raw, idx) => {
        if (raw == null) return;
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && typeof parsed === 'object') {
            perName[names[idx]] = {
              passedCount: Number(parsed.passedCount) || 0,
              totalCount: Number(parsed.totalCount) || 0,
              date: parsed.date || '',
              mode: parsed.mode || '',
            };
          }
        } catch { /* malformed; skip */ }
      });
      status[setId] = perName;
    }));

    res.status(200).json({ status });
  } catch (error) {
    console.error('get-team-set-status failed', error);
    res.status(500).json({ error: error.message });
  }
}
