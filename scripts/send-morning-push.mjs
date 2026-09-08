// Morning daily-verse sender — runs hourly from GitHub Actions
// (.github/workflows/morning-push.yml).
//
// Two transports, same 7am-local gate and same deep link:
//   1. Web Push  — browsers/PWA subscriptions stored under `push:` in the
//      PartyKit room (subscribed via the web app's push modal).
//   2. APNs      — native iOS app device tokens stored under `apns:`
//      (uploaded by DailyVersePushBridge.swift in the wrapper app).
//
// For each subscriber whose local time is currently their chosen hour
// (default 07:00), fetch the day's verse in their translation and send:
//   { title: 🌧️ <reference>, body: <verse text>, url: /?listenDaily=… }
//
// Env (see workflow):
//   PARTYKIT_HOST, PARTYKIT_ADMIN_TOKEN, DAILY_VERSE_HOST
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
//   APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY (p8 PEM), APNS_BUNDLE_ID,
//   APNS_HOST (default api.push.apple.com — Xcode debug builds use the
//   sandbox host, TestFlight/App Store builds use production)
//   FORCE=1  → ignore the hour gate (manual test runs)
//   DRY_RUN=1 → log what would send, send nothing

import webpush from 'web-push';
import http2 from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';

const host = process.env.PARTYKIT_HOST;
const adminToken = process.env.PARTYKIT_ADMIN_TOKEN;
const verseHost = process.env.DAILY_VERSE_HOST || 'https://www.verserain.com';
const force = process.env.FORCE === '1';
const dryRun = process.env.DRY_RUN === '1';

if (!host || !adminToken) {
  console.error('PARTYKIT_HOST and PARTYKIT_ADMIN_TOKEN are required.');
  process.exit(1);
}

const roomBase = `${host}/parties/main/global-auth-db`;
const today = new Date().toISOString().slice(0, 10);

// ─── Shared helpers ───────────────────────────────────────────────────────

function matchesHour(entry) {
  if (force) return true;
  const tz = entry.timezone || 'Asia/Taipei';
  try {
    const localHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false,
    }).format(new Date()));
    const target = typeof entry.hour === 'number' ? entry.hour : 7;
    return localHour === target;
  } catch {
    console.warn(`Bad timezone "${tz}", skipping:`, entry.playerName);
    return false;
  }
}

const verseCache = new Map();
async function getVerse(version) {
  const v = version || 'cuv';
  if (verseCache.has(v)) return verseCache.get(v);
  let verse = null;
  try {
    const r = await fetch(`${verseHost}/api/daily-verse?date=${today}&version=${v}`);
    if (r.ok) verse = await r.json();
  } catch (e) {
    console.warn(`Failed to fetch verse for ${v}:`, e.message);
  }
  if (!verse?.text) verse = null;
  verseCache.set(v, verse);
  return verse;
}

function buildMessage(verse, version) {
  const url = `${verseHost}/?listenDaily=${encodeURIComponent(verse.date || today)}&version=${encodeURIComponent(version)}`;
  return {
    title: `🌧️ ${verse.reference}`,
    body: verse.text.length > 200 ? verse.text.slice(0, 200) + '…' : verse.text,
    url,
    tag: `verserain-daily-${verse.date || today}`,
  };
}

