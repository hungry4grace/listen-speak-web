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
  // Untouched poems keep what they had; no credit without a translator.
  assert.equal(translationCredit(set.verses.find(v => v.reference !== '送別 · 王維')), '');
});
