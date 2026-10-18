// 地 (dì / de) for the speech engine. Run: node --test src/lib/speechText.test.mjs
import assert from 'node:assert';
import { test } from 'node:test';
import { fixChineseHeteronymsForSpeech, fixChineseNamesForSpeech, fixHebrewDivineNameForSpeech, toSpeechText } from './speechText.js';

const bible = (s) => fixChineseHeteronymsForSpeech(s, { defaultReading: 'di' });
const prose = (s) => fixChineseHeteronymsForSpeech(s, { defaultReading: 'de' });

test('Bible: noun 地 becomes 第 so the engine says dì', () => {
  assert.strictEqual(bible('謙卑的人必承受地土為業'), '謙卑的人必承受第土為業');
  assert.strictEqual(bible('起初神創造天地'), '起初神創造天第');
  assert.strictEqual(bible('願你的旨意行在地上，如同行在天上'), '願你的旨意行在第上，如同行在天上');
  assert.strictEqual(bible('全地都要向耶和華歡呼'), '全第都要向耶和華歡呼');
  assert.strictEqual(bible('直到地極'), '直到第極');
  assert.strictEqual(bible('遍地，都'), '遍第，都');
  assert.strictEqual(bible('一切地極和海上遠處的人'), '一切第極和海上遠處的人'); // 地極 wins over 切地
});

test('Bible: adverbial 地 after reduplication or 然/切 stays 地 (engine says de)', () => {
  assert.strictEqual(bible('平平安安地去吧'), '平平安安地去吧');
  assert.strictEqual(bible('你們白白地得來，也要白白地捨去'), '你們白白地得來，也要白白地捨去');
  assert.strictEqual(bible('我要切切地尋求你'), '我要切切地尋求你');
  assert.strictEqual(bible('心也大大地驚惶'), '心也大大地驚惶');
  assert.strictEqual(bible('充充滿滿地有恩典'), '充充滿滿地有恩典'); // reduplication beats 滿地
  assert.strictEqual(bible('忽然地來到'), '忽然地來到');
});

test('textbook prose: default is adverbial, noun compounds still dì', () => {
  assert.strictEqual(prose('媽媽看著我，開心地笑了'), '媽媽看著我，開心地笑了');
  assert.strictEqual(prose('老師先拿出橡皮擦，溫柔地告訴我們'), '老師先拿出橡皮擦，溫柔地告訴我們');
  assert.strictEqual(prose('一頁、兩頁地看'), '一頁、兩頁地看');
  assert.strictEqual(prose('神奇妙地預備了所有的經費'), '神奇妙地預備了所有的經費');
  assert.strictEqual(prose('一群孩子笑嘻嘻地在玩耍'), '一群孩子笑嘻嘻地在玩耍');
  assert.strictEqual(prose('這樣熱切地關懷'), '這樣熱切地關懷');
  assert.strictEqual(prose('大地就披上彩色的衣裳'), '大第就披上彩色的衣裳');
  assert.strictEqual(prose('我一邊擦地板，一邊說'), '我一邊擦第板，一邊說');
  assert.strictEqual(prose('我們所居住的地球'), '我們所居住的第球');
  assert.strictEqual(prose('陸地只占百分之二十九'), '陸第只占百分之二十九');
  assert.strictEqual(prose('從世界各地的奉獻'), '從世界各第的奉獻');
  assert.strictEqual(prose('床前明月光，疑是地上霜'), '床前明月光，疑是第上霜');
  assert.strictEqual(prose('這個地點，馬路不夠寬'), '這個第點，馬路不夠寬');
});

test('mixed sentence and simplified text', () => {
  assert.strictEqual(bible('他們歡歡喜喜地回到地上'), '他們歡歡喜喜地回到第上');
  assert.strictEqual(bible('谦卑的人必承受地土为业'), '谦卑的人必承受第土为业');
});

