// Recitation matching — the judge for 語音模式. False negatives here mean a
// player who recited correctly loses a heart, so every tolerance (homophones,
// accents, 多音字, t2s, digits) is pinned by a test, along with the Korean
// regression where the old normalizer made passing impossible.
//
// Run: node --test src/lib/recitationMatch.test.mjs

import assert from 'node:assert';
import { test } from 'node:test';
import { pinyin } from 'pinyin-pro';
import {
  PASS_THRESHOLD,
  matchKindForLang,
  prepareTarget,
  scoreRecitation,
  scoreBestCandidate,
  fuzzyKey,
  zhDigitsToWords,
  enDigitsToWords,
} from './recitationMatch.js';
import { getSpeechLangForVersion } from './speechLang.js';

const zh = (target, heard) => scoreRecitation(prepareTarget(target, 'zh-TW'), heard);
const en = (target, heard) => scoreRecitation(prepareTarget(target, 'en-US'), heard);

// ── zh: exact & homophones ────────────────────────────────────────────────

test('zh exact recitation scores 100 and consumes everything', () => {
  const heard = '耶和華是我的牧者';
  const r = zh('耶和華是我的牧者', heard);
  assert.strictEqual(r.score, 100);
  assert.ok(r.pass);
  assert.strictEqual(r.consumedRawLength, heard.length);
});

test('zh homophone transcription passes (一宿 → 一速, 哭泣 → 哭七)', () => {
  const r = zh('一宿雖然有哭泣', '一速雖然有哭七');
  assert.ok(r.pass, `score ${r.score}`);
  assert.ok(r.score >= 90);
});

test('zh retroflex/dental accent passes (是→四, 智慧→自會)', () => {
  const r = zh('這是智慧', '遮四自會');
  assert.ok(r.pass, `score ${r.score}`);
});

test('zh front/back nasal accent passes (方向 heard with an/ian finals)', () => {
  // fang xiang recited as fan xian — recognizer writes 反縣-type chars
  const r = zh('方向', '反縣');
  assert.ok(r.pass, `score ${r.score}`);
});

// ── zh: 多音字 (the polyphonic fix) ───────────────────────────────────────

test('zh 多音字: 行走 passes even when recognizer heard a hang-reading char', () => {
  // 航 is unambiguously hang; target 行 in 行走 reads xing contextually.
  // Old single-reading comparison: pinyin('行走')=[xing,zou] vs pinyin('航走')=[hang,zou] → 行 fails.
  const oldTargetPy = pinyin('行走', { toneType: 'none', type: 'array' });
  const oldHeardPy = pinyin('航走', { toneType: 'none', type: 'array' });
  assert.notStrictEqual(oldTargetPy[0], oldHeardPy[0], 'precondition: old approach mismatches');
  const r = zh('行走', '航走');
  assert.ok(r.pass, `score ${r.score}`);
});

test('zh 多音字: 快樂 passes when heard as a yue-reading char (樂→悅/月)', () => {
  const r = zh('快樂', '快月');
  assert.ok(r.pass, `score ${r.score}`);
});

// ── zh: traditional/simplified folding ───────────────────────────────────

test('zh t2s: traditional target vs simplified transcript = 100', () => {
  const r = zh('華人的快樂在後頭', '华人的快乐在后头');
  assert.strictEqual(r.score, 100);
});

test('zh t2s: simplified target (cuvs) vs traditional transcript = 100', () => {
  const r = scoreRecitation(prepareTarget('华人的快乐', 'zh-CN'), '華人的快樂');
  assert.strictEqual(r.score, 100);
});

// ── zh: digits ───────────────────────────────────────────────────────────

test('zhDigitsToWords expands numbers', () => {
  assert.strictEqual(zhDigitsToWords('40'), '四十');
  assert.strictEqual(zhDigitsToWords('7'), '七');
  assert.strictEqual(zhDigitsToWords('12'), '十二');
  assert.strictEqual(zhDigitsToWords('105'), '一百零五');
});

test('zh digits: target 四十晝夜 vs heard "40晝夜" passes', () => {
  const r = zh('四十晝夜', '40晝夜');
  assert.ok(r.pass, `score ${r.score}`);
});

test('zh digits reversed: target has digits, heard spelled out', () => {
  const r = zh('40晝夜', '四十晝夜');
  assert.ok(r.pass, `score ${r.score}`);
});

// ── zh: junk tolerance & consumption ─────────────────────────────────────

test('zh leading junk passes and consumes through the target', () => {
  const heard = '嗯 那個 耶和華是我的牧者';
  const r = zh('耶和華是我的牧者', heard);
  assert.ok(r.pass);
  assert.strictEqual(r.consumedRawLength, heard.length); // ends exactly at 者
});

test('zh trailing junk is NOT consumed (minimal-j traceback)', () => {
  const heard = '耶和華是我的牧者 然後呢';
  const r = zh('耶和華是我的牧者', heard);
  assert.ok(r.pass);
  assert.strictEqual(heard.slice(0, r.consumedRawLength), '耶和華是我的牧者');
});

test('zh half recitation fails at threshold', () => {
  const r = zh('耶和華是我的牧者我必不致缺乏', '耶和華是我的牧者');
  assert.ok(!r.pass, `score ${r.score} should be < ${PASS_THRESHOLD}`);
  assert.ok(r.score >= 40 && r.score <= 60);
});

test('zh entirely wrong sentence fails', () => {
  const r = zh('耶和華是我的牧者', '今天天氣很好謝謝大家');
  assert.ok(!r.pass, `score ${r.score}`);
});

