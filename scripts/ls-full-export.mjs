#!/usr/bin/env node
// Full copy of the old 聽說 PartyKit room, key by key — accounts, sets,
// recordings, pictures, gardens, everything. Possible because
// PartyKit re-opened deploys for us until 30 Oct 2026: deploy the current
// server (it has /admin/export) with `npx partykit deploy`, then
//
//   node scripts/ls-full-export.mjs            (run from listen-speak-web/)
//
// Needs PARTYKIT_ADMIN_TOKEN (or ADMIN_TOKEN) in .env.local. Writes
// backup/ls-full-<timestamp>/page-NNNN.json — personal data and password
// hashes: never commit it (backup/ is git-ignored), never share it. Load it
// into the new server with scripts/partyserver-restore.mjs.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const BASE = (process.env.PARTY_BASE || 'https://listenspeak-party.hungry4grace.partykit.dev/parties/main/global-auth-db').replace(/\/+$/, '');

function adminToken() {
  if (process.env.PARTYKIT_ADMIN_TOKEN || process.env.ADMIN_TOKEN) return process.env.PARTYKIT_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    const m = env.match(/^(?:PARTYKIT_ADMIN_TOKEN|ADMIN_TOKEN)=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* no .env.local */ }
  return '';
}
const TOKEN = adminToken();
if (!TOKEN) { console.error('No PARTYKIT_ADMIN_TOKEN / ADMIN_TOKEN in the environment or .env.local.'); process.exit(1); }

async function page(after) {
  const url = `${BASE}/admin/export${after ? `?after=${encodeURIComponent(after)}` : ''}`;
  for (let i = 0; i < 5; i += 1) {
    try {
      const res = await fetch(url, { headers: { 'x-admin-token': TOKEN } });
      if (res.status === 404) throw new Error('no /admin/export on PartyKit yet — run `npx partykit deploy` first');
      if (res.status === 401) throw new Error('the old PartyKit project refused this admin token — add it there:  npx partykit env add ADMIN_TOKEN  (paste the same token), then  npx partykit deploy  again');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === 4 || /partykit deploy|refused/.test(e.message)) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = path.join(ROOT, 'backup', `ls-full-${stamp}`);
fs.mkdirSync(OUT, { recursive: true });

const counts = {};
let after = '', n = 0, total = 0;
try {
  for (;;) {
    const r = await page(after);
    n += 1;
    fs.writeFileSync(path.join(OUT, `page-${String(n).padStart(4, '0')}.json`), JSON.stringify(r.entries));
    for (const [key] of r.entries) {
      const kind = key.includes(':') ? key.slice(0, key.indexOf(':') + 1) : key;
      counts[kind] = (counts[kind] || 0) + 1;
    }
    total += r.entries.length;
    process.stdout.write(`\r  ${total} keys (${n} pages)`);
    if (!r.next) break;
    after = r.next;
  }
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), total, counts }, null, 1));
console.log(`\n\nSaved ${total} keys to ${OUT}`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, c]) => `  ${k.padEnd(28)} ${c}`).join('\n'));
console.log('\nNext: node scripts/partyserver-restore.mjs https://listenspeak-party.verserain.workers.dev/parties/main/global-auth-db');
