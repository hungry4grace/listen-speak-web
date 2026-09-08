// Pick game mode + difficulty at the moment you start a challenge.
//
// This used to live inline in VerseSetContinuousRainPlayer while every other
// surface carried its own pair of <select>s in a toolbar. Two problems with
// that: the toolbar settings were invisible at the moment they mattered (you
// set them once, then forgot what they were three verses later), and each
// surface drifted — different option labels, different difficulty wording.
// One component, opened by every challenge button, fixes both.
//
// Props:
//   t        — i18n helper (zh, en) => string
//   subtitle — what is being challenged (a formatted verse reference, a set
//              title…). Shown under the header; optional.
//   value    — { mode, difficulty, debug, noReadback }
//   onChange — (next) => void
//   onStart  — (value) => void. Persistence already happened.
//   onCancel — () => void

const MODE_KEY = 'verserain_reader_challenge_mode';
const DIFF_KEY = 'verserain_reader_challenge_diff';
const DEBUG_KEY = 'verseRain_debugMode';
const READBACK_KEY = 'verseRain_noReadback';

export const CHALLENGE_MODES = ['square_solo', 'rain_solo', 'voice_solo'];

// Last-used settings, so opening the modal never starts from a blank slate.
export function loadChallengeSetup() {
  const out = { mode: 'square_solo', difficulty: 0, debug: false, noReadback: false };
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (CHALLENGE_MODES.includes(m)) out.mode = m;
    const d = parseInt(localStorage.getItem(DIFF_KEY) || '0', 10);
    if (d >= 0 && d <= 3) out.difficulty = d;
    out.debug = localStorage.getItem(DEBUG_KEY) === 'true';
    out.noReadback = localStorage.getItem(READBACK_KEY) === 'true';
  } catch { /* defaults stand */ }
  return out;
}

export function saveChallengeSetup({ mode, difficulty, debug, noReadback }) {
  try {
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(DIFF_KEY, String(difficulty));
    localStorage.setItem(DEBUG_KEY, debug ? 'true' : 'false');
    localStorage.setItem(READBACK_KEY, noReadback ? 'true' : 'false');
  } catch { /* remember-me is best-effort */ }
}

export default function ChallengeSetupModal({ t, subtitle, value, onChange, onStart, onCancel }) {
  if (!value) return null;
  const set = (patch) => onChange({ ...value, ...patch });
  const isVoice = value.mode === 'voice_solo';

  const toggle = (on, activeColor, activeBg, activeText) => ({
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '0.55rem 0.7rem',
    borderRadius: 10, border: on ? `2px solid ${activeColor}` : '1px solid #e2e8f0',
    background: on ? activeBg : '#f8fafc', color: on ? activeText : '#64748b',
    fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left',
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000, padding: '1rem' }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: '1.4rem 1.3rem', width: '100%', maxWidth: 340, maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
        <h3 style={{ margin: '0 0 0.3rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>⚡ {t('挑戰', 'Challenge')}</h3>
        {subtitle && <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.82rem' }}>{subtitle}</p>}

        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>{t('遊戲模式', 'Game Mode')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '1rem' }}>
          {[
            { value: 'square_solo', icon: '🔢', label: t('九宮格', 'Square') },
            { value: 'rain_solo', icon: '🌧️', label: t('經文雨', 'Verse Rain') },
            { value: 'voice_solo', icon: '🎤', label: t('語音模式', 'Voice Mode') },
          ].map((opt) => {
            const active = value.mode === opt.value;
            return (
              <button key={opt.value} type="button" onClick={() => set({ mode: opt.value })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.6rem 0.85rem', borderRadius: 10, border: active ? '2px solid #16a34a' : '1px solid #e2e8f0', background: active ? '#f0fdf4' : '#f8fafc', color: active ? '#15803d' : '#334155', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                <span>{opt.icon}</span><span style={{ flex: 1 }}>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>{t('難度', 'Difficulty')}</div>
        <div style={{ display: 'flex', gap: '0.45rem', marginBottom: isVoice ? '1rem' : '1.2rem' }}>
          {[0, 1, 2, 3].map((d) => {
            const active = value.difficulty === d;
            return (
              <button key={d} type="button" onClick={() => set({ difficulty: d })}
                style={{ flex: 1, padding: '0.5rem 0', borderRadius: 10, border: active ? '2px solid #16a34a' : '1px solid #e2e8f0', background: active ? '#f0fdf4' : '#f8fafc', color: active ? '#15803d' : '#334155', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer' }}>
                {d}
              </button>
            );
          })}
        </div>

        {isVoice && (
          <button type="button" onClick={() => set({ noReadback: !value.noReadback })}
            style={{ ...toggle(value.noReadback, '#16a34a', '#f0fdf4', '#15803d'), marginBottom: '0.5rem' }}>
            <span>{value.noReadback ? '☑' : '☐'}</span>
            <span style={{ flex: 1 }}>⏩ {t('不要複誦我背過的經文(比較順暢)', 'Do not repeat what I just recited (faster flow)')}</span>
          </button>
        )}
        {isVoice && (
          <button type="button" onClick={() => set({ debug: !value.debug })}
            style={{ ...toggle(value.debug, '#6366f1', '#eef2ff', '#4338ca'), marginBottom: '1.2rem' }}>
            <span>{value.debug ? '☑' : '☐'}</span>
            <span style={{ flex: 1 }}>🔍 {t('顯示除錯資訊(期待 vs 聽見)', 'Show debug (expects vs heard)')}</span>
          </button>
        )}

        <button type="button"
          onClick={() => { saveChallengeSetup(value); onStart(value); }}
          style={{ width: '100%', padding: '0.75rem', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #22c55e, #16a34a)', color: '#fff', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 6px 16px rgba(22,163,74,0.35)' }}
        >
          ⚡ {t('開始挑戰', 'Start Challenge')}
        </button>
        <button type="button" onClick={onCancel} style={{ marginTop: '0.7rem', width: '100%', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>{t('取消', 'Cancel')}</button>
      </div>
    </div>
  );
}