// ── word kind (English) ──────────────────────────────────────────────────

test('en case and punctuation insensitive', () => {
  const r = en('For God so loved the world,', 'for god so loved the world');
  assert.strictEqual(r.score, 100);
});

test('en digits: "40 days" matches "forty days"', () => {
  assert.strictEqual(enDigitsToWords('40'), 'forty');
  const r = en('forty days and forty nights', '40 days and 40 nights');
  assert.strictEqual(r.score, 100);
});

test('en Levenshtein-1 tolerates savior/saviour', () => {
  const r = en('my savior lives', 'my saviour lives');
  assert.strictEqual(r.score, 100);
});

test('en half recitation fails', () => {
  const r = en('the lord is my shepherd i shall not want', 'the lord is my shepherd');
  assert.ok(!r.pass, `score ${r.score}`);
});

// ── char kind: Korean regression (old normalizer stripped hangul → unwinnable) ──

test('ko exact recitation scores 100 (was impossible before)', () => {
  const target = '태초에 하나님이 천지를 창조하시니라';
  const r = scoreRecitation(prepareTarget(target, 'ko-KR'), '태초에 하나님이 천지를 창조하시니라');
  assert.strictEqual(r.score, 100);
});

test('ko partial recitation scores proportionally', () => {
  const target = '태초에 하나님이 천지를 창조하시니라';
  const r = scoreRecitation(prepareTarget(target, 'ko-KR'), '태초에 하나님이');
  assert.ok(r.score > 30 && r.score < PASS_THRESHOLD, `score ${r.score}`);
});

test('he/ja scripts survive normalization; exact = 100', () => {
  const he = scoreRecitation(prepareTarget('בְּרֵאשִׁית בָּרָא אֱלֹהִים', 'he-IL'), 'בראשית ברא אלהים');
  assert.strictEqual(he.score, 100, 'niqqud stripped via \\p{M}, unpointed ASR matches');
  const ja = scoreRecitation(prepareTarget('はじめに神は天と地とを創造された', 'ja-JP'), 'はじめに神は天と地とを創造された');
  assert.strictEqual(ja.score, 100);
});

// ── candidates ───────────────────────────────────────────────────────────

test('scoreBestCandidate picks the passing alternative and reports its index', () => {
  const prepared = prepareTarget('耶和華是我的牧者', 'zh-TW');
  const r = scoreBestCandidate(prepared, ['今天天氣很好', '耶和華是我的牧者']);
  assert.ok(r.pass);
  assert.strictEqual(r.candidateIndex, 1);
});

test('scoreBestCandidate prefers earliest index on equal scores', () => {
  const prepared = prepareTarget('耶和華是我的牧者', 'zh-TW');
  const r = scoreBestCandidate(prepared, ['耶和華是我的牧者', '耶和華是我的牧者']);
  assert.strictEqual(r.candidateIndex, 0);
});

// ── infrastructure ───────────────────────────────────────────────────────

test('prepareTarget memoizes (same object reference)', () => {
  const a = prepareTarget('耶和華是我的牧者', 'zh-TW');
  const b = prepareTarget('耶和華是我的牧者', 'zh-TW');
  assert.strictEqual(a, b);
});

test('matchKindForLang classification', () => {
  assert.strictEqual(matchKindForLang('zh-TW'), 'zh');
  assert.strictEqual(matchKindForLang('zh-CN'), 'zh');
  assert.strictEqual(matchKindForLang('en-US'), 'word');
  assert.strictEqual(matchKindForLang('vi-VN'), 'word');
  assert.strictEqual(matchKindForLang('ko-KR'), 'char');
  assert.strictEqual(matchKindForLang('he-IL'), 'char');
});

test('fuzzyKey folds', () => {
  assert.strictEqual(fuzzyKey('zhang'), fuzzyKey('zan'));   // zh→z + ang→an
  assert.strictEqual(fuzzyKey('sheng'), fuzzyKey('sen'));   // sh→s + eng→en
  assert.strictEqual(fuzzyKey('lv'), fuzzyKey('nu'));       // l→n + v→u
  assert.notStrictEqual(fuzzyKey('zong'), fuzzyKey('zen')); // ong deliberately NOT merged
});

test('empty heard returns zero without crashing', () => {
  const r = zh('耶和華', '');
  assert.deepStrictEqual(r, { score: 0, pass: false, consumedRawLength: 0 });
});

// ── speechLang (pins the old BlindModeGame.jsx:77 bug) ───────────────────

test('getSpeechLangForVersion maps every version correctly', () => {
  assert.strictEqual(getSpeechLangForVersion('esv'), 'en-US'); // was zh-TW!
  assert.strictEqual(getSpeechLangForVersion('niv'), 'en-US'); // was zh-TW!
  assert.strictEqual(getSpeechLangForVersion('kjv'), 'en-US');
  assert.strictEqual(getSpeechLangForVersion('cuvs'), 'zh-CN'); // was zh-TW
  assert.strictEqual(getSpeechLangForVersion('ko'), 'ko-KR');
  assert.strictEqual(getSpeechLangForVersion('ja'), 'ja-JP');
  assert.strictEqual(getSpeechLangForVersion('he'), 'he-IL');
  assert.strictEqual(getSpeechLangForVersion('cuv'), 'zh-TW');
  assert.strictEqual(getSpeechLangForVersion('unknown-version'), 'zh-TW');
});
