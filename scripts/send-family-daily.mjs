// scripts/send-family-daily.mjs
// ---------------------------------------------------------------------------
// Cloud Family (雲端家人) daily nudge sender.
//
// Run hourly by .github/workflows/family-daily.yml. Each run:
//   1. Pulls every team's send manifest from /teams/daily-feed (admin token).
//   2. For each team where it is now 07:00 in the HOST's local timezone and
//      today's nudge hasn't already gone out, builds today's verse + deep link.
//   3. Sends it via Web Push to members' devices AND — if the team configured a
//      LINE group — posts it into the LINE group via the Messaging API.
//   4. Marks the team sent (idempotent) so a second run in the 7am hour is a
//      no-op.
//
// Required env:
//   PARTY_BASE                 e.g. https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db
//   ADMIN_TOKEN                matches the PartyKit ADMIN_TOKEN / PARTYKIT_ADMIN_TOKEN
//   VAPID_PUBLIC_KEY           same public key shipped in src/pushConfig.js
//   VAPID_PRIVATE_KEY          the matching private key (secret)
// Optional env:
//   VAPID_SUBJECT              mailto: contact (default mailto:hungry4grace@gmail.com)
//   LINE_CHANNEL_ACCESS_TOKEN  LINE Messaging API channel token; enables group posts
//   PUBLIC_ORIGIN              default https://www.verserain.com
//   SEND_HOUR                  local hour to send (default 7)
//   FORCE                      "1" to ignore the 7am gate (manual test runs)
//   DRY_RUN                    "1" to log what WOULD send without sending
// ---------------------------------------------------------------------------

import webpush from 'web-push';

const PARTY_BASE = (process.env.PARTY_BASE || 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:hungry4grace@gmail.com';
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || 'https://www.verserain.com').replace(/\/+$/, '');
const SEND_HOUR = Number.isFinite(+process.env.SEND_HOUR) ? +process.env.SEND_HOUR : 7;
const FORCE = process.env.FORCE === '1';
const DRY_RUN = process.env.DRY_RUN === '1';

function die(msg) { console.error(`[family-daily] ${msg}`); process.exit(1); }

if (!ADMIN_TOKEN) die('ADMIN_TOKEN is required');
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) die('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required');
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// Local wall-clock hour (0-23) in an IANA timezone, or null if unknown.
function localHour(tz) {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date());
    const h = parseInt(s, 10);
    if (!Number.isFinite(h)) return null;
    return h === 24 ? 0 : h;
  } catch { return null; }
}

// Local calendar date (YYYY-MM-DD) in an IANA timezone — the idempotency key.
function localDate(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}

