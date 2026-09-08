#!/usr/bin/env node
// Build "Inheriting the Land — Psalm 37" verse sets for all VerseRain languages.
// Run: node scripts/build-inherit-land.mjs
// Appends one set to each verses_*.js / verses.js file.

import fs from 'node:fs';
import path from 'node:path';
import { stripBollsMarkup } from '../src/lib/bibleTextMarkup.js';

const SRC = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const DATE = '2026-06-07';

// The 8 source verses (book id, chapter, verse numbers)
const VERSES = [
  { bookId: 19, chapter: 25, verses: [12, 13] },
  { bookId: 19, chapter: 37, verses: [9] },
  { bookId: 19, chapter: 37, verses: [11] },
  { bookId: 19, chapter: 37, verses: [21, 22] },
  { bookId: 19, chapter: 37, verses: [27, 28, 29] },
  { bookId: 19, chapter: 37, verses: [34] },
  { bookId: 23, chapter: 57, verses: [13] },
  { bookId: 40, chapter: 5,  verses: [5] },
];

// Per-language book name (order: psalm=19, isaiah=23, matthew=40)
const BOOK_NAMES = {
  cuv:  { 19: '詩篇',     23: '以賽亞書', 40: '馬太福音' },
  cuvs: { 19: '诗篇',     23: '以赛亚书', 40: '马太福音' },
  kjv:  { 19: 'Psalm',    23: 'Isaiah',   40: 'Matthew' },
  esv:  { 19: 'Psalm',    23: 'Isaiah',   40: 'Matthew' },
  niv:  { 19: 'Psalm',    23: 'Isaiah',   40: 'Matthew' },
  ja:   { 19: '詩篇',     23: 'イザヤ書', 40: 'マタイ' },
  ko:   { 19: '시편',     23: '이사야',   40: '마태복음' },
  fa:   { 19: 'مزامیر',  23: 'اشعیا',   40: 'متی' },
  ar:   { 19: 'مزامير',  23: 'إشعياء',  40: 'متى' },
  he:   { 19: 'תהלים',   23: 'ישעיהו',  40: 'מתי' },
  de:   { 19: 'Psalm',    23: 'Jesaja',   40: 'Matthäus' },
  es:   { 19: 'Salmos',   23: 'Isaías',   40: 'Mateo' },
  tr:   { 19: 'Mezmurlar',23: 'Yeşaya',  40: 'Matta' },
  vi:   { 19: 'Thi Thiên',23: 'Ê-sai',   40: 'Ma-thi-ơ' },
  my:   { 19: 'ဆာလံ',    23: 'ဟေရှာယ', 40: 'မဿဲ' },
  id:   { 19: 'Mazmur',   23: 'Yesaya',   40: 'Matius' },
  ms:   { 19: 'Mazmur',   23: 'Yesaya',   40: 'Matius' },
};

// Bolls.life slugs
const BOLLS_SLUG = {
  cuv: 'CUNP', cuvs: 'CUNPS', kjv: 'KJV', esv: 'ESV', niv: 'NIV',
  ja: 'NJB', ko: 'KRV', fa: 'POV', ar: 'SVD', de: 'SCH', es: 'RV1960',
  vi: 'VI1934', id: 'TB', ms: 'TB',
};
function getBollsSlug(lang, bookId) {
  if (lang === 'he') return bookId <= 39 ? 'HAC' : 'DHNT';
  return BOLLS_SLUG[lang] || null;
}
const GETBIBLE_SLUG = { tr: 'turkish', my: 'judson' };

