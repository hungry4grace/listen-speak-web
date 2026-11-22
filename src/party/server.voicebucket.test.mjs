// Run: node --test src/party/server.voicebucket.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setDocIdForVoiceBucket } from './server.js';

test('a language-tagged recording bucket belongs to its set', () => {
  assert.equal(setDocIdForVoiceBucket('custom-1788953468539@yue'), 'custom-1788953468539');
  assert.equal(setDocIdForVoiceBucket('custom-1788953468539'), 'custom-1788953468539');
  assert.equal(setDocIdForVoiceBucket('tang300-yuefu@yue'), 'tang300-yuefu');
});
