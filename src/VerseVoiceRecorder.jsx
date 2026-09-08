import { useEffect, useRef, useState } from 'react';

// Generic verse-voice recorder modal — used by the custom-set editor so a
// creator can read a verse in their own voice. Flow mirrors the Cloud
// Family voice recorder: tap record → mic permission → live timer
// (auto-stop at MAX_SECONDS) → preview → upload via the `onUpload` prop.
//
// Props:
//   t          — i18n helper (zh, en) => string
//   reference  — verse reference shown above the text
//   verseText  — the text the creator reads aloud
//   onUpload   — ({ blob, mime, dur, beautify, reference, public }) => void.
//                Fire-and-forget: the parent bakes the enhance effect + uploads
//                in the BACKGROUND so the creator can immediately record next.
//   onCancel   — close without saving
//   onDone     — called right after handing the clip off (closes the modal)
//   showShareToggle — when true, offers a "分享給大家" checkbox (default on) and
//                passes its value as `public` to onUpload. Used on the personal
//                path (recording on someone else's set) so a reading can opt into
//                the set's shared-voice picker.
export default function VerseVoiceRecorder({ t, reference, verseText, onUpload, onCancel, onDone, showShareToggle = false, zIndex = 1400 }) {
  // No user-facing duration limit — long recordings are chunked
  // automatically at upload (backend allows ≈27 min). This ceiling is a
  // safety stop for a mic left running by accident, not a UX cap.
  const MAX_SECONDS = 20 * 60;
  const [phase, setPhase] = useState('idle'); // idle | recording | preview | uploading
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [sharePublic, setSharePublic] = useState(true);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const blobRef = useRef(null);
  const mimeRef = useRef('');
  const previewAudioRef = useRef(null);
  const secondsRef = useRef(0);

  // ─── Upload an existing MP3 ────────────────────────────────────────────
  // Not everyone records in the browser: choirs and pastors often already have
  // a clean take from a phone recorder or a studio. Accepting a file reuses the
  // whole preview/save path below — the only thing that changes is where the
  // Blob came from (a File IS a Blob).
  //
  // MP3 ONLY, deliberately. uploadVerseVoice() base64-encodes the blob and
  // rejects more than 120 chunks of 100,000 chars — exactly 9,000,000 binary
  // bytes. Uncompressed WAV runs ~10 MB per minute, so a one-minute reading
  // would never fit. Converting in the browser was tried and dropped: it needs
  // a JS MP3 encoder (~163 KB) because no browser can encode MP3 natively.
  // Asking for an MP3 up front costs the creator one export step and keeps the
  // client simple.
  const MAX_UPLOAD_BYTES = 9000000;
  const fileInputRef = useRef(null);
  const [fromFile, setFromFile] = useState(false);
  const [fileName, setFileName] = useState('');

  // Duration comes from the container metadata — no need to decode the audio.
  const readDuration = (file) => new Promise((resolve) => {
    let url = '';
    const done = (v) => { try { if (url) URL.revokeObjectURL(url); } catch { /* noop */ } resolve(v); };
    try {
      url = URL.createObjectURL(file);
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        const d = probe.duration;
        done(Number.isFinite(d) && d > 0 ? Math.round(d) : 0);
      };
      probe.onerror = () => done(0);
      probe.src = url;
    } catch { done(0); }
  });

  const pickFile = async (e) => {
    const file = e.target.files?.[0];
    // Clear immediately so picking the SAME file again after an error still fires.
    e.target.value = '';
    if (!file) return;
    setError('');

    // Check the extension as well as the type: a .mp3 dragged in from some
    // file managers arrives with an empty File.type.
    const isMp3 = /^audio\/(mpeg|mp3)$/i.test(file.type) || /\.mp3$/i.test(file.name);
    if (!isMp3) {
      setError(t('只接受 MP3 檔案。WAV 等未壓縮格式太大,請先轉成 MP3 再上傳。',
                 'MP3 only. Uncompressed formats like WAV are far too large — please export as MP3 first.'));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        t('檔案太大({size} MB),上限約 8.5 MB。請把錄音剪短一些。',
          'File too large ({size} MB) — the limit is about 8.5 MB. Please trim the recording.')
          .replace('{size}', (file.size / 1e6).toFixed(1))
      );
      return;
    }

    const dur = await readDuration(file);
    // A zero here means the browser could not read the metadata — usually a
    // file that is not really an MP3, so preview and playback would fail too.
    if (!dur) {
      setError(t('這個檔案無法播放,請確認它是有效的 MP3。', 'This file cannot be played — please check it is a valid MP3.'));
      return;
    }

    blobRef.current = file;
    mimeRef.current = 'audio/mpeg';
    secondsRef.current = dur;
    setSeconds(dur);
    setFromFile(true);
    setFileName(file.name);
    setPhase('preview');
  };

  // Which OS input this take is actually coming from. A Mac pointed at a
  // virtual device (BlackHole/Zoom/Teams/Krisp) records pure digital silence
  // while recording, upload and playback all report success — showing the
  // device name is what makes that visible.
  //
  // NOTE: a live AnalyserNode volume meter used to live here and was removed —
  // it read empty on a real machine and neither of the two suspected causes
  // (source-node GC, suspended AudioContext) reproduced under test, so it was
  // shipping an unexplained signal. If it is ever reintroduced, verify it
  // against a real microphone, not a synthetic MediaStream — the synthetic
  // path passed while the real one did not.
  const [deviceLabel, setDeviceLabel] = useState('');

  // ─── Input device picker ───────────────────────────────────────────────
  // Chrome keeps its OWN microphone choice, independent of the macOS "Sound →
  // Input" default. A Mac with audio-production gear installed can list a dozen
  // inputs, and Chrome quietly sticking on a virtual one (BlackHole, Zoom,
  // Pro Tools aggregate) records pure silence with nothing in the browser UI to
  // show it. This picker puts the choice where the problem is visible.
  const AUDIO_INPUT_KEY = 'verseRain_audioInputId';
  const [inputDevices, setInputDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(() => {
    try { return localStorage.getItem(AUDIO_INPUT_KEY) || ''; } catch { return ''; }
  });

  // Device LABELS stay blank until mic permission has been granted at least
  // once, so this is called again right after getUserMedia succeeds (and on
  // devicechange, for headsets plugged in mid-session).
  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(all.filter(d => d.kind === 'audioinput' && d.label));
    } catch { /* enumeration is best-effort */ }
  };

  useEffect(() => {
    refreshDevices();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refreshDevices);
    return () => md?.removeEventListener?.('devicechange', refreshDevices);
  }, []);

  const chooseDevice = (id) => {
    setDeviceId(id);
    try {
      if (id) localStorage.setItem(AUDIO_INPUT_KEY, id);
      else localStorage.removeItem(AUDIO_INPUT_KEY);
    } catch { /* private mode — the choice still holds for this session */ }
  };

  const cleanupMedia = () => {
    clearInterval(timerRef.current);
    try { if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach(tr => tr.stop());
    streamRef.current = null;
    recorderRef.current = null;
    try { previewAudioRef.current?.pause(); } catch { /* noop */ }
    previewAudioRef.current = null;
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
  };
  // Unmount cleanup only. cleanupMedia touches nothing but refs, so the
  // mount-time closure stays correct for the component's whole life —
  // re-running this effect on every render would tear down a live recording.
  useEffect(() => cleanupMedia, []);

  const pickMime = () => {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return '';
  };

  const startRecording = async () => {
    setError('');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('此瀏覽器不支援錄音。', 'This browser does not support recording.'));
      return;
    }
    try {
      // Explicit DSP constraints: browser-side noise suppression, echo
      // cancellation and auto gain make room recordings noticeably cleaner.
      const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
      if (deviceId) audio.deviceId = { exact: deviceId };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (e) {
        // A remembered device can vanish (headset unplugged) or have its id
        // rotated by a permission reset. Fall back to the system default and
        // forget the stale pick rather than dead-ending on an error screen.
        if (deviceId && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError')) {
          delete audio.deviceId;
          chooseDevice('');
          stream = await navigator.mediaDevices.getUserMedia({ audio });
        } else {
          throw e;
        }
      }
      streamRef.current = stream;
      const track = stream.getAudioTracks?.()[0];
      // Track labels are only populated once permission is granted — which it
      // just was, so this is the real OS device name ("MacBook Air Microphone",
      // "BlackHole 16ch", …). Re-enumerate now that labels are readable, and
      // point the dropdown at whatever we actually ended up with.
      setDeviceLabel(track?.label || '');
      refreshDevices();
      const actualId = track?.getSettings?.().deviceId;
      if (!deviceId && actualId) setDeviceId(actualId); // reflect, don't persist
      const mime = pickMime();
      mimeRef.current = mime || 'audio/webm';
      // 48kbps opus ≈ transparent for speech. Length is unbounded — the
      // upload layer slices the blob into as many chunks as needed.
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data?.size) parts.push(e.data); };
      rec.onstop = () => {
        blobRef.current = new Blob(parts, { type: mimeRef.current });
        streamRef.current?.getTracks().forEach(tr => tr.stop());
        streamRef.current = null;
        setPhase('preview');
      };
      recorderRef.current = rec;
      rec.start();
      setSeconds(0);
      secondsRef.current = 0;
      setPhase('recording');
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
        if (secondsRef.current >= MAX_SECONDS) stopRecording();
      }, 1000);
    } catch (e) {
      setError(
        e?.name === 'NotAllowedError'
          ? t('麥克風權限被拒絕。請在瀏覽器設定允許後重試。', 'Microphone permission denied. Please allow it and retry.')
          : t('無法啟動麥克風。', 'Could not start the microphone.')
      );
    }
  };

  const stopRecording = () => {
    clearInterval(timerRef.current);
    try { recorderRef.current?.stop(); } catch { /* noop */ }
  };

  // Preview plays through a plain <audio> element, NOT Web Audio: on iOS an
  // AudioContext is muted by the ringer/silent switch and decodeAudioData can
  // reject MediaRecorder's mp4 output — both made 試聽 silently do nothing.
  const previewUrlRef = useRef(null);

  const stopPreview = () => {
    try { previewAudioRef.current?.pause(); } catch { /* noop */ }
    previewAudioRef.current = null;
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    setPreviewPlaying(false);
  };

  const togglePreview = async () => {
    if (previewPlaying) { stopPreview(); return; }
    if (!blobRef.current) return;
    try {
      const url = URL.createObjectURL(blobRef.current);
      previewUrlRef.current = url;
      const audio = new Audio(url);
      const clear = () => { if (previewAudioRef.current === audio) stopPreview(); };
      audio.onended = clear;
      audio.onerror = clear;
      previewAudioRef.current = audio;
      await audio.play();
      setPreviewPlaying(true);
    } catch { stopPreview(); }
  };

  const discardAndRerecord = () => {
    stopPreview();
    blobRef.current = null;
    setFromFile(false);
    setFileName('');
    setSeconds(0);
    secondsRef.current = 0;
    setPhase('idle');
  };

  // Hand the RAW clip to the parent and close immediately — upload runs in
  // the background so the creator can move straight on to the next verse.
  // beautify: false — the EQ pass was dropped (subtle gain, realtime-slow bake).
  const send = () => {
    const blob = blobRef.current;
    if (!blob) return;
    stopPreview();
    onUpload({ blob, mime: mimeRef.current || 'audio/webm', dur: secondsRef.current, beautify: false, reference, public: showShareToggle ? sharePublic : undefined });
    onDone?.();
  };

  const timeLabel = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const close = (phase === 'uploading' || phase === 'processing') ? () => {} : () => { cleanupMedia(); onCancel(); };

  // Only offered once labels are readable (i.e. mic permission has been granted
  // at least once) — an unlabelled list of opaque device ids helps nobody.
  // Disabled mid-take: MediaRecorder is bound to the stream it was constructed
  // with, so switching would mean silently restarting the recording.
  const deviceSelect = (inputDevices.length > 1) && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 0.9rem', textAlign: 'left' }}>
      <span style={{ fontSize: '1.05rem' }} aria-hidden="true">🎤</span>
      <select
        aria-label={t('輸入裝置', 'Input device')}
        value={deviceId}
        disabled={phase !== 'idle' && phase !== 'preview'}
        onChange={(e) => chooseDevice(e.target.value)}
        style={{ flex: 1, minWidth: 0, padding: '0.4rem 0.5rem', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: '0.85rem' }}
      >
        {inputDevices.map(d => (
          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
        ))}
      </select>
    </div>
  );

  // Which input this take is actually using. Shown during recording (where the
  // picker is disabled) so a wrong device is still visible mid-take.
  const inputMonitor = () => (deviceLabel ? (
    <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.9rem', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      🎤 {deviceLabel}
    </div>
  ) : null);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex, padding: '1rem' }}
    >
      <div style={{ background: '#fff', borderRadius: 14, padding: '1.6rem 1.5rem', width: 'min(460px, 100%)', maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.25)', borderLeft: '4px solid #16a34a', textAlign: 'center' }}>
        <h3 style={{ color: '#1e293b', marginTop: 0 }}>{t('用你的聲音錄這節', 'Record this verse in your voice')}</h3>
        {/* Whole-chapter verses (e.g. Psalm 18) run thousands of chars —
            the text box scrolls on its own so the record/save controls
            below never get pushed off screen. */}
        {/* 1.38rem = reading-aloud size (+50% over the old 0.92rem body). */}
        <div style={{ textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.6rem 0.8rem', margin: '0 0 0.8rem', fontSize: '1.38rem', lineHeight: 1.7, color: '#334155', maxHeight: '38dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {reference && <div style={{ fontWeight: 600, marginBottom: 4, color: '#3b82f6', fontSize: '1.05rem' }}>{reference}</div>}
          {verseText ? t('「{verse}」', '“{verse}”').replace('{verse}', verseText) : ''}
          <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 6 }}>
            {t('照著唸就好。聽這個題庫的人會聽到你的聲音,而不是電腦語音 🎙️', 'Just read it aloud. Listeners will hear your voice instead of the computer voice 🎙️')}
          </div>
        </div>
        <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.8rem' }}>
          {t('不限長度，長經文放心慢慢唸。重錄會取代舊錄音。', 'No length limit — take your time with long passages. Re-recording replaces the old one.')}
        </div>

        {phase === 'idle' && (
          <div>
            {deviceSelect}
            <div style={{ display: 'flex', gap: 18, justifyContent: 'center', alignItems: 'center' }}>
              <button onClick={startRecording} style={{ width: 84, height: 84, borderRadius: '50%', border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: '1.6rem', boxShadow: '0 8px 24px rgba(220,38,38,0.4)' }} title={t('開始錄音', 'Start recording')}>
                🎙️
              </button>
              <button onClick={() => fileInputRef.current?.click()} style={{ width: 84, height: 84, borderRadius: '50%', border: '2px solid #cbd5e1', background: '#f8fafc', color: '#334155', cursor: 'pointer', fontSize: '1.6rem' }} title={t('上傳錄音檔', 'Upload an audio file')}>
                📂
              </button>
            </div>
            <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.7rem' }}>
              {t('已經有錄好的 MP3?按📂上傳', 'Already have an MP3? Tap 📂 to upload')}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,.mp3"
              onChange={pickFile}
              style={{ display: 'none' }}
            />
          </div>
        )}
        {phase === 'recording' && (
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 'bold', color: '#dc2626', marginBottom: '0.6rem' }}>● {timeLabel}</div>
            {inputMonitor()}
            <button onClick={stopRecording} style={{ padding: '0.6rem 1.6rem', borderRadius: 10, border: 'none', background: '#1e293b', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
              ⏹ {t('停止', 'Stop')}
            </button>
          </div>
        )}
        {(phase === 'preview' || phase === 'uploading' || phase === 'processing') && (
          <div>
            {/* Picker stays available here: if 試聽 turns out silent, the next
                thing you want is to switch device and hit 重錄. */}
            {/* A mic device label under an UPLOADED clip would be a lie — show
                where the audio actually came from instead. */}
            {fromFile ? (
              <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 0.9rem', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                📂 {fileName}
              </div>
            ) : (deviceSelect || inputMonitor())}
            {showShareToggle && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, textAlign: 'left', margin: '0 0 0.9rem', cursor: 'pointer', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '0.55rem 0.7rem' }}>
                <input type="checkbox" checked={sharePublic} onChange={(e) => setSharePublic(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: '#16a34a', flexShrink: 0 }} />
                <span style={{ fontSize: '0.85rem', color: '#166534', lineHeight: 1.45 }}>
                  <b>{t('分享給大家', 'Share with everyone')}</b>
                  <span style={{ display: 'block', color: '#15803d', fontSize: '0.78rem' }}>
                    {t('你的錄音會成為這個經文組的公開語音選項,別人播放時可以選擇聽你的聲音。', 'Your recording becomes a public voice option for this set — others can choose to hear your voice when they play it.')}
                  </span>
                </span>
              </label>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={togglePreview} disabled={phase !== 'preview'} style={{ padding: '0.55rem 1.1rem', borderRadius: 10, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', cursor: 'pointer' }}>
                {previewPlaying ? `⏸ ${t('停止', 'Stop')}` : `▶ ${t('試聽', 'Preview')} (${timeLabel})`}
              </button>
              <button onClick={discardAndRerecord} disabled={phase !== 'preview'} style={{ padding: '0.55rem 1.1rem', borderRadius: 10, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', cursor: 'pointer' }}>
                {fromFile ? `📂 ${t('重新選擇', 'Choose another')}` : `🎙️ ${t('重錄', 'Re-record')}`}
              </button>
              <button onClick={send} disabled={phase !== 'preview'} style={{ padding: '0.55rem 1.4rem', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #34d399, #10b981)', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                {t('儲存錄音', 'Save recording')}
              </button>
            </div>
            <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.6rem' }}>
              {t('儲存後會在背景上傳,你可以直接錄下一節', 'Uploading runs in the background — go ahead and record the next verse')}
            </div>
          </div>
        )}

        {error && <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.8rem' }}>{error}</div>}

        <div style={{ marginTop: '1rem' }}>
          <button onClick={close} disabled={phase === 'uploading'} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>
            {t('取消', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
