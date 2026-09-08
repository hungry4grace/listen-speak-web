/**
 * Post-process verses_proverbs.js to:
 * 1. Strip Strong's numbers from KJV (from bolls.life KJV version)
 * 2. Remove extraneous spaces from CUV Chinese text
 */
import fs from 'fs';

const filePath = new URL('../src/verses_proverbs.js', import.meta.url).pathname;
let content = fs.readFileSync(filePath, 'utf8');

// ── Strip Strong's numbers (digits after words in KJV) ──────────────────────
// Pattern: word followed by 4-5 digits that are Strong's concordance numbers
// Only apply to KJV section
const kjvStart = content.indexOf('export const VERSE_SETS_PROVERBS_KJV');
const kjvEnd = content.indexOf('export const VERSE_SETS_PROVERBS_KO');

if (kjvStart > -1 && kjvEnd > -1) {
  let kjvSection = content.slice(kjvStart, kjvEnd);
  // Remove Strong's numbers: word\d{3,6} -> word (but not at start of words)
  kjvSection = kjvSection.replace(/([a-zA-Z])\d{3,6}/g, '$1');
  // Clean up any double spaces
  kjvSection = kjvSection.replace(/ {2,}/g, ' ');
  content = content.slice(0, kjvStart) + kjvSection + content.slice(kjvEnd);
  console.log('✓ Stripped Strong\'s numbers from KJV section');
}

// ── Remove spaces between Chinese characters in ZH section ──────────────────
// CUV texts have spaces between every character: "以 色 列 王" -> "以色列王"
const zhStart = content.indexOf('export const VERSE_SETS_PROVERBS_ZH');
const zhEnd = content.indexOf('export const VERSE_SETS_PROVERBS_KJV');

if (zhStart > -1 && zhEnd > -1) {
  let zhSection = content.slice(zhStart, zhEnd);
  // Remove spaces between CJK characters, punctuation etc.
  // Match: CJK/punc char + space + CJK/punc char patterns
  // Do this repeatedly until stable
  let prev = '';
  let iterations = 0;
  while (prev !== zhSection && iterations < 20) {
    prev = zhSection;
    // Remove space between two characters that are CJK, punctuation, or within a word
    zhSection = zhSection.replace(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef（）：；，。！？「」『』、]) ([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef（）：；，。！？「」『』、])/g, '$1$2');
    // Also handle space after punctuation before CJK and vice versa
    zhSection = zhSection.replace(/([\u4e00-\u9fff]) ([\uff00-\uffef（）：；，。！？、])/g, '$1$2');
    zhSection = zhSection.replace(/([\uff00-\uffef（）：；，。！？、]) ([\u4e00-\u9fff])/g, '$1$2');
    iterations++;
  }
  content = content.slice(0, zhStart) + zhSection + content.slice(zhEnd);
  console.log(`✓ Removed spaces between Chinese characters (${iterations} passes)`);
}

fs.writeFileSync(filePath, content, 'utf8');
console.log(`✅ Post-processing complete: ${filePath}`);

// Verify
import(filePath).then(m => {
  const zh = m.VERSE_SETS_PROVERBS_ZH[0].verses;
  const kjv = m.VERSE_SETS_PROVERBS_KJV[0].verses;
  console.log('\n── Verification ──');
  console.log('ZH ch1 sample:', zh[0].text.substring(0, 80));
  console.log('KJV ch16 sample:', kjv[15].text.substring(0, 100));
  console.log('KJV ch1 sample:', kjv[0].text.substring(0, 100));
}).catch(e => console.error('Import error:', e.message));