// ── Set metadata per language ───────────────────────────────────────────────
const CUV_DESC = `<h2>一、承受地土：一個古老而永恆的應許</h2>
<p>詩篇 37 篇是大衛在年老時所寫的智慧詩（詩 37:25），其核心信息圍繞一個重複出現的應許：<strong>「溫柔的人必承受地土」</strong>（詩 37:9, 11, 22, 29, 34）。這個應許在新約中被耶穌在登山寶訓親口確認：「溫柔的人有福了！因為他們必承受地土。」（太 5:5）</p>
<p>「承受地土」在希伯來文化中有極深的神學意涵。<strong>「地土」（אֶרֶץ, erets）</strong>不只指地理上的迦南地，更象徵著神與祂子民立約的福分、家業與權柄。對新約的信徒而言，它更廣義地預表將來新天新地的完全統治與基業（啟 21:1-7）。</p>

<h2>二、從詩篇 37 看「承受地土」的條件</h2>
<p>大衛在這首詩中清楚描述了「承受地土者」的生命特質：</p>
<ul>
<li><strong>「倚靠耶和華而行善」（第 3 節）</strong>——不是靠自己的努力與謀算，而是在信靠神的根基上活出善行。</li>
<li><strong>「以耶和華為樂」（第 4 節）</strong>——使神成為我們最深的渴望與喜悅，而非僅僅追求神所賜的禮物。</li>
<li><strong>「將你的事交託耶和華」（第 5 節）</strong>——這個動詞在希伯來文是「滾過去」，意思是把重擔全然卸到神身上，不再自己扛。</li>
<li><strong>「默然倚靠耶和華，耐心等候祂」（第 7 節）</strong>——在動盪的世界中保持心靈的安靜，不與惡人爭競，也不因他們的暫時昌盛而焦慮。</li>
<li><strong>「離惡行善」（第 27 節）</strong>——承受地土的人不只是被動等待，而是積極地在地上活出公義的見證。</li>
</ul>

<h2>三、以賽亞書 57:13 的先知性補充</h2>
<p>以賽亞書 57:13 為這個應許加添了重要的對比性張力：偶像無法拯救，但<strong>「那些投靠我的，必承受地土，必得著我的聖山為業」</strong>。這提醒我們：「承受地土」的關鍵不在於我們的能力或功績，而在於我們<strong>「投靠」神的選擇</strong>——是否在萬難之中仍選擇以神為我們的避難所。</p>

<h2>四、等候神的人必得更新</h2>
<p>詩 37:34 說：「你當等候耶和華，遵守祂的道，祂就抬舉你，使你承受地土。」「等候」不是消極的拖延，而是充滿信心的主動選擇——選擇在神的時間表中行走，選擇在黑暗中持守應許。</p>
<p>在我們所處的時代，「承受地土」意味著成為地上鹽與光，在家庭、工作、社區中活出神的國度價值觀，成為互惠共好的見證者，直到神應許完全成就的那天。</p>
<p>願我們都成為等候神、信靠神、以神為樂的人，一同承受祂所應許的地土！</p>`;

const CUVS_DESC = `<h2>一、承受地土：一个古老而永恒的应许</h2>
<p>诗篇 37 篇是大卫在年老时所写的智慧诗（诗 37:25），其核心信息围绕一个重复出现的应许：<strong>「温柔的人必承受地土」</strong>（诗 37:9, 11, 22, 29, 34）。这个应许在新约中被耶稣在登山宝训亲口确认：「温柔的人有福了！因为他们必承受地土。」（太 5:5）</p>
<p>「承受地土」在希伯来文化中有极深的神学意涵。<strong>「地土」（אֶרֶץ, erets）</strong>不只指地理上的迦南地，更象征着神与祂子民立约的福分、家业与权柄。对新约的信徒而言，它更广义地预表将来新天新地的完全统治与基业（启 21:1-7）。</p>

<h2>二、从诗篇 37 看「承受地土」的条件</h2>
<p>大卫在这首诗中清楚描述了「承受地土者」的生命特质：</p>
<ul>
<li><strong>「倚靠耶和华而行善」（第 3 节）</strong>——不是靠自己的努力与谋算，而是在信靠神的根基上活出善行。</li>
<li><strong>「以耶和华为乐」（第 4 节）</strong>——使神成为我们最深的渴望与喜悦，而非仅仅追求神所赐的礼物。</li>
<li><strong>「将你的事交托耶和华」（第 5 节）</strong>——这个动词在希伯来文是「滚过去」，意思是把重担全然卸到神身上，不再自己扛。</li>
<li><strong>「默然倚靠耶和华，耐心等候祂」（第 7 节）</strong>——在动荡的世界中保持心灵的安静，不与恶人争竞，也不因他们的暂时昌盛而焦虑。</li>
<li><strong>「离恶行善」（第 27 节）</strong>——承受地土的人不只是被动等待，而是积极地在地上活出公义的见证。</li>
</ul>

<h2>三、以赛亚书 57:13 的先知性补充</h2>
<p>以赛亚书 57:13 为这个应许加添了重要的对比性张力：偶像无法拯救，但<strong>「那些投靠我的，必承受地土，必得着我的圣山为业」</strong>。这提醒我们：「承受地土」的关键不在于我们的能力或功绩，而在于我们<strong>「投靠」神的选择</strong>——是否在万难之中仍选择以神为我们的避难所。</p>

<h2>四、等候神的人必得更新</h2>
<p>诗 37:34 说：「你当等候耶和华，遵守祂的道，祂就抬举你，使你承受地土。」「等候」不是消极的拖延，而是充满信心的主动选择——选择在神的时间表中行走，选择在黑暗中持守应许。</p>
<p>在我们所处的时代，「承受地土」意味着成为地上盐与光，在家庭、工作、社区中活出神的国度价值观，成为互惠共好的见证者，直到神应许完全成就的那天。</p>
<p>愿我们都成为等候神、信靠神、以神为乐的人，一同承受祂所应许的地土！</p>`;

