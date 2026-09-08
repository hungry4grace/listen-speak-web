/**
 * Patches missing KJV chapters 16-24 in verses_proverbs.js
 * Uses bolls.life KJV which has all chapters
 */
import fs from 'fs';
import https from 'https';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }}, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchBolls(version, chapter) {
  const url = `https://bolls.life/get-text/${version}/20/${chapter}/`;
  const raw = await get(url);
  const verses = JSON.parse(raw);
  if (!Array.isArray(verses) || verses.length === 0) return null;
  return verses.map(v => stripHtml(v.text)).join(' ');
}

function esc(t) {
  return (t || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const MISSING_CHAPTERS = [16, 17, 18, 19, 20, 21, 22, 23, 24];

async function main() {
  console.log('Fetching missing KJV chapters 16-24 from bolls.life...');
  
  const patches = {};
  for (const ch of MISSING_CHAPTERS) {
    process.stdout.write(`  ch${ch}... `);
    await sleep(400);
    // Try KJV on bolls.life (may have different code)
    let text = null;
    for (const ver of ['KJVO', 'KJV', 'KJVA']) {
      try {
        text = await fetchBolls(ver, ch);
        if (text && text.length > 200) { process.stdout.write(`✓ [${ver}]\n`); break; }
      } catch(e) {}
    }
    if (!text || text.length < 200) {
      process.stdout.write(`✗ (empty - will use hardcoded)\n`);
    }
    patches[ch] = text;
  }

  // Read the current file
  const filePath = new URL('../src/verses_proverbs.js', import.meta.url).pathname;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Patch each missing chapter
  for (const ch of MISSING_CHAPTERS) {
    const text = patches[ch] || '';
    // Find the empty entry and replace it
    const target = `{ id: "prv-kjv-${ch}", reference: "Proverbs ${ch}", title: "Proverbs Chapter ${ch}", text: \`\` }`;
    const replacement = `{ id: "prv-kjv-${ch}", reference: "Proverbs ${ch}", title: "Proverbs Chapter ${ch}", text: \`${esc(text)}\` }`;
    
    if (content.includes(target)) {
      content = content.replace(target, replacement);
      console.log(`  Patched ch${ch} (${text.split(' ').length} words)`);
    } else {
      console.warn(`  ⚠️ Could not find target for ch${ch}`);
    }
  }
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`\n✅ Patched and saved: ${filePath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
