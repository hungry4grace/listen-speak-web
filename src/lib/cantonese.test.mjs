// Run: node --test src/lib/cantonese.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANG_OPTIONS, CANTONESE_VERSION, baseLang, annotationOf, uiLangFor, isCantoneseVersion, voiceBucketFor } from './lang.js';
import { getSpeechLangForVersion } from './speechLang.js';
import { isCantoneseLang, voiceFitsLang } from './voicePicker.js';
import { toSpeechText } from './speechText.js';

const v = (name, lang, voiceURI = name) => ({ name, lang, voiceURI });

test('繁體（粵語） is a picker option: 繁體 text, no marks, 繁體 UI, Cantonese speech', () => {
  assert.ok(LANG_OPTIONS.some(o => o.value === 'cuv-yue' && o.label === '繁體（粵語）'));
  assert.equal(CANTONESE_VERSION, 'cuv-yue');
  assert.equal(baseLang('cuv-yue'), 'cuv');
  assert.equal(annotationOf('cuv-yue'), null);
  assert.equal(uiLangFor('cuv-yue'), 'zh');
  assert.equal(getSpeechLangForVersion('cuv-yue'), 'zh-HK');
  assert.equal(getSpeechLangForVersion('cuv'), 'zh-TW');
  assert.ok(isCantoneseVersion('cuv-yue'));
  assert.ok(!isCantoneseVersion('cuv'));
});

test('Cantonese needs a Cantonese voice; Mandarin keeps the old prefix match', () => {
  for (const l of ['zh-HK', 'zh_HK', 'yue', 'yue-HK', 'zh-Hant-HK', 'zh-MO']) assert.equal(isCantoneseLang(l), true, l);
  for (const l of ['zh-TW', 'zh-CN', 'zh', 'zh-Hant', 'en-US']) assert.equal(isCantoneseLang(l), false, l);
  const sinji = v('Sinji', 'zh-HK'); const meijia = v('Meijia', 'zh-TW'); const tingting = v('Tingting', 'zh-CN');
  assert.equal(voiceFitsLang(sinji, 'zh-HK'), true);
  assert.equal(voiceFitsLang(v('Google 粵語', 'yue-HK'), 'zh-HK'), true);
  assert.equal(voiceFitsLang(meijia, 'zh-HK'), false);
  assert.equal(voiceFitsLang(tingting, 'zh-HK'), false);
  assert.equal(voiceFitsLang(meijia, 'zh-TW'), true);
  assert.equal(voiceFitsLang(sinji, 'zh-TW'), true);
});

test('Cantonese speech reads the text as written (the swaps are Mandarin homophones)', () => {
  const s = '耶和華說：遍地都要承受地土為業。';
  assert.notEqual(toSpeechText(s, 'zh-TW'), s);
  assert.equal(toSpeechText(s, 'zh-HK'), s);
});

test('Cantonese recordings live in their own bucket, Mandarin ones are untouched', () => {
  assert.equal(voiceBucketFor('tang300-yuefu', 'cuv-yue'), 'tang300-yuefu@yue');
  assert.equal(voiceBucketFor('tang300-yuefu@yue', 'cuv-yue'), 'tang300-yuefu@yue'); // idempotent
  assert.equal(voiceBucketFor('__personal_verses__', 'cuv-yue'), '__personal_verses__@yue');
  for (const ver of ['cuv', 'cuvs', 'cuv-bpmf', 'cuv-pinyin', 'cuvs-pinyin', 'en']) {
    assert.equal(voiceBucketFor('tang300-yuefu', ver), 'tang300-yuefu', ver);
  }
  assert.equal(voiceBucketFor(null, 'cuv-yue'), null);
  assert.equal(voiceBucketFor('', 'cuv-yue'), null);
});