const EN_DESC = `<h2>Inheriting the Land: An Ancient and Eternal Promise</h2>
<p>Psalm 37 is a wisdom psalm written by David in his old age (v. 25), and its central theme revolves around a promise repeated five times: <strong>"the meek shall inherit the land"</strong> (vv. 9, 11, 22, 29, 34). Jesus confirmed this ancient promise in the Sermon on the Mount: <em>"Blessed are the meek, for they shall inherit the earth"</em> (Matt. 5:5).</p>

<h2>The Character of Those Who Inherit the Land</h2>
<p>David describes the life of those who receive this inheritance:</p>
<ul>
<li><strong>Trust in the LORD and do good</strong> (v. 3) — not relying on human schemes, but living out righteousness rooted in trust.</li>
<li><strong>Delight yourself in the LORD</strong> (v. 4) — making God Himself the deepest longing of your heart.</li>
<li><strong>Commit your way to the LORD</strong> (v. 5) — the Hebrew verb means to "roll" your burden entirely onto God.</li>
<li><strong>Be still before the LORD and wait patiently</strong> (v. 7) — maintaining inner quietness amid a turbulent world.</li>
<li><strong>Turn from evil and do good</strong> (v. 27) — an active, not passive, posture toward righteousness.</li>
</ul>

<h2>The Prophetic Confirmation (Isaiah 57:13)</h2>
<p>Isaiah 57:13 adds a striking contrast: idols cannot save, but <strong>"he who takes refuge in me shall inherit the land."</strong> The key is not our merit but our <em>refuge</em> — choosing God as our shelter in every trial.</p>

<h2>Wait for the LORD</h2>
<p>Psalm 37:34 promises: <em>"Wait for the LORD and keep his way, and he will exalt you to inherit the land."</em> Waiting is not passive delay but faith-filled persistence — walking in God's timetable, holding His promises in the dark. May we become people who trust, delight, and wait — and together inherit what He has promised.</p>`;

const JA_DESC = `<h2>地を受け継ぐ：古くして永遠の約束</h2>
<p>詩篇37篇はダビデが晩年に記した知恵の詩であり、その核心は繰り返し現れる約束にあります：<strong>「柔和な者は地を受け継ぐ」</strong>（9, 11, 22, 29, 34節）。この約束はイエスが山上の垂訓で確認されました：「柔和な者は幸いです。その人たちは地を受け継ぐから」（マタイ5:5）。</p>
<p>ダビデはこの詩の中で、地を受け継ぐ者の姿を描いています：<strong>主に信頼して善を行い</strong>、<strong>主を喜びとし</strong>、<strong>自分の道を主にゆだね</strong>、<strong>静まって主を待ち望む</strong>こと（4, 5, 7節）。悪を離れて善を行い（27節）、主を待ち続ける者を、主は高く上げ地を受け継がせてくださいます（34節）。</p>
<p>イザヤ57:13は「わたしに拠り頼む者は地を受け継ぎ、わたしの聖なる山を受け継ぐ」と約束します。地を受け継ぐ鍵は、私たちの功績ではなく、神への信頼の選択にあります。</p>`;

const KO_DESC = `<h2>땅을 기업으로 받음: 오래되고 영원한 약속</h2>
<p>시편 37편은 다윗이 노년에 기록한 지혜의 시로(25절), 핵심 메시지는 반복되는 약속입니다: <strong>"온유한 자는 땅을 기업으로 받을 것이라"</strong>(9, 11, 22, 29, 34절). 예수님은 산상수훈에서 이 약속을 확인하셨습니다: "온유한 자는 복이 있나니 그들이 땅을 기업으로 받을 것임이요"(마 5:5).</p>
<p>다윗은 땅을 기업으로 받는 자의 특성을 묘사합니다: <strong>여호와를 의뢰하고 선을 행하며</strong>, <strong>여호와를 기뻐하고</strong>, <strong>네 길을 여호와께 맡기고</strong>, <strong>잠잠히 여호와를 기다리라</strong>(3-7절). 악을 떠나 선을 행하며(27절) 주를 기다리는 자는 높임을 받아 땅을 기업으로 얻게 됩니다(34절).</p>
<p>이사야 57:13은 "나를 의뢰하는 자는 땅을 차지하며 나의 거룩한 산을 기업으로 받으리라"고 약속합니다. 땅을 기업으로 받는 열쇠는 우리의 공로가 아니라 하나님께 피하는 선택에 있습니다.</p>`;

const FA_DESC = `<h2>وراثت زمین: وعده‌ای قدیمی و ابدی</h2>
<p>مزمور ۳۷ یک مزمور حکمتی است که داوود در سالهای پیری نوشت، و پیام اصلی آن حول وعده‌ای تکرارشونده می‌گردد: <strong>«حلیمان زمین را به ارث خواهند برد»</strong> (آیات ۹، ۱۱، ۲۲، ۲۹، ۳۴). عیسی این وعده باستانی را در موعظه روی کوه تأیید کرد: «خوشا به حال حلیمان زیرا ایشان وارث زمین خواهند شد» (متی ۵:۵).</p>
<p>داوود ویژگی‌های کسانی که این میراث را دریافت می‌کنند را توصیف می‌کند: <strong>به خداوند توکل کن و نیکویی کن</strong>، <strong>در خداوند شادی کن</strong>، <strong>راه خود را به خداوند بسپار</strong>، و <strong>در برابر خداوند آرام بگیر و منتظر او باش</strong> (آیات ۳-۷). آنانی که از بدی دوری گزیده و نیکویی می‌کنند (آیه ۲۷) و منتظر خداوند می‌مانند، بالا برده شده و زمین را به ارث می‌برند (آیه ۳۴).</p>
<p>اشعیا ۵۷:۱۳ وعده می‌دهد: «کسی که به من پناه می‌آورد، زمین را به ارث خواهد برد.» کلید وراثت زمین در انتخاب پناه بردن به خداوند است، نه در شایستگی‌های ما.</p>`;

