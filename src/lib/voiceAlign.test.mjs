import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePcm, cleanVoiceAnalysis, ANALYSIS_VERSION } from './voiceAnalysis.js';
import { alignReading, estimateReading, boundaryStrengths, phraseShowTime, syllables } from './voiceAlign.js';

// A fake reading as PCM: buzzing "speech" for each piece (length follows its
// syllables, times a per-piece pace), quiet room noise between them.
function fakeReading(pieces, { sr = 8000, lead = 0.6, tail = 1.2, pace = 0.24, gaps = [], jitter = [], click = false } = {}) {
  const spans = [];
  let t = lead;
  pieces.forEach((p, i) => {
    const d = syllables(p) * pace * (1 + (jitter[i] || 0));
    spans.push({ start: t, end: t + d });
    t += d + (i < pieces.length - 1 ? (gaps[i] ?? 0.35) : 0);
  });
  const dur = t + tail;
  const pcm = new Float32Array(Math.round(dur * sr));
  let seed = 9;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (let i = 0; i < pcm.length; i += 1) {
    const x = i / sr;
    let v = rnd() * 0.002;
    if (spans.some(s => x >= s.start && x < s.end)) v += 0.3 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * x)) * Math.sin(2 * Math.PI * 170 * x);
    // The stop button's click, well after the last word.
    if (click && x > dur - 0.4 && x < dur - 0.37) v += 0.5 * rnd();
    pcm[i] = v;
  }
  return { pcm, sr, spans };
}

const PHRASES = ['The LORD is my shepherd', 'I shall not want', 'He makes me lie down in green pastures', 'He leads me beside still waters', 'He restores my soul', 'He leads me in paths of righteousness', 'for his name’s sake'];
const TEXT = 'The LORD is my shepherd; I shall not want. He makes me lie down in green pastures. He leads me beside still waters. He restores my soul. He leads me in paths of righteousness for his name’s sake.';

const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;

test('analyzePcm finds the speech, every pause, and ignores a click after the last word', () => {
  const { pcm, sr, spans } = fakeReading(PHRASES, { click: true });
  const a = analyzePcm(pcm, sr);
  assert.equal(a.v, ANALYSIS_VERSION);
  assert.ok(near(a.speech[0], spans[0].start, 0.03), `start ${a.speech[0]}`);
  assert.ok(near(a.speech[1], spans[spans.length - 1].end, 0.03), `end ${a.speech[1]}`);
  assert.equal(a.pauses.length, PHRASES.length - 1);
  a.pauses.forEach(([s, e], i) => {
    assert.ok(near(s, spans[i].end, 0.03) && near(e, spans[i + 1].start, 0.03), `pause ${i}: ${s}–${e}`);
  });
  assert.deepEqual(cleanVoiceAnalysis(a), a);
});

test('cleanVoiceAnalysis rejects malformed data', () => {
  assert.equal(cleanVoiceAnalysis(null), null);
  assert.equal(cleanVoiceAnalysis({ v: 1, dur: 10, speech: [2, 1], pauses: [] }), null);
  assert.equal(cleanVoiceAnalysis({ v: 1, dur: 10, speech: [0, 9], pauses: [[3, 2]] }), null);
  assert.equal(cleanVoiceAnalysis({ v: 1, dur: 10, speech: [0, 9], pauses: [[3, 4], [3.5, 5]] }), null);
  assert.equal(cleanVoiceAnalysis({ v: 1, dur: 99999, speech: [0, 9], pauses: [] }), null);
});

function check(pieces, opts, introText) {
  const { pcm, sr, spans } = fakeReading(pieces, opts);
  const analysis = analyzePcm(pcm, sr);
  const strengths = boundaryStrengths(TEXT, PHRASES);
  return { r: alignReading({ analysis, phrases: PHRASES, strengths, introText }), spans };
}

