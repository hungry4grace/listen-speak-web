/**
 * Fix remaining KJV annotation issues in bolls.life chapters 16-24
 * The bolls.life KJV adds marginal notes like "word: meaning" after verse text
 */
import fs from 'fs';

const filePath = new URL('../src/verses_proverbs.js', import.meta.url).pathname;
let content = fs.readFileSync(filePath, 'utf8');

// Only fix the KJV section, specifically chapters 16-24 which came from bolls.life
// bolls.life KJV marginal notes appear as patterns like "word: explanation" - they're
// usually short capitalized words followed by colon and typically 1-5 words
// Strategy: in the KJV section, remove patterns that look like "SomeWord: or, something" 
// or "SomeWord: Heb. something" or "SomeWord: lit. something"

const kjvStart = content.indexOf('export const VERSE_SETS_PROVERBS_KJV');
const kjvEnd = content.indexOf('export const VERSE_SETS_PROVERBS_KO');

if (kjvStart > -1 && kjvEnd > -1) {
  let kjvSection = content.slice(kjvStart, kjvEnd);
  
  // Remove marginal notes: patterns like "Word: or, blah" / "Word: Heb. blah" / "Word: lit. blah"
  // These follow the main text and look like:  " Word: or, phrase"
  kjvSection = kjvSection.replace(/\s+\w[\w\s]*:\s+(or,|or;|Heb\.|lit\.|i\.e\.|marg\.|etc\.)[^.;!?`\\]*/g, ' ');
  // Also remove bare  "word:" patterns that are clearly notes not part of sentence
  // Match: space + capitalized word + colon + text until obvious sentence boundary
  kjvSection = kjvSection.replace(/\s+([A-Z][a-z]+):\s+([a-z][^.!?`\\]{0,60})\s+(?=[A-Z])/g, ' ');
  
  // Clean up multiple spaces
  kjvSection = kjvSection.replace(/ {2,}/g, ' ');
  
  content = content.slice(0, kjvStart) + kjvSection + content.slice(kjvEnd);
  console.log('✓ Removed marginal notes from KJV section');
}

fs.writeFileSync(filePath, content, 'utf8');

// Verify ch16
import(filePath + '?v=' + Date.now()).then(m => {
  const kjv = m.VERSE_SETS_PROVERBS_KJV[0].verses;
  console.log('\nKJV ch16 (first 300 chars):');
  console.log(kjv[15].text.substring(0, 300));
  console.log('\nKJV ch17 (first 200 chars):');
  console.log(kjv[16].text.substring(0, 200));
}).catch(e => {
  // Dynamic import with cache busting doesn't always work, just read raw
  const raw = fs.readFileSync(filePath, 'utf8');
  const m16 = raw.match(/"prv-kjv-16"[^`]*`([^`]{0,400})/);
  if (m16) console.log('\nKJV ch16 raw:', m16[1].substring(0, 300));
});
