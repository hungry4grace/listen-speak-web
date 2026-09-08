import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Heart, Zap, XCircle } from 'lucide-react';
import { planReadback } from './lib/voiceReadback.js';
import { prepareTarget, scoreBestCandidate, PASS_THRESHOLD } from './lib/recitationMatch.js';
import { getSpeechLangForVersion } from './lib/speechLang.js';

const REFERENCE_TO_RECITE_PAUSE_MS = 4000;
const FINAL_BLOCK_REVIEW_MS = 3000;

export default function BlindModeGame({
    activeVerse,
    activePhrases,
    currentSeqIndex,
    onWordMatch,
    onWordMiss,
    playDing,
    version,
    t,
    onFail,
    speakText,
    formatVerseReferenceForSpeech,
    formatVerseReferenceForDisplay,
    isDebugMode,
    skipReadback,
    playMode,
    health,
    timeLeft,
    score,
    combo,
    onResumeTimer
}) {
    const [micStatus, setMicStatus] = useState(t("初始化中...", "Initializing..."));
    const [heardText, setHeardText] = useState("");
    const [isMicReady, setIsMicReady] = useState(false);
    const [currentAccuracy, setCurrentAccuracy] = useState(0);
    const [isSuccessFlash, setIsSuccessFlash] = useState(false);
    const [missCount, setMissCount] = useState(0);
    const [missedIndices, setMissedIndices] = useState([]);
    const [countdown, setCountdown] = useState(null); // visual countdown
    // 預備…3…2…1…開始 shown during the silent gap between the spoken verse
    // reference and the ding. The gap already existed (4 s) but showed
    // nothing, so players could not tell whether it was their turn yet.
    // null = hidden | 'ready' | 3 | 2 | 1 | 'go'
    const [readyPhase, setReadyPhase] = useState(null);
    const readyTimersRef = useRef([]);
    const recognitionRef = useRef(null);
    const timerRef = useRef(null);
    const countdownRef = useRef(null);
    const isSuccessFlashRef = useRef(false);
    const missCountRef = useRef(0);
    const missedIndicesRef = useRef([]);
    const isMountedRef = useRef(true);
    const lastMatchedIndexRef = useRef(-1);
    const lastMatchedLengthRef = useRef(0);
    const latestTranscriptRef = useRef(null);
    // Always the length of the FULL session transcript from the last onresult —
    // never faked to 0/'' the way latestTranscriptRef is. Block boundaries set
    // lastMatchedLengthRef to this so the next block only sees speech heard
    // AFTER it started, without aborting/restarting recognition.
    const fullSessionLenRef = useRef(0);
    // Debug HUD: what the current block expects (target) — mirrors currentBlock.
    const [debugTarget, setDebugTarget] = useState('');
    const activeBlockRef = useRef(null);
    const pauseTimeoutRef = useRef(null);
    // Set when SpeechRecognition reports an error it will never recover from
    // by itself (permission / no usable input device / blocked service).
    // Without this the onend→restart hop and the 5 s heartbeat retry forever,
    // each attempt failing in milliseconds, while micStatus still reads
    // 「聆聽中…」 — the player just sees every phrase scored wrong.
    const fatalMicErrorRef = useRef('');
    const gameRootRef = useRef(null);

    const currentBlock = activePhrases[currentSeqIndex] || null;
    const currentBlockRef = useRef(currentBlock);
    const currentSeqIndexRef = useRef(currentSeqIndex);
    const isComplete = currentSeqIndex >= activePhrases.length || !currentBlock;
    const isCompleteRef = useRef(isComplete);

    const onWordMatchRef = useRef(onWordMatch);
    const onWordMissRef = useRef(onWordMiss);
    const onFailRef = useRef(onFail);

    useEffect(() => {
        currentBlockRef.current = currentBlock;
        currentSeqIndexRef.current = currentSeqIndex;
        isCompleteRef.current = isComplete;
        onWordMatchRef.current = onWordMatch;
        onWordMissRef.current = onWordMiss;
        onFailRef.current = onFail;
    }, [currentBlock, currentSeqIndex, isComplete, onWordMatch, onWordMiss, onFail]);

    useEffect(() => {
        if (activeBlockRef.current) {
            activeBlockRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        // Debug HUD: surface what THIS block expects, cleared of prior heard text.
        const b = currentBlockRef.current;
        setDebugTarget(typeof b === 'string' ? b : (b?.text || ''));
        setHeardText('');
        setCurrentAccuracy(0);
    }, [currentSeqIndex]);

    const TTS_LANG = getSpeechLangForVersion(version);

    useEffect(() => {
        isMountedRef.current = true;
        missCountRef.current = 0;
        missedIndicesRef.current = [];
        isSuccessFlashRef.current = false;
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setTimeout(() => gameRootRef.current?.focus(), 50);
        return () => { isMountedRef.current = false; };
    }, []);

    const playDong = () => {
        try {
            if (!window.__sharedDongCtx) {
                window.__sharedDongCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            const actx = window.__sharedDongCtx;
            if (actx.state === 'suspended') actx.resume();
            const osc = actx.createOscillator();
            const gn = actx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, actx.currentTime); // Lower pitch for Dong
            gn.gain.setValueAtTime(0, actx.currentTime);
            gn.gain.linearRampToValueAtTime(0.25, actx.currentTime + 0.02);
            gn.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 1.0);
            osc.connect(gn); gn.connect(actx.destination);
            osc.start(); osc.stop(actx.currentTime + 1.0);
        } catch (e) { console.error(e); }
    };

    const ensureMicAlive = () => {
        if (!isMountedRef.current) return;
        if (recognitionRef.current) {
            try { recognitionRef.current.start(); } catch (e) {
                // InvalidStateError means it's already running — that's fine
            }
        }
        setMicStatus(t("聆聽中...", "Listening..."));
    };

    useEffect(() => {
        const heartbeat = setInterval(() => {
            if (!isMountedRef.current) return;
            if (isCompleteRef.current) return;
            if (isSpeakingRef.current) return;
            ensureMicAlive();
        }, 2000);
        return () => clearInterval(heartbeat);
    }, []);

    const [hintLevel, setHintLevel] = useState(0);

    const isSpeakingRef = useRef(false);

    // Advance the consumed-offset to EVERYTHING heard so far, so the next block
    // only evaluates speech that comes after it. With continuous recognition,
    // event.results accumulates the whole session, and each onresult rebuilds
    // the full transcript; slicing from this baseline is what keeps a mis-heard
    // (or skipped) earlier block from polluting every later block. We do NOT
    // abort()/restart the recognizer between blocks — that dropped ~100-300ms
    // of audio on each restart and made every other block fail. Called only
    // from advance timeouts, never inside onresult.
    const consumeSessionSoFar = () => {
        lastMatchedLengthRef.current = fullSessionLenRef.current;
        if (pauseTimeoutRef.current) {
            clearTimeout(pauseTimeoutRef.current);
            pauseTimeoutRef.current = null;
        }
    };

    const startTimer = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);
        setHintLevel(0);
        setCountdown(null);

        let elapsed = 0;
        countdownRef.current = setInterval(() => {
            elapsed += 1;
            if (elapsed === 3) {
                setHintLevel(1);
            } else if (elapsed === 4) {
                setHintLevel(2);
            } else if (elapsed >= 5) {
                setHintLevel(3);
                clearInterval(countdownRef.current);
                playDong();
                if (!missedIndicesRef.current.includes(currentSeqIndexRef.current)) {
                    missedIndicesRef.current.push(currentSeqIndexRef.current);
                    setMissedIndices([...missedIndicesRef.current]);
                    const isFinalBlock = currentSeqIndexRef.current >= activePhrases.length - 1;

                    // Read the block aloud on a MISS too — the user should hear the
                    // correct phrase whether they got it right or ran out of time.
                    // Same readback flow as the match path: mute recognition via
                    // isSpeakingRef (no abort/restart, which races), then advance.
                    const missedBlock = currentBlockRef.current;
                    const advanceMiss = () => {
                        if (!isMountedRef.current) return;
                        isSpeakingRef.current = false;
                        consumeSessionSoFar();
                        onWordMissRef.current();
                    };
                    const plan = planReadback(missedBlock, {
                        isFinalBlock,
                        hasSpeakText: Boolean(speakText),
                        reviewMs: FINAL_BLOCK_REVIEW_MS,
                        normalMs: 250,
                        readback: !skipReadback,
                    });

                    if (plan.shouldSpeak) {
                        if (plan.muteRecognition) isSpeakingRef.current = true;
                        if (pauseTimeoutRef.current) {
                            clearTimeout(pauseTimeoutRef.current);
                            pauseTimeoutRef.current = null;
                        }
                        speakText(plan.text, 1.0, TTS_LANG).then(() => {
                            if (!isMountedRef.current) return;
                            setTimeout(advanceMiss, plan.advanceDelayMs);
                        });
                    } else {
                        isSpeakingRef.current = false;
                        setTimeout(advanceMiss, plan.advanceDelayMs);
                    }
                }
            }
        }, 1000);
    };

    const hasSpokenRef = useRef(false);

    useEffect(() => {
        hasSpokenRef.current = false;
    }, [activeVerse]);

    useEffect(() => {
        if (isComplete) return;

        if (currentSeqIndex === 0 && activeVerse && !hasSpokenRef.current && isMicReady) {
            hasSpokenRef.current = true;
            
            // 1. Play the 2-second "Ready" chime
            let readyDelay = 2000;
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) {
                    const ctx = new AudioContext();
                    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (C Major Arpeggio)
                    
                    notes.forEach((freq, i) => {
                        setTimeout(() => {
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(freq, ctx.currentTime);
                            
                            gain.gain.setValueAtTime(0, ctx.currentTime);
                            gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
                            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                            
                            osc.connect(gain);
                            gain.connect(ctx.destination);
                            
                            osc.start();
                            osc.stop(ctx.currentTime + 0.6);
                        }, i * 200); 
                    });
                }
            } catch(e) {}
            
            // 2. Wait 2 seconds, then speak verse reference
            setTimeout(() => {
                if (!isMountedRef.current) return;
                if (recognitionRef.current) {
                    try { recognitionRef.current.abort(); } catch(e) {}
                }
                isSpeakingRef.current = true;
                const formattedRef = formatVerseReferenceForSpeech ? formatVerseReferenceForSpeech(activeVerse.reference, version) : activeVerse.reference;
                speakText(formattedRef, 1.0, TTS_LANG).then(() => {
                    if (!isMountedRef.current) return;
                    // Fill the silent pause with a visible cue. The schedule is
                    // pinned to REFERENCE_TO_RECITE_PAUSE_MS so 「開始」 lands on
                    // the same tick as the ding — a countdown that finishes
                    // before the mic opens would train players to start early.
                    const step = REFERENCE_TO_RECITE_PAUSE_MS / 4;
                    readyTimersRef.current.forEach(clearTimeout);
                    readyTimersRef.current = [
                        ['ready', 0], [3, step], [2, step * 2], [1, step * 3],
                    ].map(([v, at]) => setTimeout(() => {
                        if (isMountedRef.current) setReadyPhase(v);
                    }, at));
                    setTimeout(() => {
                        if (!isMountedRef.current) return;
                        isSpeakingRef.current = false;
                        latestTranscriptRef.current = { transcript: '', alternatives: [] };
                        lastMatchedLengthRef.current = 0;

                        if (recognitionRef.current) {
                            try { recognitionRef.current.start(); } catch(e) {}
                        }

                        if (playDing) playDing();
                        setReadyPhase('go');
                        readyTimersRef.current.push(
                            setTimeout(() => { if (isMountedRef.current) setReadyPhase(null); }, 800)
                        );
                        if (onResumeTimer) onResumeTimer();
                        startTimer();
                    }, REFERENCE_TO_RECITE_PAUSE_MS);
                });
            }, readyDelay);
            
        } else if (currentSeqIndex > 0 && currentBlock) {
            startTimer();
        }

        return () => {
            readyTimersRef.current.forEach(clearTimeout);
            readyTimersRef.current = [];
            setReadyPhase(null);
            if (timerRef.current) clearTimeout(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
        };
    }, [currentSeqIndex, activeVerse, TTS_LANG, speakText, isMicReady]);

    const evaluateTranscriptRef = useRef(null);

    useEffect(() => {
        evaluateTranscriptRef.current = () => {
            const transcriptObj = latestTranscriptRef.current;
            if (!transcriptObj) return;

            const currentTranscript = transcriptObj.transcript || '';
            
            const block = currentBlockRef.current;
            let textToProcess = currentTranscript.substring(lastMatchedLengthRef.current || 0);
            
            setHeardText(textToProcess);
            
            if (block && !isSuccessFlashRef.current) {
                const targetText = typeof block === 'string' ? block : (block.text || '');
                // Pronunciation-set matcher (src/lib/recitationMatch.js): every
                // target char accepts ALL of its readings (多音字 fix), fuzzy
                // pinyin folds tolerate accents (zh=z, ang=an...), both sides are
                // folded traditional→simplified and digits expanded (40↔四十),
                // and a proper LCS alignment replaces the old greedy subsequence.
                // Candidate 0 = the primary prefix-sliced transcript (the only
                // one with consumed-length bookkeeping); 1..4 = SpeechRecognition
                // alternatives, each scored whole.
                const prepared = prepareTarget(targetText, TTS_LANG);
                const candidates = [textToProcess];
                const alts = transcriptObj.alternatives || [];
                const altDepth = alts.reduce((mx, a) => Math.max(mx, a.length), 0);
                for (let k = 1; k < Math.min(5, altDepth); k++) {
                    candidates.push(alts.map(a => a[Math.min(k, a.length - 1)] || '').join(' '));
                }
                const { score, pass, consumedRawLength, candidateIndex } = scoreBestCandidate(prepared, candidates);
                setCurrentAccuracy(score);

                // A block may only pass on speech produced AFTER it opened.
                //
                // Candidate 0 is the only one sliced by lastMatchedLengthRef;
                // candidates 1..4 are SpeechRecognition alternatives covering the
                // WHOLE session, so on their own they can "pass" a phrase the
                // player has not reached yet using words from earlier phrases.
                // The LCS score is matched/targetLength — extra heard text is
                // never penalised — so a wider window can only ever raise the
                // score, never lower it. Requiring real content in the SLICED
                // window is what makes 「還沒念到就自己通過」 impossible.
                //
                // Half the target length (min 2) is deliberately lenient: a
                // genuine recitation always puts at least as many characters in
                // the window as the target has, so this never blocks a real
                // pass — it only refuses one backed by nothing.
                const targetLen = targetText.replace(/\s+/g, '').length;
                const spokenIntoThisBlock = textToProcess.replace(/\s+/g, '').length;
                const minToPass = Math.max(2, Math.round(targetLen * 0.5));
                const passWithEvidence = pass && spokenIntoThisBlock >= minToPass;

                if (passWithEvidence) {
                    if (candidateIndex === 0) {
                        lastMatchedLengthRef.current += consumedRawLength;
                    } else {
                        // An alternative transcript matched; primary-transcript
                        // offsets don't apply to it, so conservatively consume
                        // the whole primary transcript — the block just passed.
                        lastMatchedLengthRef.current = (latestTranscriptRef.current?.transcript || '').length;
                    }
                    
                    if (timerRef.current) clearTimeout(timerRef.current);
                    if (countdownRef.current) clearInterval(countdownRef.current);
                    setCountdown(null);
                    setHeardText(t("收到正確！等候中...", "Correct! Waiting..."));
                    setCurrentAccuracy(100);
                    isSuccessFlashRef.current = true;
                    setIsSuccessFlash(true);

                    playDing();

                    // After a correct recitation, the system reads the block back
                    // aloud — reinforcing the correct pronunciation. We mute speech
                    // recognition while TTS plays (isSpeakingRef + abort) so the
                    // system's own voice isn't picked up as user input, then
                    // advance to the next block once the readback finishes.
                    const isFinalBlock = currentSeqIndexRef.current >= activePhrases.length - 1;
                    const advance = () => {
                        if (!isMountedRef.current) return;
                        isSuccessFlashRef.current = false;
                        setIsSuccessFlash(false);
                        consumeSessionSoFar();
                        const wasMissed = missedIndicesRef.current.includes(currentSeqIndexRef.current);
                        onWordMatchRef.current(block, wasMissed);
                    };

                    const plan = planReadback(block, {
                        isFinalBlock,
                        hasSpeakText: Boolean(speakText),
                        reviewMs: FINAL_BLOCK_REVIEW_MS,
                        normalMs: 250,
                        readback: !skipReadback,
                    });

                    if (plan.shouldSpeak) {
                        // Mute recognition for the readback by flipping isSpeakingRef
                        // — onresult bails out early while this is true (see the
                        // `if (isSpeakingRef.current) return;` guard), so the
                        // system's own TTS is never captured as user input. We do
                        // NOT abort()/start() the recognition object here: doing so
                        // from inside an onresult callback races with the
                        // onend→restart heartbeat and was swallowing the readback on
                        // non-final blocks. Leaving continuous recognition running
                        // and just ignoring its results is the same approach the
                        // original final-block / miss paths use.
                        if (plan.muteRecognition) {
                            isSpeakingRef.current = true;
                        }
                        // speakText() calls cancel() on entry, so cancel any pending
                        // utterance first is unnecessary — but we guard against the
                        // 1500ms pause re-evaluation firing mid-readback.
                        if (pauseTimeoutRef.current) {
                            clearTimeout(pauseTimeoutRef.current);
                            pauseTimeoutRef.current = null;
                        }
                        speakText(plan.text, 1.0, TTS_LANG).then(() => {
                            if (!isMountedRef.current) return;
                            isSpeakingRef.current = false;
                            setTimeout(advance, plan.advanceDelayMs);
                        });
                    } else {
                        setTimeout(advance, plan.advanceDelayMs);
                    }
                }
            }
        };
    });

    // Re-evaluate the transcript automatically when moving to the next sequence
    useEffect(() => {
        if (isMountedRef.current && !isCompleteRef.current && evaluateTranscriptRef.current) {
            evaluateTranscriptRef.current();
        }
    }, [currentSeqIndex]);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setMicStatus(t("您的瀏覽器不支援語音辨識", "Browser does not support Speech Recognition"));
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        // Ask for alternatives so a homophone-mangled primary transcript can
        // still pass via a better candidate. iOS WKWebView typically returns
        // just 1 — the consumers index defensively and degrade gracefully.
        recognition.maxAlternatives = 5;
        recognition.lang = TTS_LANG;

        recognition.onstart = () => {
            fatalMicErrorRef.current = '';
            setMicStatus(t("聆聽中...", "Listening..."));
            // A fresh session starts with empty event.results — zero ALL the
            // bookkeeping to match. Critically, cancel any pending 1500ms
            // silence-commit from the PREVIOUS session: firing late, it would
            // set lastMatchedLengthRef to the old (longer) transcript length,
            // making the new session's shorter transcript slice to '' — the
            // player's speech becomes invisible and every block times out.
            lastMatchedLengthRef.current = 0;
            fullSessionLenRef.current = 0;
            latestTranscriptRef.current = { transcript: '', alternatives: [] };
            if (pauseTimeoutRef.current) {
                clearTimeout(pauseTimeoutRef.current);
                pauseTimeoutRef.current = null;
            }
            setIsMicReady(true);
        };

        recognition.onresult = (event) => {
            if (pauseTimeoutRef.current) {
                clearTimeout(pauseTimeoutRef.current);
            }

            let sessionTranscript = '';
            const alternatives = [];
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                sessionTranscript += result[0].transcript + ' ';
                const list = [];
                for (let k = 0; k < result.length; k++) list.push(result[k].transcript);
                alternatives.push(list);
            }
            latestTranscriptRef.current = { transcript: sessionTranscript, alternatives };
            fullSessionLenRef.current = sessionTranscript.length; // real length — never faked

            // While WE are speaking (readback / reference), the mic still hears
            // our own TTS and it still lands in event.results. This used to
            // `return` before the two refs above were updated, which meant
            // consumeSessionSoFar() captured a PRE-TTS length at the block
            // boundary — so the next block's window opened with our own voice
            // inside it. Since the LCS score never penalises extra heard text,
            // that contamination could only ever push a block towards passing.
            // Keep the bookkeeping current so the TTS ends up in the CONSUMED
            // region; just don't score against it.
            if (isSpeakingRef.current) return;

            if (evaluateTranscriptRef.current) {
                evaluateTranscriptRef.current();
            }

            pauseTimeoutRef.current = setTimeout(() => {
                if (latestTranscriptRef.current && isMountedRef.current) {
                    lastMatchedLengthRef.current = latestTranscriptRef.current.transcript.length;
                    if (evaluateTranscriptRef.current) {
                        evaluateTranscriptRef.current();
                    }
                }
            }, 1500);
        };

        // Chrome on the desktop routes Web Speech through Google's servers and
        // uses whatever input Chrome itself is pointed at — neither is true of
        // iOS, which is why the same verse can pass on a phone and fail on a
        // Mac. Reporting the actual error code is what makes the two
        // distinguishable; before this it was a console.log nobody sees.
        recognition.onerror = (e) => {
            const code = e.error || 'unknown';
            // no-speech / aborted are normal punctuation in a long session:
            // Chrome ends a quiet stretch and onend restarts us.
            if (code === 'no-speech' || code === 'aborted') return;
            const FATAL = {
                'not-allowed': t('麥克風權限被拒絕。請點網址列左邊的鎖頭 → 允許麥克風,然後重新整理。',
                                 'Microphone permission denied. Click the padlock in the address bar → allow the microphone, then reload.'),
                'service-not-allowed': t('瀏覽器不允許使用語音辨識服務。請改用 Chrome 或 Safari。',
                                         'The browser blocked the speech service. Please use Chrome or Safari.'),
                'audio-capture': t('找不到可用的麥克風。Chrome 可能選到了虛擬裝置(BlackHole、Zoom 等),請到 Chrome 設定 → 隱私權和安全性 → 網站設定 → 麥克風 改選內建麥克風。',
                                   'No usable microphone. Chrome may be pointed at a virtual device (BlackHole, Zoom…). Change it in Chrome Settings → Privacy and security → Site settings → Microphone.'),
            };
            if (FATAL[code]) {
                fatalMicErrorRef.current = code;
                setMicStatus(FATAL[code]);
                return;
            }
            // network: desktop Chrome could not reach Google's recognizer.
            // Recoverable, so keep the restart loop running, but say so —
            // otherwise it looks identical to "the mic is not picking me up".
            setMicStatus(code === 'network'
                ? t('語音辨識連線中斷,重試中…(桌面版 Chrome 需要網路才能辨識)',
                    'Speech service connection lost, retrying… (desktop Chrome needs the network to recognise speech)')
                : t('語音辨識錯誤：', 'Speech recognition error: ') + code);
        };

        recognition.onend = () => {
            if (fatalMicErrorRef.current) return; // nothing to retry into
            if (isMountedRef.current && recognitionRef.current) {
                setTimeout(() => {
                    if (isMountedRef.current && recognitionRef.current && !isSpeakingRef.current) {
                        try {
                            recognitionRef.current.start();
                        } catch (e) {}
                    }
                }, 100);
            }
        };

        if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }

        try {
            recognition.start();
        } catch (e) {
            console.error('Initial recognition.start failed:', e);
        }
        
        recognitionRef.current = recognition;

        let heartbeat = setInterval(() => {
            if (fatalMicErrorRef.current) return;
            if (recognitionRef.current && isMountedRef.current && !isSpeakingRef.current) {
                try {
                    recognitionRef.current.start();
                } catch(e) {}
            }
        }, 5000);

        return () => {
            clearInterval(heartbeat);
            try { recognition.stop(); } catch(e) {}
        };
    }, [TTS_LANG]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch (e) { }
            }
        };
    }, []);

    const speakAccessiblePrompt = (kind = 'status') => {
        if (!speakText) return;
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch (e) {}
        }
        isSpeakingRef.current = true;
        const reference = formatVerseReferenceForSpeech ? formatVerseReferenceForSpeech(activeVerse?.reference || '', version) : activeVerse?.reference;
        const blockText = typeof currentBlockRef.current === 'string' ? currentBlockRef.current : (currentBlockRef.current?.text || '');
        const message = kind === 'help'
            ? t('視障模式說明。請聽提示音後唸出經文。按 R 可以重聽目前片段，按 H 可以重聽說明，按 Escape 離開遊戲。', 'Accessible mode help. Recite after the prompt. Press R to hear the current phrase, H for help, Escape to exit.')
            : kind === 'repeat'
                ? `${t('目前片段：', 'Current phrase: ')}${blockText}`
                : `${reference}。${t('目前進度', 'Progress')} ${Math.min(currentSeqIndexRef.current + 1, activePhrases.length)} / ${activePhrases.length}。`;
        speakText(message, 1.0, TTS_LANG).then(() => {
            if (!isMountedRef.current) return;
            isSpeakingRef.current = false;
            if (recognitionRef.current) {
                try { recognitionRef.current.start(); } catch (e) {}
            }
        });
    };

    return (
        <div
            ref={gameRootRef}
            role="application"
            aria-label={t("VerseRain 視障語音背誦模式", "VerseRain accessible voice recitation mode")}
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                    if (onFail) onFail();
                }
                if (e.key.toLowerCase() === 'r') speakAccessiblePrompt('repeat');
                if (e.key.toLowerCase() === 'h') speakAccessiblePrompt('help');
            }}
            style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: '#000', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', outline: 'none' }}
        >
            {/* 預備…3…2…1…開始 — fills the gap between the spoken reference
                and the ding. Purely visual: blind-mode users already get the
                same information from the spoken reference and the ding, so
                this is deliberately NOT announced again via aria-live. */}
            {readyPhase !== null && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 20 }}>
                    <div
                        key={String(readyPhase)}
                        style={{
                            fontWeight: 900,
                            lineHeight: 1,
                            fontSize: typeof readyPhase === 'number' ? 'clamp(6rem, 28vw, 16rem)' : 'clamp(2.6rem, 12vw, 6rem)',
                            color: readyPhase === 'go' ? '#4ade80' : '#facc15',
                            textShadow: readyPhase === 'go' ? '0 0 40px rgba(74,222,128,0.55)' : '0 0 32px rgba(250,204,21,0.4)',
                            animation: 'readyPop 0.45s cubic-bezier(0.2, 1.4, 0.4, 1)',
                        }}
                    >
                        {readyPhase === 'ready' ? t('預備…', 'Get ready…')
                            : readyPhase === 'go' ? t('開始！', 'GO!')
                            : readyPhase}
                    </div>
                </div>
            )}
            <style>{`@keyframes readyPop { from { transform: scale(0.55); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>

            <div aria-live="polite" style={{ position: 'absolute', left: '-9999px' }}>
                {`${micStatus}. ${t('進度', 'Progress')} ${Math.min(currentSeqIndex + 1, activePhrases.length)} / ${activePhrases.length}. ${currentBlock ? t('請背誦目前片段', 'Recite the current phrase') : t('完成', 'Complete')}`}
            </div>
            
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.5rem 1rem', display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', zIndex: 10 }}>
                <div className="hud-glass" style={{ padding: '0.3rem 0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center', height: '100%', minHeight: '36px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: '#f87171' }}>
                        {[...Array(3)].map((_, i) => (
                            <Heart key={i} size={16} fill={i < health ? '#f87171' : 'transparent'} strokeWidth={i < health ? 0 : 2} />
                        ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '1rem', fontWeight: 'bold', color: '#fbbf24' }}>
                        <Zap size={16} fill="#fbbf24" strokeWidth={0} /> {combo}x
                    </div>
                </div>

                <div className="hud-glass" style={{ padding: '0.3rem 0.8rem', display: 'flex', alignItems: 'center', gap: '1rem', minHeight: '36px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', fontFamily: 'monospace' }}>
                            {String(score || 0).padStart(6, '0')}
                        </div>
                    </div>
                    <div style={{ padding: '0.2rem 0.6rem', background: 'rgba(0,0,0,0.5)', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>T</div>
                        <div style={{ fontSize: '0.95rem', color: timeLeft <= 1000 ? '#f87171' : '#cbd5e1', fontFamily: 'monospace' }}>
                            {String(Math.floor(timeLeft / 100)).padStart(2, '0')}.{String(timeLeft % 100).padStart(2, '0')}
                        </div>
                    </div>
                </div>
            </div>

            {/* The outer element is a layout wrapper, not a heading — it used to
                be an <h1> with an <h2> inside it, which is invalid HTML (React
                warns: "<h2> cannot be a child of <h1>"). The verse reference is
                the real heading of this full-screen view, so it carries the
                <h1>; the status line under it is not heading content. This
                matters more here than in most views: screen-reader users
                navigating by heading should land on the verse being recited. */}
            <div style={{ color: '#fff', position: 'absolute', top: '15%', margin: 0, textAlign: 'center', width: '100%' }}>
                <h1 style={{ color: '#bae6fd', fontSize: '3rem', margin: 0, textShadow: '0 0 20px rgba(186,230,253,0.5)', letterSpacing: '2px', fontWeight: 'bold' }}>
                    {formatVerseReferenceForDisplay ? formatVerseReferenceForDisplay(activeVerse?.reference || '', version) : activeVerse?.reference}
                </h1>
                <div style={{ fontSize: '1.2rem', opacity: 0.9 }}>
                    {playMode?.startsWith('voice') ? t("語音模式", "Voice Mode") : t("視障模式", "Blind Mode")} - <span style={{ color: '#4ade80' }}>{micStatus}</span>
                    {countdown !== null && <span style={{ color: '#facc15', marginLeft: '1rem' }}>⏱ {countdown}s</span>}
                </div>
            </div>
            <div style={
                playMode?.startsWith('voice') ? {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 'clamp(0.4rem, 2vh, 0.75rem)',
                    width: '95%',
                    maxWidth: '600px',
                    margin: '10vh auto 0',
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    padding: '1rem'
                } : {
                    display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', width: '100%', maxHeight: '60vh', marginTop: '10vh', overflowY: 'auto', padding: '1rem'
                }
            }>
                {activePhrases && activePhrases.map((phrase, index) => {
                    const isActive = index === currentSeqIndex;
                    const isPassed = index < currentSeqIndex;
                    const isMissed = missedIndices.includes(index);
                    const showGold = (isPassed && !isMissed) || (isActive && isSuccessFlash);
                    const isVoiceMode = playMode?.startsWith('voice');
                    let content = phrase.text || phrase;
                    if (isActive && isVoiceMode && !showGold && hintLevel < 3) {
                        if (hintLevel === 0) {
                            content = <span style={{ opacity: 0 }}>{content}</span>;
                        } else {
                            const isEnglish = /[a-zA-Z]/.test(content);
                            let revealedStr = '';
                            let hiddenStr = '';
                            
                            if (isEnglish) {
                                const words = content.split(/(\s+)/);
                                let wordCount = 0;
                                let splitIndex = 0;
                                for (let i = 0; i < words.length; i++) {
                                    if (words[i].trim().length > 0) wordCount++;
                                    if (wordCount > hintLevel) {
                                        splitIndex = i;
                                        break;
                                    }
                                }
                                if (splitIndex === 0 || wordCount <= hintLevel) {
                                    revealedStr = content;
                                    hiddenStr = '';
                                } else {
                                    revealedStr = words.slice(0, splitIndex).join('');
                                    hiddenStr = words.slice(splitIndex).join('');
                                }
                            } else {
                                revealedStr = content.substring(0, hintLevel);
                                hiddenStr = content.substring(hintLevel);
                            }

                            content = (
                                <>
                                    <span>{revealedStr}</span>
                                    <span style={{ opacity: 0 }}>{hiddenStr}</span>
                                </>
                            );
                        }
                    }

                    const isFullyRevealedHint = isActive && isVoiceMode && hintLevel === 3;
                    const isVisible = showGold || isMissed || !isVoiceMode || isFullyRevealedHint || (isActive && isVoiceMode && hintLevel > 0);

                    return (
                        <div
                            key={index}
                            ref={isActive ? activeBlockRef : null}
                            className={isVoiceMode ? 'falling-block-inner' : ''}
                            style={isVoiceMode ? {
                                cursor: 'default',
                                padding: 'clamp(0.4rem, 2vh, 1.5rem)',
                                fontSize: 'clamp(0.9rem, 2.5vw, 1.5rem)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                minHeight: 'clamp(2.5rem, 12vh, 100px)',
                                wordBreak: 'break-word',
                                hyphens: 'auto',
                                textAlign: 'center',
                                opacity: isVisible ? 1 : 0,
                                background: isMissed ? 'rgba(71, 85, 105, 0.8)' : (showGold ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.9) 0%, rgba(251, 191, 36, 0.5) 100%)' : (isActive ? 'linear-gradient(135deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.3) 100%)' : 'rgba(255,255,255,0.05)')),
                                color: isMissed ? '#94a3b8' : (showGold ? '#fff' : (isActive ? '#1e293b' : '#94a3b8')),
                                borderColor: isMissed ? '#475569' : (showGold ? '#fbbf24' : (isActive ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255,255,255,0.2)')),
                                boxShadow: (!isMissed && showGold) ? '0 0 20px rgba(251, 191, 36, 0.6)' : 'none',
                                pointerEvents: 'none',
                                transition: 'all 0.3s'
                            } : {
                                fontSize: '8vw', fontWeight: 'bold', lineHeight: '1.4',
                                color: showGold ? '#fbbf24' : (isActive ? '#cbd5e1' : '#475569'),
                                border: `2px solid ${showGold ? '#fbbf24' : (isActive ? '#94a3b8' : '#334155')}`,
                                padding: '0.4rem 1rem',
                                borderRadius: '16px',
                                opacity: isVisible ? 1 : 0,
                                transition: 'all 0.3s'
                            }}
                        >
                            {content}
                        </div>
                    );
                })}
            </div>

            {/* Exit button — moved to the BOTTOM-LEFT corner. In the top-right/
                top-left corner it was hard to tap (overlapped by the status bar /
                Dynamic Island on phones). Larger hit area + safe-area inset. */}
            <button
                className="hud-glass"
                onClick={(e) => {
                    e.stopPropagation();
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                    if (onFail) onFail();
                }}
                aria-label={t("離開語音模式", "Exit voice mode")}
                title={t("離開", "Exit")}
                style={{
                    position: 'absolute',
                    left: 'max(1rem, env(safe-area-inset-left))',
                    bottom: 'max(1.25rem, env(safe-area-inset-bottom))',
                    zIndex: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.9rem 1.2rem',
                    border: 'none',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    color: '#f87171',
                    fontWeight: 'bold',
                    fontSize: '1rem'
                }}
            >
                <XCircle size={26} />
                {t("離開", "Exit")}
            </button>

            {isDebugMode && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.9rem 1.4rem', textAlign: 'left', backgroundColor: 'rgba(0,0,0,0.82)', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#94a3b8', fontSize: '1rem', fontWeight: 700, minWidth: '5.5rem' }}>{t("期待：", "Expects: ")}</span>
                        <span style={{ color: '#facc15', fontSize: '1.5rem', fontWeight: 'bold', wordBreak: 'break-word' }}>{debugTarget || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span style={{ color: '#94a3b8', fontSize: '1rem', fontWeight: 700, minWidth: '5.5rem' }}>{t("聽見：", "Heard: ")}</span>
                        <span style={{ color: '#bae6fd', fontSize: '1.5rem', fontWeight: 'bold', wordBreak: 'break-word' }}>{heardText || '…'}</span>
                        <span style={{
                            marginLeft: 'auto',
                            fontSize: '1.2rem',
                            fontWeight: 800,
                            color: currentAccuracy >= PASS_THRESHOLD ? '#4ade80' : (currentAccuracy > 0 ? '#facc15' : '#94a3b8'),
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            padding: '0.15rem 0.7rem',
                            borderRadius: '12px',
                            whiteSpace: 'nowrap'
                        }}>
                            {currentAccuracy}% {currentAccuracy >= PASS_THRESHOLD ? '✓' : ''} <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>(≥{PASS_THRESHOLD})</span>
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
