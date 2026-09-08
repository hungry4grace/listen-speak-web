#!/usr/bin/env node
// Build 台語 (-tw) variants of every published 主題 topic set on PartyKit.
//
// The 主題：… carousel sets (醫治, 讚美, 憐憫, …) live as PUBLISHED sets on
// the PartyKit backend, one per language with an id suffix
// (dailyverses-healing-cuv-traditional, …-cuvs, …-kjv, …). This script
// mirrors each base CUV topic set into a `<id>-tw` variant with 台語漢字本
// text scraped via scripts/taibible.mjs, matching the minimal field shape
// the other language variants use.
//
// Usage:
//   node scripts/build-topic-sets-tw.mjs            dry run — report + write JSON preview
//   node scripts/build-topic-sets-tw.mjs --publish  POST each set to PartyKit
//
// Publishing authenticates with PARTYKIT_ADMIN_TOKEN from ../.env.local
// (x-admin-token header) plus the trusted admin email in the payload.

import fs from 'node:fs';
import path from 'node:path';
import { taiwaneseTextForReference, unknownGlyphs } from './taibible.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const HOST = 'https://verserain-party.hungry4grace.partykit.dev/parties/main/global-auth-db';
const PUBLISH = process.argv.includes('--publish');
const TOPIC_PREFIX = /^(主題|主题|Topic)\s*[：:]/;

function adminToken() {
  const env = fs.readFileSync(path.join(HERE, '..', '.env.local'), 'utf8');
  const m = env.match(/^PARTYKIT_ADMIN_TOKEN=(.+)$/m);
  if (!m) throw new Error('PARTYKIT_ADMIN_TOKEN not found in .env.local');
  return m[1].trim();
}

const all = await (await fetch(`${HOST}/custom-sets`)).json();
const baseSets = all.filter(s => s.language === 'cuv' && TOPIC_PREFIX.test(String(s.title || '').trim()));
const existingIds = new Set(all.map(s => s.id));
console.log(`Found ${baseSets.length} CUV topic sets (of ${all.length} published).`);

const out = [];
const misses = [];
for (const base of baseSets) {
  const twId = `${base.id}-tw`;
  const twVerses = [];
  for (const v of base.verses || []) {
    const text = await taiwaneseTextForReference(v.reference, misses);
    if (!text) continue;
    twVerses.push({
      id: `${v.id || `${twId}-${twVerses.length + 1}`}-tw`,
      reference: v.reference,
      title: `${String(base.title).trim()}（台語）`,
      text,
    });
  }
  if (!twVerses.length) { console.error(`  !! ${base.id}: no verses resolved, skipping`); continue; }
  out.push({
    id: twId,
    title: `${String(base.title).trim()}（台語）`,
    description: '台語漢字本（巴克禮譯本漢字版）。資料來源：lingshyang.com 台語漢字本聖經。',
    language: 'tw',
    isPublished: true,
    authorName: 'Verserain 官方',
    verses: twVerses,
  });
  console.log(`  ${existingIds.has(twId) ? '↻' : '+'} ${twId} — ${twVerses.length}/${(base.verses || []).length} verses`);
}

if (unknownGlyphs.size) {
  console.error(`\n❌ Unmapped image glyphs: ${[...unknownGlyphs].join(', ')} — add to GLYPH_MAP in taibible.mjs`);
  process.exit(1);
}
if (misses.length) {
  console.error(`\n⚠️  ${misses.length} incomplete reference(s):`);
  for (const m of misses) console.error('  ' + m);
}

const preview = path.join(HERE, '.topic-sets-tw.json');
fs.writeFileSync(preview, JSON.stringify(out, null, 2));
console.log(`\n${out.length} sets, ${out.reduce((a, s) => a + s.verses.length, 0)} verses → ${preview}`);

if (PUBLISH) {
  const token = adminToken();
  for (const set of out) {
    const res = await fetch(`${HOST}/custom-sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ ...set, adminEmail: 'hungry4grace@gmail.com', adminName: 'hungry@G' }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`  publish ${set.id}: ${res.status} ${JSON.stringify(data)}`);
    if (!res.ok) process.exit(1);
  }
  console.log('✅ All topic sets published.');
} else {
  console.log('Dry run — re-run with --publish to POST to PartyKit.');
}