test('alignReading: no reference read — phrases line up with the voice', () => {
  const { r, spans } = check(PHRASES, { jitter: [0.3, -0.2, 0.25, -0.3, 0.4, -0.1, 0.2] }, 'Psalm 23');
  assert.equal(r.intro, null);
  r.units.forEach((u, i) => assert.ok(near(u.start, spans[i].start) && near(u.end, spans[i].end), `phrase ${i + 1}: ${u.start.toFixed(2)}–${u.end.toFixed(2)} vs ${spans[i].start.toFixed(2)}–${spans[i].end.toFixed(2)}`));
});

test('alignReading: the reader says the reference first — it is skipped', () => {
  const { r, spans } = check(['Psalm twenty three', ...PHRASES], { gaps: [0.9], jitter: [0, 0.3, -0.2, 0.25, -0.3, 0.4, -0.1, 0.2] }, 'Psalm 23');
  assert.ok(r.intro, 'intro found');
  r.units.forEach((u, i) => assert.ok(near(u.start, spans[i + 1].start) && near(u.end, spans[i + 1].end), `phrase ${i + 1}: ${u.start.toFixed(2)} vs ${spans[i + 1].start.toFixed(2)}`));
});

test('alignReading: a longer heading read first (e.g. a psalm title) is skipped too', () => {
  const { r, spans } = check(['Psalm twenty three', 'A Psalm of David', ...PHRASES], { gaps: [0.8, 0.9] }, 'Psalm 23');
  assert.ok(r.intro);
  assert.ok(near(r.units[0].start, spans[2].start), `${r.units[0].start} vs ${spans[2].start}`);
  assert.ok(near(r.units[6].end, spans[8].end));
});

test('alignReading: two phrases run together (no pause) — estimated, the rest stay right', () => {
  const gaps = [0.35, 0.02, 0.35, 0.6, 0.35, 0.2];
  const { r, spans } = check(PHRASES, { gaps }, '');
  [0, 1, 3, 4, 5, 6].forEach(i => assert.ok(near(r.units[i].start, spans[i].start, 0.08), `phrase ${i + 1} start`));
  assert.equal(r.units[1].onPause, false);
});

test('phraseShowTime: shown just before it is heard; a new page waits for the previous phrase to end', () => {
  const units = [{ start: 1, end: 2.5 }, { start: 2.6, end: 4 }, { start: 4.02, end: 5 }];
  assert.equal(phraseShowTime(units, 1), 2.5);
  assert.ok(near(phraseShowTime(units, 2, { pageStart: true }), 4.05, 1e-9));
  assert.ok(phraseShowTime(units, 2, { pageStart: true, estimated: true }) >= 4.3 - 1e-9);
});

test('phraseShowTime: a read-along lead shows each phrase half a second early, never before 0 or before the page is read', () => {
  const units = [{ start: 0.3, end: 2.5 }, { start: 3.2, end: 4 }, { start: 4.6, end: 5 }];
  assert.equal(phraseShowTime(units, 0, { lead: 0.5 }), 0);
  assert.ok(near(phraseShowTime(units, 1, { lead: 0.5 }), 2.7, 1e-9));
  // first phrase of a new page: not before the previous phrase has been read
  assert.ok(near(phraseShowTime(units, 2, { lead: 0.5, pageStart: true }), 4.1, 1e-9));
});

test('estimateReading leaves room for a spoken reference and covers the speech', () => {
  const u = estimateReading({ dur: 20, speech: [1, 19], phrases: PHRASES, introText: 'Psalm 23' });
  assert.ok(u[0].start > 1);
  assert.ok(near(u[u.length - 1].end, 19, 1e-9));
});

test('boundaryStrengths: full stops and semicolons are strong, commas weak', () => {
  const s = boundaryStrengths('In the beginning, God created the heavens; and the earth.', ['In the beginning', 'God created the heavens', 'and the earth']);
  assert.deepEqual(s, [0.6, 1]);
});

