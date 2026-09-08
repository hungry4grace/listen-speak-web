# 聽&說 Listen&Speak

雙語「聽、跟著說、背起來」學習平台。內建《唐詩三百首》，任何人都可以放進自己喜歡的好文：中英對照、一段一段，並用自己的聲音錄下來分享。

A bilingual listen / repeat / memorise app. Ships with the 300 Tang Poems; anyone can add their own text — Chinese and English side by side, paragraph by paragraph, in their own voice.

- 正式站 / Live: https://listen-speak-web.vercel.app
- 後端 / Backend: PartyKit `listenspeak-party` (`src/party/server.js`)
- 由 [VerseRain 經文雨](https://github.com/hungry4grace/verserain-web) 衍生 / derived from VerseRain

## 五種語言 Five languages

繁體中文 · 简体中文 · 繁體與注音符號 · 简体与罗马拼音 · English

Content is stored as Traditional Chinese + English per paragraph; Simplified is generated with opencc-js, Bopomofo / Pinyin with pinyin-pro (`src/lib/annotate.js`).

## 開發 Development

```bash
npm install
npx vite --port 5181          # web app
npx partykit dev --port 1999  # backend (then set localStorage.ls_party_host = 'http://127.0.0.1:1999')
```

- Build: `npm run build`
- Tests: `node --test src/lib/*.test.mjs`
- Deploy backend: `npx partykit deploy`
- Deploy web: push to `main` (Vercel project `listen-speak-web`)
- Regenerate the Tang poems pack: `node scripts/import-tang-poems.mjs scratch/tang300.json scratch/tang300-translations.json`