function truncate(s, n) {
  const str = String(s || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// The link we share. Points at the OG card endpoint (/fc) so LINE renders a
// rich preview; that endpoint redirects humans into the SPA deep link, which
// credits today's reading and offers the one-tap Amen.
function buildShareUrl(team, item) {
  // Keep the link short — the /fc card resolves the verse from (team, set, i)
  // server-side, so we don't pack the encoded verse text into the URL.
  const p = new URLSearchParams({
    team: team.teamId,
    set: item.setId,
    i: String(item.dayIndex),
    amen: '1',
  });
  return `${PUBLIC_ORIGIN}/fc?${p.toString()}`;
}

// LINE's native share scheme: opens LINE with the message pre-filled so the
// host just picks the family group and hits send. No bot, no setup. The /fc
// link inside renders as a rich verse card in the chat.
function buildLineForwardUrl({ title, verseRef, verseText, ogUrl }) {
  // Only include the lines we actually have; the link is the essential part.
  const lines = [title];
  if (verseRef) lines.push(verseRef);
  if (verseText) lines.push(`「${verseText}」`);
  lines.push('', ogUrl);
  return `https://line.me/R/share?text=${encodeURIComponent(lines.join('\n'))}`;
}

async function fetchFeed() {
  const res = await fetch(`${PARTY_BASE}/teams/daily-feed`, {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  if (!res.ok) die(`daily-feed ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return Array.isArray(data.teams) ? data.teams : [];
}

async function markSent(teamId, date) {
  if (DRY_RUN) return;
  await fetch(`${PARTY_BASE}/teams/mark-daily-sent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ teamId, date }),
  }).catch((e) => console.warn('[family-daily] markSent failed', String(e)));
}

async function dropExpiredSub(endpoint) {
  if (DRY_RUN || !endpoint) return;
  await fetch(`${PARTY_BASE}/delete-push-subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

async function sendWebPush(subscriptions, payload) {
  let sent = 0, expired = 0;
  await Promise.all((subscriptions || []).map(async (sub) => {
    if (!sub?.endpoint) return;
    if (DRY_RUN) { sent++; return; }
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 60 * 60 });
      sent++;
    } catch (err) {
      const code = err?.statusCode || 0;
      if (code === 404 || code === 410) { expired++; await dropExpiredSub(sub.endpoint); }
    }
  }));
  return { sent, expired };
}

// LINE Messaging API push: a Flex bubble (with a plain-text altText fallback).
async function sendLine(groupId, { title, verseRef, verseText, url }) {
  if (!LINE_TOKEN || !groupId) return { ok: false, skipped: true };
  const altText = truncate(`${title}\n${verseRef}｜${verseText}\n${url}`, 380);
  const bubble = {
    type: 'bubble',
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: [
        { type: 'text', text: truncate(title, 60), weight: 'bold', size: 'md', color: '#1d4ed8', wrap: true },
        { type: 'text', text: truncate(verseRef, 60), size: 'sm', color: '#6b7280', wrap: true },
        { type: 'text', text: truncate(`「${verseText}」`, 300), size: 'md', color: '#111827', wrap: true },
      ],
    },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{
        type: 'button', style: 'primary', color: '#2563eb',
        action: { type: 'uri', label: '讀經 · Read & Amen 🙏', uri: url },
      }],
    },
  };
  const messages = [{ type: 'flex', altText, contents: bubble }];
  if (DRY_RUN) return { ok: true, dryRun: true };
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify({ to: groupId, messages }),
  });
  if (!res.ok) {
    console.warn(`[family-daily] LINE push failed ${res.status}: ${await res.text().catch(() => '')}`);
    return { ok: false };
  }
  return { ok: true };
}

async function main() {
  const teams = await fetchFeed();
  console.log(`[family-daily] feed: ${teams.length} team(s) with a verse for today${DRY_RUN ? ' (DRY_RUN)' : ''}${FORCE ? ' (FORCE)' : ''}`);

  let processed = 0;
  for (const team of teams) {
    const tz = team.hostTimezone || 'Asia/Taipei';
    const hour = localHour(tz);
    const date = localDate(tz);

    if (!FORCE && hour !== SEND_HOUR) continue;            // not 7am where the host lives
    if (team.lastDailySent === date) continue;             // already nudged today
    const item = team.item;
    if (!item || !item.setId) continue;                    // need at least a set to link to

    const ogUrl = buildShareUrl(team, item);
    const dayLabel = `Day ${item.dayIndex + 1}/${item.totalCount}`;
    const title = `📖 ${truncate(team.name, 28)} · ${truncate(item.title || '', 28)} (${dayLabel})`;
    // Verse text/reference are optional — the link always opens today's reading.
    const body = [item.reference, item.text ? truncate(item.text, 120) : '']
      .filter(Boolean).join('｜') || '今天的經文已準備好，點開一起讀 🙏';

    // Is this team's LINE group bound to the bot? If so we auto-post and the
    // host needn't forward; otherwise the host gets a one-tap forward prompt.
    const groupBound = !!(team.line?.groupId && LINE_TOKEN);

    // Split the host's devices out from the rest of the members.
    const hostSubs = team.hostSubscriptions || [];
    const hostEndpoints = new Set(hostSubs.map((s) => s?.endpoint).filter(Boolean));
    const memberSubs = (team.subscriptions || []).filter((s) => s?.endpoint && !hostEndpoints.has(s.endpoint));

    let hostResult = { sent: 0, expired: 0 };
    if (!groupBound && hostSubs.length) {
      // Host: "share to your family" — tapping opens LINE's share sheet.
      const lineUrl = buildLineForwardUrl({ title, verseRef: item.reference, verseText: item.text, ogUrl });
      if (DRY_RUN) console.log(`[family-daily]   host-forward url: ${lineUrl.slice(0, 48)}`);
      hostResult = await sendWebPush(hostSubs, {
        // Make the tap's outcome explicit — tapping opens LINE's share
        // sheet (NOT the app), which surprised hosts with the old title.
        title: `🙏 點我轉發今日經文給家人（會開啟 LINE） / Tap to forward to family (opens LINE)`,
        body,
        url: lineUrl,
        icon: '/favicon.svg',
        tag: `family-forward-${team.teamId}-${date}`,
      });
    }

    // Everyone else who enabled push gets a direct read+Amen nudge.
    const memberResult = await sendWebPush(memberSubs, {
      title,
      body,
      url: ogUrl,
      icon: '/favicon.svg',
      tag: `family-daily-${team.teamId}-${date}`,
    });

    // Power-user path: if the group is bound, auto-post into it too.
    const line = await sendLine(team.line?.groupId, {
      title, verseRef: item.reference, verseText: item.text, url: ogUrl,
    });

    await markSent(team.teamId, date);
    processed++;
    console.log(`[family-daily] ${team.name} (${tz}) → ` +
      `forward→host=${hostResult.sent} read→members=${memberResult.sent} ` +
      `expired=${hostResult.expired + memberResult.expired}` +
      `${line.skipped ? '' : ` · LINE-group=${line.ok ? 'ok' : 'fail'}`}`);
  }

  console.log(`[family-daily] done — ${processed} team(s) nudged this run.`);
}

main().catch((e) => die(String(e?.stack || e)));