// A whole chapter, many times over: random phrase lengths, a reader whose
// pace drifts ±25 %, longer pauses at full stops, some phrases run together,
// the reference read in half of the runs. Nearly every phrase must start
// within 0.1 s of the voice.
test('alignReading on long, uneven readings, with and without the reference', () => {
  let seed = 4;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const words = ['and', 'the', 'LORD', 'said', 'unto', 'his', 'people', 'Israel', 'blessed', 'are', 'they', 'mountains', 'righteousness', 'forever', 'shall', 'praise'];
  let good = 0;
  let total = 0;
  let introsRight = 0;
  for (let run = 0; run < 12; run += 1) {
    const phrases = Array.from({ length: 30 }, () => Array.from({ length: 2 + Math.floor(rnd() * 6) }, () => words[Math.floor(rnd() * words.length)]).join(' '));
    const strong = phrases.map(() => rnd() < 0.4);
    const text = phrases.map((p, i) => p + (strong[i] ? '.' : ',')).join(' ');
    const withRef = run % 2 === 0;
    const pieces = withRef ? ['Psalm one hundred', ...phrases] : phrases;
    const off = withRef ? 1 : 0;
    const gaps = pieces.map((_, i) => {
      if (withRef && i === 0) return 0.7 + rnd() * 0.5;
      const k = i - off;
      if (rnd() < 0.08) return 0.03; // read straight on
      return strong[k] ? 0.5 + rnd() * 0.5 : 0.18 + rnd() * 0.25;
    });
    const jitter = pieces.map((_, i) => 0.25 * Math.sin(i / 4 + run) + (rnd() - 0.5) * 0.2);
    const { pcm, sr, spans } = fakeReading(pieces, { gaps, jitter });
    const analysis = analyzePcm(pcm, sr);
    const r = alignReading({ analysis, phrases, strengths: boundaryStrengths(text, phrases), introText: 'Psalm 100' });
    if (Boolean(r.intro) === withRef) introsRight += 1;
    r.units.forEach((u, i) => { total += 1; if (near(u.start, spans[i + off].start, 0.1)) good += 1; });
  }
  assert.ok(introsRight >= 11, `reference detected right in ${introsRight}/12 runs`);
  assert.ok(good / total >= 0.9, `${good}/${total} phrases within 0.1 s`);
});

test('alignReading: reference said, then phrases run together — the text still starts after it', () => {
  // A reader who pauses only now and then (fewer pauses than phrases) used to
  // get the reference taken as phrase 1, putting every phrase seconds early.
  const phrases = ['Inilah riwayat Nuh', 'Nuh adalah seorang yang benar dan tidak bercela di antara orang-orang sezamannya',
    'dan Nuh itu hidup bergaul dengan Allah', 'Nuh memperanakkan tiga orang laki-laki', 'Sem, Ham dan Yafet',
    'Adapun bumi itu telah rusak di hadapan Allah', 'dan penuh dengan kekerasan', 'Allah menilik bumi itu',
    'dan sungguhlah rusak benar', 'sebab semua manusia menjalankan hidup yang rusak di bumi'];
  for (const refPause of [0.15, 0.3]) {
    let t = 2.0 + 2.8;
    const pauses = [[t, t + refPause]];
    t += refPause;
    const truth = [];
    phrases.forEach((p, i) => {
      truth.push(t);
      t += syllables(p) * 0.09;
      if (i < phrases.length - 1 && i % 2 === 1) { pauses.push([t, t + 0.35]); t += 0.35; }
    });
    const r = alignReading({ analysis: { v: ANALYSIS_VERSION, dur: t + 3, speech: [2.0, t], pauses }, phrases, introText: 'Kejadian 6:9-22' });
    assert.ok(r.intro, `reference found after a ${refPause}s pause`);
    r.units.forEach((u, i) => assert.ok(Math.abs(u.start - truth[i]) < 0.3, `phrase ${i + 1} at ${u.start.toFixed(2)}s, said at ${truth[i].toFixed(2)}s`));
  }
});

