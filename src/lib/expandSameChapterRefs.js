// 批次匯入出處時的「同章承接」：
//   約翰福音 1:1, 4        → 約翰福音 1:1、約翰福音 1:4
//   詩篇 139:13-14, 16     → 詩篇 139:13-14、詩篇 139:16
//   創世記 1:26-28, 2:7    → 創世記 1:26-28、創世記 2:7   （只有章:節 → 承接書卷）
// 逗號本來就是分隔符，所以「1:1, 4」切開後的「4」沒有書卷也沒有章；這裡把它接回前一個
// 完整出處的書卷與章。只有「純節數 / 節數範圍」或「章:節」形狀的片段才會被承接，其他文字
// （包含辨識不到的書卷名）原樣送回，讓後面的失敗清單照常列出。
//
// tokens:    已用換行/逗號/頓號切開並 trim 過的片段
// matchBook: (token) => { name, rest } | null   — rest 是書卷名後面的 "章:節" 字串
const VERSE_ONLY = /^\d+(?:\s*[-–—~～]\s*\d+)?$/;            // 4 / 13-14
const CHAPTER_VERSE = /^\d+\s*[:：]\s*\d+(?:\s*[-–—~～]\s*\d+)?$/; // 2:7 / 3:16-18

export function expandSameChapterRefs(tokens, matchBook) {
  const out = [];
  let last = null; // { name, chapter }
  for (const raw of tokens) {
    const tok = String(raw).trim();
    if (!tok) continue;
    const m = matchBook(tok);
    if (m) {
      const chapter = (String(m.rest).match(/^(\d+)/) || [])[1] || null;
      last = { name: m.name, chapter };
      out.push(tok);
      continue;
    }
    const compact = tok.replace(/\s+/g, '');
    if (last && last.chapter && VERSE_ONLY.test(tok)) {
      out.push(`${last.name} ${last.chapter}:${compact}`);
      continue;
    }
    if (last && CHAPTER_VERSE.test(tok)) {
      out.push(`${last.name} ${compact}`);
      last = { name: last.name, chapter: compact.split(/[:：]/)[0] };
      continue;
    }
    out.push(tok);
  }
  return out;
}