const AR_DESC = `<h2>وراثة الأرض: وعد قديم وأبدي</h2>
<p>المزمور 37 هو مزمور حكمة كتبه داود في شيخوخته (ع25)، ويدور موضوعه الرئيسي حول وعد يتكرر خمس مرات: <strong>"الودعاء سيرثون الأرض"</strong> (ع9، 11، 22، 29، 34). أكّد يسوع هذا الوعد القديم في عظة الجبل: "طوبى للودعاء لأنهم يرثون الأرض" (متى 5:5).</p>
<p>يصف داود ملامح الذين يرثون هذا الميراث: <strong>توكّل على الرب وافعل الخير</strong>، <strong>وتلذّذ بالرب</strong>، <strong>وفوّض طريقك إلى الرب</strong>، <strong>وانتظره بهدوء وصبر</strong> (ع3-7). الذين يبتعدون عن الشر ويفعلون الخير (ع27) وينتظرون الرب سيُرفعون ويرثون الأرض (ع34).</p>
<p>يعد إشعياء 57:13 بأن "من يلجأ إليّ يرث الأرض ويمتلك جبلي المقدس." مفتاح وراثة الأرض ليس في جدارتنا بل في اختيارنا أن نلجأ إلى الله في كل ضيق.</p>`;

const HE_DESC = `<h2>ירושת הארץ: הבטחה עתיקה ונצחית</h2>
<p>תהלים לז הוא מזמור חכמה שדוד כתב בשנותיו האחרונות (פסוק כה), ועיקר מסרו סובב סביב הבטחה החוזרת חמש פעמים: <strong>"הענווים יירשו ארץ"</strong> (פסוקים ט, יא, כב, כט, לד). ישוע אישר הבטחה עתיקה זו בדרשת ההר: "אשרי הענווים כי הם יירשו את הארץ" (מתי ה:ה).</p>
<p>דוד מתאר את מאפייני יורשי הארץ: <strong>בטח בה' ועשה טוב</strong>, <strong>והתענג על ה'</strong>, <strong>וגלול על ה' דרכך</strong>, <strong>ודום לה' והתחולל לו</strong> (פסוקים ג-ז). אלה שסרים מרע ועושים טוב (פסוק כז) וממתינים לה' יינשאו ויירשו את הארץ (פסוק לד).</p>
<p>ישעיהו נז:יג מבטיח: "הבוטח בי יירש ארץ ויירש הר קדשי." מפתח ירושת הארץ אינו בזכויותינו אלא בבחירתנו לחסות בה'.</p>`;

const DE_DESC = `<h2>Das Land erben: Eine alte und ewige Verheißung</h2>
<p>Psalm 37 ist ein Weisheitspsalm, den David im Alter schrieb (V. 25). Sein Kernthema dreht sich um eine fünfmal wiederholte Verheißung: <strong>"Die Sanftmütigen werden das Land erben"</strong> (V. 9, 11, 22, 29, 34). Jesus bestätigte diese uralte Verheißung in der Bergpredigt: "Selig sind die Sanftmütigen, denn sie werden das Erdreich besitzen" (Mt 5,5).</p>
<p>David beschreibt die Merkmale derer, die dieses Erbe empfangen: <strong>Vertrau auf den HERRN und tue Gutes</strong>, <strong>freue dich am HERRN</strong>, <strong>befiehl dem HERRN deinen Weg</strong> und <strong>sei stille vor dem HERRN und harre auf ihn</strong> (V. 3-7). Wer das Böse meidet und Gutes tut (V. 27) und auf den HERRN wartet, wird erhöht und erbt das Land (V. 34).</p>
<p>Jesaja 57,13 verheißt: "Wer sich auf mich verlässt, soll das Land erben und meinen heiligen Berg besitzen." Der Schlüssel ist nicht unsere Würdigkeit, sondern die Wahl, bei Gott Zuflucht zu suchen.</p>`;

