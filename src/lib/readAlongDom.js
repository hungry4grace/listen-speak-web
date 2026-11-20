// Read-along, DOM side: marks the character (Chinese, Japanese) or word
// (English, Hebrew, Korean, …) being read and moves the 小小手 under it. Works on the player's
// phrase spans, whose units carry data-ci (Annotated perChar). Everything is
// done imperatively with a `data-ra` attribute — the position changes several
// times a second and re-rendering the phrases (and re-running the annotator)
// for each step would be wasteful; an attribute also survives React rewriting
// className on the phrase span.
//   phrase span:  data-ra="on"   (the phrase being read)
//   unit:         data-ra="now"  (the character / word being read)
// Right-to-left text needs nothing special: the hand goes where the unit's
// box is on screen.
import { createPace, createTtsFollower, indexAtFraction, indexAtWeight, readSlots, spokenWeightMapper } from './readAlong.js';

// The learned speaking pace is kept per language: a Chinese unit is a
// character, an English one a syllable of a word — one shared number would be
// dragged back and forth by a reader who switches versions.
const PACE_KEY = 'verseRainTtsPace';
const paceLang = (lang) => String(lang || 'zh').slice(0, 2).toLowerCase();
// Where the estimate starts and how fast it may go, per language (ms per
// unit at rate 1). A Chinese unit is a whole character; elsewhere it is a
// syllable — and a Japanese mora or a Spanish syllable takes barely 100 ms.
const PACE_OPTS = { zh: { unitMs: 225 }, ja: { unitMs: 120, min: 70 } };
const PACE_OPTS_DEFAULT = { unitMs: 180, min: 80 };
// How far ahead of the estimate the pointer runs (see createTtsFollower): the
// hand should reach a unit a moment BEFORE it is spoken, so the reader's eye
// is already there — a hand that arrives with the sound feels late.
const TTS_LEAD_MS = 450;

