import React, { useEffect, useState } from 'react';
import { annotateText, isAnnotatorReady, loadAnnotator, onAnnotatorReady } from './lib/annotate.js';

// Renders `text` with per-character 注音 (mode 'bpmf', vertical, to the right
// of each character like a Taiwanese schoolbook) or 拼音 (mode 'pinyin', ruby
// above). Plain text when mode is null or the annotator hasn't loaded yet.
export default function Annotated({ text, mode }) {
  const [ready, setReady] = useState(isAnnotatorReady());
  useEffect(() => {
    if (!mode || ready) return undefined;
    const off = onAnnotatorReady(() => setReady(true));
    loadAnnotator().catch(() => {});
    return off;
  }, [mode, ready]);
  if (!mode || !ready) return text;
  const tokens = annotateText(text, mode);
  if (!tokens) return text;
  if (mode === 'pinyin') {
    return tokens.map((tk, i) => tk.rt
      ? <ruby key={i} className="ls-ruby">{tk.ch}<rp>(</rp><rt>{tk.rt}</rt><rp>)</rp></ruby>
      : <React.Fragment key={i}>{tk.ch}</React.Fragment>);
  }
  return tokens.map((tk, i) => tk.rt
    ? <span key={i} className="ls-bpmf"><span className="ls-bpmf-ch">{tk.ch}</span><span className="ls-bpmf-zy" aria-hidden="true">{tk.rt}</span></span>
    : <React.Fragment key={i}>{tk.ch}</React.Fragment>);
}
