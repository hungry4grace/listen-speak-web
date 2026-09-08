// Optional integration example only. VerseRain does not import this file.
import { segmentScripture } from '../src/index.js';

export function splitForVerseRain(text, options = {}) {
  return segmentScripture(text, options).fragments;
}
