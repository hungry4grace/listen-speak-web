/**
 * Re-fetches KJV chapters 16-24 from bible-api.com (clean text, no footnotes)
 * with longer delays to avoid rate limiting
 */
import fs from 'fs';
import https from 'https';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function esc(t) {
  return (t || '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

async function main() {
  const chapters = {};
  const missing = [16, 17, 18, 19, 20, 21, 22, 23, 24];
  
  for (const ch of missing) {
    console.log(`Fetching KJV ch${ch}...`);
    await sleep(4000); // 4 second delay to avoid rate limit
    try {
      const raw = await get(`https://bible-api.com/proverbs%20${ch}?translation=kjv`);
      const data = JSON.parse(raw);
      if (data.verses && data.verses.length > 0) {
        const text = data.verses.map(v => v.text.replace(/\n/g, ' ').trim()).join(' ');
        chapters[ch] = text;
        console.log(`  ✓ ch${ch}: ${text.split(' ').length} words`);
      } else {
        console.log(`  ✗ ch${ch}: ${raw.substring(0, 60)}`);
      }
    } catch(e) {
      console.log(`  ✗ ch${ch}: ${e.message}`);
    }
  }
  
  let content = fs.readFileSync('src/verses_proverbs.js', 'utf8');
  
  for (const ch of missing) {
    const text = chapters[ch];
    if (!text) { console.log(`  Skipping ch${ch} (no text)`); continue; }
    
    // Replace text between backticks for this specific entry
    // Pattern: from the opening backtick of this entry to its closing backtick
    const marker = `{ id: "prv-kjv-${ch}", reference: "Proverbs ${ch}", title: "Proverbs Chapter ${ch}", text: \``;
    const startIdx = content.indexOf(marker);
    if (startIdx === -1) { console.log(`  Can't find marker for ch${ch}`); continue; }
    
    const textStart = startIdx + marker.length;
    // Find the closing backtick (not preceded by backslash)
    let textEnd = textStart;
    while (textEnd < content.length) {
      if (content[textEnd] === '`' && content[textEnd - 1] !== '\\') break;
      textEnd++;
    }
    
    content = content.slice(0, textStart) + esc(text) + content.slice(textEnd);
    console.log(`  Replaced ch${ch}`);
  }
  
  fs.writeFileSync('src/verses_proverbs.js', content);
  console.log('\n✅ Done!');
  
  // Verify
  const { VERSE_SETS_PROVERBS_KJV } = await import('./src/verses_proverbs.js?v=' + Date.now());
  const kjv = VERSE_SETS_PROVERBS_KJV[0].verses;
  console.log('\nKJV ch16:', kjv[15].text.substring(0, 150));
  console.log('KJV ch20:', kjv[19].text.substring(0, 150));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
