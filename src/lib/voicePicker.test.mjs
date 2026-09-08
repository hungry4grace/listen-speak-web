import assert from 'node:assert';
import { voiceId, voiceMatchesSavedKey, dedupeVoices, buildVoiceOptions } from './voicePicker.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

// Simulate the Android case: several voices share the display name
// "Chinese Hong Kong" but have distinct voiceURIs.
const v = (name, lang, voiceURI, localService = true) => ({ name, lang, voiceURI, localService });

const hk1 = v('Chinese Hong Kong', 'zh-HK', 'com.apple.voice.hk.sinji');
const hk2 = v('Chinese Hong Kong', 'zh-HK', 'com.google.android.tts:hk-2');
const cn  = v('Chinese China', 'zh-CN', 'com.apple.voice.cn.tingting');
const dupCn = v('Chinese China', 'zh-CN', 'com.apple.voice.cn.tingting'); // exact dup

console.log('voice identity & dedupe:');

test('voiceId uses voiceURI when present', () => {
  assert.strictEqual(voiceId(hk1), 'uri:com.apple.voice.hk.sinji');
});

test('voiceId falls back to name__lang without voiceURI', () => {
  assert.strictEqual(voiceId({ name: 'X', lang: 'zh-TW' }), 'nl:X__zh-TW');
});

test('dedupe collapses exact duplicates, keeps distinct same-named voices', () => {
  const out = dedupeVoices([hk1, hk2, cn, dupCn]);
  assert.strictEqual(out.length, 3, 'hk1, hk2, cn — dupCn removed');
  assert.ok(out.includes(hk1) && out.includes(hk2) && out.includes(cn));
});

console.log('\nmatching saved selection:');

test('matches by new voiceId', () => {
  assert.strictEqual(voiceMatchesSavedKey(hk2, 'uri:com.google.android.tts:hk-2'), true);
  assert.strictEqual(voiceMatchesSavedKey(hk1, 'uri:com.google.android.tts:hk-2'), false);
});

test('SELECTING the 2nd same-named voice resolves to a DIFFERENT voice (core bug)', () => {
  const voices = [hk1, hk2];
  const pickedKey = voiceId(hk2);
  const found = voices.find(x => voiceMatchesSavedKey(x, pickedKey));
  assert.strictEqual(found, hk2, 'must resolve to hk2, not hk1');
});

test('legacy name__lang saved key still matches', () => {
  assert.strictEqual(voiceMatchesSavedKey(cn, 'Chinese China__zh-CN'), true);
});

console.log('\ndisplay options:');

test('no duplicate labels; same-named voices disambiguated', () => {
  const opts = buildVoiceOptions([hk1, hk2, cn], { cloudLabel: '☁️' });
  assert.strictEqual(opts.length, 3);
  const labels = opts.map(o => o.label);
  // The two HK voices must have DIFFERENT labels now.
  const hkLabels = labels.filter(l => l.startsWith('Chinese Hong Kong'));
  assert.strictEqual(new Set(hkLabels).size, 2, 'two HK voices get distinct labels');
  // Unique single-named voice keeps its plain name.
  assert.ok(labels.includes('Chinese China'));
  // ids are unique
  assert.strictEqual(new Set(opts.map(o => o.id)).size, 3);
});

test('cloud voices get the cloud label', () => {
  const cloud = v('Chinese Taiwan', 'zh-TW', 'cloud.tw', false);
  const opts = buildVoiceOptions([cloud], { cloudLabel: '☁️' });
  assert.ok(opts[0].label.includes('☁️'));
});

console.log(`\n${passed} assertions passed.`);
