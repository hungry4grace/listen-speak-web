// POST /api/push-team-cheer
// Body: { subscriptions: PushSubscription[], title, body, url, tag? }
// Sends a web-push notification to each subscription. Used by PartyKit's
// /teams/cheer endpoint to notify the recipient that someone in their
// 雲端家人 just sent encouragement.
//
// Subscriptions that return 404/410 are reported back so the caller can
// drop them from storage.

import webpush from 'web-push';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
  const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(200).json({ sent: 0, mocked: true });
  }

  const { subscriptions = [], title, body, url, tag } = req.body || {};
  if (!Array.isArray(subscriptions) || subscriptions.length === 0 || !title || !body) {
    return res.status(400).json({ error: 'subscriptions, title, body required' });
  }
  if (subscriptions.length > 20) {
    // Each recipient should have <= a handful of devices; 20 is a sanity cap.
    return res.status(400).json({ error: 'too many subscriptions in one call' });
  }

  webpush.setVapidDetails('mailto:hungry4grace@gmail.com', VAPID_PUBLIC, VAPID_PRIVATE);

  const payload = JSON.stringify({
    title,
    body: body.length > 200 ? body.slice(0, 200) + '…' : body,
    url: url || 'https://www.verserain.com/',
    tag: tag || `verserain-cheer-${Date.now()}`,
  });

  let sent = 0;
  const expired = [];
  await Promise.all(subscriptions.map(async (sub) => {
    if (!sub?.endpoint) return;
    try {
      await webpush.sendNotification(sub, payload, { TTL: 6 * 60 * 60 });
      sent++;
    } catch (err) {
      const code = err?.statusCode || 0;
      if (code === 404 || code === 410) expired.push(sub.endpoint);
    }
  }));

  return res.status(200).json({ sent, expired });
}
