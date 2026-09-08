import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createT, resolveUiLang, SPEECH_LANG } from './i18n';

// Fallback when the resolved UI language has no BCP-47 tag we know about.
const DEFAULT_SPEECH_LANG = 'zh-TW';

function loadSpeechVoices() {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    const handleVoicesChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 700);
  });
}

function speak(text, lang = DEFAULT_SPEECH_LANG, rate = 0.92) {
  return new Promise(async resolve => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;

    try {
      const savedVoiceName = localStorage.getItem('verseRain_voiceName');
      if (savedVoiceName) {
        const voices = await loadSpeechVoices();
        const langPrefix = String(lang).split('-')[0].toLowerCase();
        // Only honour the saved voice when it speaks the language we are about
        // to read out — otherwise a Korean prompt would come out in a zh voice.
        const preferredVoice = voices.find(voice => (
          voice.name === savedVoiceName && String(voice.lang || '').toLowerCase().startsWith(langPrefix)
        ));
        if (preferredVoice) {
          utterance.voice = preferredVoice;
          utterance.lang = preferredVoice.lang || lang;
        }
      }
    } catch {
      // Keep system default when localStorage or voices are unavailable.
    }

    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text) {
  return String(text || '').replace(/[^\w\u4e00-\u9fff]/g, '').toLowerCase();
}

function scoreMatch(target, heard) {
  // NB: `cleanTarget`, not `t` — `t` is the translation function everywhere else
  // in this file, and shadowing it here would be a trap.
  const cleanTarget = cleanText(target);
  const h = cleanText(heard);
  if (!cleanTarget || !h) return 0;
  if (h.includes(cleanTarget) || cleanTarget.includes(h)) return Math.min(100, Math.round((Math.min(cleanTarget.length, h.length) / cleanTarget.length) * 100));
  let matched = 0;
  let cursor = 0;
  for (const char of cleanTarget) {
    const found = h.indexOf(char, cursor);
    if (found !== -1) {
      matched += 1;
      cursor = found + 1;
    }
  }
  return Math.round((matched / cleanTarget.length) * 100);
}

function pickVerses(set, count) {
  const verses = [...(set?.verses || [])];
  return verses.sort(() => 0.5 - Math.random()).slice(0, Math.min(count, verses.length));
}

function formatReferenceForSpeech(reference, t) {
  const match = String(reference || '').match(/^(.+?)\s*(\d+)(?::([\d,\s\-–]+))?$/);
  if (!match) return reference || '';
  const [, book, chapter, verses] = match;
  if (!verses) {
    return t('{book}第{chapter}章', '{book} chapter {chapter}')
      .replace('{book}', book)
      .replace('{chapter}', chapter);
  }
  // Strip whitespace first, then swap the dashes for the spoken range word —
  // the connector may itself contain spaces (e.g. English " to ").
  const spokenVerses = verses.replace(/\s+/g, '').replace(/[-–]/g, t('至', ' to '));
  return t('{book}第{chapter}章{verses}節', '{book} chapter {chapter} verse {verses}')
    .replace('{book}', book)
    .replace('{chapter}', chapter)
    .replace('{verses}', spokenVerses);
}

export default function BlindScriptureApp() {
  // /blind is its own React root, so it never receives App.jsx's `t` prop —
  // resolve the language and build our own translator here instead.
  const uiLang = useMemo(() => resolveUiLang(), []);
  const t = useMemo(() => createT(uiLang), [uiLang]);
  const speechLang = SPEECH_LANG[uiLang] || DEFAULT_SPEECH_LANG;
  const say = useMemo(() => (text, rate) => speak(text, speechLang, rate), [speechLang]);

  const [sets, setSets] = useState([]);
  const [setId, setSetId] = useState(sets[0]?.id || '');
  const [count, setCount] = useState(3);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [screen, setScreen] = useState('home');
  const [status, setStatus] = useState(() => t('歡迎使用視障經文遊戲。', 'Welcome to the accessible Scripture game.'));
  const [transcript, setTranscript] = useState('');
  const [accuracy, setAccuracy] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const liveRef = useRef(null);

  const selectedSet = useMemo(() => sets.find(set => set.id === setId) || sets[0], [sets, setId]);
  const currentVerse = queue[index];
  const hasSpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  const announce = (message, shouldSpeak = true) => {
    setStatus(message);
    if (liveRef.current) liveRef.current.textContent = message;
    if (shouldSpeak) say(message);
  };

  useEffect(() => {
    let mounted = true;
    import('./verses').then(module => {
      if (!mounted) return;
      const nextSets = (module.VERSE_SETS || []).filter(set => set?.verses?.length);
      setSets(nextSets);
      setSetId(current => current || nextSets[0]?.id || '');
    });
    return () => { mounted = false; };
  }, []);

  const stopListening = () => {
    setIsListening(false);
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  };

  const startListening = () => {
    if (!currentVerse) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      announce(t(
        '這個瀏覽器不支援語音辨識。你仍然可以使用重聽、聽答案、自己判斷答對，繼續玩。',
        'This browser does not support speech recognition. You can still play using replay, hear the answer, and marking yourself correct.'
      ));
      return;
    }

    stopListening();
    const recognition = new SpeechRecognition();
    recognition.lang = speechLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
      setAccuracy(0);
      setStatus(t('正在聆聽。請開始背誦。', 'Listening. Please begin reciting.'));
    };
    recognition.onresult = (event) => {
      let heard = '';
      for (let i = 0; i < event.results.length; i += 1) {
        heard += event.results[i][0].transcript;
      }
      const nextAccuracy = scoreMatch(currentVerse.text, heard);
      setTranscript(heard);
      setAccuracy(nextAccuracy);
      if (nextAccuracy >= 80) {
        stopListening();
        setCorrectCount(value => value + 1);
        announce(
          t('答對了。相似度 {score}%。按 N 進入下一節。', 'Correct. Similarity {score}%. Press N for the next verse.')
            .replace('{score}', String(nextAccuracy))
        );
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
      announce(t(
        '麥克風或語音辨識遇到問題。可以按 A 聽答案，或按 C 自己標記答對。',
        'There was a problem with the microphone or speech recognition. Press A to hear the answer, or C to mark yourself correct.'
      ));
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const introduceVerse = async (verse = currentVerse) => {
    if (!verse) return;
    stopListening();
    setTranscript('');
    setAccuracy(0);
    const spokenReference = formatReferenceForSpeech(verse.reference, t);
    setStatus(
      t('第 {n} 節，{reference}。', 'Verse {n}. {reference}.')
        .replace('{n}', String(index + 1))
        .replace('{reference}', spokenReference)
    );
    await say(
      t('第 {n} 節。{reference}', 'Verse {n}. {reference}')
        .replace('{n}', String(index + 1))
        .replace('{reference}', spokenReference)
    );
    await wait(2000);
    await say(t('請背誦。準備好後，按空白鍵開始聆聽。', 'Please recite. When you are ready, press the space bar to start listening.'));
  };

  const startGame = async () => {
    const nextQueue = pickVerses(selectedSet, Math.max(1, parseInt(count) || 1));
    setQueue(nextQueue);
    setIndex(0);
    setCorrectCount(0);
    setScreen('playing');
    setTranscript('');
    setAccuracy(0);
    await wait(100);
    await say(
      t('開始。{title}。共 {count} 節。', 'Starting. {title}. {count} verses in total.')
        .replace('{title}', selectedSet.title)
        .replace('{count}', String(nextQueue.length))
    );
    await wait(500);
    introduceVerse(nextQueue[0]);
  };

  const nextVerse = async () => {
    stopListening();
    if (index + 1 >= queue.length) {
      setScreen('done');
      announce(
        t(
          '完成了。本次答對 {correct} 節，共 {total} 節。願神的話豐豐富富住在你心裡。',
          'All done. You recited {correct} of {total} verses correctly. May the word of God dwell in you richly.'
        )
          .replace('{correct}', String(correctCount))
          .replace('{total}', String(queue.length))
      );
      return;
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setTranscript('');
    setAccuracy(0);
    await wait(100);
    introduceVerse(queue[nextIndex]);
  };

  const readHelp = () => {
    say(t(
      '操作說明。按 Enter 開始遊戲。遊戲中按空白鍵開始或停止聆聽。按 R 重聽經文出處。按 A 聽完整答案。按 C 自己標記答對。按 N 下一節。按 Escape 回首頁。',
      'Instructions. Press Enter to start the game. During the game, press the space bar to start or stop listening. Press R to hear the reference again. Press A to hear the full answer. Press C to mark yourself correct. Press N for the next verse. Press Escape to return home.'
    ));
  };

  const markCorrect = () => {
    stopListening();
    setCorrectCount(value => value + 1);
    announce(t('已標記答對。按 N 進入下一節。', 'Marked correct. Press N for the next verse.'));
  };

  useEffect(() => {
    const handler = (event) => {
      const key = event.key.toLowerCase();
      if (screen === 'home') {
        if (event.key === 'Enter') startGame();
        if (key === 'h') readHelp();
        return;
      }
      if (event.key === 'Escape') {
        stopListening();
        setScreen('home');
        announce(t('已回到首頁。', 'Back to the home screen.'), false);
      } else if (event.key === ' ') {
        event.preventDefault();
        if (isListening) stopListening();
        else startListening();
      } else if (key === 'r') {
        introduceVerse();
      } else if (key === 'a') {
        stopListening();
        say(
          t('{reference}。{text}', '{reference}. {text}')
            .replace('{reference}', formatReferenceForSpeech(currentVerse?.reference, t))
            .replace('{text}', currentVerse?.text || '')
        );
      } else if (key === 'c') {
        markCorrect();
      } else if (key === 'n') {
        nextVerse();
      } else if (key === 'h') {
        readHelp();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, selectedSet, count, queue, index, currentVerse, isListening, correctCount]);

  useEffect(() => () => {
    stopListening();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const pageStyle = {
    width: '100vw',
    height: '100dvh',
    overflowY: 'auto',
    background: '#000',
    color: '#fff',
    fontFamily: 'var(--app-font-family)',
    padding: 'clamp(1rem, 4vw, 3rem)'
  };
  const panelStyle = {
    maxWidth: '920px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem'
  };
  const buttonStyle = {
    width: '100%',
    border: '4px solid #facc15',
    borderRadius: '10px',
    padding: '1.2rem',
    background: '#facc15',
    color: '#000',
    fontSize: '1.35rem',
    fontWeight: 900,
    cursor: 'pointer'
  };
  const secondaryButtonStyle = {
    ...buttonStyle,
    background: '#111827',
    color: '#fff',
    borderColor: '#93c5fd'
  };
  const maxVerseCount = Math.max(1, selectedSet?.verses?.length || 1);
  const currentCount = Math.min(maxVerseCount, Math.max(1, parseInt(count) || 1));
  const setClampedCount = (nextCount) => {
    setCount(Math.min(maxVerseCount, Math.max(1, parseInt(nextCount) || 1)));
  };
  const stepButtonStyle = {
    minHeight: '72px',
    minWidth: '72px',
    border: '4px solid #facc15',
    borderRadius: '12px',
    background: '#facc15',
    color: '#000',
    fontSize: '2.4rem',
    fontWeight: 900,
    cursor: 'pointer',
    lineHeight: 1
  };

  if (!sets.length) {
    return (
      <main style={pageStyle} aria-busy="true" aria-live="polite">
        <section style={panelStyle}>
          <h1 style={{ fontSize: 'clamp(2.4rem, 8vw, 5rem)', margin: 0 }}>{t('正在載入中文經文', 'Loading verses')}</h1>
          <p style={{ fontSize: '1.35rem', lineHeight: 1.8 }}>{t('請稍候。', 'Please wait.')}</p>
        </section>
      </main>
    );
  }

  return (
    <main style={pageStyle} aria-label={t('視障經文遊戲', 'Accessible Scripture game')}>
      <div ref={liveRef} aria-live="assertive" aria-atomic="true" style={{ position: 'absolute', left: '-9999px' }} />

      {screen === 'home' && (
        <section style={panelStyle}>
          <p style={{ color: '#facc15', fontWeight: 900, fontSize: '1.1rem', margin: 0 }}>{t('VerseRain 視障版', 'VerseRain Accessible Edition')}</p>
          <h1 style={{ fontSize: 'clamp(2.4rem, 8vw, 5rem)', lineHeight: 1.05, margin: 0 }}>{t('中文經文聽背遊戲', 'Listen-and-recite Scripture game')}</h1>
          <p style={{ fontSize: '1.35rem', lineHeight: 1.8, color: '#e5e7eb', margin: 0 }}>
            {t(
              '這是一個為視障朋友預備的簡化版。沒有排行榜、沒有動畫、沒有地圖、沒有園子。只聽經文、背經文、進入下一節。',
              'This is a simplified edition made for blind and low-vision friends. No leaderboard, no animation, no map, no garden. Just listen to the verse, recite it, and move on to the next one.'
            )}
          </p>

          <label style={{ fontSize: '1.2rem', fontWeight: 800 }}>
            {t('選擇經文組', 'Choose a verse set')}
            <select value={setId} onChange={(e) => setSetId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: '0.5rem', padding: '1rem', fontSize: '1.2rem', background: '#111827', color: '#fff', border: '3px solid #facc15', borderRadius: '8px' }}>
              {sets.map(set => (
                <option key={set.id} value={set.id}>
                  {t('{title}，{count} 節', '{title} — {count} verses')
                    .replace('{title}', set.title)
                    .replace('{count}', String(set.verses.length))}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: '1.2rem', fontWeight: 800 }}>
            {t('本次經文數量', 'How many verses this round')}
            <div
              role="group"
              aria-label={t('調整本次經文數量', 'Adjust how many verses this round')}
              style={{ display: 'grid', gridTemplateColumns: '88px 1fr 88px', gap: '0.8rem', alignItems: 'stretch', marginTop: '0.5rem' }}
            >
              <button
                type="button"
                onClick={() => setClampedCount(currentCount - 1)}
                aria-label={t('減少一節經文', 'One verse fewer')}
                style={stepButtonStyle}
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min="1"
                max={maxVerseCount}
                value={currentCount}
                onChange={(e) => setClampedCount(e.target.value)}
                aria-label={t('本次經文數量', 'How many verses this round')}
                style={{ width: '100%', minHeight: '72px', padding: '0 1rem', textAlign: 'center', fontSize: '2rem', background: '#111827', color: '#fff', border: '4px solid #facc15', borderRadius: '12px', fontWeight: 900 }}
              />
              <button
                type="button"
                onClick={() => setClampedCount(currentCount + 1)}
                aria-label={t('增加一節經文', 'One more verse')}
                style={stepButtonStyle}
              >
                +
              </button>
            </div>
            <span style={{ display: 'block', marginTop: '0.45rem', color: '#d1d5db', fontSize: '0.95rem', fontWeight: 700 }}>
              {t('可選 1 至 {max} 節', 'Choose from 1 to {max} verses').replace('{max}', String(maxVerseCount))}
            </span>
          </label>

          <button onClick={startGame} style={buttonStyle}>{t('開始遊戲，Enter', 'Start the game, Enter')}</button>
          <button onClick={readHelp} style={secondaryButtonStyle}>{t('聽操作說明，H', 'Hear the instructions, H')}</button>

          <div style={{ background: '#111827', border: '2px solid #374151', borderRadius: '10px', padding: '1rem', fontSize: '1.05rem', lineHeight: 1.8 }}>
            <strong>{t('快捷鍵：', 'Shortcuts:')}</strong>{' '}
            {t(
              'Enter 開始。空白鍵聆聽。R 重聽出處。A 聽答案。C 標記答對。N 下一節。Esc 回首頁。',
              'Enter starts. Space listens. R repeats the reference. A hears the answer. C marks it correct. N goes to the next verse. Esc returns home.'
            )}
          </div>

          {!hasSpeechRecognition && (
            <div role="alert" style={{ background: '#451a03', border: '3px solid #f97316', borderRadius: '10px', padding: '1rem', fontSize: '1.1rem', lineHeight: 1.7 }}>
              {t(
                '你的瀏覽器可能不支援語音辨識。建議使用 Chrome。仍可用聽答案與自行標記答對來遊玩。',
                'Your browser may not support speech recognition. Chrome is recommended. You can still play by hearing the answer and marking yourself correct.'
              )}
            </div>
          )}
        </section>
      )}

      {screen === 'playing' && currentVerse && (
        <section style={panelStyle}>
          <p style={{ color: '#facc15', fontWeight: 900, fontSize: '1.2rem', margin: 0 }}>
            {t('第 {n} / {total} 節', 'Verse {n} of {total}')
              .replace('{n}', String(index + 1))
              .replace('{total}', String(queue.length))}
          </p>
          <h1
            aria-label={formatReferenceForSpeech(currentVerse.reference, t)}
            style={{ fontSize: 'clamp(2rem, 7vw, 4rem)', margin: 0 }}
          >
            {currentVerse.reference}
          </h1>
          <p style={{ fontSize: '1.25rem', lineHeight: 1.8, color: '#e5e7eb', margin: 0 }}>{status}</p>

          <button onClick={isListening ? stopListening : startListening} style={buttonStyle}>
            {isListening ? t('停止聆聽，空白鍵', 'Stop listening, Space') : t('開始聆聽，空白鍵', 'Start listening, Space')}
          </button>
          <button onClick={() => introduceVerse()} style={secondaryButtonStyle}>{t('重聽出處與提示，R', 'Hear the reference and prompt again, R')}</button>
          <button
            onClick={() => say(
              t('{reference}。{text}', '{reference}. {text}')
                .replace('{reference}', formatReferenceForSpeech(currentVerse.reference, t))
                .replace('{text}', currentVerse.text)
            )}
            style={secondaryButtonStyle}
          >
            {t('聽完整答案，A', 'Hear the full answer, A')}
          </button>
          <button onClick={markCorrect} style={secondaryButtonStyle}>{t('我背對了，C', 'I recited it correctly, C')}</button>
          <button onClick={nextVerse} style={buttonStyle}>{t('下一節，N', 'Next verse, N')}</button>

          <div aria-live="polite" style={{ background: '#111827', border: '2px solid #374151', borderRadius: '10px', padding: '1rem', fontSize: '1.1rem', lineHeight: 1.8 }}>
            <div>
              {t('聽到的內容：{text}', 'Heard: {text}')
                .replace('{text}', transcript || t('尚未聽到', 'nothing yet'))}
            </div>
            <div>{t('相似度：{score}%', 'Similarity: {score}%').replace('{score}', String(accuracy))}</div>
            <div>{t('已答對：{count} 節', 'Correct so far: {count}').replace('{count}', String(correctCount))}</div>
          </div>
        </section>
      )}

      {screen === 'done' && (
        <section style={panelStyle}>
          <h1 style={{ fontSize: 'clamp(2.4rem, 8vw, 5rem)', margin: 0 }}>{t('完成了', 'All done')}</h1>
          <p style={{ fontSize: '1.5rem', lineHeight: 1.8 }}>
            {t('本次答對 {correct} 節，共 {total} 節。', 'You recited {correct} of {total} verses correctly.')
              .replace('{correct}', String(correctCount))
              .replace('{total}', String(queue.length))}
          </p>
          <button onClick={() => setScreen('home')} style={buttonStyle}>{t('回首頁', 'Back to home')}</button>
          <button onClick={startGame} style={secondaryButtonStyle}>{t('再玩一次', 'Play again')}</button>
        </section>
      )}
    </main>
  );
}