const ES_DESC = `<h2>Heredar la tierra: Una promesa antigua y eterna</h2>
<p>El Salmo 37 es un salmo de sabiduría que David escribió en su vejez (v. 25), y su tema central gira en torno a una promesa que se repite cinco veces: <strong>"los mansos heredarán la tierra"</strong> (vv. 9, 11, 22, 29, 34). Jesús confirmó esta antigua promesa en el Sermón del Monte: "Bienaventurados los mansos, porque ellos recibirán la tierra por heredad" (Mt 5:5).</p>
<p>David describe las características de quienes reciben esta herencia: <strong>confía en el SEÑOR y haz el bien</strong>, <strong>deléitate en el SEÑOR</strong>, <strong>encomienda al SEÑOR tu camino</strong> y <strong>guarda silencio ante el SEÑOR y espera en él</strong> (vv. 3-7). Quienes se apartan del mal y hacen el bien (v. 27) y esperan en el SEÑOR serán exaltados y heredarán la tierra (v. 34).</p>
<p>Isaías 57:13 promete: "el que se acoge a mí heredará la tierra y poseerá mi santo monte." La clave no es nuestro mérito sino nuestra elección de refugiarnos en Dios.</p>`;

const TR_DESC = `<h2>Yeri Miras Almak: Eski ve Ebedi Bir Vaat</h2>
<p>Mezmur 37, Davut'un yaşlılığında yazdığı bir bilgelik mezmuru olup (ayet 25) temel mesajı beş kez tekrarlanan bir vaade dayanır: <strong>"Alçakgönüllüler yeri miras alacak"</strong> (ayetler 9, 11, 22, 29, 34). İsa bu eski vaadi Dağdaki Vaazda doğruladı: "Ne mutlu halim olanlara! Yurt onların olacak" (Matta 5:5).</p>
<p>Davut bu mirası alanların özelliklerini anlatır: <strong>RAB'be güven ve iyilik yap</strong>, <strong>RAB'den zevk al</strong>, <strong>yolunu RAB'be bırak</strong> ve <strong>RAB önünde sus, sabırla bekle</strong> (ayetler 3-7). Kötülükten vazgeçip iyilik yapanlar (ayet 27) ve RAB'bi bekleyenler yükseltilecek ve yeri miras alacaktır (ayet 34).</p>
<p>Yeşaya 57:13 şunu vaat eder: "Bana sığınan kişi yeri miras alacak, kutsal dağımı ele geçirecek." Yeri miras almanın anahtarı, hak etmek değil, Tanrı'ya sığınmayı seçmektir.</p>`;

const VI_DESC = `<h2>Hưởng Đất: Lời Hứa Cổ Xưa và Vĩnh Cửu</h2>
<p>Thi Thiên 37 là một bài thơ khôn ngoan mà Đa-vít viết lúc về già (c. 25), với chủ đề trung tâm xoay quanh lời hứa lặp đi lặp lại năm lần: <strong>"Người nhu mì sẽ được hưởng đất"</strong> (c. 9, 11, 22, 29, 34). Chúa Jêsus xác nhận lời hứa cổ xưa này trong Bài Giảng Trên Núi: "Phước cho những kẻ nhu mì, vì họ sẽ hưởng được đất" (Ma-thi-ơ 5:5).</p>
<p>Đa-vít mô tả đặc điểm của những người nhận được cơ nghiệp này: <strong>tin cậy Chúa và làm điều lành</strong>, <strong>vui thích trong Chúa</strong>, <strong>phó thác đường lối mình cho Chúa</strong> và <strong>hãy yên lặng trước mặt Chúa, chờ đợi Ngài</strong> (c. 3-7). Những ai lánh xa điều ác, làm điều lành (c. 27) và chờ đợi Chúa sẽ được tôn cao và hưởng đất (c. 34).</p>
<p>Ê-sai 57:13 hứa: "Người nào tin cậy ta sẽ được đất làm cơ nghiệp và được núi thánh ta." Chìa khóa không phải là công đức của chúng ta mà là sự lựa chọn nương náu nơi Đức Chúa Trời.</p>`;