test('toSpeechText only touches Chinese', () => {
  assert.strictEqual(toSpeechText('承受地土', 'zh-TW'), '承受第土');
  assert.strictEqual(toSpeechText('承受地土', 'zh-CN'), '承受第土');
  assert.strictEqual(toSpeechText('開心地笑了', 'zh-TW', { defaultReading: 'de' }), '開心地笑了');
  assert.strictEqual(toSpeechText('inherit the land', 'en-US'), 'inherit the land');
  assert.strictEqual(toSpeechText('', 'zh-TW'), '');
});

test('耶和華: 和 is spoken hé (合), never the conjunction hàn', () => {
  assert.strictEqual(fixChineseNamesForSpeech('耶和華向他顯現'), '耶合華向他顯現');
  assert.strictEqual(fixChineseNamesForSpeech('耶和华向他显现'), '耶合华向他显现');
  assert.strictEqual(fixChineseNamesForSpeech('你和我'), '你和我', 'other 和 untouched');
  assert.strictEqual(toSpeechText('全地都要向耶和華歡呼', 'zh-TW'), '全第都要向耶合華歡呼');
  assert.strictEqual(toSpeechText('耶和華', 'en-US'), '耶和華');
});

test('Hebrew: יהוה is read Adonai, never pronounced', () => {
  const he = fixHebrewDivineNameForSpeech;
  assert.strictEqual(he('ויאמר יהוה אל אברם'), 'ויאמר אֲדֹנָי אל אברם'); // unpointed (Gen 12:1)
  assert.strictEqual(he('וַיֹּאמֶר יְהוָה אֶל־אַבְרָם'), 'וַיֹּאמֶר אֲדֹנָי אֶל־אַבְרָם');
  assert.strictEqual(he('וַיֹּ֤אמֶר יְהוָה֙ אֶל־אַבְרָ֔ם'), 'וַיֹּ֤אמֶר אֲדֹנָי אֶל־אַבְרָ֔ם'); // with cantillation
  assert.strictEqual(he('מִזְבֵּחַ לַיהוָה'), 'מִזְבֵּחַ לַאֲדֹנָי'); // prefix keeps its vowel: la-Adonai
  assert.strictEqual(he('וַיהוָה אָמַר'), 'וַאֲדֹנָי אָמַר');
  assert.strictEqual(he('וַיִּקְרָא בְּשֵׁם יְהוָה'), 'וַיִּקְרָא בְּשֵׁם אֲדֹנָי');
  assert.strictEqual(he('אֶל־יְהוָה'), 'אֶל־אֲדֹנָי'); // after maqaf
  assert.strictEqual(he('יְהוָה יְהוָה אֵל רַחוּם'), 'אֲדֹנָי אֲדֹנָי אֵל רַחוּם'); // Ex 34:6
});

test('Hebrew: next to אדני the name is read Elohim', () => {
  const he = fixHebrewDivineNameForSpeech;
  assert.strictEqual(he('אֲדֹנָי יֱהוִה מַה־תִּתֶּן־לִי'), 'אֲדֹנָי אֱלֹהִים מַה־תִּתֶּן־לִי'); // Gen 15:2
  assert.strictEqual(he('אדני יהוה'), 'אדני אֱלֹהִים');
  assert.strictEqual(he('יֱהוִה אֲדֹנָי חֵילִי'), 'אֱלֹהִים אֲדֹנָי חֵילִי'); // Hab 3:19
});

test('Hebrew: other words untouched; only Hebrew speech is changed', () => {
  const he = fixHebrewDivineNameForSpeech;
  assert.strictEqual(he('יְהוּדָה וִיהוּדָה'), 'יְהוּדָה וִיהוּדָה'); // Judah
  assert.strictEqual(he('הַלְלוּ־יָהּ'), 'הַלְלוּ־יָהּ');
  assert.strictEqual(toSpeechText('ויאמר יהוה', 'he-IL'), 'ויאמר אֲדֹנָי');
  assert.strictEqual(toSpeechText('ויאמר יהוה', 'zh-TW'), 'ויאמר יהוה');
  assert.strictEqual(toSpeechText('the LORD', 'en-US'), 'the LORD');
});
