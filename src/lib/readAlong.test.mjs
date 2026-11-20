import test from 'node:test';
import assert from 'node:assert/strict';
import { charSlots, createPace, createTtsFollower, indexAtFraction, indexAtWeight, readSlots, spokenWeightMapper, unitModeOf, unitSegments, voicedFraction, wordSlots, wordSpans, wordWeight } from './readAlong.js';
import { toSpeechText } from './speechText.js';

test('charSlots: one slot per code point, CJK highlightable, punctuation carries pause weight', () => {
  const m = charSlots('我愛你，Amy！');
  assert.equal(m.slots.length, 8);
  assert.deepEqual(m.slots.map((s) => s.hl), [true, true, true, false, false, false, false, false]);
  assert.deepEqual(m.slots.map((s) => s.ci), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(m.slots[3].w > 0 && m.slots[7].w > m.slots[3].w, 'full stop pauses longer than a comma');
  assert.equal(charSlots('我愛你，', { pauseWeights: false }).total, 3);
});

test('charSlots: astral characters keep code-point index and UTF-16 offset apart', () => {
  const m = charSlots('𠮷野家'); // 𠮷 is two UTF-16 units
  assert.deepEqual(m.slots.map((s) => s.u16), [0, 2, 3]);
  assert.deepEqual(m.slots.map((s) => s.ci), [0, 1, 2]);
});

test('indexAtFraction: monotonic, starts on the first character, ends on the last', () => {
  const m = charSlots('天空是白雲的家，大地是花草的家。');
  let prev = -1;
  for (let f = 0; f <= 1.0001; f += 0.01) {
    const ci = indexAtFraction(m, f);
    assert.ok(ci >= prev, `went backwards at ${f}`);
    prev = ci;
  }
  assert.equal(indexAtFraction(m, 0), 0);
  assert.equal(indexAtFraction(m, 1), 14); // 家 before the final 。
  assert.equal(indexAtFraction(m, -3), 0);
  assert.equal(indexAtFraction(m, NaN), 0);
});

test('during punctuation or Latin text the pointer stays on the last character read', () => {
  const m = charSlots('好，OK好');
  const comma = m.slots[1];
  assert.equal(indexAtWeight(m, comma.acc + 0.1), 0);
  assert.equal(indexAtWeight(m, m.slots[2].acc + 0.1), 0); // inside "OK"
  assert.equal(indexAtWeight(m, m.slots[4].acc), 4);
  assert.equal(indexAtFraction(charSlots('Hello!'), 0.5), -1, 'nothing to highlight');
});

test('voicedFraction: linear without pauses, waits through measured pauses', () => {
  assert.equal(voicedFraction(1, 0, 2), 0.5);
  assert.equal(voicedFraction(-1, 0, 2), 0);
  assert.equal(voicedFraction(9, 0, 2), 1);
  // 4 s unit with a 2 s pause in the middle: voiced time is 2 s.
  const p = [[1, 3]];
  assert.equal(voicedFraction(1, 0, 4, p), 0.5);
  assert.equal(voicedFraction(2, 0, 4, p), 0.5, 'holds during the pause');
  assert.equal(voicedFraction(3.5, 0, 4, p), 0.75);
  assert.equal(voicedFraction(4, 0, 4, p), 1);
  // Pauses outside the unit are ignored; a unit that is all pause falls back to linear.
  assert.equal(voicedFraction(1, 0, 2, [[5, 6]]), 0.5);
  assert.equal(voicedFraction(1, 0, 2, [[0, 2]]), 0.5);
});

test('TTS follower: advances at the pace; boundaries that agree with it correct it', () => {
  const m = charSlots('我每天早上起床');
  const f = createTtsFollower(m, { msPerUnit: 100, lookahead: 2 });
  assert.equal(f.indexAt(0), 0, 'before start: first character');
  f.start(1000);
  assert.equal(f.indexAt(1000), 0);
  assert.equal(f.indexAt(1250), 2);
  assert.equal(f.indexAt(99999), 6, 'no boundaries: runs to the end');
  // The voice is a little slower than estimated: character 3 only at 360 ms.
  f.boundary(1360, 3);
  assert.equal(f.indexAt(1360), 3);
  assert.equal(f.indexAt(1470), 4);
  assert.equal(f.indexAt(99999), 5, 'anchored: at most lookahead past the boundary');
  f.boundary(1650, 5);
  assert.equal(f.indexAt(1650), 5);
  f.boundary(1700, 2); // a stale earlier boundary is ignored
  assert.equal(f.indexAt(1700), 5);
  assert.equal(f.stats.used, 2);
});

test('TTS follower: boundaries fired all at once at the start are ignored', () => {
  const m = charSlots('那裡的樹長得又高又大');
  const f = createTtsFollower(m, { msPerUnit: 250 });
  f.start(0);
  for (const u16 of [0, 2, 3, 4, 5, 6, 7, 8, 9]) f.boundary(90, u16); // Chromium burst
  assert.equal(f.indexAt(90), 0, 'still on the first character');
  assert.equal(f.indexAt(1000), 4, 'the pace estimate from the start');
  assert.equal(f.indexAt(99999), 9, 'no cap: runs to the end');
  f.boundary(1300, 9); // after a burst this utterance's boundaries stay ignored
  assert.equal(f.indexAt(1340), 5);
  assert.equal(f.stats.distrusted, true);
});

test('TTS follower: boundaries that run ahead of the voice (iOS) never pull the pointer to the end', () => {
  const m = charSlots('那裡的樹長得又高又大'); // 10 characters, about 2.5 s at 250 ms each
  const f = createTtsFollower(m, { msPerUnit: 250 });
  f.start(0);
  // The engine reports each word as it is synthesised: twice as fast as heard.
  [[2, 250], [4, 500], [5, 625], [7, 875], [9, 1125]].forEach(([u16, t]) => f.boundary(t, u16));
  assert.ok(f.stats.used <= 1, 'at most the very first one could pass for real');
  assert.equal(f.stats.distrusted, true, 'and then the stream is dropped');
  assert.equal(f.indexAt(1125), 4, 'still where the estimate says, not at the last character');
  assert.equal(f.indexAt(2300), 9);
});

test('TTS follower: a single stray boundary is skipped without giving up on the rest', () => {
  const m = charSlots('那裡的樹長得又高又大');
  const f = createTtsFollower(m, { msPerUnit: 250 });
  f.start(0);
  f.boundary(300, 8);   // nonsense
  assert.equal(f.indexAt(300), 1);
  f.boundary(1100, 4);  // believable
  assert.equal(f.stats.used, 1);
  assert.equal(f.indexAt(1100), 4);
});

test('pace: the per-utterance overhead is not counted as speaking time', () => {
  const p = createPace({ unitMs: 225, overheadMs: 450 });
  assert.equal(p.msPerUnit(1), 225);
  assert.equal(Math.round(p.msPerUnit(0.9)), 250);
  // A voice that really takes 260 ms a character plus 450 ms of overhead.
  // Dividing 2270 ms by 7 would say 324 ms; the model heads for 260.
  for (let i = 0; i < 12; i++) p.observe({ units: 7, ms: 450 + 7 * 260, rate: 1 });
  assert.ok(Math.abs(p.value - 260) < 3, `value ${p.value}`);
  const before = p.value;
  p.observe({ units: 1, ms: 50, rate: 1 }); // too short to trust
  assert.equal(p.value, before);
});

test('pace: one phrase only nudges the estimate', () => {
  const p = createPace({ unitMs: 225, overheadMs: 450 });
  p.observe({ units: 6, ms: 450 + 6 * 300, rate: 1 }); // this phrase was slow
  assert.ok(p.value > 225 && p.value < 255, `value ${p.value}`);
});

test('pace: fits overhead and speed once phrases of different lengths were heard', () => {
  const p = createPace({ unitMs: 225, overheadMs: 450 });
  // Truth: 200 ms a unit at rate 1, 600 ms overhead; spoken at rate 0.86.
  for (let k = 0; k < 3; k++) for (const units of [5, 7, 10, 9, 5, 12, 6]) p.observe({ units, ms: 600 + (200 * units) / 0.86, rate: 0.86 });
  assert.ok(Math.abs(p.value - 200) < 5, `value ${p.value}`);
  assert.ok(Math.abs(p.overhead - 600) < 20, `overhead ${p.overhead}`);
});

test('pace: nonsense durations are clamped, and the fit is remembered through the store', () => {
  const p = createPace();
  for (let i = 0; i < 20; i++) p.observe({ units: 10, ms: 99999, rate: 1 });
  assert.ok(p.value <= 420);
  let saved = null;
  const store = { get: () => saved, set: (v) => { saved = v; } };
  const first = createPace({ store });
  for (let i = 0; i < 4; i++) first.observe({ units: 8, ms: 450 + 8 * 180, rate: 1 });
  assert.ok(saved && saved.b > 180 && saved.b < 200, JSON.stringify(saved));
  assert.equal(createPace({ store }).value, saved.b, 'a new session starts from the saved pace');
  assert.equal(createPace({ store: { get: () => ({ b: 5, a: -1 }) } }).value, 225, 'garbage in the store is ignored');
});

test('TTS follower: leadMs runs the pointer ahead of the estimate', () => {
  const m = charSlots('我每天早上起床');
  const plain = createTtsFollower(m, { msPerUnit: 200 });
  const led = createTtsFollower(m, { msPerUnit: 200, leadMs: 150 });
  plain.start(0); led.start(0);
  assert.equal(plain.indexAt(100), 0);
  assert.equal(led.indexAt(100), 1);
  assert.equal(led.indexAt(99999), 6);
});

test('Chinese speech fix-ups keep the string length, so boundary offsets map 1:1 onto the verse', () => {
  const verses = [
    '起初，神創造天地。', '地是空虛混沌，淵面黑暗；神的靈運行在水面上。', '耶和華是我的牧者，我必不致缺乏。',
    '神差遣長老去撒種，應許必要應驗。', '亞伯拉罕生以撒；以撒生雅各。', '你們可以撒網，便雅憫的長子重生了。',
    '温柔的人有福了！因为他们必承受地土。', '耶和华应许亚伯拉罕，差遣长老去撒种。', '撒但、撒母耳、拿撒勒、撒拉、阿們。',
    '我與你同行，降服於神，祂供給寶藏。', '處女懷孕生子。', '愛是恆久忍耐，又有恩慈；愛是不嫉妒。',
  ];
  for (const text of verses) {
    for (const lang of ['zh-TW', 'zh-CN', 'zh-HK']) assert.equal(toSpeechText(text, lang).length, text.length, text);
  }
});

// ── Words: English and Hebrew ──────────────────────────────────────────────

test('unitModeOf: characters for Chinese, words for scripts written with spaces', () => {
  assert.equal(unitModeOf('神愛世人'), 'char');
  assert.equal(unitModeOf('For God so loved the world'), 'word');
  assert.equal(unitModeOf('בְּרֵאשִׁית בָּרָא אֱלֹהִים'), 'word');
  assert.equal(readSlots('神愛世人').mode, 'char');
  assert.equal(readSlots('God is love').mode, 'word');
});

test('wordSpans: punctuation stays outside the word, apostrophes and hyphens inside', () => {
  const t = "“The LORD's well-being,” he said—amen!";
  assert.deepEqual(wordSpans(t).map((w) => w.text), ['The', "LORD's", 'well-being', 'he', 'said', 'amen']);
  for (const w of wordSpans(t)) assert.equal(t.slice(w.start, w.end), w.text);
});

test('wordSlots: one highlightable slot per word, longer words weigh more, clause ends pause', () => {
  const m = wordSlots('For God so loved the world, that he gave his only begotten Son.');
  const words = m.slots.filter((s) => s.hl);
  assert.equal(words.length, 13);
  assert.deepEqual(words.map((s) => s.ci), [...Array(13).keys()]);
  assert.equal(words[0].u16, 0);
  assert.equal(words[1].u16, 4);
  const w = (k) => words[k].w;
  assert.equal(w(1), 1, 'God');
  assert.equal(w(3), 1, 'loved is one syllable');
  assert.equal(w(10), 2, 'only');
  assert.equal(w(11), 3, 'begotten');
  const pauses = m.slots.filter((s) => !s.hl);
  assert.equal(pauses.length, 2, 'the comma and the full stop');
  assert.ok(pauses[1].w > pauses[0].w);
  assert.equal(wordSlots('the world, that', { pauseWeights: false }).slots.filter((s) => !s.hl).length, 0);
  // accumulated weights are consistent
  let acc = 0;
  for (const s of m.slots) { assert.equal(s.acc, acc); acc += s.w; }
  assert.equal(m.total, acc);
});

test('wordWeight: English syllables, Hebrew from its consonants (pointed or not)', () => {
  assert.equal(wordWeight('grace'), 1);
  assert.equal(wordWeight('Jesus'), 2);
  assert.equal(wordWeight('righteousness'), 3);
  assert.equal(wordWeight('the'), 1);
  assert.ok(wordWeight('בְּרֵאשִׁית') > wordWeight('אֵת'));
  assert.equal(wordWeight('בְּרֵאשִׁית'), wordWeight('בראשית'), 'points do not change the weight');
  assert.equal(wordWeight('אֵת'), 1.2);
  assert.equal(wordWeight('ב'), 1, 'never under one syllable');
});

test('Hebrew: points and cantillation stay inside the word; maqqef separates words', () => {
  const t = 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃';
  assert.equal(wordSpans(t).length, 7);
  const m = wordSlots(t);
  assert.equal(m.slots.filter((s) => s.hl).length, 7);
  assert.equal(m.slots[m.slots.length - 1].hl, false, 'sof pasuq is a pause, not a word');
  assert.deepEqual(wordSpans('עַל־כָּל־הָאָרֶץ').map((w) => w.text), ['עַל', 'כָּל', 'הָאָרֶץ']);
});

test('unitSegments: the screen pieces carry the same indices the timing model uses', () => {
  const en = 'In the beginning, God created.';
  const segs = unitSegments(en);
  assert.equal(segs.map((s) => s.text).join(''), en, 'nothing lost or reordered');
  assert.deepEqual(segs.filter((s) => s.ci !== null).map((s) => s.ci), wordSlots(en).slots.filter((s) => s.hl).map((s) => s.ci));
  assert.deepEqual(segs.filter((s) => s.ci !== null).map((s) => s.text), ['In', 'the', 'beginning', 'God', 'created']);
  const zh = '神愛世人，Amen！𠮷家'; // 𠮷 is outside the highlightable range, and two UTF-16 units
  const zsegs = unitSegments(zh);
  assert.equal(zsegs.map((s) => s.text).join(''), zh);
  assert.deepEqual(zsegs.filter((s) => s.ci !== null).map((s) => s.ci), charSlots(zh).slots.filter((s) => s.hl).map((s) => s.ci));
  assert.deepEqual(zsegs.find((s) => s.ci === null), { text: '，Amen！𠮷', ci: null }, 'text between units is one piece');
  assert.deepEqual(zsegs[zsegs.length - 1], { text: '家', ci: 11 }, 'index counts code points');
  const he = 'עַל־כָּל־הָאָרֶץ׃';
  assert.equal(unitSegments(he).map((s) => s.text).join(''), he);
  assert.equal(unitSegments(he).filter((s) => s.ci !== null).length, 3);
  assert.deepEqual(unitSegments(''), []);
});

test('indexAtFraction on words: starts on the first word, ends on the last, never goes back', () => {
  const m = readSlots('The LORD is my shepherd; I shall not want.');
  let prev = -1;
  for (let f = 0; f <= 1.0001; f += 0.01) { const ci = indexAtFraction(m, f); assert.ok(ci >= prev); prev = ci; }
  assert.equal(indexAtFraction(m, 0), 0);
  assert.equal(indexAtFraction(m, 1), 8);
});

test('Hebrew divine name: spoken as Adonai, the pointer still lands on the right word', () => {
  const shown = 'יְהוָה רֹעִי לֹא אֶחְסָר';
  const spoken = toSpeechText(shown, 'he-IL');
  assert.notEqual(spoken.length, shown.length, 'the spoken string is a different length');
  const m = readSlots(shown);
  const map = spokenWeightMapper(m, spoken);
  assert.ok(map);
  const units = m.slots.filter((s) => s.hl);
  const sw = wordSpans(spoken);
  assert.equal(sw.length, 4);
  sw.forEach((w, k) => assert.equal(map(w.start), units[k].acc, `word ${k}`));
  assert.equal(map(spoken.length + 5), m.total);
  // With the mapper the follower moves to the word the engine reported.
  const f = createTtsFollower(m, { msPerUnit: 200, toWeight: map });
  f.start(0);
  f.boundary(units[2].acc * 200, sw[2].start);
  assert.equal(f.indexAt(units[2].acc * 200), 2);
  assert.equal(f.stats.used, 1);
  // "Lord GOD": אֲדֹנָי יְהוִה is read Adonai Elohim — still two words.
  const two = 'אֲדֹנָי יְהוִה';
  assert.ok(spokenWeightMapper(readSlots(two), toSpeechText(two, 'he-IL')));
});

test('spokenWeightMapper: gives up when the spoken text has a different number of words', () => {
  const m = readSlots('God is love');
  assert.equal(spokenWeightMapper(m, 'God is'), null);
  assert.equal(spokenWeightMapper(readSlots('…'), '…'), null, 'nothing to point at');
  const same = spokenWeightMapper(m, 'God is love');
  assert.equal(same(0), 0);
  assert.equal(same(4), 1);
});

// ── Japanese, Korean and the other scripts ─────────────────────────────────

test('Japanese: kana and kanji are both pointed at; small kana and ー ride on the one before', () => {
  const t = '初めに、神は天地を創造された。';
  assert.equal(unitModeOf(t), 'char');
  const m = charSlots(t);
  const hl = m.slots.filter((s) => s.hl).map((s) => [...t][s.ci]).join('');
  assert.equal(hl, '初めに神は天地を創造された');
  const at = (ch) => m.slots[[...t].indexOf(ch)];
  assert.equal(at('め').w, 1);
  assert.equal(at('神').w, 1.7, 'a kanji stands for one to three morae');
  const small = charSlots('きょうはイエス・キリストのひ');
  const chars = [...'きょうはイエス・キリストのひ'];
  assert.equal(small.slots[chars.indexOf('ょ')].hl, false);
  assert.ok(small.slots[chars.indexOf('ょ')].w < 0.5);
  assert.equal(small.slots[chars.indexOf('ス')].hl, true);
  assert.equal(charSlots('ヨハネのふくいんしょ、ルカー').slots.slice(-1)[0].hl, false, 'ー is not pointed at');
  // A phrase in kana only is still read character by character.
  assert.equal(unitModeOf('はじめに'), 'char');
  assert.deepEqual(unitSegments('はじめに。').filter((s) => s.ci !== null).map((s) => s.text), ['は', 'じ', 'め', 'に']);
});

test('Japanese: screen pieces and timing slots agree; Chinese is untouched', () => {
  const t = '主は私の羊飼い。私は、乏しいことがありません。';
  const segs = unitSegments(t);
  assert.equal(segs.map((s) => s.text).join(''), t);
  assert.deepEqual(segs.filter((s) => s.ci !== null).map((s) => s.ci), charSlots(t).slots.filter((s) => s.hl).map((s) => s.ci));
  let prev = -1;
  const m = readSlots(t, { lang: 'ja-JP' });
  for (let f = 0; f <= 1.0001; f += 0.01) { const ci = indexAtFraction(m, f); assert.ok(ci >= prev); prev = ci; }
  // No kana → the Chinese weights (one per character) are unchanged.
  assert.equal(charSlots('神愛世人').total, 4);
});

test('Korean: a word per space, one syllable per Hangul block', () => {
  const t = '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니';
  assert.equal(unitModeOf(t), 'word');
  const m = wordSlots(t, { lang: 'ko-KR' });
  assert.deepEqual(m.slots.filter((s) => s.hl).map((s) => s.w), [4, 3, 3, 4, 4, 4]);
  assert.equal(wordWeight('하나님이', 'ko-KR'), 4);
  assert.deepEqual(unitSegments(t).filter((s) => s.ci !== null).map((s) => s.text), t.split(' '));
});

test('wordWeight by language: silent endings are English / French only; Vietnamese is one syllable a word', () => {
  assert.equal(wordWeight('padre', 'es-ES'), 2);
  assert.equal(wordWeight('grace', 'en-US'), 1);
  assert.equal(wordWeight('Liebe', 'de-DE'), 2);
  assert.equal(wordWeight('père', 'fr-FR'), 1);
  assert.equal(wordWeight('portes', 'fr-FR'), 1);
  assert.equal(wordWeight('salvación', 'es-ES'), 3);
  assert.equal(wordWeight('yang', 'id-ID'), 1);
  assert.equal(wordWeight('keselamatan', 'ms-MY'), 5);
  assert.equal(wordWeight('kızı', 'tr-TR'), 2, 'dotless ı is a vowel');
  assert.equal(wordWeight('Tanrı', 'tr-TR'), 2);
  assert.equal(wordWeight('người', 'vi-VN'), 1);
  assert.equal(wordWeight('thương', 'vi-VN'), 1);
  assert.equal(wordWeight('Đức', 'vi-VN'), 1);
  assert.equal(wordWeight('coração', 'pt-BR'), 3);
});

test('wordWeight: Russian vowels, Hindi aksharas, Arabic vowel signs, Persian letters', () => {
  assert.equal(wordWeight('Бог', 'ru-RU'), 1);
  assert.equal(wordWeight('возлюбил', 'ru-RU'), 3);
  assert.equal(wordWeight('в', 'ru-RU'), 1, 'never under one syllable');
  assert.equal(wordWeight('परमेश्वर', 'hi-IN'), 5);   // six letters, one joined by a virama (spoken: 4)
  assert.equal(wordWeight('क्या', 'hi-IN'), 1);
  assert.equal(wordWeight('اللهُ', 'ar-SA'), 1, 'one vowel sign');
  assert.equal(wordWeight('مَحَبَّةٌ', 'ar-SA'), 4, 'three vowels and the tanwin; shadda is not a vowel');
  assert.equal(wordWeight('خدا', 'fa-IR'), 1.5, 'unmarked: half a syllable a letter');
  assert.equal(wordWeight('و', 'fa-IR'), 1);
});

test('Arabic and Persian: vowel signs and the zero-width joiner stay inside the word', () => {
  const ar = 'لِأَنَّهُ هَكَذَا أَحَبَّ اللهُ الْعَالَمَ، حَتَّى بَذَلَ';
  assert.equal(wordSpans(ar).length, 7);
  const m = wordSlots(ar, { lang: 'ar-SA' });
  assert.equal(m.slots.filter((s) => !s.hl).length, 1, 'the Arabic comma is a pause');
  const fa = 'زیرا خدا جهان را این‌قدر محبت نمود؟';
  assert.deepEqual(wordSpans(fa).map((w) => w.text), ['زیرا', 'خدا', 'جهان', 'را', 'این‌قدر', 'محبت', 'نمود']);
  assert.equal(unitSegments(fa).map((s) => s.text).join(''), fa);
  assert.equal(wordSlots(fa, { lang: 'fa-IR' }).slots.slice(-1)[0].hl, false, '؟ ends with a pause');
});

test('Hindi: vowel signs stay inside the word and the danda is a pause', () => {
  const hi = 'क्योंकि परमेश्वर ने जगत से ऐसा प्रेम रखा।';
  assert.equal(wordSpans(hi).length, 8);
  assert.equal(unitSegments(hi).map((s) => s.text).join(''), hi);
  const m = wordSlots(hi, { lang: 'hi-IN' });
  assert.equal(m.slots.slice(-1)[0].hl, false);
  assert.equal(m.slots.filter((s) => s.hl).length, 8);
});