const MY_DESC = `<h2>မြေကြီးကို အမွေဆက်ခံခြင်း — ဆာလံ ၃၇ ၏ ဗျာဒိတ်</h2>
<p>ဆာလံ ၃၇ သည် ဒါဝိဒ်မင်းကြီး အိုမင်းစဉ် ရေးသားသော ပညာဆာလံ (ကျမ်းပိုဒ် ၂၅) ဖြစ်ပြီး၊ ၎င်း၏ အဓိကသတင်းစကားမှာ ငါးကြိမ် ထပ်ကာထပ်ကာ ဖော်ပြသော ကတိတော်ပင်ဖြစ်သည်: <strong>«နူးညံ့သောသူတို့သည် မြေကြီးကို အမွေဆက်ခံကြမည်»</strong> (ကျမ်းပိုဒ် ၉, ၁၁, ၂၂, ၂၉, ၃၄)။ ယေရှုသည် တောင်ပေါ်တရားတော်ထဲတွင် ဤကတိတော်ကို အတည်ပြုတော်မူ၏: «နူးညံ့သောသူတို့သည် မြေကြီးကို အမွေဆက်ခံကြမည်»（မဿဲ ၅:၅）</p>
<p>ဒါဝိဒ်မင်းသည် ဤမြေကြီးကို ရရှိမည့်သူများ၏ သွင်ပြင်လက္ခဏာများကို ဖော်ပြ၏: <strong>ထာဝရဘုရားကို ကိုးစား၍ ကောင်းမှုပြုပါ</strong>၊ <strong>ထာဝရဘုရားကို ဝမ်းမြောက်ပါ</strong>၊ <strong>သင်၏ လမ်းကို ထာဝရဘုရားအား အပ်နှံပါ</strong>၊ <strong>ထာဝရဘုရားရှေ့တော်၌ ငြိမ်ဝပ်စွာ စောင့်မျှော်ပါ</strong> (ကျမ်းပိုဒ် ၃-၇)။ ဒုစရိုက်ကို ရှောင်ကြဉ်၍ ကောင်းမှုပြုသောသူများ (ကျမ်းပိုဒ် ၂၇) သည် မြေကြီးကို အမွေဆက်ခံကြမည် (ကျမ်းပိုဒ် ၃၄)။</p>
<p>ဟေရှာယ ၅၇:၁၃ တွင် "ငါ့ကိုကိုးစားသောသူသည် မြေကြီးကိုအမွေဆက်ခံ၍ ငါ၏ သန့်ရှင်းသောတောင်ကို ပိုင်ဆိုင်မည်" ဟု ဂတိပေးတော်မူ၏။ မြေကြီးကို အမွေဆက်ခံရမည့် သော့ချက်မှာ ကျွန်ုပ်တို့၏ ထိုက်တန်မှုမဟုတ်ဘဲ ဘုရားသခင်ထံ မှီခိုသော ရွေးချယ်မှုဖြစ်သည်။</p>`;

const ID_DESC = `<h2>Mewarisi Bumi: Janji yang Kuno dan Kekal</h2>
<p>Mazmur 37 adalah mazmur hikmat yang ditulis Daud di masa tuanya (ay. 25), dan tema sentralnya berkisar pada janji yang diulang lima kali: <strong>"orang yang lemah lembut akan mewarisi negeri"</strong> (ay. 9, 11, 22, 29, 34). Yesus mengkonfirmasi janji kuno ini dalam Khotbah di Bukit: "Berbahagialah orang yang lemah lembut, karena mereka akan memiliki bumi" (Mat. 5:5).</p>
<p>Daud menggambarkan ciri-ciri mereka yang menerima warisan ini: <strong>percayalah kepada TUHAN dan lakukanlah kebaikan</strong>, <strong>bergembiralah karena TUHAN</strong>, <strong>serahkanlah jalanmu kepada TUHAN</strong> dan <strong>diamlah di hadapan TUHAN dan nantikanlah Dia</strong> (ay. 3-7). Mereka yang menjauhi kejahatan dan melakukan kebaikan (ay. 27) dan menantikan TUHAN akan ditinggikan dan mewarisi bumi (ay. 34).</p>
<p>Yesaya 57:13 berjanji: "orang yang berlindung kepada-Ku akan mewarisi negeri." Kuncinya bukan prestasi kita, melainkan pilihan untuk berlindung kepada Allah.</p>`;

const MS_DESC = `<h2>Mewarisi Bumi: Janji yang Kuno dan Kekal</h2>
<p>Mazmur 37 adalah mazmur hikmat yang ditulis Daud di masa tuanya (ay. 25), dan tema pokoknya berkisar pada janji yang diulang lima kali: <strong>"orang yang lemah lembut akan mewarisi bumi"</strong> (ay. 9, 11, 22, 29, 34). Yesus mengesahkan janji purba ini dalam Khotbah di Bukit: "Berbahagialah orang yang lemah lembut, kerana mereka akan mewarisi bumi" (Mat. 5:5).</p>
<p>Daud menggambarkan ciri-ciri mereka yang menerima warisan ini: <strong>percayalah kepada TUHAN dan lakukanlah kebaikan</strong>, <strong>bersukacitalah dalam TUHAN</strong>, <strong>serahkanlah jalanmu kepada TUHAN</strong> dan <strong>berdiamlah di hadapan TUHAN dan nantikanlah Dia</strong> (ay. 3-7). Mereka yang menjauhi kejahatan dan melakukan kebaikan (ay. 27) dan menantikan TUHAN akan ditinggikan dan mewarisi bumi (ay. 34).</p>
<p>Yesaya 57:13 berjanji: "Orang yang bernaung kepada-Ku akan mewarisi bumi." Kuncinya bukan jasa kita tetapi pilihan untuk berlindung kepada Tuhan.</p>`;

