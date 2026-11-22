// Run: node --test src/lib/tangTranslations.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLanguageSets } from '../verseLoader.js';
import { TANG_TRANSLATIONS } from '../content/tangTranslations.js';
import { translationCredit, localizeSet } from './content.js';

test('every added translation lands on its poem, couplet for couplet, with its translator', async () => {
  const { sets } = await loadLanguageSets();
  for (const [key, tr] of Object.entries(TANG_TRANSLATIONS)) {
    const [setId, ref] = key.split('|');
    const item = sets.find(s => s.id === setId)?.verses.find(v => v.reference === ref);
    assert.ok(item, `no such poem: ${key}`);
    assert.equal(item.textEn, tr.textEn);
    assert.equal(item.textEn.split('\n').length, item.text.split('\n').length, `couplets differ: ${key}`);
    assert.ok(item.translation.translator && item.translation.year && item.translation.license, key);
  }
});

test('王維《送別》 reads in English and credits Betty Tseng', async () => {
  const { sets } = await loadLanguageSets();
  const set = localizeSet(sets.find(s => s.id === 'tang300-wuyan-gushi'), 'en');
  const poem = set.verses.find(v => v.reference === '送別 · 王維');
  assert.match(poem.text, /^I invited you to dismount/);
  assert.equal(translationCredit(poem), 'English: Betty Tseng 曾培慈 (2011) · CC BY-NC-SA 3.0');
  assert.match(poem.translation.url, /28utscprojects\.wordpress\.com/);
});

test('nearly every Tang poem now has English, and the old 1929 lines give way to the newer ones', async () => {
  const { sets } = await loadLanguageSets();
  const tang = sets.filter(s => s.id.startsWith('tang300-')).flatMap(s => s.verses);
  const withEn = tang.filter(v => v.textEn);
  assert.ok(withEn.length >= 360, `only ${withEn.length} of ${tang.length}`);
  // Every English line shown carries its translator.
  for (const v of withEn) assert.ok(translationCredit(v), v.reference);
  const jingYeSi = tang.find(v => v.reference === '靜夜思 · 李白');
  assert.equal(jingYeSi.translation.translator, 'Betty Tseng 曾培慈');
  assert.doesNotMatch(jingYeSi.textEn, /So bright a gleam/); // Bynner 1929
  // No translation for a poem she did not translate: no English, no credit.
  const jinling = tang.find(v => v.reference === '金陵圖 · 韋莊');
  assert.equal(jinling.textEn, '');
  assert.equal(translationCredit(jinling), '');
});
