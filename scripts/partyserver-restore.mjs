#!/usr/bin/env node
// Load a full PartyKit copy (scripts/ls-full-export.mjs) into the new
// server, merging with what is already there:
//
//   node scripts/partyserver-restore.mjs <new-base> [backup-dir] [--dry]
//
//   <new-base>   https://listenspeak-party.verserain.workers.dev/parties/main/global-auth-db
//   backup-dir   defaults to the newest backup/ls-full-* folder
//
// Needs the MIGRATION_IMPORT secret "on" (then delete it) and the admin token.
// The server keeps everything people did on the new server; the old copy only
// fills in what is missing (accounts, sets, recordings, pictures, favourites,
// comments…). Gardens go through /save-garden, which
// merges (higher stage wins). Safe to run more than once.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const [BASE_ARG, DIR_ARG] = args.filter(a => !a.startsWith('--'));
if (!BASE_ARG) {
  console.error('Usage: node scripts/partyserver-restore.mjs <new-base-url> [backup-dir] [--dry]');
  process.exit(1);
}
const BASE = BASE_ARG.replace(/\/+$/, '');

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
if (!TOKEN && !DRY) { console.error('No PARTYKIT_ADMIN_TOKEN / ADMIN_TOKEN found.'); process.exit(1); }

function newestBackup() {
  const dir = path.join(ROOT, 'backup');
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter(d => d.startsWith('ls-full-')).sort() : [];
  if (!all.length) { console.error('No backup/ls-full-* folder found — run scripts/ls-full-export.mjs first.'); process.exit(1); }
  return path.join(dir, all[all.length - 1]);
}
const DIR = DIR_ARG ? path.resolve(DIR_ARG) : newestBackup();
const pages = fs.readdirSync(DIR).filter(f => /^page-\d+\.json$/.test(f)).sort();

const entries = [];
const gardens = [];
for (const f of pages) {
  for (const [key, value] of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) {
    if (key.startsWith('garden:')) gardens.push([key.slice('garden:'.length), value]);
    else if (!/^(reset:|touch-ip:)/.test(key)) entries.push([key, value]);
  }
}
console.log(`Backup: ${DIR}`);
console.log(`${entries.length} keys to restore, ${gardens.length} gardens to merge`);
if (DRY) process.exit(0);

async function post(p, body) {
  for (let i = 0; i < 4; i += 1) {
    try {
      const res = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404 && p === '/admin/import') throw new Error('import is off — set the MIGRATION_IMPORT secret to "on" (npx wrangler@4 secret put MIGRATION_IMPORT)');
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (e) {
      if (i === 3 || /import is off/.test(e.message)) throw e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

// Batches of ≤200 keys / ~4 MB. A private set's chunks
// (private-sets:<player>:<set>::part:<n>) always travel together, so the
// server can tell whether it already has that set.
const groupOf = (k) => { const m = /^(private-sets:.*::)part:\d+$/.exec(k); return m ? m[1] : k; };
const groups = new Map();
for (const e of entries) { const g = groupOf(e[0]); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }

let batch = [], size = 0, sent = 0;
const totals = { written: 0, merged: 0, skipped: 0 };
const flush = async () => {
  if (!batch.length) return;
  const r = await post('/admin/import', { restore: true, entries: batch });
  for (const k of Object.keys(totals)) totals[k] += r[k] || 0;
  sent += batch.length;
  process.stdout.write(`\r  ${sent}/${entries.length} keys (${totals.written} new, ${totals.merged} merged, ${totals.skipped} kept as is)`);
  batch = []; size = 0;
};
try {
  for (const list of groups.values()) {
    const s = list.reduce((n, e) => n + JSON.stringify(e).length, 0);
    if (batch.length && (batch.length + list.length > 200 || size + s > 4_000_000)) await flush();
    batch.push(...list); size += s;
  }
  await flush();
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
let gardensOk = 0;
for (const [playerName, gardenData] of gardens) {
  try { await post('/save-garden', { playerName, gardenData }); gardensOk += 1; } catch { /* counted below */ }
}
console.log(`\nDone: ${totals.written} new, ${totals.merged} merged, ${totals.skipped} kept as is; ${gardensOk}/${gardens.length} gardens merged.`);
console.log('Now turn the import off:  npx wrangler@4 secret delete MIGRATION_IMPORT');
