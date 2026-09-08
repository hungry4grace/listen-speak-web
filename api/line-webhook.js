// POST /api/line-webhook  (LINE Messaging API webhook)
// ---------------------------------------------------------------------------
// Auto-binds a LINE group to a Cloud Family so the host never has to find a
// "group ID". The flow for a host:
//   1. Invite the VerseRain bot into the family's LINE group.
//   2. Type the family's invite code in the group (e.g. "IZ2-5HAF" or
//      "綁定 IZ2-5HAF").
//   3. The bot links this group to that family and confirms. Done — the 7am
//      daily verse will now post into the group.
//
// Env:
//   PARTY_BASE                 PartyKit base (defaults to the prod host)
//   ADMIN_TOKEN                matches the PartyKit ADMIN_TOKEN (binds the group)
//   LINE_CHANNEL_ACCESS_TOKEN  to reply into the group
//   LINE_CHANNEL_SECRET        to verify the webhook signature (recommended)
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

// We need the raw body to verify LINE's signature, so disable Vercel's parser.
export const config = { api: { bodyParser: false } };

const PARTY_BASE = (process.env.PARTY_BASE || 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || '';

// Matches a VerseRain invite code: 3 then 4 alphanumerics, dash optional.
const CODE_RE = /\b([A-Za-z0-9]{3}-?[A-Za-z0-9]{4})\b/;
const BIND_KEYWORD = /綁定|連結|bind|verserain|link/i;

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

async function lineReply(replyToken, text) {
  if (!LINE_TOKEN || !replyToken) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
  } catch { /* never let a reply failure 500 the webhook */ }
}

async function bindGroup(groupId, inviteCode) {
  try {
    const res = await fetch(`${PARTY_BASE}/teams/set-line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
      body: JSON.stringify({ groupId, inviteCode }),
    });
    return await res.json().catch(() => ({}));
  } catch { return {}; }
}

export default async function handler(req, res) {
  // LINE pings the webhook with a verify request; always 200 quickly.
  if (req.method !== 'POST') { res.status(200).send('ok'); return; }

  const raw = await readRaw(req);

  if (LINE_SECRET) {
    const sig = req.headers['x-line-signature'] || '';
    const expected = crypto.createHmac('sha256', LINE_SECRET).update(raw).digest('base64');
    // Constant-time compare; reject forged calls.
    const a = Buffer.from(String(sig)); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).send('bad signature');
      return;
    }
  }

  let body = {};
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { /* keep {} */ }
  const events = Array.isArray(body.events) ? body.events : [];

  for (const ev of events) {
    const groupId = ev?.source?.groupId;
    if (!groupId) continue; // only group chats can be bound

    // Bot was just added to the group — explain how to link it.
    if (ev.type === 'join') {
      await lineReply(ev.replyToken,
        '🌧️ VerseRain 已加入！\n請在這裡輸入你的雲端家人邀請碼（例如 IZ2-5HAF）來連結這個群組。\n之後每天早上 7 點，今日經文會自動送到這裡 🙏');
      continue;
    }

    // A text message — bind only if it clearly carries an invite code.
    if (ev.type === 'message' && ev.message?.type === 'text') {
      const text = (ev.message.text || '').trim();
      const m = CODE_RE.exec(text);
      if (!m) continue;
      const codeAlone = text.replace(/[^A-Za-z0-9-]/g, '') === m[1].replace(/[^A-Za-z0-9-]/g, '');
      if (!codeAlone && !BIND_KEYWORD.test(text)) continue; // ordinary chatter — ignore

      const r = await bindGroup(groupId, m[1]);
      if (r.success) {
        await lineReply(ev.replyToken,
          `✅ 已連結雲端家人「${r.name}」。\n明天早上 7 點開始，今日經文會自動送到這個群組 🙏`);
      } else {
        await lineReply(ev.replyToken,
          '⚠️ 連結失敗：找不到這個邀請碼。請確認後再輸入一次（格式像 IZ2-5HAF）。');
      }
    }
  }

  res.status(200).send('ok');
}
