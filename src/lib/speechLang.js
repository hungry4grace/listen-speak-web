// Language id → BCP-47 speech/TTS tag. Single source of truth for both
// SpeechRecognition.lang and speechSynthesis voice selection.
import { baseLang } from './lang.js';

export function isEnglishBibleVersion(v) {
  return baseLang(v) === 'en';
}

export function getSpeechLangForVersion(v) {
  const b = baseLang(v);
  if (b === 'en') return 'en-US';
  if (b === 'cuvs') return 'zh-CN';
  return 'zh-TW';
}
