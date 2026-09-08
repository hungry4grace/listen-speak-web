# Semantic Scripture Segmenter

An opt-in Traditional Chinese Scripture segmenter designed for memory games,
voice selection, and small on-screen cards.

This contribution is intentionally isolated from VerseRain's existing
`src/lib/phraseSplitter.js`:

- it does not replace or import the existing splitter;
- it does not change any VerseRain runtime file;
- it contains no Bible database or complete translation;
- adopting it later requires an explicit adapter or import.

## Why a separate segmenter?

Punctuation-only splitting is predictable, but a long punctuation-free clause
can still produce a card that is difficult to read or speak. Arbitrary
character-count splitting fixes length while breaking names, words, or meaning.

This module treats length as a preference rather than the first rule:

1. remove identifiable non-Scripture labels and editorial notes;
2. prefer authored punctuation;
3. use complete word boundaries only when a clause remains too long;
4. protect Biblical names, places, titles, and curated phrases;
5. target about eight visible characters without forcing an unsafe cut;
6. preserve exact reconstruction and report exceptions for review.

See [docs/rules.zh-TW.md](docs/rules.zh-TW.md) for the complete Traditional
Chinese design notes.

## Usage

```js
import { segmentScripture } from './src/index.js';

const result = segmentScripture('王向眾人宣告，你們要彼此扶持。');

console.log(result.fragments);
console.log(result.confidence, result.issues);
```

The target is adjustable:

```js
segmentScripture(text, {
  targetLength: 6,
  maximumLength: 10,
  protectedTerms: [{ term: '提革拉．毘列色', category: 'PERSON', isolate: true }]
});
```

A human-reviewed exception can be supplied by the host application without
placing translation text in this package:

```js
segmentScripture(text, {
  approvedFragments: ['第一個完整片段，', '第二個完整片段。']
});
```

## Result

The result contains:

- `displayText` and `fragments`;
- `boundaryOffsets` and candidate boundary metadata;
- `healthState`: `VALID`, `VALID_LONG`, or `NEEDS_REPAIR`;
- `confidence`: `HIGH`, `MEDIUM`, or `LOW`;
- `issues`, `voiceReady`, and version identifiers.

`fragments.join('') === displayText` is an invariant for every valid result.

## Test

```sh
cd contrib/semantic-scripture-segmenter
npm test
```

Tests use short illustrative or synthetic text. No complete Bible translation
is bundled.

## License boundary

The MIT license in this directory applies to this contribution only. It does
not alter the licensing status of the parent VerseRain repository.
