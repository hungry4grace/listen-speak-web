// Phrase splitting per script. These rules are judgement calls about how text
// reads, so they need tests — a silent regression here turns a verse into one
// unreadable block (Japanese) or a screen of one-word confetti (Korean), and
// both shipped at some point.
//
// Run: node --test src/lib/phraseSplitter.test.mjs

import assert from 'node:assert';
import { test } from 'node:test';
import { splitVersePhrases, splitKoreanClauses, cleanPhraseBlock, isKoreanText, isHebrewText } from './phraseSplitter.js';

// ── Japanese ──────────────────────────────────────────────────────────────

test('Japanese splits on 、 — the bug that collapsed 箴言 1 into one block', () => {
  const text = 'これは人に知恵と教訓とを知らせ、悟りの言葉をさとらせ、賢い行いと、正義と公正と公平の教訓をうけさせ、思慮のない者に悟りを与え、若い者に知識と慎みを得させるためである';
  const phrases = splitVersePhrases(text);
  assert.ok(phrases.length >= 6, `expected >= 6 phrases, got ${phrases.length}`);
  assert.strictEqual(phrases[0], 'これは人に知恵と教訓とを知らせ');
  assert.ok(!phrases.some((p) => p.includes('、')), 'no phrase should still contain 、');
});

test('Japanese also splits on 。and spaces', () => {
  assert.deepStrictEqual(
    splitVersePhrases('ダビデの子、イスラエルの王ソロモンの箴言。 これは人に知恵と'),
    ['ダビデの子', 'イスラエルの王ソロモンの箴言', 'これは人に知恵と']
  );
});

// ── Chinese ───────────────────────────────────────────────────────────────

test('Chinese routes through the semantic segmenter (merges short 、-lists to card length)', () => {
  // Traditional Chinese now delegates to contrib/semantic-scripture-segmenter/
  // instead of splitting on every 、/space. Short list items (仁義、公平、正直的)
  // merge into one readable card rather than one block each. Author-inserted
  // inter-Han spaces are stripped first, so blocks never carry a stray space.
  // The ~8-char card target can still make a length cut mid-run (…使 | 少年人…)
  // — an accepted tradeoff of small cards.
  const phrases = splitVersePhrases('使人處事領受智慧、仁義、公平、正直的訓誨 使愚人靈明 使少年人有知識和謀略');
  assert.deepStrictEqual(phrases, ['使人處事領受智慧', '仁義、公平、正直的', '訓誨使愚人靈明使', '少年人有知識和謀略']);
});

test('author-inserted spaces between Han are stripped before semantic segmentation', () => {
  // Spaces that used to hint the old splitter now block the segmenter, so they
  // are removed first — no block keeps an inter-Han space (John 8:31-32).
  const phrases = splitVersePhrases('耶穌對信他的 猶太人說：你們若常常遵守 我的道，就真是我的門徒；你們必曉得真理，真理必叫你們得以 自由。');
  assert.deepStrictEqual(phrases, ['耶穌對信他的猶太人說', '你們若常常遵守我的道', '就真是我的門徒', '你們必曉得真理', '真理必叫你們得以自由']);
  assert.ok(phrases.every((p) => !/[㐀-鿿] [㐀-鿿]/.test(p)));
});

test('semantic:false keeps Chinese on punctuation splitting (bilingual alignment)', () => {
  // The bilingual view pairs primary/secondary blocks by index, so Chinese must
  // split per clause to stay aligned with the secondary line — the segmenter's
  // clause-merging would otherwise drift them apart.
  const phrases = splitVersePhrases('使人處事領受智慧、仁義、公平、正直的訓誨 使愚人靈明 使少年人有知識和謀略', { semantic: false });
  assert.deepStrictEqual(phrases, ['使人處事領受智慧', '仁義', '公平', '正直的訓誨', '使愚人靈明', '使少年人有知識和謀略']);
});

test('Chinese ordinary punctuation is unchanged', () => {
  assert.deepStrictEqual(
    splitVersePhrases('耶和華是我的牧者，我必不致缺乏。他使我躺臥在青草地上，領我在可安歇的水邊。'),
    ['耶和華是我的牧者', '我必不致缺乏', '他使我躺臥在青草地上', '領我在可安歇的水邊']
  );
});

// ── Space-delimited scripts must never split on spaces ────────────────────

test('English splits on punctuation only, never on spaces', () => {
  assert.deepStrictEqual(
    splitVersePhrases('Trust in the LORD with all thine heart; and lean not unto thine own understanding.'),
    ['Trust in the LORD with all thine heart', 'and lean not unto thine own understanding']
  );
});

test("English apostrophes and quotes survive — LORD's must not become LORD + s", () => {
  const phrases = splitVersePhrases("The LORD's mercy endureth for ever, and he said \"come\"");
  assert.ok(phrases.some((p) => p.includes("LORD's")), `apostrophe was split: ${JSON.stringify(phrases)}`);
  assert.ok(phrases.some((p) => p.includes('come')), 'quoted word should survive');
});

test('Spanish is not over-split', () => {
  assert.strictEqual(splitVersePhrases('Fíate de Jehová de todo tu corazón, y no te apoyes en tu propia prudencia.').length, 2);
});

// ── Korean ────────────────────────────────────────────────────────────────

test('Korean is detected by script, not by the version argument', () => {
  assert.ok(isKoreanText('여호와를 경외하는 것이'));
  assert.ok(!isKoreanText('これは人に'));
  assert.ok(!isKoreanText('耶和華是我的牧者'));
  assert.ok(!isKoreanText('Trust in the LORD'));
});

