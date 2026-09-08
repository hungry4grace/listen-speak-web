// Canonical Bible-version → BCP-47 speech/TTS language map.
//
// This is THE single source of truth for both SpeechRecognition.lang and
// speechSynthesis voices. App.jsx's getVoiceLangForVersion delegates here;
// BlindModeGame imports it directly. Before this module existed the voice
// game had its own 4-entry ternary that sent ESV/NIV English recitation to
// a zh-TW recognizer — keep the two from ever drifting again.

export function isEnglishBibleVersion(v) {
  return v === 'kjv' || v === 'esv' || v === 'niv';
}

export function getSpeechLangForVersion(v) {
  if (isEnglishBibleVersion(v)) return 'en-US';
  if (v === 'cuvs') return 'zh-CN';
  if (v === 'ko') return 'ko-KR';
  if (v === 'ja') return 'ja-JP';
  if (v === 'he') return 'he-IL';
  if (v === 'fa') return 'fa-IR';
  if (v === 'ar') return 'ar-SA';
  if (v === 'es') return 'es-ES';
  if (v === 'tr') return 'tr-TR';
  if (v === 'de') return 'de-DE';
  if (v === 'my') return 'my-MM';
  if (v === 'vi') return 'vi-VN';
  if (v === 'id') return 'id-ID';
  if (v === 'ms') return 'ms-MY';
  if (v === 'pt') return 'pt-BR';
  if (v === 'fr') return 'fr-FR';
  if (v === 'ru') return 'ru-RU';
  if (v === 'hi') return 'hi-IN';
  return 'zh-TW';
}