async function fetchList(path, key) {
  const res = await fetch(`${roomBase}${path}`, { headers: { 'x-admin-token': adminToken } });
  if (!res.ok) {
    console.error(`Failed to fetch ${path}:`, res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data[key] || [];
}

// ─── 1. Web Push ──────────────────────────────────────────────────────────

async function sendWebPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.log('Web Push: VAPID keys not set, skipping.');
    return;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:hungry4grace@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const subscriptions = await fetchList('/push-subscriptions', 'subscriptions');
  if (!subscriptions) return;
  console.log(`Web Push: ${subscriptions.length} total subscriptions.`);

  const matches = subscriptions.filter(matchesHour);
  console.log(`Web Push: ${matches.length} match this hour.`);

  for (const sub of matches) {
    const version = sub.version || 'cuv';
    const verse = await getVerse(version);
    if (!verse) { console.warn(`No verse for ${version}, skipping ${sub.playerName}`); continue; }
    const msg = buildMessage(verse, version);
    if (dryRun) { console.log(`  [dry] web → ${sub.playerName} (${version})`); continue; }
    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify(msg), { TTL: 12 * 60 * 60 });
      console.log(`  ✓ web → ${sub.playerName}`);
    } catch (err) {
      const code = err?.statusCode || 0;
      console.warn(`  ✗ web → ${sub.playerName} → ${code} ${err.body || err.message}`);
      if (code === 404 || code === 410) {
        await fetch(`${roomBase}/delete-push-subscription`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.subscription.endpoint }),
        }).catch(() => {});
      }
    }
  }
}

// ─── 2. APNs (native iOS app) ─────────────────────────────────────────────

async function sendAPNs() {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const privateKeyPem = process.env.APNS_PRIVATE_KEY;
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.hopeofglory.verserain';
  const apnsHost = process.env.APNS_HOST || 'https://api.push.apple.com';

  if (!teamId || !keyId || !privateKeyPem) {
    console.log('APNs: APNS_TEAM_ID / APNS_KEY_ID / APNS_PRIVATE_KEY not set, skipping.');
    return;
  }

  const tokens = await fetchList('/apns-tokens', 'tokens');
  if (!tokens) return;
  console.log(`APNs: ${tokens.length} total device tokens.`);

  const matches = tokens.filter(matchesHour);
  console.log(`APNs: ${matches.length} match this hour.`);
  if (!matches.length) return;

  // Provider-token auth: one ES256 JWT covers the whole run (valid 20–60 min).
  const key = await importPKCS8(privateKeyPem, 'ES256');
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuedAt()
    .setIssuer(teamId)
    .sign(key);

  const client = http2.connect(apnsHost);
  client.on('error', (e) => console.error('APNs connection error:', e.message));

  const sendOne = (token, payload, collapseId) => new Promise((resolve) => {
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 12 * 60 * 60),
      'apns-collapse-id': collapseId,
      'content-type': 'application/json',
    });
    let status = 0;
    let body = '';
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve({ status, body }));
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.setTimeout(10000, () => { req.close(); resolve({ status: 0, body: 'timeout' }); });
    req.end(JSON.stringify(payload));
  });

  for (const entry of matches) {
    const version = entry.version || 'cuv';
    const verse = await getVerse(version);
    if (!verse) { console.warn(`No verse for ${version}, skipping ${entry.playerName}`); continue; }
    const msg = buildMessage(verse, version);
    const payload = {
      aps: {
        alert: { title: msg.title, body: msg.body },
        sound: 'default',
        'thread-id': 'dailyverse',
      },
      // Read by DailyVerseNotificationRouter on tap.
      url: msg.url,
    };
    if (dryRun) { console.log(`  [dry] apns → ${entry.playerName} (${version})`); continue; }
    const { status, body } = await sendOne(entry.token, payload, msg.tag);
    if (status === 200) {
      console.log(`  ✓ apns → ${entry.playerName}`);
    } else {
      console.warn(`  ✗ apns → ${entry.playerName} → ${status} ${body}`);
      let reason = '';
      try { reason = JSON.parse(body)?.reason || ''; } catch { /* not json */ }
      // 410 Unregistered = app deleted; BadDeviceToken = token from the
      // other APNs environment or garbage. Both are permanently dead here.
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
        await fetch(`${roomBase}/delete-apns-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: entry.token }),
        }).catch(() => {});
        console.log(`    cleaned up dead token for ${entry.playerName}`);
      }
    }
  }

  client.close();
}

// ─── Run ──────────────────────────────────────────────────────────────────

await sendWebPush();
await sendAPNs();
console.log('Done.');
