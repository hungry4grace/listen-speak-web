// 小小手 — a pointing hand follows the character (Chinese) or word (English)
// being read aloud in the listen player. Every 聽&說 language supports it.
// The listener's own choice (播放方式): '1' on, '0' off, null = never chose.
const KEY = 'verseRainReadHand';
export function readReadHandChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}
export function saveReadHandChoice(on) {
  const v = on ? '1' : '0';
  try { localStorage.setItem(KEY, v); } catch { /* the in-memory choice still works */ }
  return v;
}
// On in every language until the listener turns it off.
export function readHandOn(choice) {
  return choice !== '0';
}
