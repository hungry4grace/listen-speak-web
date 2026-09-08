import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandSameChapterRefs } from './expandSameChapterRefs.js';

// 只認得幾個中文書卷名的假比對器，形狀與 App.jsx 的 matchBookInLine 相同
const BOOKS = ['約翰福音', '創世記', '詩篇', '以弗所書'];
const matchBook = (tok) => {
  for (const name of BOOKS) {
    if (tok.startsWith(name)) {
      const rest = tok.slice(name.length).trim();
      if (/^\d/.test(rest)) return { name, rest };
    }
  }
  return null;
};
const split = (raw) => raw.split(/[\n,，、]+/).map(s => s.trim()).filter(Boolean);

test('逗號後的純節數承接前一個出處的書卷與章', () => {
  assert.deepEqual(expandSameChapterRefs(split('約翰福音 1:1, 4'), matchBook),
    ['約翰福音 1:1', '約翰福音 1:4']);
});

test('全形逗號、頓號、多個節數都可以', () => {
  assert.deepEqual(expandSameChapterRefs(split('約翰福音 1:1，4、14'), matchBook),
    ['約翰福音 1:1', '約翰福音 1:4', '約翰福音 1:14']);
});

test('節數範圍也承接（含 en-dash）', () => {
  assert.deepEqual(expandSameChapterRefs(split('詩篇 139:13–14, 16, 23-24'), matchBook),
    ['詩篇 139:13–14', '詩篇 139:16', '詩篇 139:23-24']);
});

test('章:節 只承接書卷，並更新目前章', () => {
  assert.deepEqual(expandSameChapterRefs(split('創世記 1:26-28, 2:7, 9'), matchBook),
    ['創世記 1:26-28', '創世記 2:7', '創世記 2:9']);
});

test('換行後的新出處會重設承接對象', () => {
  assert.deepEqual(expandSameChapterRefs(split('約翰福音 1:1, 4\n以弗所書 2:10, 8'), matchBook),
    ['約翰福音 1:1', '約翰福音 1:4', '以弗所書 2:10', '以弗所書 2:8']);
});

test('沒有前一個出處時，孤立的數字原樣送回（交給失敗清單）', () => {
  assert.deepEqual(expandSameChapterRefs(split('4, 約翰福音 3:16'), matchBook),
    ['4', '約翰福音 3:16']);
});

test('辨識不到的書卷名不受影響，也不會被承接', () => {
  assert.deepEqual(expandSameChapterRefs(split('約翰福音 1:1, 不存在 2:3'), matchBook),
    ['約翰福音 1:1', '不存在 2:3']);
});

test('整章出處（沒有冒號）後面的數字視為該章的節', () => {
  // 「詩篇 23」的章是 23，後面的「4」接成 23:4
  assert.deepEqual(expandSameChapterRefs(split('詩篇 23, 4'), matchBook),
    ['詩篇 23', '詩篇 23:4']);
});
