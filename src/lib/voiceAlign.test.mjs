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
