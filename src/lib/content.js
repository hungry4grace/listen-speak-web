// 聽&說 bilingual content model.
//
// An item (still called a "verse" throughout the app for compatibility) is
//   { reference: <label>, text: <zh-TW>, textEn: <en>, textCn?: <zh-CN cache> }
// Every set is bilingual; the viewer's language decides which side becomes
// `text` for the player/games (`localizeSet`), and the other side is the
// "second language" line. Simplified Chinese is derived from Traditional
// (opencc-js), cached on the item when the author saves.
import { baseLang } from './lang.js';

export const itemZh = (v) => String(v?.textZh ?? v?.text ?? '');
export const itemEn = (v) => String(v?.textEn ?? '');

let toSimplified = null;
export function setSimplifiedConverter(fn) { toSimplified = fn; }
export function hasSimplifiedConverter() { return !!toSimplified; }
export function toCn(text) { return toSimplified ? toSimplified(String(text || '')) : String(text || ''); }

export function pickText(v, lang) {
  const b = baseLang(lang);
  if (b === 'en') return itemEn(v) || itemZh(v);
  if (b === 'cuvs') return v?.textCn || toCn(itemZh(v));
  return itemZh(v);
}

export function isBilingualItem(v) { return v && (v.textEn !== undefined || v.textZh !== undefined); }

// Present a stored set in the viewer's language. Keeps the original sides on
// each item (textZh / textEn) so the editor and the second-language line can
// still reach them.
export function localizeSet(set, lang) {
  if (!set || !Array.isArray(set.verses)) return set;
  return { ...set, verses: set.verses.map(v => ({ ...v, textZh: itemZh(v), textEn: itemEn(v), text: pickText(v, lang) })) };
}

// Paste-import helper: paragraphs separated by blank lines, else one per line.
export function splitParagraphs(raw) {
  const s = String(raw || '').replace(/\r/g, '');
  const parts = /\n\s*\n/.test(s) ? s.split(/\n\s*\n+/) : s.split(/\n/);
  return parts.map(p => p.trim()).filter(Boolean);
}

export function defaultLabel(i, sourceLang) {
  return sourceLang === 'en' ? `Part ${i + 1}` : `第 ${i + 1} 段`;
}

// Normalise rows before saving: trim, default + de-duplicate labels (labels
// key the recordings and comments, so they must be unique within a set).
export function normalizeItemsForSave(items, sourceLang) {
  const seen = new Set();
  return items
    .map(v => ({ reference: String(v.reference || '').trim(), text: itemZh(v).trim(), textEn: itemEn(v).trim(), textCn: v.textCn }))
    .filter(v => v.text || v.textEn)
    .map((v, i) => {
      let label = v.reference || defaultLabel(i, sourceLang);
      let n = 2; const base = label;
      while (seen.has(label)) label = `${base} (${n++})`;
      seen.add(label);
      const textCn = v.textCn && v.textCn !== v.text ? v.textCn : (toSimplified ? toSimplified(v.text) : undefined);
      return textCn ? { reference: label, text: v.text, textEn: v.textEn, textCn } : { reference: label, text: v.text, textEn: v.textEn };
    });
}
