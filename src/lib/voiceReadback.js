// Pure decision logic for the Voice Mode "read the block back after a correct
// recitation" feature. Kept separate from BlindModeGame.jsx so it can be unit
// tested without a DOM / SpeechRecognition / SpeechSynthesis environment.

// Given a matched block, decide what to read back and how to sequence it.
// Returns:
//   { text, shouldSpeak, muteRecognition, restartRecognitionAfter, advanceDelayMs }
//
// Invariants this encodes:
//  - We only speak when there's a TTS function AND non-empty text.
//  - While speaking we mute recognition so the system's own voice isn't
//    captured as user input (the mic-conflict guard).
//  - On the final block we keep recognition off and use the longer review delay
//    so the closing readback isn't cut short; otherwise we restart recognition
//    and advance quickly.
//  - `readback: false` is the player's "don't repeat what I just recited"
//    setting. Hearing the phrase you just said correctly adds a TTS pause to
//    every single block, which is the main thing that makes a long passage
//    drag. Turning it off has to cascade: with nothing spoken there is also
//    nothing to mute the mic for, nothing to restart afterwards, and no
//    reason to hold the final review beat.
export function planReadback(block, { isFinalBlock, hasSpeakText, reviewMs, normalMs, readback = true }) {
  const text = typeof block === 'string' ? block : (block && block.text) || '';
  const canSpeak = Boolean(readback && hasSpeakText && text);
  // The final review beat is NOT conditional on canSpeak — an empty last
  // block still gets it, because the pause also marks the end of the
  // passage. It drops only when the player switched readback off.
  const advanceDelayMs = (isFinalBlock && readback) ? reviewMs : normalMs;
  return {
    text,
    shouldSpeak: canSpeak,
    muteRecognition: canSpeak,
    // After speaking, restart recognition only if the game isn't over.
    restartRecognitionAfter: canSpeak && !isFinalBlock,
    advanceDelayMs,
  };
}
