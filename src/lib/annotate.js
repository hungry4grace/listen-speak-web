// 注音 / 拼音 annotation for Chinese text (聽&說 languages `cuv-bpmf` and
// `cuvs-pinyin`). pinyin-pro (MIT) resolves readings — including most
// heteronyms from context — and is loaded lazily the first time an annotated
// language is active; until then text renders plain. Bopomofo is derived from
// the numbered pinyin syllable with the standard 37-symbol table below.
let mod = null;
let loading = null;
const listeners = new Set();

export function isAnnotatorReady() { return !!mod; }
export function loadAnnotator() {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    loading = import('pinyin-pro').then((m) => {
      mod = m;
      listeners.forEach((fn) => { try { fn(); } catch { /* noop */ } });
      return m;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
export function onAnnotatorReady(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const INITIALS = { b: 'ㄅ', p: 'ㄆ', m: 'ㄇ', f: 'ㄈ', d: 'ㄉ', t: 'ㄊ', n: 'ㄋ', l: 'ㄌ', g: 'ㄍ', k: 'ㄎ', h: 'ㄏ', j: 'ㄐ', q: 'ㄑ', x: 'ㄒ', zh: 'ㄓ', ch: 'ㄔ', sh: 'ㄕ', r: 'ㄖ', z: 'ㄗ', c: 'ㄘ', s: 'ㄙ' };
const FINALS = {
  a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ê: 'ㄝ', ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ', an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', er: 'ㄦ', ong: 'ㄨㄥ',
  i: 'ㄧ', ia: 'ㄧㄚ', ie: 'ㄧㄝ', iao: 'ㄧㄠ', iu: 'ㄧㄡ', iou: 'ㄧㄡ', ian: 'ㄧㄢ', in: 'ㄧㄣ', iang: 'ㄧㄤ', ing: 'ㄧㄥ', iong: 'ㄩㄥ',
  u: 'ㄨ', ua: 'ㄨㄚ', uo: 'ㄨㄛ', uai: 'ㄨㄞ', ui: 'ㄨㄟ', uei: 'ㄨㄟ', uan: 'ㄨㄢ', un: 'ㄨㄣ', uen: 'ㄨㄣ', uang: 'ㄨㄤ', ueng: 'ㄨㄥ',
  'ü': 'ㄩ', 'üe': 'ㄩㄝ', 'üan': 'ㄩㄢ', 'ün': 'ㄩㄣ',
};
const Y_MAP = { yi: 'i', ya: 'ia', ye: 'ie', yao: 'iao', you: 'iu', yan: 'ian', yin: 'in', yang: 'iang', ying: 'ing', yong: 'iong', yu: 'ü', yue: 'üe', yuan: 'üan', yun: 'ün' };
const W_MAP = { wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'ui', wan: 'uan', wen: 'un', wang: 'uang', weng: 'ueng' };
const TONES = ['', '', 'ˊ', 'ˇ', 'ˋ'];

// "chuang2" → "ㄔㄨㄤˊ"; "de0" → "˙ㄉㄜ"; returns '' for anything unparseable.
export function pinyinNumToZhuyin(syl) {
  const m = String(syl || '').toLowerCase().replace(/v/g, 'ü').match(/^([a-zü]+)([0-5])?$/);
  if (!m) return '';
  let body = m[1];
  const tone = Number(m[2] ?? 0);
  let initial = '';
  for (const cand of ['zh', 'ch', 'sh']) if (body.startsWith(cand)) { initial = cand; break; }
  if (!initial && INITIALS[body[0]] && body.length > 1) initial = body[0];
  let fin = body.slice(initial.length);
  if (!initial) {
    if (Y_MAP[fin]) fin = Y_MAP[fin];
    else if (W_MAP[fin]) fin = W_MAP[fin];
  } else if ('jqx'.includes(initial) && fin.startsWith('u')) {
    fin = 'ü' + fin.slice(1);
  }
  let out = INITIALS[initial] || '';
  if (['zh', 'ch', 'sh', 'r', 'z', 'c', 's'].includes(initial) && fin === 'i') {
    // zhi/chi/shi/ri/zi/ci/si: the initial alone carries the syllable.
  } else {
    const f = FINALS[fin];
    if (f === undefined) return '';
    out += f;
  }
  if (tone === 0 || tone === 5) return '˙' + out;
  return out + (TONES[tone] || '');
}

const CJK = /[㐀-鿿豈-﫿]/;

// Split text into display tokens: { ch, rt } — rt is the pinyin (with tone
// marks) or zhuyin for CJK characters, '' for everything else.
export function annotateText(text, mode) {
  const s = String(text || '');
  if (!mod || !mode || !s) return null;
  try {
    const all = mod.pinyin(s, { type: 'all', toneType: 'symbol', nonZh: 'consecutive' });
    const num = mode === 'bpmf' ? mod.pinyin(s, { type: 'all', toneType: 'num', nonZh: 'consecutive' }) : null;
    const tokens = [];
    all.forEach((t, i) => {
      const origin = t.origin;
      if (!t.isZh || !CJK.test(origin)) { tokens.push({ ch: origin, rt: '' }); return; }
      const rt = mode === 'bpmf' ? pinyinNumToZhuyin(num?.[i]?.pinyin || '') : (t.pinyin || '');
      tokens.push({ ch: origin, rt });
    });
    return tokens;
  } catch {
    return null;
  }
}