// getLang() → speech locale of the text being read ('en-US', 'ja-JP', …): it
// picks the syllable rules for a word and which learned pace to use.
export function createReadAlong({ getPhraseNode, getContainer, getHand, getLang }) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // The fitted pace survives reloads, so the first phrase of the next visit
  // already moves at this device's voice speed.
  const paces = new Map();
  const paceFor = (lang) => {
    const key = paceLang(lang);
    if (!paces.has(key)) {
      const storeKey = `${PACE_KEY}:${key}`;
      paces.set(key, createPace({
        ...(PACE_OPTS[key] || PACE_OPTS_DEFAULT),
        store: {
          get: () => { try { return JSON.parse(window.localStorage.getItem(storeKey) || 'null'); } catch { return null; } },
          set: (v) => { try { window.localStorage.setItem(storeKey, JSON.stringify(v)); } catch { /* noop */ } },
        },
      }));
    }
    return paces.get(key);
  };
  let cur = { pi: -1, ci: -1, el: null, node: null };
  let cached = { key: '', model: null };
  let token = 0;
  let debug = null; // last computer-voice utterance, for ?voiceDebug=1

  const modelFor = (pi, text, pauseWeights) => {
    const lang = getLang?.() || 'en';
    const key = `${pi}|${pauseWeights ? 1 : 0}|${lang}|${text}`;
    if (cached.key !== key) cached = { key, model: readSlots(text, { pauseWeights, lang }) };
    return cached.model;
  };

  const hideHand = () => { const hand = getHand?.(); if (hand) hand.style.opacity = '0'; };
  const placeHand = () => {
    const hand = getHand?.();
    const box = getContainer?.();
    if (!hand || !box || !cur.el || !cur.el.isConnected) { hideHand(); return; }
    // 注音: point at the character, not at the column of symbols beside it.
    const glyph = cur.el.querySelector('.ls-bpmf-ch') || cur.el;
    const g = glyph.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (!g.width || !g.height) { hideHand(); return; }
    const size = Math.max(18, Math.min(56, g.height * 0.8));
    hand.style.fontSize = `${size}px`;
    hand.style.transform = `translate(${g.left - b.left + g.width / 2 + box.scrollLeft}px, ${g.bottom - b.top + box.scrollTop}px)`;
    hand.style.opacity = '1';
  };
  const unmark = () => {
    try { cur.el?.removeAttribute('data-ra'); } catch { /* noop */ }
    try { cur.node?.removeAttribute('data-ra'); } catch { /* noop */ }
  };

  // Mark unit `ci` of phrase `pi`. false while the phrase isn't on screen yet
  // (page flip in progress) — callers simply try again on the next tick.
  const show = (pi, ci) => {
    const node = getPhraseNode?.(pi);
    if (!node || !node.isConnected || !node.classList.contains('is-revealed') || ci < 0) return false;
    if (cur.pi === pi && cur.ci === ci && cur.el && cur.el.isConnected) return true;
    const el = node.querySelector(`b [data-ci="${ci}"]`);
    if (!el) return false;
    unmark();
    node.setAttribute('data-ra', 'on');
    el.setAttribute('data-ra', 'now');
    cur = { pi, ci, el, node };
    placeHand();
    return true;
  };

  return {
    show,
    // Recording path: `frac` = how far through the phrase the audio is.
    // measured=true → frac already skips the pauses, so punctuation gets no
    // extra weight of its own.
    showAtFraction(pi, text, frac, { measured = false } = {}) {
      return show(pi, indexAtFraction(modelFor(pi, text, !measured), frac));
    },
    // Computer-voice path: returns the hooks to hand speakTextTimed.
    //   spoken  the string actually sent to the engine (toSpeechText) — its
    //           boundary offsets are mapped back onto `text` word by word
    //   startTimeoutMs  how long to wait for the engine's `start` before
    //           moving anyway (the caller adds any pause it puts before speaking)
    followTts(pi, text, rate, isStale, { spoken = text, startTimeoutMs = 1200 } = {}) {
      const my = ++token;
      const model = modelFor(pi, text, true);
      const pace = paceFor(getLang?.());
      // Characters: the spoken string is the same length, offsets map 1:1.
      // Words: go through the word ordinal (null → ignore boundaries).
      const mapper = model.mode === 'word' ? spokenWeightMapper(model, spoken) : null;
      const follower = createTtsFollower(model, {
        msPerUnit: pace.msPerUnit(rate),
        leadMs: TTS_LEAD_MS,
        toWeight: model.mode === 'word' ? (mapper || (() => 0)) : null,
      });
      let startedAt = 0;
      let done = false;
      const createdAt = now();
      const first = indexAtWeight(model, 0);
      const info = { phrase: pi, mode: model.mode, units: model.slots.filter((s) => s.hl).length, startedBy: '', startAfter: null, endAfter: null, msPerUnit: Math.round(pace.msPerUnit(rate)), follower: follower.stats, pace };
      debug = info;
      // A timer, not requestAnimationFrame: rAF drops to a few frames a second
      // when the page is partly covered or the device is saving power, and the
      // pointer would visibly skip units.
      let timer = 0;
      const stop = () => { done = true; if (timer) { window.clearInterval(timer); timer = 0; } };
      const tick = () => {
        if (done || my !== token || isStale?.()) { stop(); return; }
        // Until the voice starts the hand already waits on the first unit of
        // the new phrase, instead of lingering on the last one of the phrase
        // before.
        show(pi, startedAt ? follower.indexAt(now()) : first);
      };
      const begin = (by) => {
        if (startedAt) return;
        startedAt = now(); follower.start(startedAt);
        info.startedBy = by; info.startAfter = Math.round(startedAt - createdAt);
        tick();
      };
      timer = window.setInterval(tick, 40);
      // Some engines never fire `start` (or fire it very late): don't leave
      // the pointer waiting on a phrase that is already being read.
      window.setTimeout(() => { if (!done && my === token && !isStale?.()) begin('timeout'); }, startTimeoutMs);
      return {
        onStart: () => begin('start'),
        onBoundary: (charIndex) => { begin('boundary'); if (Number.isFinite(charIndex)) follower.boundary(now(), charIndex); },
        onEnd: () => {
          info.endAfter = Math.round(now() - createdAt);
          // Only a phrase we really timed from its start event teaches the pace.
          if (startedAt && info.startedBy === 'start' && !done && my === token && !isStale?.()) pace.observe({ units: model.total, ms: now() - startedAt, rate });
          stop();
        },
        finish: stop,
      };
    },
    reposition: placeHand,
    // ?voiceDebug=1: what the speech engine reported for the last phrase.
    getDebug: () => {
      if (!debug) return null;
      const { pace, ...rest } = debug;
      return { ...rest, follower: { ...debug.follower, first: [...debug.follower.first] }, pace: { unit: Math.round(pace.value), overhead: Math.round(pace.overhead) } };
    },
    clear() { token += 1; unmark(); cur = { pi: -1, ci: -1, el: null, node: null }; hideHand(); },
  };
}
