// Run: node --test src/lib/builtInBackgrounds.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { loadLanguageSets } from '../verseLoader.js';
import { getSetBackgroundUrl, getSetBackgroundVideoUrl, BUILT_IN_BACKGROUNDS } from '../setBackgrounds.js';

test('every built-in set has a 古風 painting that ships with the app', async () => {
  const { sets } = await loadLanguageSets();
  assert.ok(sets.length >= 8);
  for (const set of sets) {
    const url = getSetBackgroundUrl(set.background);
    assert.ok(url, `no background: ${set.id}`);
    assert.ok(fs.existsSync(new URL(`../../public${url}`, import.meta.url)), `missing file ${url}`);
    assert.equal(getSetBackgroundVideoUrl(set.background), null);
  }
});

test('built-in paintings stay out of the editor picker but still resolve', async () => {
  const { SET_BACKGROUND_THEMES } = await import('../setBackgrounds.js');
  for (const entry of BUILT_IN_BACKGROUNDS) {
    assert.ok(!SET_BACKGROUND_THEMES.some(t => t.id === entry.id));
    assert.equal(getSetBackgroundUrl(`preset:${entry.id}`), entry.url);
  }
  assert.equal(getSetBackgroundUrl('preset:waves'), '/backgrounds/waves-poster.jpg');
  assert.equal(getSetBackgroundUrl('preset:nope'), null);
  assert.equal(getSetBackgroundUrl(''), null);
});
