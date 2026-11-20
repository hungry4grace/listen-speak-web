import React, { useEffect, useState } from 'react';
import { annotateText, isAnnotatorReady, loadAnnotator, onAnnotatorReady } from './lib/annotate.js';
import { isCjkChar, unitSegments } from './lib/readAlong.js';

// Renders `text` with per-character 注音 (mode 'bpmf', vertical, to the right
// of each character like a Taiwanese schoolbook) or 拼音 (mode 'pinyin', ruby
// above). Plain text when mode is null or the annotator hasn't loaded yet.
//
// perChar (小小手 read-along; not passed → exactly the output above): every
// unit that can be pointed at gets its own element carrying data-ci — a
// Chinese character (its code-point index in `text`) or, in English, a word
// (its ordinal). The indices are readAlong.js's.
export default function Annotated({ text, mode, perChar = false }) {
  const [ready, setReady] = useState(isAnnotatorReady());
  useEffect(() => {
    if (!mode || ready) return undefined;
    const off = onAnnotatorReady(() => setReady(true));
    loadAnnotator().catch(() => {});
    return off;
  }, [mode, ready]);
  const tokens = mode && ready ? annotateText(text, mode) : null;
  if (!perChar) {
    if (!tokens) return text;
    return tokens.map((tk, i) => renderToken(tk, i, mode, false));
  }
  return (
    <span className="ls-chars">
      {tokens
        ? tokens.map((tk, i) => renderToken(tk, i, mode, true))
        // Punctuation, spaces and the text between units stay ordinary text,
        // so lines break exactly where they did before.
        : unitSegments(text).map((seg, i) => (seg.ci === null
          ? <React.Fragment key={i}>{seg.text}</React.Fragment>
          : <span key={i} className="ls-ch" data-ci={seg.ci}>{seg.text}</span>))}
    </span>
  );
}

function renderToken(tk, i, mode, marked) {
  const ci = marked ? i : undefined;
  if (tk.rt && mode === 'pinyin') {
    return <ruby key={i} className="ls-ruby" data-ci={ci}>{tk.ch}<rp>(</rp><rt>{tk.rt}</rt><rp>)</rp></ruby>;
  }
  if (tk.rt) {
    return <span key={i} className="ls-bpmf" data-ci={ci}><span className="ls-bpmf-ch">{tk.ch}</span><span className="ls-bpmf-zy" aria-hidden="true">{tk.rt}</span></span>;
  }
  // A character the annotator has no reading for is still pointed at.
  if (marked && isCjkChar(tk.ch)) return <span key={i} className="ls-ch" data-ci={ci}>{tk.ch}</span>;
  return <React.Fragment key={i}>{tk.ch}</React.Fragment>;
}