test('Korean splits at verb endings, not at every space', () => {
  const text = '다윗의 아들 이스라엘 왕 솔로몬의 잠언이라 이는 지혜와 훈계를 알게 하며 명철의 말씀을 깨닫게 하며';
  const phrases = splitVersePhrases(text);
  assert.deepStrictEqual(phrases, [
    '다윗의 아들 이스라엘 왕 솔로몬의 잠언이라',
    '이는 지혜와 훈계를 알게 하며',
    '명철의 말씀을 깨닫게 하며',
  ]);
});

test('Korean: every phrase keeps several words (never one-word confetti)', () => {
  const text = '여호와를 경외하는 것이 지식의 근본이어늘 미련한 자는 지혜와 훈계를 멸시하느니라';
  const phrases = splitVersePhrases(text);
  assert.deepStrictEqual(phrases, [
    '여호와를 경외하는 것이 지식의 근본이어늘',
    '미련한 자는 지혜와 훈계를 멸시하느니라',
  ]);
  for (const p of phrases) {
    assert.ok(p.split(' ').length > 1, `single-word block leaked through: ${p}`);
  }
});

test('Korean: a clause-free run still gets broken by the length valve', () => {
  const runOn = Array.from({ length: 40 }, (_, i) => `단어${i}`).join(' ');
  const phrases = splitKoreanClauses(runOn);
  assert.ok(phrases.length > 1, 'must not return one giant block');
  for (const p of phrases) assert.ok(p.length <= 40, `phrase too long: ${p.length}`);
});

test('Korean: short fragments are absorbed rather than emitted alone', () => {
  // The commas here are 4-char fragments; minChars should merge them.
  const phrases = splitKoreanClauses('지혜롭게, 의롭게, 공평하게, 정직하게 행할 일에 대하여 훈계를 받게 하며');
  for (const p of phrases) assert.ok(p.length >= 6, `fragment leaked: "${p}" (${p.length})`);
  assert.ok(!phrases.some((p) => /[,，]$/.test(p)), 'trailing comma should be trimmed');
});

// ── Hebrew ────────────────────────────────────────────────────────────────

test('Hebrew splits at the Masoretic caesura carried as a double space', () => {
  // Deuteronomy 6:4, the Shema. Tradition divides exactly here.
  assert.deepStrictEqual(
    splitVersePhrases('שמע ישראל  יהוה אלהינו יהוה אחד'),
    ['שמע ישראל', 'יהוה אלהינו יהוה אחד']
  );
  // Psalm 23:1
  assert.deepStrictEqual(
    splitVersePhrases('מזמור לדוד  יהוה רעי לא אחסר'),
    ['מזמור לדוד', 'יהוה רעי לא אחסר']
  );
});

test('Hebrew: a gap-free verse is no longer one giant block', () => {
  const runOn = 'סור מרע ועשה טוב ושכן לעולם כי יהוה אהב משפט ולא יעזב את חסידיו לעולם נשמרו וזרע רשעים נכרת';
  const phrases = splitVersePhrases(runOn);
  assert.ok(phrases.length > 1, 'must break up a long gap-free verse');
  for (const p of phrases) assert.ok(p.length <= 42, `phrase too long: ${p.length}`);
});

test('Hebrew never breaks a maqqef-joined unit apart', () => {
  // ועשה־טוב and יירשו־ארץ are single accentual units.
  const phrases = splitVersePhrases('סור מרע ועשה־טוב ושכן לעולם צדיקים יירשו־ארץ וישכנו לעד עליה תמיד');
  for (const p of phrases) {
    assert.ok(!p.endsWith('־'), `phrase ends on a dangling maqqef: ${p}`);
    assert.ok(!p.startsWith('־'), `phrase starts on a dangling maqqef: ${p}`);
  }
  assert.ok(phrases.some((p) => p.includes('ועשה־טוב')), 'maqqef unit must stay whole');
});

test('Hebrew also honours -- and sof pasuq as boundaries', () => {
  assert.deepStrictEqual(splitVersePhrases('אשרי האיש--  אשר לא הלך בעצת רשעים'), ['אשרי האיש', 'אשר לא הלך בעצת רשעים']);
  assert.deepStrictEqual(splitVersePhrases('בראשית ברא אלהים׃ את השמים'), ['בראשית ברא אלהים', 'את השמים']);
});

test('Hebrew: the ؛ chapter-join separator is a boundary, not text', () => {
  // fetchVerseFromBolls joins a whole chapter's verses with '؛ '.
  const joined = 'בני אם-תקח אמרי  ומצותי תצפן אתך؛ להקשיב לחכמה אזנך';
  const phrases = splitVersePhrases(joined);
  assert.deepStrictEqual(phrases, ['בני אם-תקח אמרי', 'ומצותי תצפן אתך', 'להקשיב לחכמה אזנך']);
  assert.ok(!phrases.some((p) => p.includes('؛')), 'separator must never appear inside a phrase');
});

test('Hebrew is detected by script and does not disturb other languages', () => {
  assert.ok(isHebrewText('יהוה רעי'));
  assert.ok(!isHebrewText('Trust in the LORD'));
  assert.ok(!isHebrewText('여호와를 경외하는'));
  assert.ok(!isHebrewText('耶和華是我的牧者'));
});

// ── Shared helpers / edges ────────────────────────────────────────────────

test('edge quotes and brackets are trimmed, not turned into empty blocks', () => {
  assert.strictEqual(cleanPhraseBlock('「你們要靠著主」'), '你們要靠著主');
  assert.strictEqual(cleanPhraseBlock('  (hello)  '), 'hello');
});

test('empty and punctuation-only input yields no phrases', () => {
  for (const v of ['', '   ', null, undefined, '。。。', '---']) {
    assert.deepStrictEqual(splitVersePhrases(v), [], `expected [] for ${JSON.stringify(v)}`);
  }
});