// ── Full language config ────────────────────────────────────────────────────
const LANGUAGES = [
  {
    lang: 'cuv',  id: 'inherit-land-cuv',  uiLang: 'zh-TW',
    title: '承受地土——詩篇 37 篇的啟示', desc: CUV_DESC,
    file: 'verses.js', exportName: 'VERSE_SETS',
  },
  {
    lang: 'cuvs', id: 'inherit-land-cuvs', uiLang: 'zh-Hans',
    title: '承受地土——诗篇 37 篇的启示', desc: CUVS_DESC,
    file: 'verses_cuvs.js', exportName: 'VERSE_SETS_CUVS',
  },
  {
    lang: 'kjv',  id: 'inherit-land-kjv',  uiLang: 'en',
    title: 'Inheriting the Land — Revelation of Psalm 37', desc: EN_DESC,
    file: 'verses_kjv.js', exportName: 'VERSE_SETS_KJV',
  },
  {
    lang: 'esv',  id: 'inherit-land-esv',  uiLang: 'en',
    title: 'Inheriting the Land — Revelation of Psalm 37', desc: EN_DESC,
    file: 'verses_esv.js', exportName: 'VERSE_SETS_ESV',
  },
  {
    lang: 'niv',  id: 'inherit-land-niv',  uiLang: 'en',
    title: 'Inheriting the Land — Revelation of Psalm 37', desc: EN_DESC,
    file: 'verses_niv.js', exportName: 'VERSE_SETS_NIV',
  },
  {
    lang: 'ja',   id: 'inherit-land-ja',   uiLang: 'ja',
    title: '地を受け継ぐ者——詩篇37篇の啟示', desc: JA_DESC,
    file: 'verses_ja.js', exportName: 'VERSE_SETS_JA',
  },
  {
    lang: 'ko',   id: 'inherit-land-ko',   uiLang: 'ko',
    title: '땅을 기업으로 받음 — 시편 37편의 계시', desc: KO_DESC,
    file: 'verses_ko.js', exportName: 'VERSE_SETS_KO',
  },
  {
    lang: 'fa',   id: 'inherit-land-fa',   uiLang: 'fa',
    title: 'وراثت زمین — مکاشفه مزمور ۳۷', desc: FA_DESC,
    file: 'verses_fa.js', exportName: 'VERSE_SETS_FA',
  },
  {
    lang: 'ar',   id: 'inherit-land-ar',   uiLang: 'ar',
    title: 'وراثة الأرض — مكاشفة المزمور 37', desc: AR_DESC,
    file: 'verses_ar.js', exportName: 'VERSE_SETS_AR',
  },
  {
    lang: 'he',   id: 'inherit-land-he',   uiLang: 'he',
    title: 'ירושת הארץ — התגלות תהלים לז', desc: HE_DESC,
    file: 'verses_he.js', exportName: 'VERSE_SETS_HE',
  },
  {
    lang: 'de',   id: 'inherit-land-de',   uiLang: 'de',
    title: 'Das Land erben — Offenbarung aus Psalm 37', desc: DE_DESC,
    file: 'verses_de.js', exportName: 'VERSE_SETS_DE',
  },
  {
    lang: 'es',   id: 'inherit-land-es',   uiLang: 'es',
    title: 'Heredar la tierra — Revelación del Salmo 37', desc: ES_DESC,
    file: 'verses_es.js', exportName: 'VERSE_SETS_ES',
  },
  {
    lang: 'tr',   id: 'inherit-land-tr',   uiLang: 'tr',
    title: 'Yeri Miras Almak — Mezmur 37\'nin Vahyi', desc: TR_DESC,
    file: 'verses_tr.js', exportName: 'VERSE_SETS_TR',
  },
  {
    lang: 'vi',   id: 'inherit-land-vi',   uiLang: 'vi',
    title: 'Hưởng Đất — Sự Mặc Khải Của Thi Thiên 37', desc: VI_DESC,
    file: 'verses_vi.js', exportName: 'VERSE_SETS_VI',
  },
  {
    lang: 'my',   id: 'inherit-land-my',   uiLang: 'my',
    title: 'မြေကြီးကို အမွေဆက်ခံခြင်း — ဆာလံ ၃၇ ၏ ဗျာဒိတ်', desc: MY_DESC,
    file: 'verses_my.js', exportName: 'VERSE_SETS_MY',
  },
  {
    lang: 'id',   id: 'inherit-land-id',   uiLang: 'id',
    title: 'Mewarisi Bumi — Wahyu Mazmur 37', desc: ID_DESC,
    file: 'verses_id.js', exportName: 'VERSE_SETS_ID',
  },
  {
    lang: 'ms',   id: 'inherit-land-ms',   uiLang: 'ms',
    title: 'Mewarisi Bumi — Wahyu Mazmur 37', desc: MS_DESC,
    file: 'verses_ms.js', exportName: 'VERSE_SETS_MS',
  },
];

// ── Fetch helpers ─────────────────────────────────────────────────────────
const chapterCache = new Map();
async function fetchChapterBolls(slug, bookId, chapter) {
  const k = `${slug}|${bookId}|${chapter}`;
  if (chapterCache.has(k)) return chapterCache.get(k);
  const url = `https://bolls.life/get-text/${slug}/${bookId}/${chapter}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const arr = await res.json();
  chapterCache.set(k, arr);
  return arr;
}

async function fetchChapterGetbible(slug, bookId, chapter) {
  const k = `gb:${slug}|${bookId}|${chapter}`;
  if (chapterCache.has(k)) return chapterCache.get(k);
  const url = `https://api.getbible.net/v2/${slug}/${bookId}/${chapter}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const data = await res.json();
  // getbible.net format: { verses: { "1": { verse: "...", verse_nr: 1 }, ... } }
  const arr = Object.values(data.verses || {}).map(v => ({
    verse: v.verse_nr, text: v.verse
  }));
  chapterCache.set(k, arr);
  return arr;
}