test('alignReading: no reference said, few pauses — no reference is invented', () => {
  const phrases = ['In the beginning', 'God created the heaven and the earth', 'And the earth was without form', 'and void', 'and darkness was upon the face of the deep', 'And the Spirit of God moved', 'upon the face of the waters'];
  for (const every of [2, 3]) {
    let t = 1.0;
    const pauses = [];
    const truth = [];
    phrases.forEach((p, i) => {
      truth.push(t);
      t += syllables(p) * 0.1;
      if (i < phrases.length - 1 && i % every === every - 1) { pauses.push([t, t + 0.3]); t += 0.3; }
    });
    const r = alignReading({ analysis: { v: ANALYSIS_VERSION, dur: t + 1, speech: [1.0, t], pauses }, phrases, introText: 'Genesis chapter 1, verses 1 to 2' });
    assert.equal(r.intro, null);
    assert.ok(Math.abs(r.units[0].start - truth[0]) < 0.05);
  }
});

// Nine verses as one reader recorded them: the reference first ("歌羅西書四章
// 第二節"), a pause of about a second, then the verse. `starts` is where the
// verse begins (checked against a transcription); speech and pauses are the
// measurements stored with the recordings. Three of them are one-line verses,
// where the reference is a third of the recording or more.
const READINGS = [
  { ref: "路 6:31", said: "路加福音第六章第三十一節", starts: 5.41, text: "你們願意人怎樣待你們，你們也要怎樣待人。",
    phrases: ['你們願意人怎樣待你們', '你們也要怎樣待人'],
    speech: [2.11, 9.66], pauses: [[4.48, 5.41], [7.43, 7.92]] },
  { ref: "詩 86:11", said: "詩篇第八十六篇第十一節", starts: 5.74, text: "耶和華啊，求你將你的道指教我；我要照你的真理行；求你使我專心敬畏你的名！",
    phrases: ['耶和華啊', '求你將你的道指教我', '我要照你的真理行', '求你使我專心敬畏你的名'],
    speech: [2.27, 15.67], pauses: [[4.52, 5.74], [6.47, 7.3], [9.21, 10.17], [11.76, 12.48], [13.35, 13.49], [14.19, 14.31], [14.9, 15.04]] },
  { ref: "西 4:2", said: "歌羅西書第四章第二節", starts: 5.5, text: "你們要恆切禱告，在此警醒感恩。",
    phrases: ['你們要恆切禱告', '在此警醒感恩'],
    speech: [2.53, 9.67], pauses: [[4.36, 5.5], [6.82, 6.97], [7.16, 7.6], [8.17, 8.35]] },
  { ref: "詩 119:105", said: "詩篇第一百十九篇第一百零五節", starts: 6.6, text: "你的話是我腳前的燈，是我路上的光。",
    phrases: ['你的話是我腳前的燈', '是我路上的光'],
    speech: [1.81, 10.19], pauses: [[2.48, 2.71], [3.17, 3.29], [4.28, 4.41], [5.57, 6.6], [8.51, 8.67], [9.02, 9.15]] },
  { ref: "詩 139:23-24", said: "詩篇第一百三十九篇第二十三至二十四節", starts: 6.51, text: "神啊，求你鑒察我，知道我的心思，試煉我，知道我的意念， 看在我裡面有什麼惡行沒有，引導我走永生的道路。",
    phrases: ['神啊', '求你鑒察我', '知道我的心思', '試煉我', '知道我的意念', '看在我裡面有什麼惡行沒有', '引導我走永生的道路'],
    speech: [1.59, 17.73], pauses: [[4.51, 4.65], [5.33, 6.51], [8.18, 8.32], [9.59, 10.66], [12.41, 13.03], [14.29, 14.43], [15.26, 15.55]] },
  { ref: "申 29:29", said: "申命記第二十九章第二十九節", starts: 5.15, text: "隱祕的事是屬耶和華──我們神的；惟有明顯的事是永遠屬我們和我們子孫的，好叫我們遵行這律法上的一切話。",
    phrases: ['隱祕的事是屬耶和華──我們神的', '惟有明顯的事是永遠屬我們和我們子孫的', '好叫我們遵行這律法上的一切話'],
    speech: [2.03, 16.39], pauses: [[4.25, 5.15], [7.95, 8.74], [12.48, 13.02], [15.62, 15.76], [15.87, 16.04]] },
  { ref: "彌 6:8", said: "彌迦書第六章第八節", starts: 3.47, text: "世人哪，耶和華已指示你何 為善。他向你所要的是 什麼呢？只要你行公義，好憐憫，存謙卑的心，與你的神同行。",
    phrases: ['世人哪', '耶和華已指示你何', '為善', '他向你所要的是', '什麼呢', '只要你行公義', '好憐憫', '存謙卑的心', '與你的神同行'],
    speech: [1.3, 15.31], pauses: [[2.7, 3.47], [4.15, 4.39], [6.81, 7.75], [9.33, 10.09], [12.17, 12.31], [13.69, 13.91]] },
  { ref: "雅 4:8", said: "雅各書第四章第八節", starts: 4.16, text: "你們親近神，神就必親近你們。有罪的人哪，要潔淨你們的手！心懷二意的人哪，要清潔你們的心！",
    phrases: ['你們親近神', '神就必親近你們', '有罪的人哪', '要潔淨你們的手', '心懷二意的人哪', '要清潔你們的心'],
    speech: [1.74, 14.89], pauses: [[3.4, 4.16], [5.26, 5.46], [7.01, 7.74], [8.78, 9.05], [10.81, 11.29], [12.7, 12.97]] },
  { ref: "代下 7:14", said: "歷代志下第七章第十四節", starts: 4.44, text: "這稱為我名下的子民，若是自卑、禱告，尋求我的面，轉離他們的惡行，我必從天上垂聽，赦免他們的罪，醫治他們的地。",
    phrases: ['這稱為我名下的子民', '若是自卑', '禱告', '尋求我的面', '轉離他們的惡行', '我必從天上垂聽', '赦免他們的罪', '醫治他們的地'],
    speech: [1.16, 16.95], pauses: [[3.28, 4.44], [6.4, 6.63], [7.58, 7.85], [9.39, 10.06], [11.66, 12.11], [13.81, 13.99], [15.36, 15.66]] },
];

test('alignReading: the reference is skipped in short verses too — real recordings', () => {
  for (const c of READINGS) {
    const analysis = { v: ANALYSIS_VERSION, dur: c.speech[1] + 0.5, speech: c.speech, pauses: c.pauses };
    const r = alignReading({ analysis, phrases: c.phrases, strengths: boundaryStrengths(c.text, c.phrases), introText: c.said });
    assert.ok(r.intro, `${c.ref}: reference found`);
    assert.ok(near(r.units[0].start, c.starts, 0.05), `${c.ref}: verse starts at ${r.units[0].start.toFixed(2)}s, read at ${c.starts}s`);
  }
});

test('alignReading: the same recordings without the reference — none is invented', () => {
  for (const c of READINGS) {
    const pauses = c.pauses.filter(p => p[0] > c.starts);
    const analysis = { v: ANALYSIS_VERSION, dur: c.speech[1] + 0.5, speech: [c.starts, c.speech[1]], pauses };
    const r = alignReading({ analysis, phrases: c.phrases, strengths: boundaryStrengths(c.text, c.phrases), introText: c.said });
    assert.equal(r.intro, null, `${c.ref}: no reference`);
    assert.ok(near(r.units[0].start, c.starts, 0.05), `${c.ref}: verse starts at ${r.units[0].start.toFixed(2)}s`);
  }
});

test('alignReading: phrases counted in a unit that is not syllables — the pace has no say', () => {
  // Weights of 1 per phrase (as for a script syllables() cannot count) put the
  // "pace" far outside what anyone reads at; the fit must not lean on it.
  const c = READINGS.find(x => x.ref === '詩 86:11');
  const analysis = { v: ANALYSIS_VERSION, dur: c.speech[1] + 0.5, speech: c.speech, pauses: c.pauses };
  const r = alignReading({ analysis, phrases: ['א', 'ב', 'ג', 'ד'], strengths: boundaryStrengths(c.text, c.phrases), introText: c.said });
  assert.ok(Number.isFinite(r.cost));
  assert.equal(r.units.length, 4);
});