async function fetchVerseText(lang, bookId, chapter, verses) {
  let arr;
  const getbibleSlug = GETBIBLE_SLUG[lang];
  if (getbibleSlug) {
    arr = await fetchChapterGetbible(getbibleSlug, bookId, chapter);
  } else {
    const bollsSlug = getBollsSlug(lang, bookId);
    if (!bollsSlug) throw new Error(`No bolls slug for lang="${lang}" bookId=${bookId}`);
    arr = await fetchChapterBolls(bollsSlug, bookId, chapter);
  }
  const map = new Map(arr.map(v => [Number(v.verse), stripBollsMarkup(v.text)]));
  const texts = verses.map(v => map.get(v) || '').filter(Boolean);
  return texts.join(' ').trim();
}

// Format a reference string in the target language
function formatRef(lang, bookId, chapter, verses) {
  const bookNames = BOOK_NAMES[lang];
  const book = bookNames[bookId];
  if (!book) throw new Error(`No book name for lang="${lang}" bookId=${bookId}`);
  const vStart = verses[0];
  const vEnd = verses[verses.length - 1];
  const verseStr = (verses.length === 1)
    ? `${vStart}`
    : `${vStart}-${vEnd}`;
  return `${book} ${chapter}:${verseStr}`;
}

function escapeStr(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

// ── Main ───────────────────────────────────────────────────────────────────
for (const langCfg of LANGUAGES) {
  const { lang, id, uiLang, title, desc, file, exportName } = langCfg;
  process.stderr.write(`\n▸ Building ${lang} (${id})...\n`);

  const verseEntries = [];
  for (let i = 0; i < VERSES.length; i++) {
    const { bookId, chapter, verses } = VERSES[i];
    process.stderr.write(`  fetching ${bookId}:${chapter}:${verses.join(',')} ...\n`);
    let text;
    try {
      text = await fetchVerseText(lang, bookId, chapter, verses);
    } catch (e) {
      process.stderr.write(`  ⚠ Error: ${e.message}\n`);
      text = '';
    }
    const ref = formatRef(lang, bookId, chapter, verses);
    verseEntries.push({ id: `${id}-${i + 1}`, reference: ref, title, text });
  }

  // Build the set block to append
  const titleEsc = escapeStr(title);
  const descEsc = escapeStr(desc);
  const block = [
    `  {`,
    `    id: "${id}",`,
    `    title: \`${titleEsc}\`,`,
    `    createdAt: "${DATE}",`,
    `    description: \`${descEsc}\`,`,
    `    language: "${uiLang}",`,
    `    verses: [`,
    ...verseEntries.map(v =>
      `      { id: "${v.id}", reference: "${escapeStr(v.reference)}", title: \`${escapeStr(v.title)}\`, text: \`${escapeStr(v.text)}\` },`
    ),
    `    ]`,
    `  },`,
  ].join('\n');

  const filePath = path.join(SRC, file);
  let src = fs.readFileSync(filePath, 'utf8');

  // Check if the set id is already present
  if (src.includes(`"${id}"`)) {
    process.stderr.write(`  ⚠ Set "${id}" already exists in ${file}, skipping\n`);
    continue;
  }

  // Handle empty single-line array: `export const VERSE_SETS_XX = [];`
  const emptyPattern = new RegExp(`(export\\s+const\\s+${exportName}\\s*=\\s*)\\[\\];`);
  if (emptyPattern.test(src)) {
    src = src.replace(emptyPattern, `$1[\n${block}\n];`);
    fs.writeFileSync(filePath, src, 'utf8');
    process.stderr.write(`  ✅ Written to ${file} (was empty array)\n`);
    continue;
  }

  // Multi-line array: insert before the last `\n];`
  const insertPoint = src.lastIndexOf('\n];');
  if (insertPoint < 0) {
    process.stderr.write(`  ⚠ Could not find closing ]; in ${file}\n`);
    continue;
  }
  // Ensure the previous last element has a trailing comma before our new element.
  // The last set's closing } may or may not have one.
  const beforeInsert = src.slice(0, insertPoint).trimEnd();
  const needsComma = beforeInsert.endsWith('}') && !beforeInsert.endsWith('},');
  const separator = needsComma ? ',\n' : '\n';
  const newSrc = src.slice(0, insertPoint) + separator + block + '\n' + src.slice(insertPoint);
  fs.writeFileSync(filePath, newSrc, 'utf8');
  process.stderr.write(`  ✅ Written to ${file}\n`);
}

process.stderr.write('\n✅ All done! Run `npm run validate-refs` to verify.\n');
