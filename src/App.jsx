import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Pause, RotateCcw, Heart, Zap, Trophy, Crown, Star, Home, XCircle, Headphones, Music, VolumeX, Search, Share2, Dices, Mic, MicOff, Users, CloudRain, Info, Edit, TreePine, Gamepad2, Map, Settings, Library, Volume2, Shuffle, Swords, ShoppingBasket, Apple, Mail, Lock, Sprout, Leaf, RotateCw, Smartphone, Hourglass, Frown, X, Camera, Square, Copy, ArrowRightLeft, MessageCircle, Languages, ChevronUp, ChevronDown } from 'lucide-react';
import confetti from 'canvas-confetti';
import usePartySocket from 'partysocket/react';
import PartySocket from 'partysocket';
import QRCode from 'qrcode';
import { QRCodeSVG } from 'qrcode.react';
import { classifyGardenResponse, decideGardenSync, buildFruitAuthorKeys, aggregateFruitResults } from './lib/gardenSync.js';
import { voiceId, voiceMatchesSavedKey, dedupeVoices, buildVoiceOptions } from './lib/voicePicker.js';
import { splitVersePhrases } from './lib/phraseSplitter.js';
import { stripLeadingVerseNumeral } from './lib/bibleTextMarkup.js';
import { getSpeechLangForVersion, isEnglishBibleVersion as isEnglishLangId } from './lib/speechLang.js';
import { LANG_OPTIONS, baseLang, annotationOf, uiLangFor, langLabel as langLabelOf } from './lib/lang.js';
import { localizeSet, itemZh, itemEn, pickText, isBilingualItem, splitParagraphs, defaultLabel, normalizeItemsForSave, setSimplifiedConverter, hasSimplifiedConverter } from './lib/content.js';
import Annotated from './Annotated.jsx';
import { loadAnnotator } from './lib/annotate.js';
import './index.css';
import I18N_FILLINS from './i18nFillins';
import ChallengeSetupModal, { loadChallengeSetup } from './ChallengeSetupModal';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { GOOGLE_CLIENT_ID, APPLE_CLIENT_ID, APPLE_REDIRECT_URI } from './oauthConfig';
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array, isWebPushSupported, isIOSStandalone, isIOSWithoutPWA, hasNativeDailyPush, callNativeDailyPush } from './pushConfig';
import { setVoiceApi, uploadVerseVoice, uploadSetAsset, compressBackgroundImage, getSetAssetDataUrl, userVoiceApi, uploadUserVerseVoice, voiceOwnerId, voiceCommentApi, uploadVoiceComment } from './setVoiceApi';
import VerseVoiceRecorder from './VerseVoiceRecorder';

// Lazy-load heavy, feature-specific chunks so they stay OUT of the initial bundle
// and download only when the feature is opened (behind a <Suspense>):
//   • WorldMap → the 3D globe (three / react-globe.gl), only on the Map tab
//   • BlindModeGame → recitation matching (pinyin-pro / opencc-js), only in blind mode
//   • ReactQuill → the rich-text editor (react-quill-new + its CSS), only when editing a set
const WorldMap = React.lazy(() => import('./WorldMap'));
const BlindModeGame = React.lazy(() => import('./BlindModeGame'));
const ReactQuill = React.lazy(() => import('./LazyQuill'));

// Temporarily hide the per-row action buttons on the Scripture Sets list
// (Admin 編輯 / Admin 刪除 / 複製) — low value for now. Flip to true to restore.
const SHOW_SET_LIST_ROW_ACTIONS = false;

// Loose verses (random / daily / search / shared single verse) have no
// originating set to file a personal recording under. They all share this one
// reserved per-user bucket — a private "single-verse collection" keyed by
// verse reference — so the 🎙️ record button is always available (once signed
// in) and a loose recording persists & replays wherever that verse reappears.
const PERSONAL_LOOSE_SET_ID = '__personal_verses__';

// How long playback waits for the "which verses have a recording" lists before
// giving up and reading with TTS.
//
// This is NOT the audio download — that has no cap, and never needed one. It is
// only the small JSON that says whether a recording exists at all. The decision
// is therefore: find out first, then wait for the audio as long as it takes.
//
// It used to be 3s, which is fine on wifi and wrong on a phone: the list hadn't
// landed yet, the verse looked like it had no recording, and the listener got
// TTS even though the creator's voice existed. Someone opening a shared listen
// link came specifically for that voice, so a few seconds of quiet is much
// cheaper than silently substituting the robot. The lists resolve on failure
// too, so a dead request still falls through immediately rather than burning
// the whole budget.
const VOICE_LIST_WAIT_MS = 12000;
import { bakeBeautifiedBlob } from './voiceBeautify';
import { SET_BACKGROUND_THEMES, getSetBackgroundUrl, getSetBackgroundVideoUrl } from './setBackgrounds';
import QrScanner from 'qr-scanner';

const quillModules = {
  toolbar: [
    [{ 'header': [1, 2, 3, 4, false] }],
    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
    ['link', 'image', 'video'],
    ['clean']
  ],
};

let audioCtx = null;

const ROOM_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const PUBLIC_APP_ORIGIN = 'https://www.verserain.com';

// Split a lobby tile caption into two balanced lines on the first natural
// break. Without this, the auto-wrap leaves the final 「化。/年。/歡。」
// character orphaned on its own line. We look for full-width 「，、」
// (Chinese / Japanese / Korean) or " — " (English em-dash); if none
// exists the text stays one line and word-wrap takes over.
function splitCaption(text) {
  if (typeof text !== 'string' || text.length < 8) return text;
  const candidates = ['，', '、', '—', ' - '];
  for (const sep of candidates) {
    const idx = text.indexOf(sep);
    if (idx > 0 && idx < text.length - 1) {
      // Keep the separator on the first line where natural (commas, dashes),
      // moving only the part AFTER it to a new line.
      return text.slice(0, idx + sep.length) + '\n' + text.slice(idx + sep.length).trim();
    }
  }
  return text;
}
const tileCaptionStyle = (opacity = 0.9) => ({
  fontSize: '1rem', margin: 0, opacity, whiteSpace: 'pre-line', lineHeight: 1.5,
});

// Detect whether the page is running inside the VerseRain iOS WKWebView.
// We use three signals: a URL query marker the native app sets, the presence
// of a native bridge handler the Swift app injects, and a fallback UA sniff.
function isInIosNativeApp() {
  if (typeof window === 'undefined') return false;
  try {
    if (new URL(window.location.href).searchParams.has('iosApp')) return true;
  } catch { /* ignore */ }
  if (window.webkit?.messageHandlers?.googleSignIn) return true;
  return false;
}

// Returns the iOS native app's version string ("3.6.1-build42") or null when
// we're not in the wrapper app. The app injects this via its homeURL's
// `?iosApp=` query, so query persistence matters — see WebView.swift.
function getIosAppVersion() {
  if (typeof window === 'undefined') return null;
  try {
    return new URL(window.location.href).searchParams.get('iosApp') || null;
  } catch { return null; }
}

// Camera (getUserMedia) calls inside WKWebView crash the app immediately if
// the host bundle's Info.plist lacks NSCameraUsageDescription — there's no
// JS-side catch path because iOS kills the process before the prompt is
// shown. The description was added in app version 3.7.0, so for any older
// build we hide the QR scan affordance entirely and fall back to manual
// paste.
function iosAppSupportsCamera() {
  const raw = getIosAppVersion();
  if (!raw) return true; // Not in the wrapper app — Safari handles its own permission prompt.
  const match = String(raw).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [, mj, mn] = match.map(Number);
  return mj > 3 || (mj === 3 && mn >= 7);
}

// ─── Google + Apple OAuth buttons ───────────────────────────────────────────
// We render our own styled buttons (instead of the GIS iframe button) because
// Google's renderButton iframe is unreliable on iOS Safari (ITP blocks the
// cross-origin frame and the button silently renders blank). Click flow:
//   Google web → google.accounts.oauth2.initTokenClient → popup → access_token
//   Google app → window.webkit.messageHandlers.googleSignIn → native
//                ASWebAuthenticationSession → access_token via JS callback
//   Apple      → window.AppleID.auth.signIn → popup → id_token
// We hand the credential up to the parent, which forwards it to the backend
// /oauth-login endpoint for verification.
// Modal for binding/recovering a referrer code. Two ways in:
//   • paste an invite URL or 10-char code into the text field, OR
//   • tap "📷 掃 QR" → camera preview → auto-detect QR → auto-fill.
// Either way the final save flow is identical (extract ref, validate,
// persist locally + push to PartyKit).
function BindInviterModal({ t, personalCode, userEmail, setMyInviterCode, setToast, onClose }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [inputValue, setInputValue] = useState('');
  // Old App builds (< 3.7.0) crash on any getUserMedia call — see comment on
  // iosAppSupportsCamera() — so we render a "please use Safari" notice in
  // place of the scan button until the App Store rollout completes.
  const cameraDisabledInApp = isInIosNativeApp() && !iosAppSupportsCamera();

  // Stop and free the camera when the modal closes / unmounts.
  useEffect(() => {
    return () => {
      try { scannerRef.current?.stop(); scannerRef.current?.destroy(); } catch {}
      scannerRef.current = null;
    };
  }, []);

  const extractCode = (raw) => {
    let code = String(raw || '').trim();
    if (!code) return null;
    try {
      const parsed = new URL(code);
      const refParam = parsed.searchParams.get('ref');
      if (refParam) code = refParam;
    } catch { /* not a URL — assume bare code */ }
    return code.trim();
  };

  const persistAndClose = async (code) => {
    if (!/^[A-HJ-NP-Za-km-z2-9]{10}$/.test(code)) {
      alert(t('推薦碼格式不正確，應為 10 個字母/數字。', 'Invalid format. Expected 10 letters/numbers.'));
      return;
    }
    if (code === personalCode) {
      alert(t('不能填自己的推薦碼。', "You can't use your own code."));
      return;
    }
    localStorage.setItem('verserain_inviter', code);
    localStorage.removeItem('verserain_invite_claimed');
    setMyInviterCode(code);
    if (userEmail) {
      fetch(`${PARTY_DB}/bind-inviter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, inviter: code }),
      }).catch(() => {});
    }
    onClose();
    setToast(t('已綁定推薦人，下次過關會自動補上點數。', 'Referrer bound. Your next paragraph clear will credit both sides.'));
    setTimeout(() => setToast(null), 4000);
  };

  const startScan = async () => {
    setScanError('');
    setScanning(true);
    try {
      // qr-scanner needs the <video> element to exist; defer to next tick so
      // React has rendered the conditional preview block.
      await new Promise(r => setTimeout(r, 0));
      if (!videoRef.current) throw new Error('Video element not mounted');
      const cameras = await QrScanner.listCameras(true).catch(() => []);
      if (!cameras.length) {
        setScanError(t('找不到相機，請確認權限。', 'No camera found. Please check permissions.'));
        setScanning(false);
        return;
      }
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          const data = typeof result === 'string' ? result : result?.data;
          const code = extractCode(data);
          if (code && /^[A-HJ-NP-Za-km-z2-9]{10}$/.test(code)) {
            try { scanner.stop(); scanner.destroy(); } catch {}
            scannerRef.current = null;
            setScanning(false);
            setInputValue(code);
            persistAndClose(code);
          }
        },
        { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true }
      );
      scannerRef.current = scanner;
      await scanner.start();
    } catch (e) {
      console.error('QR scan failed', e);
      setScanError(
        e?.name === 'NotAllowedError'
          ? t('相機權限被拒絕，請改用手動輸入。', 'Camera permission denied. Please paste the code instead.')
          : t('無法啟動相機。請改用手動輸入。', 'Could not start camera. Please paste the code instead.')
      );
      setScanning(false);
      try { scannerRef.current?.destroy(); } catch {}
      scannerRef.current = null;
    }
  };

  const stopScan = () => {
    try { scannerRef.current?.stop(); scannerRef.current?.destroy(); } catch {}
    scannerRef.current = null;
    setScanning(false);
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) { stopScan(); onClose(); } }}>
      <div style={{ background: '#fff', borderRadius: '14px', padding: '1.6rem 1.4rem', width: '100%', maxWidth: '440px', boxShadow: '0 20px 40px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b' }}>
            🤝 {t('補上推薦碼', 'Add My Referrer')}
          </h2>
          <button onClick={() => { stopScan(); onClose(); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><XCircle size={22} /></button>
        </div>
        <p style={{ margin: '0 0 1rem 0', color: '#475569', fontSize: '0.88rem', lineHeight: 1.5 }}>
          {t('掃描推薦人的 QR Code，或貼上邀請連結／10 字元推薦碼。下次過關時雙方都會獲得獎勵。', "Scan your referrer's QR code, or paste their invite link / 10-char code. After your next verse clear, both of you will receive the reward.")}
        </p>

        {cameraDisabledInApp ? (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '0.7rem 0.9rem', borderRadius: '10px', fontSize: '0.88rem', lineHeight: 1.45, marginBottom: '0.9rem' }}>
            📱 {t('目前 App 版本不支援掃描，請在 Safari 開 verserain.com 掃描，或在下方手動貼上推薦碼。下次 App 更新後會自動可用。', 'This App version does not support scanning yet. Please open paragraphrain.com in Safari to scan, or paste the code below. Scanning will work after the next App update.')}
          </div>
        ) : !scanning ? (
          <button
            type="button"
            onClick={startScan}
            style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '10px', background: '#0ea5e9', color: '#fff', border: 'none', fontSize: '0.98rem', fontWeight: 'bold', cursor: 'pointer', marginBottom: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            <Camera size={18} /> {t('掃描 QR Code', 'Scan QR Code')}
          </button>
        ) : (
          <div style={{ marginBottom: '0.9rem' }}>
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#000' }}>
              <video ref={videoRef} playsInline muted style={{ width: '100%', display: 'block', aspectRatio: '1 / 1', objectFit: 'cover' }} />
            </div>
            <button
              type="button"
              onClick={stopScan}
              style={{ width: '100%', padding: '0.6rem 1rem', borderRadius: '10px', background: '#475569', color: '#fff', border: 'none', fontSize: '0.92rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '0.6rem' }}
            >
              {t('停止掃描', 'Stop scanning')}
            </button>
          </div>
        )}

        {scanError && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '0.65rem 0.8rem', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '0.9rem' }}>
            {scanError}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#94a3b8', fontSize: '0.78rem', margin: '0.4rem 0' }}>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
          <span>{t('或手動輸入', 'or paste')}</span>
          <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
        </div>

        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={t('https://verserain.com/?ref=XXXXXXXXXX 或 XXXXXXXXXX', 'https://paragraphrain.com/?ref=XXXXXXXXXX or XXXXXXXXXX')}
          style={{ width: '100%', padding: '0.7rem 0.85rem', borderRadius: '10px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontSize: '0.95rem', boxSizing: 'border-box' }}
        />
        <button
          onClick={() => {
            stopScan();
            const code = extractCode(inputValue);
            if (code) persistAndClose(code);
          }}
          style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '10px', background: 'linear-gradient(135deg, #f59e0b, #ea580c)', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '0.8rem' }}
        >
          {t('儲存', 'Save')}
        </button>
      </div>
    </div>
  );
}

// "My Referrer" pill on the Garden page. Surfaces whether the player's
// account is bound to an inviter, so missing bindings (the QR-scan-on-iOS
// silent-loss class of bug) are immediately visible.
function InviterCard({ inviterCode, inviterName, canEdit, onOpenBindModal, t }) {
  const bound = !!inviterCode;
  // inviterName is tri-state: undefined = looking up, null = no mapping
  // exists for this code, string = the nickname. We prefer the nickname so
  // the card never surfaces the cryptic 10-char code; only legacy inviters
  // with no name mapping fall through to "(暱稱未提供)".
  const displayName =
    inviterName === undefined ? '…'
    : inviterName === null    ? t('（暱稱未提供）', '(nickname unavailable)')
    : inviterName;
  return (
    <div
      style={{
        background: bound
          ? 'linear-gradient(135deg, #fdf4ff, #fae8ff)'
          : 'linear-gradient(135deg, #fff7ed, #fed7aa)',
        border: bound ? '1px solid #e9d5ff' : '1px solid #fdba74',
        borderRadius: '14px',
        padding: '1rem 1.2rem',
        marginBottom: '1.75rem',
        boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.8rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0 }}>
        <div style={{ fontSize: '1.8rem' }}>{bound ? '🌟' : '🤝'}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.78rem', color: bound ? '#6b21a8' : '#9a3412', fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {t('我的推薦人', 'My Referrer')}
          </div>
          <div style={{ fontSize: '1.05rem', color: bound ? '#581c87' : '#7c2d12', fontWeight: 700, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bound ? displayName : t('尚未綁定推薦人', 'No referrer bound yet')}
          </div>
        </div>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onOpenBindModal}
          style={{
            background: '#ea580c',
            color: '#fff',
            border: 'none',
            padding: '0.55rem 1rem',
            borderRadius: '8px',
            fontWeight: 700,
            fontSize: '0.9rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('補上推薦碼', 'Add Referrer')}
        </button>
      )}
    </div>
  );
}

function OAuthButtons({ onGoogleCredential, onAppleCredential, disabled, t }) {
  const inIosApp = isInIosNativeApp();
  const nativeBridge = inIosApp && typeof window !== 'undefined' && window.webkit?.messageHandlers?.googleSignIn;
  const nativeAppleBridge = inIosApp && typeof window !== 'undefined' && window.webkit?.messageHandlers?.appleSignIn;
  const googleClientRef = useRef(null);
  const appleInitialized = useRef(false);

  // Initialize Google OAuth2 token client once the gsi script is loaded.
  // Skipped when running inside the iOS app — Google blocks OAuth in WebViews,
  // so we instead use a native bridge (see handleGoogleClick).
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || inIosApp) return;
    let cancelled = false;
    const init = () => {
      if (cancelled) return false;
      const oauth2 = window.google?.accounts?.oauth2;
      if (!oauth2) return false;
      try {
        googleClientRef.current = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'openid email profile',
          callback: (response) => {
            if (response?.access_token) onGoogleCredential(response.access_token);
          },
        });
        return true;
      } catch { return false; }
    };
    if (init()) return () => { cancelled = true; };
    const interval = setInterval(() => { if (init()) clearInterval(interval); }, 200);
    const stop = setTimeout(() => clearInterval(interval), 8000);
    return () => { cancelled = true; clearInterval(interval); clearTimeout(stop); };
  }, [onGoogleCredential, inIosApp]);

  // Register a global callback the native app calls after completing the
  // ASWebAuthenticationSession OAuth flow. The Swift code evaluates:
  //   window.__verseRainNativeOAuth('google', '<access_token>')
  useEffect(() => {
    if (!inIosApp) return;
    window.__verseRainNativeOAuth = (provider, credential, extra) => {
      if (provider === 'google' && credential) onGoogleCredential(credential);
      else if (provider === 'apple' && credential) onAppleCredential(credential, extra || {});
    };
    return () => { try { delete window.__verseRainNativeOAuth; } catch {} };
  }, [inIosApp, onGoogleCredential, onAppleCredential]);

  // Initialize Apple SDK; the button itself is rendered with our own styles.
  // Skipped in the iOS app — we use the native ASAuthorizationAppleIDProvider
  // bridge instead of Apple's web JS SDK.
  useEffect(() => {
    if (inIosApp || !APPLE_CLIENT_ID || appleInitialized.current) return;
    let cancelled = false;
    const init = () => {
      if (cancelled || !window.AppleID?.auth) return false;
      try {
        window.AppleID.auth.init({
          clientId: APPLE_CLIENT_ID,
          scope: 'name email',
          redirectURI: APPLE_REDIRECT_URI,
          usePopup: true,
        });
        appleInitialized.current = true;
        return true;
      } catch { return false; }
    };
    if (init()) return () => { cancelled = true; };
    const interval = setInterval(() => { if (init()) clearInterval(interval); }, 200);
    const stop = setTimeout(() => clearInterval(interval), 8000);
    return () => { cancelled = true; clearInterval(interval); clearTimeout(stop); };
  }, []);

  const handleGoogleClick = () => {
    if (disabled) return;
    if (nativeBridge) {
      // Native iOS app with bridge — let Swift open ASWebAuthenticationSession.
      try { window.webkit.messageHandlers.googleSignIn.postMessage({}); } catch {}
      return;
    }
    if (inIosApp) {
      // iOS app without the native bridge yet (i.e. running an older build).
      // Inform the user the app needs to be updated.
      alert(t(
        '此版本 App 尚不支援 Google 登入。請更新 App，或先用下方 email / 密碼登入。',
        'This app version does not yet support Google sign-in. Please update the app, or use email / password below.'
      ));
      return;
    }
    if (!googleClientRef.current) return;
    googleClientRef.current.requestAccessToken();
  };

  const handleAppleClick = async () => {
    if (disabled) return;
    if (nativeAppleBridge) {
      // Native iOS app — let Swift open ASAuthorizationAppleIDProvider.
      try { window.webkit.messageHandlers.appleSignIn.postMessage({}); } catch {}
      return;
    }
    if (inIosApp) {
      alert(t(
        '此版本 App 尚不支援 Apple 登入。請更新 App，或先用下方 email / 密碼登入。',
        'This app version does not yet support Apple sign-in. Please update the app, or use email / password below.'
      ));
      return;
    }
    if (!window.AppleID?.auth) return;
    try {
      const result = await window.AppleID.auth.signIn();
      const idToken = result?.authorization?.id_token;
      if (idToken) onAppleCredential(idToken);
    } catch { /* user cancelled */ }
  };

  // Show the Apple button when in the iOS app (native bridge handles it) or
  // when the web Services ID is configured.
  const showAppleButton = inIosApp || !!APPLE_CLIENT_ID;

  if (!GOOGLE_CLIENT_ID && !showAppleButton) {
    return (
      <div style={{ fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '6px', padding: '0.7rem' }}>
        {t(
          'Google / Apple 登入尚未設定。請在 src/oauthConfig.js 填入 Client ID。',
          'Google / Apple sign-in not configured. Fill in Client IDs in src/oauthConfig.js.'
        )}
      </div>
    );
  }

  const baseBtnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
    width: '100%', padding: '0.85rem 1rem', borderRadius: '8px',
    fontSize: '0.95rem', fontWeight: '600',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {GOOGLE_CLIENT_ID && (
        <button
          type="button"
          onClick={handleGoogleClick}
          disabled={disabled}
          style={{ ...baseBtnStyle, background: '#fff', color: '#3c4043', border: '1px solid #dadce0' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          {t('使用 Google 繼續', 'Continue with Google')}
        </button>
      )}
      {showAppleButton && (
        <button
          type="button"
          onClick={handleAppleClick}
          disabled={disabled}
          style={{ ...baseBtnStyle, background: '#000', color: '#fff', border: '1px solid #000' }}
        >
          <svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
            <path d="M11.624 10.628c-.02-2.027 1.66-3.001 1.736-3.05-.946-1.382-2.418-1.571-2.943-1.593-1.252-.127-2.44.738-3.075.738-.635 0-1.612-.72-2.65-.7-1.366.02-2.622.793-3.327 2.012-1.42 2.461-.363 6.105 1.02 8.103.674 1.0 1.476 2.119 2.527 2.079 1.012-.04 1.395-.654 2.62-.654s1.567.654 2.638.634c1.088-.02 1.778-1.018 2.444-2.018.77-1.158 1.087-2.279 1.107-2.339-.024-.012-2.126-.815-2.147-3.232zM9.667 4.624c.553-.668.928-1.6.824-2.524-.798.032-1.764.531-2.336 1.198-.513.591-.962 1.54-.84 2.448.892.07 1.798-.453 2.352-1.122z" />
          </svg>
          {t('使用 Apple 繼續', 'Continue with Apple')}
        </button>
      )}
    </div>
  );
}

// UI languages the app can render directions in. Used to validate ?lang= on
// incoming share links so a junk value can't strand someone in a half-locale.
// 操作手冊教學影片：進入視窗才播放、離開就暫停，避免手冊頁一次載入多支影片。
function ManualVideo({ src, poster, caption }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) el.play().catch(() => {});
      else el.pause();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <figure style={{ margin: '0.5rem 0 2.5rem' }}>
      <video ref={ref} src={src} poster={poster} muted loop playsInline controls preload="metadata"
        style={{ width: '100%', display: 'block', borderRadius: '10px', boxShadow: '0 6px 16px rgba(15,23,42,0.18)', background: '#0f172a' }} />
      {caption && <figcaption style={{ fontSize: '0.88rem', color: '#64748b', textAlign: 'center', marginTop: '0.5rem', lineHeight: 1.5 }}>{caption}</figcaption>}
    </figure>
  );
}

const SUPPORTED_UI_LANGS = ['zh', 'cuvs', 'en'];
import { PARTY_ORIGIN, PARTY_WS_HOST, PARTY_DB } from './lib/partyHost.js';

// Document title per UI language — index.html ships the zh title, so without
// this the browser tab stays Chinese for everyone (including recipients of a
// share link opened in an in-app browser, where the tab title is prominent).
const APP_TITLE_BY_LANG = {
  zh: '聽&說 Listen&Speak — 聽一聽、說一說，把好文記在心裡',
  cuvs: '听&说 Listen&Speak — 听一听、说一说，把好文记在心里',
  en: 'Listen&Speak — Hear it, say it, keep it by heart',
};

// The sender's current UI language, mirrored out of React state so the
// module-level share-link builder can stamp it onto every outgoing link.
// Without this, a recipient who has never picked a language falls back to the
// app default (zh) and reads Chinese directions under an English verse set.
let SHARE_UI_LANG = '';

function buildPublicShareUrl(path = '/', params = {}) {
  const normalizedPath = path && path.startsWith('/') ? path : '/';
  const url = new URL(normalizedPath, PUBLIC_APP_ORIGIN);
  // `lang` first so an explicit params.lang from the caller still wins.
  const withLang = { ...(SHARE_UI_LANG ? { lang: SHARE_UI_LANG } : {}), ...params };
  Object.entries(withLang).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

// Deep-link params are scrubbed from the address bar once consumed, but ?lang=
// has to survive: it is what holds the recipient's UI in the sender's language
// across a reload (we never write it to their localStorage).
// ─── In-app history (browser ← → buttons) ───────────────────────────────
// The app keeps every "page" in React state, so without this the browser's
// Back button left the site. We mirror the page-like state into the URL hash
// (#garden, #versesets/<id>/listen, #multiplayer/room/<id>, <tab>/play …) and
// push one history entry per step; popstate applies the hash back to state.
// Only the query string carries share links (?listenSet= …) — those are
// consumed and scrubbed as before, and every scrub must keep the hash.
const ROUTE_TABS = ['lobby', 'versesets', 'custom_verses', 'multiplayer', 'daily_verse', 'advanced', 'garden', 'search', 'map', 'manual', 'about', 'bilingual_rain', 'leaderboard'];
const ROUTE_FLAGS = ['listen', 'edit', 'play', 'room'];
function parseRoute(hash) {
  const seg = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const tab = ROUTE_TABS.includes(seg[0]) ? seg[0] : 'lobby';
  const r = { tab, setId: null, listen: false, edit: false, play: false, roomId: null };
  let i = 1;
  if (tab === 'versesets' && seg[1] && !ROUTE_FLAGS.includes(seg[1])) { r.setId = decodeURIComponent(seg[1]); i = 2; }
  for (; i < seg.length; i++) {
    if (seg[i] === 'room') { r.roomId = seg[i + 1] ? decodeURIComponent(seg[i + 1]) : null; i++; }
    else if (seg[i] === 'listen') r.listen = true;
    else if (seg[i] === 'edit') r.edit = true;
    else if (seg[i] === 'play') r.play = true;
  }
  return r;
}
function routeFromState({ mainTab, selectedSetId, editing, listening, playing, roomId }) {
  const tab = ROUTE_TABS.includes(mainTab) ? mainTab : 'lobby';
  let route = tab;
  if (tab === 'versesets' && selectedSetId) route += '/' + encodeURIComponent(selectedSetId);
  if (roomId) route = 'multiplayer/room/' + encodeURIComponent(roomId);
  else if (tab === 'custom_verses' && editing) route += '/edit';
  else if (listening) route += '/listen';
  if (playing) route += '/play';
  return route;
}

function pathWithSharedLang() {
  const hash = window.location.hash || '';
  try {
    const lang = new URLSearchParams(window.location.search).get('lang');
    if (lang && SUPPORTED_UI_LANGS.includes(lang)) {
      return `${window.location.pathname}?lang=${encodeURIComponent(lang)}${hash}`;
    }
  } catch { /* noop */ }
  return window.location.pathname + hash;
}

function createRoomCode(length = 4) {
  return Array.from({ length }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
}

function sanitizeRoomCode(value) {
  return String(value || '').replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 4);
}

const TEAM_OPTIONS = [
  { id: 'love', name: '仁愛隊', enName: 'Love Team', color: '#ef4444' },
  { id: 'joy', name: '喜樂隊', enName: 'Joy Team', color: '#f59e0b' },
  { id: 'peace', name: '和平隊', enName: 'Peace Team', color: '#0ea5e9' },
  { id: 'patience', name: '忍耐隊', enName: 'Patience Team', color: '#8b5cf6' },
  { id: 'kindness', name: '恩慈隊', enName: 'Kindness Team', color: '#ec4899' },
  { id: 'goodness', name: '良善隊', enName: 'Goodness Team', color: '#22c55e' },
  { id: 'faithfulness', name: '信實隊', enName: 'Faithfulness Team', color: '#14b8a6' },
  { id: 'gentleness', name: '溫柔隊', enName: 'Gentleness Team', color: '#a855f7' },
  { id: 'self-control', name: '節制隊', enName: 'Self-Control Team', color: '#64748b' }
];

const getTeamById = (teamId, stateTeams = TEAM_OPTIONS) => {
  return (stateTeams || TEAM_OPTIONS).find(team => team.id === teamId) || TEAM_OPTIONS.find(team => team.id === teamId);
};

const getTeamResultsFromState = (state) => {
  if (!state) return [];
  if (Array.isArray(state.teamResults) && state.teamResults.length > 0) return state.teamResults;
  const teams = state.teams || TEAM_OPTIONS;
  return teams.map(team => {
    const members = Object.values(state.players || {}).filter(p => p.connected && p.teamId === team.id);
    const membersWithScores = members.map(player => {
      const scoreFromRounds = (state.campaignResults || []).reduce((roundSum, round) => {
        return roundSum + Math.max(0, round.scores?.[player.id] || 0);
      }, 0);
      return { ...player, totalScore: Math.max(scoreFromRounds, player.bestScore || 0, player.score || 0) };
    });
    const scoringMembers = membersWithScores.filter(p => (p.versesCompleted || 0) > 0 || p.isFinished || p.totalScore > 0);
    const totalScore = scoringMembers.reduce((sum, player) => sum + player.totalScore, 0);
    return {
      ...team,
      playerCount: members.length,
      scoringCount: scoringMembers.length,
      completedCount: members.filter(p => p.isFinished).length,
      totalScore,
      averageScore: scoringMembers.length > 0 ? Math.round(totalScore / scoringMembers.length) : 0
    };
  }).filter(team => team.playerCount > 0).sort((a, b) => {
    if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
    return b.playerCount - a.playerCount;
  });
};

const canStartTeamMatch = (state) => {
  return hasEnoughTeamPlayers(state);
};

const hasEnoughTeamPlayers = (state) => {
  const players = Object.values(state?.players || {}).filter(p => p.connected);
  return players.some(p => p.teamId);
};

const SKOOL_LEVELS = [
  { level: 1, title: '互惠種子', enTitle: 'Mutuality Seed', points: 0 },
  { level: 2, title: '探索學員', enTitle: 'Exploring Learner', points: 2 },
  { level: 3, title: '共識實踐者', enTitle: 'Consensus Practitioner', points: 20 },
  { level: 4, title: '價值貢獻者', enTitle: 'Value Contributor', points: 65 },
  { level: 5, title: '生態連結者', enTitle: 'Eco Connector', points: 155 },
  { level: 6, title: '方田開拓者', enTitle: 'Field Pioneer', points: 515 },
  { level: 7, title: '互惠建設者', enTitle: 'Mutuality Builder', points: 2015 },
  { level: 8, title: '推廣大使', enTitle: 'Ambassador', points: 8015 },
  { level: 9, title: '生態系架構師', enTitle: 'Ecosystem Architect', points: 33015 },
];

function getSkoolLevel(points) {
  for (let i = SKOOL_LEVELS.length - 1; i >= 0; i--) {
    if (points >= SKOOL_LEVELS[i].points) {
      return {
        level: SKOOL_LEVELS[i].level,
        title: SKOOL_LEVELS[i].title,
        enTitle: SKOOL_LEVELS[i].enTitle,
        next: i < SKOOL_LEVELS.length - 1 ? SKOOL_LEVELS[i + 1].points : null
      };
    }
  }
  return { level: 1, title: '互惠種子', enTitle: 'Mutuality Seed', next: 2 };
}

function getRoomColor(roomId) {
  if (!roomId) return null;
  let hash = 0;
  for (const c of roomId) hash = (hash * 31 + c.charCodeAt(0)) % ROOM_COLORS.length;
  return ROOM_COLORS[hash];
}

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  // iOS Safari requires SpeechSynthesis to be touched directly in user event.
  // ONLY do this on iOS: on desktop Chrome the user click already grants
  // activation, and this dummy utterance gets cancel()ed by the next real
  // speak before it ever starts — cancelling a not-yet-started utterance
  // DEADLOCKS Chrome's macOS TTS engine (speak() reports speaking=true
  // forever, no audio, until a full browser restart).
  if ('speechSynthesis' in window && !window.__speechUnlocked) {
    window.__speechUnlocked = true;
    const iosLike = /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
      || (/Macintosh/i.test(navigator.userAgent || '') && 'ontouchend' in document);
    if (iosLike) {
      const dummy = new SpeechSynthesisUtterance(' ');
      dummy.volume = 0;
      dummy.rate = 2; // finish fast
      window.speechSynthesis.speak(dummy);
    }
  }
}

// iPadOS 13+ reports a desktop "Macintosh" UA but has a touch screen.
function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

// Start looping background music at a given 0–1 volume.
// iOS Safari IGNORES HTMLMediaElement.volume (it's pinned to 1.0), so a custom
// per-set music level plays at full blast on iPhone/iPad. On iOS we therefore
// route the element through a Web Audio GainNode, which DOES honour the level.
// On desktop plain `.volume` works and avoids any suspended-AudioContext
// silence risk, so we keep it there. Returns the <audio> element; a
// `_bgmDisconnect()` is attached for graph teardown on cleanup.
// Editor slider ↔ stored gain. Loudness is logarithmic, so a linear slider makes
// 5% still sound loud against a quiet voice recording; a squared curve gives the
// bottom of the slider real headroom (10% → 0.01 gain ≈ −40 dB). The stored
// bgMusicVolume stays a plain 0–1 gain, so existing sets sound exactly as before.
const bgmSliderToGain = (pct) => Math.pow(Math.max(0, Math.min(100, pct)) / 100, 2);
const bgmGainToSlider = (gain) => Math.round(Math.sqrt(Math.max(0, Math.min(1, gain ?? 0.18))) * 100);

function startLoopingBgm(src, volume) {
  const audio = new Audio(src);
  audio.loop = true;
  // No floor: the editor slider is perceptual (see bgmSliderToGain), so tiny
  // gains like 0.001 are legitimate "barely there" settings.
  const clamp = (v) => Math.min(1, Math.max(0, v ?? 0.18));
  const vol = clamp(volume);
  let gain = null;
  if (isIOSDevice()) {
    try {
      initAudio(); // ensures the shared AudioContext exists + is resumed
      if (audioCtx) {
        const source = audioCtx.createMediaElementSource(audio);
        gain = audioCtx.createGain();
        gain.gain.value = vol;
        source.connect(gain).connect(audioCtx.destination);
        audio._bgmDisconnect = () => {
          try { source.disconnect(); } catch { /* already gone */ }
          try { gain.disconnect(); } catch { /* already gone */ }
        };
      } else {
        audio.volume = vol;
      }
    } catch {
      gain = null;
      audio.volume = vol; // MediaElementSource unavailable — best effort
    }
  } else {
    audio.volume = vol;
  }
  // Live volume updates (e.g. the editor slider): go through the gain node on
  // iOS, else the element's own volume.
  audio._bgmSetVolume = (v) => {
    const nv = clamp(v);
    if (gain) gain.gain.value = nv; else audio.volume = nv;
  };
  audio.play().catch(() => { /* caller retries / autoplay gate */ });
  return audio;
}

// Per-language fallback voice-name patterns. When the system has no voice
// tagged with the right BCP-47 lang prefix, we'd rather pick a voice whose
// NAME identifies the right language than let the OS auto-pick (which on
// iOS/macOS often falls through to a phonetically-wrong voice — e.g. the
// Arabic "Maged" voice for Persian text because both use Arabic script).
const VOICE_NAME_FALLBACKS = {
  fa: [/soraya/i, /dariush/i, /persian/i, /farsi/i],
  ar: [/maged/i, /majed/i, /tarik/i, /laila/i, /arabic/i],
};
// Languages we must NEVER cross-pollinate from in an emergency fallback.
// Persian and Arabic share script but their phonetics are completely
// different — picking a voice from the wrong language sounds wrong to
// native ears of either side.
const VOICE_LANG_BLOCKLIST = {
  fa: ['ar'], // never pick Arabic for Persian
  ar: ['fa'], // never pick Persian for Arabic (reverse case)
};

function pickSpeechVoice(lang) {
  if (!('speechSynthesis' in window)) return null;
  // Skip any voice flagged as broken this session (see markSuspectVoice) —
  // a corrupted OS voice can wedge Chrome's whole TTS engine.
  const voices = window.speechSynthesis.getVoices().filter(v => !isSuspectVoice(v));
  const langPrefix = String(lang || '').toLowerCase().split('-')[0];
  const isAllowed = (v) => {
    const vp = String(v.lang || '').toLowerCase().split('-')[0];
    const block = VOICE_LANG_BLOCKLIST[langPrefix] || [];
    return !block.includes(vp);
  };

  const byVersionRaw = localStorage.getItem('verseRain_voiceByVersion');
  let byVersion = {};
  try { byVersion = byVersionRaw ? JSON.parse(byVersionRaw) : {}; } catch (e) { byVersion = {}; }
  const activeVersion = localStorage.getItem('verseRain_version') || 'cuv';
  const savedVoiceKey = byVersion?.[activeVersion] || localStorage.getItem('verseRain_voiceName');
  if (savedVoiceKey) {
    // Match by stable voice identity (voiceURI). The picker now saves a
    // voiceId(); voiceMatchesSavedKey also accepts the legacy "name__lang"
    // form so previously-saved selections keep working. Using the unique
    // voiceURI is what fixes "picked a different same-named voice but the
    // sound never changed" on Android — name lookup always hit the first one.
    const exactByVersion = voices.find(v => voiceMatchesSavedKey(v, savedVoiceKey));
    // Only reuse the saved voice when its language matches the text being
    // spoken. The saved key is keyed to the app's ACTIVE version, but the
    // 雙語對調「朗讀第二語言」path calls this with the SECOND language's lang
    // while the active version is still the primary — without this guard we
    // handed e.g. a Chinese voice to Japanese text (iOS then read 日文 with a
    // 中文 voice, choppy). Normal playback is unaffected: there lang always
    // matches the active version's language, so this still returns the save.
    if (exactByVersion
        && String(exactByVersion.lang || '').toLowerCase().startsWith(langPrefix)
        && isAllowed(exactByVersion)) return exactByVersion;
    // Legacy name-only save (`verseRain_voiceName`) could be stale state
    // from a different Bible version → validate before using.
    const byName = voices.find(v => v.name === savedVoiceKey);
    if (byName && byName.lang?.toLowerCase().startsWith(langPrefix) && isAllowed(byName)) {
      return byName;
    }
  }

  // Standard lang-prefix match.
  const exact = voices.find(v => v.lang?.toLowerCase() === String(lang).toLowerCase() && isAllowed(v));
  if (exact) return exact;
  const prefix = voices.find(v => v.lang?.toLowerCase().startsWith(langPrefix) && isAllowed(v));
  if (prefix) return prefix;

  // Name-based fallback for languages where the OS often lacks a properly-
  // tagged voice (e.g. Persian on desktop Chrome, or iOS variants that
  // mistag Persian voices). If the voice's NAME identifies the language
  // explicitly (e.g. "Soraya"), trust it — bypass the blocklist, because
  // the name is more reliable than a possibly-stale lang tag.
  const patterns = VOICE_NAME_FALLBACKS[langPrefix];
  if (patterns) {
    const byName = voices.find(v => patterns.some(p => p.test(v.name || '')));
    if (byName) return byName;
  }

  // Last resort: null — utterance.lang stays set, but we leave utterance.voice
  // unset rather than risk auto-fallback to a blocklisted voice. Speech may
  // be silent on systems that need an explicit voice, but at least it won't
  // mispronounce.
  return null;
}

// ─── Broken-voice watchdog ────────────────────────────────────────────────
// Chrome on macOS can wedge on a corrupted system voice: speak() reports
// speaking=true but 'start' never fires, and every later utterance hangs
// too (only a full browser restart recovers). If a *custom* voice hasn't
// fired 'start' within this window, we cancel it, blacklist that voice for
// the session, and retry the same text with the browser's default voice.
const VOICE_START_TIMEOUT_MS = 1200;

function markSuspectVoice(voice) {
  try {
    if (voice?.voiceURI) sessionStorage.setItem('verseRain_suspect_voice', voice.voiceURI);
  } catch { /* storage unavailable */ }
}

function isSuspectVoice(voice) {
  try {
    return !!voice?.voiceURI && sessionStorage.getItem('verseRain_suspect_voice') === voice.voiceURI;
  } catch { return false; }
}

// Cancel a stuck utterance and re-speak with the default voice. Returns the
// retry utterance so callers can re-wire their own event handlers.
function retryWithDefaultVoice(stuckUtterance, text, rate, lang) {
  markSuspectVoice(stuckUtterance.voice);
  stuckUtterance.onend = null;
  stuckUtterance.onerror = null;
  window.speechSynthesis.cancel();
  const retry = new SpeechSynthesisUtterance(text);
  retry.lang = lang;
  retry.rate = rate;
  retry.volume = 1;
  window.__speech_utterances = window.__speech_utterances || [];
  window.__speech_utterances.push(retry);
  setTimeout(() => window.speechSynthesis.speak(retry), 100);
  return retry;
}

function ensureSpeechVoices() {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) {
      resolve([]);
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }
    const finish = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener?.('voiceschanged', finish, { once: true });
    setTimeout(finish, 900);
  });
}

function estimateSpeechDuration(text, lang) {
  const value = String(text || '');
  const hasCjk = /[\u3400-\u9fff]/.test(value) || String(lang || '').startsWith('zh');
  const estimated = hasCjk ? value.length * 280 : value.length * 120;
  return Math.max(1800, Math.min(estimated + 2200, 30000));
}

function speakTextTimed(text, rate = 1.0, lang = 'zh-TW', voiceOverride = null) {
  return new Promise(async resolve => {
    const startedAt = Date.now();
    const minHoldMs = Math.min(estimateSpeechDuration(text, lang), 2200);
    if (!('speechSynthesis' in window)) {
      setTimeout(resolve, minHoldMs);
      return;
    }

    await ensureSpeechVoices();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.volume = 1;
    // An explicit voiceOverride (e.g. the 朗讀第二語言 picker) wins over the
    // per-version saved default; skip a suspect (session-blacklisted) override.
    const voice = (voiceOverride && !isSuspectVoice(voiceOverride)) ? voiceOverride : pickSpeechVoice(lang);
    if (voice) utterance.voice = voice;

    window.__speech_utterances = window.__speech_utterances || [];
    window.__speech_utterances.push(utterance);

    let resolved = false;
    let started = false;
    let ended = false;
    const safeResolve = () => {
      if (resolved) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minHoldMs) {
        setTimeout(safeResolve, minHoldMs - elapsed);
        return;
      }
      resolved = true;
      utterance.onend = null;
      utterance.onerror = null;
      const idx = window.__speech_utterances.indexOf(utterance);
      if (idx !== -1) window.__speech_utterances.splice(idx, 1);
      resolve();
    };

    utterance.onstart = () => { started = true; };
    utterance.onend = () => { ended = true; safeResolve(); };
    // Chrome may fire onerror immediately when audio is blocked.
    // Keep a human pace fallback instead of resolving instantly.
    utterance.onerror = () => {
      const fallbackMs = Math.min(estimateSpeechDuration(text, lang), 2800);
      setTimeout(safeResolve, fallbackMs);
    };
    // Broken-voice watchdog: custom voice queued but 'start' never fired →
    // blacklist it for the session and re-speak with the default voice.
    if (voice) {
      setTimeout(() => {
        if (started || ended || resolved) return;
        const retry = retryWithDefaultVoice(utterance, text, rate, lang);
        retry.onstart = () => { started = true; };
        retry.onend = () => { ended = true; safeResolve(); };
        retry.onerror = () => setTimeout(safeResolve, 1500);
      }, VOICE_START_TIMEOUT_MS + 50);
    }
    setTimeout(safeResolve, estimateSpeechDuration(text, lang));
    // If speech never starts, still wait a bit so blocks don't "speed-run".
    setTimeout(() => {
      if (!started && !ended) {
        setTimeout(safeResolve, Math.min(estimateSpeechDuration(text, lang), 2200));
      }
    }, 600);
    setTimeout(() => {
      window.speechSynthesis.resume?.();
      window.speechSynthesis.speak(utterance);
    }, 50);
  });
}

function stopSpeechIfActive() {
  if (!('speechSynthesis' in window)) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
}

function speakText(text, rate = 1.0, lang = 'zh-TW') {
  return new Promise(async resolve => {
    if ('speechSynthesis' in window) {
      await ensureSpeechVoices();
      stopSpeechIfActive();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;

      // Use user's preferred voice if set
      // Voice key is stored as "name__lang" format (e.g. "Meijia (Enhanced)__zh-TW")
      try {
        const voice = pickSpeechVoice(lang);
        if (voice) utterance.voice = voice;
      } catch (e) { /* localStorage unavailable */ }

      // Chrome GC bug workaround: keep a global reference to the utterance
      // so the garbage collector doesn't reap it before the audio finishes.
      window.__speech_utterances = window.__speech_utterances || [];
      window.__speech_utterances.push(utterance);

      let resolved = false;
      const safeResolve = () => {
        if (!resolved) {
          resolved = true;
          utterance.onend = null;
          utterance.onerror = null;
          const idx = window.__speech_utterances.indexOf(utterance);
          if (idx !== -1) window.__speech_utterances.splice(idx, 1);
          resolve();
        }
      };

      let started = false;
      utterance.onstart = () => { started = true; };
      utterance.onend = safeResolve;
      utterance.onerror = safeResolve;

      // Safety fallback — keep this generous so slower voices are not cut off early.
      const timeoutMs = Math.max(8000, Math.min(text.length * 500, 30000));
      setTimeout(safeResolve, timeoutMs);

      // Small delay to let iOS audio session settle after cancel(), then speak
      setTimeout(() => {
        window.speechSynthesis.speak(utterance);
      }, 50);

      // Broken-voice watchdog: custom voice queued but 'start' never fired →
      // blacklist it for the session and re-speak with the default voice.
      if (utterance.voice) {
        setTimeout(() => {
          if (started || resolved) return;
          const retry = retryWithDefaultVoice(utterance, text, rate, lang);
          retry.onstart = () => { started = true; };
          retry.onend = safeResolve;
          retry.onerror = safeResolve;
        }, VOICE_START_TIMEOUT_MS + 50);
      }
    } else {
      resolve();
    }
  });
}

const AUTO_PLAY_VERSE_PAUSE_MS = 2000;
const AUTO_PLAY_REFERENCE_PAUSE_MS = 2000;
const HIDDEN_PHRASE_MARK = '•';

function maskPhraseForPreview(phrase = '') {
  return String(phrase).replace(/[^\s.,?!;:：﹕︰，。？！；：]/g, HIDDEN_PHRASE_MARK);
}

function isEnglishBibleVersion(v) {
  return isEnglishLangId(v);
}

// Delegates to src/lib/speechLang.js — the single source of truth shared with
// BlindModeGame's speech recognition, so the two maps can never drift.
function getVoiceLangForVersion(v) {
  return getSpeechLangForVersion(v);
}

const BIBLE_LANGUAGE_OPTIONS = LANG_OPTIONS;

const PLAY_DURATION_OPTIONS = [
  { value: '5', minutes: 5 },
  { value: '10', minutes: 10 },
  { value: '20', minutes: 20 },
  { value: 'infinite', minutes: null }
];
const DEFAULT_PLAY_DURATION_CHOICE = '10';
const PLAY_FONT_OPTIONS = [
  { value: 'xlarge', label: '最大', enLabel: 'XL' },
  { value: 'large', label: '大', enLabel: 'Large' },
  { value: 'normal', label: '中', enLabel: 'Medium' },
  { value: 'small', label: '小', enLabel: 'Small' }
];
const DEFAULT_PLAY_FONT_CHOICE = 'normal';

// Check that a piece of text is likely written in the expected script for the given version.
// Used to reject local verse-set matches that accidentally contain the wrong language (e.g. KJV
// text stored inside a Hebrew-labelled set).
function isTextLikelyForVersion(text, version) {
  if (!text) return false;
  const s = String(text);
  const bl = baseLang(version);
  if (bl === 'en') return /[A-Za-z]/.test(s);
  if (bl === 'cuv' || bl === 'cuvs') return /[一-鿿]/.test(s);
  switch (String(version || '').toLowerCase()) {
    case 'he':
      // Must contain Hebrew letters
      return /[א-תיִ-פֿ]/.test(s);
    case 'fa':
      // Must contain Arabic/Persian letters
      return /[؀-ۿ]/.test(s);
    case 'ja':
      // Must contain kana or CJK
      return /[぀-ヿ一-鿿]/.test(s);
    case 'ko':
      // Must contain Hangul
      return /[가-힯ᄀ-ᇿ]/.test(s);
    case 'my':
      // Must contain Myanmar script
      return /[က-႟]/.test(s);
    case 'hi':
      // Must contain Devanagari
      return /[ऀ-ॿ]/.test(s);
    case 'cuv':
    case 'cuvs':
    case 'zh':
      // Must contain CJK
      return /[一-鿿]/.test(s);
    default:
      // Latin-script languages (en, de, es, tr, vi, kjv, esv) — accept anything
      return true;
  }
}

function getSecondaryPhrasesForIndex(primaryIndex, primaryLength, secondaryPhrases) {
  if (!secondaryPhrases?.length) return '';
  if (primaryLength <= 1) return secondaryPhrases.join(' ');

  const secondaryLength = secondaryPhrases.length;
  if (primaryLength === secondaryLength) return secondaryPhrases[primaryIndex] || '';

  if (secondaryLength < primaryLength) {
    // 英文片語較少：把每個英文片語投射到最近的中文位置（1對1，不重複）
    // 沒配對到的中文顯示空白
    if (secondaryLength === 1) {
      return primaryIndex === 0 ? secondaryPhrases[0] : '';
    }
    const collected = [];
    for (let j = 0; j < secondaryLength; j++) {
      const target = Math.round(j * (primaryLength - 1) / (secondaryLength - 1));
      if (target === primaryIndex) collected.push(secondaryPhrases[j]);
    }
    return collected.join(' ');
  } else {
    // 英文片語較多：把連續英文片語集中到對應的中文位置
    const start = Math.floor(primaryIndex * secondaryLength / primaryLength);
    const end = primaryIndex === primaryLength - 1
      ? secondaryLength
      : Math.max(start + 1, Math.floor((primaryIndex + 1) * secondaryLength / primaryLength));
    return secondaryPhrases.slice(start, end).join(' ');
  }
}

// Labels in 聽&說 are free text (第 1 段, Part 1, 靜夜思 · 李白 ①…): key them by a
// whitespace/dash-normalised, case-folded form so lookups tolerate spacing.
function normalizeVerseReferenceKey(reference = '') {
  return String(reference || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findMatchingVerse(primaryVerse, primaryVerses = [], secondaryVerses = [], options = {}) {
  if (!primaryVerse || !secondaryVerses?.length) return null;
  const { allowIndexFallback = true } = options;
  const primaryIndex = primaryVerses.findIndex(v =>
    (primaryVerse.id && v.id === primaryVerse.id) ||
    (v.reference === primaryVerse.reference && v.text === primaryVerse.text)
  );
  const primaryKey = normalizeVerseReferenceKey(primaryVerse.reference);
  return (
    secondaryVerses.find(v => primaryVerse.id && v.id === primaryVerse.id) ||
    secondaryVerses.find(v => normalizeVerseReferenceKey(v.reference) === primaryKey) ||
    (allowIndexFallback && primaryIndex >= 0 ? secondaryVerses[primaryIndex] : null) ||
    null
  );
}

function normalizeVerseSetIdentity(value = '') {
  return String(value || '')
    .replace(/\s*\((KJV|ESV|NIV)\)\s*/gi, '')
    .replace(/-(cuv|cuvs|kjv|esv|niv|ja|ko|fa|he|es|tr|de|my|vi|id|ms|tw|pt|fr|ru|hi)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function areLikelyParallelVerseSets(primarySet, secondarySet) {
  if (!primarySet || !secondarySet) return false;
  const primaryLength = primarySet.verses?.length || 0;
  const secondaryLength = secondarySet.verses?.length || 0;
  if (!primaryLength || primaryLength !== secondaryLength) return false;

  const primaryId = normalizeVerseSetIdentity(primarySet.id);
  const secondaryId = normalizeVerseSetIdentity(secondarySet.id);
  if (primaryId && secondaryId && primaryId === secondaryId) return true;
  if (secondarySet.sourceSetId && normalizeVerseSetIdentity(secondarySet.sourceSetId) === primaryId) return true;

  const primaryTitle = normalizeVerseSetIdentity(primarySet.title);
  const secondaryTitle = normalizeVerseSetIdentity(secondarySet.title);
  if (primaryTitle && secondaryTitle && primaryTitle === secondaryTitle) return true;

  const primaryRefs = new Set((primarySet.verses || []).map(v => normalizeVerseReferenceKey(v.reference)).filter(Boolean));
  const matchCount = (secondarySet.verses || []).reduce((sum, verse) => {
    const key = normalizeVerseReferenceKey(verse.reference);
    return sum + (key && primaryRefs.has(key) ? 1 : 0);
  }, 0);
  return matchCount >= Math.max(2, Math.ceil(primaryLength * 0.35));
}

function getDailyVerseIndex(length, date = new Date()) {
  if (!length) return 0;
  const target = new Date(date);
  const start = new Date(target.getFullYear(), 0, 0);
  const day = Math.floor((target - start) / 86400000);
  return (target.getFullYear() * 37 + day) % length;
}

function getDailyVerseRemoteVersion(version) {
  return null; // 聽&說: 每日一首 comes from the built-in pack, no remote daily verse

  if (version === 'kjv' || version === 'esv' || version === 'niv' || version === 'cuv' || version === 'cuvs') return version;
  return null;
}

function formatLocalDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function getDailyVerseFallbackImageUrl(verse, dateLabel, version, seed) {
  const hue = seed % 360;
  const accent = (hue + 38) % 360;
  const deep = (hue + 210) % 360;
  const glow = (hue + 68) % 360;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue}, 58%, 28%)"/>
      <stop offset="0.45" stop-color="hsl(${accent}, 72%, 52%)"/>
      <stop offset="1" stop-color="hsl(${deep}, 62%, 16%)"/>
    </linearGradient>
    <radialGradient id="sun" cx="68%" cy="22%" r="42%">
      <stop offset="0" stop-color="hsl(${glow}, 100%, 82%)" stop-opacity="0.95"/>
      <stop offset="0.36" stop-color="hsl(${glow}, 94%, 62%)" stop-opacity="0.46"/>
      <stop offset="1" stop-color="hsl(${deep}, 64%, 14%)" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="river" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="hsl(${accent}, 86%, 78%)" stop-opacity="0.72"/>
      <stop offset="0.55" stop-color="hsl(${hue}, 78%, 50%)" stop-opacity="0.46"/>
      <stop offset="1" stop-color="hsl(${deep}, 78%, 18%)" stop-opacity="0.94"/>
    </linearGradient>
    <filter id="soften">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
  </defs>
  <rect width="1600" height="900" fill="url(#sky)"/>
  <rect width="1600" height="900" fill="url(#sun)"/>
  <path d="M0 520 C190 360 280 315 430 438 C560 545 615 315 780 420 C930 515 1015 270 1210 372 C1360 450 1465 362 1600 300 L1600 900 L0 900 Z" fill="hsl(${deep}, 54%, 19%)" opacity="0.72"/>
  <path d="M0 610 C210 468 330 490 490 585 C640 675 800 492 950 565 C1120 648 1290 504 1600 560 L1600 900 L0 900 Z" fill="hsl(${hue}, 54%, 20%)" opacity="0.68"/>
  <path d="M660 900 C720 760 760 630 835 552 C910 630 938 760 1030 900 Z" fill="url(#river)" opacity="0.9"/>
  <path d="M680 900 C748 785 785 660 838 586 C890 674 940 800 1004 900 Z" fill="white" opacity="0.18" filter="url(#soften)"/>
  <path d="M1070 160 L1600 42 L1600 172 L1110 240 Z" fill="white" opacity="0.13" filter="url(#soften)"/>
  <path d="M960 230 L1600 185 L1600 330 L1000 300 Z" fill="white" opacity="0.1" filter="url(#soften)"/>
  <circle cx="1120" cy="188" r="118" fill="hsl(${glow}, 100%, 74%)" opacity="0.22" filter="url(#soften)"/>
  <g opacity="0.2" fill="none" stroke="white" stroke-width="2">
    <path d="M160 690 C360 640 480 660 650 610"/>
    <path d="M900 520 C1050 470 1220 500 1420 430"/>
    <path d="M80 210 C230 185 360 205 500 170"/>
  </g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

function getDailyVerseBackgroundDay(dateLabel) {
  const parsed = new Date(`${dateLabel || ''}T00:00:00`);
  const day = Number.isNaN(parsed.getTime()) ? new Date().getDate() : parsed.getDate();
  return Math.min(31, Math.max(1, day));
}

function getDailyVerseImageUrls(verse, dateLabel, version) {
  const seedSource = `${dateLabel}-${version}-${verse?.reference || ''}`;
  let seed = 0;
  for (let i = 0; i < seedSource.length; i++) seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;
  const day = String(getDailyVerseBackgroundDay(dateLabel)).padStart(2, '0');

  return [
    `/dailyverse/day-${day}.svg`,
    getDailyVerseFallbackImageUrl(verse, dateLabel, version, seed)
  ];
}

function getStableNumber(value) {
  let hash = 0;
  const source = String(value || '');
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return hash;
}

function pickRandomVerse(verses = [], previousReference = '') {
  const candidates = Array.isArray(verses) ? verses.filter(Boolean) : [];
  if (candidates.length <= 1) return candidates[0] || null;
  const pool = candidates.filter(v => v.reference !== previousReference);
  return pool[Math.floor(Math.random() * pool.length)] || candidates[Math.floor(Math.random() * candidates.length)];
}

const DAILY_RAIN_DROPS = Array.from({ length: 58 }, (_, index) => {
  const wave = Math.sin((index + 3) * 12.9898) * 43758.5453;
  const rand = wave - Math.floor(wave);
  const wave2 = Math.sin((index + 11) * 78.233) * 24634.6345;
  const rand2 = wave2 - Math.floor(wave2);
  const depth = index % 7 === 0 ? 3 : index % 3 === 0 ? 2 : 1;
  const length = depth === 3 ? 18 + rand * 18 : depth === 2 ? 10 + rand * 10 : 5 + rand * 6;
  const width = depth === 3 ? 1.9 + rand2 * 1.2 : depth === 2 ? 1.2 + rand2 * 0.8 : 0.7 + rand2 * 0.5;
  const duration = depth === 3 ? 0.82 + rand * 0.34 : depth === 2 ? 1.18 + rand * 0.42 : 1.75 + rand * 0.9;
  return {
    left: `${(rand * 94 + (index * 7.3) % 6).toFixed(2)}%`,
    top: `${(-28 - rand2 * 95).toFixed(2)}%`,
    length: `${length.toFixed(1)}px`,
    width: `${width.toFixed(2)}px`,
    opacity: (depth === 3 ? 0.42 + rand * 0.28 : depth === 2 ? 0.28 + rand * 0.22 : 0.16 + rand * 0.18).toFixed(2),
    duration: `${duration.toFixed(2)}s`,
    delay: `${(-(rand * 2.8 + index * 0.035)).toFixed(2)}s`,
    drift: `${(depth === 3 ? 14 + rand2 * 18 : depth === 2 ? 8 + rand2 * 12 : 4 + rand2 * 8).toFixed(1)}px`,
    blur: `${(depth === 1 ? 0.4 + rand * 0.8 : depth === 2 ? 0.1 + rand * 0.35 : 0).toFixed(2)}px`,
    depth
  };
});

const RAIN_FONT_LEVELS = ['small', 'normal', 'large', 'xlarge'];

function RainFontControls({ value, onChange, t, className = '' }) {
  const currentIndex = Math.max(0, RAIN_FONT_LEVELS.indexOf(value));
  const setLevel = (index) => onChange(RAIN_FONT_LEVELS[Math.min(RAIN_FONT_LEVELS.length - 1, Math.max(0, index))]);

  return (
    <div className={`rain-font-controls ${className}`} aria-label={t('字體大小', 'Font size')}>
      <button
        type="button"
        onClick={() => setLevel(currentIndex - 1)}
        disabled={currentIndex === 0}
        aria-label={t('縮小字體', 'Decrease font size')}
      >
        A-
      </button>
      <button
        type="button"
        onClick={() => setLevel(1)}
        className={value === 'normal' ? 'is-on' : ''}
        aria-label={t('標準字體', 'Normal font size')}
      >
        A
      </button>
      <button
        type="button"
        onClick={() => setLevel(currentIndex + 1)}
        disabled={currentIndex === RAIN_FONT_LEVELS.length - 1}
        aria-label={t('放大字體', 'Increase font size')}
      >
        A+
      </button>
    </div>
  );
}

function DailyVerseRainExperience({ verse, version, t, onRead, onChallenge, onShare, onListenLogged, dateLabel, onPrevious, onNext, nextDisabled }) {
  const phrases = useMemo(() => splitVersePhrases(verse?.text || ''), [verse]);
  const backgroundImageUrls = useMemo(() => getDailyVerseImageUrls(verse, dateLabel, version), [verse?.reference, dateLabel, version]);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageOk, setImageOk] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activePhrase, setActivePhrase] = useState(-1);
  const [isSettled, setIsSettled] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [fontSizeLevel, setFontSizeLevel] = useState('normal');
  const bgmRef = useRef(null);
  const runRef = useRef(0);

  useEffect(() => {
    setPlayKey(k => k + 1);
    setActivePhrase(-1);
    setIsSettled(false);
    setIsPlaying(false);
    setImageIndex(0);
    setImageOk(true);
    setImageLoaded(false);
  }, [verse?.reference, dateLabel]);

  useEffect(() => {
    if (imageLoaded || !imageOk || backgroundImageUrls[imageIndex]?.startsWith('data:')) return undefined;
    const timeout = window.setTimeout(() => {
      setImageIndex(current => {
        if (current < backgroundImageUrls.length - 1) return current + 1;
        return current;
      });
    }, 4500);
    return () => window.clearTimeout(timeout);
  }, [backgroundImageUrls, imageIndex, imageLoaded, imageOk]);

  useEffect(() => {
    if (!bgmRef.current) {
      bgmRef.current = new Audio('/bgm.mp3');
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.2;
    }
    return () => {
      bgmRef.current?.pause();
      runRef.current += 1;
    };
  }, []);

  const stopAtmosphere = () => {
    bgmRef.current?.pause();
  };

  const pauseExperience = () => {
    runRef.current += 1;
    bgmRef.current?.pause();
    stopSpeechIfActive();
    setIsPlaying(false);
    setActivePhrase(-1);
    setIsSettled(false);
  };

  const playExperience = async () => {
    if (!verse || isPlaying) return;
    initAudio();
    window.speechSynthesis?.resume?.();
    const runId = runRef.current + 1;
    runRef.current = runId;
    setPlayKey(k => k + 1);
    setIsPlaying(true);
    setIsSettled(false);
    setActivePhrase(-1);

    try {
      if (musicEnabled) {
        if (bgmRef.current) {
          bgmRef.current.currentTime = 0;
          bgmRef.current.play().catch(() => {});
        }
      }

      const lang = getVoiceLangForVersion(version);
      if (voiceEnabled) {
        await speakTextTimed(formatVerseReferenceForSpeech(verse.reference, version), 0.9, lang);
        await new Promise(r => setTimeout(r, 400));
      }

      for (let i = 0; i < phrases.length; i++) {
        if (runRef.current !== runId) return;
        setActivePhrase(i);
        if (voiceEnabled) {
          await speakTextTimed(phrases[i], 0.86, lang);
        } else {
          await new Promise(r => setTimeout(r, Math.max(850, phrases[i].length * 90)));
        }
        await new Promise(r => setTimeout(r, 160));
      }

      if (runRef.current !== runId) return;
      setActivePhrase(phrases.length);
      setIsSettled(true);
      onListenLogged?.();
    } finally {
      if (runRef.current === runId) {
        setIsPlaying(false);
        stopAtmosphere();
      }
    }
  };

  if (!verse) {
    return (
      <div className="daily-verse-rain-shell daily-verse-rain-empty">
        {t('目前沒有可播放的每日一首', 'No daily paragraph is available yet.')}
      </div>
    );
  }

  return (
    <div className={`daily-verse-rain-shell rain-font-${fontSizeLevel}`}>
      <div
        className="daily-verse-rain-scene"
        key={`${verse.reference}-${playKey}`}
      >
        {imageOk && (
          <img
            className="daily-verse-rain-image"
            src={backgroundImageUrls[imageIndex]}
            alt=""
            aria-hidden="true"
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              setImageLoaded(false);
              setImageIndex(current => {
                if (current < backgroundImageUrls.length - 1) return current + 1;
                setImageOk(false);
                return current;
              });
            }}
          />
        )}
        <div className={`daily-verse-rain-sky ${imageLoaded ? 'has-ai-image' : ''}`} />
        <div className="daily-verse-rain-glow" />
        <div className="daily-verse-rain-drops">
          {DAILY_RAIN_DROPS.map((drop, index) => (
            <span
              key={index}
              className={`depth-${drop.depth}`}
              style={{
                '--x': drop.left,
                '--y': drop.top,
                '--drop-length': drop.length,
                '--drop-width': drop.width,
                '--drop-opacity': drop.opacity,
                '--drop-duration': drop.duration,
                '--drop-delay': drop.delay,
                '--drop-drift': drop.drift,
                '--drop-blur': drop.blur
              }}
            />
          ))}
        </div>
        <div className="daily-verse-rain-content">
          <div className="daily-verse-rain-topbar">
            <button type="button" onClick={onPrevious} aria-label={t('前一天', 'Previous day')}>‹</button>
            <div>
              {dateLabel && <div className="daily-verse-rain-date">{dateLabel}</div>}
            </div>
            <button type="button" onClick={onNext} disabled={nextDisabled} aria-label={t('後一天', 'Next day')}>›</button>
          </div>
          <h2>{formatVerseReferenceForDisplay(verse.reference, version)}</h2>
          <div className={`daily-verse-rain-phrases ${isPlaying ? 'is-playing' : ''} ${isSettled ? 'is-settled' : ''}`} aria-live="polite">
            {phrases.map((phrase, index) => (
              <span
                key={`${phrase}-${index}`}
                className={`${index === activePhrase ? 'is-active' : ''} ${index < activePhrase || isSettled ? 'has-landed' : ''}`}
                style={{
                  '--delay': `${Math.min(index * 0.42, 6.2)}s`,
                  '--drift': `${((index % 5) - 2) * 9}px`
                }}
              >
                {phrase}
              </span>
            ))}
          </div>
        </div>
        <div className="daily-verse-rain-actions">
          <button type="button" onClick={isPlaying ? pauseExperience : playExperience}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />} {isPlaying ? t('暫停', 'Pause') : t('讀經', 'Read')}
          </button>
          <button type="button" onClick={onChallenge}>
            <Play size={18} fill="currentColor" /> {t('挑戰', 'Challenge')}
          </button>
          <button type="button" onClick={onShare}>
            <Share2 size={18} /> {t('分享', 'Share')}
          </button>
        </div>
      </div>

      <div className="daily-verse-rain-controls" aria-label={t('每日一首雨設定', 'Daily ParagraphRain settings')}>
        <button type="button" onClick={isPlaying ? pauseExperience : playExperience} className="is-on">
          {isPlaying ? t('暫停', 'Pause') : t('播放內容', 'Play paragraph')}
        </button>
        <button type="button" onClick={() => setVoiceEnabled(v => !v)} className={voiceEnabled ? 'is-on' : ''}>
          {voiceEnabled ? t('語音開', 'Voice on') : t('語音關', 'Voice off')}
        </button>
        <button type="button" onClick={() => setMusicEnabled(v => !v)} className={musicEnabled ? 'is-on' : ''}>
          {musicEnabled ? t('音樂開', 'Music on') : t('音樂關', 'Music off')}
        </button>
        <RainFontControls value={fontSizeLevel} onChange={setFontSizeLevel} t={t} />
      </div>
    </div>
  );
}

function VerseSetContinuousRainPlayer({
  verseSet,
  topicSets = [],
  favoriteVerseSets = [],
  version,
  secondaryVerseSet = null,
  secondaryVersion = null,
  onSecondaryVersionChange = null,
  t,
  onStop,
  onListenLogged,
  playDurationMinutes = null,
  initialFontSizeLevel = DEFAULT_PLAY_FONT_CHOICE,
  playOnce = false,
  onComplete,
  label,
  showNav = true,
  startVerse = null,
  onPrevious = null,
  onNext = null,
  nextDisabled = false,
  prevDisabled = false,
  onChallengeVerse = null,
  onShareVerse = null,
  onSelectTopicSet = null,
  allSecondaryVerses = [],
  userEmail = '',
  playerName = '',
  onRequestLogin = null,
  onOpenVoiceComments = null,
  onVoiceRecorded = null,
  isFavoriteSet = false,
  onToggleFavoriteSet = null,
  onSelectDailyVerse = null,
  autoOpenPicker = false,
  onAutoPickerOpened = null,
  // Returned from a challenge: mount held (no narration) and paused, showing the
  // verse we came back to. Playback starts when the listener taps Play or ‹ ›.
  startPaused = false
}) {
  const verses = useMemo(() => verseSet?.verses?.filter(Boolean) || [], [verseSet]);
  // Opened from a share link carrying vo= → play the sender's personal voice.
  // Scoped to this playback (rides on the set object), so a later non-shared
  // play naturally clears it. See the /lc → listenSet deep-link handler.
  const sharedVoiceOwner = verseSet?.sharedVoiceOwner || null;
  // Play-time voice source overrides (from the 播放方式 picker). forceTTS =
  // computer voice only (skip every recording); forceOwnerLayer = the set
  // author's recording only (ignore the listener's own personal voice). A
  // contributor pick instead rides sharedVoiceOwner above.
  const forceTTS = verseSet?.forceTTS || false;
  const forceOwnerLayer = verseSet?.forceOwnerLayer || false;
  // Single-verse card (opened via a row's 播放): ‹ › walk the source set but
  // clamp at the ends (no wrap), and a finished verse loops instead of moving
  // on — so the card stays put until the listener taps ‹ ›.
  const clampNav = verseSet?.clampNav || false;
  const loopCurrent = verseSet?.loopCurrent || false;
  const [currentVerse, setCurrentVerse] = useState(() => startVerse || pickRandomVerse(verses));

  // 創作者親聲朗讀 — recordings for this set, keyed by verse reference.
  // When present for the current verse, the creator's audio replaces TTS
  // and the phrase blocks advance proportionally to the recording length.
  // voiceSetId lets synthetic single-verse wrappers point back at the real
  // originating set where the recordings actually live.
  const voiceSetId = verseSet?.voiceSetId || verseSet?.id || null;
  // Where MY personal recordings live. Real curated sets (topic slugs like
  // "gospel-of-john", random-base36 custom ids) use their own bucket. Ephemeral
  // wrappers — no id, or a synthetic `single-<ref>` / `daily-<date>` — aren't
  // real collections, so their recordings go to one shared personal "loose"
  // bucket, keyed by reference. That keeps the record button always present and
  // lets a loose recording surface wherever the verse reappears. Always truthy.
  const isEphemeralSetId = (id) => !id || /^(single|daily)-/.test(String(id));
  const personalVoiceSetId = isEphemeralSetId(voiceSetId) ? PERSONAL_LOOSE_SET_ID : voiceSetId;
  const verseVoicesRef = useRef({});
  // 最新公開人聲 — the newest public recording per verse across the author AND
  // every contributor (from /sets/voice-latest). When there's no personal/shared
  // override, the player defaults to this real voice instead of TTS whenever
  // anyone has recorded the verse — not just when the set author did. Each entry
  // is tagged voiceBucket=voiceSetId (both layers' audio lives in that store).
  const latestVoicesRef = useRef({});
  // Resolves once the voices list has loaded — playVerse awaits this (with
  // a cap) so the FIRST verse doesn't race the fetch on slow mobile
  // networks and wrongly fall back to TTS.
  const verseVoicesReadyRef = useRef(Promise.resolve());
  const creatorAudioRef = useRef(null);
  // True while a voice recording is paused mid-playback (Pause button), so
  // Resume continues from the same position instead of replaying the verse.
  const pausedRecordingRef = useRef(false);
  const voiceAudioCacheRef = useRef(new globalThis.Map()); // voiceId → data URL
  const [creatorVoiceName, setCreatorVoiceName] = useState('');
  // 換聲音 — a runtime voice override the listener can switch mid-playback via
  // the reader selector. null = follow the set's configured behavior. Otherwise
  // { type:'tts'|'owner'|'personal', ownerId?, recordedBy?, voices? }.
  const manualVoiceRef = useRef(null);
  const [activeVoiceLabel, setActiveVoiceLabel] = useState(''); // shown in the selector
  const [voiceMenu, setVoiceMenu] = useState(null);   // { options } while the switch menu is open
  const [voiceMenuLoading, setVoiceMenuLoading] = useState(false);
  // ⚡ 挑戰 chooser — lets the player pick game mode + difficulty before the
  // challenge starts, instead of silently inheriting whatever was last set on
  // the set-detail page. Last choice remembered per device.
  const [challengeChooser, setChallengeChooser] = useState(null); // { mode, difficulty } while open
  // Shown while we're finding out whether this verse has a recording, and then
  // while its audio downloads. Without it a slow connection is just silence and
  // the listener has no idea anything is coming.
  const [voiceLoading, setVoiceLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    verseVoicesRef.current = {};
    latestVoicesRef.current = {};
    if (!voiceSetId) { verseVoicesReadyRef.current = Promise.resolve(); return undefined; }
    const ownerJob = setVoiceApi.getAll(voiceSetId)
      .then(res => { if (!cancelled) verseVoicesRef.current = res?.voices || {}; })
      .catch(() => { /* no recordings — TTS as usual */ });
    // Newest public human voice per verse (author + all contributors). Tag each
    // with the bucket its audio lives in so playCreatorRecording fetches it.
    const latestJob = setVoiceApi.getLatest(voiceSetId)
      .then(res => {
        if (cancelled) return;
        const map = res?.latest || {};
        for (const ref of Object.keys(map)) map[ref] = { ...map[ref], voiceBucket: voiceSetId };
        latestVoicesRef.current = map;
      })
      .catch(() => { /* fall back to the author layer / TTS */ });
    verseVoicesReadyRef.current = Promise.all([ownerJob, latestJob]);
    return () => { cancelled = true; };
  }, [voiceSetId]);

  // 個人親聲朗讀 (personal voice) — a per-listener layer that overrides the
  // set owner's recording. personalVoicesRef = MY recordings (badge/delete);
  // overrideVoicesRef = whichever voice wins playback: a share's sender voice
  // (sharedVoiceOwner) if opened from a link, else my own. Priority in
  // playVerse: override › owner (verseVoicesRef) › TTS.
  const personalVoicesRef = useRef({});
  const overrideVoicesRef = useRef({});
  const forceTTSRef = useRef(false); // picker chose 電腦語音 → skip all recordings
  const personalVoicesReadyRef = useRef(Promise.resolve());
  const myOwnerIdRef = useRef(null);
  const [voiceRecTarget, setVoiceRecTarget] = useState(null); // { reference, text }
  const [personalBusy, setPersonalBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState({}); // reference → 'processing' | 'error'
  const uploadPromisesRef = useRef({});               // reference → in-flight upload Promise
  const [shareBusy, setShareBusy] = useState(false);
  const [, setPersonalVoiceVersion] = useState(0);
  const bumpPersonalVoices = () => setPersonalVoiceVersion(v => v + 1);
  useEffect(() => {
    let cancelled = false;
    personalVoicesRef.current = {};
    overrideVoicesRef.current = {};
    forceTTSRef.current = forceTTS;
    myOwnerIdRef.current = null;
    // Cross-context merge: inside a real set, also surface any recording the
    // user made on this verse as a LOOSE verse (random/search/single). The set's
    // own bucket wins per-reference. Each recording is tagged with the bucket
    // its audio actually lives in, so playback fetches from the right place.
    const buckets = personalVoiceSetId !== PERSONAL_LOOSE_SET_ID
      ? [PERSONAL_LOOSE_SET_ID, personalVoiceSetId]   // loose first, real set overwrites
      : [PERSONAL_LOOSE_SET_ID];
    const loadMerged = async (owner) => {
      const out = {};
      for (const bucket of buckets) {
        const res = await userVoiceApi.getAll(bucket, owner).catch(() => null);
        if (res?.voices) {
          for (const [ref, meta] of Object.entries(res.voices)) {
            out[ref] = { ...meta, voiceBucket: bucket };
          }
        }
      }
      return out;
    };
    personalVoicesReadyRef.current = (async () => {
      try {
        const mine = userEmail ? await voiceOwnerId(userEmail) : null;
        if (cancelled) return;
        myOwnerIdRef.current = mine;
        if (mine) {
          const merged = await loadMerged(mine);
          if (!cancelled) personalVoicesRef.current = merged; // keep for badges
        }
        // Picker forced 電腦語音 or 作者錄音 → leave override empty: forceTTS is
        // honored at the decision point (skips the owner layer too); forceOwnerLayer
        // simply lets the owner layer (verseVoicesRef) win over the listener's own.
        if (forceTTS || forceOwnerLayer) {
          overrideVoicesRef.current = {};
        } else {
          // A shared link's / picked contributor's voice wins over the viewer's own.
          const activeOwner = sharedVoiceOwner || mine;
          if (activeOwner && activeOwner === mine) {
            overrideVoicesRef.current = personalVoicesRef.current;
          } else if (activeOwner) {
            const merged = await loadMerged(activeOwner);
            if (!cancelled) overrideVoicesRef.current = merged;
          }
        }
      } catch { /* personal voice is optional */ }
      if (!cancelled) bumpPersonalVoices();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalVoiceSetId, userEmail, sharedVoiceOwner, forceTTS, forceOwnerLayer]);

  // Record / re-record my voice for the current verse, then refresh caches.
  const recordedByName = playerName || (userEmail || '').split('@')[0] || 'Anonymous';
  // Per-reference save generation. Bake + upload run in the BACKGROUND (so the
  // user can move straight on), which means re-recording the SAME verse fires a
  // new upload before the previous one has finished. Without ordering, whichever
  // upload's register call happened to land LAST would win — so an earlier take
  // could silently overwrite a later one, and the recorder would keep playing
  // the first take no matter how many times you re-recorded ("重錄了還是聽到第一次").
  // We stamp each save with a monotonic seq per reference, chain saves of the
  // same verse so their registers land in recording order, and drop any take a
  // newer one has already superseded. Different verses still upload concurrently.
  const saveSeqRef = useRef({}); // reference → latest issued seq
  const saveMyVoice = ({ blob, mime, dur, beautify, public: isPublic = true }) => {
    if (!userEmail) return;
    const ref = voiceRecTarget?.reference || currentVerse.reference;
    const seq = (saveSeqRef.current[ref] || 0) + 1;
    saveSeqRef.current[ref] = seq;
    const isLatest = () => saveSeqRef.current[ref] === seq;
    // The promise is tracked so a share of this verse can await it (otherwise
    // the link would go out before the recording lands on the server).
    const prevJob = uploadPromisesRef.current[ref];
    setVoiceStatus(prev => ({ ...prev, [ref]: 'processing' }));
    const job = (async () => {
      // Wait for any in-flight save of THIS verse so registers land in the order
      // the takes were made — the last take must win on the server, not just in
      // memory. (Only same-verse re-records serialize; other verses are unaffected.)
      if (prevJob) { try { await prevJob; } catch { /* prior take failed — still record this one */ } }
      // A newer take was started while we waited → this one is already stale.
      if (!isLatest()) return null;
      const finalBlob = beautify ? await bakeBeautifiedBlob(blob, mime) : blob;
      if (!isLatest()) return null; // superseded during the bake
      const uploaded = await uploadUserVerseVoice({ email: userEmail, setId: personalVoiceSetId, reference: ref, blob: finalBlob, mime, dur, recordedBy: recordedByName, public: isPublic });
      // Superseded while uploading → don't touch the caches, so the newer take's
      // recording is what plays back.
      if (!isLatest()) return null;
      // Tag with the bucket it was stored under so playback/delete resolve it
      // even when this recording later surfaces in a different context.
      const meta = { ...uploaded, voiceBucket: personalVoiceSetId };
      personalVoicesRef.current = { ...personalVoicesRef.current, [ref]: meta };
      // When I'm listening to my own voice (no foreign share), my new take
      // becomes the active override immediately.
      if (!sharedVoiceOwner || sharedVoiceOwner === myOwnerIdRef.current) {
        overrideVoicesRef.current = { ...overrideVoicesRef.current, [ref]: meta };
      }
      voiceAudioCacheRef.current.delete(meta.voiceId);
      return meta;
    })();
    uploadPromisesRef.current[ref] = job;
    job.then(() => {
      // Only the latest take clears the spinner / signals completion; a
      // superseded take resolving must not pull the UI out from under the take
      // that replaced it.
      if (!isLatest()) return;
      setVoiceStatus(prev => { const n = { ...prev }; delete n[ref]; return n; });
      bumpPersonalVoices();
      // Tell the parent a recording landed, so the set-detail ⭐ refreshes
      // without a manual page reload when the listener returns to the list.
      onVoiceRecorded?.();
    }).catch((e) => {
      console.error('personal voice upload failed', e);
      if (isLatest()) setVoiceStatus(prev => ({ ...prev, [ref]: 'error' }));
    }).finally(() => {
      if (uploadPromisesRef.current[ref] === job) delete uploadPromisesRef.current[ref];
    });
  };
  const deleteMyVoice = async (ref) => {
    if (!userEmail || !ref) return;
    setPersonalBusy(true);
    try {
      // Delete from the bucket the recording actually lives in — a loose
      // recording surfaced inside a real set still belongs to the loose bucket.
      const bucket = personalVoicesRef.current?.[ref]?.voiceBucket || personalVoiceSetId;
      await userVoiceApi.remove(userEmail, bucket, ref);
      const nextPersonal = { ...personalVoicesRef.current }; delete nextPersonal[ref];
      personalVoicesRef.current = nextPersonal;
      if (!sharedVoiceOwner || sharedVoiceOwner === myOwnerIdRef.current) {
        const nextOverride = { ...overrideVoicesRef.current }; delete nextOverride[ref];
        overrideVoicesRef.current = nextOverride;
      }
      bumpPersonalVoices();
    } catch (e) {
      console.error('personal voice delete failed', e);
    }
    setPersonalBusy(false);
  };
  const myVoiceForCurrent = personalVoicesRef.current?.[currentVerse.reference] || null;

  // ── 換聲音 / 留言 (reader selector) ─────────────────────────────────
  // Gather the recordings available for the CURRENT verse, for the switch menu.
  const gatherCurrentVoiceOptions = async () => {
    const ref = currentVerse.reference;
    const opts = [];
    const ownerRec = verseVoicesRef.current?.[ref];
    if (ownerRec?.voiceId) opts.push({ type: 'owner', ownerId: ownerRec.byOwnerId || null, recordedBy: ownerRec.recordedBy || '' });
    try {
      const cres = voiceSetId ? await userVoiceApi.getContributors(voiceSetId).catch(() => null) : null;
      const contributors = cres?.contributors || [];
      const mineId = myOwnerIdRef.current;
      for (const c of contributors) {
        const vres = await userVoiceApi.getAll(voiceSetId, c.ownerId).catch(() => null);
        const rec = vres?.voices?.[ref];
        if (rec?.voiceId) opts.push({ type: 'personal', ownerId: c.ownerId, recordedBy: c.recordedBy || rec.recordedBy || '', mine: !!(mineId && c.ownerId === mineId) });
      }
    } catch { /* best-effort */ }
    return opts;
  };
  const openVoiceSwitchMenu = async () => {
    if (!voiceSetId) return;
    setVoiceMenuLoading(true);
    setVoiceMenu({ options: [] });
    const opts = await gatherCurrentVoiceOptions();
    setVoiceMenu({ options: opts });
    setVoiceMenuLoading(false);
  };
  const applyVoiceChoice = async (choice) => {
    setVoiceMenu(null);
    if (choice.type === 'tts') {
      manualVoiceRef.current = { type: 'tts' };
    } else if (choice.type === 'silent') {
      // 無聲音 — no TTS and no recordings; blocks still appear (paced by the
      // usual per-phrase timing) while only the background music plays.
      manualVoiceRef.current = { type: 'silent' };
    } else if (choice.type === 'owner') {
      manualVoiceRef.current = { type: 'owner', ownerId: choice.ownerId, recordedBy: choice.recordedBy };
    } else {
      // Load that contributor's recordings for the whole set so subsequent
      // verses use them too; verses they didn't record fall back to TTS.
      let voices = {};
      try { const res = await userVoiceApi.getAll(voiceSetId, choice.ownerId); voices = res?.voices || {}; } catch { /* keep empty */ }
      manualVoiceRef.current = { type: 'personal', ownerId: choice.ownerId, recordedBy: choice.recordedBy, voices };
    }
    // Replay the current verse immediately with the newly-chosen voice.
    resumeFromPhraseRef.current = 0;
    setPlayKey(k => k + 1);
  };
  // The ownerId of the recording currently targeted — for comments AND for the
  // share button (so a link carries the exact voice the sharer is hearing). Must
  // mirror playVerse's default priority: my/shared override › newest public human
  // (latestVoicesRef) › author layer › TTS (null). A live manual switch wins.
  const currentTargetOwnerId = () => {
    const ref = currentVerse.reference;
    const m = manualVoiceRef.current;
    if (m) {
      if (m.type === 'tts' || m.type === 'silent') return null;
      if (m.type === 'owner') return verseVoicesRef.current?.[ref]?.byOwnerId || null;
      return m.ownerId || null;
    }
    if (forceTTSRef.current) return null;
    if (overrideVoicesRef.current?.[ref]) return sharedVoiceOwner || myOwnerIdRef.current || null;
    const latest = latestVoicesRef.current?.[ref];
    if (latest?.voiceId) {
      if (latest.ownerId) return latest.ownerId;
      // Older author-layer recordings can arrive without an ownerId from
      // /voice-latest; the author layer carries the backfilled byOwnerId.
      const author = verseVoicesRef.current?.[ref];
      return (author?.voiceId === latest.voiceId && author?.byOwnerId) || null;
    }
    return verseVoicesRef.current?.[ref]?.byOwnerId || null;
  };
  const openCommentsForCurrent = () => {
    const ownerId = currentTargetOwnerId();
    if (!ownerId || !voiceSetId) return;
    const ref = currentVerse.reference;
    const m = manualVoiceRef.current;
    const recordedBy = m?.recordedBy || verseVoicesRef.current?.[ref]?.recordedBy || overrideVoicesRef.current?.[ref]?.recordedBy || '';
    onOpenVoiceComments?.({ setId: voiceSetId, reference: ref, targetOwnerId: ownerId, recordedBy, mine: ownerId === myOwnerIdRef.current });
  };

  const playCreatorRecording = async (rec, phrasesArr, onPhrase, displayName, onAudioStart) => {
    try {
      let dataUrl = voiceAudioCacheRef.current.get(rec.voiceId);
      if (!dataUrl) {
        const res = await setVoiceApi.getAudio(rec.voiceBucket || personalVoiceSetId, rec.voiceId);
        if (!res?.data) return false;
        dataUrl = `data:${rec.voiceMime || 'audio/webm'};base64,${res.data}`;
        voiceAudioCacheRef.current.set(rec.voiceId, dataUrl);
      }
      // iOS Safari blocks .play() on Audio elements CREATED outside a user
      // gesture — verse 1 (right after the start tap) would play but verse
      // 2+ (created seconds later) would be rejected and fall back to TTS.
      // Reusing one persistent element keeps the gesture "blessing": once
      // it has played, later src swaps on the SAME element are allowed.
      if (!creatorAudioRef.current) creatorAudioRef.current = new Audio();
      const audio = creatorAudioRef.current;
      try { audio.pause(); } catch { /* noop */ }
      audio.src = dataUrl;
      try { audio.currentTime = 0; } catch { /* not loaded yet */ }
      // displayName === '' → hide the badge (listener's own voice). undefined
      // (legacy callers) → fall back to the recording's stored name.
      setCreatorVoiceName(displayName !== undefined ? displayName : (rec.recordedBy || ''));
      // Audio is in hand — drop the "loading the reading" hint.
      onAudioStart?.();
      const durMs = rec.voiceDur > 0 ? rec.voiceDur * 1000 : 8000;
      // Advance phrase highlights proportionally to each phrase's length,
      // driven by the audio's ACTUAL position (timeupdate) — wall-clock
      // timers kept marching while the user paused the clip, so the verse
      // display ran ahead of the silent audio.
      const totalLen = phrasesArr.reduce((a, p) => a + p.length, 0) || 1;
      let acc = 0;
      const thresholds = phrasesArr.map((p) => {
        const startAt = Math.round(durMs * acc / totalLen) + 200;
        acc += p.length;
        return startAt;
      });
      let nextPhraseIdx = 0;
      const timeHandler = () => {
        const ms = audio.currentTime * 1000;
        while (nextPhraseIdx < thresholds.length && ms >= thresholds[nextPhraseIdx]) {
          onPhrase(nextPhraseIdx);
          nextPhraseIdx += 1;
        }
      };
      audio.ontimeupdate = timeHandler;
      let endHandler = null;
      let errHandler = null;
      const finished = await new Promise((resolve) => {
        let done = false;
        const fin = (ok) => { if (!done) { done = true; resolve(ok); } };
        endHandler = () => fin(true);
        errHandler = () => fin(false);
        audio.onended = endHandler;
        audio.onerror = errHandler;
        audio.play().catch(() => fin(false));
        // Hard cap so a stuck clip can't hang the run — but never fire it
        // while the user has paused mid-clip (Resume will play to the end,
        // and onended then advances).
        window.setTimeout(() => { if (!pausedRecordingRef.current) fin(true); }, durMs + 15000);
      });
      setCreatorVoiceName('');
      // Keep the element alive (see gesture note above) — detach OUR handlers
      // only. Runs overlap (a cancelled run resolves after its successor
      // already attached new handlers); unconditional nulling here used to
      // strip the live run's ontimeupdate and freeze the verse display.
      if (audio.ontimeupdate === timeHandler) audio.ontimeupdate = null;
      if (audio.onended === endHandler) audio.onended = null;
      if (audio.onerror === errHandler) audio.onerror = null;
      return finished;
    } catch {
      setCreatorVoiceName('');
      return false;
    }
  };
  // In bilingual mode the primary blocks pair with the secondary line by index,
  // so keep Chinese on punctuation splitting (semantic:false) to stay aligned;
  // monolingual reading gets the semantic segmenter.
  const phrases = useMemo(
    () => splitVersePhrases(currentVerse?.text || '', { semantic: !secondaryVersion }),
    [currentVerse, secondaryVersion]
  );
  const secondaryVerse = useMemo(() => {
    const secondaryVerses = secondaryVerseSet?.verses?.filter(Boolean) || [];
    return findMatchingVerse(currentVerse, verses, secondaryVerses, {
      allowIndexFallback: areLikelyParallelVerseSets(verseSet, secondaryVerseSet)
    });
  }, [currentVerse, secondaryVerseSet, verseSet, verses]);
  // Secondary line is only shown in bilingual mode and pairs by index, so it
  // stays on punctuation splitting (semantic:false) to match the primary.
  const secondaryPhrases = useMemo(
    () => splitVersePhrases(secondaryVerse?.text || '', { semantic: false }),
    [secondaryVerse]
  );

  // --- Cross-language verse lookup ---
  // Build a fast lookup map: normalizedKey → verse for all loaded secondary-language verses
  const secondaryVerseByRef = useMemo(() => {
    const map = new globalThis.Map();
    for (const v of allSecondaryVerses) {
      const key = normalizeVerseReferenceKey(v.reference);
      if (key && !map.has(key)) map.set(key, v);
    }
    return map;
  }, [allSecondaryVerses]);

  const [lookedUpText, setLookedUpText] = useState('');
  const [lookedUpRef, setLookedUpRef] = useState('');

  useEffect(() => {
    // Already have a match from the paired secondary set → nothing to look up
    if (secondaryVerse || !secondaryVersion || !currentVerse?.reference) {
      setLookedUpText('');
      setLookedUpRef('');
      return;
    }

    const normalizedKey = normalizeVerseReferenceKey(currentVerse.reference);
    // Search all loaded sets in the secondary language; 聽&說 items otherwise carry
    // their own second language, so there is nothing else to look up.
    const localMatch = normalizedKey ? secondaryVerseByRef.get(normalizedKey) : null;
    if (localMatch && isTextLikelyForVersion(localMatch.text, secondaryVersion)) {
      setLookedUpText(localMatch.text);
      setLookedUpRef(localMatch.reference);
      return;
    }
    setLookedUpText('');
    setLookedUpRef('');
  }, [currentVerse, secondaryVerse, secondaryVersion, secondaryVerseByRef]);

  const effectiveSecondaryPhrases = useMemo(() => {
    let phrases = [];
    // Only trust secondaryVerse if its text is in the correct script for the version
    if (secondaryVerse && secondaryPhrases.length && isTextLikelyForVersion(secondaryVerse.text, secondaryVersion)) {
      phrases = secondaryPhrases;
    } else if (lookedUpText) {
      phrases = splitVersePhrases(lookedUpText, { semantic: false });
    }
    // Per-phrase validation: replace any phrase in the wrong script with '' so it
    // doesn't render. This handles stored verse texts that mix Hebrew with embedded
    // KJV English (or similar cross-language contamination).
    return phrases.map(p => isTextLikelyForVersion(p, secondaryVersion) ? p : '');
  }, [secondaryPhrases, secondaryVerse, lookedUpText, secondaryVersion]);

  const rawSecondaryRef = useMemo(() => {
    if (secondaryVerse) return secondaryVerse.reference;
    if (lookedUpRef) return lookedUpRef;
    return null;
  }, [secondaryVerse, lookedUpRef]);

  // 「雙語對調」：讀經時暫時把第一/第二語言互換,主畫面改用第二語言落字＋朗讀,原第一語言退到
  // 下方小字。純本地狀態(不寫 localStorage、不動 App 全域 version/secondaryVersion)→ 離開讀經頁
  // 元件卸載即自然還原。已確認:對調後一律走電腦語音 TTS,且對調維持整個讀經階段。
  const [swapped, setSwapped] = useState(false);
  const swappedRef = useRef(false);
  useEffect(() => { swappedRef.current = swapped; }, [swapped]);
  // 對調時朗讀第二語言用的 TTS 語音(玩家在「朗讀第二語言」時選的)。純本地、會話性:
  // 不寫入 App 的 verseRain_voiceByVersion,離開讀經頁即消失,不影響 App 語音設定。
  const [swapVoice, setSwapVoice] = useState(null);
  const swapVoiceRef = useRef(null);
  useEffect(() => { swapVoiceRef.current = swapVoice; }, [swapVoice]);
  // 「朗讀第二語言」的語音選單(挑好語音才開始播放)。null = 未開;陣列 = 可選語音清單。
  const [swapVoiceMenu, setSwapVoiceMenu] = useState(null);
  // 系統可用的 TTS 語音清單(voiceschanged 後才會齊全);用來為第二語言列出可選語音。
  const [availableVoices, setAvailableVoices] = useState(() =>
    (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis.getVoices() : []);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
    const load = () => setAvailableVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  // 為第二語言(對調後要朗讀的語言)算可選語音。用「當下」的 getVoices()(iOS 會延後載入,
  // 首次進讀經頁時 React state 可能還沒收到 voiceschanged → 選單列不出日文語音),並沿用
  // 使用者對該語言已存的偏好語音(verseRain_voiceByVersion[secondaryVersion])當預設。
  const liveSecondaryVoiceOptions = () => {
    const live = (typeof window !== 'undefined' && window.speechSynthesis)
      ? (window.speechSynthesis.getVoices() || []) : availableVoices;
    if (live.length) setAvailableVoices(live); // 順手更新 state
    if (!secondaryVersion) return { options: [], preferred: null };
    const prefix = String(getVoiceLangForVersion(secondaryVersion) || '').toLowerCase().split('-')[0];
    if (!prefix) return { options: [], preferred: null };
    const matched = live.filter(vc => String(vc.lang || '').toLowerCase().startsWith(prefix));
    const options = buildVoiceOptions(dedupeVoices(matched), { cloudLabel: '☁️' });
    let preferred = null;
    try {
      const byVersion = JSON.parse(localStorage.getItem('verseRain_voiceByVersion') || '{}');
      const savedKey = byVersion?.[secondaryVersion];
      if (savedKey) preferred = matched.find(v => voiceMatchesSavedKey(v, savedKey)) || null;
    } catch { /* ignore */ }
    return { options, preferred };
  };
  // 進入對調並(可選)指定語音,然後由 readingKey effect 重新從頭朗讀。
  const startSwapWithVoice = (voice) => {
    setSwapVoice(voice || null);
    setSwapVoiceMenu(null);
    setSwapped(true);
  };
  const stopSwap = () => {
    setSwapVoiceMenu(null);
    setSwapVoice(null);
    setSwapped(false);
  };
  // 對調後的「有效」語言與片語。currentVerse/導覽/錄音鍵完全不動,只換「哪個語言當主片語」。
  const activePrimaryVersion = swapped ? secondaryVersion : version;
  const primaryAnnotation = annotationOf(activePrimaryVersion);
  const secondaryAnnotation = annotationOf(swapped ? version : secondaryVersion);
  const activeSecondaryVersion = swapped ? version : secondaryVersion;
  const primaryPhrases = swapped ? effectiveSecondaryPhrases : phrases;
  const secondaryDisplayPhrases = swapped ? phrases : effectiveSecondaryPhrases;
  // 對調時需要的第二語言文字是否已備妥(外部抓取可能還沒回來)→ 決定對調鈕可否按。
  const canSwapToSecondary = effectiveSecondaryPhrases.length > 0;
  const hasSecondaryPhrases = Boolean(activeSecondaryVersion && secondaryDisplayPhrases.length);
  // 下方參考節號:對調時顯示原第一語言的節號(格式用原 version);未對調沿用既有的第二語言查得節號。
  const secondaryHeadingText = swapped
    ? formatVerseReferenceForDisplay(currentVerse?.reference, version)
    : (rawSecondaryRef ? formatVerseReferenceForDisplay(rawSecondaryRef, secondaryVersion) : null);
  // 何時該從頭重讀:對調開/關、對調中換第二語言、或對調中第二語言文字晚到(片語數 0→N)。
  // 未對調時固定 'P'(主語言本身變動由既有 play effect 的 version 依賴處理,避免重複重讀)。
  const readingKey = swapped
    ? `S|${secondaryVersion || ''}|${effectiveSecondaryPhrases.length}|${voiceId(swapVoice)}`
    : 'P';

  const imageDateLabel = useMemo(() => {
    const day = (getStableNumber(`${verseSet?.id || verseSet?.title}-${currentVerse?.reference || ''}`) % 31) + 1;
    return `2026-05-${String(day).padStart(2, '0')}`;
  }, [verseSet?.id, verseSet?.title, currentVerse?.reference]);
  // Creator-uploaded custom background (fetched lazily, session-cached).
  const [customBgUrl, setCustomBgUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCustomBgUrl(null);
    const bg = String(verseSet?.background || '');
    if (!bg.startsWith('custom:')) return undefined;
    getSetAssetDataUrl(verseSet?.voiceSetId || verseSet?.id, bg.slice('custom:'.length), verseSet?.backgroundMime || 'image/webp')
      .then(url => { if (!cancelled) setCustomBgUrl(url); })
      .catch(() => { /* missing asset — default backgrounds show */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verseSet?.background]);

  const backgroundImageUrls = useMemo(() => {
    // Creator-chosen background wins (custom upload, then preset theme);
    // fall back to the default rotating AI backgrounds otherwise.
    if (customBgUrl) return [customBgUrl];
    const preset = getSetBackgroundUrl(verseSet?.background);
    if (preset) return [preset, ...getDailyVerseImageUrls(currentVerse, imageDateLabel, version)];
    return getDailyVerseImageUrls(currentVerse, imageDateLabel, version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVerse, imageDateLabel, version, verseSet?.background, customBgUrl]);
  // Video-preset backgrounds: a short muted loop layered over the poster
  // image. Skipped entirely in performance mode and for users who prefer
  // reduced motion — the poster (backgroundImageUrls[0]) shows instead.
  const backgroundVideoUrl = useMemo(() => {
    if (localStorage.getItem('verseRainPerformanceMode') === 'true') return null;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
    return getSetBackgroundVideoUrl(verseSet?.background);
  }, [verseSet?.background]);
  const [videoOk, setVideoOk] = useState(true);
  useEffect(() => { setVideoOk(true); }, [backgroundVideoUrl]);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageOk, setImageOk] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [isPaused, setIsPaused] = useState(startPaused);
  // Where Play should pick the verse back up. A creator recording can be truly
  // paused mid-audio, but TTS can't be held, so pausing tears the run down and
  // Play restarts the effect — this ref is what stops that restart from going
  // back to the first phrase. 0 means "from the top".
  const resumeFromPhraseRef = useRef(0);
  const [activePhrase, setActivePhrase] = useState(-1);
  const [phrasePageStart, setPhrasePageStart] = useState(0);
  const [isSettled, setIsSettled] = useState(false);
  // Page-flip transition: while true, the outgoing page's phrases fade out
  // (~0.3s) before phrasePageStart advances, so the reader never shows the
  // old「掉到底→跳到頂」flicker. The ref mirrors it for the reactive
  // paginator effect (which must stand down during a fade).
  const [isPageFading, setIsPageFading] = useState(false);
  const isPageFadingRef = useRef(false);
  useEffect(() => { isPageFadingRef.current = isPageFading; }, [isPageFading]);
  // 預算版位:一頁的最後一句索引(整頁一次擺好,逐句就地淡入,不再逐句 mount 造成右擠)。
  const [phrasePageEnd, setPhrasePageEnd] = useState(0);
  const phrasePageStartRef = useRef(0);
  const phrasePageEndRef = useRef(0);
  useEffect(() => { phrasePageStartRef.current = phrasePageStart; }, [phrasePageStart]);
  useEffect(() => { phrasePageEndRef.current = phrasePageEnd; }, [phrasePageEnd]);
  // 預先量測算好的分頁:[{start,end}]（inclusive）。由隱藏鏡像量測產生。
  const pagesRef = useRef([]);
  const phraseMirrorRef = useRef(null);
  const [phraseContainerWidth, setPhraseContainerWidth] = useState(0);
  const [fontSizeLevel, setFontSizeLevel] = useState(
    RAIN_FONT_LEVELS.includes(initialFontSizeLevel) ? initialFontSizeLevel : DEFAULT_PLAY_FONT_CHOICE
  );
  const [showTopicPicker, setShowTopicPicker] = useState(false);
  // When entered from the lobby's 好文欣賞 card we open the picker AND hold
  // playback: the listener first chooses 每日一首 / 我的最愛 / 主題好文, and only
  // that choice starts the reading (initialized from the prop so the very first
  // play effect on mount already sees it — no race with effect ordering).
  const deferInitialPlayRef = useRef(autoOpenPicker || startPaused);
  const pickerOpenedOnceRef = useRef(false);
  // Auto-open the picker when the player is entered from the lobby's 好文欣賞
  // card, so the listener lands straight on the 每日一首 / 我的最愛 / 主題好文
  // chooser. The parent clears its flag via onAutoPickerOpened so it fires once.
  useEffect(() => {
    if (!autoOpenPicker) return;
    setShowTopicPicker(true);
    onAutoPickerOpened?.();
  }, [autoOpenPicker]); // eslint-disable-line react-hooks/exhaustive-deps
  // When playback is held for a lobby entry, start the default (today's daily
  // verse) once the picker actually closes — an explicit 每日一首 pick or a
  // plain dismiss both land here. A 我的最愛 / 主題好文 pick clears the flag
  // first (it navigates away), so it never auto-starts the daily verse.
  useEffect(() => {
    if (showTopicPicker) { pickerOpenedOnceRef.current = true; return; }
    if (deferInitialPlayRef.current && pickerOpenedOnceRef.current) {
      deferInitialPlayRef.current = false;
      setPlayKey(k => k + 1);
    }
  }, [showTopicPicker]);
  const bgmRef = useRef(null);
  const runRef = useRef(0);
  const topicPickerRef = useRef(null);
  const verseSetIdRef = useRef(verseSet?.id);
  const verseSourceRef = useRef(`${verseSet?.id || ''}-${startVerse?.reference || ''}-${startVerse?.text || ''}`);
  const onListenLoggedRef = useRef(onListenLogged);
  const onStopRef = useRef(onStop);
  const playDurationMinutesRef = useRef(playDurationMinutes);
  const playbackStartedAtRef = useRef(Date.now());
  const phraseContainerRef = useRef(null);
  const phraseNodeRefs = useRef([]);
  // Refs for values used inside the auto-play effect but that should NOT re-trigger it
  const phrasesRef = useRef(primaryPhrases);
  const versesRef = useRef(verses);
  const playOnceRef = useRef(playOnce);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => { onListenLoggedRef.current = onListenLogged; }, [onListenLogged]);
  useEffect(() => { onStopRef.current = onStop; }, [onStop]);
  useEffect(() => { playDurationMinutesRef.current = playDurationMinutes; }, [playDurationMinutes]);
  useEffect(() => { phrasesRef.current = primaryPhrases; }, [primaryPhrases]);
  useEffect(() => { versesRef.current = verses; }, [verses]);
  useEffect(() => { playOnceRef.current = playOnce; }, [playOnce]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    playbackStartedAtRef.current = Date.now();
  }, [verseSet?.id, startVerse?.reference, playDurationMinutes]);

  // 雙語對調的重讀觸發:readingKey 變動就 bump playKey → play effect(依賴 playKey)從頭重讀
  // 現在的第一語言。跳過首次掛載(初始播放由既有流程負責,不要多重讀一次)。
  const readingKeyInitRef = useRef(true);
  useEffect(() => {
    if (readingKeyInitRef.current) { readingKeyInitRef.current = false; return; }
    setPlayKey(k => k + 1);
  }, [readingKey]);

  useEffect(() => {
    if (!showTopicPicker) return undefined;

    const closeTopicPickerOnOutsideClick = (event) => {
      if (topicPickerRef.current?.contains(event.target)) return;
      setShowTopicPicker(false);
    };

    document.addEventListener('pointerdown', closeTopicPickerOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeTopicPickerOnOutsideClick);
  }, [showTopicPicker]);

  useEffect(() => {
    const sourceKey = `${verseSet?.id || ''}-${startVerse?.reference || ''}-${startVerse?.text || ''}`;
    if (verseSetIdRef.current === verseSet?.id && verseSourceRef.current === sourceKey) return;
    verseSetIdRef.current = verseSet?.id;
    verseSourceRef.current = sourceKey;
    setCurrentVerse(startVerse || pickRandomVerse(verses));
  }, [verseSet?.id, verses, startVerse]);

  useEffect(() => {
    // Background music source: creator's custom upload > default bgm.mp3;
    // bgMusic==='none' disables music for this set entirely.
    let cancelled = false;
    const setup = async () => {
      const choice = String(verseSet?.bgMusic || '');
      let src = '/bgm.mp3';
      if (choice === 'none') src = null;
      else if (choice.startsWith('custom:')) {
        try {
          src = await getSetAssetDataUrl(
            verseSet?.voiceSetId || verseSet?.id,
            choice.slice('custom:'.length),
            verseSet?.bgMusicMime || 'audio/mpeg'
          );
        } catch { src = '/bgm.mp3'; /* asset missing — fall back */ }
      }
      if (cancelled) return;
      bgmRef.current?.pause();
      bgmRef.current?._bgmDisconnect?.();
      if (!src) { bgmRef.current = null; return; }
      // The player only mounts after the start tap, so autoplay is allowed;
      // custom music may finish downloading mid-verse and joins right away.
      // startLoopingBgm honours the per-set volume on iOS too (Web Audio gain).
      bgmRef.current = startLoopingBgm(src, verseSet?.bgMusicVolume ?? 0.18);
    };
    setup();

    return () => {
      cancelled = true;
      runRef.current += 1;
      bgmRef.current?.pause();
      bgmRef.current?._bgmDisconnect?.();
      stopSpeechIfActive();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verseSet?.bgMusic, verseSet?.bgMusicVolume]);

  // useLayoutEffect (not useEffect) so the outgoing verse's revealed/settled
  // phrases are cleared BEFORE the browser paints the new verse. With a plain
  // useEffect the new scene first paints while isSettled/activePhrase still
  // held the previous verse's "all revealed" state, so the last page lingered
  // and then faded out (via the 0.45s opacity transition) before re-revealing.
  // Resetting pre-paint makes the last page disappear immediately — a clean cut
  // between verses instead of a cross-fade.
  React.useLayoutEffect(() => {
    // A different verse always starts from the top, never from a stale
    // resume point left behind by a pause on the previous verse.
    resumeFromPhraseRef.current = 0;
    setPlayKey(k => k + 1);
    setActivePhrase(-1);
    setPhrasePageStart(0);
    setPhrasePageEnd(0);
    phrasePageStartRef.current = 0;
    phrasePageEndRef.current = 0;
    setIsPageFading(false);
    phraseNodeRefs.current = [];
    setIsSettled(false);
    setImageIndex(0);
    setImageOk(true);
    setImageLoaded(false);
  }, [currentVerse?.reference]);

  // Reset animation state for single-verse repeat (playKey changes but reference stays the same)
  useEffect(() => {
    // …but NOT when Play is resuming a paused verse: wiping activePhrase here
    // is what made the blocks vanish and the reading start over.
    if (resumeFromPhraseRef.current > 0) return;
    setActivePhrase(-1);
    setPhrasePageStart(0);
    setPhrasePageEnd(0);
    phrasePageStartRef.current = 0;
    phrasePageEndRef.current = 0;
    setIsPageFading(false);
    setIsSettled(false);
  }, [playKey]);

  useEffect(() => {
    if (imageLoaded || !imageOk || backgroundImageUrls[imageIndex]?.startsWith('data:')) return undefined;
    const timeout = window.setTimeout(() => {
      setImageIndex(current => current < backgroundImageUrls.length - 1 ? current + 1 : current);
    }, 4500);
    return () => window.clearTimeout(timeout);
  }, [backgroundImageUrls, imageIndex, imageLoaded, imageOk]);

  // How long the outgoing page fades before the next phrase takes the top.
  // 換頁:舊頁瞬間清掉(不漸變),只留極短一格讓 DOM 換到新頁,近似硬切。
  const FLIP_FADE_MS = 60;

  // 依「隱藏鏡像」預先量測,把所有 phrases 切成一頁頁(每頁容納到 visualBottomLimit)。
  // 產生 pagesRef.current = [{start,end}]（inclusive）。量測在離屏鏡像上進行,使用者
  // 看不到任何 reflow;真正顯示時整頁一次擺好、逐句就地淡入(不掉落、不右擠、不跳頁)。
  const recomputePages = React.useCallback(() => {
    const mirror = phraseMirrorRef.current;
    const container = phraseContainerRef.current;
    if (!mirror || !container) return;
    // 每次都用真實容器「當下」的寬度餵鏡像(別用可能過期的 state:曾量到動畫過程中的
    // 暫時窄值 → 鏡像太窄、句子換行變多、每句量得過高 → 分頁過度保守,一頁只放一句)。
    const w = container.clientWidth;
    if (w && Math.abs(parseFloat(mirror.style.width) - w) > 1) mirror.style.width = w + 'px';
    const spans = mirror.children;
    if (!spans || spans.length === 0 || !w) { pagesRef.current = []; return; }
    const containerRect = container.getBoundingClientRect();
    const cstyle = getComputedStyle(container);
    const padTop = parseFloat(cstyle.paddingTop) || 0;
    const actionControls = document.querySelector('.continuous-rain-action-controls:not(.continuous-rain-close-topleft)');
    const actionControlsTop = actionControls ? actionControls.getBoundingClientRect().top : window.innerHeight;
    // 真正的視覺底部 = 動作列頂端(播放/分享/麥克風)。填到那裡才不浪費空間。容器已把
    // 下方 padding 縮到很小、border box 會延伸到動作列之下,所以直接用動作列當底,不再被
    // containerRect.bottom 提早卡住(那會讓一頁少放一句)。
    const bottomLimit = actionControlsTop - 12;
    // 保守留邊,避免臨界溢出被 overflow:hidden 裁字。
    const pageHeight = Math.max(1, bottomLimit - (containerRect.top + padTop) - 4);
    const pages = [];
    let start = 0;
    let pageTop = spans[0].offsetTop;
    for (let i = 0; i < spans.length; i += 1) {
      const el = spans[i];
      const bottom = el.offsetTop + el.offsetHeight;
      if (i > start && (bottom - pageTop) > pageHeight) {
        pages.push({ start, end: i - 1 });
        start = i;
        pageTop = el.offsetTop;
      }
    }
    pages.push({ start, end: spans.length - 1 });
    pagesRef.current = pages;
  }, []);

  // 某 phrase 屬於哪一頁(還沒算好時退化成單句一頁,保底不當機)。
  const pageForIndex = React.useCallback((i) => {
    const pages = pagesRef.current;
    if (pages && pages.length) {
      const p = pages.find(pg => i >= pg.start && i <= pg.end);
      if (p) return p;
    }
    return { start: i, end: i };
  }, []);

  // 真實容器寬度變動(視窗/轉向)→ 記錄並重算分頁。ResizeObserver 直接重算,
  // 不完全依賴 state(避免量到動畫暫時窄值後就卡住)。
  useEffect(() => {
    const container = phraseContainerRef.current;
    if (!container) return undefined;
    const sync = () => {
      const w = container.clientWidth;
      if (w) setPhraseContainerWidth(prev => (Math.abs(prev - w) > 1 ? w : prev));
      recomputePages();
    };
    sync();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(sync);
      ro.observe(container);
    }
    window.addEventListener('resize', sync);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', sync); };
  }, [recomputePages]);

  // 鏡像量測(尺寸/字級/雙語/內容變動)→ 繪製前重算分頁;並在版面沉澱後補算幾次
  // (rAF + 短延遲),避免開場動畫期間量到暫時尺寸。
  React.useLayoutEffect(() => {
    recomputePages();
    const raf = requestAnimationFrame(recomputePages);
    const t1 = window.setTimeout(recomputePages, 180);
    const t2 = window.setTimeout(recomputePages, 520);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [recomputePages, phraseContainerWidth, primaryPhrases, secondaryDisplayPhrases, hasSecondaryPhrases, fontSizeLevel, currentVerse?.reference]);

  // (舊的事後量測/修剪 measureAndTrim / trimOnResize 已移除 —— 分頁改由上方
  //  隱藏鏡像預先算好 pagesRef,顯示時不再需要事後修正,故不會再有「跳頁」。)

  useEffect(() => {
    if (!currentVerse) return undefined;
    // Held after a lobby 好文欣賞 entry until the listener picks from the auto-
    // opened chooser. handlePickDailyVerse lifts this and bumps playKey to start.
    if (deferInitialPlayRef.current) return undefined;
    let cancelled = false;
    const runId = runRef.current + 1;
    runRef.current = runId;
    // Clear the 朗讀者 badge from the PREVIOUS verse right away. If that
    // verse's recording was interrupted (‹ › navigation), its clear only
    // fires when the hung playback promise hits the hard cap — leaving a
    // stale name on verses that then play plain TTS.
    setCreatorVoiceName('');

    const wait = (ms) => new Promise(resolve => window.setTimeout(resolve, ms));

    const playVerse = async () => {
      await wait(350);
      if (cancelled || runRef.current !== runId) return;

      initAudio();
      window.speechSynthesis?.resume?.();
      bgmRef.current?.play().catch(() => {});

      const lang = getVoiceLangForVersion(swappedRef.current ? secondaryVersion : version);
      const currentPhrases = phrasesRef.current;

      // 創作者親聲朗讀 — play the creator's recording instead of TTS when one
      // exists for this verse; falls back to TTS on any failure. Find out FIRST
      // (see VOICE_LIST_WAIT_MS) rather than racing a short timer, so a slow
      // connection doesn't turn a real recording into robot speech.
      const loadingTimer = window.setTimeout(() => {
        if (!cancelled && runRef.current === runId) setVoiceLoading(true);
      }, 900);
      const stopLoadingHint = () => { window.clearTimeout(loadingTimer); setVoiceLoading(false); };
      await Promise.race([Promise.all([verseVoicesReadyRef.current, personalVoicesReadyRef.current]), wait(VOICE_LIST_WAIT_MS)]);
      if (cancelled || runRef.current !== runId) { stopLoadingHint(); return; }
      let creatorPlayed = false;
      // Priority: my (or the share sender's / picked contributor's) personal
      // voice › set owner's › TTS. forceTTS (picker: 電腦語音) skips both layers.
      // A live manual switch (manualVoiceRef, set by the reader selector) wins
      // over everything for as long as it's set.
      const mv = manualVoiceRef.current;
      let personalRec, ownerRec;
      if (mv) {
        if (mv.type === 'tts' || mv.type === 'silent') { personalRec = null; ownerRec = null; }
        else if (mv.type === 'owner') { personalRec = null; ownerRec = voiceSetId ? (verseVoicesRef.current?.[currentVerse.reference] || null) : null; }
        else { personalRec = mv.voices?.[currentVerse.reference] || null; ownerRec = null; }
      } else {
        personalRec = forceTTSRef.current ? null : (overrideVoicesRef.current?.[currentVerse.reference] || null);
        // Default: my/shared voice › newest public human (author or any
        // contributor) › author layer › TTS. latestVoicesRef already picked the
        // most-recent recording across everyone, so a verse with any human voice
        // never falls back to TTS. Author layer stays as a fallback if /voice-latest
        // hasn't resolved.
        const latestRec = (forceTTSRef.current || !voiceSetId) ? null : (latestVoicesRef.current?.[currentVerse.reference] || null);
        const authorRec = (forceTTSRef.current || !voiceSetId) ? null : (verseVoicesRef.current?.[currentVerse.reference] || null);
        // A share link pinned to the set author's OWN voice (vo=author): the
        // author layer lives in verseVoicesRef, not the personal-override bucket
        // loadMerged() reads — so match it here so the recipient hears exactly
        // the voice that was shared instead of the newest-public default.
        if (!personalRec && sharedVoiceOwner && authorRec?.byOwnerId === sharedVoiceOwner) {
          personalRec = authorRec;
        }
        ownerRec = latestRec || authorRec || null;
      }
      // 雙語對調中一律走電腦語音 TTS:親聲/作者錄音都是用原第一語言錄的,不適用於現在朗讀的第二語言。
      if (swappedRef.current) { personalRec = null; ownerRec = null; }
      const creatorRec = personalRec || ownerRec;
      if (creatorRec?.voiceId) {
        // Attribution for the green「{name} 親聲朗讀」badge. When it's the
        // listener's OWN voice, show nothing — the blue「這節有你的親聲」badge
        // already covers it, and its stored recordedBy can be a stale
        // playerName (e.g. an earlier "hungry@G"). Set-owner / shared-sender
        // recordings keep their name.
        const isOwnVoice = creatorRec === personalRec
          && (!sharedVoiceOwner || sharedVoiceOwner === myOwnerIdRef.current) && !mv;
        const voiceLabel = isOwnVoice ? '' : (creatorRec.recordedBy || '');
        // Reader-selector label: name it even when it's my own recording, so the
        // switcher shows the current voice clearly.
        setActiveVoiceLabel(isOwnVoice ? t('我的錄音', 'My recording') : (creatorRec.recordedBy || t('錄音', 'Recording')));
        // The hint stays up through the audio download — that is the slow part
        // on a phone — and playCreatorRecording drops it the moment sound
        // actually starts.
        // 版面此時已沉澱(尺寸不再受開場動畫影響)→ 用當下正確寬度重算分頁,
        // 避免用到動畫過程中的暫時窄值(那會讓句子量得過高、一頁少放一句)。
        recomputePages();
        creatorPlayed = await playCreatorRecording(creatorRec, currentPhrases, (i) => {
          if (cancelled || runRef.current !== runId) return;
          recomputePages(); // 每句決定前用當下寬度重算(見 TTS 路徑說明)
          // 逐句就地淡入。頁面預先算好:同頁只淡入(鄰句不動);跨到新頁才整頁淡出→換頁,
          // 絕不「落底→跳頂」。
          const pg = pageForIndex(i);
          if (pg.start !== phrasePageStartRef.current) {
            setIsPageFading(true);
            window.setTimeout(() => {
              if (cancelled || runRef.current !== runId) return;
              setPhrasePageStart(pg.start); setPhrasePageEnd(pg.end);
              phrasePageStartRef.current = pg.start; phrasePageEndRef.current = pg.end;
              setIsPageFading(false);
              setActivePhrase(i);
            }, FLIP_FADE_MS);
          } else {
            if (phrasePageEndRef.current !== pg.end) { setPhrasePageEnd(pg.end); phrasePageEndRef.current = pg.end; }
            setActivePhrase(i);
          }
        }, voiceLabel, stopLoadingHint);
        if (cancelled || runRef.current !== runId) { stopLoadingHint(); return; }
      }
      stopLoadingHint();

      if (!creatorPlayed) {
      // 無聲音 (silent) — same paced block reveal as the TTS path, but speak
      // nothing: just hold each phrase for its estimated duration so the
      // background music carries the reading.
      const silent = mv?.type === 'silent';
      const readAloud = (text, rate, lng, override) =>
        silent ? wait(estimateSpeechDuration(text, lng)) : speakTextTimed(text, rate, lng, override);
      // TTS path — reflect it in the reader selector.
      if (!cancelled && runRef.current === runId) setActiveVoiceLabel(silent ? t('無聲音', 'No voice') : t('電腦語音', 'Computer voice'));
      // Resuming mid-verse: skip re-announcing the reference and pick the
      // reading up at the phrase we were on. A resume point at or past the end
      // (the verse had already finished) falls back to a normal replay.
      const resumeAt = resumeFromPhraseRef.current > 0 && resumeFromPhraseRef.current < currentPhrases.length
        ? resumeFromPhraseRef.current
        : 0;
      resumeFromPhraseRef.current = 0;

      if (resumeAt === 0) {
        await readAloud(formatVerseReferenceForSpeech(currentVerse.reference, swappedRef.current ? secondaryVersion : version), 0.9, lang, swappedRef.current ? swapVoiceRef.current : null);
        if (cancelled || runRef.current !== runId) return;
        await wait(500);
      }

      // 版面已沉澱 → 用當下正確寬度重算分頁(見上方說明)。
      recomputePages();
      for (let i = resumeAt; i < currentPhrases.length; i++) {
        if (cancelled || runRef.current !== runId) return;
        // 每句決定前用「當下」寬度重算分頁,徹底避免鏡像寬度過期(某些裝置版面沉澱較慢
        // → 一頁少放一句)。同尺寸下結果不變,不會抖動。
        recomputePages();
        // 頁面預先算好:同頁只就地淡入(鄰句不動);跨到新頁才整頁淡出→換頁,
        // 絕不「落底→跳頂」。
        const pg = pageForIndex(i);
        if (pg.start !== phrasePageStartRef.current) {
          setIsPageFading(true);
          await wait(FLIP_FADE_MS);
          if (cancelled || runRef.current !== runId) return;
          setPhrasePageStart(pg.start); setPhrasePageEnd(pg.end);
          phrasePageStartRef.current = pg.start; phrasePageEndRef.current = pg.end;
          setIsPageFading(false);
          await wait(40);
        } else if (phrasePageEndRef.current !== pg.end) {
          setPhrasePageEnd(pg.end); phrasePageEndRef.current = pg.end;
        }
        setActivePhrase(i);
        await readAloud(currentPhrases[i], 0.86, lang, swappedRef.current ? swapVoiceRef.current : null);
        if (cancelled || runRef.current !== runId) return;
        await wait(180);
      }
      } // end !creatorPlayed (TTS path)

      if (cancelled || runRef.current !== runId) return;
      setActivePhrase(currentPhrases.length);
      setIsSettled(true);
      onListenLoggedRef.current?.();
      const durationLimit = playDurationMinutesRef.current;
      if (durationLimit && Date.now() - playbackStartedAtRef.current >= durationLimit * 60 * 1000) {
        bgmRef.current?.pause();
        onCompleteRef.current?.();
        onStopRef.current?.();
        return;
      }
      await wait(4300);
      if (cancelled || runRef.current !== runId) return;
      if (playOnceRef.current) {
        bgmRef.current?.pause();
        onCompleteRef.current?.();
        return;
      }
      // Single-verse card: a finished verse just replays — moving only happens
      // when the listener taps ‹ ›.
      if (loopCurrent) { setPlayKey(k => k + 1); return; }
      // 按序模式 loops through the set in order; 隨機 (default) shuffles.
      const list = versesRef.current || [];
      const nextVerse = verseSet?.playOrder === 'sequential'
        ? (() => {
            const at = list.findIndex(v => v?.reference === currentVerse.reference);
            return list[(at + 1) % Math.max(1, list.length)] || null;
          })()
        : pickRandomVerse(list, currentVerse.reference);
      if (!nextVerse || nextVerse.reference === currentVerse.reference) {
        // Single-verse set — bump playKey to force replay
        setPlayKey(k => k + 1);
      } else {
        setCurrentVerse(nextVerse);
      }
    };

    playVerse();

    return () => {
      cancelled = true;
      runRef.current += 1;
      stopSpeechIfActive();
      // Pause (but never destroy) the shared creator-audio element — it
      // must stay alive to keep iOS's user-gesture blessing for later verses.
      try { creatorAudioRef.current?.pause(); } catch { /* noop */ }
    };
  // playKey is included so single-verse sets can loop via setPlayKey.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVerse?.reference, version, playKey]);

  const haltPlayback = () => {
    runRef.current += 1;
    pausedRecordingRef.current = false;
    // Any halt that isn't a pause (navigation, close, recording) starts the
    // next play from the top. togglePause re-sets this straight after.
    resumeFromPhraseRef.current = 0;
    bgmRef.current?.pause();
    stopSpeechIfActive();
    // Also silence the creator/personal recording — it plays through a
    // persistent <audio> element that stopSpeechIfActive() doesn't touch, so
    // without this Pause / the 🎙️ record button wouldn't actually stop the
    // voice (you can't record over it).
    try { creatorAudioRef.current?.pause(); } catch { /* noop */ }
  };

  const togglePause = () => {
    const audio = creatorAudioRef.current;
    if (isPaused) {
      setIsPaused(false);
      // First Play after a paused challenge-return lifts the initial-play hold
      // so the reading actually starts.
      deferInitialPlayRef.current = false;
      if (pausedRecordingRef.current && audio) {
        // Resume the recording from exactly where it was paused.
        pausedRecordingRef.current = false;
        try { bgmRef.current?.play?.(); } catch { /* noop */ }
        audio.play().catch(() => setPlayKey(k => k + 1));
      } else {
        // TTS → restart the run, but resumeFromPhraseRef (set when we paused)
        // makes it continue from that phrase rather than the top.
        setPlayKey(k => k + 1);
      }
    } else {
      setIsPaused(true);
      if (audio && audio.src && !audio.paused && !audio.ended) {
        // A voice recording is mid-playback → truly pause it (hold position),
        // WITHOUT killing the run, so Resume continues from here.
        pausedRecordingRef.current = true;
        try { audio.pause(); } catch { /* noop */ }
        try { bgmRef.current?.pause(); } catch { /* noop */ }
      } else {
        // TTS can't be held mid-utterance, so stop the run — but remember the
        // phrase we were on so Play continues from there instead of starting
        // the verse over. Set AFTER haltPlayback, which clears it.
        const resumePoint = activePhrase;
        haltPlayback();
        resumeFromPhraseRef.current = Math.max(0, resumePoint);
      }
    }
  };

  const navigateVerse = (direction) => {
    if (!showNav) return;
    // Moving off the returned-to verse resumes normal auto-play behavior.
    deferInitialPlayRef.current = false;
    setIsPaused(false);
    haltPlayback();
    const len = verses.length;
    if (!len) return;
    if (len === 1) { setPlayKey(k => k + 1); return; }
    let idx = verses.findIndex(v =>
      v.reference === currentVerse?.reference && v.text === currentVerse?.text
    );
    // The exact object may differ (deep-linked copies, edited text) — fall
    // back to reference-only so ‹ › never restart from a wrong position.
    if (idx < 0) idx = verses.findIndex(v => v.reference === currentVerse?.reference);
    if (idx < 0) idx = direction > 0 ? -1 : 0;
    let nextIdx;
    if (clampNav) {
      // Single-verse card: stop at the ends instead of wrapping.
      nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= len) return;
    } else {
      // Wrap around at both ends — the old boundary behavior replayed the
      // last verse forever, which read as「按 › 卡住」.
      nextIdx = ((idx + direction) % len + len) % len;
    }
    const next = verses[nextIdx];
    setCurrentVerse(next);
    // Same reference as the current verse (duplicate refs in a set) would
    // not retrigger the playback effect — force it via playKey.
    if (next?.reference === currentVerse?.reference) setPlayKey(k => k + 1);
  };

  const handlePrevious = () => {
    if (prevDisabled || navAtFirst) return;
    haltPlayback();
    if (onPrevious) {
      onPrevious();
      return;
    }
    navigateVerse(-1);
  };

  const handleNext = () => {
    if (nextDisabled || navAtLast) return;
    haltPlayback();
    if (onNext) {
      onNext();
      return;
    }
    navigateVerse(1);
  };
  // Disable ‹ › at the ends of a single-verse card (clampNav).
  const clampIdx = clampNav
    ? verses.findIndex(v => v.reference === currentVerse?.reference && v.text === currentVerse?.text)
    : -1;
  const navAtFirst = clampNav && clampIdx <= 0;
  const navAtLast = clampNav && clampIdx >= 0 && clampIdx >= verses.length - 1;

  const handleSelectTopicSet = (set) => {
    if (!set?.id || !onSelectTopicSet) return;
    // Navigating to another set — don't let the picker-close effect start the
    // held daily verse; the target set's own player will start playing.
    deferInitialPlayRef.current = false;
    haltPlayback();
    setShowTopicPicker(false);
    onSelectTopicSet(set);
  };
  const handlePickDailyVerse = () => {
    // While held (lobby entry) closing the picker starts today's daily verse
    // via the picker-close effect. Otherwise this jumps to the daily verse.
    if (deferInitialPlayRef.current) { setShowTopicPicker(false); return; }
    setShowTopicPicker(false);
    onSelectDailyVerse?.();
  };
  const stripTopicPrefix = (title = '') => stripTopicPrefixLabel(title);
  const currentTopicLabel = (label || verseSet?.title || t('內容集', 'Collection'));
  const normalizedTopicButtonLabel = stripTopicPrefix(currentTopicLabel);

  if (!currentVerse) {
    return (
      <div className="continuous-rain-overlay">
        <div className="daily-verse-rain-shell daily-verse-rain-empty">
          {t('這個內容集目前沒有可播放的內容', 'This collection has no paragraphs to play.')}
        </div>
      </div>
    );
  }

  return (
    <div className="continuous-rain-overlay">
      <div className={`daily-verse-rain-shell continuous-rain-shell rain-font-${fontSizeLevel}`}>
        <div
          className="daily-verse-rain-scene continuous-rain-scene"
          key={`${currentVerse.reference}-${playKey}`}
        >
          {imageOk && (
            <img
              className="daily-verse-rain-image"
              src={backgroundImageUrls[imageIndex]}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                setImageLoaded(false);
                setImageIndex(current => {
                  if (current < backgroundImageUrls.length - 1) return current + 1;
                  setImageOk(false);
                  return current;
                });
              }}
            />
          )}
          {backgroundVideoUrl && videoOk && (
            <video
              className="daily-verse-rain-image"
              src={backgroundVideoUrl}
              muted
              loop
              autoPlay
              playsInline
              disablePictureInPicture
              aria-hidden="true"
              style={{ objectFit: 'cover' }}
              // A broken/unsupported clip silently drops this layer — the
              // poster <img> above keeps the scene intact.
              onError={() => setVideoOk(false)}
              onCanPlay={() => setImageLoaded(true)}
            />
          )}
          <div className={`daily-verse-rain-sky ${imageLoaded ? 'has-ai-image' : ''}`} />
          <div className="daily-verse-rain-glow" />
          <div className="daily-verse-rain-drops">
            {DAILY_RAIN_DROPS.map((drop, index) => (
              <span
                key={index}
                className={`depth-${drop.depth}`}
                style={{
                  '--x': drop.left,
                  '--y': drop.top,
                  '--drop-length': drop.length,
                  '--drop-width': drop.width,
                  '--drop-opacity': drop.opacity,
                  '--drop-duration': drop.duration,
                  '--drop-delay': drop.delay,
                  '--drop-drift': drop.drift,
                  '--drop-blur': drop.blur
                }}
              />
            ))}
          </div>
          <div className="daily-verse-rain-content continuous-rain-content">
            <div className="daily-verse-rain-topbar continuous-rain-topbar">
              {showNav && <button type="button" onClick={handlePrevious} disabled={prevDisabled || navAtFirst} aria-label={t('上一節', 'Previous paragraph')}>‹</button>}
              <div ref={topicPickerRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowTopicPicker(prev => !prev)}
                  className="daily-verse-rain-date continuous-rain-set-title"
                  style={{ border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(15, 23, 42, 0.35)', color: 'inherit', borderRadius: '12px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 800, fontSize: '1.08rem', maxWidth: '70vw', minWidth: '150px', lineHeight: 1.2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}
                >
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{normalizedTopicButtonLabel}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, opacity: 0.9, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{t('【更多好文】', 'More topic paragraphs')}</span>
                </button>
                {showTopicPicker && (() => {
                  const compareByLabel = (a, b) => {
                    const ta = stripTopicPrefix(a.title) || '';
                    const tb = stripTopicPrefix(b.title) || '';
                    try {
                      return new Intl.Collator('zh-Hant', { collation: 'stroke' }).compare(ta, tb);
                    } catch {
                      return ta.localeCompare(tb, 'zh-Hant');
                    }
                  };
                  const favorites = [...favoriteVerseSets].filter(set => set?.id).sort(compareByLabel);
                  const favoriteIds = new Set(favorites.map(set => set.id));
                  const topics = [...topicSets].filter(set => !favoriteIds.has(set?.id)).sort(compareByLabel);
                  // Anchor the popover just below the title button but center it on the
                  // viewport, not on the (off-centre) button wrapper — otherwise on a phone
                  // its right edge spills off-screen. The whole player is a fixed full-screen
                  // overlay, so position:fixed here is safe and non-scrolling.
                  const anchorRect = topicPickerRef.current?.getBoundingClientRect();
                  const dropTop = anchorRect ? Math.round(anchorRect.bottom + 8) : 72;
                  const renderSetButton = (set, isFavorite = false) => (
                    <button
                      key={set.id}
                      type="button"
                      onClick={() => handleSelectTopicSet(set)}
                      style={{ width: '100%', textAlign: 'center', border: isFavorite ? '1px solid rgba(250, 204, 21, 0.45)' : 'none', borderRadius: '8px', background: set.id === verseSet?.id ? 'rgba(59,130,246,.32)' : (isFavorite ? 'rgba(250,204,21,0.12)' : 'rgba(148,163,184,0.08)'), color: '#e2e8f0', padding: '0.5rem 0.4rem', fontSize: '0.9rem', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.28rem' }}
                    >
                      {isFavorite && <Star size={13} fill="#facc15" color="#facc15" />}
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{stripTopicPrefix(set.title)}</span>
                    </button>
                  );
                  return (
                    <div style={{ position: 'fixed', top: dropTop, left: '50%', transform: 'translateX(-50%)', width: 'min(92vw, 560px)', maxHeight: '60vh', overflowY: 'auto', background: 'rgba(15, 23, 42, 0.94)', border: '1px solid rgba(148, 163, 184, 0.45)', borderRadius: '14px', boxShadow: '0 16px 36px rgba(2,6,23,.45)', zIndex: 30, padding: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {onSelectDailyVerse && (
                        <section>
                          <button
                            type="button"
                            onClick={handlePickDailyVerse}
                            style={{ width: '100%', textAlign: 'center', border: '1px solid rgba(129,140,248,0.55)', borderRadius: '8px', background: 'linear-gradient(135deg, rgba(129,140,248,0.30), rgba(99,102,241,0.22))', color: '#e2e8f0', padding: '0.6rem 0.4rem', fontSize: '0.95rem', fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                          >
                            <CloudRain size={16} /> {t('每日一首', 'Daily Paragraph')}
                          </button>
                        </section>
                      )}
                      <section>
                        <div style={{ color: '#fde68a', fontSize: '0.78rem', fontWeight: 900, margin: '0 0 0.35rem 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', width: '100%', textAlign: 'center' }}>
                          <Star size={14} fill="currentColor" /> {t('我的最愛', 'Favorites')}
                        </div>
                        {favorites.length > 0 ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.35rem' }}>
                            {favorites.map(set => renderSetButton(set, true))}
                          </div>
                        ) : (
                          <div style={{ color: '#94a3b8', fontSize: '0.82rem', padding: '0.45rem 0.35rem', textAlign: 'center', border: '1px dashed rgba(148,163,184,0.35)', borderRadius: '8px' }}>
                            {userEmail ? t('到聽與說按星號加入', 'Star sets in Collections') : t('登入後可加入我的最愛', 'Log in to save favorites')}
                          </div>
                        )}
                      </section>
                      <section>
                        <div style={{ color: '#cbd5e1', fontSize: '0.78rem', fontWeight: 900, margin: '0 0 0.35rem 0.1rem' }}>
                          {t('主題好文', 'Topic paragraphs')}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.35rem' }}>
                          {topics.map(set => renderSetButton(set))}
                        </div>
                      </section>
                    </div>
                  );
                })()}
              </div>
              {showNav && <button type="button" onClick={handleNext} disabled={nextDisabled || navAtLast} aria-label={t('下一節', 'Next paragraph')}>›</button>}
            </div>
            {/* Reference, its secondary-language twin and the reader credit all
                share one baseline-aligned row. They used to stack three deep
                above the verse, which is space the falling phrases need more. */}
            <div className="continuous-rain-heading">
              <h2>{formatVerseReferenceForDisplay(currentVerse.reference, activePrimaryVersion)}</h2>
              {secondaryHeadingText && (
                <span className="continuous-rain-secondary-reference">
                  {secondaryHeadingText}
                </span>
              )}
            </div>
            {voiceLoading && (
              <div style={{ textAlign: 'center', margin: '-0.1rem 0 0.4rem', fontSize: '0.82rem' }}>
                <span style={{ color: '#93c5fd', fontWeight: 600 }}>⏳ {t('正在載入朗讀…', 'Loading the reading…')}</span>
              </div>
            )}
            {voiceStatus[currentVerse.reference] === 'processing' ? (
              <div style={{ textAlign: 'center', margin: '-0.1rem 0 0.4rem', fontSize: '0.82rem' }}>
                <span style={{ color: '#93c5fd', fontWeight: 600 }}>⏳ {t('親聲處理中…（可繼續錄下一節）', 'Processing your voice… (you can record the next paragraph)')}</span>
              </div>
            ) : voiceStatus[currentVerse.reference] === 'error' ? (
              <div style={{ textAlign: 'center', margin: '-0.1rem 0 0.4rem', fontSize: '0.82rem' }}>
                <span style={{ color: '#fca5a5', fontWeight: 600 }}>⚠️ {t('親聲上傳失敗,請重錄', 'Voice upload failed — please re-record')}</span>
              </div>
            ) : myVoiceForCurrent ? (
              <div style={{ textAlign: 'center', margin: '-0.1rem 0 0.4rem', fontSize: '0.82rem' }}>
                <span style={{ color: '#000000', fontWeight: 600, textShadow: '0.06em 0.08em 2px rgba(255, 255, 255, 0.95), 0.12em 0.16em 8px rgba(255, 255, 255, 0.65)' }}>🎙️ {t('我的錄音', 'My recording')}</span>
                <button
                  type="button"
                  onClick={() => deleteMyVoice(currentVerse.reference)}
                  disabled={personalBusy}
                  style={{ marginLeft: 8, background: 'transparent', border: '1px solid rgba(220,38,38,0.7)', color: '#dc2626', borderRadius: 6, padding: '1px 8px', cursor: personalBusy ? 'default' : 'pointer', fontSize: '0.75rem', fontWeight: 600, opacity: personalBusy ? 0.5 : 1, textShadow: '0.06em 0.08em 2px rgba(255, 255, 255, 0.85)' }}
                >
                  {t('刪除', 'Delete')} ✕
                </button>
              </div>
            ) : null}
            <div
              ref={phraseContainerRef}
              className={`daily-verse-rain-phrases continuous-rain-phrases ${hasSecondaryPhrases ? 'has-secondary' : ''} ${isSettled ? 'is-settled' : ''} ${isPageFading ? 'is-page-fading' : ''}`}
              aria-live="polite"
            >
              {/* 整頁一次擺好(index 落在 [phrasePageStart..phrasePageEnd] 都在 DOM、占好
                  最終版位),已讀到的句子才淡入(is-revealed);未讀的占位不顯示。→ 逐句
                  就地淡入、鄰句不位移(no drop / no squeeze / no jump)。 */}
              {primaryPhrases.map((phrase, index) => {
                if (index < phrasePageStart || index > phrasePageEnd) return null;
                const secondaryPhrase = hasSecondaryPhrases
                  ? getSecondaryPhrasesForIndex(index, primaryPhrases.length, secondaryDisplayPhrases)
                  : '';
                const revealed = isSettled || index <= activePhrase;
                return (
                <span
                  key={`${phrase}-${index}`}
                  ref={node => {
                    phraseNodeRefs.current[index] = node;
                  }}
                  className={`${index === activePhrase ? 'is-active' : ''} ${revealed ? 'is-revealed' : ''}`}
                >
                  <b><Annotated text={phrase} mode={primaryAnnotation} /></b>
                  {secondaryPhrase && <small><Annotated text={secondaryPhrase} mode={secondaryAnnotation} /></small>}
                </span>
                );
              })}
            </div>
            {/* 隱藏量測鏡像:寬度對齊真實容器,含全部句子,用來預先算好分頁(pagesRef)。
                離屏不可見,使用者不會看到任何 reflow。 */}
            <div
              ref={phraseMirrorRef}
              aria-hidden="true"
              className={`daily-verse-rain-phrases continuous-rain-phrases ${hasSecondaryPhrases ? 'has-secondary' : ''}`}
              style={{
                position: 'absolute',
                left: '-99999px',
                top: 0,
                visibility: 'hidden',
                pointerEvents: 'none',
                width: phraseContainerWidth ? `${phraseContainerWidth}px` : undefined,
                height: 'auto',
                maxHeight: 'none',
                minHeight: 0,
                overflow: 'visible',
              }}
            >
              {primaryPhrases.map((phrase, index) => {
                const secondaryPhrase = hasSecondaryPhrases
                  ? getSecondaryPhrasesForIndex(index, primaryPhrases.length, secondaryDisplayPhrases)
                  : '';
                return (
                  <span key={`m-${phrase}-${index}`}>
                    <b><Annotated text={phrase} mode={primaryAnnotation} /></b>
                    {secondaryPhrase && <small><Annotated text={secondaryPhrase} mode={secondaryAnnotation} /></small>}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {/* 關閉鈕獨立放在左上角（好找）；沿用 action-controls 的按鈕樣式。 */}
      <div className="continuous-rain-action-controls continuous-rain-close-topleft">
        <button
          type="button"
          className="is-icon is-stop"
          title={t('關閉', 'Close')}
          data-tip={t('關閉', 'Close')}
          onClick={() => {
            haltPlayback();
            onStop?.();
          }}
        >
          <XCircle size={22} />
        </button>
      </div>
      <div className="continuous-rain-action-controls" aria-label={t('播放操作', 'Playback actions')}>
        <span className="continuous-rain-primary-actions">
          <button
            type="button"
            className="is-icon is-play-pause"
            title={isPaused ? t('播放', 'Play') : t('暫停', 'Pause')}
            data-tip={isPaused ? t('播放', 'Play') : t('暫停', 'Pause')}
            onClick={togglePause}
          >
            {isPaused ? <Play size={22} fill="currentColor" /> : <Pause size={22} />}
          </button>
          {onChallengeVerse && (
            <button
              type="button"
              className="is-icon"
              title={t('挑戰', 'Challenge')}
              data-tip={t('挑戰', 'Challenge')}
              onClick={() => {
                haltPlayback();
                // Open the mode/difficulty chooser instead of launching straight
                // into whatever mode was last configured elsewhere.
                setChallengeChooser(loadChallengeSetup());
              }}
            >
              <Zap size={22} />
            </button>
          )}
          {onShareVerse && (
            <button
              type="button"
              className="is-icon"
              disabled={shareBusy}
              title={shareBusy
                ? t('親聲上傳中,請稍候…', 'Uploading your voice…')
                : (myVoiceForCurrent ? t('分享（附上你的親聲）', 'Share (with your voice)') : t('分享', 'Share'))}
              data-tip={shareBusy
                ? t('親聲上傳中…', 'Uploading…')
                : (myVoiceForCurrent ? t('分享（附上你的親聲）', 'Share (with your voice)') : t('分享', 'Share'))}
              onClick={async () => {
                const ref = currentVerse.reference;
                // If this verse's recording is still baking/uploading, wait for it
                // so the shared link actually carries the voice (not owner/TTS).
                const pending = uploadPromisesRef.current[ref];
                if (pending) {
                  setShareBusy(true);
                  try { await pending; } catch { /* share without the voice */ }
                  setShareBusy(false);
                }
                // Carry the voice the sharer is actually hearing (a contributor
                // like Bene, my own, or the author) so the recipient opens
                // straight into that recording. null = TTS → recipient gets the
                // set's own default (newest public voice). currentTargetOwnerId
                // mirrors playVerse's live selection, so it already accounts for
                // "my own wins" and the newest-public-voice default.
                onShareVerse(currentVerse, { voiceOwner: currentTargetOwnerId() });
              }}
            >
              <Share2 size={22} />
            </button>
          )}
          {onToggleFavoriteSet && (
            <button
              type="button"
              className="is-icon"
              style={isFavoriteSet
                ? { borderColor: 'rgba(250,204,21,0.9)', background: 'rgba(250,204,21,0.18)', color: '#facc15' }
                : undefined}
              title={isFavoriteSet
                ? t('從我的最愛移除', 'Remove from favorites')
                : (userEmail ? t('加入我的最愛', 'Add to favorites') : t('登入後可加入我的最愛', 'Log in to save favorites'))}
              data-tip={isFavoriteSet ? t('已在我的最愛', 'In favorites') : t('我的最愛', 'Favorites')}
              onClick={() => onToggleFavoriteSet()}
            >
              <Star size={22} fill={isFavoriteSet ? 'currentColor' : 'none'} />
            </button>
          )}
          {personalVoiceSetId && userEmail && (
            <button
              type="button"
              className={`is-icon ${myVoiceForCurrent ? 'is-primary' : ''}`}
              disabled={swapped}
              title={swapped
                ? t('對調中無法錄音，請先按還原', 'Recording is off while swapped — restore first')
                : (myVoiceForCurrent ? t('重錄我的親聲', 'Re-record my voice') : t('錄我的親聲', 'Record my voice'))}
              data-tip={swapped
                ? t('對調中無法錄音', 'Off while swapped')
                : (myVoiceForCurrent ? t('重錄', 'Re-record') : t('錄音', 'Record'))}
              onClick={() => {
                // 對調中錄音會錄到原第一語言、且以節數為 key 覆蓋該節錄音 → 停用,請先還原。
                if (swapped) return;
                haltPlayback();
                setVoiceRecTarget({ reference: currentVerse.reference, text: currentVerse.text });
              }}
            >
              <Mic size={22} />
            </button>
          )}
        </span>
        <span className="continuous-rain-language-actions">
        {voiceSetId && (activeVoiceLabel || creatorVoiceName) && (
          <span className="continuous-rain-reader" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            <button
              type="button"
              onClick={openVoiceSwitchMenu}
              title={t('切換聲音', 'Switch voice')}
              data-tip={t('切換聲音', 'Switch voice')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.68rem', borderRadius: 999, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(15,23,42,0.6)', color: '#fff', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 'min(150px, 30vw)' }}
            >
              <Mic size={16} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(activeVoiceLabel || creatorVoiceName)}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.85 }}>▾</span>
            </button>
            {currentTargetOwnerId() && (
              <button
                type="button"
                onClick={openCommentsForCurrent}
                title={t('鼓勵這位朗讀者', 'Encourage this reader')}
                data-tip={t('鼓勵這位朗讀者', 'Encourage this reader')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  minWidth: 0,
                  height: 36,
                  padding: '0 0.72rem',
                  borderRadius: 999,
                  border: '1px solid rgba(250,204,21,0.72)',
                  background: 'linear-gradient(135deg, rgba(250,204,21,0.95), rgba(245,158,11,0.9))',
                  color: '#422006',
                  boxShadow: '0 8px 20px rgba(245,158,11,0.28)',
                  fontSize: '0.84rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                <MessageCircle size={16} />
                <span>{t('鼓勵', 'Encourage')}</span>
              </button>
            )}
          </span>
        )}
        {onSecondaryVersionChange && (
          // Tooltip lives on a wrapper span — ::after doesn't render on <select>.
          <span data-tip={t('選擇第二語言', 'Second language')} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.32rem' }}>
            <select
              value={secondaryVersion || ''}
              onChange={(event) => onSecondaryVersionChange(event.target.value)}
              title={swapped ? t('正在朗讀第二語言', 'Reading the second language') : t('選擇第二語言', 'Second language')}
              style={{ minWidth: 0, flex: '0 1 142px', maxWidth: '34vw', padding: '0.4rem 0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(15,23,42,0.6)', color: '#e2e8f0', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              {BIBLE_LANGUAGE_OPTIONS.filter(option => option.value !== version).map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </span>
        )}
        {secondaryVersion && (
          // 放在「第二語言：…」之後,用文字說明用途:一鍵改用第二語言朗讀,再按還原第一語言。
          <button
            type="button"
            disabled={!swapped && !canSwapToSecondary}
            aria-pressed={swapped}
            title={swapped
              ? t('改回第一語言朗讀', 'Back to reading the 1st language')
              : t('暫時改用第二語言朗讀（不改變 App 語言）', 'Temporarily read in the 2nd language (does not change the app language)')}
            onClick={() => {
              // 已對調 → 還原第一語言。未對調 → 讓玩家先選第二語言的朗讀語音再開始播放:
              // 有多個可選語音時開選單;只有一個或沒有就直接用它開始。純本地,不動 App 語言。
              if (swapped) { stopSwap(); return; }
              const { options, preferred } = liveSecondaryVoiceOptions();
              if (options.length > 1) {
                setSwapVoice(preferred || null); // 預先高亮偏好語音
                setSwapVoiceMenu(options);
              } else {
                startSwapWithVoice(preferred || options[0]?.voice || null);
              }
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap',
              padding: '0.45rem 0.85rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700,
              cursor: (!swapped && !canSwapToSecondary) ? 'not-allowed' : 'pointer',
              opacity: (!swapped && !canSwapToSecondary) ? 0.5 : 1,
              border: swapped ? '1px solid #2563eb' : '1px solid rgba(255,255,255,0.25)',
              background: swapped ? '#2563eb' : 'rgba(15,23,42,0.6)',
              color: '#fff',
            }}
          >
            <ArrowRightLeft size={16} />
            {swapped ? t('還原', 'Back') : t('朗讀', 'Read')}
          </button>
        )}
        </span>
      </div>
      {voiceRecTarget && (
        <VerseVoiceRecorder
          t={t}
          reference={formatVerseReferenceForDisplay(voiceRecTarget.reference, version)}
          verseText={voiceRecTarget.text}
          onUpload={saveMyVoice}
          onCancel={() => setVoiceRecTarget(null)}
          onDone={() => setVoiceRecTarget(null)}
          showShareToggle
        />
      )}

      {/* 切換聲音 menu — pick which recording (or TTS) reads the set from here on */}
      {voiceMenu && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setVoiceMenu(null); }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '1.4rem 1.3rem', width: '100%', maxWidth: 340, boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 0.3rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>🎙️ {t('切換聲音', 'Switch voice')}</h3>
            <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.82rem' }}>{formatVerseReferenceForDisplay(currentVerse.reference, version)}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {voiceMenuLoading && <div style={{ color: '#94a3b8', fontSize: '0.88rem', textAlign: 'center' }}>{t('載入中…', 'Loading…')}</div>}
              {voiceMenu.options.map((opt, i) => {
                const active = manualVoiceRef.current?.type === opt.type && (opt.type === 'owner' || manualVoiceRef.current?.ownerId === opt.ownerId);
                return (
                  <button key={i} onClick={() => applyVoiceChoice(opt)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.65rem 0.85rem', borderRadius: 10, border: active ? '2px solid #8b5cf6' : '1px solid #e2e8f0', background: active ? '#f5f3ff' : '#f8fafc', color: active ? '#6d28d9' : '#334155', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                    <span>🎙️</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {opt.type === 'owner'
                        ? (opt.recordedBy ? t('作者:{n}', 'Author: {n}').replace('{n}', opt.recordedBy) : t('作者錄音', 'Author'))
                        : `${opt.recordedBy || t('某人', 'Someone')}${opt.mine ? ` ${t('(你)', '(you)')}` : ''}`}
                    </span>
                  </button>
                );
              })}
              {!voiceMenuLoading && voiceMenu.options.length === 0 && (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '0.3rem 0' }}>{t('此節目前只有電腦語音', 'Only the computer voice for this paragraph')}</div>
              )}
              <button onClick={() => applyVoiceChoice({ type: 'tts' })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.65rem 0.85rem', borderRadius: 10, border: manualVoiceRef.current?.type === 'tts' ? '2px solid #8b5cf6' : '1px dashed #cbd5e1', background: '#fff', color: '#64748b', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                <span>💻</span><span style={{ flex: 1 }}>{t('電腦語音', 'Computer voice')}</span>
              </button>
              {/* 無聲音 — only background music + blocks, no TTS or recordings. */}
              <button onClick={() => applyVoiceChoice({ type: 'silent' })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.65rem 0.85rem', borderRadius: 10, border: manualVoiceRef.current?.type === 'silent' ? '2px solid #8b5cf6' : '1px dashed #cbd5e1', background: '#fff', color: '#64748b', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                <span>🔇</span><span style={{ flex: 1 }}>{t('無聲音', 'No voice')}</span>
              </button>
            </div>
            <button onClick={() => setVoiceMenu(null)} style={{ marginTop: '1rem', width: '100%', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>{t('取消', 'Cancel')}</button>
          </div>
        </div>
      )}

      {/* 朗讀第二語言 — 先選 TTS 語音,再開始播放(挑好即進入對調並從頭朗讀)。 */}
      {swapVoiceMenu && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setSwapVoiceMenu(null); }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '1.4rem 1.3rem', width: '100%', maxWidth: 340, boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
            <h3 style={{ margin: '0 0 0.3rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>🔊 {t('選擇朗讀語音', 'Choose a voice')}</h3>
            <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.82rem' }}>
              {t('選好語音就開始用第二語言朗讀。', 'Pick a voice to start reading in the 2nd language.')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
              {swapVoiceMenu.map((opt) => {
                const active = voiceId(swapVoice) === opt.id;
                return (
                  <button key={opt.id} onClick={() => startSwapWithVoice(opt.voice)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.65rem 0.85rem', borderRadius: 10, border: active ? '2px solid #2563eb' : '1px solid #e2e8f0', background: active ? '#eff6ff' : '#f8fafc', color: active ? '#1d4ed8' : '#334155', fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                    <span>🔊</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setSwapVoiceMenu(null)} style={{ marginTop: '1rem', width: '100%', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>{t('取消', 'Cancel')}</button>
          </div>
        </div>
      )}

      {/* ⚡ 挑戰 chooser — pick mode + difficulty, then launch */}
      {challengeChooser && (
        <ChallengeSetupModal
          t={t}
          subtitle={formatVerseReferenceForDisplay(currentVerse.reference, version)}
          value={challengeChooser}
          onChange={setChallengeChooser}
          onStart={(v) => { setChallengeChooser(null); onChallengeVerse(currentVerse, v); }}
          onCancel={() => setChallengeChooser(null)}
        />
      )}
    </div>
  );
}

function playShuffleSound() {
  initAudio();
  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400 + Math.random() * 300, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.08);
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    }, i * 35);
  }
}

function playBong() {
  initAudio();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(250, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.4);

  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.8, audioCtx.currentTime + 0.05);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}

function playThunder(type = 'light') {
  initAudio();
  const isHeavy = type === 'heavy';
  const duration = isHeavy ? 4.0 : 1.5;
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);

  // Generate brown noise
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 4.0;
  }

  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(isHeavy ? 300 : 500, audioCtx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + duration);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(isHeavy ? 1.5 : 0.6, audioCtx.currentTime + 0.1);
  if (isHeavy) {
    gain.gain.setValueAtTime(1.5, audioCtx.currentTime + 0.3);
    gain.gain.linearRampToValueAtTime(0.8, audioCtx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(1.2, audioCtx.currentTime + 0.7);
  }
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  noiseSource.start();
}

function playTada() {
  initAudio();
  const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5 Arpeggio
  let startTime = audioCtx.currentTime;
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.value = freq;

    gainNode.gain.setValueAtTime(0, startTime + i * 0.15);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + i * 0.15 + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + i * 0.15 + 0.6);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start(startTime + i * 0.15);
    osc.stop(startTime + i * 0.15 + 0.6);
  });
}

// 地圖即時脈動的交響音效:每種動作一種樂器,全取自五聲音階(pentatonic),
// 所以多人同時活動、聲音疊在一起也永遠和諧、悅耳。複用共享 audioCtx。
const PENTA_MID = [523.25, 587.33, 659.25, 783.99, 880.00];     // C5 D5 E5 G5 A5
const PENTA_HI  = [880.00, 1046.50, 1174.66, 1318.51, 1567.98]; // A5 C6 D6 E6 G6
let __lastPulseToneTs = 0;
function playPulseTone(action) {
  initAudio();
  if (!audioCtx || audioCtx.state === 'suspended') return; // 未解鎖前靜默
  const wall = Date.now();
  if (wall - __lastPulseToneTs < 80 && action !== 'done' && action !== 'fruit') return; // 節流(done/fruit 高潮不受限)
  __lastPulseToneTs = wall;
  const now = audioCtx.currentTime;
  const voice = (freq, t0, dur, type, peak) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };
  const pick = (a) => a[(Math.random() * a.length) | 0];
  if (action === 'listen') {          // 聆聽 — 柔和高音鈴(celesta)
    const f = pick(PENTA_HI);
    voice(f, now, 0.9, 'sine', 0.10);
    voice(f * 2, now, 0.5, 'sine', 0.03);   // shimmer 高八度
  } else if (action === 'play') {     // 開始挑戰 — 溫暖木琴(marimba)
    const f = pick(PENTA_MID);
    voice(f, now, 0.55, 'triangle', 0.14);
    voice(f / 2, now, 0.4, 'sine', 0.04);   // 低八度琴身
  } else if (action === 'fruit') {    // 創新高 / 得新果子 — 喜慶的鼓聲(taiko)
    playPulseDrum(now);
  } else {                            // 完成 — 上行豎琴琶音(高潮)
    const i = (Math.random() * 3) | 0;
    const seq = [PENTA_MID[i], PENTA_MID[i + 1], PENTA_MID[i + 2] || PENTA_HI[1]];
    seq.forEach((fr, k) => {
      voice(fr, now + k * 0.075, 0.6, 'triangle', 0.12);
      voice(fr * 2, now + k * 0.075, 0.35, 'sine', 0.03);
    });
  }
}

// 一記結實的太鼓:低頻下沉的鼓身 + 短促打擊噪音,配合鼓面漣漪,
// 標記「有人在某段創新高、結出新果子」。
function playPulseDrum(now) {
  if (!audioCtx) return;
  const t0 = now;
  // 鼓身:pitch 由 180Hz 快速下沉到 55Hz
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.18);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.34, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.38);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.45);
  // 打擊瞬態:短暫的低通噪音,給鼓「啪」的一下
  try {
    const len = Math.floor(audioCtx.sampleRate * 0.05);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = audioCtx.createBufferSource();
    noise.buffer = buf;
    const nf = audioCtx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1400;
    const ng = audioCtx.createGain();
    ng.gain.value = 0.14;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(audioCtx.destination);
    noise.start(t0);
    noise.stop(t0 + 0.05);
  } catch {}
}

// 地圖:有新朋友加入時播放歡迎小號。走共享 audioCtx(解碼成 AudioBuffer 快取一次),
// 這樣在 iOS「🔊 開啟聲音」手勢解鎖後,之後(非手勢)也能播放。
let __welcomeBuffer = null;
let __welcomeLoading = null;
let __lastWelcomeTs = 0;
function playWelcomeFanfare() {
  initAudio();
  if (!audioCtx || audioCtx.state === 'suspended') return; // 未解鎖前不播
  const now = Date.now();
  if (now - __lastWelcomeTs < 15000) return; // 節流:15 秒內最多一次,避免洗版
  const playBuf = () => {
    if (!__welcomeBuffer || !audioCtx) return;
    try {
      __lastWelcomeTs = Date.now();
      const src = audioCtx.createBufferSource();
      src.buffer = __welcomeBuffer;
      const g = audioCtx.createGain();
      g.gain.value = 0.55;
      src.connect(g);
      g.connect(audioCtx.destination);
      src.start();
    } catch {}
  };
  if (__welcomeBuffer) { playBuf(); return; }
  if (!__welcomeLoading) {
    __welcomeLoading = fetch('/welcome-fanfare.mp3')
      .then(r => r.arrayBuffer())
      .then(ab => new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej)))
      .then(buf => { __welcomeBuffer = buf; return buf; })
      .catch(() => { __welcomeLoading = null; return null; });
  }
  __welcomeLoading.then(buf => { if (buf) playBuf(); });
}

function playFireworksSound() {
  initAudio();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(Math.random() * 200 + 100, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.2);
  osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.5);

  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.1);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.5);
}

import { loadLanguageSets } from './verseLoader';
import { getRandomFakePhrase } from './fakeLogic';

const Tooltip = ({ text, children }) => (
  <div className="fancy-tooltip-container">
    {children}
    <div className="fancy-tooltip-text">{text}</div>
  </div>
);

const findVerseByRef = (allVerses, ref) => {
  let target = allVerses.find(v => v.reference === ref);
  if (!target && ref) {
    const refTrim = ref.replace(/\s+/g, '');
    target = allVerses.find(v => v.reference.replace(/\s+/g, '') === refTrim);

  }
  return target;
};

// Title-sort key: strip leading punctuation/quotes/brackets so
// 「敬拜」/《青少年》/(力量) sort by their first real character instead of
// clumping under the punctuation marks.
function titleSortKey(s) {
  return String(s || '').replace(/^[^\p{L}\p{N}]+/u, '');
}

const topicStrokeCollator = (() => {
  try {
    return new Intl.Collator(['zh-Hant-u-co-stroke', 'zh-u-co-stroke'], {
      usage: 'sort',
      sensitivity: 'base',
      numeric: true
    });
  } catch {
    return new Intl.Collator('zh-Hant', { usage: 'sort', sensitivity: 'base', numeric: true });
  }
})();

const TOPIC_PREFIX_REGEX = /^(主題|主题|Topic|Tema|Thema|Thème|Konu|موضوع|נושא|テーマ|주제|ခေါင်းစဉ်|Chủ đề|Тема|विषय|Topik)\s*[：:]\s*/i;

const stripTopicPrefixLabel = (title = '') => String(title).replace(TOPIC_PREFIX_REGEX, '');

const TOPIC_TITLE_PREFIX_BY_LANG = {
  cuv: '主題',
  cuvs: '主题',
  tw: '主題',
  kjv: 'Topic',
  esv: 'Topic',
  niv: 'Topic',
  fa: 'موضوع',
  ar: 'موضوع',
  he: 'נושא',
  ja: 'テーマ',
  ko: '주제',
  es: 'Tema',
  tr: 'Konu',
  de: 'Thema',
  pt: 'Tema',
  fr: 'Thème',
  ru: 'Тема',
  hi: 'विषय',
  my: 'ခေါင်းစဉ်',
  vi: 'Chủ đề',
  id: 'Topik',
  ms: 'Topik'
};

const OFFICIAL_TOPIC_TITLE_TRANSLATIONS = {
  covenant: {
    cuv: '盟約', cuvs: '盟约', tw: '盟約', kjv: 'Covenant', esv: 'Covenant', niv: 'Covenant',
    fa: 'میثاق', ar: 'العهد', he: 'ברית', ja: '契約', ko: '언약',
    es: 'Pacto', tr: 'Antlaşma', de: 'Bund', pt: 'Aliança', fr: 'Alliance', ru: 'Завет',
    hi: 'वाचा', my: 'ပဋိညာဉ်', vi: 'Giao ước', id: 'Perjanjian', ms: 'Perjanjian'
  },
  heal: {
    cuv: '醫治', cuvs: '医治', tw: '醫治', kjv: 'Healing', esv: 'Healing', niv: 'Healing',
    fa: 'شفا', ar: 'الشفاء', he: 'ריפוי', ja: '癒やし', ko: '치유',
    es: 'Sanidad', tr: 'Şifa', de: 'Heilung', pt: 'Cura', fr: 'Guérison', ru: 'Исцеление',
    hi: 'चंगाई', my: 'ကုစားခြင်း', vi: 'Chữa lành', id: 'Penyembuhan', ms: 'Penyembuhan'
  },
  mercy: {
    cuv: '憐憫', cuvs: '怜悯', tw: '憐憫', kjv: 'Mercy', esv: 'Mercy', niv: 'Mercy',
    fa: 'رحمت', ar: 'الرحمة', he: 'רחמים', ja: 'あわれみ', ko: '자비',
    es: 'Misericordia', tr: 'Merhamet', de: 'Barmherzigkeit', pt: 'Misericórdia', fr: 'Miséricorde', ru: 'Милость',
    hi: 'दया', my: 'ကရုဏာ', vi: 'Lòng thương xót', id: 'Belas kasihan', ms: 'Belas kasihan'
  },
  pentecost: {
    cuv: '五旬節', cuvs: '五旬节', tw: '五旬節', kjv: 'Pentecost', esv: 'Pentecost', niv: 'Pentecost',
    fa: 'پنطیکاست', ar: 'الخمسين', he: 'חג השבועות', ja: 'ペンテコステ', ko: '오순절',
    es: 'Pentecostés', tr: 'Pentikost', de: 'Pfingsten', pt: 'Pentecostes', fr: 'Pentecôte', ru: 'Пятидесятница',
    hi: 'पिन्तेकुस्त', my: 'ပင်တေကုတ္တေပွဲ', vi: 'Lễ Ngũ Tuần', id: 'Pentakosta', ms: 'Pentakosta'
  },
  praise: {
    cuv: '讚美', cuvs: '赞美', tw: '讚美', kjv: 'Praise', esv: 'Praise', niv: 'Praise',
    fa: 'ستایش', ar: 'التسبيح', he: 'שבח', ja: '賛美', ko: '찬양',
    es: 'Alabanza', tr: 'Övgü', de: 'Lobpreis', pt: 'Louvor', fr: 'Louange', ru: 'Хвала',
    hi: 'स्तुति', my: 'ချီးမွမ်းခြင်း', vi: 'Ca ngợi', id: 'Pujian', ms: 'Pujian'
  },
  wordOfGod: {
    cuv: '神的話', cuvs: '神的话', tw: '神的話', kjv: "God's word", esv: "God's word", niv: "God's word",
    fa: 'کلام خدا', ar: 'كلمة الله', he: 'דבר אלוהים', ja: '神の言葉', ko: '하나님의 말씀',
    es: 'Palabra de Dios', tr: "Tanrı'nın sözü", de: 'Gottes Wort', pt: 'Palavra de Deus', fr: 'Parole de Dieu', ru: 'Слово Божье',
    hi: 'परमेश्वर का वचन', my: 'ဘုရားသခင်၏ စကားတော်', vi: 'Lời Chúa', id: 'Firman Tuhan', ms: 'Firman Tuhan'
  },
  prayer: {
    cuv: '禱告', cuvs: '祷告', tw: '禱告', kjv: 'Prayer', esv: 'Prayer', niv: 'Prayer',
    fa: 'دعا', ar: 'الصلاة', he: 'תפילה', ja: '祈り', ko: '기도',
    es: 'Oración', tr: 'Dua', de: 'Gebet', pt: 'Oração', fr: 'Prière', ru: 'Молитва',
    hi: 'प्रार्थना', my: 'ဆုတောင်းခြင်း', vi: 'Cầu nguyện', id: 'Doa', ms: 'Doa'
  },
  scriptureRain: {
    cuv: '內容雨', cuvs: '内容雨', tw: '內容雨', kjv: 'Scripture Rain', esv: 'Scripture Rain', niv: 'Scripture Rain',
    fa: 'باران کتاب مقدس', ar: 'مطر الكتاب المقدس', he: 'גשם הכתובים', ja: '聖句の雨', ko: '말씀 비',
    es: 'Lluvia de Escrituras', tr: 'Kutsal Yazı Yağmuru', de: 'Schriftregen', pt: 'Chuva da Palavra', fr: 'Pluie de la Parole', ru: 'Дождь Писания',
    hi: 'वचन वर्षा', my: 'ကျမ်းချက်မိုး', vi: 'Mưa Kinh Thánh', id: 'Hujan Firman', ms: 'Hujan Firman'
  },
  mutualizedEconomics: {
    cuv: '互惠經濟', cuvs: '互惠经济', tw: '互惠經濟', kjv: 'Mutualized Economics', esv: 'Mutualized Economics', niv: 'Mutualized Economics',
    fa: 'اقتصاد متقابل', ar: 'الاقتصاد التشاركي', he: 'כלכלה הדדית', ja: '相互経済', ko: '상호 경제',
    es: 'Economía mutua', tr: 'Karşılıklı ekonomi', de: 'Gegenseitige Wirtschaft', pt: 'Economia mutualizada', fr: 'Économie mutualisée', ru: 'Взаимная экономика',
    hi: 'पारस्परिक अर्थव्यवस्था', my: 'အပြန်အလှန် စီးပွားရေး', vi: 'Kinh tế tương hỗ', id: 'Ekonomi Saling Menguntungkan', ms: 'Ekonomi Bersama'
  },
  powerOfWords: {
    cuv: '話語的權能', cuvs: '话语的权能', tw: '話語的權能', kjv: 'Power of Words', esv: 'Power of Words', niv: 'Power of Words',
    fa: 'قدرت کلمات', ar: 'قوة الكلمات', he: 'כוח המילים', ja: '言葉の力', ko: '말의 능력',
    es: 'Poder de las palabras', tr: 'Sözlerin gücü', de: 'Kraft der Worte', pt: 'Poder das palavras', fr: 'Puissance des paroles', ru: 'Сила слов',
    hi: 'वचनों की सामर्थ्य', my: 'စကားလုံးများ၏ တန်ခိုး', vi: 'Quyền năng của lời nói', id: 'Kuasa perkataan', ms: 'Kuasa kata-kata'
  }
};

function inferOfficialTopicKey(set = {}) {
  const id = String(set.id || '').toLowerCase();
  const title = String(set.title || '').toLowerCase();
  if (id.includes('word-of-god') || title.includes("god's word")) return 'wordOfGod';
  if (id.includes('mutualized-economics')) return 'mutualizedEconomics';
  if (id.includes('power-of-words')) return 'powerOfWords';
  if (id.includes('rain-verses') || title.includes('scripture rain')) return 'scriptureRain';
  if (id.includes('topic-prayer') || title.includes('prayer')) return 'prayer';
  if (id.includes('pentecost') || title.includes('pentecost')) return 'pentecost';
  if (id.includes('covenant') || title.includes('covenant')) return 'covenant';
  if (id.includes('healing') || /\bheal\b/.test(title) || title.includes('healing')) return 'heal';
  if (id.includes('mercy') || title.includes('mercy')) return 'mercy';
  if (id.includes('praise') || title.includes('praise')) return 'praise';
  return null;
}

function localizeOfficialTopicSetTitle(set, lang) {
  const topicKey = inferOfficialTopicKey(set);
  if (!topicKey) return set;
  const term = OFFICIAL_TOPIC_TITLE_TRANSLATIONS[topicKey]?.[lang] || OFFICIAL_TOPIC_TITLE_TRANSLATIONS[topicKey]?.en || set.title;
  const prefix = TOPIC_TITLE_PREFIX_BY_LANG[lang] || 'Topic';
  const suffix = /-esv(?:-|$)/i.test(String(set.id || '')) && !['kjv', 'esv', 'niv'].includes(lang) ? ' (ESV)' : '';
  return { ...set, title: `${prefix}: ${term}${suffix}` };
}

const extractVerseSetTopic = (title = '') => {
  const plainTitle = String(title).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const match = plainTitle.match(/(?:主題|主题|Topic|Tema|Thema|Thème|Konu|موضوع|נושא|テーマ|주제|ခေါင်းစဉ်|Chủ đề|Тема|विषय|Topik)\s*[：:]\s*([^，,。；;、/／|｜\s]+)/i);
  return match?.[1]?.trim() || '';
};

const getFirstTopicChar = (topic = '') => Array.from(topic.trim())[0] || '';

// Maps normalized English book key → localized abbreviation by language code
// Key: lowercase English book name/abbreviation (no spaces, no periods, number prefix attached)
const ENGLISH_BOOK_LOCALIZATION_MAP = {
  // ── Old Testament ──
  'genesis':        { vi:'St',    ko:'창',   ja:'創',    es:'Gén',  de:'1.Mo', tr:'Yar', fa:'پيد',     he:'בר',    my:'က' },
  'gen':            { vi:'St',    ko:'창',   ja:'創',    es:'Gén',  de:'1.Mo', tr:'Yar', fa:'پيد',     he:'בר',    my:'က' },
  'exodus':         { vi:'Xh',   ko:'출',   ja:'出',    es:'Éx',   de:'2.Mo', tr:'Mıs', fa:'خر',      he:'שמ',   my:'ထွ' },
  'exod':           { vi:'Xh',   ko:'출',   ja:'出',    es:'Éx',   de:'2.Mo', tr:'Mıs', fa:'خر',      he:'שמ',   my:'ထွ' },
  'ex':             { vi:'Xh',   ko:'출',   ja:'出',    es:'Éx',   de:'2.Mo', tr:'Mıs', fa:'خر',      he:'שמ',   my:'ထွ' },
  'leviticus':      { vi:'Lv',   ko:'레',   ja:'レビ',  es:'Lv',   de:'3.Mo', tr:'Lev', fa:'لا',      he:'ויק',  my:'ဝ' },
  'lev':            { vi:'Lv',   ko:'레',   ja:'レビ',  es:'Lv',   de:'3.Mo', tr:'Lev', fa:'لا',      he:'ויק',  my:'ဝ' },
  'numbers':        { vi:'Ds',   ko:'민',   ja:'民',    es:'Nm',   de:'4.Mo', tr:'Say', fa:'اع',      he:'במ',   my:'တော' },
  'num':            { vi:'Ds',   ko:'민',   ja:'民',    es:'Nm',   de:'4.Mo', tr:'Say', fa:'اع',      he:'במ',   my:'တော' },
  'deuteronomy':    { vi:'Đnl',  ko:'신',   ja:'申',    es:'Dt',   de:'5.Mo', tr:'Yes', fa:'تث',      he:'דב',   my:'တရားဟောရာ' },
  'deut':           { vi:'Đnl',  ko:'신',   ja:'申',    es:'Dt',   de:'5.Mo', tr:'Yes', fa:'تث',      he:'דב',   my:'တရားဟောရာ' },
  'dt':             { vi:'Đnl',  ko:'신',   ja:'申',    es:'Dt',   de:'5.Mo', tr:'Yes', fa:'تث',      he:'דב',   my:'တရားဟောရာ' },
  'joshua':         { vi:'Gs',   ko:'수',   ja:'ヨシュ', es:'Jos',  de:'Jos',  tr:'Yşu', fa:'يش',      he:'יהו',  my:'ယောရှ' },
  'josh':           { vi:'Gs',   ko:'수',   ja:'ヨシュ', es:'Jos',  de:'Jos',  tr:'Yşu', fa:'يش',      he:'יהו',  my:'ယောရှ' },
  'judges':         { vi:'Tl',   ko:'삿',   ja:'士師',  es:'Jue',  de:'Ri',   tr:'Hak', fa:'داو',     he:'שוף',  my:'တရားသူကြီး' },
  'judg':           { vi:'Tl',   ko:'삿',   ja:'士師',  es:'Jue',  de:'Ri',   tr:'Hak', fa:'داو',     he:'שוף',  my:'တရားသူကြီး' },
  'ruth':           { vi:'R',    ko:'룻',   ja:'ルツ',  es:'Rt',   de:'Rut',  tr:'Rut', fa:'روت',     he:'רות',  my:'ရုသ' },
  '1samuel':        { vi:'1Sm',  ko:'삼상', ja:'サム上', es:'1Sa',  de:'1Sam', tr:'1Sa', fa:'اول سم',  he:'שמ״א', my:'၁ ဓမ္မ' },
  '1sam':           { vi:'1Sm',  ko:'삼상', ja:'サム上', es:'1Sa',  de:'1Sam', tr:'1Sa', fa:'اول سم',  he:'שמ״א', my:'၁ ဓမ္မ' },
  '2samuel':        { vi:'2Sm',  ko:'삼하', ja:'サム下', es:'2Sa',  de:'2Sam', tr:'2Sa', fa:'دوم سم', he:'שמ״ב', my:'၂ ဓမ္မ' },
  '2sam':           { vi:'2Sm',  ko:'삼하', ja:'サム下', es:'2Sa',  de:'2Sam', tr:'2Sa', fa:'دوم سم', he:'שמ״ב', my:'၂ ဓမ္မ' },
  '1kings':         { vi:'1V',   ko:'왕상', ja:'王上',  es:'1Re',  de:'1Kö',  tr:'1Kr', fa:'اول پاد', he:'מל״א', my:'၁ ရာဇ' },
  '1kgs':           { vi:'1V',   ko:'왕상', ja:'王上',  es:'1Re',  de:'1Kö',  tr:'1Kr', fa:'اول پاد', he:'מל״א', my:'၁ ရာဇ' },
  '2kings':         { vi:'2V',   ko:'왕하', ja:'王下',  es:'2Re',  de:'2Kö',  tr:'2Kr', fa:'دوم پاد', he:'מל״ב', my:'၂ ရာဇ' },
  '2kgs':           { vi:'2V',   ko:'왕하', ja:'王下',  es:'2Re',  de:'2Kö',  tr:'2Kr', fa:'دوم پاد', he:'מל״ב', my:'၂ ရာဇ' },
  '1chronicles':    { vi:'1Sb',  ko:'대상', ja:'歴上',  es:'1Cr',  de:'1Chr', tr:'1Ta', fa:'اول تو',  he:'דה״א', my:'၁ ရာဇ်ချုပ်' },
  '1chr':           { vi:'1Sb',  ko:'대상', ja:'歴上',  es:'1Cr',  de:'1Chr', tr:'1Ta', fa:'اول تو',  he:'דה״א', my:'၁ ရာဇ်ချုပ်' },
  '2chronicles':    { vi:'2Sb',  ko:'대하', ja:'歴下',  es:'2Cr',  de:'2Chr', tr:'2Ta', fa:'دوم تو',  he:'דה״ב', my:'၂ ရာဇ်ချုပ်' },
  '2chr':           { vi:'2Sb',  ko:'대하', ja:'歴下',  es:'2Cr',  de:'2Chr', tr:'2Ta', fa:'دوم تو',  he:'דה״ב', my:'၂ ရာဇ်ချုပ်' },
  '2chron':         { vi:'2Sb',  ko:'대하', ja:'歴下',  es:'2Cr',  de:'2Chr', tr:'2Ta', fa:'دوم تو',  he:'דה״ב', my:'၂ ရာဇ်ချုပ်' },
  'ezra':           { vi:'Er',   ko:'스',   ja:'エズ',  es:'Esd',  de:'Esr',  tr:'Ezr', fa:'عزر',     he:'עזר',  my:'ဧဇရ' },
  'nehemiah':       { vi:'Nkm',  ko:'느',   ja:'ネヘ',  es:'Neh',  de:'Neh',  tr:'Neh', fa:'نح',      he:'נחמ',  my:'နေဟမိ' },
  'neh':            { vi:'Nkm',  ko:'느',   ja:'ネヘ',  es:'Neh',  de:'Neh',  tr:'Neh', fa:'نح',      he:'נחמ',  my:'နေဟမိ' },
  'esther':         { vi:'Et',   ko:'에',   ja:'エス',  es:'Est',  de:'Est',  tr:'Est', fa:'است',     he:'אסת',  my:'ဧသ' },
  'esth':           { vi:'Et',   ko:'에',   ja:'エス',  es:'Est',  de:'Est',  tr:'Est', fa:'است',     he:'אסת',  my:'ဧသ' },
  'job':            { vi:'G',    ko:'욥',   ja:'ヨブ',  es:'Job',  de:'Hiob', tr:'Eyy', fa:'ايوب',    he:'איוב', my:'ယောဘ' },
  'psalms':         { vi:'Tv',   ko:'시',   ja:'詩',    es:'Sal',  de:'Ps',   tr:'Mez', fa:'مز',      he:'תה',   my:'ဆာလံ' },
  'psalm':          { vi:'Tv',   ko:'시',   ja:'詩',    es:'Sal',  de:'Ps',   tr:'Mez', fa:'مز',      he:'תה',   my:'ဆာလံ' },
  'ps':             { vi:'Tv',   ko:'시',   ja:'詩',    es:'Sal',  de:'Ps',   tr:'Mez', fa:'مز',      he:'תה',   my:'ဆာလံ' },
  'psa':            { vi:'Tv',   ko:'시',   ja:'詩',    es:'Sal',  de:'Ps',   tr:'Mez', fa:'مز',      he:'תה',   my:'ဆာလံ' },
  'proverbs':       { vi:'Cn',   ko:'잠',   ja:'箴',    es:'Prov', de:'Spr',  tr:'Süz', fa:'ام',      he:'משל',  my:'သုတ္တံ' },
  'prov':           { vi:'Cn',   ko:'잠',   ja:'箴',    es:'Prov', de:'Spr',  tr:'Süz', fa:'ام',      he:'משל',  my:'သုတ္တံ' },
  'ecclesiastes':   { vi:'Gv',   ko:'전',   ja:'伝',    es:'Ecl',  de:'Pred', tr:'Vaa', fa:'جامعه',   he:'קה',   my:'ဒေသနာ' },
  'eccles':         { vi:'Gv',   ko:'전',   ja:'伝',    es:'Ecl',  de:'Pred', tr:'Vaa', fa:'جامعه',   he:'קה',   my:'ဒေသနာ' },
  'ecc':            { vi:'Gv',   ko:'전',   ja:'伝',    es:'Ecl',  de:'Pred', tr:'Vaa', fa:'جامعه',   he:'קה',   my:'ဒေသနာ' },
  'songofsolomon':  { vi:'Dc',   ko:'아',   ja:'雅',    es:'Cnt',  de:'Hl',   tr:'Ezg', fa:'غزل',     he:'שה"ש', my:'သီချင်း' },
  'song':           { vi:'Dc',   ko:'아',   ja:'雅',    es:'Cnt',  de:'Hl',   tr:'Ezg', fa:'غزل',     he:'שה"ש', my:'သီချင်း' },
  'isaiah':         { vi:'Is',   ko:'사',   ja:'イザ',  es:'Is',   de:'Jes',  tr:'Esa', fa:'اشع',     he:'יש',   my:'ဟေရှာယ' },
  'isa':            { vi:'Is',   ko:'사',   ja:'イザ',  es:'Is',   de:'Jes',  tr:'Esa', fa:'اشع',     he:'יש',   my:'ဟေရှာယ' },
  'jeremiah':       { vi:'Gr',   ko:'렘',   ja:'エレ',  es:'Jer',  de:'Jer',  tr:'Yer', fa:'ار',      he:'ירמ',  my:'ယေရမိ' },
  'jer':            { vi:'Gr',   ko:'렘',   ja:'エレ',  es:'Jer',  de:'Jer',  tr:'Yer', fa:'ار',      he:'ירמ',  my:'ယေရမိ' },
  'lamentations':   { vi:'Ac',   ko:'애',   ja:'哀',    es:'Lm',   de:'Klag', tr:'Mer', fa:'مر',      he:'איכ',  my:'မြည်တမ်းစ' },
  'lam':            { vi:'Ac',   ko:'애',   ja:'哀',    es:'Lm',   de:'Klag', tr:'Mer', fa:'مر',      he:'איכ',  my:'မြည်တမ်းစ' },
  'ezekiel':        { vi:'Ed',   ko:'겔',   ja:'エゼ',  es:'Ez',   de:'Ez',   tr:'Hzk', fa:'حز',      he:'יחז',  my:'ယေဇကျေး' },
  'ezek':           { vi:'Ed',   ko:'겔',   ja:'エゼ',  es:'Ez',   de:'Ez',   tr:'Hzk', fa:'حز',      he:'יחז',  my:'ယေဇကျေး' },
  'daniel':         { vi:'Đn',   ko:'단',   ja:'ダニ',  es:'Dn',   de:'Dan',  tr:'Dan', fa:'دان',     he:'דנ',   my:'ဒံယေလ' },
  'dan':            { vi:'Đn',   ko:'단',   ja:'ダニ',  es:'Dn',   de:'Dan',  tr:'Dan', fa:'دان',     he:'דנ',   my:'ဒံယေလ' },
  'hosea':          { vi:'Os',   ko:'호',   ja:'ホセ',  es:'Os',   de:'Hos',  tr:'Hoş', fa:'هو',      he:'הוש',  my:'ဟောရှေ' },
  'hos':            { vi:'Os',   ko:'호',   ja:'ホセ',  es:'Os',   de:'Hos',  tr:'Hoş', fa:'هو',      he:'הוש',  my:'ဟောရှေ' },
  'joel':           { vi:'Ge',   ko:'욜',   ja:'ヨエ',  es:'Jl',   de:'Joel', tr:'Yol', fa:'يوئ',     he:'יואל', my:'ယောလ' },
  'amos':           { vi:'Am',   ko:'암',   ja:'アモ',  es:'Am',   de:'Am',   tr:'Amo', fa:'عا',      he:'עמ',   my:'အာမုတ်' },
  'obadiah':        { vi:'Ap',   ko:'옵',   ja:'オバ',  es:'Ab',   de:'Ob',   tr:'Abd', fa:'عوب',     he:'עוב',  my:'သောဒိ' },
  'jonah':          { vi:'Gn',   ko:'욘',   ja:'ヨナ',  es:'Jon',  de:'Jona', tr:'Yun', fa:'يون',     he:'יונ',  my:'ယောနာ' },
  'micah':          { vi:'Mk',   ko:'미',   ja:'ミカ',  es:'Mi',   de:'Mi',   tr:'Mik', fa:'ميکا',    he:'מי',   my:'မိကာ' },
  'nahum':          { vi:'Na',   ko:'나',   ja:'ナホ',  es:'Na',   de:'Nah',  tr:'Nah', fa:'نا',      he:'נח',   my:'နာဟုမ်' },
  'habakkuk':       { vi:'Hab',  ko:'합',   ja:'ハバ',  es:'Hab',  de:'Hab',  tr:'Hab', fa:'حب',      he:'חב',   my:'ဟဗက္ကုတ်' },
  'zephaniah':      { vi:'Xp',   ko:'습',   ja:'ゼパ',  es:'Sof',  de:'Zef',  tr:'Sef', fa:'صف',      he:'צפ',   my:'ဇေဖနိ' },
  'haggai':         { vi:'Kg',   ko:'학',   ja:'ハガ',  es:'Ag',   de:'Hag',  tr:'Hag', fa:'حج',      he:'חג',   my:'ဟဂ္ဂဲ' },
  'zechariah':      { vi:'Dcr',  ko:'슥',   ja:'ゼカ',  es:'Zac',  de:'Sach', tr:'Zek', fa:'زک',      he:'זכ',   my:'ဇာခရိ' },
  'zech':           { vi:'Dcr',  ko:'슥',   ja:'ゼカ',  es:'Zac',  de:'Sach', tr:'Zek', fa:'زک',      he:'זכ',   my:'ဇာခရိ' },
  'malachi':        { vi:'Ml',   ko:'말',   ja:'マラ',  es:'Mal',  de:'Mal',  tr:'Mal', fa:'ملا',     he:'מל',   my:'မာလခိ' },
  'mal':            { vi:'Ml',   ko:'말',   ja:'マラ',  es:'Mal',  de:'Mal',  tr:'Mal', fa:'ملا',     he:'מל',   my:'မာလခိ' },
  // ── New Testament ──
  'matthew':        { vi:'Mt',   ko:'마',   ja:'マタ',  es:'Mt',   de:'Mt',   tr:'Mat', fa:'مت',      he:'מת',   my:'မဿဲ' },
  'matt':           { vi:'Mt',   ko:'마',   ja:'マタ',  es:'Mt',   de:'Mt',   tr:'Mat', fa:'مت',      he:'מת',   my:'မဿဲ' },
  'mark':           { vi:'Mc',   ko:'막',   ja:'マコ',  es:'Mr',   de:'Mk',   tr:'Mar', fa:'مرق',     he:'מרק',  my:'မာကု' },
  'mrk':            { vi:'Mc',   ko:'막',   ja:'マコ',  es:'Mr',   de:'Mk',   tr:'Mar', fa:'مرق',     he:'מרק',  my:'မာကု' },
  'luke':           { vi:'Lc',   ko:'눅',   ja:'ルカ',  es:'Lc',   de:'Lk',   tr:'Luk', fa:'لو',      he:'לוק',  my:'လုကာ' },
  'luk':            { vi:'Lc',   ko:'눅',   ja:'ルカ',  es:'Lc',   de:'Lk',   tr:'Luk', fa:'لو',      he:'לוק',  my:'လုကာ' },
  'john':           { vi:'Ga',   ko:'요',   ja:'ヨハ',  es:'Jn',   de:'Joh',  tr:'Yuh', fa:'يو',      he:'יוח',  my:'ယောဟန်' },
  'jn':             { vi:'Ga',   ko:'요',   ja:'ヨハ',  es:'Jn',   de:'Joh',  tr:'Yuh', fa:'يو',      he:'יוח',  my:'ယောဟန်' },
  'joh':            { vi:'Ga',   ko:'요',   ja:'ヨハ',  es:'Jn',   de:'Joh',  tr:'Yuh', fa:'يو',      he:'יוח',  my:'ယောဟန်' },
  'acts':           { vi:'Cv',   ko:'행',   ja:'使',    es:'Hch',  de:'Apg',  tr:'Elç', fa:'اعم',     he:'מעש',  my:'တမန်တော်' },
  'act':            { vi:'Cv',   ko:'행',   ja:'使',    es:'Hch',  de:'Apg',  tr:'Elç', fa:'اعم',     he:'מעש',  my:'တမန်တော်' },
  'romans':         { vi:'Rm',   ko:'롬',   ja:'ロマ',  es:'Ro',   de:'Röm',  tr:'Rom', fa:'رو',      he:'רומ',  my:'ရောမ' },
  'rom':            { vi:'Rm',   ko:'롬',   ja:'ロマ',  es:'Ro',   de:'Röm',  tr:'Rom', fa:'رو',      he:'רומ',  my:'ရောမ' },
  '1corinthians':   { vi:'1Cr',  ko:'고전', ja:'コリ前', es:'1Co',  de:'1Kor', tr:'1Ko', fa:'اول قر',  he:'א קור', my:'၁ ကောရိ' },
  '1cor':           { vi:'1Cr',  ko:'고전', ja:'コリ前', es:'1Co',  de:'1Kor', tr:'1Ko', fa:'اول قر',  he:'א קור', my:'၁ ကောရိ' },
  '2corinthians':   { vi:'2Cr',  ko:'고후', ja:'コリ後', es:'2Co',  de:'2Kor', tr:'2Ko', fa:'دوم قر',  he:'ב קור', my:'၂ ကောရိ' },
  '2cor':           { vi:'2Cr',  ko:'고후', ja:'コリ後', es:'2Co',  de:'2Kor', tr:'2Ko', fa:'دوم قر',  he:'ב קור', my:'၂ ကောရိ' },
  'galatians':      { vi:'Gl',   ko:'갈',   ja:'ガラ',  es:'Gá',   de:'Gal',  tr:'Gal', fa:'غل',      he:'גלט',  my:'ဂလာတိ' },
  'gal':            { vi:'Gl',   ko:'갈',   ja:'ガラ',  es:'Gá',   de:'Gal',  tr:'Gal', fa:'غل',      he:'גלט',  my:'ဂလာတိ' },
  'ephesians':      { vi:'Ep',   ko:'엡',   ja:'エペ',  es:'Ef',   de:'Eph',  tr:'Efe', fa:'اف',      he:'אפס',  my:'ဧဖက်' },
  'eph':            { vi:'Ep',   ko:'엡',   ja:'エペ',  es:'Ef',   de:'Eph',  tr:'Efe', fa:'اف',      he:'אפס',  my:'ဧဖက်' },
  'philippians':    { vi:'Pl',   ko:'빌',   ja:'ピリ',  es:'Fil',  de:'Phil', tr:'Fil', fa:'فل',      he:'פיל',  my:'ဖိလိပ္ပိ' },
  'phil':           { vi:'Pl',   ko:'빌',   ja:'ピリ',  es:'Fil',  de:'Phil', tr:'Fil', fa:'فل',      he:'פיל',  my:'ဖိလိပ္ပိ' },
  'colossians':     { vi:'Cl',   ko:'골',   ja:'コロ',  es:'Col',  de:'Kol',  tr:'Kol', fa:'کل',      he:'קול',  my:'ကောလောသဲ' },
  'col':            { vi:'Cl',   ko:'골',   ja:'コロ',  es:'Col',  de:'Kol',  tr:'Kol', fa:'کل',      he:'קול',  my:'ကောလောသဲ' },
  '1thessalonians': { vi:'1Tx',  ko:'살전', ja:'テサ前', es:'1Ts',  de:'1Thes',tr:'1Se', fa:'اول تس',  he:'א תס', my:'၁ သက်သာ' },
  '1thess':         { vi:'1Tx',  ko:'살전', ja:'テサ前', es:'1Ts',  de:'1Thes',tr:'1Se', fa:'اول تس',  he:'א תס', my:'၁ သက်သာ' },
  '1th':            { vi:'1Tx',  ko:'살전', ja:'テサ前', es:'1Ts',  de:'1Thes',tr:'1Se', fa:'اول تس',  he:'א תס', my:'၁ သက်သာ' },
  '2thessalonians': { vi:'2Tx',  ko:'살후', ja:'テサ後', es:'2Ts',  de:'2Thes',tr:'2Se', fa:'دوم تس',  he:'ב תס', my:'၂ သက်သာ' },
  '2thess':         { vi:'2Tx',  ko:'살후', ja:'テサ後', es:'2Ts',  de:'2Thes',tr:'2Se', fa:'دوم تس',  he:'ב תס', my:'၂ သက်သာ' },
  '1timothy':       { vi:'1Tm',  ko:'딤전', ja:'テモ前', es:'1Ti',  de:'1Tim', tr:'1Ti', fa:'اول تي',  he:'א טים', my:'၁ တိမောသေ' },
  '1tim':           { vi:'1Tm',  ko:'딤전', ja:'テモ前', es:'1Ti',  de:'1Tim', tr:'1Ti', fa:'اول تي',  he:'א טים', my:'၁ တိမောသေ' },
  '2timothy':       { vi:'2Tm',  ko:'딤후', ja:'テモ後', es:'2Ti',  de:'2Tim', tr:'2Ti', fa:'دوم تي',  he:'ב טים', my:'၂ တိမောသေ' },
  '2tim':           { vi:'2Tm',  ko:'딤후', ja:'テモ後', es:'2Ti',  de:'2Tim', tr:'2Ti', fa:'دوم تي',  he:'ב טים', my:'၂ တိမောသေ' },
  'titus':          { vi:'Tt',   ko:'딛',   ja:'テト',  es:'Tit',  de:'Tit',  tr:'Tit', fa:'تيت',     he:'טיט',  my:'တိတု' },
  'tit':            { vi:'Tt',   ko:'딛',   ja:'テト',  es:'Tit',  de:'Tit',  tr:'Tit', fa:'تيت',     he:'טיט',  my:'တိတု' },
  'philemon':       { vi:'Plm',  ko:'몬',   ja:'ピレ',  es:'Flm',  de:'Phlm', tr:'Flm', fa:'فلم',     he:'פלמ',  my:'ဖိလေမုန်' },
  'phlm':           { vi:'Plm',  ko:'몬',   ja:'ピレ',  es:'Flm',  de:'Phlm', tr:'Flm', fa:'فلم',     he:'פלמ',  my:'ဖိလေမုန်' },
  'hebrews':        { vi:'Dt',   ko:'히',   ja:'ヘブ',  es:'He',   de:'Hebr', tr:'İbr', fa:'عب',      he:'עבר',  my:'ဟေဗြဲ' },
  'heb':            { vi:'Dt',   ko:'히',   ja:'ヘブ',  es:'He',   de:'Hebr', tr:'İbr', fa:'عب',      he:'עבר',  my:'ဟေဗြဲ' },
  'james':          { vi:'Gc',   ko:'약',   ja:'ヤコ',  es:'Stg',  de:'Jak',  tr:'Yak', fa:'يع',      he:'יעק',  my:'ယာကုပ်' },
  'jas':            { vi:'Gc',   ko:'약',   ja:'ヤコ',  es:'Stg',  de:'Jak',  tr:'Yak', fa:'يع',      he:'יעק',  my:'ယာကုပ်' },
  '1peter':         { vi:'1Pr',  ko:'벧전', ja:'ペテ前', es:'1P',   de:'1Petr',tr:'1Pe', fa:'اول پط',  he:'א פט', my:'၁ ပေတ ရု' },
  '1pet':           { vi:'1Pr',  ko:'벧전', ja:'ペテ前', es:'1P',   de:'1Petr',tr:'1Pe', fa:'اول پط',  he:'א פט', my:'၁ ပေတ ရု' },
  '2peter':         { vi:'2Pr',  ko:'벧후', ja:'ペテ後', es:'2P',   de:'2Petr',tr:'2Pe', fa:'دوم پط',  he:'ב פט', my:'၂ ပေတ ရု' },
  '2pet':           { vi:'2Pr',  ko:'벧후', ja:'ペテ後', es:'2P',   de:'2Petr',tr:'2Pe', fa:'دوم پط',  he:'ב פט', my:'၂ ပေတ ရု' },
  '1john':          { vi:'1Ga',  ko:'요일', ja:'ヨハ一', es:'1Jn',  de:'1Joh', tr:'1Yh', fa:'اول يو',  he:'א יוח', my:'၁ ယောဟန်' },
  '1jn':            { vi:'1Ga',  ko:'요일', ja:'ヨハ一', es:'1Jn',  de:'1Joh', tr:'1Yh', fa:'اول يو',  he:'א יוח', my:'၁ ယောဟန်' },
  '2john':          { vi:'2Ga',  ko:'요이', ja:'ヨハ二', es:'2Jn',  de:'2Joh', tr:'2Yh', fa:'دوم يو',  he:'ב יוח', my:'၂ ယောဟန်' },
  '2jn':            { vi:'2Ga',  ko:'요이', ja:'ヨハ二', es:'2Jn',  de:'2Joh', tr:'2Yh', fa:'دوم يو',  he:'ב יוח', my:'၂ ယောဟန်' },
  '3john':          { vi:'3Ga',  ko:'요삼', ja:'ヨハ三', es:'3Jn',  de:'3Joh', tr:'3Yh', fa:'سوم يو',  he:'ג יוח', my:'၃ ယောဟန်' },
  '3jn':            { vi:'3Ga',  ko:'요삼', ja:'ヨハ三', es:'3Jn',  de:'3Joh', tr:'3Yh', fa:'سوم يو',  he:'ג יוח', my:'၃ ယောဟန်' },
  'jude':           { vi:'Gđ',   ko:'유',   ja:'ユダ',  es:'Jud',  de:'Jud',  tr:'Yah', fa:'يهو',     he:'יהוד', my:'ယုဒ' },
  'jud':            { vi:'Gđ',   ko:'유',   ja:'ユダ',  es:'Jud',  de:'Jud',  tr:'Yah', fa:'يهو',     he:'יהוד', my:'ယုဒ' },
  'revelation':     { vi:'Kh',   ko:'계',   ja:'黙',    es:'Ap',   de:'Offb', tr:'Vah', fa:'مک',      he:'חז',   my:'ဗျာဒိတ်' },
  'rev':            { vi:'Kh',   ko:'계',   ja:'黙',    es:'Ap',   de:'Offb', tr:'Vah', fa:'مک',      he:'חז',   my:'ဗျာဒိတ်' },
};

// 聽&說 labels are shown exactly as the author wrote them.
function formatVerseReferenceForDisplay(ref) {
  return String(ref || '');
}

// 1 → 一, 23 → 二十三, 119 → 一百一十九 … (for spoken references).
function toChineseNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (num === 0) return '零';
  if (num < 10) return digits[num];
  if (num < 20) return `十${digits[num % 10]}`;
  if (num < 100) {
    const ones = num % 10;
    return `${digits[Math.floor(num / 10)]}十${ones ? digits[ones] : ''}`;
  }
  const hundreds = Math.floor(num / 100);
  const rest = num % 100;
  return `${digits[hundreds]}百${rest ? (rest < 10 ? '零' : '') + toChineseNumber(rest) : ''}`;
}

// 「3:16」→「第三章16節」,「4:1-3」→「第四章1到3節」 — makes chapter:verse
// patterns inside free text (set descriptions) read naturally in Chinese TTS.
function humanizeChineseReferencesForSpeech(text) {
  return String(text || '').replace(
    /(\d+)\s*[:：]\s*(\d+)(?:\s*[-–—~]\s*(\d+))?/g,
    (m, ch, v1, v2) => (v2
      ? `第${toChineseNumber(ch)}章${v1}到${v2}節`
      : `第${toChineseNumber(ch)}章${v1}節`)
  );
}

function formatVerseReferenceForSpeech(ref) {
  return String(ref || '');
}

// Rows opened in the editor: label + both language sides. (Kept under the
// old name because every "edit this set" entry point calls it.)
const parseVerseRef = (v) => ({ reference: String(v?.reference || ''), text: itemZh(v), textEn: itemEn(v), ...(v?.textCn ? { textCn: v.textCn } : {}) });

// --- Activity Heatmap Component ---
const ActivityHeatmap = ({ t, activityMap = {} }) => {
  const [data, setData] = useState([]);
  const scrollRef = useRef(null);

  // Scroll to rightmost (current date) after data loads
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [data]);

  useEffect(() => {
    const historicalData = [];
    const today = new Date();
    // Generate 365 days of data from activityMap
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA');
      const val = activityMap[dateStr] || 0;
      historicalData.push({ date: d, value: val });
    }
    setData(historicalData);
  }, [activityMap]);

  const weeks = [];
  let currentWeek = [];
  data.forEach((day) => {
    // 0 = Sunday, 1 = Monday ... 6 = Saturday
    // Adjusting to start week on Monday
    const isMonday = day.date.getDay() === 1;
    if (isMonday && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(day);
  });
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // Ensure first week is padded if it doesn't start on Monday
  if (weeks.length > 0 && weeks[0].length < 7) {
    const padCount = 7 - weeks[0].length;
    const pad = Array(padCount).fill(null);
    weeks[0] = [...pad, ...weeks[0]];
  }

  const getColor = (val) => {
    if (val === 0) return '#334155'; // Level 0: Empty (Dark gray)
    if (val < 200) return '#0e4429'; // Level 1: Opened the app/site
    if (val < 1000) return '#006d32'; // Level 2: Listened to verses
    if (val < 3000) return '#26a641'; // Level 3: Challenged new verses
    if (val >= 3000) return '#39d353'; // Level 4: High activity day
    return '#334155';
  };

  const getActivityTitle = (day) => {
    const value = day.value || 0;
    let label = 'No Activity';
    if (value >= 3000) label = 'High Activity';
    else if (value >= 1000) label = 'New Verse Challenge';
    else if (value >= 200) label = 'Listened to Verse';
    else if (value >= 100) label = 'Opened VerseRain';
    return `${day.date.toLocaleDateString()}: ${label}${value > 0 ? ` (${value} pts)` : ''}`;
  };

  const getMonthLabels = () => {
    const labels = [];
    let currentMonth = -1;
    weeks.forEach((week, index) => {
      const firstValidDay = week.find(d => d !== null);
      if (firstValidDay) {
        const month = firstValidDay.date.getMonth();
        if (month !== currentMonth) {
          labels.push({ text: firstValidDay.date.toLocaleString('en-US', { month: 'short' }), index });
          currentMonth = month;
        }
      }
    });
    return labels;
  };

  const monthLabels = getMonthLabels();

  return (
    <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', color: '#cbd5e1', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
      <h3 style={{ margin: '0 0 1rem 0', color: '#f8fafc', fontSize: '1rem', fontWeight: 'bold' }}>{t("活動", "Activity")}</h3>
      <div ref={scrollRef} style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
        <div style={{ position: 'relative', height: '15px', marginBottom: '4px' }}>
          {monthLabels.map((lbl, i) => (
            <span key={i} style={{ position: 'absolute', left: `${(lbl.index * 16) + 30}px`, fontSize: '0.75rem', color: '#94a3b8' }}>
              {lbl.text}
            </span>
          ))}
        </div>
        <div style={{ display: 'inline-flex', gap: '4px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', paddingRight: '8px', height: '108px', paddingTop: '4px' }}>
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
            <span>Sun</span>
          </div>
          {weeks.map((week, wIdx) => (
            <div key={wIdx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {week.map((day, dIdx) => {
                if (!day) return <div key={dIdx} style={{ width: '12px', height: '12px', borderRadius: '2px', background: 'transparent' }} />;
                return (
                  <div 
                    key={dIdx} 
                    style={{ 
                      width: '12px', 
                      height: '12px', 
                      borderRadius: '2px', 
                      background: getColor(day.value) 
                    }} 
                    title={getActivityTitle(day)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.8rem' }}>
        <span style={{ cursor: 'pointer' }}>What is this?</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>Less</span>
          <div style={{ width: '12px', height: '12px', background: '#334155', borderRadius: '2px' }} />
          <div style={{ width: '12px', height: '12px', background: '#0e4429', borderRadius: '2px' }} />
          <div style={{ width: '12px', height: '12px', background: '#006d32', borderRadius: '2px' }} />
          <div style={{ width: '12px', height: '12px', background: '#26a641', borderRadius: '2px' }} />
          <div style={{ width: '12px', height: '12px', background: '#39d353', borderRadius: '2px' }} />
          <span>More</span>
        </div>
      </div>
    </div>
  );
};

const PARTY_HOST = PARTY_DB;

async function fetchRetry(url, opts = {}, { retries = 2, delay = 1500 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok || res.status < 500) return res;
      if (i < retries) await new Promise(r => setTimeout(r, delay * (i + 1)));
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
}

export default function App() {
  const [loadedLangs, setLoadedLangs] = useState({});
  const [isLangsLoading, setIsLangsLoading] = useState(true);
  const [speechReady, setSpeechReady] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!window.__speechUnlocked;
  });

  const [version, setVersion] = useState(() => localStorage.getItem('verseRain_version') || 'cuv');
  // Simplified Chinese is derived from the Traditional side; load the
  // converter lazily the first time a Simplified variant is active (or an
  // editor save needs it) and re-render once it is ready.
  useEffect(() => {
    if (annotationOf(version) || annotationOf(localStorage.getItem('verseRain_bilingualSecondaryVersion'))) loadAnnotator().catch(() => {});
  }, [version]);
  const [simplifiedReady, setSimplifiedReady] = useState(hasSimplifiedConverter());
  useEffect(() => {
    if (simplifiedReady || baseLang(version) !== 'cuvs') return;
    let alive = true;
    import('opencc-js').then((m) => {
      if (!alive) return;
      setSimplifiedConverter(m.Converter({ from: 'tw', to: 'cn' }));
      setSimplifiedReady(true);
    }).catch(() => {});
    return () => { alive = false; };
  }, [version, simplifiedReady]);
  const [bilingualSecondaryVersion, setBilingualSecondaryVersion] = useState(() => localStorage.getItem('verseRain_bilingualSecondaryVersion') || 'kjv');
  useEffect(() => {
    localStorage.setItem('verseRain_version', version);
  }, [version]);
  useEffect(() => {
    localStorage.setItem('verseRain_bilingualSecondaryVersion', bilingualSecondaryVersion);
  }, [bilingualSecondaryVersion]);
  useEffect(() => {
    if (bilingualSecondaryVersion !== version) return;
    const fallback = BIBLE_LANGUAGE_OPTIONS.find(option => option.value !== version)?.value || 'en';
    setBilingualSecondaryVersion(fallback);
  }, [version, bilingualSecondaryVersion]);

  useEffect(() => {
    let mounted = true;
    if (!loadedLangs[version]) {
      setIsLangsLoading(true);
      loadLanguageSets(baseLang(version)).then(data => {
        if (mounted) {
          setLoadedLangs(prev => ({ ...prev, [version]: data }));
          setIsLangsLoading(false);
        }
      });
    } else {
      setIsLangsLoading(false);
    }
    return () => { mounted = false; };
  }, [version]);

  useEffect(() => {
    let mounted = true;
    if (bilingualSecondaryVersion && !loadedLangs[bilingualSecondaryVersion]) {
      loadLanguageSets(baseLang(bilingualSecondaryVersion)).then(data => {
        if (mounted) {
          setLoadedLangs(prev => ({ ...prev, [bilingualSecondaryVersion]: data }));
        }
      }).catch(error => {
        console.error('Failed to load bilingual secondary language', bilingualSecondaryVersion, error);
      });
    }
    return () => { mounted = false; };
  }, [bilingualSecondaryVersion, loadedLangs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      if (window.__speechUnlocked) setSpeechReady(true);
    };
    window.addEventListener('click', sync);
    window.addEventListener('touchstart', sync);
    return () => {
      window.removeEventListener('click', sync);
      window.removeEventListener('touchstart', sync);
    };
  }, []);

  const VERSES_CUV = loadedLangs['cuv']?.verses || [];
  const VERSES_KJV = loadedLangs['en']?.verses || [];
  const VERSES_ESV = loadedLangs['esv']?.verses || [];
  const VERSES_JA = loadedLangs['ja']?.verses || [];
  const VERSES_KO = loadedLangs['ko']?.verses || [];
  const VERSES_FA = loadedLangs['fa']?.verses || [];
  const VERSES_HE = loadedLangs['he']?.verses || [];
  const VERSES_ES = loadedLangs['es']?.verses || [];
  const VERSES_TR = loadedLangs['tr']?.verses || [];
  const VERSES_DE = loadedLangs['de']?.verses || [];
  const VERSES_MY = loadedLangs['my']?.verses || [];

  const [playMode, setPlayMode] = useState('square_solo');
  const [distractionLevel, setDistractionLevel] = useState(0);
  const [performanceMode, setPerformanceMode] = useState(() => localStorage.getItem('verseRainPerformanceMode') === 'true');
  const [selectedSetId, setSelectedSetId] = useState(() => parseRoute(window.location.hash).setId);
  const [authorSetsModal, setAuthorSetsModal] = useState(null);
  // 'idle' | 'playing' | 'paused' — TTS state for the verse set description.
  const [descTtsState, setDescTtsState] = useState('idle');
  useEffect(() => {
    setDescTtsState('idle');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [selectedSetId]);

  const [isPremium, setIsPremium] = useState(() => {
    const storedPremium = localStorage.getItem('verserain_is_premium') === 'true';
    const storedEmail = localStorage.getItem('verserain_player_email') || "";
    return storedPremium;
  });

  // ─── My Inviter (推薦人) state ──────────────────────────────────────────
  // Single source of truth: localStorage.verseRain_inviter. On login the
  // OAuth handler already restores user.invitedBy into localStorage so this
  // value is consistent across devices for the same account.
  const [myInviterCode, setMyInviterCode] = useState(() => {
    if (typeof window === 'undefined') return null;
    const v = localStorage.getItem('verserain_inviter') || null;
    // Treat self-invite as unbound — see [App.jsx:4138] for how this can
    // happen and the matching display-time guard below.
    const own = localStorage.getItem('verserain_personal_code');
    return v && v !== own ? v : null;
  });
  // myInviterName tri-state:
  //   undefined = not yet looked up (or no code to look up yet)
  //   null      = lookup completed but there's no name mapping for that code
  //   string    = inviter's nickname
  const [myInviterName, setMyInviterName] = useState(undefined);
  const [showBindInviterModal, setShowBindInviterModal] = useState(false);

  // Keep myInviterCode in sync with localStorage edits made elsewhere
  // (e.g. when login restores user.invitedBy into localStorage).
  useEffect(() => {
    const sync = () => {
      const raw = localStorage.getItem('verserain_inviter') || null;
      const own = localStorage.getItem('verserain_personal_code');
      const v = raw && raw !== own ? raw : null;
      setMyInviterCode(prev => (prev === v ? prev : v));
    };
    sync();
    const interval = setInterval(sync, 2000);
    return () => clearInterval(interval);
  }, []);

  // Look up the inviter's display name when we have a code.
  useEffect(() => {
    if (!myInviterCode) { setMyInviterName(undefined); return; }
    let cancelled = false;
    setMyInviterName(undefined); // mark "looking up"
    fetch(`/api/get-name-by-code?code=${encodeURIComponent(myInviterCode)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        const name = data?.name || null;
        // Cross-device self-invite guard: if the resolved nickname matches
        // our own playerName, the "inviter" is actually ourselves on
        // another device (e.g. opened our own ref link in this WebView).
        // Clear it so the card flips back to the "未綁定" CTA. Read from
        // localStorage rather than the playerName state because that state
        // is declared later in the function and would TDZ here.
        const ownName = (typeof window !== 'undefined' && localStorage.getItem('verserain_player_name')) || '';
        if (name && ownName && name === ownName) {
          localStorage.removeItem('verserain_inviter');
          setMyInviterCode(null);
          setMyInviterName(undefined);
          return;
        }
        setMyInviterName(name);
      })
      .catch(() => { if (!cancelled) setMyInviterName(null); });
    return () => { cancelled = true; };
  }, [myInviterCode]);

  // ─── Web Push state ─────────────────────────────────────────────────────
  // 'idle' | 'subscribed' | 'denied' | 'unsupported' | 'needs-pwa'
  const [pushStatus, setPushStatus] = useState('idle');
  const [showPushModal, setShowPushModal] = useState(false);
  // Soft pre-permission prompt ("要不要開每日一首推播?"). Shown from the
  // 2nd app open onward — never on first launch (let people experience the
  // app before asking for anything), never after an explicit refusal, and
  // "remind me later" snoozes it for 7 days.
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  // Deep-link auto-start gate: holds { run } when a ?startSet deep link is
  // ready to launch but the page hasn't seen a user gesture yet (Chrome
  // blocks speechSynthesis until then). One tap unlocks audio + launches.
  // May also carry { verseVoice } — a family member's recording of today's
  // verse, played right after the tap (親人聲音唸內容).
  const [deepLinkStartGate, setDeepLinkStartGate] = useState(null);

  // Tap on the gate: unlock audio and launch the pending deep-linked set.
  const beginDeepLinkStart = async () => {
    const gate = deepLinkStartGate;
    if (!gate) return;
    setDeepLinkStartGate(null);
    gate.run();
  };
  const swRegRef = useRef(null);

  // Count app opens (one per page load) for the prompt's 2nd-open gate.
  useEffect(() => {
    try {
      const n = Number(localStorage.getItem('verserain_open_count') || '0') + 1;
      localStorage.setItem('verserain_open_count', String(n));
    } catch { /* private mode etc. */ }
  }, []);

  useEffect(() => {
    // Only nudge people who *could* subscribe right now and never have:
    // 'idle' excludes subscribed / denied / unsupported / needs-pwa.
    if (pushStatus !== 'idle') return;
    try {
      // Explicitly unsubscribed before → they made a choice; don't nag.
      // Already subscribed (per local flag) → the async status check may
      // still be in flight while pushStatus reads 'idle'; don't flash the
      // prompt at people who already said yes.
      const subscribedFlag = localStorage.getItem('verserain_push_subscribed');
      if (subscribedFlag === 'false' || subscribedFlag === 'true') return;
      const prompt = JSON.parse(localStorage.getItem('verserain_push_prompt') || '{}');
      if (prompt.never) return;
      if (prompt.remindAt && Date.now() < prompt.remindAt) return;
      const opens = Number(localStorage.getItem('verserain_open_count') || '0');
      if (opens < 2) return;
    } catch { return; }
    // Small delay so the prompt doesn't collide with app startup.
    const timer = setTimeout(() => setShowPushPrompt(true), 2000);
    return () => clearTimeout(timer);
  }, [pushStatus]);

  const snoozePushPrompt = () => {
    try {
      const prompt = JSON.parse(localStorage.getItem('verserain_push_prompt') || '{}');
      prompt.remindAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      localStorage.setItem('verserain_push_prompt', JSON.stringify(prompt));
    } catch { /* ignore */ }
    setShowPushPrompt(false);
  };

  const dismissPushPromptForever = () => {
    try {
      localStorage.setItem('verserain_push_prompt', JSON.stringify({ never: true }));
    } catch { /* ignore */ }
    setShowPushPrompt(false);
  };

  // Register the service worker on mount + figure out the current push state.
  useEffect(() => {
    // Inside the iOS App Store wrapper: no Web Push, but the native shell
    // schedules local notifications for us. Ask it where things stand.
    if (hasNativeDailyPush()) {
      let cancelled = false;
      callNativeDailyPush('status').then((res) => {
        if (cancelled) return;
        if (res?.status === 'subscribed') setPushStatus('subscribed');
        else if (res?.status === 'denied') setPushStatus('denied');
        else setPushStatus('idle');
      });
      return () => { cancelled = true; };
    }
    if (!isWebPushSupported()) {
      // Older iOS Safari (pre-16.4) and the in-app WKWebView fall here.
      if (typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent || '') && !isIOSStandalone()) {
        setPushStatus('needs-pwa');
      } else {
        setPushStatus('unsupported');
      }
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (cancelled) return;
        swRegRef.current = reg;
        if (Notification.permission === 'denied') { setPushStatus('denied'); return; }
        const existing = await reg.pushManager.getSubscription();
        setPushStatus(existing ? 'subscribed' : 'idle');
      } catch (e) {
        console.error('SW register failed', e);
        setPushStatus('unsupported');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Wire a subscription up with the backend. Stores it under the user's
  // playerName so the cron sender can find it. Times are encoded in the
  // user's IANA timezone so the morning push lands at local 7am.
  const subscribeMorningPush = async () => {
    // Native iOS app: hand off to the native push layer (APNs remote push,
    // with a local-notification fallback when registration fails).
    if (hasNativeDailyPush()) {
      const res = await callNativeDailyPush('subscribe', {
        playerName: playerName || 'Anonymous',
        email: userEmail || '',
        version,
        hour: 7,
      });
      if (res?.status === 'subscribed') {
        setPushStatus('subscribed');
        localStorage.setItem('verserain_push_subscribed', 'true');
        return true;
      }
      setPushStatus(res?.status === 'denied' ? 'denied' : 'idle');
      return false;
    }
    try {
      if (!swRegRef.current) {
        const reg = await navigator.serviceWorker.register('/sw.js');
        swRegRef.current = reg;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'idle');
        return false;
      }
      const subscription = await swRegRef.current.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
      const res = await fetch(`${PARTY_DB}/save-push-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName: playerName || 'Anonymous',
          email: userEmail || '',
          subscription: subscription.toJSON(),
          timezone,
          version,
          hour: 7,
        }),
      });
      if (!res.ok) throw new Error('save-push-subscription failed');
      setPushStatus('subscribed');
      localStorage.setItem('verserain_push_subscribed', 'true');
      return true;
    } catch (e) {
      console.error('subscribeMorningPush failed', e);
      return false;
    }
  };

  const unsubscribeMorningPush = async () => {
    if (hasNativeDailyPush()) {
      await callNativeDailyPush('unsubscribe');
      setPushStatus('idle');
      localStorage.setItem('verserain_push_subscribed', 'false');
      return;
    }
    try {
      if (!swRegRef.current) return;
      const sub = await swRegRef.current.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
      await fetch(`${PARTY_DB}/delete-push-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: playerName || 'Anonymous' }),
      }).catch(() => {});
      setPushStatus('idle');
      localStorage.setItem('verserain_push_subscribed', 'false');
    } catch (e) {
      console.error('unsubscribeMorningPush failed', e);
    }
  };
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem('verserain_player_email') || "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('verserain_player_name') || "");
  // Personal invite code. Generated per-device on first run, but once the user
  // logs in we adopt the ACCOUNT's canonical code (returned by the server) so
  // every device shares one code — keeping referral/fruit-point keys aligned.
  const [personalCode, setPersonalCode] = useState(() => {
    let code = localStorage.getItem('verserain_personal_code');
    if (!code) {
      const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
      code = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      localStorage.setItem('verserain_personal_code', code);
    }
    return code;
  });

  // Adopt the account's canonical personalCode returned by login/verify. If it
  // differs from this device's local code, remember the old one so historic
  // fruit/referral points stored under it are still counted (see fruit fetch).
  const adoptAccountPersonalCode = React.useCallback((accountCode) => {
    const code = typeof accountCode === 'string' ? accountCode.trim() : '';
    if (!code) return;
    const current = localStorage.getItem('verserain_personal_code');
    if (current && current !== code) {
      // Preserve the set of prior codes this device used, so no fruits go missing.
      let prev = [];
      try { prev = JSON.parse(localStorage.getItem('verserain_prev_personal_codes') || '[]'); } catch { prev = []; }
      if (!prev.includes(current)) prev.push(current);
      localStorage.setItem('verserain_prev_personal_codes', JSON.stringify(prev));
    }
    localStorage.setItem('verserain_personal_code', code);
    setPersonalCode(code);
  }, []);

  const playerNameRef = useRef(playerName);

  // UI Language — independent of Bible version for scalable i18n
  const [uiLang, setUiLang] = useState(() => {
    // A share link carries the SENDER's UI language (?lang=…). Honour it so the
    // recipient reads the directions in the language the set was shared in
    // instead of their own default — an NIV set shared by an English user must
    // not land in a Chinese UI. Session-only: we deliberately do NOT persist it,
    // so the recipient's own saved preference survives.
    try {
      const linkLang = new URLSearchParams(window.location.search).get('lang');
      if (linkLang && SUPPORTED_UI_LANGS.includes(linkLang)) return linkLang;
    } catch { /* no window.location in non-browser contexts */ }
    const stored = localStorage.getItem('verseRain_uiLang');
    if (stored) return stored;
    // Backwards-compatible: derive from Bible version on first load
    return uiLangFor(localStorage.getItem('verseRain_version') || 'cuv');
  });
  const setUiLangPersisted = (lang) => {
    localStorage.setItem('verseRain_uiLang', lang);
    setUiLang(lang);
  };
  // Mirror the active UI language to module scope so buildPublicShareUrl stamps
  // it on every link this device sends out.
  useEffect(() => {
    SHARE_UI_LANG = uiLang;
    if (typeof document !== 'undefined') {
      // Note: only lang/title — no document dir flip, the app's layout is LTR
      // by design and per-component RTL handling already covers ar/he/fa.
      document.documentElement.lang = uiLang;
      document.title = APP_TITLE_BY_LANG[uiLang] || APP_TITLE_BY_LANG.zh;
    }
  }, [uiLang]);
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);

  // Sync personalCode to playerName mapping
  useEffect(() => {
    if (playerName && personalCode && personalCode !== playerName) {
      fetch('/api/submit-name-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: personalCode, name: playerName })
      }).catch(e => e);
    }
  }, [playerName, personalCode]);

  // DAU presence ping. Fired once on app load (and again if the user logs in,
  // so a guest converts from a device-keyed to an email-keyed identity). This
  // is the only reliable "opened the app today" signal — returning users
  // restore a local session and never re-hit /login. Fire-and-forget.
  useEffect(() => {
    let deviceId = localStorage.getItem('verserain_device_id');
    if (!deviceId) {
      deviceId = (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2)));
      localStorage.setItem('verserain_device_id', deviceId);
    }
    const email = userEmail || localStorage.getItem('verserain_player_email') || '';
    fetch(`${PARTY_HOST}/seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, email }),
    }).catch(() => {});
  }, [userEmail]);

  // On login: fetch garden from backend and merge with localStorage.
  // This ensures data is not lost when using different browsers (e.g. LINE in-app browser).
  //
  // SAFETY INVARIANT: we must NEVER overwrite the cloud copy with a local-only
  // snapshot. If we cannot positively confirm what the cloud currently holds,
  // pushing local data up can clobber newer progress made on another device.
  // A failed/non-200 fetch is therefore treated as "cloud state unknown" and we
  // do a local-only fallback WITHOUT writing back to the server.
  useEffect(() => {
    if (!playerName) return;
    const localGd = JSON.parse(localStorage.getItem('verseRain_gardenData') || '{}');

    const applyDecision = (decision) => {
      localStorage.setItem('verseRain_gardenData', JSON.stringify(decision.garden));
      setGardenData(decision.garden);
      if (decision.shouldPushToCloud) {
        // Safe to push: we either merged confirmed remote data, or confirmed the
        // player has no remote garden yet (404).
        fetchRetry(`${PARTY_HOST}/save-garden`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName, gardenData: decision.garden })
        }).catch(() => { });
      } else {
        console.warn('[garden-sync] cloud state unknown; using local copy without pushing to server to avoid clobbering remote data');
      }
    };

    fetch(`${PARTY_DB}/garden?player=${encodeURIComponent(playerName)}`)
      .then(classifyGardenResponse)
      .then((classification) => applyDecision(decideGardenSync(classification, localGd)))
      .catch(() => {
        // Network error — cloud state unknown. Display local only, never push up.
        applyDecision(decideGardenSync({ kind: 'unknown' }, localGd));
      });
  }, [playerName]);

  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  // Set from the ?resetToken=… link the 忘記密碼 email sends. Holds the raw
  // one-time token while the user picks a new password.
  const [resetToken, setResetToken] = useState(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState("");
  const [customVerseSets, setCustomVerseSets] = useState(() => {
    try {
      const saved = localStorage.getItem('verseRain_custom_sets');
      const arr = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(arr)) return [];
      // Backfill lastEditedAt for sets created before the field existed, so
      // the "most-recently-updated" sort has a value. Derive it from createdAt,
      // else the `custom-<ms>` id's creation time.
      let changed = false;
      const withTs = arr.map(s => {
        if (!s || s.lastEditedAt) return s;
        let ms = s.createdAt ? Date.parse(s.createdAt) : NaN;
        if (!Number.isFinite(ms) && String(s.id || '').startsWith('custom-')) {
          ms = parseInt(String(s.id).replace('custom-', ''), 10);
        }
        if (!Number.isFinite(ms)) return s;
        changed = true;
        return { ...s, lastEditedAt: new Date(ms).toISOString() };
      });
      if (changed) localStorage.setItem('verseRain_custom_sets', JSON.stringify(withTs));
      return withTs;
    } catch {
      return [];
    }
  });

  // Mirror customVerseSets to the backend tied to playerName so private
  // (unpublished) sets are visible across the user's devices. Without this,
  // a set created on a phone is invisible on web — they're separate
  // localStorage buckets.
  //
  // Strategy:
  //   - On login (playerName change): GET remote → merge with local, prefer
  //     the more-recently-edited copy of each id, then PUT the merge back.
  //   - On every customVerseSets state change AFTER initial sync: PUT to
  //     remote (debounced via the state-change effect's natural batching).
  //
  // We only sync sets owned by the current user — i.e. without authorName,
  // or whose authorName matches playerName — to avoid uploading copies of
  // other authors' published sets that the user pulled in via /custom-sets.
  // Wider authorship check: a user's playerName can change over time
  // ("hungry" → "hungry@G" → "hungry@y"), so a set authored under an OLD
  // playerName would otherwise be permanently stranded in localStorage and
  // never sync to backend. We treat the email's local part as the stable
  // identity and accept any authorName starting with it as "self".
  const isOwnedByCurrentUser = (s, currentPlayerName, currentEmail) => {
    if (!s) return false;
    if (!s.authorName) return true;
    if (s.authorName === currentPlayerName) return true;
    if (s.authorName === 'Anonymous') return true;
    const emailLocal = String(currentEmail || '').split('@')[0].toLowerCase();
    if (!emailLocal) return false;
    const author = String(s.authorName).toLowerCase();
    // Match common variants like "hungry", "hungry@G", "hungry@y" all sharing
    // the email-local prefix "hungry4grace" → use a sensible truncation.
    const shortLocal = emailLocal.slice(0, 6);
    return shortLocal.length >= 3 && author.startsWith(shortLocal);
  };
  const privateSetsInitialSyncDoneRef = useRef(false);
  const lastPushedPrivateSetsRef = useRef('');

  useEffect(() => {
    if (!playerName) return;
    privateSetsInitialSyncDoneRef.current = false;
    let cancelled = false;
    const host = PARTY_DB;
    (async () => {
      try {
        const res = await fetch(`${host}/private-sets?player=${encodeURIComponent(playerName)}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const remoteSets = Array.isArray(data?.sets) ? data.sets : [];
        // Merge by id: keep the entry with the larger lastEditedAt timestamp.
        const localSetsJson = localStorage.getItem('verseRain_custom_sets');
        const allLocalSets = localSetsJson ? JSON.parse(localSetsJson) : [];
        // `verseRain_custom_sets` is keyed by device, not by account: two
        // people sharing an iPad land in the same bucket. Trust it only when
        // the stamped owner is this account; otherwise keep just the sets
        // this user actually authored and let the remote supply the rest.
        // Skipped while userEmail is still unresolved — identity is the
        // email, and filtering on an empty one would drop the user's own
        // sets authored under an older playerName.
        const setsOwner = String(userEmail || '').toLowerCase();
        const storedOwner = localStorage.getItem('verseRain_custom_sets_owner');
        const localSets = (!setsOwner || storedOwner === setsOwner)
          ? allLocalSets
          : allLocalSets.filter(s => isOwnedByCurrentUser(s, playerName, userEmail));
        if (setsOwner) localStorage.setItem('verseRain_custom_sets_owner', setsOwner);
        const byId = new globalThis.Map();
        const tsOf = (s) => {
          const t = Date.parse(s?.lastEditedAt || s?.createdAt || '');
          return Number.isFinite(t) ? t : 0;
        };
        for (const s of remoteSets) { if (s?.id) byId.set(s.id, s); }
        for (const s of localSets) {
          if (!s?.id) continue;
          const existing = byId.get(s.id);
          if (!existing) { byId.set(s.id, s); continue; }
          const tLocal = tsOf(s), tRemote = tsOf(existing);
          if (tLocal > tRemote) { byId.set(s.id, s); }
          else if (tLocal === tRemote) {
            const vLocal = (s.verses || []).length;
            const vRemote = (existing.verses || []).length;
            if (vLocal > vRemote) byId.set(s.id, s);
          }
        }
        const merged = Array.from(byId.values());
        if (!cancelled) {
          setCustomVerseSets(merged);
          localStorage.setItem('verseRain_custom_sets', JSON.stringify(merged));
          // Push the merge back so the remote has the union too.
          const ownedForPush = merged.filter(s => isOwnedByCurrentUser(s, playerName, userEmail));
          lastPushedPrivateSetsRef.current = JSON.stringify(ownedForPush);
          fetchRetry(`${host}/save-private-sets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, userEmail, sets: ownedForPush }),
          }).catch(() => {});
        }
      } catch {
        // No-op on network error; local data still works.
      } finally {
        if (!cancelled) privateSetsInitialSyncDoneRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [playerName, userEmail]);

  // Push customVerseSets to the backend whenever it changes — but only after
  // the initial sync has completed (avoids racing the merge above).
  useEffect(() => {
    if (!playerName) return;
    if (!privateSetsInitialSyncDoneRef.current) return;
    const ownedForPush = customVerseSets.filter(s => isOwnedByCurrentUser(s, playerName, userEmail));
    const payload = JSON.stringify(ownedForPush);
    if (payload === lastPushedPrivateSetsRef.current) return;
    lastPushedPrivateSetsRef.current = payload;
    fetchRetry(`${PARTY_HOST}/save-private-sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName, userEmail, sets: ownedForPush }),
    }).catch(() => {
      setToast(t('雲端同步失敗，稍後再試', 'Cloud sync failed, will retry later'));
      setTimeout(() => setToast(null), 3000);
    });
  }, [customVerseSets, playerName, userEmail]);
  const [hiddenOfficialSetIds, setHiddenOfficialSetIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('verseRain_hidden_official_sets') || '[]');
    } catch {
      return [];
    }
  });
  const [editingCustomSet, setEditingCustomSet] = useState(null);
  // Two-step delete confirmation (editor + 我的內容集 rows). window.confirm
  // silently returns false inside the iOS App's WKWebView (no WKUIDelegate
  // JS-panel implementation in shipped builds), so「刪除內容集」looked dead.
  // First tap arms the button, second tap within 5s deletes.
  const [deleteArmedId, setDeleteArmedId] = useState(null);
  const deleteArmTimerRef = useRef(null);
  const armDelete = (id) => {
    setDeleteArmedId(id);
    clearTimeout(deleteArmTimerRef.current);
    deleteArmTimerRef.current = setTimeout(() => setDeleteArmedId(null), 5000);
  };
  // 自訂背景圖 / 背景音樂上傳 (內容集編輯器).
  const [bgUploadBusy, setBgUploadBusy] = useState(false);
  const [musicUploadBusy, setMusicUploadBusy] = useState(false);
  const bgFileInputRef = useRef(null);
  const musicFileInputRef = useRef(null);
  // Editor previews for custom assets (+ live music audition).
  const [editorBgPreview, setEditorBgPreview] = useState(null);
  const [editorMusicUrl, setEditorMusicUrl] = useState(null);
  const [editorMusicPlaying, setEditorMusicPlaying] = useState(false);
  const editorMusicAudioRef = useRef(null);
  const editorSetIdRef = useRef(null);

  const stopEditorMusicPreview = () => {
    try { editorMusicAudioRef.current?.pause(); } catch { /* noop */ }
    try { editorMusicAudioRef.current?._bgmDisconnect?.(); } catch { /* noop */ }
    editorMusicAudioRef.current = null;
    setEditorMusicPlaying(false);
  };

  const toggleEditorMusicPreview = () => {
    if (editorMusicPlaying) { stopEditorMusicPreview(); return; }
    if (!editorMusicUrl) return;
    // iOS honours volume only via Web Audio gain — startLoopingBgm handles it.
    editorMusicAudioRef.current = startLoopingBgm(editorMusicUrl, editingCustomSet?.bgMusicVolume ?? 0.18);
    setEditorMusicPlaying(true);
  };

  // Load previews when the editor opens on a set that already has custom
  // assets (and after fresh uploads — the fetch hits the session cache).
  useEffect(() => {
    const id = editingCustomSet?.id || null;
    if (editorSetIdRef.current !== id) {
      editorSetIdRef.current = id;
      setEditorBgPreview(null);
      setEditorMusicUrl(null);
      stopEditorMusicPreview();
    }
    let cancelled = false;
    const bg = String(editingCustomSet?.background || '');
    if (id && bg.startsWith('custom:')) {
      getSetAssetDataUrl(id, bg.slice('custom:'.length), editingCustomSet?.backgroundMime || 'image/webp')
        .then(u => { if (!cancelled) setEditorBgPreview(u); })
        .catch(() => {});
    } else {
      setEditorBgPreview(null);
    }
    const bm = String(editingCustomSet?.bgMusic || '');
    if (id && bm.startsWith('custom:')) {
      getSetAssetDataUrl(id, bm.slice('custom:'.length), editingCustomSet?.bgMusicMime || 'audio/mpeg')
        .then(u => { if (!cancelled) setEditorMusicUrl(u); })
        .catch(() => {});
    } else {
      setEditorMusicUrl(null);
      stopEditorMusicPreview();
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCustomSet?.id, editingCustomSet?.background, editingCustomSet?.bgMusic]);

  // New sets get their id assigned at first upload so the asset has a home;
  // the save handler reuses editingCustomSet.id when present.
  const ensureEditingSetId = () => {
    const id = editingCustomSet?.id || `custom-${Date.now()}`;
    if (!editingCustomSet?.id) setEditingCustomSet(prev => ({ ...prev, id }));
    return id;
  };

  // 複製內容集 — clone any set (someone else's or my own) into 我的內容集
  // as a NEW set owned by the current user, then open it in the editor so
  // edits never touch the original. Custom-uploaded background/music assets
  // are stored server-side under the ORIGINAL set id and can't ride along —
  // preset backgrounds/music copy fine.
  const copyVerseSetToMine = (set) => {
    if (!set) return;
    if (!playerName) { setShowLoginModal('login'); return; }
    const now = new Date().toISOString();
    const copy = {
      ...set,
      id: `custom-${Date.now()}`,
      title: `${set.title || set.name || t('未命名內容集', 'Untitled set')}${t('（複本）', ' (Copy)')}`,
      authorName: playerName,
      lastEditorName: playerName,
      lastEditedAt: now,
      createdAt: now,
      isPublished: false,
      ownerEmail: undefined,
      adminEmail: undefined,
      adminName: undefined,
      verses: (set.verses || []).map(v => ({ ...v })),
    };
    if (String(copy.background || '').startsWith('custom:')) { copy.background = ''; copy.backgroundMime = undefined; }
    if (String(copy.bgMusic || '').startsWith('custom:')) { copy.bgMusic = ''; copy.bgMusicMime = undefined; }
    const updated = [copy, ...customVerseSets];
    setCustomVerseSets(updated);
    try { localStorage.setItem('verseRain_custom_sets', JSON.stringify(updated)); } catch { /* storage full — cloud sync still has it */ }
    setToast(t('已複製，這份內容集現在是你的了 ✓', 'Copied — this set is yours now ✓'));
    setTimeout(() => setToast(null), 3000);
    setEditingCustomSet({ ...copy, verses: copy.verses.map(parseVerseRef) });
    setMainTab('custom_verses');
  };

  const handleBgImageUpload = async (file) => {
    if (!file || !editingCustomSet) return;
    setBgUploadBusy(true);
    try {
      const blob = await compressBackgroundImage(file);
      const setId = ensureEditingSetId();
      const assetId = await uploadSetAsset({ email: userEmail || '', setId, blob, kind: 'image' });
      setEditingCustomSet(prev => ({ ...prev, id: setId, background: `custom:${assetId}`, backgroundMime: blob.type }));
      setToast(t('背景圖片已上傳 ✓', 'Background image uploaded ✓'));
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setToast(t('上傳失敗:{error}', 'Upload failed: {error}').replace('{error}', String(e.message || e)));
      setTimeout(() => setToast(null), 5000);
    }
    setBgUploadBusy(false);
  };

  const handleMusicUpload = async (file) => {
    if (!file || !editingCustomSet) return;
    if (file.size > 5 * 1024 * 1024) {
      setToast(t('音樂檔請小於 5MB', 'Music file must be under 5MB'));
      setTimeout(() => setToast(null), 5000);
      return;
    }
    // Duration cap: bgm loops, so 3 minutes is plenty — keeps listener
    // downloads small.
    try {
      const duration = await new Promise((resolve, reject) => {
        const probe = new Audio();
        probe.preload = 'metadata';
        probe.onloadedmetadata = () => { const d = probe.duration; URL.revokeObjectURL(probe.src); resolve(d); };
        probe.onerror = () => { URL.revokeObjectURL(probe.src); reject(new Error('unreadable')); };
        probe.src = URL.createObjectURL(file);
      });
      if (Number.isFinite(duration) && duration > 185) {
        setToast(t('音樂請在 3 分鐘以內(會循環播放,不需要長)', 'Keep music under 3 minutes — it loops, so it doesn\'t need to be long'));
        setTimeout(() => setToast(null), 5000);
        return;
      }
    } catch { /* metadata unreadable — let the size cap be the guard */ }
    setMusicUploadBusy(true);
    try {
      const setId = ensureEditingSetId();
      const assetId = await uploadSetAsset({ email: userEmail || '', setId, blob: file, kind: 'music' });
      setEditingCustomSet(prev => ({ ...prev, id: setId, bgMusic: `custom:${assetId}`, bgMusicMime: file.type || 'audio/mpeg' }));
      setToast(t('背景音樂已上傳 ✓', 'Background music uploaded ✓'));
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setToast(t('上傳失敗:{error}', 'Upload failed: {error}').replace('{error}', String(e.message || e)));
      setTimeout(() => setToast(null), 5000);
    }
    setMusicUploadBusy(false);
  };

  // 貼上全文對照匯入 — Chinese / English paragraphs pasted side by side.
  const [bulkImportState, setBulkImportState] = useState(null); // null | { zh, en }

  const runBulkImport = async () => {
    const zh = splitParagraphs(bulkImportState?.zh);
    const en = splitParagraphs(bulkImportState?.en);
    const n = Math.max(zh.length, en.length);
    if (!n) return;
    const imported = Array.from({ length: n }, (_, i) => ({ reference: '', text: zh[i] || '', textEn: en[i] || '' }));
    setEditingCustomSet(prev => ({
      ...prev,
      // Drop untouched blank rows, then append the imported paragraphs.
      verses: [...prev.verses.filter(v => v.reference || v.text || v.textEn), ...imported],
    }));
    setBulkImportState(null);
  };

  // 內容集創作者親聲朗讀 — recordings for the set being edited, keyed by
  // verse reference. null target = recorder closed.
  const [editorVerseVoices, setEditorVerseVoices] = useState({});
  const [editorVoiceTarget, setEditorVoiceTarget] = useState(null); // { reference, text }
  // Which editor verse row is currently reading aloud (row index), so the
  // ▶ button can flip to a ⏹ stop button while playback runs.
  const [editorPlayingVerse, setEditorPlayingVerse] = useState(null);
  // reference → 'processing' | 'error' while a recording bakes + uploads in the
  // background (so the creator isn't blocked and can record the next verse).
  const [editorVoiceStatus, setEditorVoiceStatus] = useState({});
  // Same last-take-wins ordering as saveMyVoice: re-recording a verse in the
  // editor fires a fresh background upload before the previous one lands, so
  // without this an earlier take's register could overwrite a later one and the
  // row would keep the first take. Chain same-verse saves and drop superseded takes.
  const editorSaveSeqRef = useRef({});   // reference → latest issued seq
  const editorUploadJobRef = useRef({}); // reference → in-flight save promise
  useEffect(() => {
    let cancelled = false;
    const setId = editingCustomSet?.id;
    if (!setId) { setEditorVerseVoices({}); return undefined; }
    setVoiceApi.getAll(setId)
      .then(res => { if (!cancelled) setEditorVerseVoices(res?.voices || {}); })
      .catch(() => { if (!cancelled) setEditorVerseVoices({}); });
    return () => { cancelled = true; };
  }, [editingCustomSet?.id]);
  // Two-tap delete confirm for verse rows: first tap arms (shows 確定?), second
  // tap removes. In-app (no window.confirm — that's a silent no-op in iOS WKWebView).
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState(null);
  const confirmDeleteTimerRef = useRef(null);
  // Narrow (phone) layout for the verse-set editor rows: stack book + ch:vs
  // vertically and give the verse text two lines so it's readable.
  const [isNarrowEditor, setIsNarrowEditor] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsNarrowEditor(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [publishedVerseSets, setPublishedVerseSets] = useState([]);
  const [viewCounts, setViewCounts] = useState({});
  // Favorite verse-set ids (synced with PartyKit below). Declared here so the
  // 我的內容集 "favorites" sort can read them; the load/save effects live further down.
  const [favoriteVerseSetIds, setFavoriteVerseSetIds] = useState([]);
  const favoriteVerseSetIdSet = React.useMemo(() => new Set(favoriteVerseSetIds), [favoriteVerseSetIds]);
  // 我的內容集 list controls — sort + 10-per-page pagination.
  // (Lives after viewCounts — the popular sort reads it.)
  const [customSetsSort, setCustomSetsSort] = useState('newest'); // newest | title | popular | favorites
  const [customSetsPage, setCustomSetsPage] = useState(1);
  const sortedCustomSets = React.useMemo(() => {
    const arr = [...customVerseSets];
    // "最新" now means most-recently-updated: lastEditedAt (written on every
    // save), falling back to createdAt, then the `custom-<ms>` id's creation
    // time for sets that predate the timestamp fields.
    const updatedMs = (s) => {
      if (s?.lastEditedAt) { const ts = Date.parse(s.lastEditedAt); if (Number.isFinite(ts)) return ts; }
      if (s?.createdAt) { const ts = Date.parse(s.createdAt); if (Number.isFinite(ts)) return ts; }
      if (String(s?.id || '').startsWith('custom-')) {
        const ts = parseInt(String(s.id).replace('custom-', ''), 10);
        if (Number.isFinite(ts)) return ts;
      }
      return 0;
    };
    if (customSetsSort === 'title') {
      arr.sort((a, b) => topicStrokeCollator.compare(titleSortKey(a.title), titleSortKey(b.title)));
    } else if (customSetsSort === 'popular') {
      arr.sort((a, b) => (viewCounts[b.id] || 0) - (viewCounts[a.id] || 0));
    } else if (customSetsSort === 'favorites') {
      // Float favorited sets to the top so the user's favorites are seen at a
      // glance; within each group keep most-recently-updated first.
      arr.sort((a, b) => {
        const favA = favoriteVerseSetIdSet.has(a.id) ? 1 : 0;
        const favB = favoriteVerseSetIdSet.has(b.id) ? 1 : 0;
        if (favA !== favB) return favB - favA;
        return updatedMs(b) - updatedMs(a);
      });
    } else {
      arr.sort((a, b) => updatedMs(b) - updatedMs(a));
    }
    return arr;
  }, [customVerseSets, customSetsSort, viewCounts, favoriteVerseSetIdSet]);

  const [versesetsPage, setVersesetsPage] = useState(1);
  const [versesetsSort, setVersesetsSort] = useState('newest'); // 'newest' | 'title' | 'popular'
  const [searchSetsPage, setSearchSetsPage] = useState(1);
  const [searchVersesPage, setSearchVersesPage] = useState(1);

  // Local Leaderboard tracking (to be migrated to PartyKit on next deployment)
  const [globalUserStats, setGlobalUserStats] = useState(() => {
    let prev;
    try { prev = JSON.parse(localStorage.getItem('verseRain_globalUserStats')) || {}; } catch { prev = {}; }
    if (!prev.alltime) prev = { alltime: prev, daily: {}, monthly: {}, dateInfo: '', monthInfo: '' };
    return prev;
  });
  const [globalVerseStats, setGlobalVerseStats] = useState(() => {
    let prev;
    try { prev = JSON.parse(localStorage.getItem('verseRain_globalVerseStats')) || {}; } catch { prev = {}; }
    if (!prev.alltime) prev = { alltime: prev, daily: {}, monthly: {}, dateInfo: '', monthInfo: '' };
    return prev;
  });

  // Garden data: keyed by verseRef, each slot has { gridIndex, stage (1-10), fruits, setId }
  const [gardenData, setGardenData] = useState(() => {
    try { return JSON.parse(localStorage.getItem('verseRain_gardenData')) || {}; } catch { return {}; }
  });

  const [creatorPoints, setCreatorPoints] = useState(0);
  const [creatorOnlyPoints, setCreatorOnlyPoints] = useState(0);
  const [referralOnlyPoints, setReferralOnlyPoints] = useState(0);
  const [creatorHistory, setCreatorHistory] = useState([]);
  const [referralHistory, setReferralHistory] = useState([]);
  const [referralHistoryPage, setReferralHistoryPage] = useState(1);
  const [creatorHistoryPage, setCreatorHistoryPage] = useState(1);
  const HISTORY_PAGE_SIZE = 5;

  useEffect(() => {
    if (playerName) {
      // Fetch fruit points keyed by: playerName (authoring) + the current
      // personalCode (referrals) + any PREVIOUS personalCodes this device used
      // before adopting the account's canonical code. Including the old codes
      // ensures historic referral fruits aren't lost when the code unifies
      // across devices. We dedupe keys so nothing is double-counted.
      let prevCodes = [];
      try { prevCodes = JSON.parse(localStorage.getItem('verserain_prev_personal_codes') || '[]'); } catch { prevCodes = []; }
      const authorKeys = buildFruitAuthorKeys(playerName, personalCode, prevCodes);

      Promise.all(
        authorKeys.map(key =>
          fetch(`/api/get-creator-points?author=${encodeURIComponent(key)}&history=true`)
            .then(r => r.json())
            .catch(() => null)
        )
      ).then((results) => {
        const agg = aggregateFruitResults(results);
        setCreatorOnlyPoints(agg.creator);
        setReferralOnlyPoints(agg.referral);
        setCreatorPoints(agg.total);
        setCreatorHistory(agg.creatorHist);
        setReferralHistory(agg.refHist);
      }).catch(e => console.error(e));
    }
  }, [playerName, personalCode]);

  const localFruits = React.useMemo(() => Object.entries(gardenData || {}).filter(([k]) => k !== '_activity').reduce((sum, [, curr]) => sum + (curr.fruits || 0), 0), [gardenData]);
  const totalFruits = localFruits + creatorPoints;

  // Phase 1 personal-progress widgets (Garden page header). Cheap memoized
  // derivations from the existing _activity map and verse entries — no new
  // data sources are added.
  const todayDateStr = React.useMemo(() => new Date().toLocaleDateString('en-CA'), []);
  const personalProgress = React.useMemo(() => {
    const activity = (gardenData && gardenData._activity) || {};
    const verseEntries = Object.entries(gardenData || {}).filter(([k]) => k !== '_activity');

    // Trees + champ counts.
    const treesPlanted = verseEntries.length;
    const champVerses = verseEntries.filter(([, v]) => (v?.fruits || 0) > 0).length;

    // Streaks: walk back from today, counting consecutive days with activity.
    const today = new Date(`${todayDateStr}T00:00:00`);
    let currentStreak = 0;
    for (let d = new Date(today); ; d.setDate(d.getDate() - 1)) {
      const k = d.toLocaleDateString('en-CA');
      if ((activity[k] || 0) > 0) currentStreak++;
      else break;
    }
    // Longest streak: scan all keys, find max run of consecutive YYYY-MM-DD.
    const sortedKeys = Object.keys(activity).filter(k => (activity[k] || 0) > 0).sort();
    let longestStreak = 0, run = 0, prevTs = null;
    for (const k of sortedKeys) {
      const ts = new Date(`${k}T00:00:00`).getTime();
      if (prevTs !== null && ts - prevTs === 86400000) run++;
      else run = 1;
      if (run > longestStreak) longestStreak = run;
      prevTs = ts;
    }

    const todayCount = activity[todayDateStr] || 0;
    const totalActivities = Object.values(activity).reduce((s, n) => s + (n || 0), 0);

    return { todayCount, currentStreak, longestStreak, treesPlanted, champVerses, totalActivities };
  }, [gardenData, todayDateStr]);
  const skoolLevel = React.useMemo(() => getSkoolLevel(totalFruits), [totalFruits]);
  // Creating custom verse sets is open to ANY signed-in user — the publish
  // endpoint is owner-protected on the server, so no premium check is needed.
  // Premium / Lv.3 now only earns a celebratory badge; it's not a gate.
  const canCreateCustomSets = !!userEmail;
  const isAdmin = ['samhsiung@gmail.com', 'davidhwang1125@gmail.com', 'hsiungsam@gmail.com', 'hungry4grace@gmail.com', 'verserain.admin@gmail.com'].includes(userEmail.toLowerCase()) || skoolLevel.level >= 5;
  const isSuperAdmin = ['samhsiung@gmail.com', 'davidhwang1125@gmail.com', 'hsiungsam@gmail.com', 'hungry4grace@gmail.com'].includes(userEmail.toLowerCase());
  const [selectedGardenCell, setSelectedGardenCell] = useState(null);
  const [showLevelInfo, setShowLevelInfo] = useState(false);
  const [showFruitInfo, setShowFruitInfo] = useState(false);
  const [levelCounts, setLevelCounts] = useState(null);
  const [globalFruitsMap, setGlobalFruitsMap] = useState({});
  const [viewingPlayerGarden, setViewingPlayerGarden] = useState(null); // { playerName, gardenData } or null
  const [guestGardenCell, setGuestGardenCell] = useState(null);
  const guestGardenClickTimer = useRef(null);

  const handleViewPlayerGarden = async (name) => {
    setViewingPlayerGarden({ playerName: name, gardenData: null, loading: true });
    try {
      const [gardenRes, pointsRes] = await Promise.all([
        fetch(`${PARTY_DB}/garden?player=${encodeURIComponent(name)}`),
        fetch(`/api/get-creator-points?author=${encodeURIComponent(name)}`).catch(() => null)
      ]);
      const data = await gardenRes.json();
      let creatorPts = 0;
      let refPts = 0;
      if (pointsRes && pointsRes.ok) {
        try {
          const ptsData = await pointsRes.json();
          creatorPts = ptsData.points || 0;
          refPts = ptsData.referralPoints || 0;
        } catch (e) {}
      }
      if (data.success) {
        setViewingPlayerGarden({ playerName: name, gardenData: data.gardenData, creatorPoints: creatorPts, referralPoints: refPts, loading: false });
      } else {
        setViewingPlayerGarden({ playerName: name, gardenData: {}, creatorPoints: creatorPts, referralPoints: refPts, loading: false, error: t('該玩家尚未分享園地', 'This player has not shared their garden yet') });
      }
    } catch {
      setViewingPlayerGarden({ playerName: name, gardenData: {}, loading: false, error: t('無法載入', 'Failed to load') });
    }
  };

  useEffect(() => {
    if (!showLevelInfo) return;
    // Fetch fresh data every time the modal opens
    Promise.all([
      fetch(`${PARTY_DB}/all-gardens`)
        .then(r => r.ok ? r.json() : { fruitsMap: {} }).catch(() => ({ fruitsMap: {} })),
      fetch('/api/get-all-scores')
        .then(r => r.ok ? r.json() : { bonusFruitsMap: {} }).catch(() => ({ bonusFruitsMap: {} }))
    ]).then(([gardensData, scoresData]) => {
      const fruitsMap = (gardensData && gardensData.fruitsMap) || {};
      const bMap = (scoresData && scoresData.bonusFruitsMap) || {};
      setGlobalFruitsMap(fruitsMap);

      const allPlayerNames = new Set([
        ...Object.keys(fruitsMap),
        ...Object.keys(bMap)
      ]);

      const counts = {};
      let total = 0;
      if (allPlayerNames.size === 0) {
        counts[skoolLevel.level] = 1;
        total = 1;
      } else {
        allPlayerNames.forEach(name => {
          const gardenF = fruitsMap[name] || 0;
          const creatorF = (bMap[name] && bMap[name].creatorPoints) || 0;
          const trueFruits = gardenF + creatorF;
          const lvl = getSkoolLevel(trueFruits).level;
          counts[lvl] = (counts[lvl] || 0) + 1;
        });
        if (playerName && !allPlayerNames.has(playerName)) {
          counts[skoolLevel.level] = (counts[skoolLevel.level] || 0) + 1;
        }
        total = Object.values(counts).reduce((a, b) => a + b, 0);
      }
      counts._total = total;
      setLevelCounts(counts);
    }).catch(err => console.error('Could not fetch level stats', err));
  }, [showLevelInfo, skoolLevel.level, playerName]);
  const gardenClickTimer = useRef(null);
  const versionBeforeChallenge = useRef(null); // saved version to restore after cross-lang challenge
  const updateGarden = React.useCallback((ref, type, setId, amount = 1) => {
    // 即時脈動:廣播「本玩家剛做了動作」給所有地圖觀看者(在 updater 之外,
    // 避免 side effect 進 setState)。login 不發,否則每次開 app 都會洗版。
    const pulseKind = type === 'listen' ? 'listen'
      : type === 'played' ? 'play'
      : type === 'champ' ? 'fruit'        // 創新高 / 得新果子 → 鼓聲
      : type === 'completed' ? 'done' : null;
    if (pulseKind && playerNameRef.current) {
      try { socketRef.current?.send(JSON.stringify({ type: 'PULSE', name: playerNameRef.current, action: pulseKind })); } catch {}
    }
    setGardenData(prev => {
      const updated = { ...prev };
      let isNewVerseChallenge = false;
      if (ref && ref !== 'activity_only') {
        isNewVerseChallenge = !updated[ref] && type === 'played';
        if (!updated[ref]) {
          const used = new Set(Object.entries(updated).filter(([k]) => k !== '_activity').map(([,v]) => v.gridIndex));
          let idx = 0;
          while (used.has(idx)) idx++;
          updated[ref] = { gridIndex: idx, stage: 1, fruits: 0, setId: setId || null };
        } else if (type === 'played' && updated[ref].stage < 9) {
          updated[ref] = { ...updated[ref], stage: updated[ref].stage + 1 };
        } else if (type === 'completed') {
          updated[ref] = { ...updated[ref], stage: 10 };
        } else if (type === 'champ') {
          updated[ref] = { ...updated[ref], stage: 10, fruits: Math.min((updated[ref].fruits || 0) + amount, 9) };
        }
      }

      const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' local time
      if (!updated._activity) updated._activity = {};
      
      let currentAct = updated._activity[todayStr] || 0;
      if (currentAct > 0 && currentAct < 100) currentAct = 100;
      
      if (type === 'login') {
        if (currentAct < 100) currentAct = 100;
      } else if (type === 'listen') {
        currentAct += 100;
      } else if (isNewVerseChallenge) {
        currentAct += 1000;              // brand-new verse — biggest reward, on first play
      } else if (type === 'completed') {
        currentAct += 500;               // completing any challenge (incl. verses already in the garden)
      } else if (type === 'champ') {
        currentAct += 1000;              // completion (500) + new personal best / fruit (500)
      }
      updated._activity[todayStr] = currentAct;
      localStorage.setItem('verseRain_gardenData', JSON.stringify(updated));
      // Sync to backend if logged in
      const pn = playerNameRef.current;
      if (pn) {
        fetchRetry(`${PARTY_HOST}/save-garden`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName: pn, gardenData: updated })
        }).catch(() => { });
      }
      return updated;
    });
  }, []);

  React.useEffect(() => {
    updateGarden('activity_only', 'login');
  }, [updateGarden]);

  const logEvent = (type, args) => {
    const today = new Date().toISOString().split('T')[0];
    const month = today.slice(0, 7);

    const updateStats = (prev, idKey, field, amount) => {
      let updated = { ...prev };
      if (updated.dateInfo !== today) {
        updated.dateInfo = today;
        updated.daily = {};
      }
      if (updated.monthInfo !== month) {
        updated.monthInfo = month;
        updated.monthly = {};
      }
      if (!updated.alltime) updated.alltime = {};
      if (!updated.daily) updated.daily = {};
      if (!updated.monthly) updated.monthly = {};

      ['alltime', 'monthly', 'daily'].forEach(period => {
        if (!updated[period][idKey]) updated[period][idKey] = { champs: 0, completes: 0, plays: 0 };
        updated[period][idKey][field] = (updated[period][idKey][field] || 0) + amount;
      });
      return updated;
    };

    if (type === 'versePlayed') {
      const { ref, setId } = args;
      setGlobalVerseStats(prev => {
        const updated = updateStats(prev, ref, 'plays', 1);
        localStorage.setItem('verseRain_globalVerseStats', JSON.stringify(updated));
        return updated;
      });
      fetch('/api/submit-verse-stat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, type: 'plays' }) }).catch(() => { });
      updateGarden(ref, 'played', setId);
    }
    if (type === 'verseCompleted') {
      const { ref, name, isChamp, setId, amount } = args;
      setGlobalVerseStats(prev => {
        const updated = updateStats(prev, ref, 'completes', 1);
        localStorage.setItem('verseRain_globalVerseStats', JSON.stringify(updated));
        return updated;
      });
      fetch('/api/submit-verse-stat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, type: 'completes', amount: 1 }) }).catch(() => { });
      if (name) {
        setGlobalUserStats(prev => {
          let updated = updateStats(prev, name, 'completes', 1);
          if (isChamp) {
            updated = updateStats(updated, name, 'champs', 1);
          }
          localStorage.setItem('verseRain_globalUserStats', JSON.stringify(updated));
          return updated;
        });
      }
      updateGarden(ref, isChamp ? 'champ' : 'completed', setId, amount || 1);
    }
  };

  useEffect(() => {
    fetch(`${PARTY_DB}/custom-sets`)
      .then(res => res.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setPublishedVerseSets(data);
        setCustomVerseSets(prev => {
          let changed = false;
          const updated = prev.map(cs => {
            const pub = data.find(p => p.id === cs.id);
            if (!pub) return cs;
            const tPub = Date.parse(pub.lastEditedAt || '') || 0;
            const tLocal = Date.parse(cs.lastEditedAt || '') || 0;
            const contentDiffers = pub.title !== cs.title || (pub.verses || []).length !== (cs.verses || []).length;
            if (tPub > tLocal || (tPub === tLocal && contentDiffers)) { changed = true; return { ...pub }; }
            return cs;
          });
          if (changed) localStorage.setItem('verseRain_custom_sets', JSON.stringify(updated));
          return changed ? updated : prev;
        });
      })
      .catch(err => console.error("Failed to fetch published sets", err));

    fetch(`${PARTY_DB}/custom-sets/view`)
      .then(res => res.json())
      .then(data => {
        if (data) {
          const cleanData = {};
          Object.keys(data).forEach(k => cleanData[k.replace('views:', '')] = data[k]);
          setViewCounts(cleanData);
        }
      })
      .catch(err => console.error("Failed to fetch view counts", err));
  }, []);

  const baseVerseSets = loadedLangs[version]?.sets || [];
  const activeVerseSets = React.useMemo(() => {
    const merged = [];
    customVerseSets.forEach(cs => {
      {
        const pub = publishedVerseSets.find(p => p.id === cs.id);
        if (pub) {
          const tPub = Date.parse(pub.lastEditedAt || '') || 0;
          const tLocal = Date.parse(cs.lastEditedAt || '') || 0;
          const base = tPub >= tLocal ? pub : cs;
          merged.push({
            ...base,
            authorName: (pub.authorName !== "Anonymous") ? pub.authorName : (cs.authorName || playerName || "匿名玩家"),
            lastEditorName: pub.lastEditorName || cs.lastEditorName,
            lastEditedAt: pub.lastEditedAt || cs.lastEditedAt
          });
        } else {
          merged.push({
            ...cs,
            authorName: cs.authorName || playerName || "匿名玩家",
          });
        }
      }
    });
    publishedVerseSets.forEach(ps => {
      {
        if (!merged.some(cs => cs.id === ps.id)) {
          merged.push(ps);
        }
      }
    });
    const filteredBase = baseVerseSets.filter(bs => !merged.some(m => m.id === bs.id) && !hiddenOfficialSetIds.includes(bs.id));
    return [...filteredBase, ...merged].map(set => localizeSet(localizeOfficialTopicSetTitle(set, version), version));
  }, [customVerseSets, publishedVerseSets, baseVerseSets, playerName, version, hiddenOfficialSetIds, simplifiedReady]);

  // Pick a random verse from the "rain-verses" set for the homepage subtitle
  const [rainVerseIndex, setRainVerseIndex] = React.useState(() => Math.floor(Math.random() * 10000));
  const [isLobbyReading, setIsLobbyReading] = React.useState(false);
  const lobbyReadRunRef = React.useRef(0);
  const preferredRainSet = React.useMemo(() => {
    // 每日一首 / lobby quote pool: the quatrain packs read best as one-liners.
    const rainSets = activeVerseSets.filter(s => s.id && (s.id.startsWith('rain-verses') || /jueju$/.test(s.id)));
    if (!rainSets.length) return null;
    return rainSets.find(s => s.id === 'tang300-wuyan-jueju') || rainSets[0];
  }, [activeVerseSets, version]);
  const getSetsForVersion = React.useCallback((targetVersion) => {
    const localSets = loadedLangs[targetVersion]?.sets || [];
    const customSets = customVerseSets.filter(set => (set.language || 'cuv') === targetVersion);
    const publishedSets = publishedVerseSets.filter(set => (set.language || 'cuv') === targetVersion);
    const byId = new globalThis.Map();
    [...localSets, ...customSets, ...publishedSets].forEach(set => {
      if (set?.id) byId.set(set.id, set);
    });
    return Array.from(byId.values());
  }, [customVerseSets, publishedVerseSets, loadedLangs]);


  // Flat list of all verses loaded for the secondary language (built-in + custom + published)
  const allSecondaryVerses = React.useMemo(() => {
    if (!bilingualSecondaryVersion) return [];
    const sets = getSetsForVersion(bilingualSecondaryVersion);
    return sets.flatMap(s => s.verses || []).filter(Boolean);
  }, [bilingualSecondaryVersion, getSetsForVersion]);

  const findSecondarySetForPrimarySet = React.useCallback((primarySet) => {
    if (!primarySet || !bilingualSecondaryVersion || baseLang(bilingualSecondaryVersion) === baseLang(version)) return null;
    if ((primarySet.verses || []).some(isBilingualItem)) return localizeSet(primarySet, bilingualSecondaryVersion);
    const secondarySets = getSetsForVersion(bilingualSecondaryVersion);
    if (!secondarySets.length) return null;
    const primaryId = primarySet.id || '';
    const normalizedTitle = String(primarySet.title || '')
      .replace(/\s*\((KJV|ESV|NIV)\)\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const primaryRefs = new Set((primarySet.verses || []).map(v => normalizeVerseReferenceKey(v.reference)).filter(Boolean));

    // CUV sets are historically stored with no language suffix (e.g.
    // "gospel-of-john"), while every other language uses "<base>-<lang>"
    // (e.g. "gospel-of-john-he", "gospel-of-john-cuvs"). So when pairing
    // *into* CUV we also try the bare base id, and when pairing *from* CUV
    // we treat the entire id as the base.
    const baseId = primaryId.replace(/-(cuv|cuvs|kjv|esv|niv|ja|ko|fa|he|es|tr|de|my|vi|id|ms|tw|pt|fr|ru|hi)$/i, '');
    const candidates = [
      secondarySets.find(set => set.id === `${primaryId}-${bilingualSecondaryVersion}`),
      secondarySets.find(set => set.id === primaryId.replace(/-(cuv|cuvs|kjv|esv|niv|ja|ko|fa|he|es|tr|de|my|vi|id|ms|tw|pt|fr|ru|hi)$/i, `-${bilingualSecondaryVersion}`)),
      bilingualSecondaryVersion === 'cuv' ? secondarySets.find(set => set.id === baseId) : null,
      bilingualSecondaryVersion !== 'cuv' ? secondarySets.find(set => set.id === `${baseId}-${bilingualSecondaryVersion}`) : null,
      secondarySets.find(set => primaryId === 'rain-verses' && set.id === `rain-verses-${bilingualSecondaryVersion}`),
      secondarySets.find(set => set.id === primaryId),
      secondarySets.find(set => String(set.title || '').replace(/\s*\((KJV|ESV|NIV)\)\s*/gi, '').replace(/\s+/g, ' ').trim().toLowerCase() === normalizedTitle)
    ].filter(Boolean);
    if (candidates[0]) return candidates[0];

    let bestSet = null;
    let bestScore = 0;
    secondarySets.forEach(set => {
      const refs = (set.verses || []).map(v => normalizeVerseReferenceKey(v.reference)).filter(Boolean);
      const score = refs.reduce((sum, ref) => sum + (primaryRefs.has(ref) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestSet = set;
      }
    });
    return bestScore > 0 ? bestSet : null;
  }, [bilingualSecondaryVersion, version, getSetsForVersion]);

  const secondaryRainSet = React.useMemo(() => {
    const secondarySets = getSetsForVersion(bilingualSecondaryVersion);
    const rainSets = secondarySets.filter(s => s.id && s.id.startsWith('rain-verses'));
    if (!rainSets.length) return null;
    return (
      rainSets.find(s => s.language === bilingualSecondaryVersion && s.id.endsWith(`-${bilingualSecondaryVersion}`)) ||
      rainSets.find(s => s.language === bilingualSecondaryVersion) ||
      rainSets.find(s => s.id === preferredRainSet?.id) ||
      rainSets[0]
    );
  }, [getSetsForVersion, bilingualSecondaryVersion, preferredRainSet?.id]);
  const randomRainVerse = React.useMemo(() => {
    if (preferredRainSet && preferredRainSet.verses && preferredRainSet.verses.length > 0) {
      return preferredRainSet.verses[rainVerseIndex % preferredRainSet.verses.length];
    }
    return null;
  }, [preferredRainSet, rainVerseIndex]);

  const [dailyVerseDate, setDailyVerseDate] = useState(() => formatLocalDate(new Date()));
  // Set when the lobby 好文欣賞 card is tapped, so the daily player auto-opens
  // its 每日一首 / 我的最愛 / 主題好文 picker on entry. Cleared once consumed.
  const [openDailyPickerOnEnter, setOpenDailyPickerOnEnter] = useState(false);
  // vo= from a listenDaily share link — the sender's personal-voice owner id,
  // passed through to the daily player so recipients hear the sender's
  // recording instead of TTS. Cleared when leaving the daily player.
  const [dailySharedVoiceOwner, setDailySharedVoiceOwner] = useState(null);
  const [remoteDailyVerse, setRemoteDailyVerse] = useState(null);
  const [isDailyVerseLoading, setIsDailyVerseLoading] = useState(true);
  const dailyVerseRemoteVersion = getDailyVerseRemoteVersion(version);
  const dailyVerse = React.useMemo(() => {
    const pool = preferredRainSet?.verses?.length
      ? preferredRainSet.verses
      : activeVerseSets.flatMap(s => s.verses || []);
    return pool[getDailyVerseIndex(pool.length, `${dailyVerseDate}T00:00:00`)] || null;
  }, [preferredRainSet, activeVerseSets, dailyVerseDate]);
  const changeDailyVerseDate = React.useCallback((nextDateOrUpdater) => {
    setRemoteDailyVerse(null);
    setIsDailyVerseLoading(true);
    setDailyVerseDate(prev => {
      const nextDate = typeof nextDateOrUpdater === 'function' ? nextDateOrUpdater(prev) : nextDateOrUpdater;
      return nextDate || prev;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const remoteVersion = dailyVerseRemoteVersion;
    if (!remoteVersion) {
      setRemoteDailyVerse(null);
      setIsDailyVerseLoading(false);
      return () => { cancelled = true; };
    }
    setRemoteDailyVerse(null);
    setIsDailyVerseLoading(true);
    fetch(`/api/daily-verse?date=${dailyVerseDate}&version=${remoteVersion}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`Daily verse ${res.status}`)))
      .then(data => {
        if (cancelled) return;
        if (data?.text && data?.reference) {
          setRemoteDailyVerse({
            id: `dailyverses-${data.date || dailyVerseDate}-${remoteVersion}`,
            reference: data.reference,
            text: data.text,
            title: 'Daily Verse',
            sourceUrl: data.sourceUrl,
            date: data.date || dailyVerseDate,
            translation: data.translation || remoteVersion
          });
        }
      })
      .catch(() => {
        if (!cancelled) setRemoteDailyVerse(null);
      })
      .finally(() => {
        if (!cancelled) setIsDailyVerseLoading(false);
      });
    return () => { cancelled = true; };
  }, [dailyVerseDate, dailyVerseRemoteVersion]);

  const remoteDailyVerseMatches =
    remoteDailyVerse?.translation === dailyVerseRemoteVersion &&
    remoteDailyVerse?.date === dailyVerseDate;
  const displayedDailyVerse = remoteDailyVerseMatches ? remoteDailyVerse : (isDailyVerseLoading ? null : dailyVerse);
  const dailySecondaryVerseSet = React.useMemo(() => {
    if (!displayedDailyVerse || !bilingualSecondaryVersion || baseLang(bilingualSecondaryVersion) === baseLang(version)) return null;
    if (isBilingualItem(displayedDailyVerse)) {
      const loc = localizeSet({ verses: [displayedDailyVerse] }, bilingualSecondaryVersion).verses[0];
      return { id: `daily-secondary-${bilingualSecondaryVersion}-${dailyVerseDate}`, title: langLabelOf(bilingualSecondaryVersion), verses: [loc] };
    }
    const secondarySets = getSetsForVersion(bilingualSecondaryVersion);
    for (const set of secondarySets) {
      const match = findMatchingVerse(displayedDailyVerse, [displayedDailyVerse], set.verses || [], { allowIndexFallback: false });
      if (match) {
        return {
          id: `daily-secondary-${bilingualSecondaryVersion}-${dailyVerseDate}`,
          title: set.title || BIBLE_LANGUAGE_OPTIONS.find(option => option.value === bilingualSecondaryVersion)?.label || bilingualSecondaryVersion,
          verses: [match]
        };
      }
    }
    return null;
  }, [displayedDailyVerse, bilingualSecondaryVersion, version, getSetsForVersion, dailyVerseDate]);

  const dummySet = useMemo(() => [{
    id: "dummy",
    title: isEnglishBibleVersion(version) ? 'No Collections Found' : '尚未發現內容集',
    authorName: "System",
    verses: [{
      reference: "N/A", text: isEnglishBibleVersion(version) ? 'There are no collections for this language yet. Create one in 👑 My Collections.' : '目前此語言沒有內容集。請去 👑 我的內容集 中建立！'
    }]
  }], [version]);

  const safeActiveSets = activeVerseSets.length > 0 ? activeVerseSets : dummySet;
  // favoriteVerseSetIds / favoriteVerseSetIdSet are declared earlier (near the
  // 我的內容集 sort controls) so the "favorites" sort can read them.
  const saveFavoriteVerseSetIds = React.useCallback(async (nextIds) => {
    if (!userEmail) return false;
    const res = await fetchRetry(`${PARTY_HOST}/verse-set-favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail, playerName, setIds: nextIds }),
    });
    if (!res.ok) {
      throw new Error(`favorites save failed: ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    if (Array.isArray(data?.setIds)) {
      setFavoriteVerseSetIds(data.setIds);
    }
    return true;
  }, [userEmail, playerName]);

  const handleFavoriteSaveError = React.useCallback(() => {
      setToast(t('我的最愛同步失敗，稍後再試', 'Favorites sync failed, please try again later'));
      setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (!userEmail) {
      setFavoriteVerseSetIds([]);
      return;
    }
    let cancelled = false;
    fetch(`${PARTY_HOST}/verse-set-favorites?email=${encodeURIComponent(userEmail)}`)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`)))
      .then(data => {
        if (cancelled) return;
        const setIds = Array.isArray(data?.setIds) ? data.setIds.filter(id => typeof id === 'string' && id.trim()) : [];
        setFavoriteVerseSetIds(Array.from(new Set(setIds)));
      })
      .catch(() => {
        if (!cancelled) {
          setFavoriteVerseSetIds([]);
          setToast(t('無法載入我的最愛', 'Could not load favorites'));
          setTimeout(() => setToast(null), 3000);
        }
      });
    return () => { cancelled = true; };
  }, [userEmail]);

  const toggleFavoriteVerseSet = React.useCallback((set) => {
    const setId = typeof set === 'string' ? set : set?.id;
    if (!setId) return;
    if (!userEmail) {
      setShowLoginModal('login');
      return;
    }
    const previous = favoriteVerseSetIds;
    const next = previous.includes(setId)
      ? previous.filter(id => id !== setId)
      : [...previous, setId];
    setFavoriteVerseSetIds(next);
    saveFavoriteVerseSetIds(next).catch(() => {
      setFavoriteVerseSetIds(previous);
      handleFavoriteSaveError();
    });
  }, [userEmail, favoriteVerseSetIds, saveFavoriteVerseSetIds, handleFavoriteSaveError]);

  const favoriteVerseSets = React.useMemo(() => {
    const byId = new globalThis.Map(safeActiveSets.filter(set => set?.id).map(set => [set.id, set]));
    return favoriteVerseSetIds.map(id => byId.get(id)).filter(Boolean);
  }, [favoriteVerseSetIds, safeActiveSets]);

  const topicVerseSets = React.useMemo(
    () => safeActiveSets.filter(set => TOPIC_PREFIX_REGEX.test(String(set?.title || '').trim())),
    [safeActiveSets]
  );

  const currentSet = (selectedSetId ? (safeActiveSets.find(s => s.id === selectedSetId) || customVerseSets.find(s => s.id === selectedSetId)) : null) || safeActiveSets[0];
  // 創作者親聲朗讀 — recordings map for the set detail page, so verse rows
  // can show a ⭐ on recorded verses. voiceRefreshTick bumps when the editor
  // closes so newly-recorded verses show up here even though currentSet.id
  // is unchanged (otherwise the detail page keeps the pre-editing snapshot
  // and most fresh recordings look "missing" until a full reload).
  const [currentSetVoices, setCurrentSetVoices] = useState({});
  // Every reference with ANY recording (author OR any public contributor), so a
  // ⭐ shows even when the recording is someone else's — not just the viewer's
  // own or the author's. A Set of reference strings.
  const [currentSetVoiceRefs, setCurrentSetVoiceRefs] = useState(() => new Set());
  const [voiceRefreshTick, setVoiceRefreshTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setCurrentSetVoices({});
    setCurrentSetVoiceRefs(new Set());
    const id = currentSet?.id;
    if (!id) return undefined;
    setVoiceApi.getAll(id)
      .then(res => { if (!cancelled) setCurrentSetVoices(res?.voices || {}); })
      .catch(() => { /* no recordings */ });
    userVoiceApi.getVoiceRefs(id)
      .then(res => { if (!cancelled && Array.isArray(res?.refs)) setCurrentSetVoiceRefs(new Set(res.refs)); })
      .catch(() => { /* union is best-effort — the author-only ⭐ still shows */ });
    return () => { cancelled = true; };
  }, [currentSet?.id, voiceRefreshTick]);
  const getVerseSetAuthorName = React.useCallback((set) => {
    if (!set) return "";
    if (set.authorName && set.authorName !== "Anonymous") return set.authorName;
    return String(set.id).startsWith("custom-") ? '匿名玩家' : 'Verserain 官方';
  }, []);
  const getVerseSetLastEditorName = React.useCallback((set) => {
    if (!set?.lastEditorName || set.lastEditorName === "Anonymous") return "";
    const author = getVerseSetAuthorName(set);
    return set.lastEditorName === author ? "" : set.lastEditorName;
  }, [getVerseSetAuthorName]);
  const currentSetAuthorName = getVerseSetAuthorName(currentSet);
  const currentSetLastEditorName = getVerseSetLastEditorName(currentSet);
  const sortedVerseSetList = React.useMemo(() => {
    let sortedSets = [...activeVerseSets];
    if (versesetsSort === 'topic') {
      sortedSets = sortedSets.filter(set => extractVerseSetTopic(set.title));
      sortedSets.sort((a, b) => {
        const aTopic = extractVerseSetTopic(a.title);
        const bTopic = extractVerseSetTopic(b.title);
        const firstCompare = topicStrokeCollator.compare(getFirstTopicChar(aTopic), getFirstTopicChar(bTopic));
        if (firstCompare !== 0) return firstCompare;
        const topicCompare = topicStrokeCollator.compare(aTopic, bTopic);
        if (topicCompare !== 0) return topicCompare;
        return topicStrokeCollator.compare(String(a.title || ''), String(b.title || ''));
      });
      return sortedSets;
    }
    if (versesetsSort === 'popular') {
      sortedSets.sort((a, b) => (viewCounts[b.id] || 0) - (viewCounts[a.id] || 0));
      return sortedSets;
    }
    if (versesetsSort === 'title') {
      // 標題 = 依標題首字筆畫排序 (stroke-count collation for zh-Hant),
      // ignoring leading punctuation/brackets.
      sortedSets.sort((a, b) => topicStrokeCollator.compare(titleSortKey(a.title), titleSortKey(b.title)));
      return sortedSets;
    }
    // Unified "newest" = most-recently-updated. Anything with a real timestamp
    // competes head-to-head, preferring the last-edit time over creation:
    //   1. set.lastEditedAt (written on every save/admin edit)        → Date.parse → ms
    //   2. set.createdAt (explicit ISO date on the set)               → Date.parse → ms
    //   3. custom- IDs                                                → numeric suffix → ms
    //   4. published-over-official: look up the base's timestamps     → official's ISO date
    //   5. anything else without timestamp                            → baseIndex (small number)
    // Buckets 1-4 use real epoch ms so they always rank above bucket 5.
    // Bucket 4 matters because admin-edited published officials lack their own timestamp.
    const getEffectiveUpdatedAt = (set) => {
      if (set?.lastEditedAt) {
        const t = Date.parse(set.lastEditedAt);
        if (Number.isFinite(t)) return t;
      }
      if (set?.createdAt) {
        const t = Date.parse(set.createdAt);
        if (Number.isFinite(t)) return t;
      }
      if (String(set?.id || '').startsWith('custom-')) {
        const ts = parseInt(String(set.id).replace('custom-', ''), 10);
        if (Number.isFinite(ts)) return ts;
      }
      const baseMatch = baseVerseSets.find(b => b.id === set?.id);
      if (baseMatch?.lastEditedAt) {
        const t = Date.parse(baseMatch.lastEditedAt);
        if (Number.isFinite(t)) return t;
      }
      if (baseMatch?.createdAt) {
        const t = Date.parse(baseMatch.createdAt);
        if (Number.isFinite(t)) return t;
      }
      const indexInBase = baseVerseSets.findIndex(b => b.id === set?.id);
      return indexInBase !== -1 ? indexInBase : -1;
    };
    sortedSets.sort((a, b) => getEffectiveUpdatedAt(b) - getEffectiveUpdatedAt(a));
    return sortedSets;
  }, [activeVerseSets, baseVerseSets, versesetsSort, viewCounts]);
  const authorVerseSets = React.useMemo(() => {
    if (!authorSetsModal?.authorName) return [];
    return activeVerseSets.filter(set => getVerseSetAuthorName(set) === authorSetsModal.authorName);
  }, [activeVerseSets, authorSetsModal, getVerseSetAuthorName]);
  const VERSES_DB = currentSet.verses;

  const [activeVerse, setActiveVerse] = useState(VERSES_DB[0] || { reference: "N/A", text: "" });
  const [selectedVerseRefs, setSelectedVerseRefs] = useState([VERSES_DB[0]?.reference || "N/A"]);

  useEffect(() => {
    if (activeVerse?.reference === "N/A" && VERSES_DB && VERSES_DB.length > 0 && VERSES_DB[0].reference !== "N/A") {
      setActiveVerse(VERSES_DB[0]);
      setSelectedVerseRefs([VERSES_DB[0].reference]);
    }
  }, [VERSES_DB, activeVerse]);

  const [initAutoStart, setInitAutoStart] = useState(null);

  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const bgmAudioRef = useRef(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    if (!bgmAudioRef.current) {
      bgmAudioRef.current = new Audio('/bgm.mp3');
      bgmAudioRef.current.loop = true;
      bgmAudioRef.current.volume = 0.16;
    }
    if (isMusicPlaying) {
      const playPromise = bgmAudioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.log('Autoplay prevented, will play on interaction');
          setAutoplayBlocked(true);
          setIsMusicPlaying(false);
        });
      }
    } else {
      bgmAudioRef.current.pause();
    }
  }, [isMusicPlaying]);

  useEffect(() => {
    const unlockAutoplay = () => {
      if (autoplayBlocked) {
        setAutoplayBlocked(false);
        setIsMusicPlaying(true);
      }
    };
    if (autoplayBlocked) {
      window.addEventListener('click', unlockAutoplay);
      window.addEventListener('touchstart', unlockAutoplay);
    }
    return () => {
      window.removeEventListener('click', unlockAutoplay);
      window.removeEventListener('touchstart', unlockAutoplay);
    };
  }, [autoplayBlocked]);

  const handleVersionChange = async (newVer) => {
    setVersion(newVer);
    // Auto-sync UI language immediately so mobile users get instant feedback.
    setUiLangPersisted(uiLangFor(newVer));

    setIsLangsLoading(true);
    try {
      let data = loadedLangs[newVer];
      if (!data) {
        data = await loadLanguageSets(newVer);
        setLoadedLangs(prev => ({ ...prev, [newVer]: data }));
      }

      let targetVerses = data?.verses || [];
      if (targetVerses.length === 0) {
        targetVerses = [{ reference: "N/A", text: isEnglishBibleVersion(newVer) ? 'No paragraphs found.' : '目前的分類下沒有內容。' }];
      }
      setActiveVerse(targetVerses[0]);
      setSelectedVerseRefs([targetVerses[0].reference]);
      setCampaignQueue(null);
    } catch (error) {
      console.error('Failed to load language sets', newVer, error);
    } finally {
      setIsLangsLoading(false);
    }
  };

  // One-time cleanup of the pre-v2 verse cache (see BIBLE_CACHE_KEY).

  useEffect(() => {
    const parseUrlArgs = async () => {
      const params = new URLSearchParams(window.location.search);
      const mParam = params.get('m');
      const dxParam = params.get('dx');
      const vParam = params.get('v');
      const textParam = params.get('text');
      const refParam = params.get('ref');

      // ?resetToken=… — the single-use link from the 忘記密碼 email. Strip it
      // from the address bar immediately so the token doesn't linger in
      // history, bookmarks or a screen-shared URL bar.
      const resetTokenParam = params.get('resetToken');
      if (resetTokenParam) {
        setResetToken(resetTokenParam);
        const url = new URL(window.location.href);
        url.searchParams.delete('resetToken');
        window.history.replaceState({}, '', url.toString());
      }

      if (refParam) {
        // Refuse self-referral — without this, a user opening their own ref
        // link in a fresh WebView would silently bind themselves as their
        // own inviter, and the "我的推薦人" card would surface their own
        // name/email forever (cross-device restore can't overwrite it).
        const ownCode = localStorage.getItem('verserain_personal_code');
        if (refParam !== ownCode) {
          localStorage.setItem('verserain_inviter', refParam);
          localStorage.removeItem('verserain_invite_claimed');
        }
      }

      // ?startSet=<setId>[&mode=play|campaign]
      // Stash for the dedicated launch effect below (we don't have
      // activeVerseSets loaded yet at this stage). Strip the params
      // immediately so a refresh doesn't re-launch unexpectedly.
      const startSetParam = params.get('startSet');
      if (startSetParam) {
        const mode = params.get('mode') === 'play' ? 'play' : 'campaign';
        sessionStorage.setItem('verserain_pending_start_set', startSetParam);
        sessionStorage.setItem('verserain_pending_start_set_mode', mode);
        const url = new URL(window.location.href);
        url.searchParams.delete('startSet');
        url.searchParams.delete('mode');
        window.history.replaceState({}, '', url.toString());
      }

      let shouldAutoPlay = false;
      let loadedVerses = [];
      let overrideVersion = null;

      if (mParam) {
        const cleanM = mParam.replace(/['"]/gi, '').toLowerCase();
        if (cleanM === 'verse square' || cleanM === 'square') {
          setPlayMode('square_solo');
        } else if (cleanM === 'rain') {
          setPlayMode('rain_solo');
        } else if (cleanM === 'blind') {
          setPlayMode('blind'); // deprecated but keeping for safety
        } else if (cleanM === 'voice') {
          setPlayMode('voice_solo');
        } else if (cleanM === 'voice_prompt') {
          setPlayMode('voice_prompt');
        } else if (cleanM === 'auto-played' || cleanM === 'auto-play') {
          shouldAutoPlay = true;
        } else {
          setPlayMode(cleanM); // Fallback for any other valid string
        }
      }

      if (dxParam) {
        const dx = parseInt(dxParam, 10);
        if (!isNaN(dx) && dx >= 0 && dx <= 3) {
          setDistractionLevel(dx);
        }
      }

      if (textParam) {
        let cleanText = textParam.replace(/['"]/g, '').trim();
        let title = "Custom Verse";

        const match = cleanText.match(/^([1-3]?\s*[a-zA-Z\u4e00-\u9fa5]+\s*\d+(?::\d+(?:-\d+)?)?:?)\s+([「"]?)(.*)/);
        if (match) {
          title = match[1].trim();
          cleanText = match[3].replace(/[」"]$/, '').trim();
        } else {
          const match2 = cleanText.match(/^([^\s「"]+[\d:]+)\s+([「"]?)(.*)/);
          if (match2) {
            title = match2[1].trim();
            cleanText = match2[3].replace(/[」"]$/, '').trim();
          }
        }

        const isEnglish = /^[a-zA-Z\s.,:;’”’’’’””?!()\-]+$/.test(cleanText.substring(0, 50));
        setVersion(isEnglish ? (isEnglishBibleVersion(version) ? version : 'en') : 'cuv');

        setActiveVerse({
          reference: title,
          title: "Custom Text",
          text: cleanText.replace(/\n/g, ' ').trim()
        });
        setSelectedVerseRefs([title]);
        setCampaignQueue(null);
        setCampaignResults([]);

      } else if (vParam) {
        const cleanV = vParam.replace(/['"]/gi, '');
        const refs = cleanV.split(';').map(s => s.trim()).filter(Boolean);

        for (let r of refs) {
          let cuvData = loadedLangs['cuv'];
          if (!cuvData) {
            cuvData = await loadLanguageSets('cuv');
            setLoadedLangs(prev => ({ ...prev, cuv: cuvData }));
          }
          let foundCuv = cuvData.verses.find(v => v.reference.toLowerCase().includes(r.toLowerCase()));
          if (foundCuv) {
            loadedVerses.push(foundCuv);
            if (!overrideVersion) overrideVersion = 'cuv';
            continue;
          }
          let kjvData = loadedLangs['en'];
          if (!kjvData) {
            kjvData = await loadLanguageSets('en');
            setLoadedLangs(prev => ({ ...prev, kjv: kjvData }));
          }
          let foundKjv = kjvData.verses.find(v => v.reference.toLowerCase().includes(r.toLowerCase()));
          if (foundKjv) {
            loadedVerses.push(foundKjv);
            if (!overrideVersion) overrideVersion = 'en';
            continue;
          }

          // Dynamic fetch fallback for English verses not in DB
          try {
            const res = await fetch(`https://bible-api.com/${encodeURIComponent(r)}?translation=kjv`);
            if (res.ok) {
              const data = await res.json();
              loadedVerses.push({
                reference: data.reference,
                title: "Custom Selection",
                text: data.text.replace(/\n/g, ' ').trim()
              });
              if (!overrideVersion) overrideVersion = 'en';
            }
          } catch (e) {
            console.error("Fetch failed", r, e);
          }
        }

        if (loadedVerses.length > 0) {
          if (overrideVersion && overrideVersion !== version) {
            setVersion(overrideVersion);
          }
          setActiveVerse(loadedVerses[0]);
          setSelectedVerseRefs(loadedVerses.map(v => v.reference));

          if (loadedVerses.length > 1) {
            setCampaignQueue(loadedVerses.slice(1));
          } else {
            setCampaignQueue(null);
          }
          setCampaignResults([]);
        }
      }

      // Trigger automatic start if requested by URL
      if (textParam || vParam || shouldAutoPlay) {
        setTimeout(() => {
          setInitAutoStart({ trigger: true, isAuto: shouldAutoPlay });
        }, 500);
      }
    };
    parseUrlArgs();
  }, []); // Run strictly once on mount

  const toggleSelection = (ref) => {
    setSelectedVerseRefs(prev =>
      prev.includes(ref)
        ? prev.filter(r => r !== ref)
        : [...prev, ref]
    );
  };

  // Same splitter as the rain player — these two had drifted apart, which is how
  // Japanese lost 、in one copy while Korean was space-split into one block per
  // word in the other. Script detection lives in lib/phraseSplitter.js.
  const activePhrases = React.useMemo(
    () => splitVersePhrases(activeVerse.text),
    [activeVerse]
  );

  const activePhrasesRef = useRef([]);
  useEffect(() => { activePhrasesRef.current = activePhrases; }, [activePhrases]);

  const [gameState, setGameState] = useState('menu');
  const gameStateRef = useRef('menu');
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);
  // Restore original language after a cross-language garden challenge ends
  useEffect(() => {
    if (gameState === 'menu' && versionBeforeChallenge.current) {
      setVersion(versionBeforeChallenge.current);
      versionBeforeChallenge.current = null;
    }
  }, [gameState]);

  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const isAutoPlayRef = useRef(false);
  useEffect(() => { isAutoPlayRef.current = isAutoPlay; }, [isAutoPlay]);

  const [speakingTitle, setSpeakingTitle] = useState(false);

  const [blocks, setBlocks] = useState([]);

  const [currentSeqIndex, setCurrentSeqIndex] = useState(0);
  const currentSeqRef = useRef(0);
  useEffect(() => { currentSeqRef.current = currentSeqIndex; }, [currentSeqIndex]);

  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const [combo, setCombo] = useState(0);
  const [health, setHealth] = useState(3);
  const healthRef = useRef(3);
  useEffect(() => { healthRef.current = health; }, [health]);

  const [timeLeft, setTimeLeft] = useState(6000); // 60.00 seconds
  const timeLeftRef = useRef(6000);
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);

  const [bestScore, setBestScore] = useState(0);
  useEffect(() => {
    const loaded = parseInt(localStorage.getItem(`verseRainBestScore_${activeVerse.reference}`)) || 0;
    setBestScore(loaded);
  }, [activeVerse]);
  const [isFlawless, setIsFlawless] = useState(false);
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [timeBonus, setTimeBonus] = useState(0);
  const [pureBaseScore, setPureBaseScore] = useState(0);
  const [campaignQueue, setCampaignQueue] = useState(null);
  const [activeCampaignSetId, setActiveCampaignSetId] = useState(null);
  const [activeCampaignSetTotal, setActiveCampaignSetTotal] = useState(0);
  const [showSetLeaderboard, setShowSetLeaderboard] = useState(false);
  const [leaderboardSetId, setLeaderboardSetId] = useState(null);
  const [leaderboardPage, setLeaderboardPage] = useState(0);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [leaderboardTotal, setLeaderboardTotal] = useState(0);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const campaignQueueRef = useRef(null);
  useEffect(() => { campaignQueueRef.current = campaignQueue; }, [campaignQueue]);
  const localCampaignListRef = useRef([]); // full ordered verse list for square_solo mp
  const localVerseIndexRef = useRef(0);    // which verse this player is currently on
  const multiplayerSoloActiveRef = useRef(false); // true once any *_solo game is initialized; prevents re-init on every broadcast
  const [localNextVerse, setLocalNextVerse] = useState(null); // verse shown during intermission countdown
  const [campaignResults, setCampaignResults] = useState([]);

  // ── 多人 *_solo：每位玩家用自己的語言參賽 ──────────────────────────────
  // The host broadcasts verse objects in the host's language, but each verse
  // carries a language-neutral `reference`. In individual/PK (*_solo) modes every
  // player has their OWN board, so we resolve each verse's text into THIS player's
  // own `version` and build their tiles from that. Team/synchronous modes share
  // one board and are left on the host's language. Fallback = the host's text.
  const versionRef = useRef(version);
  useEffect(() => { versionRef.current = version; }, [version]);
  const localizedTextByRefRef = useRef({}); // `${ver}|${normKey}` -> resolved text ('' = unresolvable)
  const [localizedTick, setLocalizedTick] = useState(0); // bumps when a verse finishes localizing (triggers reactive swap)
  const resolveVerseTextForVersion = async (reference, ver, item = null) => {
    if (!reference || !ver) return null;
    // tier 0: 聽&說 bilingual items carry both sides — pick the player's side directly.
    if (isBilingualItem(item)) {
      const side = pickText(item, ver);
      if (side) return side;
    }
    const normKey = normalizeVerseReferenceKey(reference);
    // tier 1: a set already loaded in that language (instant, no network)
    try {
      for (const s of getSetsForVersion(ver)) {
        const hit = (s.verses || []).find(v => normalizeVerseReferenceKey(v.reference) === normKey);
        if (hit?.text) return hit.text;
      }
    } catch { /* ignore */ }
    return null;
  };
  // Freshest localized text for a reference in the player's CURRENT version, else fallback.
  const mpLocalTextFor = (reference, fallback) => {
    if (!reference) return fallback;
    const t = localizedTextByRefRef.current[`${versionRef.current}|${normalizeVerseReferenceKey(reference)}`];
    return (t !== undefined && t !== '') ? t : fallback;
  };
  // 聽&說 labels are language-neutral, so the label needs no localization.
  const mpLocalRefFor = (reference) => reference;
  // Both language sides of a bilingual item, sent alongside verseText so that
  // players in a single-verse room can localize without the campaign queue.
  const verseSidesOf = (v) => (isBilingualItem(v)
    ? { textZh: itemZh(v), textEn: itemEn(v), ...(v?.textCn ? { textCn: v.textCn } : {}) }
    : null);
  // NOTE: the pre-resolve effect lives after the multiplayer state declarations
  // (it depends on multiplayerState / multiplayerRoomId).

  // When activeVerseSets becomes non-empty AND we have a pending startSet
  // from a deep link, fire it once. Sets load asynchronously per language;
  // launching too early would silently fail to find the set.
  useEffect(() => {
    if (!activeVerseSets || activeVerseSets.length === 0) return;
    const pending = sessionStorage.getItem('verserain_pending_start_set');
    if (!pending) return;
    const mode = sessionStorage.getItem('verserain_pending_start_set_mode') === 'play' ? 'play' : 'campaign';
    sessionStorage.removeItem('verserain_pending_start_set');
    sessionStorage.removeItem('verserain_pending_start_set_mode');

    const launch = async () => {
      // launchSetById defined below; safe to call here because the effect
      // closes over the latest definition via dependency on activeVerseSets.
      // eslint-disable-next-line no-use-before-define
      launchSetById(pending, mode).catch(() => {});
    };
    // Chrome mutes speechSynthesis until the page has received at least one
    // real user gesture ("not-allowed"). Deep links land here with zero
    // interaction, so auto-launching would start the game with silent TTS.
    // Show a one-tap "start" gate first — the tap unlocks audio AND launches.
    // If the user has already interacted (in-app navigation), skip the gate.
    if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive) {
      launch();
    } else {
      setDeepLinkStartGate({ run: launch });
    }
    // We intentionally omit launchSetById from deps — it's reconstructed
    // every render via useCallback, and depending on it would re-fire the
    // effect repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVerseSets]);

  // Launch a verse-set campaign by id — used by the Companion Teams modal
  // 「開始挑戰」 button and by ?startSet=<id> deep links. Looks the set up
  // in active+custom, falls back to fetching shared sets. Returns true if
  // launched, false if the set is unknown so the caller can show an error.
  //
  // mode='campaign' → scored, writes to leaderboard, counts toward team
  //                   set-pass / set-attempt points.
  // mode='play'    → autoplay rehearsal (TTS reads verses, no blocks/score),
  //                   purely for familiarization; does NOT affect any
  //                   leaderboard so team progress stays untouched.
  const launchSetById = React.useCallback(async (setId, mode = 'campaign', verseIndex = null, versesOverride = null) => {
    if (!setId) return false;
    let set = activeVerseSets.find(s => s.id === setId) || customVerseSets.find(s => s.id === setId);
    if (!set) {
      try {
        const r = await fetch(`${PARTY_DB}/share-set?id=${encodeURIComponent(setId)}`);
        if (r.ok) {
          const data = await r.json();
          if (data?.set?.verses?.length) set = data.set;
        }
      } catch { /* fall through to false */ }
    }
    // Last resort: caller already has a verses snapshot (e.g. recipient
    // of a team share link — their bible version may not load that set).
    if (!set?.verses?.length && Array.isArray(versesOverride) && versesOverride.length > 0) {
      set = { id: setId, title: setId, verses: versesOverride };
    }
    if (!set?.verses?.length) return false;
    initAudio();
    // When verseIndex is given (per-day reading model), queue just that one
    // verse. Otherwise fall back to the whole set (back-compat for any
    // legacy callers — there should be none in normal flow).
    const queue = (typeof verseIndex === 'number' && verseIndex >= 0 && verseIndex < set.verses.length)
      ? [set.verses[verseIndex]]
      : [...set.verses];
    setSelectedSetId(set.id);
    setCampaignQueue(queue.slice(1));
    campaignQueueRef.current = queue.slice(1);
    setCampaignResults([]);
    // We don't use the legacy /api/submit-set-score path for team plays
    // anymore (every verse is its own day-completion event reported via
    // PartyKit). Keep activeCampaignSetId null so submit-set-score's
    // gate-effect doesn't fire.
    setActiveCampaignSetId(null);
    setActiveCampaignSetTotal(0);
    setActiveVerse(queue[0]);
    setSelectedVerseRefs([queue[0].reference]);
    setTimeout(() => startGame(mode === 'play', queue[0]), 200);
    return true;
    // playMode + distractionLevel are dependencies because startGame
    // closes over both — without them the team-launched closure stays
    // pinned to whatever playMode/distractionLevel was when the first
    // render created it, which made 內容雨 silently launch square mode
    // (block stuck at top-left under the rain background).
  }, [activeVerseSets, customVerseSets, playMode, distractionLevel]);
  // startGame() and the block builder used to read playMode / distractionLevel
  // straight off state, so any DEFERRED start (a challenge confirmed in a
  // modal, a team launch) ran with whatever the closure captured before the
  // new settings committed. That is the bug the team-launch dependency array
  // below documents: 內容雨 silently launching as square mode. These refs are
  // written synchronously the moment a mode is chosen, so the start path
  // never depends on React having flushed. Reads during play/render still use
  // the state — those re-run on the next render anyway.
  const playModeRef = useRef(playMode);
  const distractionLevelRef = useRef(distractionLevel);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);
  useEffect(() => { distractionLevelRef.current = distractionLevel; }, [distractionLevel]);
  const [isBlindMode, setIsBlindMode] = useState(() => localStorage.getItem('verseRain_blindMode') === 'true');
  // Debug mode — persisted in localStorage, also toggleable from the ⚡ 挑戰
  // chooser so a phone user can flip on the voice-mode "expects vs heard" HUD
  // without dev tools.
  const [isDebugMode, setIsDebugMode] = useState(() => localStorage.getItem('verseRain_debugMode') === 'true');
  // Voice Mode: skip the "repeat the phrase you just recited" TTS beat.
  const [skipReadback, setSkipReadback] = useState(() => localStorage.getItem('verseRain_noReadback') === 'true');

  // ─── Challenge setup modal ────────────────────────────────────────────
  // Every single-player 挑戰 button opens this instead of relying on a pair of
  // <select>s parked in a toolbar. `run` is whatever that particular button
  // used to do on click; it is deferred until the player confirms.
  const [challengeSetup, setChallengeSetup] = useState(null); // { subtitle, run, value }

  const openChallengeSetup = ({ subtitle, run }) => {
    setChallengeSetup({ subtitle: subtitle || '', run, value: loadChallengeSetup() });
  };

  const confirmChallengeSetup = (v) => {
    // initAudio() has to happen inside a real tap for iOS to grant audio —
    // the modal's Start button is that tap now, not the original button.
    initAudio();
    // Written synchronously: the start path reads these refs, so it sees the
    // chosen mode even though setState has not flushed yet.
    playModeRef.current = v.mode;
    distractionLevelRef.current = v.difficulty;
    setPlayMode(v.mode);
    setDistractionLevel(v.difficulty);
    setIsDebugMode(v.debug);
    setSkipReadback(v.noReadback);
    const run = challengeSetup?.run;
    setChallengeSetup(null);
    if (typeof run === 'function') run(v);
  };

  const [lightningActive, setLightningActive] = useState(null);
  const [lightningKey, setLightningKey] = useState(0);

  const triggerLightning = React.useCallback((type) => {
    // Lightning visually disabled to reduce distraction
    return;
  }, []);  // Leaderboard specific state
  const [leaderboard, setLeaderboard] = useState({ alltime: [], monthly: [], daily: [] });
  const [isSubmittingScore, setIsSubmittingScore] = useState(false);
  const [leaderboardTab, setLeaderboardTab] = useState('alltime');

  // Menu Leaderboard Modal
  const [leaderboardModalVerse, setLeaderboardModalVerse] = useState(null);
  const [leaderboardModalData, setLeaderboardModalData] = useState({ alltime: [], monthly: [], daily: [] });
  const [leaderboardModalTab, setLeaderboardModalTab] = useState('alltime'); // 'daily', 'monthly', 'alltime'
  const [isFetchingLeaderboard, setIsFetchingLeaderboard] = useState(false);
  const [mainTab, setMainTab] = useState(() => parseRoute(window.location.hash).tab);
  const [mapView, setMapView] = useState('2d');   // 地圖 2D/3D 切換
  const [mapFocus, setMapFocus] = useState(null);  // 3D→2D 切換時帶入的焦點座標
  const [bilingualRainActive, setBilingualRainActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search pages when query changes
  useEffect(() => {
    setSearchSetsPage(1);
    setSearchVersesPage(1);
  }, [searchQuery]);
  const [globalLeaderboardData, setGlobalLeaderboardData] = useState({ alltime: [], monthly: [], daily: [] });
  const [isFetchingGlobalLeaderboard, setIsFetchingGlobalLeaderboard] = useState(false);
  const [globalLeaderboardTab, setGlobalLeaderboardTab] = useState('daily');
  const [pageGlobalLeaderboard, setPageGlobalLeaderboard] = useState(1);
  const [pagePopularSets, setPagePopularSets] = useState(1);
  const [pagePopularVerses, setPagePopularVerses] = useState(1);
  const [globalLeaderboardPage, setGlobalLeaderboardPage] = useState(1);

  const fetchGlobalLeaderboard = () => {
    setIsFetchingGlobalLeaderboard(true);
    Promise.all([
      fetch('/api/get-all-scores').then(res => res.ok ? res.json() : {}).catch(() => ({})),
      fetch('/api/get-top-verses').then(res => res.ok ? res.json() : {}).catch(() => ({})),
      fetch(`${PARTY_DB}/all-gardens`).then(r => r.ok ? r.json() : { fruitsMap: {} }).catch(() => ({ fruitsMap: {} }))
    ])
      .then(([scoresData, versesData, gardensData]) => {
        const parsed = scoresData && Array.isArray(scoresData.alltime) ? scoresData : { alltime: Array.isArray(scoresData) ? scoresData : [], monthly: [], daily: [] };
        // Preserve bonusFruitsMap for level calculation
        if (scoresData && scoresData.bonusFruitsMap) parsed.bonusFruitsMap = scoresData.bonusFruitsMap;
        setGlobalLeaderboardData(parsed);
        // Populate globalFruitsMap for leaderboard Lv. display
        if (gardensData && gardensData.fruitsMap) {
          setGlobalFruitsMap(gardensData.fruitsMap);
        }
        if (versesData && versesData.alltime) {
          // Merge server stats INTO local stats (don't replace — local history must be preserved)
          setGlobalVerseStats(prev => {
            const merged = {
              alltime: { ...(versesData.alltime || {}), ...(prev.alltime || {}) },
              monthly: { ...(versesData.monthly || {}), ...(prev.monthly || {}) },
              daily: { ...(versesData.daily || {}), ...(prev.daily || {}) },
              dateInfo: prev.dateInfo, monthInfo: prev.monthInfo
            };
            return merged;
          });
        }
      })
      .finally(() => setIsFetchingGlobalLeaderboard(false));
  };
  const [showLoginModal, setShowLoginModal] = useState(null);

  // Header language picker — grid/table layout so all 15+ languages are
  // visible at once instead of buried in a scroll-cropped <select>.
  const [showLangPicker, setShowLangPicker] = useState(false);
  const langPickerRef = useRef(null);
  useEffect(() => {
    if (!showLangPicker) return undefined;
    const close = (e) => {
      if (!langPickerRef.current?.contains(e.target)) setShowLangPicker(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [showLangPicker]);
  const [verifyEmail, setVerifyEmail] = useState("");

  // ─── OAuth (Google / Apple / LINE) ────────────────────────────────────────
  // Hand the provider's credential to the PartyKit /oauth-login endpoint,
  // which verifies it (ID token signature, or access token via Google's
  // userinfo endpoint), then matches by email or auto-creates a verified
  // user. No password is needed because the OAuth provider has already
  // verified the email.
  const handleOAuthSignIn = React.useCallback(async (provider, credential) => {
    setAuthError("");
    setAuthLoading(true);
    try {
      const host = PARTY_DB;
      // Forward the referral code from localStorage so the backend can bind
      // the inviter to this account — see [App.jsx:5060] reward flow.
      const inviter = localStorage.getItem('verserain_inviter') || undefined;
      const response = await fetch(host + '/oauth-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, inviter, ...credential })
      });
      const data = await response.json().catch(() => ({}));

      if (!(response.ok && data.success && data.user)) {
        setAuthError(data.error || t("OAuth 登入失敗", "OAuth sign-in failed"));
        return;
      }

      const user = data.user;
      const displayName = user.name || (user.email || '').split('@')[0];
      const prevEmail = localStorage.getItem('verserain_player_email');
      if (prevEmail && prevEmail !== user.email) {
        localStorage.removeItem('verseRain_gardenData');
        setGardenData({});
      }
      const isPrem = !!user.isPremium;
      setPlayerName(user.name || displayName);
      setUserEmail(user.email);
      setIsPremium(isPrem);
      localStorage.setItem('verserain_player_name', user.name || displayName);
      localStorage.setItem('verserain_player_email', user.email);
      localStorage.setItem('verserain_is_premium', isPrem ? 'true' : 'false');
      // Remember this is an OAuth (Google/Apple/LINE) login → these accounts
      // have no password, so the profile editor hides the password fields and
      // saves without one (the server allows password-less updates for them).
      localStorage.setItem('verserain_auth_provider', user.oauthProvider || provider || 'oauth');
      if (user.personalCode) adoptAccountPersonalCode(user.personalCode);
      if (user.city) localStorage.setItem('verserain_custom_city', user.city);
      if (user.country) localStorage.setItem('verserain_custom_country', user.country);
      // Cross-device referral: the server is the source of truth for
      // invitedBy. Until the reward is claimed on some device, prefer the
      // server's value over whatever this WebView has cached — older
      // versions could leave stale or self-referencing inviter codes in
      // localStorage that would otherwise be sticky forever (the "我的推薦
      // 人 顯示成自己" class of bug).
      if (!localStorage.getItem('verserain_invite_claimed')) {
        const ownCode = localStorage.getItem('verserain_personal_code');
        if (user.invitedBy && user.invitedBy !== ownCode) {
          localStorage.setItem('verserain_inviter', user.invitedBy);
        }
      }
      setShowLoginModal(null);
    } catch (err) {
      setAuthError(t("OAuth 連線失敗", "OAuth connection failed"));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const [verseViewModal, setVerseViewModal] = useState(null);
  // Single-verse voice chooser — when a verse has MORE THAN ONE recording
  // (the set author's + public contributors'), tapping 🎧 opens this so the
  // listener can pick whose voice to hear. { setId, reference, text, vLang,
  // options:[{kind:'owner'|'personal', ownerId?, recordedBy, voiceId, voiceMime, mine?}], loading }.
  const [verseVoicePicker, setVerseVoicePicker] = useState(null);
  // 錄音留言 — comments attached to ONE recording. Panel target:
  // { setId, reference, targetOwnerId, recordedBy, mine }. Data + composer state.
  const [voiceCommentPanel, setVoiceCommentPanel] = useState(null);
  const [voiceCommentData, setVoiceCommentData] = useState(null); // { comments, recordingReactions } | null(loading)
  const [voiceCommentText, setVoiceCommentText] = useState('');
  const [voiceCommentBusy, setVoiceCommentBusy] = useState(false);
  const [commentRecTarget, setCommentRecTarget] = useState(null); // opens VerseVoiceRecorder for an audio comment
  // 💬/❤️ badge counts for the picker rows, keyed `${reference}||${ownerId}`.
  const [voiceCommentCounts, setVoiceCommentCounts] = useState({});
  // 鼓勵收件匣 — the logged-in user's own inbox (by their ownerId).
  const [encourageInbox, setEncourageInbox] = useState(null); // { items, lastReadAt } | null
  const [showEncouragePanel, setShowEncouragePanel] = useState(false);
  const [myVoiceOwnerId, setMyVoiceOwnerId] = useState(null);
  // 創作者親聲朗讀 in the verse view modal — when the verse came from a set
  // with a creator recording, the 朗讀 button plays it instead of TTS.
  const verseModalAudioRef = useRef(null);
  const setVoicesLookupRef = useRef(new globalThis.Map());      // setId → { reference: meta }
  const setVoiceAudioLookupRef = useRef(new globalThis.Map());  // voiceId → data URL

  // When the creator leaves the set editor, drop the cached recordings for
  // that set (both the playback lookup and the detail-page ⭐ map) so verses
  // recorded during the session are visible immediately — not stale until a
  // full app reload. Recordings persist server-side keyed by (setId, ref);
  // only these client caches were going stale.
  const prevEditingSetIdRef = useRef(null);
  useEffect(() => {
    const cur = editingCustomSet?.id || null;
    const prev = prevEditingSetIdRef.current;
    prevEditingSetIdRef.current = cur;
    if (prev && !cur) {
      setVoicesLookupRef.current.delete(prev);
      setVoiceRefreshTick(x => x + 1);
    }
  }, [editingCustomSet?.id]);

  const stopVerseModalAudio = () => {
    try { verseModalAudioRef.current?.pause(); } catch { /* noop */ }
    verseModalAudioRef.current = null;
  };

  // Play the creator's recording for (setId, reference) if one exists;
  // returns false so the caller can fall back to TTS.
  const playSetVerseVoice = async (setId, reference) => {
    if (!setId || !reference) return false;
    try {
      let voices = setVoicesLookupRef.current.get(setId);
      if (!voices) {
        const res = await setVoiceApi.getAll(setId);
        voices = res?.voices || {};
        setVoicesLookupRef.current.set(setId, voices);
      }
      const rec = voices[reference];
      if (!rec?.voiceId) return false;
      let dataUrl = setVoiceAudioLookupRef.current.get(rec.voiceId);
      if (!dataUrl) {
        const res = await setVoiceApi.getAudio(setId, rec.voiceId);
        if (!res?.data) return false;
        dataUrl = `data:${rec.voiceMime || 'audio/webm'};base64,${res.data}`;
        setVoiceAudioLookupRef.current.set(rec.voiceId, dataUrl);
      }
      stopSpeechIfActive();
      stopVerseModalAudio();
      const audio = new Audio(dataUrl);
      verseModalAudioRef.current = audio;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  };

  // Collect every recording available for (setId, reference): the set author's
  // (creator layer) plus each public contributor's (personal layer). Used by the
  // single-verse 🎧 to decide between "just play" and "let the listener choose".
  const gatherVerseVoiceOptions = async (setId, reference) => {
    const options = [];
    if (!setId || !reference) return options;
    try {
      let ownerVoices = setVoicesLookupRef.current.get(setId);
      if (!ownerVoices) {
        const res = await setVoiceApi.getAll(setId);
        ownerVoices = res?.voices || {};
        setVoicesLookupRef.current.set(setId, ownerVoices);
      }
      const ownerRec = ownerVoices[reference];
      if (ownerRec?.voiceId) {
        // ownerId (author's byOwnerId) lets recording-comments target this
        // recording the same way they target contributors.
        options.push({ kind: 'owner', ownerId: ownerRec.byOwnerId || null, recordedBy: ownerRec.recordedBy || '', voiceId: ownerRec.voiceId, voiceMime: ownerRec.voiceMime });
      }
      const cres = await userVoiceApi.getContributors(setId).catch(() => null);
      const contributors = cres?.contributors || [];
      const mineId = userEmail ? await voiceOwnerId(userEmail).catch(() => null) : null;
      for (const c of contributors) {
        const vres = await userVoiceApi.getAll(setId, c.ownerId).catch(() => null);
        const rec = vres?.voices?.[reference];
        if (rec?.voiceId) {
          options.push({ kind: 'personal', ownerId: c.ownerId, recordedBy: c.recordedBy || rec.recordedBy || '', voiceId: rec.voiceId, voiceMime: rec.voiceMime, mine: !!(mineId && c.ownerId === mineId) });
        }
      }
    } catch { /* best-effort — fall back to whatever we gathered */ }
    return options;
  };

  // Play one gathered option's audio (owner or personal share alike live in the
  // shared set-voice store keyed by setId). Returns false so callers can TTS.
  const playVerseVoiceOption = async (setId, opt) => {
    if (!opt?.voiceId) return false;
    try {
      let dataUrl = setVoiceAudioLookupRef.current.get(opt.voiceId);
      if (!dataUrl) {
        const res = await setVoiceApi.getAudio(setId, opt.voiceId);
        if (!res?.data) return false;
        dataUrl = `data:${opt.voiceMime || 'audio/webm'};base64,${res.data}`;
        setVoiceAudioLookupRef.current.set(opt.voiceId, dataUrl);
      }
      stopSpeechIfActive();
      stopVerseModalAudio();
      const audio = new Audio(dataUrl);
      verseModalAudioRef.current = audio;
      await audio.play();
      return true;
    } catch {
      return false;
    }
  };

  // ── 錄音留言 helpers ────────────────────────────────────────────────
  // Open the comments panel for one recording (a picker option). Only real
  // recordings (owner/personal with an ownerId) can carry comments — TTS can't.
  const openVoiceComments = async (setId, reference, opt) => {
    if (!opt?.ownerId) return;
    const panel = { setId, reference, targetOwnerId: opt.ownerId, recordedBy: opt.recordedBy || '', mine: !!opt.mine };
    setVoiceCommentPanel(panel);
    setVoiceCommentData(null);
    setVoiceCommentText('');
    try {
      const res = await voiceCommentApi.list(setId, reference, opt.ownerId);
      setVoiceCommentData({ comments: res?.comments || [], recordingReactions: res?.recordingReactions || [] });
    } catch {
      setVoiceCommentData({ comments: [], recordingReactions: [] });
    }
  };
  // Called by the continuous player's 💬 — opens the comment panel for the
  // recording currently being read.
  const openVoiceCommentsFromPlayer = (target) => {
    if (!target?.targetOwnerId) return;
    openVoiceComments(target.setId, target.reference, { ownerId: target.targetOwnerId, recordedBy: target.recordedBy, mine: target.mine });
  };
  const refreshVoiceComments = async (panel = voiceCommentPanel) => {
    if (!panel) return;
    try {
      const res = await voiceCommentApi.list(panel.setId, panel.reference, panel.targetOwnerId);
      setVoiceCommentData({ comments: res?.comments || [], recordingReactions: res?.recordingReactions || [] });
    } catch { /* keep prior */ }
  };
  const submitTextComment = async () => {
    const panel = voiceCommentPanel;
    const body = voiceCommentText.trim();
    if (!panel || !body || !userEmail) return;
    setVoiceCommentBusy(true);
    try {
      await voiceCommentApi.createText(userEmail, recordedByNameApp(), panel.setId, panel.reference, panel.targetOwnerId, body);
      setVoiceCommentText('');
      await refreshVoiceComments(panel);
    } catch (e) { console.error('comment failed', e); }
    setVoiceCommentBusy(false);
  };
  const deleteVoiceComment = async (cid) => {
    const panel = voiceCommentPanel;
    if (!panel || !userEmail) return;
    try {
      await voiceCommentApi.remove(userEmail, recordedByNameApp(), panel.setId, panel.reference, panel.targetOwnerId, cid);
      await refreshVoiceComments(panel);
    } catch (e) { console.error('delete comment failed', e); }
  };
  const reactVoiceComment = async (cid, emoji) => {
    const panel = voiceCommentPanel;
    if (!panel || !userEmail) return;
    try {
      await voiceCommentApi.reactComment(userEmail, panel.setId, panel.reference, panel.targetOwnerId, cid, emoji);
      await refreshVoiceComments(panel);
    } catch (e) { console.error('react comment failed', e); }
  };
  const likeRecording = async (emoji) => {
    const panel = voiceCommentPanel;
    if (!panel || !userEmail) return;
    try {
      await voiceCommentApi.reactRecording(userEmail, recordedByNameApp(), panel.setId, panel.reference, panel.targetOwnerId, emoji);
      await refreshVoiceComments(panel);
    } catch (e) { console.error('like recording failed', e); }
  };
  // Play a voice-comment's audio (same content-addressed store as recordings).
  const playCommentAudio = async (setId, voiceId, mime) => {
    try {
      let dataUrl = setVoiceAudioLookupRef.current.get(voiceId);
      if (!dataUrl) {
        const res = await setVoiceApi.getAudio(setId, voiceId);
        if (!res?.data) return;
        dataUrl = `data:${mime || 'audio/webm'};base64,${res.data}`;
        setVoiceAudioLookupRef.current.set(voiceId, dataUrl);
      }
      stopSpeechIfActive();
      stopVerseModalAudio();
      const audio = new Audio(dataUrl);
      verseModalAudioRef.current = audio;
      await audio.play();
    } catch { /* ignore */ }
  };
  const recordedByNameApp = () => playerName || (userEmail || '').split('@')[0] || 'Anonymous';

  // My recorder id + encouragement inbox (for the 🔔 badge). Refetched on login.
  useEffect(() => {
    let cancelled = false;
    if (!userEmail) { setMyVoiceOwnerId(null); setEncourageInbox(null); return undefined; }
    (async () => {
      const oid = await voiceOwnerId(userEmail).catch(() => null);
      if (cancelled) return;
      setMyVoiceOwnerId(oid);
      if (oid) {
        const res = await voiceCommentApi.getEncouragement(oid).catch(() => null);
        if (!cancelled && res) setEncourageInbox({ items: res.items || [], lastReadAt: res.lastReadAt || '' });
      }
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

  // 💬/❤️ counts for the recording picker rows, fetched once per open.
  useEffect(() => {
    if (!verseVoicePicker?.setId) return undefined;
    let cancelled = false;
    voiceCommentApi.getCounts(verseVoicePicker.setId)
      .then(res => { if (!cancelled && res?.counts) setVoiceCommentCounts(res.counts); })
      .catch(() => { /* badges are optional */ });
    return () => { cancelled = true; };
  }, [verseVoicePicker]);

  const [toast, setToast] = useState(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  const [qrShareModal, setQrShareModal] = useState(null); // { url, reference }
  const [multiplayerRoomId, setMultiplayerRoomId] = useState(null);
  const [multiplayerRoomMode, setMultiplayerRoomMode] = useState(null);
  const [multiplayerRoomRole, setMultiplayerRoomRole] = useState('player');
  const [multiplayerTeamCount, setMultiplayerTeamCount] = useState(4);
  const [multiplayerHostPlays, setMultiplayerHostPlays] = useState(false); // team host also competes
  const [wsConnected, setWsConnected] = useState(false);
  const geoRef = useRef(null); // cached IP geolocation
  const [showMultiplayerVersePicker, setShowMultiplayerVersePicker] = useState(false);
  const [pickerSelectedSet, setPickerSelectedSet] = useState(null);
  const [multiplayerPlayMode, setMultiplayerPlayMode] = useState('square_solo');
  const [flyingBlocks, setFlyingBlocks] = useState([]);
  const [multiplayerDistractionLevel, setMultiplayerDistractionLevel] = useState(0);

  // Voice Control State
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => {
    try {
      const byVersion = JSON.parse(localStorage.getItem('verseRain_voiceByVersion') || '{}');
      const v = localStorage.getItem('verseRain_version') || 'cuv';
      return byVersion?.[v] || localStorage.getItem('verseRain_voiceName') || '';
    } catch (e) {
      return localStorage.getItem('verseRain_voiceName') || '';
    }
  });
  const langPrefixForVersion = (v) => (isEnglishBibleVersion(v) ? 'en' : 'zh');
  const filteredVoicesForVersion = dedupeVoices(availableVoices.filter(vc => (vc.lang || '').toLowerCase().startsWith(langPrefixForVersion(version))));
  // Deduped + disambiguated display options for the voice <select> (fixes the
  // duplicate "Chinese Hong Kong" entries on Android).
  const voiceOptionsForVersion = buildVoiceOptions(filteredVoicesForVersion, { cloudLabel: '☁️' });
  // The <select> value must equal one of the option ids. selectedVoiceName may
  // be a legacy "name__lang" key, so resolve it to the matching option's id.
  const selectedVoiceOptionId = (() => {
    if (!selectedVoiceName) return '';
    const match = voiceOptionsForVersion.find(o => voiceMatchesSavedKey(o.voice, selectedVoiceName));
    return match ? match.id : '';
  })();
  const saveVoiceForVersion = (voiceName) => {
    try {
      const byVersion = JSON.parse(localStorage.getItem('verseRain_voiceByVersion') || '{}');
      if (voiceName) {
        byVersion[version] = voiceName;
        localStorage.setItem('verseRain_voiceName', voiceName); // backward compatibility
      } else {
        delete byVersion[version];
        localStorage.removeItem('verseRain_voiceName');
      }
      localStorage.setItem('verseRain_voiceByVersion', JSON.stringify(byVersion));
      setSelectedVoiceName(voiceName || '');
      setToast(t('語音已更新！', 'Voice updated!'));
      setTimeout(() => setToast(null), 1000);
    } catch (e) {}
  };
  useEffect(() => {
    try {
      const byVersion = JSON.parse(localStorage.getItem('verseRain_voiceByVersion') || '{}');
      setSelectedVoiceName(byVersion?.[version] || localStorage.getItem('verseRain_voiceName') || '');
    } catch (e) {
      setSelectedVoiceName(localStorage.getItem('verseRain_voiceName') || '');
    }
  }, [version]);
  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        setAvailableVoices(window.speechSynthesis.getVoices());
      }
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    }
  }, []);
  const [isMicOn, setIsMicOn] = useState(false);
  const [micStatusText, setMicStatusText] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const recognitionRef = useRef(null);
  const isMicOnRef = useRef(isMicOn);
  const phrasesRef = useRef(activePhrases);
  const currentSeqIndexRef = useRef(currentSeqIndex);
  const blocksRef = useRef(blocks);
  const statusRef = useRef(gameState);
  const handleBlockClickRef = useRef();

  // Keep refs updated for SpeechRecognition closure
  useEffect(() => {
    isMicOnRef.current = isMicOn;
    phrasesRef.current = activePhrases;
    currentSeqIndexRef.current = currentSeqIndex;
    blocksRef.current = blocks;
    statusRef.current = gameState;
  }, [isMicOn, activePhrases, currentSeqIndex, blocks, gameState]);
  const [multiplayerSelectedVerses, setMultiplayerSelectedVerses] = useState([]);
  const [randomPickCount, setRandomPickCount] = useState(1);
  const [continuousRainSet, setContinuousRainSet] = useState(null);
  // 播放順序選擇 — holds the set while the user picks 隨機 or 按序.
  const [playOrderChooser, setPlayOrderChooser] = useState(null);
  const [playDurationChoice, setPlayDurationChoice] = useState(() => {
    try {
      return localStorage.getItem('verseRainPlayDuration') || DEFAULT_PLAY_DURATION_CHOICE;
    } catch {
      return DEFAULT_PLAY_DURATION_CHOICE;
    }
  });
  const selectedPlayDuration = PLAY_DURATION_OPTIONS.find(option => option.value === playDurationChoice) || PLAY_DURATION_OPTIONS[1];
  useEffect(() => {
    try {
      localStorage.setItem('verseRainPlayDuration', selectedPlayDuration.value);
    } catch {
      // Ignore storage failures; playback can still use the in-memory choice.
    }
  }, [selectedPlayDuration.value]);
  const [playFontChoice, setPlayFontChoice] = useState(() => {
    try {
      return localStorage.getItem('verseRainPlayFontSize') || DEFAULT_PLAY_FONT_CHOICE;
    } catch {
      return DEFAULT_PLAY_FONT_CHOICE;
    }
  });
  const selectedPlayFont = PLAY_FONT_OPTIONS.find(option => option.value === playFontChoice) || PLAY_FONT_OPTIONS[2];
  useEffect(() => {
    try {
      localStorage.setItem('verseRainPlayFontSize', selectedPlayFont.value);
    } catch {
      // Ignore storage failures; playback can still use the in-memory choice.
    }
  }, [selectedPlayFont.value]);
  // Play-time voice source: null = auto (my voice › author › TTS). Otherwise
  // { type:'tts'|'owner'|'personal', ownerId?, label }. Chosen in the 播放方式
  // modal; threaded onto continuousRainSet as sharedVoiceOwner/forceTTS/
  // forceOwnerLayer, which the player's override machinery already understands.
  const [voiceChoice, setVoiceChoice] = useState(null);
  // Fetched when the modal opens: { contributors:[{ownerId,recordedBy,count}],
  // ownerHasVoice, ownerName, mineId }. null while loading / no set.
  const [voiceOptions, setVoiceOptions] = useState(null);
  useEffect(() => {
    if (!playOrderChooser?.id) { setVoiceOptions(null); setVoiceChoice(null); return undefined; }
    let cancelled = false;
    setVoiceOptions(null);
    setVoiceChoice(null);
    const setId = playOrderChooser.voiceSetId || playOrderChooser.id;
    (async () => {
      const [contribRes, ownerRes, mineId] = await Promise.all([
        userVoiceApi.getContributors(setId).catch(() => null),
        setVoiceApi.getAll(setId).catch(() => null),
        userEmail ? voiceOwnerId(userEmail).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const contributors = contribRes?.contributors || [];
      const ownerVoices = ownerRes?.voices || {};
      const ownerHasVoice = Object.keys(ownerVoices).length > 0;
      const ownerName = ownerHasVoice ? (Object.values(ownerVoices)[0]?.recordedBy || '') : '';
      setVoiceOptions({ contributors, ownerHasVoice, ownerName, mineId });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playOrderChooser, userEmail]);
  const startContinuousPlay = (set, order) => {
    if (!set?.verses?.length) return;
    const vc = voiceChoice;
    setPlayOrderChooser(null);
    setContinuousRainSet({
      id: set.id,
      title: set.title,
      verses: set.verses,
      playOrder: order, // 'random' | 'sequential' — both loop forever
      playDurationMinutes: selectedPlayDuration.minutes,
      fontSizeLevel: selectedPlayFont.value,
      startVerse: order === 'sequential' ? set.verses[0] : undefined,
      voiceSetId: set.voiceSetId || null,
      background: set.background || '',
      backgroundMime: set.backgroundMime || '',
      bgMusic: set.bgMusic || '',
      bgMusicMime: set.bgMusicMime || '',
      bgMusicVolume: set.bgMusicVolume,
      // Voice source (see voiceChoice). A contributor pick rides the existing
      // sharedVoiceOwner path; TTS / author use the two force flags.
      sharedVoiceOwner: vc?.type === 'personal' ? vc.ownerId : (set.sharedVoiceOwner || null),
      forceTTS: vc?.type === 'tts',
      forceOwnerLayer: vc?.type === 'owner',
    });
  };
  const [multiplayerSearchText, setMultiplayerSearchText] = useState('');
  const [showPickerBrowser, setShowPickerBrowser] = useState(false);

  const multiplayerRoomRef = useRef(multiplayerRoomId);
  useEffect(() => { multiplayerRoomRef.current = multiplayerRoomId; }, [multiplayerRoomId]);

  // Submit location immediately when room changes (join/leave/game-over)
  useEffect(() => {
    const name = playerNameRef.current;
    if (!name) return;
    const activeRoomId = multiplayerRoomId; // null when leaving
    const doSubmit = (geo) => {
      fetch('/api/submit-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          score: 0,
          lat: parseFloat(geo.latitude),
          lng: parseFloat(geo.longitude),
          country: localStorage.getItem('verserain_custom_country') || geo.country_name || geo.country || '',
          city: localStorage.getItem('verserain_custom_city') || geo.city || '',
          verseRef: '',
          roomId: activeRoomId || null
        })
      }).catch(() => { });
    };
    if (geoRef.current) {
      doSubmit(geoRef.current);
    } else {
      // Try multiple geo services with fallback
      const tryGeo = async () => {
        const services = [
          async () => { const r = await fetch('https://ipapi.co/json/'); const d = await r.json(); if (d?.latitude) return { latitude: d.latitude, longitude: d.longitude, country_name: d.country_name, city: d.city }; throw new Error('no data'); },
          async () => { const r = await fetch('https://ip-api.com/json/?fields=lat,lon,country,city,status'); const d = await r.json(); if (d?.status === 'success') return { latitude: d.lat, longitude: d.lon, country_name: d.country, city: d.city }; throw new Error('no data'); },
        ];
        for (const svc of services) {
          try { 
            const geo = await svc(); 
            const customLat = localStorage.getItem('verserain_custom_lat');
            const customLng = localStorage.getItem('verserain_custom_lng');
            if (customLat && customLng) {
              geo.latitude = customLat;
              geo.longitude = customLng;
            }
            geoRef.current = geo; 
            doSubmit(geo); 
            return; 
          } catch { }
        }
      };
      tryGeo();
    }
  }, [multiplayerRoomId]);

  const [multiplayerState, setMultiplayerState] = useState(null);
  const [myClientId, setMyClientId] = useState(null);
  // Pre-resolve the whole *_solo queue into the player's version (during ready-check),
  // so each verse can start in their own language without a mid-round fetch hitch.
  // (Placed here because it depends on multiplayerState / multiplayerRoomId.)
  useEffect(() => {
    const st = multiplayerState;
    if (!multiplayerRoomId || !st?.playMode?.endsWith('_solo')) return undefined;
    const queue = (st.campaignQueue && st.campaignQueue.length)
      ? st.campaignQueue
      : (st.verseRef ? [{ reference: st.verseRef, text: st.verseText, ...(st.verseSides || {}) }] : []);
    if (!queue.length) return undefined;
    let cancelled = false;
    (async () => {
      for (const v of queue) {
        if (cancelled) return;
        if (!v?.reference) continue;
        const cacheKey = `${version}|${normalizeVerseReferenceKey(v.reference)}`;
        if (localizedTextByRefRef.current[cacheKey] !== undefined) continue;
        const text = await resolveVerseTextForVersion(v.reference, version, v);
        if (cancelled) return;
        localizedTextByRefRef.current[cacheKey] = text || '';
        if (text) setLocalizedTick(n => n + 1); // wake the reactive swap below
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiplayerState?.campaignQueue, multiplayerState?.playMode, multiplayerRoomId, version]);
  // On slow (mobile) networks the localized text can arrive AFTER a *_solo verse
  // already started in the host's language. When it lands (localizedTick) and we're
  // still at the very start of the current verse, swap it in and rebuild the board
  // so the player sees their own language. Guarded to seqIndex 0 to avoid yanking
  // the board out from under a player who's already begun.
  useEffect(() => {
    if (!multiplayerRoomId || !multiplayerState?.playMode?.endsWith('_solo')) return;
    if (gameState !== 'playing' || !activeVerse?.reference) return;
    if (currentSeqRef.current !== 0) return;
    const localized = mpLocalTextFor(activeVerse.reference, null);
    if (!localized || localized === activeVerse.text) return;
    const verseObj = { ...activeVerse, text: localized };
    setActiveVerse(verseObj);
    if (multiplayerState.playMode === 'square_solo') {
      initSquareBlocks(false, null, verseObj);
    } else if (multiplayerState.playMode === 'rain_solo') {
      setBlocks([]); // upcoming spawns read the now-localized activePhrases
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localizedTick, gameState, activeVerse?.reference, multiplayerRoomId]);
  const [intermissionCountdown, setIntermissionCountdown] = useState(0);
  const [intermissionEndsAt, setIntermissionEndsAt] = useState(null);
  const [joinRoomError, setJoinRoomError] = useState(null);
  const joinRoomTimeoutRef = useRef(null);
  const isGuestJoinRef = useRef(false);

  const startLocalIntermissionCountdown = (seconds) => {
    const duration = Math.max(1, Number(seconds) || 1);
    setIntermissionCountdown(duration);
    setIntermissionEndsAt(Date.now() + duration * 1000);
  };

  useEffect(() => {
    if (gameState !== 'intermission' || !intermissionEndsAt) return;
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((intermissionEndsAt - Date.now()) / 1000));
      setIntermissionCountdown(remaining);
      if (remaining === 0) setIntermissionEndsAt(null);
    };
    updateCountdown();
    const timer = setInterval(updateCountdown, 200);
    return () => clearInterval(timer);
  }, [gameState, intermissionEndsAt]);

  useEffect(() => {
    if (gameState === 'intermission' && intermissionCountdown === 0 && intermissionEndsAt === null) {
      // square_solo: each player advances to their next verse independently
      if (multiplayerRoomId && multiplayerState?.playMode?.endsWith('_solo') && localNextVerse) {
        // Resolve this next verse into the player's own language (falls back to host text).
        const nextText = mpLocalTextFor(localNextVerse.reference, localNextVerse.text);
        const verseObj = { reference: localNextVerse.reference, text: nextText, title: 'Multiplayer' };
        setActiveVerse(verseObj);
        setCurrentSeqIndex(0);
        currentSeqRef.current = 0;
        setScore(0);
        setCombo(0);
        setHealth(3);
        const phraseCount = splitVersePhrases(nextText).length;
        setTimeLeft(500 + phraseCount * 500);
        setLocalNextVerse(null);
        setGameState('playing');
        if (multiplayerState.playMode === 'square_solo') {
          initSquareBlocks(false, null, verseObj);
        } else if (multiplayerState.playMode === 'rain_solo') {
          setBlocks([]);
          const spawnWhenReady = () => {
            if (activePhrasesRef.current.length > 0) {
              setTimeout(spawnNextBlock, 100);
              setTimeout(spawnNextBlock, 900);
              setTimeout(spawnNextBlock, 1700);
              setTimeout(spawnNextBlock, 2500);
              setTimeout(spawnNextBlock, 3300);
            } else if (gameStateRef.current === 'playing') {
              setTimeout(spawnWhenReady, 100);
            }
          };
          spawnWhenReady();
        }
      } else if (multiplayerState?.host === myClientId && multiplayerState.campaignQueue && multiplayerState.campaignQueue.length > 0) {
        const nextVerse = multiplayerState.campaignQueue[0];
        const phrases = splitVersePhrases(nextVerse.text);

        const maxGridSize = multiplayerState.distractionLevel <= 1 ? 4 : 9;
        const fakesCount = multiplayerState.distractionLevel > 0 ? multiplayerState.distractionLevel : 0;
        const realBlocksAvailable = phrases.length;
        const initialRealCount = Math.min(maxGridSize - fakesCount, realBlocksAvailable);

        let newBlocks = Array.from({ length: initialRealCount }, (_, i) => ({
          id: Math.random().toString(36).substr(2, 9),
          text: phrases[i],
          seqIndex: i,
          isSquare: true,
          error: false,
          correct: false,
          hidden: false
        }));

        if (fakesCount > 0) {
          for (let i = 0; i < fakesCount; i++) {
            newBlocks.push({ id: Math.random().toString(36).substr(2, 9), text: "---", seqIndex: -1, isSquare: true, error: false, correct: false, hidden: false, isFake: true });
          }
        }

        const currentLength = newBlocks.length;
        for (let i = currentLength; i < maxGridSize; i++) {
          newBlocks.push({ id: Math.random().toString(36).substr(2, 9), text: '', seqIndex: -99, isSquare: true, error: false, correct: false, hidden: true });
        }
        newBlocks.sort(() => Math.random() - 0.5);

        if (socketRef.current) {
          socketRef.current.send(JSON.stringify({
            type: 'NEXT_CAMPAIGN_ROUND',
            blocks: newBlocks,
            verseRef: nextVerse.reference,
            verseText: nextVerse.text,
            verseSides: verseSidesOf(nextVerse),
            phrases: phrases
          }));
        }
      }
    }
  }, [gameState, intermissionCountdown, intermissionEndsAt, multiplayerState, myClientId, multiplayerRoomId, localNextVerse]);

  const socketRef = useRef(null);
  const pendingInvitePKRef = useRef(null);

  useEffect(() => {
    const targetRoom = multiplayerRoomId || "global-lobby";
    const socketQuery = { name: playerName || "Player" + Math.floor(Math.random() * 999) };
    if (multiplayerRoomId) {
      socketQuery.playerKey = personalCode;
      if (multiplayerRoomMode) socketQuery.mode = multiplayerRoomMode;
      if (multiplayerRoomRole) socketQuery.role = multiplayerRoomRole;
      if (multiplayerRoomMode === 'team' && multiplayerRoomRole === 'host') {
        socketQuery.teamCount = multiplayerTeamCount;
        if (multiplayerHostPlays) socketQuery.hostPlays = '1';
      }
    }

    const socket = new PartySocket({
      host: PARTY_WS_HOST,
      room: targetRoom,
      query: socketQuery
    });

    socketRef.current = socket;

    let heartbeatInterval = null;

    const handleOpen = () => {
      setMyClientId(socket.id);
      setWsConnected(true);
      heartbeatInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'PING', ts: Date.now() }));
        }
      }, 30000);
      if (pendingInvitePKRef.current) {
        const { queue, pm, dl } = pendingInvitePKRef.current;
        setActiveVerse(queue[0]);
        setPlayMode(pm);
        setDistractionLevel(dl);
        setInitAutoStart({
          trigger: true,
          isAuto: false,
          isMultiplayerReadyCheck: true,
          campaignQueue: queue,
          verse: queue[0],
          playMode: pm
        });
        pendingInvitePKRef.current = null;
      }
    };

    const handleClose = () => {
      setWsConnected(false);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
    };

    const handleError = () => {
      setWsConnected(false);
    };

    const handleMessage = (e) => {
      if (socket.id) setMyClientId(socket.id);
      setWsConnected(true);
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'PONG') return;
        if (msg.type === 'PULSE') {
          // 轉成 window 事件,讓地圖(WorldMap2D)自行畫漣漪,不必穿 props。
          try { window.dispatchEvent(new CustomEvent('verserain:pulse', { detail: { name: msg.name, action: msg.action } })); } catch {}
          return;
        }
        if (msg.type === 'STATE_UPDATE') {
          setMultiplayerState(msg.state);
          // Room validation for guest join:
          // If we received a state AND there are other players (host exists), room is valid → clear timeout
          // If status='waiting' and only 1 player (just us), room is empty/nonexistent
          if (isGuestJoinRef.current) {
            const players = msg.state.players || {};
            const playerCount = Object.keys(players).length;
            const hasSeparateHost = msg.state.host && msg.state.host !== socket.id;
            if (playerCount > 1 || msg.state.status !== 'waiting' || hasSeparateHost) {
              // Room has a host — it's valid
              if (joinRoomTimeoutRef.current) {
                clearTimeout(joinRoomTimeoutRef.current);
                joinRoomTimeoutRef.current = null;
              }
              setJoinRoomError(null);
              isGuestJoinRef.current = false;
            }
            // else: still waiting — let the 5s timeout decide
          }

          // Only init game if we are NOT already in any game-active state
          const isGameActive = ['playing', 'intermission', 'waiting_for_others'].includes(gameStateRef.current);
          const isTeamHostSpectator = msg.state.matchType === 'team' && msg.state.host === socket.id && !msg.state.players?.[socket.id];
          if (msg.state.status === 'playing' && isTeamHostSpectator) {
            setGameState('waiting_for_others');
            if (timerRef.current) clearInterval(timerRef.current);
            return;
          }
          const needsTeamBeforeStart = msg.state.status === 'playing'
            && msg.state.matchType === 'team'
            && msg.state.host !== socket.id
            && msg.state.players?.[socket.id]
            && !msg.state.players[socket.id].teamId;
          if (needsTeamBeforeStart) {
            setGameState('menu');
            setMainTab('multiplayer');
            if (timerRef.current) clearInterval(timerRef.current);
            return;
          }
          if (msg.state.status === 'playing' && !isGameActive) {
            // Fix: always reset autoplay when a multiplayer game starts
            setIsAutoPlay(false);
            isAutoPlayRef.current = false;

            // *_solo: each player renders verse 0 in THEIR OWN language (resolved from
            // the reference); other (shared-board) modes keep the host's blocks/text.
            const isSolo = msg.state.playMode?.endsWith('_solo');
            const verse0Text = (isSolo ? mpLocalTextFor(msg.state.verseRef, msg.state.verseText) : msg.state.verseText)
              || msg.state.verseText || msg.state.blocks.filter(b => !b.isFake).map(b => b.text).join('');
            const fakeVerse = { reference: msg.state.verseRef, title: "Multiplayer", text: verse0Text };
            setActiveVerse(fakeVerse);
            // Sync the ref synchronously so the local block builder uses the host's
            // difficulty (state set below is async / this handler's closure can lag).
            if (msg.state.distractionLevel !== undefined) distractionLevelRef.current = msg.state.distractionLevel;
            if (isSolo && msg.state.playMode === 'square_solo') {
              // Build this player's own tiles from their own-language text.
              initSquareBlocks(false, null, fakeVerse);
            } else {
              setBlocks(msg.state.blocks);
            }
            setGameState('playing');
            setHealth(3);
            setCombo(0);
            setScore(0);
            const phraseCount = splitVersePhrases(verse0Text).length;
            setTimeLeft(500 + phraseCount * 500);
            setCurrentSeqIndex(0);
            currentSeqRef.current = 0;
            // For square_solo: store full ordered verse list so each player can advance independently.
            // campaignQueue from the server already includes all verses starting from verse 0.
            // Only init if not already set (host sets it in initAutoStart before INIT_GAME)
            if (isSolo && !multiplayerSoloActiveRef.current) {
              multiplayerSoloActiveRef.current = true;
              localCampaignListRef.current = (msg.state.campaignQueue && msg.state.campaignQueue.length > 0)
                ? msg.state.campaignQueue
                : [{ reference: msg.state.verseRef, text: msg.state.verseText, title: 'Multiplayer' }];
              localVerseIndexRef.current = 0;
            }
            setPlayMode(msg.state.playMode || 'square_solo');
            if (msg.state.distractionLevel !== undefined) {
              setDistractionLevel(msg.state.distractionLevel);
            }

            // Fix: submit location for ALL multiplayer players at game start (not just endGame)
            const nameAtStart = playerNameRef.current || socket?.id;
            if (nameAtStart) {
              const roomIdAtStart = multiplayerRoomRef.current;
              const submitLoc = (geo) => fetch('/api/submit-location', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nameAtStart, score: 0, lat: geo.latitude, lng: geo.longitude, country: geo.country_name || geo.country, city: geo.city || '', verseRef: msg.state.verseRef || '', roomId: roomIdAtStart || null })
              }).catch(() => { });
              if (geoRef.current) {
                submitLoc(geoRef.current);
              } else {
                (async () => {
                  for (const svc of [
                    async () => { const d = await (await fetch('https://ipapi.co/json/')).json(); if (d?.latitude) return d; throw 0; },
                    async () => { const d = await (await fetch('https://ip-api.com/json/?fields=lat,lon,country,city,status')).json(); if (d?.status === 'success') return { latitude: d.lat, longitude: d.lon, country_name: d.country, city: d.city }; throw 0; }
                  ]) { 
                    try { 
                      const g = await svc(); 
                      const customLat = localStorage.getItem('verserain_custom_lat');
                      const customLng = localStorage.getItem('verserain_custom_lng');
                      if (customLat && customLng) {
                        g.latitude = customLat;
                        g.longitude = customLng;
                      }
                      geoRef.current = g; 
                      submitLoc(g); 
                      return; 
                    } catch { } 
                  }
                })();
              }
            }

            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 10);

            if (msg.state.playMode === 'rain_solo') {
              setBlocks([]);
              const spawnWhenReady = () => {
                if (activePhrasesRef.current.length > 0) {
                  setTimeout(spawnNextBlock, 100);
                  setTimeout(spawnNextBlock, 900);
                  setTimeout(spawnNextBlock, 1700);
                  setTimeout(spawnNextBlock, 2500);
                  setTimeout(spawnNextBlock, 3300);
                } else if (gameStateRef.current === 'playing') {
                  setTimeout(spawnWhenReady, 100);
                }
              };
              spawnWhenReady();
            }
          } else if (msg.state.status === 'playing' && gameStateRef.current === 'playing') {
            // Vital logic: Apply the refreshed block array from the referee!
            if (!msg.state.playMode?.endsWith('_solo')) {
              setBlocks(msg.state.blocks);
            }
          }
          if (msg.state.status === 'intermission' && gameStateRef.current !== 'intermission') {
            setGameState('intermission');
            const countdownByLevel = [5, 3, 2, 1];
            startLocalIntermissionCountdown(countdownByLevel[msg.state.distractionLevel || 0] || 5);
            if (timerRef.current) clearInterval(timerRef.current);
          }
          if (msg.state.status === 'waiting') {
            multiplayerSoloActiveRef.current = false; // server reset — allow re-init on next game start
          }
          if (msg.state.status === 'finished' && gameStateRef.current !== 'multiplayer_results') {
            multiplayerSoloActiveRef.current = false;
            setGameState('multiplayer_results');
            if (timerRef.current) clearInterval(timerRef.current);
          }
        } else if (msg.type === 'BLOCK_CLAIMED') {
          // Dom coordinate extraction for flying animation
          const el = document.querySelector(`[data-id="${msg.blockId}"]`);
          const targetContainer = document.getElementById('multiplayer-stack-cursor');
          if (el && targetContainer) {
            const rect = el.getBoundingClientRect();
            const targetRect = targetContainer.getBoundingClientRect();

            const newFlyingBlock = {
              id: Date.now() + Math.random(),
              text: msg.blockText,
              claimedByName: msg.claimedByName,
              color: msg.claimedBy === socket.id ? '#10b981' : '#f43f5e',
              startX: `${rect.left}px`,
              startY: `${rect.top}px`,
              endX: `${targetRect.left}px`,
              endY: `${targetRect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`
            };

            setFlyingBlocks(prev => [...prev, newFlyingBlock]);

            setTimeout(() => {
              setFlyingBlocks(prev => prev.filter(fb => fb.id !== newFlyingBlock.id));
            }, 500);
          }

          setBlocks(prev => prev.map(b => b.id === msg.blockId ? { ...b, claimedBy: msg.claimedBy, claimedByName: msg.claimedByName, correct: true } : b));
          setCurrentSeqIndex(msg.nextSeq);
          currentSeqRef.current = msg.nextSeq;

          if (msg.claimedBy === socket.id) {
            setScore(prev => prev + 100);
            setCombo(c => c + 1);
          } else {
            setCombo(0);
          }
        } else if (msg.type === 'MISTAKE') {
          setHealth(h => {
            const newHealth = msg.health !== undefined ? msg.health : Math.max(0, h - 1);
            if (newHealth === 2) {
              playThunder('light');
              triggerLightning('light');
            } else if (newHealth <= 0) {
              playThunder('heavy');
              triggerLightning('heavy');
            }
            return newHealth;
          });
        }
      } catch (err) { }
    };

    socket.addEventListener('open', handleOpen);
    socket.addEventListener('message', handleMessage);
    socket.addEventListener('close', handleClose);
    socket.addEventListener('error', handleError);

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
      socket.close();
      socketRef.current = null;
      setWsConnected(false);
      multiplayerSoloActiveRef.current = false;
    };
  }, [multiplayerRoomId, multiplayerRoomMode, multiplayerRoomRole, multiplayerTeamCount, multiplayerHostPlays, playerName, personalCode, triggerLightning]);

  // Process Challenge URL parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const challengeRef = params.get('challenge');
    const setRef = params.get('set');
    const rcParam = params.get('rc');
    const roomParam = params.get('room');
    const listenDaily = params.get('listenDaily');
    const listenSetRef = params.get('listenSet');
    const listenVerseRef = params.get('listenVerse');
    const requestedVersion = params.get('version');

    // version= carries whatever the SENDER's app was set to. Apply it once as a
    // first guess so the right language chunk starts loading — but only once,
    // because the set's OWN language is the authority (see the listenSet branch
    // below) and re-applying this would fight it forever.
    if ((listenDaily || listenSetRef) && requestedVersion && requestedVersion !== version
        && !appliedLinkVersionRef.current) {
      appliedLinkVersionRef.current = true;
      setVersion(requestedVersion);
      return;
    }

    if (roomParam) {
      const roomCode = sanitizeRoomCode(roomParam);
      if (roomCode.length === 4) {
        setMainTab('multiplayer');
        setMultiplayerRoomMode(null);
        setMultiplayerRoomRole('player');
        setMultiplayerRoomId(roomCode);
      }
      // Small timeout to allow state applied before url replace
      setTimeout(() => window.history.replaceState({}, document.title, pathWithSharedLang()), 100);
      return;
    }

    if (listenDaily) {
      changeDailyVerseDate(listenDaily);
      // vo= → recipients hear the sender's personal recording (same contract
      // as the listenSet share below).
      const dailyVoParam = params.get('vo');
      setDailySharedVoiceOwner(/^[a-f0-9]{16}$/.test(String(dailyVoParam || '')) ? dailyVoParam : null);
      setContinuousRainSet(null);
      setMainTab('daily_verse');
      window.history.replaceState({}, document.title, pathWithSharedLang());
      return;
    }

    if (listenSetRef) {
      // activeVerseSets only holds sets whose language === the current version,
      // so a share for a set in ANOTHER language can never be found there: every
      // remote fetch below lands the set into state and it still stays
      // invisible, leaving the recipient staring at an empty player. Resolve
      // against the unfiltered lists first and adopt the set's OWN language —
      // the link's version= is the sender's setting, not the set's.
      const setInAnyLanguage = publishedVerseSets.find(s => s.id === listenSetRef)
        || customVerseSets.find(s => s.id === listenSetRef)
        || null;
      const setLanguage = setInAnyLanguage ? (setInAnyLanguage.language || 'cuv') : null;
      if (setLanguage && setLanguage !== version) {
        setVersion(setLanguage);
        return; // re-runs once the language loads; the set is then in activeVerseSets
      }

      const foundSet = activeVerseSets.find(s => s.id === listenSetRef);
      if (foundSet) {
        // listenOrder=seq → play ALL verses in canonical order (looping),
        // starting from the first verse unless listenVerse pins a start.
        const sequential = ['seq', 'sequential'].includes(params.get('listenOrder') || '');
        // listenIndex pins the shared verse BY POSITION — robust for large sets
        // whose text exceeds /share-set's 128KB cap (listen-card.js then can't
        // resolve the index → reference server-side and drops listenVerse, which
        // used to leave the recipient on a random verse). We have the full set
        // locally here, so index straight into it.
        const listenIndexRaw = params.get('listenIndex');
        const listenIndex = /^\d+$/.test(String(listenIndexRaw || '')) ? Number(listenIndexRaw) : null;
        const startVerse = listenVerseRef
          ? (foundSet.verses || []).find(v => v.reference === listenVerseRef)
          : (listenIndex !== null && listenIndex >= 0 && listenIndex < (foundSet.verses || []).length
              ? (foundSet.verses || [])[listenIndex]
              : (sequential ? (foundSet.verses || [])[0] : null));
        setSelectedSetId(foundSet.id);
        setMainTab('versesets');
        const voParam = params.get('vo');
        setContinuousRainSet({
          id: foundSet.id,
          title: foundSet.title,
          verses: foundSet.verses || [],
          startVerse,
          playOrder: sequential ? 'sequential' : undefined,
          // Synthetic single-verse shares carry the real set id here so
          // creator recordings still resolve for recipients.
          voiceSetId: foundSet.voiceSetId || null,
          // vo= → play the sender's personal voice over the owner's / TTS.
          sharedVoiceOwner: /^[a-f0-9]{16}$/.test(String(voParam || '')) ? voParam : null,
          background: foundSet.background || '',
          backgroundMime: foundSet.backgroundMime || '',
          bgMusic: foundSet.bgMusic || '',
          bgMusicMime: foundSet.bgMusicMime || '',
          bgMusicVolume: foundSet.bgMusicVolume,
        });
        window.history.replaceState({}, document.title, pathWithSharedLang());
      } else if (!listenSetFetchAttemptedRef.current.has(listenSetRef)) {
        // Set not in current activeVerseSets — could be because:
        //  • publishedVerseSets hasn't finished its on-mount fetch yet, OR
        //  • the set is a private custom set still syncing via /private-sets, OR
        //  • this is a different account opening a freshly-published share URL.
        // Trigger fresh fetches so the useEffect re-runs with up-to-date data
        // once the responses come back. Guarded by a Set so we only fire each
        // remote lookup once per set id.
        listenSetFetchAttemptedRef.current.add(listenSetRef);
        const host = PARTY_DB;
        fetch(`${host}/custom-sets`)
          .then(r => r.ok ? r.json() : null)
          .then(arr => { if (Array.isArray(arr)) setPublishedVerseSets(arr); })
          .catch(() => {});
        if (playerName) {
          fetch(`${host}/private-sets?player=${encodeURIComponent(playerName)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              const remote = Array.isArray(data?.sets) ? data.sets : null;
              if (!remote || !remote.length) return;
              setCustomVerseSets(prev => {
                const byId = new globalThis.Map(prev.map(s => [s.id, s]));
                for (const s of remote) { if (s?.id && !byId.has(s.id)) byId.set(s.id, s); }
                const merged = Array.from(byId.values());
                try { localStorage.setItem('verseRain_custom_sets', JSON.stringify(merged)); } catch {}
                return merged;
              });
            })
            .catch(() => {});
        }
        // Share-set fallback: works for recipients who aren't logged in or
        // aren't the set's owner. Lands the set into publishedVerseSets so
        // activeVerseSets re-computes and the URL handler picks it up on
        // the next render.
        fetch(`${host}/share-set?id=${encodeURIComponent(listenSetRef)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data?.set?.id) return;
            setPublishedVerseSets(prev => prev.some(s => s.id === data.set.id) ? prev : [...prev, data.set]);
          })
          .catch(() => {});
      }
      return;
    }

    const viewSetRef = params.get('viewSet');
    if (viewSetRef) {
      const foundSet = activeVerseSets.find(s => s.id === viewSetRef);
      if (foundSet) {
        setSelectedSetId(foundSet.id);
        setMainTab('versesets');
        window.history.replaceState({}, document.title, pathWithSharedLang());
      } else if (!viewSetFetchAttemptedRef.current.has(viewSetRef)) {
        // Set not in local lists yet — typical for share links opened in a
        // fresh context (Skool in-app webview, new device, logged-out, etc.).
        // Hit the public /custom-sets list, the user's /private-sets, and the
        // /share-set link-share endpoint. Any of them landing into state will
        // re-run this useEffect via activeVerseSets dep, and the set will be
        // found on the second pass. Keep the URL in place — do NOT
        // history.replaceState here, otherwise the second pass loses the
        // viewSet param and falls through to the home page.
        viewSetFetchAttemptedRef.current.add(viewSetRef);
        const host = PARTY_DB;
        fetch(`${host}/custom-sets`)
          .then(r => r.ok ? r.json() : null)
          .then(arr => { if (Array.isArray(arr)) setPublishedVerseSets(arr); })
          .catch(() => {});
        if (playerName) {
          fetch(`${host}/private-sets?player=${encodeURIComponent(playerName)}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              const remote = Array.isArray(data?.sets) ? data.sets : null;
              if (!remote || !remote.length) return;
              setCustomVerseSets(prev => {
                const byId = new globalThis.Map(prev.map(s => [s.id, s]));
                for (const s of remote) { if (s?.id && !byId.has(s.id)) byId.set(s.id, s); }
                const merged = Array.from(byId.values());
                try { localStorage.setItem('verseRain_custom_sets', JSON.stringify(merged)); } catch {}
                return merged;
              });
            })
            .catch(() => {});
        }
        fetch(`${host}/share-set?id=${encodeURIComponent(viewSetRef)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data?.set?.id) return;
            setPublishedVerseSets(prev => prev.some(s => s.id === data.set.id) ? prev : [...prev, data.set]);
          })
          .catch(() => {});
      }
      return;
    }

    if (setRef) {
      if (!playerName) {
        setShowLoginModal('login');
      } else {
        const foundSet = activeVerseSets.find(s => s.id === setRef);
        if (foundSet) {
          setSelectedSetId(foundSet.id);
          window.history.replaceState({}, document.title, pathWithSharedLang());
          setTimeout(() => {
            let queue = [...foundSet.verses];
            if (rcParam) {
              const count = parseInt(rcParam, 10);
              if (!isNaN(count) && count > 0) {
                queue = queue.sort(() => 0.5 - Math.random()).slice(0, Math.min(queue.length, count));
              }
            }
            setCampaignQueue(queue.slice(1));
            setCampaignResults([]);
            setActiveVerse(queue[0]);
            setInitAutoStart({ trigger: true, isAuto: false, overrideVerse: queue[0] });
          }, 300);
          return;
        }
      }
    }

    if (challengeRef) {
      if (!playerName) {
        setShowLoginModal('login');
      } else {
        const allVerses = activeVerseSets.flatMap(s => s.verses || []);
        const targetVerse = allVerses.find(v => v.reference === challengeRef);
        if (targetVerse) {
          const isEnglish = /^[a-zA-Z]/.test(targetVerse.reference);
          if ((isEnglish && !isEnglishBibleVersion(version)) || (!isEnglish && version !== 'cuv')) {
            setVersion(isEnglish ? 'en' : 'cuv');
            return;
          }
          setActiveVerse(targetVerse);
          setSelectedVerseRefs([targetVerse.reference]);
          window.history.replaceState({}, document.title, pathWithSharedLang());
          setTimeout(() => {
            setInitAutoStart({ trigger: true, isAuto: false });
          }, 300);
        } else {
          if (!challengeFetchAttemptedRef.current.has(challengeRef)) {
            challengeFetchAttemptedRef.current.add(challengeRef);
            setToast(t('找不到此內容，請確認段落', 'Paragraph not found, please check the reference'));
            setTimeout(() => setToast(null), 3000);
            window.history.replaceState({}, document.title, pathWithSharedLang());
          }
        }
      }
    }
  }, [playerName, activeVerseSets, version, changeDailyVerseDate, setActiveVerse, setSelectedVerseRefs, setInitAutoStart, setShowLoginModal, setVersion]);

  const timerRef = useRef(null);
  const isGameTimerPausedRef = useRef(false);
  const speechRef = useRef(null);
  // Tracks listenSet ids we've already fired a fallback remote fetch for, so
  // the share-URL handler doesn't hammer PartyKit on every activeVerseSets re-render.
  const listenSetFetchAttemptedRef = useRef(new globalThis.Set());
  // The link's version= is applied at most once. After that the set's own
  // language wins, so the two can't ping-pong against each other.
  const appliedLinkVersionRef = useRef(false);
  // Same idea for ?viewSet=... share URLs (links shared on Skool / WhatsApp /
  // etc. land here in fresh contexts where the set may not yet be in any
  // local list).
  const viewSetFetchAttemptedRef = useRef(new globalThis.Set());
  const challengeFetchAttemptedRef = useRef(new globalThis.Set());

  useEffect(() => {
    // Dynamically scale animation speeds (10% increase compounding, or simply linear)
    // Here we compound by 5% every combo tier. 
    // Math.pow(1.05, 0) = 1.0; Math.pow(1.05, 1) = 1.05; Math.pow(1.05, 2) = 1.1025
    const rate = Math.min(Math.pow(1.05, combo), 2.2); // Cap at 2.2x speed

    // Grab all actively falling blocks and adjust their native playback rate on the fly
    const wrappers = document.querySelectorAll('.falling-wrapper');
    wrappers.forEach(el => {
      const anims = el.getAnimations();
      anims.forEach(anim => {
        // Only target fall animation and ensure it's not paused
        if (anim.effect && anim.effect.getComputedTiming && anim.effect.getComputedTiming().progress !== null) {
          anim.playbackRate = rate;
        } else {
          // Fallback for newer blocks just added
          anim.playbackRate = rate;
        }
      });
    });
  }, [combo, blocks]); // We keep blocks here because when a new block is added, we want it to inherit the Current rate instantly

  const spawnNextBlock = (expiredBlockId = null) => {
    if (isBlindMode) return;

    setBlocks(prev => {
      let expiredBlock = null;
      let remainingBlocks = prev;

      if (expiredBlockId) {
        expiredBlock = prev.find(b => b.id === expiredBlockId);
        remainingBlocks = prev.filter(b => b.id !== expiredBlockId);
      }

      const phrases = activePhrasesRef.current;
      const targetSeq = currentSeqRef.current;
      if (targetSeq >= phrases.length) return remainingBlocks;

      const onScreenIndices = remainingBlocks.map(b => b.seqIndex);
      const candidates = [];
      for (let i = targetSeq; i < phrases.length; i++) {
        if (!onScreenIndices.includes(i)) {
          candidates.push(i);
        }
      }

      if (candidates.length === 0) return remainingBlocks;

      let seqToSpawn = -1;
      let isFake = false;
      const fakesOnScreen = remainingBlocks.filter(b => b.isFake).length;
      let maxFakesAllowed = 0;
      if (distractionLevelRef.current === 3) maxFakesAllowed = 2;
      if (distractionLevel === 2) maxFakesAllowed = 1;
      if (distractionLevel === 1) maxFakesAllowed = 1;

      let spawnFake = distractionLevel > 0 && Math.random() < (distractionLevel * 0.3);
      if (fakesOnScreen >= maxFakesAllowed) spawnFake = false;

      if (candidates.includes(targetSeq)) {
        seqToSpawn = targetSeq; // Absolute guarantee the required phrase is spawned
      } else if (spawnFake && !playModeRef.current.startsWith('square')) {
        isFake = true;
        seqToSpawn = -1;
      } else {
        const nextImmediateCandidates = candidates.slice(0, 3);
        seqToSpawn = nextImmediateCandidates[Math.floor(Math.random() * nextImmediateCandidates.length)];
      }

      let xPos;
      if (expiredBlock && !isFake && expiredBlock.seqIndex === seqToSpawn) {
        xPos = expiredBlock.xPos;
      } else {
        const lanes = [5, 35, 65];
        const assignedLane = Math.floor(Math.random() * 3);
        xPos = lanes[assignedLane] + Math.random() * 10;
      }

      const newBlock = {
        id: Math.random().toString(36).substr(2, 9),
        text: isFake ? getRandomFakePhrase(version, VERSES_DB) : phrases[seqToSpawn],
        seqIndex: seqToSpawn,
        xPos: xPos,
        duration: 7.5 + Math.random() * 3,
        error: false,
        correct: false,
        isFake: isFake
      };

      return [...remainingBlocks, newBlock];
    });
  };

  const startSingleGame = () => {
    setCampaignQueue(null);
    setCampaignResults([]);
    startGame();
  };

  const playSingleVerseCard = async (verse, sourceSet = null) => {
    initAudio();
    const setId = sourceSet?.id || null;
    // Resolve the voice BEFORE mounting the card so the first play already
    // knows whose recording to use. The set author's recording plays via the
    // creator layer, and the viewer's own via the default override — but a
    // *contributor's* recording (someone who is neither the author nor the
    // viewer) is otherwise never consulted, so the play button would fall back
    // to TTS. Route that contributor through the existing sharedVoiceOwner path.
    let sharedVoiceOwner = null;
    if (setId && verse?.reference) {
      try {
        const opts = await gatherVerseVoiceOptions(setId, verse.reference);
        if (!opts.some(o => o.kind === 'owner')) {
          const mineId = userEmail ? await voiceOwnerId(userEmail).catch(() => null) : null;
          const pick = opts.find(o => o.kind === 'personal' && o.ownerId === mineId)
            || opts.find(o => o.kind === 'personal');
          if (pick) sharedVoiceOwner = pick.ownerId;
        }
      } catch { /* best-effort — fall back to the default auto behavior */ }
    }
    // Carry the FULL set's verses so the player's own (synchronous) ‹ › can
    // walk them — critical on iOS, where audio must start inside the tap
    // gesture; rebuilding the card async between verses loses that blessing and
    // the next verse comes up silent / stuck. clampNav = stop at the ends
    // (no wrap); loopCurrent = a finished verse replays instead of auto-moving,
    // so the card stays on the verse you opened until you tap ‹ ›.
    const fullVerses = sourceSet?.verses?.length ? sourceSet.verses : [verse];
    setContinuousRainSet({
      id: `single-${verse.reference}`,
      title: verse.reference,
      verses: fullVerses,
      startVerse: verse,
      clampNav: fullVerses.length > 1,
      loopCurrent: true,
      // 創作者親聲朗讀 / custom assets need the REAL originating set id —
      // the synthetic `single-…` id has nothing stored under it.
      voiceSetId: setId,
      sharedVoiceOwner,
      background: sourceSet?.background || '',
      backgroundMime: sourceSet?.backgroundMime || '',
      bgMusic: sourceSet?.bgMusic || '',
      bgMusicMime: sourceSet?.bgMusicMime || '',
      bgMusicVolume: sourceSet?.bgMusicVolume,
    });
  };

  // Reader-launched challenge. `opts` ({ mode, difficulty }) comes from the
  // player's ⚡ chooser; the actual startGame fires from the effect below so it
  // runs AFTER the re-render commits — startGame reads playMode/distractionLevel
  // from its render closure, and a same-tick setTimeout would capture the stale
  // pre-chooser values.
  const pendingReaderChallengeRef = useRef(null);
  // The reader (continuousRainSet) the challenge was launched from, stashed so
  // the game-over 回到主頁 button can drop the player back into that reading
  // instead of the lobby — they can then ‹ › to the next verse and ⚡ again.
  const readerReturnRef = useRef(null);

  // ─── Browser history ↔ page state (see parseRoute/routeFromState) ───
  const quitGame = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch { /* noop */ }
    multiplayerSoloActiveRef.current = false;
    const back = readerReturnRef.current;
    readerReturnRef.current = null;
    setGameState('menu');
    setCampaignQueue(null);
    if (back) setContinuousRainSet(back);
  };
  const leaveMultiplayerRoom = () => {
    if (socketRef.current) { try { socketRef.current.close(); } catch { /* noop */ } socketRef.current = null; }
    multiplayerSoloActiveRef.current = false;
    setMultiplayerRoomMode(null);
    setMultiplayerRoomRole('player');
    setMultiplayerRoomId(null);
    setMultiplayerState(null);
  };
  const routeStateRef = useRef({});
  routeStateRef.current = { mainTab, selectedSetId, editing: !!editingCustomSet, listening: !!continuousRainSet, playing: gameState !== 'menu', roomId: multiplayerRoomId };
  const applyingHistoryRef = useRef(false);
  // popstate → state: leave every layer the target route doesn't include.
  useEffect(() => {
    const onPop = () => {
      const r = parseRoute(window.location.hash);
      const st = routeStateRef.current;
      applyingHistoryRef.current = true;
      if (st.listening && !r.listen) setContinuousRainSet(null);
      if (st.playing && !r.play) quitGame();
      if (st.roomId && r.roomId !== st.roomId) leaveMultiplayerRoom();
      if (st.editing && !r.edit) setEditingCustomSet(null);
      if (r.tab !== st.mainTab) setMainTab(r.tab);
      if (r.tab === 'versesets' && (r.setId || null) !== (st.selectedSetId || null)) setSelectedSetId(r.setId || null);
      // Layers that need data (listen/play/edit/room) can't be rebuilt from a
      // URL. If nothing changed (so the sync effect below won't run), rewrite
      // the hash to what is actually shown.
      setTimeout(() => {
        applyingHistoryRef.current = false;
        const actual = routeFromState(routeStateRef.current);
        if (window.history.state?.vr !== actual) {
          const url = window.location.pathname + window.location.search + (actual === 'lobby' ? '' : '#' + actual);
          try { window.history.replaceState({ ...(window.history.state || {}), vr: actual }, '', url); } catch { /* noop */ }
        }
      }, 120);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // state → history: one entry per step; replace (never push) on first sync
  // or while applying a popstate, so StrictMode double-runs and Back/Forward
  // never create extra entries.
  useEffect(() => {
    const route = routeFromState(routeStateRef.current);
    const cur = window.history.state?.vr;
    if (cur === route) { applyingHistoryRef.current = false; return; }
    const url = window.location.pathname + window.location.search + (route === 'lobby' ? '' : '#' + route);
    try {
      if (cur === undefined || applyingHistoryRef.current) window.history.replaceState({ ...(window.history.state || {}), vr: route }, '', url);
      else window.history.pushState({ vr: route }, '', url);
    } catch { /* noop */ }
    applyingHistoryRef.current = false;
  }, [mainTab, selectedSetId, !!editingCustomSet, !!continuousRainSet, gameState !== 'menu', multiplayerRoomId]);
  // A #versesets/<id> that never resolves (deleted set, bad link): fall back to
  // the list instead of silently showing the first set as if it were that one.
  useEffect(() => {
    if (!selectedSetId) return;
    const found = safeActiveSets.some(s => s.id === selectedSetId) || customVerseSets.some(s => s.id === selectedSetId);
    if (found) return;
    const t = setTimeout(() => {
      const stillMissing = !safeActiveSets.some(s => s.id === selectedSetId) && !customVerseSets.some(s => s.id === selectedSetId);
      if (stillMissing) setSelectedSetId(null);
    }, 6000);
    return () => clearTimeout(t);
  }, [selectedSetId, safeActiveSets, customVerseSets]);
  const [readerChallengeKick, setReaderChallengeKick] = useState(0);
  useEffect(() => {
    const pending = pendingReaderChallengeRef.current;
    if (!pending) return;
    pendingReaderChallengeRef.current = null;
    setTimeout(() => startGame(false, pending.verse), 50);
  }, [readerChallengeKick]);

  const challengeVerseFromReader = (verse, opts = null) => {
    if (!verse) return;
    initAudio(); // synchronous, inside the tap — keeps the iOS audio blessing
    if (opts?.mode) setPlayMode(opts.mode);
    if (typeof opts?.difficulty === 'number') setDistractionLevel(opts.difficulty);
    if (typeof opts?.debug === 'boolean') setIsDebugMode(opts.debug);
    if (typeof opts?.noReadback === 'boolean') setSkipReadback(opts.noReadback);
    // Remember the reading we came from so 回到主頁 can return to it (see
    // readerReturnRef). The reader is torn down during the challenge to stop its
    // playback; we re-open it when the game ends — at the verse just challenged
    // and PAUSED, so it doesn't re-narrate. Play or ‹ › resumes.
    readerReturnRef.current = continuousRainSet
      ? { ...continuousRainSet, startVerse: verse, startPaused: true }
      : null;
    setContinuousRainSet(null);
    setCampaignQueue(null);
    campaignQueueRef.current = null;
    setCampaignResults([]);
    setActiveCampaignSetId(null);
    setActiveCampaignSetTotal(1);
    setActiveVerse(verse);
    setSelectedVerseRefs([verse.reference]);
    pendingReaderChallengeRef.current = { verse };
    setReaderChallengeKick(k => k + 1);
  };

  // Push a verse set to the backend's share-set endpoint so anyone who opens
  // the share URL can fetch it back — no admin permission needed, no global
  // publish list pollution. Fire-and-forget; the link will resolve once
  // PartyKit has written the row (sub-second typical).
  const pushSetForSharing = (set, force = false) => {
    if (!set || !set.id) return;
    // Built-in sets are already in every device's verses_*.js bundle —
    // pushing them is wasteful. EXCEPT for /lc share links: the OG-card
    // endpoint resolves the set title + verse text server-side from
    // /share-set, so those pushes pass force=true for built-ins too.
    if (!force && !set.id.startsWith('custom-')) return;
    fetch(`${PARTY_DB}/share-set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set }),
    }).catch(() => {});
  };

  const openListeningShare = async (url, reference) => {
    setQrShareModal({ url, reference });
    try {
      await navigator.clipboard?.writeText(url);
      setToast(t('讀經連結已複製！', 'Reading link copied!'));
      setTimeout(() => setToast(null), 3000);
    } catch {
      // QR modal remains available when clipboard permission is unavailable.
    }
  };

  useEffect(() => {
    if (initAutoStart?.trigger) {
      if (initAutoStart.isMultiplayerReadyCheck) {
        if (initAutoStart.playMode?.endsWith('_solo') && initAutoStart.campaignQueue?.length > 0) {
          localCampaignListRef.current = initAutoStart.campaignQueue;
          localVerseIndexRef.current = 0;
          multiplayerSoloActiveRef.current = true;
        }
        if (initAutoStart.playMode === 'square_solo') {
          initSquareBlocks(true, initAutoStart.campaignQueue, initAutoStart.verse, initAutoStart.playMode);
        } else if (initAutoStart.playMode === 'rain_solo' || initAutoStart.playMode === 'voice_solo') {
          if (socketRef.current) {
            const verse = initAutoStart.verse || activeVerse;
            const phrases = splitVersePhrases(verse.text);

            socketRef.current.send(JSON.stringify({
              type: 'INIT_GAME',
              matchType: multiplayerState?.matchType || multiplayerRoomMode || 'team',
              teamCount: multiplayerState?.teamCount || multiplayerTeamCount,
              blocks: [],
              verseRef: verse.reference,
              verseText: verse.text,
              verseSides: verseSidesOf(verse),
              playMode: initAutoStart.playMode,
              distractionLevel: multiplayerDistractionLevel,
              phrases: phrases,
              campaignQueue: initAutoStart.campaignQueue
            }));
          }
        }
      } else {
        startGame(initAutoStart.isAuto, initAutoStart.overrideVerse);
      }
      setInitAutoStart(null);
    }
  }, [initAutoStart]);

  const initSquareBlocks = (isMultiplayerReadyCheck = false, campaignQueue = null, overrideVerse = null, passedPlayMode = null) => {
    const verse = overrideVerse || activeVerse;
    const actualPlayMode = passedPlayMode || playMode;
    let phrases;
    if (overrideVerse) {
      phrases = splitVersePhrases(verse.text);
    } else {
      phrases = activePhrasesRef.current;
    }

    // Grid size depends on difficulty. Read from refs so this stays correct even
    // when called from the room-join-bound socket handler (whose closured state can
    // lag), e.g. a joining player building their own square_solo board.
    const dl = distractionLevelRef.current;
    const maxGridSize = dl <= 1 ? 4 : 9;

    const fakesCount = dl > 0 ? dl : 0;
    const realBlocksAvailable = phrases.length;

    const initialRealCount = Math.min(maxGridSize - fakesCount, realBlocksAvailable);
    const initialIndices = Array.from({ length: initialRealCount }, (_, i) => i);

    const newBlocks = initialIndices.map((pIndex) => ({
      id: Math.random().toString(36).substr(2, 9),
      text: phrases[pIndex],
      seqIndex: pIndex,
      isSquare: true,
      error: false,
      correct: false,
      hidden: false
    }));

    if (fakesCount > 0) {
      for (let i = 0; i < fakesCount; i++) {
        newBlocks.push({
          id: Math.random().toString(36).substr(2, 9),
          text: getRandomFakePhrase(versionRef.current, VERSES_DB),
          seqIndex: -1,
          isSquare: true,
          error: false,
          correct: false,
          hidden: false,
          isFake: true
        });
      }
    }

    // Pad to exactly maxGridSize blocks with hidden blocks if necessary to preserve grid
    const currentLength = newBlocks.length;
    for (let i = currentLength; i < maxGridSize; i++) {
      newBlocks.push({
        id: Math.random().toString(36).substr(2, 9),
        text: '',
        seqIndex: -99,
        isSquare: true,
        error: false,
        correct: false,
        hidden: true
      });
    }

    newBlocks.sort(() => Math.random() - 0.5);

    if (isMultiplayerReadyCheck && socketRef.current) {
      socketRef.current.send(JSON.stringify({
        type: 'INIT_GAME',
        matchType: multiplayerState?.matchType || multiplayerRoomMode || 'team',
        teamCount: multiplayerState?.teamCount || multiplayerTeamCount,
        blocks: newBlocks,
        verseRef: verse.reference,
        verseText: verse.text,
        verseSides: verseSidesOf(verse),
        playMode: actualPlayMode,
        distractionLevel: distractionLevel,
        phrases: phrases,
        campaignQueue: campaignQueue
      }));
    } else {
      setBlocks(newBlocks);
    }
  };

  const startGame = (isAuto = false, overrideVerse = null) => {
    initAudio();
    setGameState('playing');
    setIsAutoPlay(isAuto);
    setScore(0);
    setCombo(0);
    setHealth(3);
    const initialVerse = overrideVerse || activeVerse;
    if (initialVerse) {
      const phraseCount = splitVersePhrases(initialVerse.text).length;
      setTimeLeft(500 + phraseCount * 500);
    } else {
      setTimeLeft(6000);
    }
    setCurrentSeqIndex(0);
    currentSeqRef.current = 0;
    setBlocks([]);
    setIsFlawless(false);
    setIsNewHighScore(false);
    setIsFailed(false);
    setTimeBonus(0);

    const actualVerse = overrideVerse || activeVerse;
    if (actualVerse) {
      activePhrasesRef.current = splitVersePhrases(actualVerse.text);
    }

    isGameTimerPausedRef.current = playModeRef.current?.startsWith('voice') || isBlindMode;

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      if (isGameTimerPausedRef.current) return;
      setTimeLeft(t => {
        if (t <= 1 && !isAutoPlayRef.current) {
          return 0; // The game now allows users to keep going past the time limit
        }
        return Math.max(0, t - 1);
      });
    }, 10);

    if (!isAuto) {
      if (playModeRef.current.startsWith('square')) {
        initSquareBlocks(false, null, actualVerse);
      } else {
        setTimeout(spawnNextBlock, 100);
        setTimeout(spawnNextBlock, 900);
        setTimeout(spawnNextBlock, 1700);
        setTimeout(spawnNextBlock, 2500);
        setTimeout(spawnNextBlock, 3300);
      }
    }

    if (actualVerse && !isAuto) {
      logEvent('versePlayed', { ref: actualVerse.reference, setId: selectedSetId });
    }
  };

  useEffect(() => {
    let cancelAutoPlay = false;

    const runAutoPlayLoop = async () => {
      if (!isAutoPlay || gameState !== 'playing') return;

      const TTS_LANG = getVoiceLangForVersion(version);

      // Start from current position (supports mid-game activation)
      const startFrom = currentSeqRef.current;

      // Only announce title when starting from the beginning
      if (startFrom === 0 && !cancelAutoPlay && gameStateRef.current === 'playing') {
        setSpeakingTitle(true);
        speechRef.current = speakText(formatVerseReferenceForSpeech(activeVerse.reference, version), 1.0, TTS_LANG);
        await speechRef.current;
        setSpeakingTitle(false);
        await new Promise(r => setTimeout(r, AUTO_PLAY_REFERENCE_PAUSE_MS));
      }
      for (let i = startFrom; i < activePhrasesRef.current.length; i++) {
        if (cancelAutoPlay || gameStateRef.current !== 'playing') break;

        setCurrentSeqIndex(i);
        currentSeqRef.current = i;

        const phraseToSpeak = activePhrasesRef.current[i];

        speechRef.current = speakText(phraseToSpeak, 1.0, TTS_LANG);
        await speechRef.current;
      }

      if (cancelAutoPlay || gameStateRef.current !== 'playing') return;

      // Mark complete. The existing currentSeqIndex -> endGame hook will handle success transition!
      setCurrentSeqIndex(activePhrasesRef.current.length);
      currentSeqRef.current = activePhrasesRef.current.length;
    };

    if (isAutoPlay && gameState === 'playing') {
      runAutoPlayLoop();
    }
    return () => { cancelAutoPlay = true; };
  }, [isAutoPlay, gameState, version, activeVerse.reference]);

  const triggerFireworks = () => {
    const duration = 2 * 1000;
    const end = Date.now() + duration;

    let soundTick = 0;
    (function frame() {
      if (soundTick % 10 === 0) playFireworksSound(); // Spread out sound
      soundTick++;

      confetti({
        particleCount: 5, angle: 60, spread: 55, origin: { x: 0 },
        colors: ['#3b82f6', '#fbbf24', '#f87171', '#34d399']
      });
      confetti({
        particleCount: 5, angle: 120, spread: 55, origin: { x: 1 },
        colors: ['#3b82f6', '#fbbf24', '#f87171', '#34d399']
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  };

  const triggerFlawless = () => {
    confetti({
      particleCount: 150, spread: 100, origin: { y: 0.4 },
      colors: ['#fbbf24', '#fef08a']
    });
  }

  const endGame = () => {
    if (timerRef.current) clearInterval(timerRef.current);

    const isSuccess = currentSeqRef.current >= activePhrases.length;

    if (isAutoPlayRef.current) {
      setTimeout(() => {
        if (gameStateRef.current !== 'menu') {
          const currentQueue = campaignQueueRef.current;
          if (currentQueue !== null && currentQueue.length > 0) {
            setActiveVerse(currentQueue[0]);
            setCampaignQueue(currentQueue.slice(1));
            campaignQueueRef.current = currentQueue.slice(1);
            startGame(true, currentQueue[0]);
          } else {
            setGameState('menu');
          }
        }
      }, 2000);
      return;
    }

    setGameState(campaignQueue !== null ? 'campaign-results' : 'gameover');
    setBlocks([]); // clear arena

    const failed = !isSuccess;

    const f = isSuccess && healthRef.current === 3;

    let finalCalculatedScore = scoreRef.current;

    if (isSuccess) {
      setPureBaseScore(finalCalculatedScore);
      let timeMultiplier = (playMode === 'blind' || playMode?.startsWith('voice')) ? 0.75 : 0.5;
      const calculatedTimeBonus = Math.floor(Math.max(0, timeLeft) * timeMultiplier);
      setTimeBonus(calculatedTimeBonus);
      finalCalculatedScore += calculatedTimeBonus;

      if (distractionLevel > 0) {
        finalCalculatedScore = Math.floor(finalCalculatedScore * (1 + distractionLevel * 0.1));
      }

      setScore(finalCalculatedScore);
      scoreRef.current = finalCalculatedScore;
    } else {
      setPureBaseScore(finalCalculatedScore);
      setTimeBonus(0);
    }

    const hs = isSuccess && healthRef.current > 0 && finalCalculatedScore > bestScore && finalCalculatedScore > 0;

    setIsFlawless(f);
    setIsNewHighScore(hs);
    setIsFailed(failed || healthRef.current <= 0); // Consider it visually failed if health <= 0, but verse completes

    if (isSuccess && !isAutoPlayRef.current) {
      const estimateVerseCount = (ref, txt) => {
        let count = 1;
        const rangeMatch = ref.match(/[:：]\s*(\d+)\s*[~\-至]\s*(\d+)/);
        if (rangeMatch) {
          const s = parseInt(rangeMatch[1]);
          const e = parseInt(rangeMatch[2]);
          if (e >= s) count = e - s + 1;
        } else if (!ref.match(/[:：]/)) {
          count = Math.max(1, Math.round(txt.replace(/\s+/g, '').length / 40));
        }
        return Math.min(Math.max(1, count), 50);
      };

      const vCount = estimateVerseCount(activeVerse.reference, activeVerse.text);

      // Award point to the creator (or the player themselves if playing default sets)
      if (hs && playerName) {
        let authorToReward = playerName;
        let verseSetName = "系統預設內容";

        if (selectedSetId) {
          const foundSet = [...customVerseSets, ...publishedVerseSets, ...baseVerseSets].find(s => s.id === selectedSetId);
          if (foundSet && foundSet.authorName && foundSet.authorName !== "Anonymous" && foundSet.authorName !== "Verserain 官方") {
            authorToReward = foundSet.authorName; // If playing someone else's custom set, reward the creator
            verseSetName = foundSet.title || verseSetName;
          }
        }

        const currentPlayerName = playerName || localStorage.getItem('verserain_playerName') || 'Guest';

        fetch("/api/submit-creator-point", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: authorToReward, amount: vCount, player: currentPlayerName, verseSetName })
        }).catch(e => e);

        // Phase 1 Gamification: Reward Inviter & Invitee (Using Dedicated Points, NOT Fruits)
        const inviter = localStorage.getItem('verserain_inviter');
        const claimed = localStorage.getItem('verserain_invite_claimed');
        if (inviter && inviter !== personalCode && !claimed) {
          // Reward the inviter (+1 fruit, +5000 score)
          fetch("/api/submit-referral-point", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ author: inviter, amount: 1, scoreAmount: 5000, player: currentPlayerName, type: 'referred' })
          }).catch(e => e);

          // Reward the new player (+1 fruit)
          fetch("/api/submit-referral-point", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ author: personalCode || currentPlayerName, amount: 1, scoreAmount: 0, player: inviter, type: 'invited_by' })
          }).catch(e => e);

          localStorage.setItem('verserain_invite_claimed', 'true');
          setToast(`成功透過 ${inviter} 的邀請首次過關！雙方各獲 1 顆果子，推薦者額外獲得 5000 積分！`);
          setTimeout(() => setToast(null), 4000);
        }
      }

      logEvent('verseCompleted', {
        ref: activeVerse.reference,
        name: playerName,
        isChamp: hs,
        setId: selectedSetId,
        amount: vCount
      });
      // Load current leaderboard initially
      fetch(`/api/get-scores?verseRef=${encodeURIComponent(activeVerse.reference)}`)
        .then(res => res.json())
        .then(data => setLeaderboard(data && Array.isArray(data.alltime) ? data : { alltime: Array.isArray(data) ? data : [], monthly: [], daily: [] }))
        .catch(err => console.log("Leaderboard not ready or fetch failed"));

      // If user is already identified, auto-submit their score behind the scenes
      if (playerName && finalCalculatedScore > 0 && healthRef.current > 0) {
        setIsSubmittingScore(true);
        const actualModeName = distractionLevel > 0 ? `${playMode}-dx${distractionLevel}` : playMode;

        setIsSubmittingScore(true);
        fetch('/api/submit-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: playerName, score: finalCalculatedScore, verseRef: activeVerse.reference, mode: actualModeName })
        }).then(() => {
          // Also submit geolocation for the world map (fire-and-forget)
          fetch('https://ipapi.co/json/')
            .then(r => r.json())
            .then(geo => {
              if (geo && geo.latitude && geo.longitude) {
                fetch('/api/submit-location', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: playerName,
                    score: finalCalculatedScore,
                    lat: geo.latitude,
                    lng: geo.longitude,
                    country: geo.country_name || geo.country,
                    city: geo.city || '',
                    verseRef: activeVerse.reference
                  })
                }).catch(() => { });
              }
            }).catch(() => { });
          return fetch(`/api/get-scores?verseRef=${encodeURIComponent(activeVerse.reference)}`);
        }).then(res => res.json())
          .then(data => setLeaderboard(data && Array.isArray(data.alltime) ? data : { alltime: Array.isArray(data) ? data : [], monthly: [], daily: [] }))
          .catch(e => console.log(e))
          .finally(() => setIsSubmittingScore(false));
      }
    }

    if (hs) {
      setBestScore(finalCalculatedScore);
      localStorage.setItem(`verseRainBestScore_${activeVerse.reference}`, finalCalculatedScore);
    }

    if (isSuccess) {
      const playVictorySounds = () => {
        playTada();
        if (hs) {
          setTimeout(triggerFireworks, 500); // Small delay for the tada to ring out
        } else if (f) {
          triggerFlawless();
        }
      };

      if (speechRef.current) {
        speechRef.current.then(playVictorySounds);
      } else {
        playVictorySounds();
      }
    }

    setCampaignResults(prev => {
      if (campaignQueue !== null) {
        return [...prev, { verse: activeVerse, score: isSuccess ? finalCalculatedScore : 0, flawless: f, health: healthRef.current }];
      }
      return prev;
    });
  };

  useEffect(() => {
    if (currentSeqIndex >= activePhrases.length && activePhrases.length > 0 && gameState === 'playing') {
      if (multiplayerRoomId) {
        if (multiplayerState?.playMode?.endsWith('_solo')) {
          // Calculate time bonus for multiplayer verse completion
          let calculatedTimeBonus = 0;
          if (healthRef.current > 0) {
            calculatedTimeBonus = Math.floor(Math.max(0, timeLeftRef.current) * 0.5);
          }
          let finalCalculatedScore = scoreRef.current + calculatedTimeBonus;
          if (distractionLevel > 0 && finalCalculatedScore > 0) {
            finalCalculatedScore = Math.floor(finalCalculatedScore * (1 + distractionLevel * 0.1));
          }

          const isTeamCompetition = multiplayerState?.matchType === 'team';

          // Submit personal scores only for individual PK rooms. Team competition is an ephemeral classroom result.
          if (!isTeamCompetition && playerName && finalCalculatedScore > 0 && healthRef.current > 0) {
            const actualModeName = distractionLevel > 0 ? `${playMode}-dx${distractionLevel}` : playMode;
            fetch('/api/submit-score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: playerName, score: finalCalculatedScore, verseRef: activeVerse.reference, mode: actualModeName })
            }).catch(() => { });
          }

          // Report this verse's score to server (server accumulates campaign results)
          if (socketRef.current) {
            socketRef.current.send(JSON.stringify({
              type: 'PLAYER_PROGRESS',
              score: finalCalculatedScore,
              health: healthRef.current,
              seqIndex: currentSeqIndex
            }));
            socketRef.current.send(JSON.stringify({
              type: 'PLAYER_FINISHED_VERSE',
              verseRef: activeVerse.reference,
              score: finalCalculatedScore,
              verseIndex: localVerseIndexRef.current
            }));
          }
          const nextIndex = localVerseIndexRef.current + 1;
          localVerseIndexRef.current = nextIndex;
          if (nextIndex < localCampaignListRef.current.length) {
            // Show 5-second countdown before next verse
            const nextVerse = localCampaignListRef.current[nextIndex];
            setLocalNextVerse(nextVerse);
            setGameState('intermission');
            // Countdown duration scales with difficulty level
            const countdownByLevel = [5, 3, 2, 1];
            startLocalIntermissionCountdown(countdownByLevel[distractionLevel] || 5);
          } else {
            // All verses done — tell server and show the waiting room
            if (socketRef.current) {
              socketRef.current.send(JSON.stringify({ type: 'PLAYER_FINISHED_ALL' }));
            }
            setGameState('waiting_for_others');
          }
        }
        return;
      } else {
        if (campaignQueue !== null && campaignQueue.length > 0) {
          // Auto advance to next verse in campaign
          let calculatedTimeBonus = 0;
          if (healthRef.current > 0) {
            calculatedTimeBonus = Math.floor(Math.max(0, timeLeftRef.current) * 0.5);
          }
          let finalCalculatedScore = scoreRef.current + calculatedTimeBonus;
          if (distractionLevel > 0 && finalCalculatedScore > 0) {
            finalCalculatedScore = Math.floor(finalCalculatedScore * (1 + distractionLevel * 0.1));
          }

          const f = healthRef.current === 3;

          setCampaignResults(prev => [...prev, { verse: activeVerse, score: finalCalculatedScore, flawless: f, health: healthRef.current }]);

          if (playerName && finalCalculatedScore > 0 && healthRef.current > 0) {
            const actualModeName = distractionLevel > 0 ? `${playMode}-dx${distractionLevel}` : playMode;
            fetch('/api/submit-score', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: playerName, score: finalCalculatedScore, verseRef: activeVerse.reference, mode: actualModeName })
            }).catch(() => { });
          }

          const nextVerse = campaignQueue[0];
          const nextQueue = campaignQueue.slice(1);
          const advanceToNextVerse = () => {
            if (gameStateRef.current !== 'playing') return;
            setActiveVerse(nextVerse);
            setCampaignQueue(nextQueue);
            campaignQueueRef.current = nextQueue;
            setCurrentSeqIndex(0);
            currentSeqRef.current = 0;
            startGame(isAutoPlayRef.current, nextVerse);
          };

          const shouldPauseBeforeNextVerse = isAutoPlayRef.current || playMode?.startsWith('voice') || isBlindMode;
          if (shouldPauseBeforeNextVerse) {
            if (!isAutoPlayRef.current) playTada();
            setTimeout(advanceToNextVerse, AUTO_PLAY_VERSE_PAUSE_MS);
          } else {
            playTada();
            setTimeout(advanceToNextVerse, 50);
          }
        } else {
          endGame();
        }
      }
    }
  }, [currentSeqIndex, gameState, activePhrases.length, multiplayerRoomId, multiplayerState?.playMode, multiplayerState?.matchType, campaignQueue, activeVerse, playerName, distractionLevel, playMode, isBlindMode]);

  // Submit Verse Set score when campaign finishes
  useEffect(() => {
    if (gameState === 'campaign-results' && activeCampaignSetId && playerName) {
      const totalScore = campaignResults.reduce((sum, r) => sum + r.score, 0);
      const passedCount = campaignResults.filter(r => r.health > 0).length;
      const totalCount = activeCampaignSetTotal || campaignResults.length;
      const actualModeName = distractionLevel > 0 ? `${playMode}-dx${distractionLevel}` : playMode;

      if (totalScore > 0) {
        fetch('/api/submit-set-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            setId: activeCampaignSetId,
            name: playerName,
            score: totalScore,
            mode: actualModeName,
            passedCount,
            totalCount
          })
        }).catch(() => {});
      }
      
      // Clear the tracking id so it doesn't submit multiple times if state changes for other reasons
      setActiveCampaignSetId(null);
    }
  }, [gameState, activeCampaignSetId, playerName, campaignResults, playMode, distractionLevel]);

  // Fetch Set Leaderboard Data
  useEffect(() => {
    if (showSetLeaderboard && leaderboardSetId) {
      setIsLoadingLeaderboard(true);
      fetch(`/api/get-set-scores?setId=${leaderboardSetId}&limit=10&offset=${leaderboardPage * 10}`)
        .then(res => res.json())
        .then(data => {
          setLeaderboardData(data.records || []);
          setLeaderboardTotal(data.totalRecords || 0);
          setIsLoadingLeaderboard(false);
        })
        .catch(err => {
          console.error(err);
          setIsLoadingLeaderboard(false);
        });
    }
  }, [showSetLeaderboard, leaderboardSetId, leaderboardPage]);

  // Sync individual progress for solo multiplayer mode
  useEffect(() => {
    if (multiplayerRoomId && gameState === 'playing' && multiplayerState?.playMode?.endsWith('_solo') && socketRef.current) {
      socketRef.current.send(JSON.stringify({
        type: 'PLAYER_PROGRESS',
        score: score,
        health: health,
        seqIndex: currentSeqIndex
      }));
    }
  }, [score, health, currentSeqIndex, multiplayerRoomId, gameState, multiplayerState?.playMode]);

  const handleAnimationEnd = (e, id) => {
    if (e.animationName === 'fall') {
      if (gameState === 'playing') {
        spawnNextBlock(id);
      } else {
        setBlocks(prev => prev.filter(b => b.id !== id));
      }
    }
  };

  const handleBlockClick = (block) => {
    if (block.correct || block.error || block.claimedBy) return;

    // Removed legacy speech stop to preserve Voice Mode buffer

    if (multiplayerRoomId && socketRef.current && gameState === 'playing') {
      if (!multiplayerState?.playMode?.endsWith('_solo')) {
        socketRef.current.send(JSON.stringify({ type: 'CLICK_BLOCK', blockId: block.id }));
        return; // Local state will be updated via socket broadcast
      }
    }

    if (block.seqIndex === currentSeqIndex || block.text === activePhrases[currentSeqIndex]) {
      // Voice should remain at normal speed so the user doesn't get nervous
      const voiceRate = 1.0;

      setScore(s => s + 100 + (combo * 50));
      setCombo(c => c + 1);

      const nextSeq = currentSeqIndex + 1;
      const TTS_LANG = getVoiceLangForVersion(version);

      speechRef.current = speakText(block.text, voiceRate, TTS_LANG);
      setCurrentSeqIndex(nextSeq);
      currentSeqRef.current = nextSeq; // Update instantly before useEffect triggers

      setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, correct: true } : b));

      if (gameState === 'playing') {
        if (playMode.startsWith('square')) {
          const maxGridSize = distractionLevel <= 1 ? 4 : 9;
          const fakesCount = distractionLevel > 0 ? distractionLevel : 0;
          const nextSpawnIndex = currentSeqIndex + (maxGridSize - fakesCount);
          setTimeout(() => {
            setBlocks(prev => {
              const fakesOnScreen = prev.filter(b => b.isFake && !b.hidden).length;
              let spawnFake = distractionLevel > 0 && fakesOnScreen < distractionLevel && Math.random() < 0.5;

              let updated = prev.map(b => {
                if (b.id !== block.id) return b;

                if (nextSpawnIndex < activePhrases.length) {
                  return {
                    id: Math.random().toString(36).substr(2, 9),
                    text: activePhrases[nextSpawnIndex],
                    seqIndex: nextSpawnIndex,
                    isSquare: true,
                    error: false,
                    correct: false,
                    hidden: false
                  };
                } else {
                  return { ...b, hidden: true };
                }
              });

              if (spawnFake) {
                const newFake = {
                  id: Math.random().toString(36).substr(2, 9),
                  text: getRandomFakePhrase(version, VERSES_DB),
                  seqIndex: -1,
                  isSquare: true, error: false, correct: false, hidden: false, isFake: true
                };
                const hiddenIdx = updated.findIndex(b => b.hidden);
                if (hiddenIdx !== -1) {
                  updated[hiddenIdx] = newFake;
                }
              }

              updated.sort(() => Math.random() - 0.5);
              return updated;
            });
          }, 400);
        } else {
          spawnNextBlock();
          setTimeout(() => {
            setBlocks(prev => prev.filter(b => b.id !== block.id));
          }, 400);
        }
      }

    } else {
      playBong();
      setCombo(0);
      setScore(s => Math.max(0, s - 100)); // Apply mistake penalty, preventing negative score
      setHealth(h => {
        const newHealth = h - 1;
        if (newHealth === 2) {
          playThunder('light');
          triggerLightning('light');
        } else if (newHealth <= 0) {
          playThunder('heavy');
          triggerLightning('heavy');
          // In multiplayer square_solo: auto-advance to next verse instead of being stuck
          if (multiplayerRoomId && multiplayerState?.playMode?.endsWith('_solo') && multiplayerSoloActiveRef.current) {
            setTimeout(() => {
              // Report failed verse with score 0
              if (socketRef.current) {
                socketRef.current.send(JSON.stringify({
                  type: 'PLAYER_FINISHED_VERSE',
                  verseRef: activeVerse?.reference || '',
                  score: 0,
                  verseIndex: localVerseIndexRef.current
                }));
              }
              const nextIndex = localVerseIndexRef.current + 1;
              localVerseIndexRef.current = nextIndex;
              if (nextIndex < localCampaignListRef.current.length) {
                const nextVerse = localCampaignListRef.current[nextIndex];
                setLocalNextVerse(nextVerse);
                setGameState('intermission');
                const countdownByLevel = [5, 3, 2, 1];
                startLocalIntermissionCountdown(countdownByLevel[distractionLevel] || 5);
              } else {
                if (socketRef.current) {
                  socketRef.current.send(JSON.stringify({ type: 'PLAYER_FINISHED_ALL' }));
                }
                setGameState('waiting_for_others');
              }
            }, 800);
          }
          return 0;
        }
        return newHealth;
      });

      setBlocks(prev => prev.map(b => b.id === block.id ? { ...b, error: true } : b));
      setTimeout(() => {
        setBlocks(prev => {
          let updated = prev;
          if (playMode.startsWith('square') && block.seqIndex === -1) {
            // Return prev mapped to hidden so we preserve grid length
            updated = prev.map(b => b.id === block.id ? { ...b, error: false, hidden: true, isFake: false } : b);
          } else {
            updated = prev.map(b => b.id === block.id ? { ...b, error: false } : b);
          }

          return updated;
        });
      }, 400);
    }
  };

  const handleGlobalClick = (e) => {
    if (gameState !== 'playing') return;

    // Ignore clicks if they click directly on the top HUD UI elements
    if (e.target.closest('.hud-glass')) return;

    const elements = document.querySelectorAll('.falling-wrapper');
    if (elements.length === 0) return;

    let closestId = null;
    let minDistance = Infinity;

    elements.forEach(el => {
      const inner = el.querySelector('.falling-block-inner');
      if (!inner) return;

      const rect = inner.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Euclidean distance to determine "intent"
      const dist = Math.sqrt(Math.pow(e.clientX - centerX, 2) + Math.pow(e.clientY - centerY, 2));

      if (dist < minDistance) {
        minDistance = dist;
        closestId = el.getAttribute('data-id');
      }
    });

    if (closestId) {
      const clickedBlock = blocks.find(b => b.id === closestId);
      if (clickedBlock) {
        handleBlockClick(clickedBlock);
      }
    }
  };

  // ─── Farsi (Persian) UI Dictionary ───────────────────────────────────────





const zhcnDict = {
    '【更多好文】': "【更多好文】",
    '輸入出處批次匯入': "输入出处批次导入",
    '麥克風聽見：': "麦克风听见:",
    '背景圖片': "背景图片",
    '預設(每日輪換)': "预设(每日轮换)",
    '上傳圖片': "上传图片",
    '自訂圖片 ✓': "自定图片 ✓",
    '自訂背景': "自定背景",
    '上傳中…': "上传中…",
    '兒童': "儿童",
    '長者': "长者",
    '家庭': "家庭",
    '十字架': "十字架",
    '自然・創造': "自然・创造",
    '醫治': "医治",
    '平安': "平安",
    '敬拜・讚美': "敬拜・赞美",
    '禱告': "祷告",
    '光・興起發光': "光・兴起发光",
    '豐收・果實': "丰收・果实",
    '牧人・詩篇23': "牧人・诗篇23",
    '背景音樂': "背景音乐",
    '預設音樂': "预设音乐",
    '無背景音樂': "无背景音乐",
    '自訂音樂 ✓(點擊更換)': "自定音乐 ✓(点击更换)",
    '上傳 MP3(≤3分鐘,≤5MB)': "上传 MP3(≤3分钟,≤5MB)",
    '停止試聽': "停止试听",
    '載入中…': "载入中…",
    '音量': "音量",
    '背景圖片已上傳 ✓': "背景图片已上传 ✓",
    '背景音樂已上傳 ✓': "背景音乐已上传 ✓",
    '音樂檔請小於 5MB': "音乐文件请小于 5MB",
    '每行或以逗號分隔貼上段落(例:太 19:14、詩 139:13-14),系統會自動抓取內容內容。': "每行或以逗号分隔贴上段落(例:太 19:14、诗 139:13-14),系统会自动抓取内容内容。",
    '輸入出處來建立內容集': "输入出处来建立内容集",
    '匯入': "导入",
    '匯入中…': "导入中…",
    '朗讀這節': "朗读这节",
  "我的園子": "我的园子",
  "🌳 我的園子": "🌳 我的园子",
  "多人連線": "多人连线",
  "🎮 多人連線": "🎮 多人连线",
  "排行榜": "排行榜",
  "🏆 排行榜": "🏆 排行榜",
  "搜尋": "搜寻",
  "🔍 搜尋": "🔍 搜寻",
  "地圖": "地图",
  "🗺️ 地圖": "🗺️ 地图",
  "返回目錄": "返回目录",
  "目前選擇": "目前选择",
  "九宮格": "九宫格",
  "四宮格": "四宫格",
  "內容雨": "内容雨",
  "單字干擾": "单字干扰",
  "無干擾": "无干扰",
  "難度 0": "难度 0",
  "難度 1": "难度 1",
  "難度 2": "难度 2",
  "難度 3": "难度 3",
  "挑戰": "挑战",
  "隨機播放": "随机播放",
  "邀人PK": "邀人PK",
  "段落(點擊觀看)": "段落(点击观看)",
  "排行": "排行",
  "設定": "设定",
  "選擇比賽內容集": "选择比赛内容集",
  "沒有找到匹配的內容集。": "没有找到匹配的内容集。",
  "準備！": "准备！",
  "已準備": "已准备",
  "開始": "开始",
  "加入對戰": "加入对战",
  "建立對戰": "建立对战",
  "你的名字:": "你的名字:",
  "登入 / 修改": "登入 / 修改",
  "登出": "登出",
  "內容集": "内容集",
  "隨機挑戰所選題數": "随机挑战所选题数",
  "隨機播放所選數量的內容圖卡與語音": "随机播放所选数量的内容图卡与语音",
  "邀請朋友一起玩": "邀请朋友一起玩",
  "分享挑戰連結": "分享挑战连结",
  "經典挑戰": "经典挑战",
  "立刻挑戰": "立刻挑战",
  "最受歡迎": "最受欢迎",
  "主題": "主题",
  "最新": "最新",
  "作者": "作者",
  "點閱次數": "点阅次数",
  "Verserain 官方": "Verserain 官方",
  "匿名玩家": "匿名玩家",
  "QR 碼": "QR 码",
  "通關紀錄": "通关纪录",
  "大廳": "大厅",
  "回到大廳": "回到大厅",
  "進階功能": "进阶功能",
  "解鎖進階功能": "解锁进阶功能",
  "身為 Lv.3 以上的實踐者，你現在可以前往「進階功能 ➔ 我的內容集」自由創建與分享你專屬的內容集了！": "身为 Lv.3 以上的实践者，你现在可以前往“进阶功能 ➔ 我的内容集”自由创建与分享你专属的内容集了！",
  "申請帳號": "申请账号",
  "登入帳號": "登入账号",
  "登入": "登入",
  "在此登入": "在此登入",
  "請複製密碼後貼到上方密碼欄位登入": "请复制密码后贴到上方密码字段登入",
  "返回登入": "返回登入",
  "驗證": "验证",
  "建立新帳號 ": "建立新账号 ",
  "一起玩!": "一起玩!",
  "📨 邀請朋友一起玩": "📨 邀请朋友一起玩",
  "朗讀": "朗读",
  "讀經": "读经",
  "換一個": "换一个",
  "與家人朋友分享房間碼來PK同樂！": "与家人朋友分享房间码来PK同乐！",
  "挑戰全球內容集，鍛鍊記憶力與專注力。": "挑战全球内容集，锻炼记忆力与专注力。",
  "日日澆灌讀書田，年年結果滿枝頭。": "日日浇灌读书田，年年结果满枝头。",
  "選擇你喜歡的語音，首頁「讀經」及遊戲中的語音都會使用此設定。": "选择你喜欢的语音，首页“读经”及游戏中的语音都会使用此设定。",
  "我的內容集": "我的内容集",
  "新增內容集": "新增内容集",
  "進階設定與學習": "进阶设定与学习",
  "標題": "标题",
  "簡介": "简介",
  "段落列表": "段落列表",
  "新增一段": "新增一段",
  "儲存內容集": "储存内容集",
  "取消": "取消",
  "公開此內容集 (Publish to Global Verse Sets)": "公开此内容集 (Publish to Global Verse Sets)",
  "編輯內容集": "编辑内容集",
  "建立新內容集": "建立新内容集",
  '上傳錄音檔': '上传录音文件',
  '不要複誦我背過的內容(比較順暢)': '不要复诵我背过的内容(比较顺畅)',
  '預備…': '预备…',
  '開始！': '开始！',
  '麥克風權限被拒絕。請點網址列左邊的鎖頭 → 允許麥克風,然後重新整理。': '麦克风权限被拒绝。请点网址栏左边的锁头 → 允许麦克风，然后刷新。',
  '瀏覽器不允許使用語音辨識服務。請改用 Chrome 或 Safari。': '浏览器不允许使用语音识别服务。请改用 Chrome 或 Safari。',
  '找不到可用的麥克風。Chrome 可能選到了虛擬裝置(BlackHole、Zoom 等),請到 Chrome 設定 → 隱私權和安全性 → 網站設定 → 麥克風 改選內建麥克風。': '找不到可用的麦克风。Chrome 可能选到了虚拟设备(BlackHole、Zoom 等)，请到 Chrome 设置 → 隐私和安全 → 网站设置 → 麦克风 改选内置麦克风。',
  '語音辨識連線中斷,重試中…(桌面版 Chrome 需要網路才能辨識)': '语音识别连接中断，重试中…(桌面版 Chrome 需要网络才能识别)',
  '語音辨識錯誤：': '语音识别错误：',
  '已經有錄好的 MP3?按📂上傳': '已经有录好的 MP3？按📂上传',
  '只接受 MP3 檔案。WAV 等未壓縮格式太大,請先轉成 MP3 再上傳。': '只接受 MP3 文件。WAV 等未压缩格式太大，请先转成 MP3 再上传。',
  '檔案太大({size} MB),上限約 8.5 MB。請把錄音剪短一些。': '文件太大({size} MB)，上限约 8.5 MB。请把录音剪短一些。',
  '這個檔案無法播放,請確認它是有效的 MP3。': '这个文件无法播放，请确认它是有效的 MP3。',
  '重新選擇': '重新选择',
  "（建立專屬內容集不需要階級 —— 登入就可以。）": "（建立专属内容集不需要阶级 —— 登录就可以。）",
  "測試遊玩": "测试游玩",
  "編輯": "编辑",
  "刪除": "删除",
  "語音模式": "语音模式",
  "多人即時連線對戰": "多人即时连线对战",
  "使用說明": "使用说明",
  "操作詳解": "操作详解",
  "關於我們": "关于我们",
  "VerseRain 開發資訊": "VerseRain 开发资讯",
  "加入進階群組": "加入进阶群组",
  "意見回饋": "意见回馈",
  "聯絡與建議": "联络与建议",
  "關閉視障內容雨": "关闭视障内容雨",
  "打開視障內容雨": "打开视障内容雨",
  "為視覺障礙朋友設計的語音模式": "为视觉障碍朋友设计的语音模式",
  "關閉效能模式": "关闭效能模式",
  "打開效能模式": "打开效能模式",
  "關閉華麗特效以提升流暢度": "关闭华丽特效以提升流畅度",
  "關閉 Debug": "关闭 Debug",
  "打開 Debug": "打开 Debug",
  "顯示除錯資訊": "显示除错资讯",
  "朗讀語音設定": "朗读语音设定",
  "系統預設語音": "系统预设语音",
  "試聽": "试听",
  "語音已更新！": "语音已更新！",
  "這是你選擇的語音試聽。": "这是你选择的语音试听。",
  "已記住你的語音偏好，下次回來會自動使用。": "已记住你的语音偏好，下次回来会自动使用。",
  "舊約": "旧约",
  "新約": "新约",
  "選擇書卷": "选择书卷",
  // 操作手冊：新增功能（v3.27.5）
  "<strong>預備倒數：</strong>宣告段落後，畫面會出現「預備…3…2…1…開始！」的大字倒數，讓你清楚知道什麼時候輪到自己開口。": "<strong>预备倒数：</strong>宣告段落后，画面会出现「预备…3…2…1…开始！」的大字倒数，让你清楚知道什么时候轮到自己开口。",
  "<strong>挑戰前先設定：</strong>按下「挑戰」會先跳出設定視窗，讓你選擇遊戲模式（九宮格／內容雨／語音模式）與難度。語音模式可勾選「不要複誦我背過的內容」，節奏更順暢。": "<strong>挑战前先设定：</strong>按下「挑战」会先跳出设定窗口，让你选择游戏模式（九宫格／内容雨／语音模式）与难度。语音模式可勾选「不要复诵我背过的内容」，节奏更顺畅。",
  "點擊上方的 <strong>「多人遊戲」</strong> 創建專屬房間，邀請小組成員或家人一起加入。": "点击上方的 <strong>「多人游戏」</strong> 创建专属房间，邀请小组成员或家人一起加入。",
  "房主可以從全域內容集中挑選 <strong>「比賽內容」</strong>，並選擇比賽方式：獨立九宮格、雨滴瀑布或語音模式。": "房主可以从全域内容集中挑选 <strong>「比赛内容」</strong>，并选择比赛方式：独立九宫格、雨滴瀑布或语音模式。",
  "<strong>🌍 各自用自己的語言參賽（新）：</strong>在個人賽／邀人PK 模式中，每位玩家都用自己選的聖經版本比賽——主持人用中文，朋友可以用英文 ESV 或韓文，同一段各自看到自己的語言。計分以節數與分數為準，與語言無關，完全公平。團隊競賽因為大家共用同一個盤面，維持主持人的語言。": "<strong>🌍 各自用自己的语言参赛（新）：</strong>在个人赛／邀人PK 模式中，每位玩家都用自己选的圣经版本比赛——主持人用中文，朋友可以用英文 ESV 或韩文，同一段各自看到自己的语言。计分以节数与分数为准，与语言无关，完全公平。团队竞赛因为大家共用同一个盘面，维持主持人的语言。",
  "所有人同時開始挑戰，並能在遊戲結束後看到即時的成績排行榜，非常適合主日學活動與小組破冰！": "所有人同时开始挑战，并能在游戏结束后看到即时的成绩排行榜，非常适合主日学活动与小组破冰！",
  "<strong>不只作者，人人都能錄：</strong>任何登入的玩家都可以為一段錄下自己的聲音並公開分享。打開播放器的「播放方式」→「聲音來源」，就能在 自動／電腦語音／無聲音／作者錄音／其他貢獻者的聲音 之間切換，聽聽弟兄姊妹怎麼讀這一節。": "<strong>不只作者，人人都能录：</strong>任何登录的玩家都可以为一段录下自己的声音并公开分享。打开播放器的「播放方式」→「声音来源」，就能在 自动／电脑语音／无声音／作者录音／其他贡献者的声音 之间切换，听听弟兄姊妹怎么读这一节。",
  "<strong>播放優先順序：</strong>「自動」會優先播你自己的親聲，其次是最新公開的人聲，再來是內容集作者的親聲，最後才是電腦語音（TTS）。只要有人錄過，就不會聽到機器音。": "<strong>播放优先顺序：</strong>「自动」会优先播你自己的亲声，其次是最新公开的人声，再来是内容集作者的亲声，最后才是电脑语音（TTS）。只要有人录过，就不会听到机器音。",
  "<strong>分享你正在聽的聲音：</strong>點 🔗 分享鍵，連結會帶著「你現在正在聽的那個聲音」——不論是你自己、作者或其他貢獻者的親聲，朋友打開連結聽到的就是同一個聲音。若錄音還在上傳，分享鍵會先等上傳完成再產生連結，確保對方一定聽得到。": "<strong>分享你正在听的声音：</strong>点 🔗 分享键，链接会带着「你现在正在听的那个声音」——不论是你自己、作者或其他贡献者的亲声，朋友打开链接听到的就是同一个声音。若录音还在上传，分享键会先等上传完成再产生链接，确保对方一定听得到。",
  "六、播放方式、我的最愛與更多聆聽小工具": "六、播放方式、我的最爱与更多聆听小工具",
  "聆聽畫面的 <strong>「播放方式」</strong> 視窗和幾顆新按鈕，讓連續聆聽更貼近你的習慣：": "聆听画面的 <strong>「播放方式」</strong> 窗口和几颗新按钮，让连续聆听更贴近你的习惯：",
  "<strong>⏱️ 播放時間：</strong>可設定播放幾分鐘後自動停止，或無限循環播放——睡前、靈修時段都好用。": "<strong>⏱️ 播放时间：</strong>可设定播放几分钟后自动停止，或无限循环播放——睡前、灵修时段都好用。",
  "<strong>🔠 字體大小：</strong>同一個視窗裡可以調整聆聽畫面的字級，長輩或投影使用時把字放大更清楚。": "<strong>🔠 字体大小：</strong>同一个窗口里可以调整聆听画面的字级，长辈或投影使用时把字放大更清楚。",
  "<strong>⭐ 我的最愛：</strong>聆聽時點播放器上的星星，或在「我的內容集」的卡片上點星星，就能把內容集加入我的最愛。清單可用「我的最愛」排序，而且會跟著帳號同步到每一台裝置；從大廳「好文欣賞」進入後，也能直接挑「我的最愛」來聽。": "<strong>⭐ 我的最爱：</strong>聆听时点播放器上的星星，或在「我的内容集」的卡片上点星星，就能把内容集加入我的最爱。清单可用「我的最爱」排序，而且会跟着账号同步到每一台设备；从大厅「好文欣赏」进入后，也能直接挑「我的最爱」来听。",
  "<strong>▶️ 一鍵播放：</strong>「我的內容集」每張卡片都多了「播放」鍵，不必先進入內容集就能開始連續聆聽（可選隨機或按序）。": "<strong>▶️ 一键播放：</strong>「我的内容集」每张卡片都多了「播放」键，不必先进入内容集就能开始连续聆听（可选随机或按序）。",
  "<strong>🔄 雙語對調：</strong>讀經頁的「朗讀第二語言」按鈕會暫時把主／次語言互換，改用第二語言落字並朗讀，原語言退到下方小字；離開後自動還原，練習外語聽讀很方便。": "<strong>🔄 双语对调：</strong>读经页的「朗读第二语言」按钮会暂时把主／次语言互换，改用第二语言落字并朗读，原语言退到下方小字；离开后自动还原，练习外语听读很方便。",
  "<strong>⚡ 邊聽邊挑戰：</strong>聆聽中按 ⚡ 立刻挑戰這一節；結束後按「返回朗讀」會回到同一節並暫停等你，按播放或 ‹ › 就能接著聽下一節。": "<strong>⚡ 边听边挑战：</strong>聆听中按 ⚡ 立刻挑战这一节；结束后按「返回朗读」会回到同一节并暂停等你，按播放或 ‹ › 就能接着听下一节。",
  "七、內容集一鍵「翻譯」到其他語言": "七、内容集一键「翻译」到其他语言",
  "辛苦建好的內容集，想給說別種語言的弟兄姊妹用？現在不必重打一次。": "辛苦建好的内容集，想给说别种语言的弟兄姊妹用？现在不必重打一次。",
  "在內容集詳情頁點 <strong>「翻譯」</strong>，選擇目標語言。系統會自動翻譯標題、把每節出處換成該語言的書名，並抓取<strong>該語言官方譯本的真實內容</strong>（不是機器翻譯的內容）。": "在内容集详情页点 <strong>「翻译」</strong>，选择目标语言。系统会自动翻译标题、把每节出处换成该语言的书名，并抓取<strong>该语言官方译本的真实内容</strong>（不是机器翻译的内容）。",
  "預覽畫面可以修改標題、逐節查看成功／失敗並重試；確認後點 <strong>「加入並編輯」</strong>，內容集就會發佈到該語言的內容集，並自動切換過去讓你補上簡介。": "预览画面可以修改标题、逐节查看成功／失败并重试；确认后点 <strong>「加入并编辑」</strong>，内容集就会发布到该语言的内容集，并自动切换过去让你补上简介。",
  "VerseRain 現已支援 20 多種聖經版本與介面語言：繁／簡中文、台語、英文（KJV／ESV／NIV）、日文、韓文、西班牙文、葡萄牙文、法文、德文、俄文、印地文、阿拉伯文、波斯文、希伯來文、土耳其文、緬甸文、越南文、印尼文與馬來文——切換左上角的「版本」即可。": "VerseRain 现已支持 20 多种圣经版本与界面语言：繁／简中文、台语、英文（KJV／ESV／NIV）、日文、韩文、西班牙文、葡萄牙文、法文、德文、俄文、印地文、阿拉伯文、波斯文、希伯来文、土耳其文、缅甸文、越南文、印尼文与马来文——切换左上角的「版本」即可。",
  "八、全球玩家地圖（2D／3D）": "八、全球玩家地图（2D／3D）",
  "點上方的 <strong>「地圖」</strong> 頁籤，看看世界各地的內容雨玩家都在哪裡。": "点上方的 <strong>「地图」</strong> 页签，看看世界各地的内容雨玩家都在哪里。",
  "點擊標記可以查看該玩家的成績；地圖上若有進行中的多人遊戲房間，<strong>雙擊房間就能直接加入戰局</strong>！": "点击标记可以查看该玩家的成绩；地图上若有进行中的多人游戏房间，<strong>双击房间就能直接加入战局</strong>！",
  "右上角可在 <strong>「2D 地圖」</strong> 與 <strong>「3D 地球」</strong> 之間切換，轉動地球，看看全球背經的即時脈動。": "右上角可在 <strong>「2D 地图」</strong> 与 <strong>「3D 地球」</strong> 之间切换，转动地球，看看全球背经的实时脉动。",
  // 操作手冊：教學影片與步驟改寫
  "1. 從大廳進入「聽與說」": "1. 从大厅进入「听与说」",
  "在大廳點 <strong>「聽與說」</strong> 卡片，就會看到系統與玩家建立的所有公開內容集，可依最新、標題或最受歡迎排序。": "在大厅点 <strong>「听与说」</strong> 卡片，就会看到系统与玩家建立的所有公开内容集，可依最新、标题或最受欢迎排序。",
  "2. 選擇想要挑戰的內容集": "2. 选择想要挑战的内容集",
  "點選列表中的標題（例如：<strong>約翰福音 核心內容</strong>），進入內容集頁面，裡面列出每一段，右側有「播放」「排行榜」「挑戰」「分享」等按鈕。": "点选列表中的标题（例如：<strong>约翰福音 核心内容</strong>），进入内容集页面，里面列出每一段，右侧有「播放」「排行榜」「挑战」「分享」等按钮。",
  "3. 開始挑戰": "3. 开始挑战",
  "點該節右側的綠色 <strong>⚡ 挑戰</strong> 鍵，選擇遊戲模式（九宮格／內容雨／語音模式）與難度，按「開始挑戰」——三秒後內容雨就傾盆而下！依正確順序點擊落下的方塊，越快完成、時間加成越高。": "点该节右侧的绿色 <strong>⚡ 挑战</strong> 键，选择游戏模式（九宫格／内容雨／语音模式）与难度，按「开始挑战」——三秒后内容雨就倾盆而下！依正确顺序点击落下的方块，越快完成、时间加成越高。",
  "教學影片：從大廳進入聽與說 → 選內容集 → ⚡ 挑戰 → 選模式 → 依序點擊方塊，完成一次挑戰。": "教学视频：从大厅进入听与说 → 选内容集 → ⚡ 挑战 → 选模式 → 依序点击方块，完成一次挑战。",
  "教學影片：左邊是主持人（繁體中文）在內容集頁按「邀人PK」開房；右邊是朋友把版本切成 English - ESV 後輸入代碼加入。比賽開始後，同一段各自看到自己的語言。": "教学视频：左边是主持人（繁体中文）在内容集页按「邀人PK」开房；右边是朋友把版本切成 English - ESV 后输入代码加入。比赛开始后，同一段各自看到自己的语言。",
  "教學影片：在內容集頁按「播放」→ 播放方式視窗設定播放時間、字體大小、聲音來源 → 選「按序」開始連續聆聽。": "教学视频：在内容集页按「播放」→ 播放方式窗口设定播放时间、字体大小、声音来源 → 选「按序」开始连续聆听。",
  "教學影片：大廳「好文欣賞」→ 選「每日一首」或主題好文 → 按「朗讀」做雙語對調（改用第二語言朗讀）→ 按「切換聲音」選電腦語音、無聲音或親聲。": "教学视频：大厅「好文欣赏」→ 选「每日一首」或主题好文 → 按「朗读」做双语对调（改用第二语言朗读）→ 按「切换声音」选电脑语音、无声音或亲声。",
  "教學影片：在內容集頁按「翻譯」→ 選 Bahasa Melayu → 系統翻譯標題並抓取馬來文譯本 → 預覽 16 節全部成功 → 「加入並編輯」。": "教学视频：在内容集页按「翻译」→ 选 Bahasa Melayu → 系统翻译标题并抓取马来文译本 → 预览 16 节全部成功 → 「加入并编辑」。",
  "教學影片：點「地圖」看全球玩家分佈 → 按「3D 地球」→ 拖曳轉動地球。": "教学视频：点「地图」看全球玩家分布 → 按「3D 地球」→ 拖拽转动地球。",
  "同一章的其他節可以用逗號接在後面：「約翰福音 1:1, 4」＝ 1:1 與 1:4；「創世記 1:26-28, 2:7」＝ 同書卷的 2:7。": "同一章的其他节可以用逗号接在后面：「约翰福音 1:1, 4」＝ 1:1 与 1:4；「创世记 1:26-28, 2:7」＝ 同书卷的 2:7。",
  // 操作手冊：第二章改寫、移除排行榜/美化人聲（v3.27.7）
  "歡迎進入 <strong>VerseRain 內容雨</strong>！這是一個結合聆聽、挑戰與學習的互動背經平台。<br />在這裡您可以挑戰全球內容集、建立個人專屬的內容集，也能用自己的聲音把內容分享給朋友！": "欢迎进入 <strong>VerseRain 内容雨</strong>！这是一个结合聆听、挑战与学习的互动背经平台。<br />在这里您可以挑战全球内容集、建立个人专属的内容集，也能用自己的声音把内容分享给朋友！",
  "二、如何自建專屬「內容集」？": "二、如何自建专属「内容集」？",
  "只要登入帳號，任何人都可以打造自己的主日學、小組或個人靈修專屬內容集，建好就能聆聽、挑戰、分享。": "只要登录账号，任何人都可以打造自己的主日学、小组或个人灵修专属内容集，建好就能聆听、挑战、分享。",
  "先<strong>登入</strong>，再從大廳點 <strong>「聽與說」</strong>，進入上方的 <strong>「我的內容集」</strong>。": "先<strong>登录</strong>，再从大厅点 <strong>「听与说」</strong>，进入上方的 <strong>「我的内容集」</strong>。",
  "點 <strong>「＋ 建立新內容集」</strong>，填上標題與簡介；也可以挑一張背景圖片、選背景音樂或上傳自己的音樂。": "点 <strong>「＋ 建立新内容集」</strong>，填上标题与简介；也可以挑一张背景图片、选背景音乐或上传自己的音乐。",
  "在段落列表選好書卷、輸入 <strong>章:節</strong>（如 <code>3:16</code> 或 <code>6:9-13</code>），按 <strong>Enter 或 Tab</strong>，系統就會自動抓取完整內容。": "在段落列表选好书卷、输入 <strong>章:节</strong>（如 <code>3:16</code> 或 <code>6:9-13</code>），按 <strong>Enter 或 Tab</strong>，系统就会自动抓取完整内容。",
  "內容很多？用 <strong>「輸入出處批次匯入」</strong>，一次貼上多個出處（每行一個或用逗號分隔）。逗號後面的純節數會接在同一章：<code>約翰福音 1:1, 4</code> 就是 1:1 與 1:4。": "内容很多？用 <strong>「输入出处批次导入」</strong>，一次贴上多个出处（每行一个或用逗号分隔）。逗号后面的纯节数会接在同一章：<code>约翰福音 1:1, 4</code> 就是 1:1 与 1:4。",
  "每一節旁邊都有 🎙️ 麥克風，可以順手錄下自己的親聲朗讀。": "每一节旁边都有 🎙️ 麦克风，可以顺手录下自己的亲声朗读。",
  "確認無誤後點 <strong>「儲存內容集」</strong>。這份內容集就會出現在「聽與說」，大家都可以聆聽與挑戰。": "确认无误后点 <strong>「储存内容集」</strong>。这份内容集就会出现在「听与说」，大家都可以聆听与挑战。",
  "<strong>提示：</strong>內容抓取串接了各語言的聖經資料庫（和合本、ESV、KJV…），能大幅省去打字與校稿的時間；建好的內容集還能用「翻譯」一鍵在地化到其他語言（見第七章）。": "<strong>提示：</strong>内容抓取串接了各语言的圣经数据库（和合本、ESV、KJV…），能大幅省去打字与校稿的时间；建好的内容集还能用「翻译」一键本地化到其他语言（见第七章）。",
};
  Object.assign(zhcnDict, {
    '團隊競賽': '团队竞赛',
    '內容庫': '内容库',
    "聽一聽，說一說，中英對照學得快。": "听一听，说一说，中英对照学得快。",
    '同心競走天路程，並肩得勝主名榮。': '建立房间，分队一起挑战内容。',
    '老師先選擇隊伍數量，再建立房間。學生加入一個聖靈果子隊伍，最後用隊伍平均分排名。': '老师先选择队伍数量，再建立房间。学生加入一个圣灵果子队伍，最后用队伍平均分排名。',
    '隊伍數量': '队伍数量',
    '仁愛隊': '仁爱队',
    '喜樂隊': '喜乐队',
    '和平隊': '和平队',
    '忍耐隊': '忍耐队',
    '恩慈隊': '恩慈队',
    '良善隊': '良善队',
    '信實隊': '信实队',
    '溫柔隊': '温柔队',
    '節制隊': '节制队',
    '建立房間 (Host Game)': '建立房间',
    '或': '或',
    '輸入房間代碼': '输入房间代码',
    '加入': '加入',
  });






  // Every dictionary had holes: t(zh, en) silently falls back to the English
  // gloss (or, for ja/ko/cuvs, to Traditional Chinese) whenever a key is
  // missing, so a Hebrew user read "My Garden" and "Multiplayer" on an
  // otherwise-Hebrew lobby. i18nFillins.js closes every gap across the 13
  // languages — it is the single source of truth, shared with the standalone
  // /blind route via i18n.js. `npm run check:i18n` fails the build if a new
  // t() key isn't covered there.
  //
  // fillMissing never overwrites an existing translation — the hand-written
  // dictionaries above stay authoritative.
  const fillMissing = (dict, entries) => {
    if (!dict) return;
    for (const [k, v] of Object.entries(entries)) {
      if (!dict[k]) dict[k] = v;
    }
  };
  // ─── pt / fr / ru UI dictionaries (full parity with es/de) ───────────
  // Generated from the shared zh key set; values authored per language.

  // ─── hi UI dictionary (full parity with es/de) ───

  /* __missing_i18n_fill__ — added missing UI strings to every language dict */
  Object.assign(zhcnDict, {
    "推薦碼格式不正確，應為 10 個字母/數字。": "推荐码格式不正确，应为 10 个字母/数字。",
    "不能填自己的推薦碼。": "不能填自己的推荐码。",
    "已綁定推薦人，下次過關會自動補上點數。": "已绑定推荐人，下次过关会自动补上点数。",
    "找不到相機，請確認權限。": "找不到相机，请确认权限。",
    "相機權限被拒絕，請改用手動輸入。": "相机权限被拒绝，请改用手动输入。",
    "無法啟動相機。請改用手動輸入。": "无法启动相机。请改用手动输入。",
    "補上推薦碼": "补上推荐码",
    "掃描推薦人的 QR Code，或貼上邀請連結／10 字元推薦碼。下次過關時雙方都會獲得獎勵。": "扫描推荐人的 QR Code，或贴上邀请连结／10 字元推荐码。下次过关时双方都会获得奖励。",
    "目前 App 版本不支援掃描，請在 Safari 開 verserain.com 掃描，或在下方手動貼上推薦碼。下次 App 更新後會自動可用。": "目前 App 版本不支援扫描，请在 Safari 开 verserain.com 扫描，或在下方手动贴上推荐码。下次 App 更新后会自动可用。",
    "掃描 QR Code": "扫描 QR Code",
    "停止掃描": "停止扫描",
    "或手動輸入": "或手动输入",
    "https://verserain.com/?ref=XXXXXXXXXX 或 XXXXXXXXXX": "https://verserain.com/?ref=XXXXXXXXXX 或 XXXXXXXXXX",
    "儲存": "储存",
    "（暱稱未提供）": "（暱称未提供）",
    "我的推薦人": "我的推荐人",
    "尚未綁定推薦人": "尚未绑定推荐人",
    "此版本 App 尚不支援 Google 登入。請更新 App，或先用下方 email / 密碼登入。": "此版本 App 尚不支援 Google 登入。请更新 App，或先用下方 email / 密码登入。",
    "此版本 App 尚不支援 Apple 登入。請更新 App，或先用下方 email / 密碼登入。": "此版本 App 尚不支援 Apple 登入。请更新 App，或先用下方 email / 密码登入。",
    "Google / Apple 登入尚未設定。請在 src/oauthConfig.js 填入 Client ID。": "Google / Apple 登入尚未设定。请在 src/oauthConfig.js 填入 Client ID。",
    "使用 Google 繼續": "使用 Google 继续",
    "使用 Apple 繼續": "使用 Apple 继续",
    "使用 LINE 繼續": "使用 LINE 继续",
    "暫停": "暂停",
    "我的錄音": "我的录音",
    "錄音": "录音",
    "電腦語音": "电脑语音",
    "無聲音": "无声音",
    "上一節": "上一节",
    "下一節": "下一节",
    "切換聲音": "切换声音",
    "朗讀者：{name}": "朗读者：{name}",
    "留言 / 鼓勵": "留言 / 鼓励",
    "正在載入朗讀…": "正在载入朗读…",
    "親聲處理中…（可繼續錄下一節）": "亲声处理中…（可继续录下一节）",
    "親聲上傳失敗,請重錄": "亲声上传失败,请重录",
    "播放": "播放",
    "親聲上傳中,請稍候…": "亲声上传中,请稍候…",
    "分享（附上你的親聲）": "分享（附上你的亲声）",
    "親聲上傳中…": "亲声上传中…",
    "對調中無法錄音，請先按還原": "对调中无法录音，请先按还原",
    "登入後即可錄製親聲": "登入后即可录制亲声",
    "重錄我的親聲": "重录我的亲声",
    "錄我的親聲": "录我的亲声",
    "對調中無法錄音": "对调中无法录音",
    "登入後可錄音": "登入后可录音",
    "重錄": "重录",
    "選擇第二語言": "选择第二语言",
    "朗讀中：": "朗读中：",
    "第二語言：": "第二语言：",
    "改回第一語言朗讀": "改回第一语言朗读",
    "暫時改用第二語言朗讀（不改變 App 語言）": "暂时改用第二语言朗读（不改变 App 语言）",
    "還原第一語言": "还原第一语言",
    "朗讀第二語言": "朗读第二语言",
    "作者:{n}": "作者:{n}",
    "作者錄音": "作者录音",
    "某人": "某人",
    "此節目前只有電腦語音": "此节目前只有电脑语音",
    "選擇朗讀語音": "选择朗读语音",
    "選好語音就開始用第二語言朗讀。": "选好语音就开始用第二语言朗读。",
    "開始視障版，{title}，{n}段": "开始视障版，{title}，{n}段",
    "雲端同步失敗，稍後再試": "云端同步失败，稍后再试",
    "未命名內容集": "未命名内容集",
    "（複本）": "（复本）",
    "已複製，這份內容集現在是你的了 ✓": "已复制，这份内容集现在是你的了 ✓",
    "上傳失敗:{error}": "上传失败:{error}",
    "音樂請在 3 分鐘以內(會循環播放,不需要長)": "音乐请在 3 分钟以内(会循环播放,不需要长)",
    "已匯入 {n} 段 ✓": "已汇入 {n} 段 ✓",
    "OAuth 登入失敗": "OAuth 登入失败",
    "OAuth 連線失敗": "OAuth 连线失败",
    "找不到此內容，請確認段落": "找不到此内容，请确认段落",
    "這是視障友善版。現在選擇的是 {title}，本次 {n} 段。按開始後，系統會先讀段落，停頓兩秒，再等你開口背誦。若一段時間沒有答對，系統會朗讀提示。遊戲中按 Escape 可以離開。": "这是视障友善版。现在选择的是 {title}，本次 {n} 段。按开始后，系统会先读段落，停顿两秒，再等你开口背诵。若一段时间没有答对，系统会朗读提示。游戏中按 Escape 可以离开。",
    "輕觸下方按鈕開始聆聽。": "轻触下方按钮开始聆听。",
    "開始聆聽": "开始聆听",
    "版本：": "版本：",
    "語音：": "语音：",
    "我收到的鼓勵": "我收到的鼓励",
    "多人遊戲": "多人游戏",
    "同窗同樂共背誦，你來我往比高低。": "同窗同乐共背诵，你来我往比高低。",
    "雙語內容雨 Beta": "双语内容雨 Beta",
    "返回進階功能": "返回进阶功能",
    "測試版會用主要語言朗讀，並在每個方塊下方顯示第二語言。第二行目前是短句估算對齊，適合先測試閱讀感。": "测试版会用主要语言朗读，并在每个方块下方显示第二语言。第二行目前是短句估算对齐，适合先测试阅读感。",
    "主要語言與語音": "主要语言与语音",
    "第二語言顯示": "第二语言显示",
    "開始雙語內容雨": "开始双语内容雨",
    "目前使用「內容雨」官方內容集做測試。": "目前使用「内容雨」官方内容集做测试。",
    "正在載入語言資料...": "正在载入语言资料...",
    "好文欣賞": "好文欣赏",
    "每日一首": "每日一首",
    "已開啟每日一首推播": "已开启每日一首推播",
    "開啟每日一首推播": "开启每日一首推播",
    "每天上午 7 點手機推播今日內容": "每天上午 7 点手机推播今日内容",
    "登入即可建立專屬內容集": "登入即可建立专属内容集",
    "登入你的帳號後，就能自由建立、編輯並分享自己的內容集。": "登入你的帐号后，就能自由建立、编辑并分享自己的内容集。",
    "停止朗讀": "停止朗读",
    "請先儲存內容集,再錄音": "请先储存内容集,再录音",
    "背景美化上傳中…": "背景美化上传中…",
    "處理失敗 — 點擊重錄這節": "处理失败 — 点击重录这节",
    "已有錄音({name})— 點擊重錄": "已有录音({name})— 点击重录",
    "用你的聲音錄這節,聽的人會聽到你唸": "用你的声音录这节,听的人会听到你念",
    "再按一次刪除": "再按一次删除",
    "刪除這節": "删除这节",
    "確定?": "确定?",
    "這節之前是用別的帳號錄的,無法覆蓋。請先刪掉這一行再重加,或用原本的帳號登入。": "这节之前是用别的帐号录的,无法覆盖。请先删掉这一行再重加,或用原本的帐号登入。",
    "錄音處理失敗,請重錄這節": "录音处理失败,请重录这节",
    "貼上段落清單(每行一個),自動抓取內容": "贴上段落清单(每行一个),自动抓取内容",
    "這些行無法辨識或抓不到內容,請修改後重試或手動輸入:": "这些行无法辨识或抓不到内容,请修改后重试或手动输入:",
    "抓取中… {progress}": "抓取中… {progress}",
    "內容集已刪除": "内容集已删除",
    "再按一次確認刪除": "再按一次确认删除",
    "刪除內容集": "删除内容集",
    "發布失敗:{error}。其他人將看不到這個內容集。": "发布失败:{error}。其他人将看不到这个内容集。",
    "排序": "排序",
    "瀏覽": "浏览",
    "複製一份新內容集": "复制一份新内容集",
    "確認刪除？": "确认删除？",
    "第 {page} / {total} 頁": "第 {page} / {total} 页",
    "我也要一起比賽": "我也要一起比赛",
    "關閉則只當主持人（不計分）": "关闭则只当主持人（不计分）",
    "找不到房間「{room}」": "找不到房间「{room}」",
    "多人遊戲準備！": "多人游戏准备！",
    "你是主持人並一起參賽 — 請先選一個隊伍，再按「比賽開始」": "你是主持人并一起参赛 — 请先选一个队伍，再按「比赛开始」",
    "你是主持人並一起參賽，準備好就按「比賽開始」": "你是主持人并一起参赛，准备好就按「比赛开始」",
    "登入後即可建立自訂內容集": "登入后即可建立自订内容集",
    "複製成我的內容集，可自行編輯，不影響原本的": "复制成我的内容集，可自行编辑，不影响原本的",
    "分享聆聽連結(按序播放全部內容)": "分享聆听连结(按序播放全部内容)",
    "連續播放這個內容集（隨機或按序）": "连续播放这个内容集（随机或按序）",
    "暫停朗讀": "暂停朗读",
    "繼續朗讀": "继续朗读",
    "朗讀說明": "朗读说明",
    "繼續": "继续",
    "朗讀": "朗读",
    "播放這一段({name}親聲朗讀)": "播放这一段({name}亲声朗读)",
    "創作者": "创作者",
    "這節有人聲錄音": "这节有人声录音",
    "有人聲錄音": "有人声录音",
    "分享聆聽連結": "分享聆听连结",
    "今日問候": "今日问候",
    "{name}，今日的內容雨活動已累積 {n} 分": "{name}，今日的内容雨活动已累积 {n} 分",
    "今日的內容雨活動已累積 {n} 分": "今日的内容雨活动已累积 {n} 分",
    "連續 {n} 天": "连续 {n} 天",
    "今天開始建立連續紀錄吧！": "今天开始建立连续纪录吧！",
    "最長連續：{n} 天": "最长连续：{n} 天",
    "個人累積": "个人累积",
    "已挑戰": "已挑战",
    "已栽種": "已栽种",
    "結果子": "结果子",
    "前往這個內容集": "前往这个内容集",
    "五、親聲朗讀 — 用你自己的聲音讀經": "五、亲声朗读 — 用你自己的声音读经",
    "在<strong>聆聽內容集</strong>時，你可以錄下自己的聲音來讀某一節。之後再聽這一節，聽到的就是你自己的聲音，而不是電腦語音；還能把它分享給朋友，讓他們也聽見你的親聲。": "在<strong>聆听内容集</strong>时，你可以录下自己的声音来读某一节。之后再听这一节，听到的就是你自己的声音，而不是电脑语音；还能把它分享给朋友，让他们也听见你的亲声。",
    "<strong>錄下你的親聲：</strong>（需先登入）聆聽畫面下方那排按鈕中有一顆 🎙️ 麥克風鍵，點它、照著內容唸一遍、儲存即可。": "<strong>录下你的亲声：</strong>（需先登入）聆听画面下方那排按钮中有一颗 🎙️ 麦克风键，点它、照着内容念一遍、储存即可。",
    "<strong>播放優先順序：</strong>你的親聲 ＞ 內容集作者的親聲 ＞ 電腦語音（TTS）。只要你錄了，聽到的一定是你自己的聲音。": "<strong>播放优先顺序：</strong>你的亲声 ＞ 内容集作者的亲声 ＞ 电脑语音（TTS）。只要你录了，听到的一定是你自己的声音。",
    "<strong>✨ 美化人聲：</strong>錄完可勾選「美化人聲」讓聲音更清晰。處理與上傳會在<strong>背景進行</strong>（畫面顯示「⏳ 親聲處理中…」），你可以馬上去錄下一節，不必等它跑完。": "<strong>✨ 美化人声：</strong>录完可勾选「美化人声」让声音更清晰。处理与上传会在<strong>背景进行</strong>（画面显示「⏳ 亲声处理中…」），你可以马上去录下一节，不必等它跑完。",
    "<strong>分享給朋友聽你的聲音：</strong>點 🔗 分享鍵，朋友打開連結就會聽到你的親聲。若錄音還在上傳，分享鍵會先等上傳完成再產生連結，確保對方一定聽得到。": "<strong>分享给朋友听你的声音：</strong>点 🔗 分享键，朋友打开连结就会听到你的亲声。若录音还在上传，分享键会先等上传完成再产生连结，确保对方一定听得到。",
    "<strong>暫停 / 繼續：</strong>播放親聲錄音時按暫停會停在原處，再按繼續會<strong>從原處接著播</strong>，不會從頭重讀。": "<strong>暂停 / 继续：</strong>播放亲声录音时按暂停会停在原处，再按继续会<strong>从原处接着播</strong>，不会从头重读。",
    "<strong>刪除：</strong>段落下方若顯示「🎙️ 這節有你的親聲」，點旁邊的「刪除 ✕」即可移除你的錄音，之後會回到作者的親聲或電腦語音。": "<strong>删除：</strong>段落下方若显示「🎙️ 这节有你的亲声」，点旁边的「删除 ✕」即可移除你的录音，之后会回到作者的亲声或电脑语音。",
    "<strong>小提示：</strong>聆聽畫面上方中間、顯示日期或主題名稱的按鈕，下面寫著 <strong>【更多好文】</strong> —— 點一下就能展開更多主題好文組，快速切換聆聽不同主題。": "<strong>小提示：</strong>聆听画面上方中间、显示日期或主题名称的按钮，下面写着 <strong>【更多好文】</strong> —— 点一下就能展开更多主题好文组，快速切换聆听不同主题。",
    "多人遊戲進行中": "多人游戏进行中",
    "多人遊戲結束！": "多人游戏结束！",
    "(難度 {n})": "(难度 {n})",
    "設定新密碼": "设定新密码",
    "這個連結只能使用一次，30 分鐘內有效。": "这个连结只能使用一次，30 分钟内有效。",
    "新密碼（至少 6 個字元）": "新密码（至少 6 个字元）",
    "再輸入一次新密碼": "再输入一次新密码",
    "密碼至少需要 6 個字元": "密码至少需要 6 个字元",
    "兩次輸入的密碼不一致": "两次输入的密码不一致",
    "密碼已更新，請用新密碼登入。": "密码已更新，请用新密码登入。",
    "重設失敗": "重设失败",
    "處理中…": "处理中…",
    "更新密碼": "更新密码",
    "註冊成功！請至您的信箱查看驗證碼。": "注册成功！请至您的信箱查看验证码。",
    "重設密碼的連結已寄到您的信箱，30 分鐘內有效。": "重设密码的连结已寄到您的信箱，30 分钟内有效。",
    "點一下開始": "点一下开始",
    "內容會朗讀出聲 🔊": "内容会朗读出声 🔊",
    "播放方式": "播放方式",
    "無限循環播放": "无限循环播放",
    "聲音來源": "声音来源",
    "自動": "自动",
    "把這個人的錄音從此內容集隱藏": "把这个人的录音从此内容集隐藏",
    "確定要隱藏「{n}」的錄音?": "确定要隐藏「{n}」的录音?",
    "按序": "按序",
    "每天早上 7 點，一段開啟你的一天": "每天早上 7 点，一段开启你的一天",
    "開啟推播後，每天早上會收到當日內容，點一下就能聆聽。": "开启推播后，每天早上会收到当日内容，点一下就能聆听。",
    "已開啟每日一首推播 🌧️": "已开启每日一首推播 🌧️",
    "之後再提醒我": "之后再提醒我",
    "不用了，別再詢問": "不用了，别再询问",
    "每日一首推播": "每日一首推播",
    "此瀏覽器不支援推播。請用桌面 Chrome / Edge / Firefox 或 Android Chrome 來啟用。": "此浏览器不支援推播。请用桌面 Chrome / Edge / Firefox 或 Android Chrome 来启用。",
    "iOS 需要先把 VerseRain 加到主畫面": "iOS 需要先把 VerseRain 加到主画面",
    "用 Safari 打開 verserain.com（不要用 App）": "用 Safari 打开 verserain.com（不要用 App）",
    "點下方分享圖示 → 加入主畫面": "点下方分享图示 → 加入主画面",
    "從主畫面點 VerseRain icon 打開": "从主画面点 VerseRain icon 打开",
    "再回到這頁開啟推播": "再回到这页开启推播",
    "通知權限已關閉。請到 iPhone 設定 → VerseRain → 通知 → 允許通知，再回來重試。": "通知权限已关闭。请到 iPhone 设定 → VerseRain → 通知 → 允许通知，再回来重试。",
    "瀏覽器已封鎖通知。請到網站設定 → 通知 → 允許，再回來重試。": "浏览器已封锁通知。请到网站设定 → 通知 → 允许，再回来重试。",
    "開啟後，每天上午 7 點（你的時區）會收到當日 dailyverses.net 內容推播，點通知一鍵進入「聆聽」。": "开启后，每天上午 7 点（你的时区）会收到当日 dailyverses.net 内容推播，点通知一键进入「聆听」。",
    "時區": "时区",
    "關閉推播": "关闭推播",
    "開啟每日推播": "开启每日推播",
    "這節還沒有錄音可留言": "这节还没有录音可留言",
    "選擇聲音": "选择声音",
    "為這個錄音按讚": "为这个录音按赞",
    "讚": "赞",
    "還沒有留言。留下第一句鼓勵吧！": "还没有留言。留下第一句鼓励吧！",
    "語音留言": "语音留言",
    "留一句鼓勵…": "留一句鼓励…",
    "錄語音留言": "录语音留言",
    "登入後即可留言 / 鼓勵": "登入后即可留言 / 鼓励",
    "留一段話,鼓勵 {n} 🎙️": "留一段话,鼓励 {n} 🎙️",
    "這位錄音者": "这位录音者",
    "收到的鼓勵": "收到的鼓励",
    "還沒有收到鼓勵。錄下你的聲音分享給大家吧！": "还没有收到鼓励。录下你的声音分享给大家吧！",
    "喜歡你在〈{ref}〉的錄音": "喜欢你在〈{ref}〉的录音",
    "在〈{ref}〉留言鼓勵你": "在〈{ref}〉留言鼓励你",
    "網路已斷開，部分功能暫時無法使用": "网路已断开，部分功能暂时无法使用",
    "重新連線中…": "重新连线中…",
    "在園子裡持續照顧樹苗並結出果子，就能提升你的互惠階級！": "在园子里持续照顾树苗并结出果子，就能提升你的互惠阶级！",
  });

  const DICT_BY_LANG = { zhcn: zhcnDict };
  for (const [lang, entries] of Object.entries(I18N_FILLINS)) {
    fillMissing(DICT_BY_LANG[lang], entries);
  }
                          
  const t = (zh, en) => {
    if (uiLang === 'en') return en || zh;
    if (uiLang === 'cuvs') return zhcnDict[zh] || zh;
    return zh; // 'zh' — Traditional source strings
  };

  const restartTeamSoloRun = () => {
    if (!multiplayerState?.playMode?.endsWith('_solo')) return;
    const queue = (multiplayerState.campaignQueue && multiplayerState.campaignQueue.length > 0)
      ? multiplayerState.campaignQueue
      : [{ reference: multiplayerState.verseRef, text: multiplayerState.verseText, title: 'Multiplayer' }];
    const firstVerse = queue[0];
    if (!firstVerse?.text) return;

    const verseObj = { reference: firstVerse.reference, text: firstVerse.text, title: firstVerse.title || 'Multiplayer' };
    const nextPlayMode = multiplayerState.playMode || 'square_solo';
    const nextDifficulty = multiplayerState.distractionLevel || 0;
    const phraseCount = splitVersePhrases(verseObj.text).length;

    multiplayerSoloActiveRef.current = true;
    localCampaignListRef.current = queue;
    localVerseIndexRef.current = 0;
    setLocalNextVerse(null);
    setActiveVerse(verseObj);
    setPlayMode(nextPlayMode);
    setDistractionLevel(nextDifficulty);
    setCurrentSeqIndex(0);
    currentSeqRef.current = 0;
    setScore(0);
    setCombo(0);
    setHealth(3);
    setTimeLeft(500 + phraseCount * 500);
    setGameState('playing');

    if (nextPlayMode === 'square_solo') {
      initSquareBlocks(false, null, verseObj, nextPlayMode);
    } else if (nextPlayMode === 'rain_solo') {
      setBlocks([]);
      const spawnWhenReady = () => {
        if (activePhrasesRef.current.length > 0) {
          setTimeout(spawnNextBlock, 100);
          setTimeout(spawnNextBlock, 900);
          setTimeout(spawnNextBlock, 1700);
          setTimeout(spawnNextBlock, 2500);
          setTimeout(spawnNextBlock, 3300);
        } else if (gameStateRef.current === 'playing') {
          setTimeout(spawnWhenReady, 100);
        }
      };
      setTimeout(spawnWhenReady, 100);
    }
  };

  const squareGridSize = distractionLevel <= 1 ? 2 : 3;
  const squareBlockFontSize = useMemo(() => {
    const measureText = (text) => {
      const value = String(text || '').trim();
      if (!value) return 1;
      const cjkCount = (value.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
      const latinCount = Math.max(0, value.length - cjkCount);
      return cjkCount + Math.ceil(latinCount * 0.58);
    };
    const textCandidates = [
      ...activePhrases,
      ...blocks.filter(block => block.isFake && !block.hidden).map(block => block.text)
    ];
    const longest = Math.max(1, ...textCandidates.map(measureText));
    // 讓最長句「對折」成兩行:以半長作為字級依據,字可放更大;超過半長的句子
    // 會自然換成兩行(ceil(longest/2) 保證最多兩行)。短句(≤9)維持單行。
    const perLine = longest > 9 ? Math.ceil(longest / 2) : longest;

    if (squareGridSize === 2) {
      if (perLine <= 4) return 'clamp(3.4rem, min(9vw, 13vh), 8rem)';
      if (perLine <= 7) return 'clamp(2.8rem, min(7vw, 10vh), 6.2rem)';
      if (perLine <= 10) return 'clamp(2.3rem, min(5.6vw, 8vh), 5rem)';
      if (perLine <= 14) return 'clamp(1.95rem, min(4.6vw, 6.6vh), 4rem)';
      return 'clamp(1.6rem, min(3.7vw, 5.4vh), 3.2rem)';
    }

    if (perLine <= 4) return 'clamp(2.4rem, min(6vw, 8vh), 5.5rem)';
    if (perLine <= 7) return 'clamp(2.0rem, min(4.6vw, 6.6vh), 4.2rem)';
    if (perLine <= 10) return 'clamp(1.7rem, min(3.7vw, 5.4vh), 3.3rem)';
    if (perLine <= 14) return 'clamp(1.45rem, min(3.0vw, 4.5vh), 2.7rem)';
    return 'clamp(1.25rem, min(2.5vw, 3.6vh), 2.2rem)';
  }, [activePhrases, blocks, squareGridSize]);

  // 內容雨（下落方塊）字體：仿照九宮格的作法，依每一塊自己的文字長度自動放大，
  // 讓玩家的眼睛不會那麼累。每塊獨立漂浮，故可以各自算出最大可用字級。
  const measureBlockText = React.useCallback((text) => {
    const value = String(text || '').trim();
    if (!value) return 1;
    const cjkCount = (value.match(/[㐀-鿿぀-ヿ가-힯]/g) || []).length;
    const latinCount = Math.max(0, value.length - cjkCount);
    return cjkCount + Math.ceil(latinCount * 0.58);
  }, []);
  const getRainBlockFontSize = React.useCallback((text) => {
    const longest = measureBlockText(text);
    if (longest <= 4) return 'clamp(1.9rem, min(6.5vw, 5.5vh), 3.4rem)';
    if (longest <= 7) return 'clamp(1.6rem, min(5.2vw, 4.6vh), 2.9rem)';
    if (longest <= 10) return 'clamp(1.35rem, min(4.3vw, 3.9vh), 2.4rem)';
    if (longest <= 14) return 'clamp(1.15rem, min(3.5vw, 3.2vh), 2.05rem)';
    return 'clamp(1rem, min(2.9vw, 2.7vh), 1.8rem)';
  }, [measureBlockText]);

  // Sync handleBlockClick to ref so Speech can fire it
  useEffect(() => {
    handleBlockClickRef.current = handleBlockClick;
  }, [handleBlockClick]);

  /* TEMPORARILY REMOVED SPEECH RECOGNITION 
  useEffect(() => {
    if (!isMicOn) {
      ...
    }
  }, [isMicOn, version]);
  */

  const mixedScriptFallbackFontStack = "'Noto Sans Hebrew', 'Noto Sans', 'Vazirmatn', 'PingFang TC', 'PingFang SC', 'Noto Sans TC', 'Noto Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  const cjkDataFontStack = "'PingFang TC', 'PingFang SC', 'Noto Sans TC', 'Noto Sans SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
  const simplifiedChineseFontStack = `'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', -apple-system, BlinkMacSystemFont, 'Segoe UI', ${mixedScriptFallbackFontStack}`;
  const traditionalChineseFontStack = `'PingFang TC', 'Noto Sans TC', -apple-system, BlinkMacSystemFont, 'Segoe UI', ${mixedScriptFallbackFontStack}`;
  const japaneseFontStack = `'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', YuGothic, 'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', ${mixedScriptFallbackFontStack}`;
  const myanmarFontStack = `'Noto Sans Myanmar', 'Myanmar MN', 'Padauk', -apple-system, BlinkMacSystemFont, 'Segoe UI', ${mixedScriptFallbackFontStack}`;
  const latinFontStack = `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', 'Helvetica Neue', Arial, ${mixedScriptFallbackFontStack}`;
  const isActiveLanguage = (code) => uiLang === code || version === code;
  const documentLang = uiLang === 'en' ? 'en' : uiLang === 'cuvs' ? 'zh-Hans' : 'zh-Hant';
  const activeFontStack = uiLang === 'en' ? latinFontStack : uiLang === 'cuvs' ? simplifiedChineseFontStack : traditionalChineseFontStack;
  const scriptureQuoteMarks = ['zh-Hans', 'zh-Hant', 'ja'].includes(documentLang) ? ['「', '」'] : ['"', '"'];

  return (
    <>
      <div
        lang={documentLang}
        dir={isActiveLanguage('fa') || isActiveLanguage('ar') || isActiveLanguage('he') ? 'rtl' : 'ltr'}
        style={{
          fontFamily: activeFontStack,
          '--app-font-family': activeFontStack,
          '--control-font-family': activeFontStack
        }}
        className={performanceMode ? 'performance-mode' : ''}
      >
        <style>
          {`
            @media (orientation: landscape) and (max-height: 800px) {
              .landscape-compact-header { padding: calc(env(safe-area-inset-top) + 4px) max(16px, env(safe-area-inset-right)) 4px max(16px, env(safe-area-inset-left)) !important; }
              .landscape-compact-nav { padding: 4px max(16px, env(safe-area-inset-right)) 4px max(16px, env(safe-area-inset-left)) !important; }
              .landscape-compact-content { margin-top: 8px !important; }
              .app-brand-wordmark { font-size: 1.2rem !important; }
              .landscape-compact-nav > div { padding: 0.3rem 0.8rem !important; font-size: 0.85rem !important; }
            }
          `}
        </style>
        <div className={`bg-layer ${combo >= 3 ? 'golden-bg' : ''}`} />
        <div className={`rain-system ${combo >= 3 ? 'golden-rain' : ''}`}>
          <div className="rain-layer back" />
          <div className="rain-layer mid" />
          <div className="rain-layer front" />
        </div>

        {continuousRainSet && !speechReady && (
          <div className="continuous-rain-overlay" style={{ background: 'rgba(15, 23, 42, 0.97)', zIndex: 999 }}>
            <button type="button" className="continuous-rain-stop" onClick={() => { setContinuousRainSet(null); setMainTab('lobby'); }}>
              <XCircle size={24} /> {t('停止播放', 'Stop')}
            </button>
            <div style={{ display: 'grid', placeItems: 'center', padding: '1.5rem', width: '100%', height: '100%' }}>
              <div className="hud-glass" style={{ maxWidth: '420px', width: '100%', textAlign: 'center', padding: '2rem 1.8rem' }}>
                <div style={{ fontSize: '2.4rem', marginBottom: '0.5rem' }}>🌧️</div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: '#fff', lineHeight: 1.3 }}>
                  {continuousRainSet.title || t('內容集', 'Collection')}
                </h2>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0.6rem 0 1.5rem 0' }}>
                  {t('輕觸下方按鈕開始聆聽。', 'Tap to start listening.')}
                </p>
                <button
                  type="button"
                  className="rain-action-btn play-btn"
                  style={{ width: '100%', fontSize: '1.05rem', padding: '0.9rem 1.5rem', borderRadius: '12px', justifyContent: 'center' }}
                  onClick={() => { initAudio(); setSpeechReady(true); }}
                >
                  <Volume2 size={20} /> {t('開始聆聽', 'Start Listening')}
                </button>
              </div>
            </div>
          </div>
        )}
        {continuousRainSet && speechReady && (
          <VerseSetContinuousRainPlayer
            verseSet={continuousRainSet}
            secondaryVerseSet={findSecondarySetForPrimarySet(continuousRainSet)}
            secondaryVersion={bilingualSecondaryVersion}
            onSecondaryVersionChange={setBilingualSecondaryVersion}
            allSecondaryVerses={allSecondaryVerses}
            topicSets={topicVerseSets}
            favoriteVerseSets={favoriteVerseSets}
            startVerse={continuousRainSet.startVerse || null}
            startPaused={continuousRainSet.startPaused || false}
            playDurationMinutes={continuousRainSet.playDurationMinutes ?? null}
            initialFontSizeLevel={continuousRainSet.fontSizeLevel || DEFAULT_PLAY_FONT_CHOICE}
            version={version}
            t={t}
            userEmail={userEmail}
            playerName={playerName}
            onRequestLogin={() => setShowLoginModal('login')}
            onOpenVoiceComments={openVoiceCommentsFromPlayer}
            onVoiceRecorded={() => setVoiceRefreshTick(x => x + 1)}
            isFavoriteSet={favoriteVerseSetIdSet.has(continuousRainSet.voiceSetId || continuousRainSet.id)}
            onToggleFavoriteSet={() => toggleFavoriteVerseSet(continuousRainSet.voiceSetId || continuousRainSet.id)}
            onSelectDailyVerse={() => { setContinuousRainSet(null); setMainTab('daily_verse'); }}
            onStop={() => {
              setContinuousRainSet(null);
            }}
            onSelectTopicSet={(set) => {
              setSelectedSetId(set.id);
              setContinuousRainSet({
                ...set,
                startVerse: pickRandomVerse(set.verses || []),
                playDurationMinutes: continuousRainSet.playDurationMinutes ?? null,
                fontSizeLevel: continuousRainSet.fontSizeLevel || DEFAULT_PLAY_FONT_CHOICE
              });
            }}
            onListenLogged={() => updateGarden('activity_only', 'listen')}
            onChallengeVerse={challengeVerseFromReader}
            onShareVerse={(verse, shareOpts) => {
              if (!verse || !continuousRainSet?.id) return;
              // Share the REAL originating set, not a synthetic single-verse
              // wrapper (id `single-…`): voiceSetId points back at the source
              // set when the player was opened via the per-verse play button.
              // Recipients then get the full set (starting at this verse) AND
              // the creator recordings resolve correctly.
              const shareSetId = continuousRainSet.voiceSetId || continuousRainSet.id;
              // Find the canonical set object (continuousRainSet.verses may
              // be a subset/transient slice). Prefer customVerseSets first
              // — that's where the latest edits live.
              const fullSet =
                customVerseSets.find(s => s.id === shareSetId) ||
                publishedVerseSets.find(s => s.id === shareSetId) ||
                continuousRainSet;
              pushSetForSharing(fullSet, true);
              // /lc = OG card endpoint — short link; the card resolves the
              // set title + verse text server-side from /share-set.
              const verseIdx = (fullSet.verses || []).findIndex(v => v?.reference === verse.reference);
              const link = buildPublicShareUrl('/lc', {
                set: shareSetId,
                ...(verseIdx >= 0 ? { i: verseIdx } : { verse: verse.reference }),
                // vo = opaque voice-owner id → recipient hears MY personal
                // recording for this verse (my voice › set owner › TTS).
                ...(shareOpts?.voiceOwner ? { vo: shareOpts.voiceOwner } : {}),
                version,
              });
              openListeningShare(link, `${fullSet.title || continuousRainSet.title || t('內容集', 'Collection')} · ${verse.reference}`);
            }}
          />
        )}

        {combo >= 3 && gameState === 'playing' && (
          <div className="particles-system">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="particle"
                style={{
                  left: `${Math.random() * 100}%`,
                  '--duration': `${4 + Math.random() * 6}s`,
                  '--drift': `${(Math.random() - 0.5) * 200}px`,
                  '--max-opacity': `${0.4 + Math.random() * 0.6}`,
                  animationDelay: `${Math.random() * 5}s`
                }}
              />
            ))}
          </div>
        )}

        {/* Global Mic Toggle & Subtitles - Temporarily Disabled */}
        {false && (
          <div style={{ position: 'fixed', bottom: '6.5rem', right: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.8rem', zIndex: 100 }}>
            {liveTranscript && isMicOn && gameState === 'playing' && (
              <div className="hud-glass" style={{ padding: '8px 16px', fontSize: '1rem', color: '#93c5fd', maxWidth: '80vw', textAlign: 'right', wordBreak: 'break-word', border: '1px solid rgba(147, 197, 253, 0.4)', borderRadius: '12px', whiteSpace: 'pre-wrap' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '2px' }}>{t('麥克風聽見：', 'Heard:')}</span>
                <span style={{ color: '#fff' }}>"{liveTranscript}"</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              {micStatusText && <div className="hud-glass" style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#4ade80', animation: 'pulse 2s infinite' }}>{micStatusText}</div>}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const nextMicState = !isMicOn;
                  setIsMicOn(nextMicState);
                  if (nextMicState) setIsMusicPlaying(false);
                }}
                className="hud-glass"
                title={t("語音控制開關", "Toggle Voice Control")}
                style={{ padding: '0.75rem', borderRadius: '50%', color: isMicOn ? '#4ade80' : '#ef4444', backgroundColor: isMicOn ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.3s' }}
              >
                {isMicOn ? <Mic size={24} /> : <MicOff size={24} />}
              </button>
            </div>
          </div>
        )}

        {/* Global Music Toggle - Temporarily Disabled */}
        {false && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsMusicPlaying(!isMusicPlaying); }}
            className="hud-glass"
            style={{ position: 'fixed', bottom: '2rem', right: '1.5rem', padding: '0.75rem', borderRadius: '50%', color: isMusicPlaying ? '#4ade80' : '#cbd5e1', cursor: 'pointer', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {isMusicPlaying ? <Music size={24} /> : <VolumeX size={24} />}
          </button>
        )}

        {gameState === 'menu' && (
          <div style={{ position: 'relative', width: '100vw', height: '100dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', backgroundColor: '#f4f6f8', zIndex: 10, fontFamily: 'var(--app-font-family)' }}>

            {/* Header */}
            <div className="landscape-compact-header app-shell-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <div className="app-header-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div className="app-brand-lockup" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div className="app-brand-wordmark" style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#3b82f6', fontFamily: 'cursive', lineHeight: '1' }}>
                    聽&說
                  </div>
                  <div className="app-brand-version" style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 'bold', letterSpacing: '1px', marginTop: '4px', marginLeft: '2px' }}>
                    v0.1.0
                  </div>
                </div>
                <div ref={langPickerRef} className="app-lang-control" style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="app-language-select"
                    onClick={() => setShowLangPicker(prev => !prev)}
                    title="Language"
                    style={{ padding: '0.3rem 0.7rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#3b82f6', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'var(--control-font-family)', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <span>{t('版本：', 'Version: ')}{BIBLE_LANGUAGE_OPTIONS.find(o => o.value === version)?.label || version}</span>
                    <span style={{ fontSize: '0.6rem', opacity: 0.85 }}>▾</span>
                  </button>
                  {showLangPicker && (
                    <div
                      role="dialog"
                      dir="ltr"
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        // In Hebrew / Persian (RTL) layout the language button
                        // sits on the visual right of the header, so anchor
                        // the dropdown's right edge instead — otherwise it
                        // overflows off-screen to the right.
                        // Use isActiveLanguage (covers both uiLang AND version)
                        // because the dropdown is often opened mid-switch when
                        // uiLang hasn't synced yet — the underlying layout dir
                        // is already RTL via version, so the anchor must match.
                        ...(isActiveLanguage('he') || isActiveLanguage('fa') || isActiveLanguage('ar') ? { right: 0 } : { left: 0 }),
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '10px',
                        boxShadow: '0 18px 35px rgba(15, 23, 42, 0.18), 0 6px 12px rgba(15, 23, 42, 0.08)',
                        padding: '0.55rem',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))',
                        gap: '0.4rem',
                        zIndex: 200,
                        fontFamily: 'var(--control-font-family)',
                      }}
                    >
                      {BIBLE_LANGUAGE_OPTIONS.map(option => {
                        const isActive = option.value === version;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => { handleVersionChange(option.value); setShowLangPicker(false); }}
                            style={{
                              padding: '0.55rem 0.6rem',
                              border: isActive ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                              borderRadius: '7px',
                              background: isActive ? '#3b82f6' : '#f8fafc',
                              color: isActive ? '#ffffff' : '#0f172a',
                              fontSize: '0.85rem',
                              fontWeight: isActive ? 700 : 600,
                              cursor: 'pointer',
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <select
                  className="app-language-select"
                  value={selectedVoiceOptionId}
                  onChange={(e) => saveVoiceForVersion(e.target.value)}
                  title={t('朗讀語音設定', 'Text-to-Speech Voice')}
                  style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#0f172a', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'var(--control-font-family)', maxWidth: '180px' }}
                >
                  <option value="">{t('語音：系統預設', 'Voice: Default')}</option>
                  {voiceOptionsForVersion.map(o => (
                    <option key={o.id} value={o.id}>{t('語音：', 'Voice: ')}{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="app-auth-actions" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                {playerName ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                    {myVoiceOwnerId && (encourageInbox?.items?.length > 0) && (() => {
                      const items = encourageInbox.items;
                      const lastRead = encourageInbox.lastReadAt || '';
                      const unread = items.filter(it => (it.at || '') > lastRead).length;
                      return (
                        <button
                          onClick={() => {
                            setShowEncouragePanel(v => !v);
                            if (unread > 0) {
                              voiceCommentApi.markEncouragementRead(myVoiceOwnerId).catch(() => {});
                              setEncourageInbox(prev => prev ? { ...prev, lastReadAt: new Date().toISOString() } : prev);
                            }
                          }}
                          title={t('我收到的鼓勵', 'Encouragement I received')}
                          style={{ position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.2rem', display: 'flex', alignItems: 'center' }}
                        >
                          <span style={{ fontSize: '1.25rem' }}>🔔</span>
                          {unread > 0 && <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</span>}
                        </button>
                      );
                    })()}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem' }}>
                      <span style={{ color: '#1e293b', fontWeight: 'bold', fontSize: '0.95rem' }}>{playerName}</span>
                      {isPremium && <Crown size={14} style={{ color: '#fbbf24' }} />}
                    </div>
                    <button onClick={() => { setPlayerName(''); setIsPremium(false); setUserEmail(''); setFavoriteVerseSetIds([]); localStorage.removeItem('verserain_player_name'); localStorage.removeItem('verserain_is_premium'); localStorage.removeItem('verserain_player_email'); localStorage.removeItem('verserain_auth_provider'); localStorage.removeItem('verseRain_gardenData'); setGardenData({}); localStorage.removeItem('verseRain_custom_sets'); localStorage.removeItem('verseRain_custom_sets_owner'); lastPushedPrivateSetsRef.current = ''; setCustomVerseSets([]); }} style={{ background: 'transparent', border: '1px solid #cbd5e1', color: '#64748b', cursor: 'pointer', borderRadius: '4px', padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>{t("登出", "Logout")}</button>
                  </div>
                ) : (
                  <>
                    <a className="app-login-link" href="#" onClick={(e) => { e.preventDefault(); setShowLoginModal('login'); }} style={{ color: '#0056b3', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.95rem' }}>{t("登入", "Login")}</a>
                    <a className="app-signup-link" href="#" onClick={(e) => { e.preventDefault(); setShowLoginModal('signup'); }} style={{ background: '#3b82f6', color: 'white', padding: '0.3rem 0.8rem', borderRadius: '4px', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.95rem' }}>{t("申請帳號", "Sign Up")}</a>
                  </>
                )}
              </div>
            </div>

            {/* Navigation Bar */}
            <div className="landscape-compact-nav" style={{ display: 'flex', backgroundColor: '#e2e8f0', color: '#334155', overflowX: 'auto', borderBottom: '2px solid #cbd5e1', gap: '0.8rem', alignItems: 'center' }}>
              {/* On the lobby the big cards ARE these destinations, so hide the
                  duplicate pills there; other views keep them for navigation.
                  Order: Home · Guide · Who's Playing · Garden · Multiplayer | Search · Advanced */}
              {mainTab !== 'lobby' && (
              <div className="block-tile" onClick={() => setMainTab('lobby')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'lobby' ? '#3b82f6' : 'white', color: mainTab === 'lobby' ? 'white' : '#475569', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <Home size={18} /> {t('大廳', 'Home')}
              </div>
              )}
              <div className="block-tile" onClick={() => setMainTab('manual')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'manual' ? '#f59e0b' : 'white', color: mainTab === 'manual' ? 'white' : '#475569', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <Library size={18} /> {t('說明', 'Guide')}
              </div>
              <div className="block-tile" onClick={() => setMainTab('map')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'map' ? '#0ea5e9' : 'white', color: mainTab === 'map' ? 'white' : '#475569', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <Users size={18} /> {t('誰在玩', "Who's Playing")}
              </div>
              {mainTab !== 'lobby' && (<>
              <div className="block-tile" onClick={() => setMainTab('garden')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'garden' ? '#10b981' : 'white', color: mainTab === 'garden' ? 'white' : '#475569', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <TreePine size={18} /> {t('我的園子', 'My Garden')}
              </div>
              <div className="block-tile" onClick={() => setMainTab('multiplayer')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'multiplayer' ? '#ec4899' : 'white', color: mainTab === 'multiplayer' ? 'white' : '#475569', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <Gamepad2 size={18} /> {t('多人遊戲', 'Multiplayer')}
              </div>
              </>)}
              <div style={{ flex: 1, minWidth: '20px' }}></div>
              <div className="block-tile" onClick={() => setMainTab('search')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'search' ? '#8b5cf6' : 'white', color: mainTab === 'search' ? 'white' : '#475569', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <Search size={18} /> {t('搜尋', 'Search')}
              </div>
              <div className="block-tile" onClick={() => setMainTab('advanced')} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.2rem', cursor: 'pointer', backgroundColor: mainTab === 'advanced' ? '#475569' : 'white', color: mainTab === 'advanced' ? 'white' : '#64748b', borderRadius: '20px', fontWeight: 'bold', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                <Settings size={18} /> {t('進階功能', 'Advanced')}
              </div>
            </div>

            {/* Main Content Area */}
            <div className="landscape-compact-content" style={{ maxWidth: '1000px', margin: '0 auto' }}>

              {mainTab === 'lobby' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', alignItems: 'center', marginTop: '1rem', paddingBottom: '3rem' }}>
                  {/* Lobby tile captions split into two balanced lines so
                      the closing 「化。/年。/歡。…」 character doesn't get
                      orphaned on its own line. Looks for natural break
                      points (Chinese/Japanese/Korean comma, em-dash) and
                      injects a newline; combined with whiteSpace:pre-line
                      on the <p> the text renders as two clean rows. */}
                  {(() => null)()}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridAutoRows: isNarrowEditor ? '1fr' : 'auto', gap: isNarrowEditor ? '0.5rem' : '1.5rem', minHeight: isNarrowEditor ? 'calc(100dvh - 335px)' : undefined, width: '100%' }}>
                    {/* Daily VerseRain */}
                    <div className="primary-button" onClick={() => { setOpenDailyPickerOnEnter(true); setMainTab('daily_verse'); }} style={{ background: 'linear-gradient(135deg, #818cf8, #6366f1 55%, #4338ca)', borderRadius: '16px', padding: isNarrowEditor ? '0.3rem 0.6rem' : '2.5rem 2rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', textAlign: 'center', boxShadow: '0 10px 28px rgba(79, 70, 229, 0.35)' }}>
                      <CloudRain size={isNarrowEditor ? 46 : 72} style={{ marginBottom: isNarrowEditor ? '0.15rem' : '1rem' }} />
                      <h2 style={{ fontSize: isNarrowEditor ? '1.9rem' : '2rem', margin: 0, marginBottom: isNarrowEditor ? '0.15rem' : '0.5rem', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>{t('好文欣賞', 'Good Reads')}</h2>
                      <p style={{ ...tileCaptionStyle(0.95) }}>{splitCaption(t("每日一首好詩文，聲聲入耳記在心。", "A poem a day, heard and kept by heart."))}</p>
                    </div>

                    {/* My Garden */}
                    <div className="primary-button" onClick={() => setMainTab('garden')} style={{ background: 'linear-gradient(135deg, #34d399, #10b981)', borderRadius: '16px', padding: isNarrowEditor ? '0.3rem 0.6rem' : '2.5rem 2rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', textAlign: 'center' }}>
                      <TreePine size={isNarrowEditor ? 46 : 72} style={{ marginBottom: isNarrowEditor ? '0.15rem' : '1rem' }} />
                      <h2 style={{ fontSize: isNarrowEditor ? '1.9rem' : '2rem', margin: 0, marginBottom: isNarrowEditor ? '0.15rem' : '0.5rem', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>{t("我的園子", "My Garden")}</h2>
                      <p style={{ ...tileCaptionStyle() }}>{splitCaption(t("日日澆灌讀書田，年年結果滿枝頭。", "Water your reading garden and watch it bear fruit."))}</p>
                    </div>

                    {/* Scripture Library */}
                    <div className="primary-button" onClick={() => setMainTab('versesets')} style={{ background: 'linear-gradient(135deg, #60a5fa, #3b82f6)', borderRadius: '16px', padding: isNarrowEditor ? '0.3rem 0.6rem' : '2.5rem 2rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', textAlign: 'center' }}>
                      <Library size={isNarrowEditor ? 46 : 72} style={{ marginBottom: isNarrowEditor ? '0.15rem' : '1rem' }} />
                      <h2 style={{ fontSize: isNarrowEditor ? '1.9rem' : '2rem', margin: 0, marginBottom: isNarrowEditor ? '0.15rem' : '0.5rem', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>{t('聽與說', 'Listen & Speak')}</h2>
                      <p style={{ ...tileCaptionStyle() }}>{splitCaption(t("聽一聽，說一說，中英對照學得快。", "Listen, repeat, and learn with both languages side by side."))}</p>
                    </div>

                    {/* Multiplayer Game */}
                    <div className="primary-button" onClick={() => setMainTab('multiplayer')} style={{ background: 'linear-gradient(135deg, #f472b6, #ec4899)', borderRadius: '16px', padding: isNarrowEditor ? '0.3rem 0.6rem' : '2.5rem 2rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'white', textAlign: 'center' }}>
                      <Gamepad2 size={isNarrowEditor ? 46 : 72} style={{ marginBottom: isNarrowEditor ? '0.15rem' : '1rem' }} />
                      <h2 style={{ fontSize: isNarrowEditor ? '1.9rem' : '2rem', margin: 0, marginBottom: isNarrowEditor ? '0.15rem' : '0.5rem', textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>{t("多人遊戲", "Multiplayer")}</h2>
                      <p style={{ ...tileCaptionStyle() }}>{splitCaption(t("同窗同樂共背誦，你來我往比高低。", "Recite together and compete with friends in real time."))}</p>
                    </div>
                  </div>
                </div>
              )}


              {mainTab === 'daily_verse' && (
                !speechReady ? (
                  <div className="continuous-rain-overlay">
                    <button type="button" className="continuous-rain-stop" onClick={() => setMainTab('lobby')}>
                      <XCircle size={24} /> {t('停止播放', 'Stop')}
                    </button>
                    <div className="daily-verse-rain-shell continuous-rain-shell" style={{ display: 'grid', placeItems: 'center', padding: '1.5rem' }}>
                      <div className="hud-glass" style={{ maxWidth: '480px', width: '100%', textAlign: 'center', padding: '2rem 1.8rem' }}>
                        {/* Logo / Title */}
                        <div style={{ marginBottom: '1.4rem' }}>
                          <div style={{ fontSize: '2.2rem', marginBottom: '0.3rem' }}>🌧️</div>
                          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 'bold', color: '#fff' }}>
                            {t('歡迎使用內容雨', 'Welcome to ParagraphRain')}
                          </h2>
                          <p style={{ color: '#94a3b8', fontSize: '0.88rem', margin: '0.4rem 0 0 0' }}>
                            {t('請先選擇語言和語音，再開始朗讀。', 'Choose your language and voice to begin.')}
                          </p>
                        </div>

                        {/* Language Selector */}
                        <div style={{ marginBottom: '1.1rem', textAlign: 'left' }}>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.4rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            🌐 {t('語言', 'Language')}
                          </label>
                          <select
                            value={version}
                            onChange={(e) => handleVersionChange(e.target.value)}
                            style={{ width: '100%', padding: '0.65rem 0.9rem', borderRadius: '10px', border: '1px solid #334155', background: '#1e293b', color: '#fff', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'var(--control-font-family)' }}
                          >
                            {BIBLE_LANGUAGE_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Voice Selector */}
                        <div style={{ marginBottom: '1.4rem', textAlign: 'left' }}>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.4rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            🎙️ {t('語音', 'Voice')}
                          </label>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <select
                              value={selectedVoiceOptionId}
                              onChange={(e) => saveVoiceForVersion(e.target.value)}
                              style={{ flex: 1, padding: '0.65rem 0.9rem', borderRadius: '10px', border: '1px solid #334155', background: '#1e293b', color: '#fff', fontSize: '0.95rem', fontWeight: 'bold', cursor: 'pointer', fontFamily: 'var(--control-font-family)' }}
                            >
                              <option value="">{t('系統預設語音', 'System Default')}</option>
                              {voiceOptionsForVersion.map(o => (
                                <option key={o.id} value={o.id}>{o.label}</option>
                              ))}
                            </select>
                            {/* Preview button */}
                            <button
                              type="button"
                              onClick={() => {
                                const lang = getSpeechLangForVersion(version);
                                initAudio();
                                speakText(t('這是試聽。', 'This is a preview.'), 0.9, lang);
                              }}
                              style={{ background: '#334155', border: 'none', borderRadius: '10px', padding: '0.65rem 0.8rem', cursor: 'pointer', color: '#94a3b8', flexShrink: 0 }}
                              title={t('試聽', 'Preview')}
                            >
                              <Volume2 size={18} />
                            </button>
                          </div>
                        </div>

                        {/* Start Button */}
                        <button
                          type="button"
                          className="rain-action-btn play-btn"
                          style={{ width: '100%', fontSize: '1.05rem', padding: '0.85rem 1.5rem', borderRadius: '12px', justifyContent: 'center' }}
                          onClick={() => {
                            initAudio();
                            setSpeechReady(true);
                          }}
                        >
                          <Volume2 size={20} /> {t('開始朗讀每日一首', 'Start Daily Paragraph')}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : displayedDailyVerse ? (
                  <VerseSetContinuousRainPlayer
                    verseSet={{
                      id: `daily-${remoteDailyVerse?.date || dailyVerseDate}`,
                      title: remoteDailyVerse?.date || dailyVerseDate,
                      verses: [displayedDailyVerse],
                      sharedVoiceOwner: dailySharedVoiceOwner
                    }}
                    secondaryVerseSet={dailySecondaryVerseSet}
                    secondaryVersion={bilingualSecondaryVersion}
                    onSecondaryVersionChange={setBilingualSecondaryVersion}
                    allSecondaryVerses={allSecondaryVerses}
                    startVerse={displayedDailyVerse}
                    version={version}
                    t={t}
                    userEmail={userEmail}
                    playerName={playerName}
                    onRequestLogin={() => setShowLoginModal('login')}
                    label={remoteDailyVerse?.date || dailyVerseDate}
                    topicSets={topicVerseSets}
                    favoriteVerseSets={favoriteVerseSets}
                    autoOpenPicker={openDailyPickerOnEnter}
                    onAutoPickerOpened={() => setOpenDailyPickerOnEnter(false)}
                    onSelectDailyVerse={() => changeDailyVerseDate(() => formatLocalDate(new Date()))}
                    showNav
                    onPrevious={() => changeDailyVerseDate(prev => formatLocalDate(addDays(`${prev}T00:00:00`, -1)))}
                    onNext={() => changeDailyVerseDate(prev => formatLocalDate(addDays(`${prev}T00:00:00`, 1)))}
                    nextDisabled={dailyVerseDate >= formatLocalDate(new Date())}
                    onStop={() => { setDailySharedVoiceOwner(null); setMainTab('lobby'); }}
                    onSelectTopicSet={(set) => {
                      setSelectedSetId(set.id);
                      setMainTab('lobby');
                      setContinuousRainSet({
                        ...set,
                        startVerse: pickRandomVerse(set.verses || [])
                      });
                    }}
                    onListenLogged={() => updateGarden('activity_only', 'listen')}
                    onOpenVoiceComments={openVoiceCommentsFromPlayer}
                    onVoiceRecorded={() => setVoiceRefreshTick(x => x + 1)}
                    onChallengeVerse={challengeVerseFromReader}
                    onShareVerse={(verse, shareOpts) => {
                      if (!verse) return;
                      const dateLabel = remoteDailyVerse?.date || dailyVerseDate;
                      const link = buildPublicShareUrl('/', {
                        listenDaily: dateLabel,
                        version,
                        ...(shareOpts?.voiceOwner ? { vo: shareOpts.voiceOwner } : {}),
                      });
                      openListeningShare(link, `${dateLabel} · ${verse.reference}`);
                    }}
                  />
                ) : (
                  <div className="continuous-rain-overlay">
                    <button type="button" className="continuous-rain-stop" onClick={() => setMainTab('lobby')}>
                      <XCircle size={24} /> {t('停止播放', 'Stop')}
                    </button>
                    <div className="daily-verse-rain-shell continuous-rain-shell">
                      <div className="daily-verse-rain-scene continuous-rain-scene">
                        <div className="daily-verse-rain-sky" />
                        <div className="daily-verse-rain-glow" />
                        <div className="daily-verse-rain-drops">
                          {DAILY_RAIN_DROPS.map((drop, index) => (
                            <span
                              key={index}
                              className={`depth-${drop.depth}`}
                              style={{
                                '--x': drop.left,
                                '--y': drop.top,
                                '--drop-length': drop.length,
                                '--drop-width': drop.width,
                                '--drop-opacity': drop.opacity,
                                '--drop-duration': drop.duration,
                                '--drop-delay': drop.delay,
                                '--drop-drift': drop.drift,
                                '--drop-blur': drop.blur
                              }}
                            />
                          ))}
                        </div>
                        <div className="daily-verse-rain-content continuous-rain-content">
                          <div className="daily-verse-rain-topbar continuous-rain-topbar">
                            <button type="button" onClick={() => changeDailyVerseDate(prev => formatLocalDate(addDays(`${prev}T00:00:00`, -1)))} aria-label={t('前一天', 'Previous day')}>‹</button>
                            <div>
                              <div className="daily-verse-rain-date continuous-rain-set-title">{dailyVerseDate}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => changeDailyVerseDate(prev => formatLocalDate(addDays(`${prev}T00:00:00`, 1)))}
                              disabled={dailyVerseDate >= formatLocalDate(new Date())}
                              aria-label={t('後一天', 'Next day')}
                            >
                              ›
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              )}

              {mainTab === 'bilingual_rain' && (
                bilingualRainActive && preferredRainSet ? (
                  <VerseSetContinuousRainPlayer
                    verseSet={preferredRainSet}
                    secondaryVerseSet={secondaryRainSet}
                    version={version}
                    secondaryVersion={bilingualSecondaryVersion}
                    onSecondaryVersionChange={setBilingualSecondaryVersion}
                    allSecondaryVerses={allSecondaryVerses}
                    t={t}
                    userEmail={userEmail}
                    playerName={playerName}
                    label={t('雙語內容雨 Beta', 'Bilingual ParagraphRain Beta')}
                    topicSets={topicVerseSets}
                    favoriteVerseSets={favoriteVerseSets}
                    showNav
                    isFavoriteSet={favoriteVerseSetIdSet.has(preferredRainSet.voiceSetId || preferredRainSet.id)}
                    onToggleFavoriteSet={() => toggleFavoriteVerseSet(preferredRainSet.voiceSetId || preferredRainSet.id)}
                    onSelectDailyVerse={() => { setBilingualRainActive(false); setMainTab('daily_verse'); }}
                    onStop={() => {
                      setBilingualRainActive(false);
                      setMainTab('advanced');
                    }}
                    onSelectTopicSet={(set) => {
                      setSelectedSetId(set.id);
                      setBilingualRainActive(false);
                      setMainTab('lobby');
                      setContinuousRainSet({
                        ...set,
                        startVerse: pickRandomVerse(set.verses || [])
                      });
                    }}
                    onListenLogged={() => updateGarden('activity_only', 'listen')}
                    onOpenVoiceComments={openVoiceCommentsFromPlayer}
                    onVoiceRecorded={() => setVoiceRefreshTick(x => x + 1)}
                    onChallengeVerse={challengeVerseFromReader}
                    onShareVerse={(verse, shareOpts) => {
                      if (!verse) return;
                      pushSetForSharing(preferredRainSet, true);
                      const verseIdx = (preferredRainSet.verses || []).findIndex(v => v?.reference === verse.reference);
                      const link = buildPublicShareUrl('/lc', {
                        set: preferredRainSet.id,
                        ...(verseIdx >= 0 ? { i: verseIdx } : { verse: verse.reference }),
                        ...(shareOpts?.voiceOwner ? { vo: shareOpts.voiceOwner } : {}),
                        version,
                      });
                      openListeningShare(link, `${preferredRainSet.title} · ${verse.reference}`);
                    }}
                  />
                ) : (
                  <div style={{ paddingBottom: '3rem' }}>
                    <button
                      onClick={() => setMainTab('advanced')}
                      style={{ marginBottom: '1rem', background: 'white', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.55rem 0.9rem', cursor: 'pointer', fontWeight: 800 }}
                    >
                      ← {t('返回進階功能', 'Back to Advanced')}
                    </button>
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.5rem', maxWidth: '760px' }}>
                      <h2 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <CloudRain size={28} /> {t('雙語內容雨 Beta', 'Bilingual ParagraphRain Beta')}
                      </h2>
                      <p style={{ margin: '0 0 1.2rem 0', color: '#64748b', lineHeight: 1.7 }}>
                        {t('測試版會用主要語言朗讀，並在每個方塊下方顯示第二語言。第二行目前是短句估算對齊，適合先測試閱讀感。', 'This beta reads the main language and shows a second language under each block. The second line uses estimated phrase alignment so we can test the reading experience first.')}
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                        <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 800 }}>
                          {t('主要語言與語音', 'Main language and voice')}
                          <select
                            value={version}
                            onChange={(e) => handleVersionChange(e.target.value)}
                            style={{ padding: '0.65rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontWeight: 800 }}
                          >
                            {BIBLE_LANGUAGE_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label style={{ display: 'grid', gap: '0.4rem', color: '#334155', fontWeight: 800 }}>
                          {t('第二語言顯示', 'Second language display')}
                          <select
                            value={bilingualSecondaryVersion}
                            onChange={(e) => setBilingualSecondaryVersion(e.target.value)}
                            style={{ padding: '0.65rem 0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontWeight: 800 }}
                          >
                            {BIBLE_LANGUAGE_OPTIONS.filter(option => option.value !== version).map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={() => {
                            initAudio();
                            setSpeechReady(true);
                            setBilingualRainActive(true);
                          }}
                          disabled={!preferredRainSet || !secondaryRainSet}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', padding: '0.75rem 1.1rem', fontWeight: 900, cursor: preferredRainSet && secondaryRainSet ? 'pointer' : 'wait' }}
                        >
                          <Play size={18} fill="currentColor" /> {t('開始雙語內容雨', 'Start Bilingual ParagraphRain')}
                        </button>
                        <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 700 }}>
                          {preferredRainSet && secondaryRainSet
                            ? t('目前使用「內容雨」官方內容集做測試。', 'Using the official ParagraphRain set for this beta.')
                            : t('正在載入語言資料...', 'Loading language data...')}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              )}

              {mainTab === 'advanced' && (
                <div style={{ paddingBottom: '3rem' }}>
                  <h2 style={{ color: '#1e293b', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings size={30} /> {t("進階設定與學習", "Advanced Settings & Learning")}
                  </h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', width: '100%' }}>
                    {[
                      { id: 'morningPush', Icon: Mail, label: pushStatus === 'subscribed' ? t('已開啟每日一首推播', 'Daily Paragraph Push: On') : t('開啟每日一首推播', 'Daily Paragraph Push'), desc: t('每天上午 7 點手機推播今日內容', 'Get today\'s verse pushed at 7am'), color: '#10b981' },
                      { id: 'about', Icon: Info, label: t('關於我們', 'About'), desc: t('VerseRain 開發資訊', 'Info & Credits'), color: '#14b8a6' },
                      { id: 'feedback', link: `mailto:hungry4grace@gmail.com?subject=${encodeURIComponent('內容雨 意見回饋（VerseRain Feedback）')}`, Icon: Mail, label: t('意見回饋', 'Feedback'), desc: t('聯絡與建議', 'Bugs & Suggestions'), color: '#ec4899' }
                    ].map(item => {
                      const Icon = item.Icon;
                      return (
                      <div key={item.id} className="block-tile" onClick={() => {
                        if (item.id === 'morningPush') {
                          setShowPushModal(true);
                          return;
                        }
                        if (item.link) { window.open(item.link, '_blank'); return; }
                        setMainTab(item.id);
                        if (item.id === 'leaderboard') fetchGlobalLeaderboard();
                      }} style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                        <div style={{ color: item.color, width: '2.75rem', height: '2.75rem', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                          <Icon size={40} strokeWidth={2.2} />
                        </div>
                        <div>
                          <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.2rem', marginBottom: '0.2rem' }}>{item.label}</h3>
                          <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem' }}>{item.desc}</p>
                        </div>
                      </div>
                    )})}
                  </div>

                </div>
              )}

              {mainTab === 'custom_verses' && (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h2 style={{ color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Crown size={28} /> {t("我的內容集", "My Custom Sets")}</h2>
                    {/* Premium is a real distinction; level is NOT — creating sets
                        only needs a login (see canCreateCustomSets). The old
                        "Lv.{n} 權限解鎖" badge implied a gate that does not exist,
                        so a new member read its absence as "I'm not allowed yet". */}
                  </div>

                  {!canCreateCustomSets ? (
                    <div style={{ textAlign: 'center', padding: '3rem 1rem', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div style={{ marginBottom: '1rem', color: '#64748b' }}><Lock size={64} /></div>
                      <h3 style={{ color: '#334155', marginBottom: '1rem' }}>{t("登入即可建立專屬內容集", "Sign in to create custom collections")}</h3>
                      <p style={{ color: '#64748b', marginBottom: '2rem', maxWidth: '400px', margin: '0 auto 2rem', lineHeight: '1.6' }}>
                        {t("登入你的帳號後，就能自由建立、編輯並分享自己的內容集。", "Once you sign in, you can freely create, edit, and share your own collections.")}
                      </p>
                      <button type="button" onClick={() => setShowLoginModal('login')} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '8px', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', boxShadow: '0 4px 6px rgba(59, 130, 246, 0.25)' }}>
                        {t("登入", "Log In")}
                      </button>
                    </div>
                  ) : (
                    <div>
                      {editingCustomSet ? (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0, color: '#3b82f6' }}>{editingCustomSet.id ? t("編輯內容集", "Edit Set") : t("新增內容集", "New Set")}</h3>
                            <button type="button" onClick={() => setEditingCustomSet(null)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}><X size={16} /> {t("取消", "Cancel")}</button>
                          </div>

                          <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem', color: '#475569' }}>{t("標題", "Title")}</label>
                            <input type="text" value={editingCustomSet.title} onChange={e => setEditingCustomSet({ ...editingCustomSet, title: e.target.value })} style={{ width: '100%', padding: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '1rem' }} placeholder={t("例如：約翰福音核心內容", "e.g., Core Paragraphs of John")} />
                          </div>

                          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 'bold', color: '#475569' }}>{t("原文語言", "Original language")}</span>
                            {[['zh', t('中文（英文是譯文）', 'Chinese (English is the translation)')], ['en', t('英文（中文是譯文）', 'English (Chinese is the translation)')]].map(([val, label]) => (
                              <label key={val} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer', color: '#334155' }}>
                                <input type="radio" name="sourceLang" value={val} checked={(editingCustomSet.sourceLang || 'zh') === val}
                                  onChange={() => setEditingCustomSet({ ...editingCustomSet, sourceLang: val })} />
                                {label}
                              </label>
                            ))}
                          </div>

                          <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem', color: '#475569' }}>{t("簡介", "Description")}</label>
                            <div style={{ background: '#fff', color: '#0f172a', borderRadius: '6px', border: '1px solid #cbd5e1', overflow: 'visible' }}>
                              <style>{`.ql-editor { min-height: 100px; }`}</style>
                              <React.Suspense fallback={<div style={{ padding: '1rem', color: '#94a3b8', fontSize: '0.9rem' }}>{t('編輯器載入中…', 'Loading editor…')}</div>}>
                                <ReactQuill
                                  theme="snow"
                                  value={editingCustomSet.description || ''}
                                  onChange={content => setEditingCustomSet({ ...editingCustomSet, description: content })}
                                  modules={quillModules}
                                  placeholder={t("描述一下這個內容集的用途...", "Describe this set...")}
                                />
                              </React.Suspense>
                            </div>
                          </div>

                          {/* 背景圖片 — creator picks a themed background for this set;
                              unset = the default rotating AI backgrounds. */}
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem', color: '#475569' }}>{t("背景圖片", "Background")}</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.6rem' }}>
                              <div
                                onClick={() => setEditingCustomSet({ ...editingCustomSet, background: '' })}
                                style={{ cursor: 'pointer', borderRadius: 8, border: `3px solid ${!editingCustomSet.background ? '#3b82f6' : '#e2e8f0'}`, overflow: 'hidden', textAlign: 'center', background: '#f8fafc' }}
                              >
                                <div style={{ height: 64, display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: '1.4rem' }}>🎲</div>
                                <div style={{ fontSize: '0.75rem', color: '#475569', padding: '0.25rem 0.2rem', fontWeight: 600 }}>{t('預設(每日輪換)', 'Default (rotates)')}</div>
                              </div>
                              {SET_BACKGROUND_THEMES.map(bg => (
                                <div
                                  key={bg.id}
                                  onClick={() => setEditingCustomSet({ ...editingCustomSet, background: `preset:${bg.id}` })}
                                  style={{ cursor: 'pointer', borderRadius: 8, border: `3px solid ${editingCustomSet.background === `preset:${bg.id}` ? '#3b82f6' : '#e2e8f0'}`, overflow: 'hidden', textAlign: 'center', background: '#f8fafc' }}
                                >
                                  <img src={bg.url} alt={bg.zh} style={{ width: '100%', height: 64, objectFit: 'cover', display: 'block' }} loading="lazy" />
                                  <div style={{ fontSize: '0.75rem', color: '#475569', padding: '0.25rem 0.2rem', fontWeight: 600 }}>{t(bg.zh, bg.en)}</div>
                                </div>
                              ))}
                              <div
                                onClick={() => { if (!bgUploadBusy) bgFileInputRef.current?.click(); }}
                                style={{ cursor: 'pointer', borderRadius: 8, border: `3px solid ${String(editingCustomSet.background || '').startsWith('custom:') ? '#3b82f6' : '#e2e8f0'}`, overflow: 'hidden', textAlign: 'center', background: '#fefce8' }}
                              >
                                {editorBgPreview && String(editingCustomSet.background || '').startsWith('custom:') ? (
                                  <img src={editorBgPreview} alt={t('自訂背景', 'Custom background')} style={{ width: '100%', height: 64, objectFit: 'cover', display: 'block' }} />
                                ) : (
                                  <div style={{ height: 64, display: 'grid', placeItems: 'center', fontSize: '1.4rem' }}>
                                    {bgUploadBusy ? '⏳' : (String(editingCustomSet.background || '').startsWith('custom:') ? '🖼️' : '⬆️')}
                                  </div>
                                )}
                                <div style={{ fontSize: '0.75rem', color: '#475569', padding: '0.25rem 0.2rem', fontWeight: 600 }}>
                                  {bgUploadBusy ? t('上傳中…', 'Uploading…') : (String(editingCustomSet.background || '').startsWith('custom:') ? t('自訂圖片 ✓', 'Custom ✓') : t('上傳圖片', 'Upload'))}
                                </div>
                              </div>
                              <input ref={bgFileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { handleBgImageUpload(e.target.files?.[0]); e.target.value = ''; }} />
                            </div>
                          </div>

                          {/* 背景音樂 — default / none / custom MP3 upload (≤5MB). */}
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem', color: '#475569' }}>{t("背景音樂", "Background Music")}</label>
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => setEditingCustomSet({ ...editingCustomSet, bgMusic: '' })}
                                style={{ padding: '0.5rem 1rem', borderRadius: 20, border: `2px solid ${!editingCustomSet.bgMusic ? '#3b82f6' : '#cbd5e1'}`, background: !editingCustomSet.bgMusic ? '#eff6ff' : '#f8fafc', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
                                🎵 {t('預設音樂', 'Default music')}
                              </button>
                              <button type="button" onClick={() => setEditingCustomSet({ ...editingCustomSet, bgMusic: 'none' })}
                                style={{ padding: '0.5rem 1rem', borderRadius: 20, border: `2px solid ${editingCustomSet.bgMusic === 'none' ? '#3b82f6' : '#cbd5e1'}`, background: editingCustomSet.bgMusic === 'none' ? '#eff6ff' : '#f8fafc', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
                                🔇 {t('無背景音樂', 'No music')}
                              </button>
                              <button type="button" disabled={musicUploadBusy} onClick={() => musicFileInputRef.current?.click()}
                                style={{ padding: '0.5rem 1rem', borderRadius: 20, border: `2px solid ${String(editingCustomSet.bgMusic || '').startsWith('custom:') ? '#3b82f6' : '#cbd5e1'}`, background: String(editingCustomSet.bgMusic || '').startsWith('custom:') ? '#eff6ff' : '#fefce8', color: '#334155', cursor: 'pointer', fontWeight: 600 }}>
                                {musicUploadBusy ? `⏳ ${t('上傳中…', 'Uploading…')}` : (String(editingCustomSet.bgMusic || '').startsWith('custom:') ? `🎶 ${t('自訂音樂 ✓(點擊更換)', 'Custom ✓ (replace)')}` : `⬆️ ${t('上傳 MP3(≤3分鐘,≤5MB)', 'Upload MP3 (≤3 min, ≤5MB)')}`)}
                              </button>
                              <input ref={musicFileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { handleMusicUpload(e.target.files?.[0]); e.target.value = ''; }} />
                            </div>
                            {editingCustomSet.bgMusic !== 'none' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap', marginTop: '0.7rem' }}>
                                {String(editingCustomSet.bgMusic || '').startsWith('custom:') && (
                                  <button
                                    type="button"
                                    disabled={!editorMusicUrl}
                                    onClick={toggleEditorMusicPreview}
                                    style={{ padding: '0.4rem 0.9rem', borderRadius: 8, border: '1px solid #cbd5e1', background: editorMusicPlaying ? '#fde68a' : '#f8fafc', color: '#334155', cursor: editorMusicUrl ? 'pointer' : 'wait', fontWeight: 600 }}
                                  >
                                    {editorMusicPlaying ? `⏸ ${t('停止試聽', 'Stop')}` : (editorMusicUrl ? `▶ ${t('試聽', 'Preview')}` : `⏳ ${t('載入中…', 'Loading…')}`)}
                                  </button>
                                )}
                                <span style={{ color: '#64748b', fontSize: '0.88rem' }}>🔉 {t('音量', 'Volume')}</span>
                                <input
                                  type="range" min={1} max={100}
                                  value={bgmGainToSlider(editingCustomSet.bgMusicVolume)}
                                  onChange={e => {
                                    const vol = bgmSliderToGain(Number(e.target.value));
                                    setEditingCustomSet(prev => ({ ...prev, bgMusicVolume: vol }));
                                    editorMusicAudioRef.current?._bgmSetVolume?.(vol);
                                  }}
                                  style={{ width: 180, cursor: 'pointer' }}
                                />
                                <span style={{ color: '#334155', fontSize: '0.88rem', fontWeight: 600, minWidth: 38 }}>
                                  {bgmGainToSlider(editingCustomSet.bgMusicVolume)}%
                                </span>
                              </div>
                            )}
                          </div>

                          <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem', color: '#475569' }}>{t("段落列表", "Paragraphs")}</label>

                            {editingCustomSet.verses.map((v, idx) => {
                              const moveVerse = (fromIdx, direction) => {
                                const toIdx = fromIdx + direction;
                                if (toIdx < 0 || toIdx >= editingCustomSet.verses.length) return;
                                const newVerses = [...editingCustomSet.verses];
                                [newVerses[fromIdx], newVerses[toIdx]] = [newVerses[toIdx], newVerses[fromIdx]];
                                setEditingCustomSet({ ...editingCustomSet, verses: newVerses });
                              };
                              const patchRow = (patch) => {
                                const newVerses = [...editingCustomSet.verses];
                                newVerses[idx] = { ...newVerses[idx], ...patch };
                                setEditingCustomSet({ ...editingCustomSet, verses: newVerses });
                              };
                              const enFirst = editingCustomSet.sourceLang === 'en';
                              const zhBox = (
                                <textarea
                                  key="zh"
                                  value={v.text || ''}
                                  onChange={e => patchRow({ text: e.target.value, textCn: undefined })}
                                  placeholder={t('中文（繁體；簡體會自動轉換）', 'Chinese (Traditional; Simplified is generated)')}
                                  lang="zh-Hant"
                                  style={{ flex: 1, minWidth: 0, padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', minHeight: isNarrowEditor ? '90px' : '64px', resize: 'vertical', fontSize: '0.95rem', background: '#fff', color: '#0f172a' }}
                                />
                              );
                              const enBox = (
                                <textarea
                                  key="en"
                                  value={v.textEn || ''}
                                  onChange={e => patchRow({ textEn: e.target.value })}
                                  placeholder={t('English（作者自己的翻譯）', 'English (your own translation)')}
                                  lang="en"
                                  style={{ flex: 1, minWidth: 0, padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', minHeight: isNarrowEditor ? '90px' : '64px', resize: 'vertical', fontSize: '0.95rem', background: '#fff', color: '#0f172a' }}
                                />
                              );

                              return (
                                <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem', alignItems: 'flex-start', position: 'relative' }}>
                                  {/* Move column: reorder this paragraph up/down within the list. */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                                    <button type="button" disabled={idx === 0} onClick={() => moveVerse(idx, -1)}
                                      title={t('往上移', 'Move up')}
                                      style={{ padding: '0.25rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: idx === 0 ? '#f1f5f9' : '#fff', color: idx === 0 ? '#cbd5e1' : '#475569', cursor: idx === 0 ? 'default' : 'pointer' }}>
                                      <ChevronUp size={16} />
                                    </button>
                                    <button type="button" disabled={idx === editingCustomSet.verses.length - 1} onClick={() => moveVerse(idx, 1)}
                                      title={t('往下移', 'Move down')}
                                      style={{ padding: '0.25rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: idx === editingCustomSet.verses.length - 1 ? '#f1f5f9' : '#fff', color: idx === editingCustomSet.verses.length - 1 ? '#cbd5e1' : '#475569', cursor: idx === editingCustomSet.verses.length - 1 ? 'default' : 'pointer' }}>
                                      <ChevronDown size={16} />
                                    </button>
                                  </div>
                                  {/* Label + the two language sides, paragraph by paragraph. */}
                                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <input type="text" value={v.reference || ''} onChange={e => patchRow({ reference: e.target.value })}
                                      placeholder={defaultLabel(idx, editingCustomSet.sourceLang)}
                                      title={t('這一段的標籤（例如「第 1 段」或「靜夜思 · 李白」）。錄音與留言都掛在這個標籤上，同一集內不可重複。', 'Label for this paragraph (e.g. "Part 1" or "Quiet Night Thoughts · Li Bai"). Recordings and comments hang on it; keep it unique within the set.')}
                                      style={{ width: isNarrowEditor ? '100%' : '260px', maxWidth: '100%', boxSizing: 'border-box', padding: '0.4rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.88rem', fontWeight: 600, color: '#334155', background: '#f8fafc' }} />
                                    <div style={{ display: 'flex', flexDirection: isNarrowEditor ? 'column' : 'row', gap: '0.5rem' }}>
                                      {enFirst ? [enBox, zhBox] : [zhBox, enBox]}
                                    </div>
                                  </div>

                                  {/* Action column: read-aloud / record / delete (stacked on phones). */}
                                  <div style={{ display: 'flex', flexDirection: isNarrowEditor ? 'column' : 'row', gap: '0.4rem', flexShrink: 0 }}>
                                  {/* 朗讀預覽 — play the creator's recording if any, else TTS (like the
                                      View modal). Toggles: while this row is reading aloud the button
                                      becomes a red ⏹ stop (long passages must be stoppable). */}
                                  <button
                                    type="button"
                                    disabled={!v.text && !v.textEn}
                                    onClick={async () => {
                                      const stopAll = () => {
                                        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                                        stopVerseModalAudio();
                                      };
                                      if (editorPlayingVerse === idx) {
                                        stopAll();
                                        setEditorPlayingVerse(null);
                                        return;
                                      }
                                      stopAll();
                                      setEditorPlayingVerse(idx);
                                      // Drop the cache so a just-recorded voice is picked up.
                                      if (editingCustomSet.id) setVoicesLookupRef.current.delete(editingCustomSet.id);
                                      const played = editingCustomSet.id
                                        ? await playSetVerseVoice(editingCustomSet.id, v.reference)
                                        : false;
                                      if (played) {
                                        // Flip back to ▶ when the recording finishes on its own.
                                        const audio = verseModalAudioRef.current;
                                        if (audio) {
                                          const clear = () => setEditorPlayingVerse(cur => (cur === idx ? null : cur));
                                          audio.onended = clear;
                                          audio.onerror = clear;
                                        }
                                        return;
                                      }
                                      // speakText resolves when TTS ends (or is cancelled) — only
                                      // clear if this row is still the active one.
                                      const readEn = baseLang(version) === 'en' ? !!v.textEn : !v.text;
                                      await speakText(readEn ? v.textEn : v.text, 1.0, readEn ? 'en-US' : 'zh-TW');
                                      setEditorPlayingVerse(cur => (cur === idx ? null : cur));
                                    }}
                                    title={editorPlayingVerse === idx ? t('停止朗讀', 'Stop reading') : t('朗讀這節', 'Read this paragraph aloud')}
                                    style={{
                                      background: !v.text ? '#f1f5f9' : editorPlayingVerse === idx ? '#ef4444' : '#8b5cf6',
                                      color: v.text ? '#fff' : '#94a3b8',
                                      border: '1px solid #cbd5e1', padding: '0.5rem', borderRadius: '4px',
                                      cursor: !v.text ? 'not-allowed' : 'pointer',
                                      opacity: !v.text ? 0.5 : 1,
                                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                  >{editorPlayingVerse === idx
                                    ? <Square size={16} fill="currentColor" />
                                    : <Play size={16} fill="currentColor" />}</button>

                                  {/* 創作者親聲朗讀 — record / re-record this verse.
                                      Background bake+upload shows ⏳ (processing) / ⚠️ (error). */}
                                  {(() => {
                                    const vStatus = editorVoiceStatus[v.reference];
                                    const hasVoice = !!editorVerseVoices[v.reference];
                                    const bg = vStatus === 'processing' ? '#a855f7' : vStatus === 'error' ? '#f59e0b' : hasVoice ? '#16a34a' : '#f1f5f9';
                                    return (
                                  <button
                                    type="button"
                                    disabled={!editingCustomSet.id || !v.reference || !v.text || vStatus === 'processing'}
                                    onClick={() => setEditorVoiceTarget({ reference: v.reference, text: v.text })}
                                    title={!editingCustomSet.id
                                      ? t('請先儲存內容集,再錄音', 'Save the set first, then record')
                                      : vStatus === 'processing'
                                        ? t('背景美化上傳中…', 'Enhancing + uploading in the background…')
                                        : vStatus === 'error'
                                          ? t('處理失敗 — 點擊重錄這節', 'Failed — tap to re-record')
                                          : hasVoice
                                            ? t('已有錄音({name})— 點擊重錄', 'Recorded ({name}) — click to re-record').replace('{name}', String(editorVerseVoices[v.reference].recordedBy || ''))
                                            : t('用你的聲音錄這節,聽的人會聽到你唸', 'Record this paragraph — listeners will hear your voice')}
                                    style={{
                                      background: bg,
                                      color: (bg === '#f1f5f9') ? '#475569' : '#fff',
                                      border: '1px solid #cbd5e1', padding: '0.5rem', borderRadius: '4px',
                                      cursor: (!editingCustomSet.id || !v.reference || !v.text || vStatus === 'processing') ? 'not-allowed' : 'pointer',
                                      opacity: (!editingCustomSet.id || !v.reference || !v.text) ? 0.5 : 1,
                                    }}
                                  >{vStatus === 'processing' ? '⏳' : vStatus === 'error' ? '⚠️' : '🎙️'}</button>
                                    );
                                  })()}
                                  <button type="button"
                                    onClick={() => {
                                      const hasContent = v.reference || v.text;
                                      // First tap on a non-empty row just arms; second tap deletes.
                                      // (window.confirm is a silent no-op in iOS WKWebView, so we
                                      // confirm in-app instead.)
                                      if (hasContent && confirmDeleteIdx !== idx) {
                                        setConfirmDeleteIdx(idx);
                                        clearTimeout(confirmDeleteTimerRef.current);
                                        confirmDeleteTimerRef.current = setTimeout(() => setConfirmDeleteIdx(null), 3500);
                                        return;
                                      }
                                      clearTimeout(confirmDeleteTimerRef.current);
                                      setConfirmDeleteIdx(null);
                                      const newVerses = editingCustomSet.verses.filter((_, i) => i !== idx);
                                      setEditingCustomSet({ ...editingCustomSet, verses: newVerses });
                                    }}
                                    title={confirmDeleteIdx === idx ? t('再按一次刪除', 'Tap again to delete') : t('刪除這節', 'Delete this paragraph')}
                                    style={{ background: confirmDeleteIdx === idx ? '#b91c1c' : '#ef4444', color: 'white', border: confirmDeleteIdx === idx ? '2px solid #fca5a5' : 'none', padding: confirmDeleteIdx === idx ? '0.4rem 0.5rem' : '0.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: confirmDeleteIdx === idx ? 700 : 400, fontSize: confirmDeleteIdx === idx ? '0.8rem' : '1rem', whiteSpace: 'nowrap' }}>
                                    {confirmDeleteIdx === idx ? t('確定?', 'Sure?') : '✖'}
                                  </button>
                                  </div>
                                </div>
                              );
                            })}

                            {editorVoiceTarget && editingCustomSet.id && (
                              <VerseVoiceRecorder
                                t={t}
                                reference={formatVerseReferenceForDisplay(editorVoiceTarget.reference, version)}
                                verseText={editorVoiceTarget.text}
                                onUpload={({ blob, mime, dur, beautify }) => {
                                  // Bake (if enhancing) + upload in the BACKGROUND — the
                                  // realtime bake takes ~as long as the clip, so we never
                                  // block the creator. Capture the raw reference + setId now.
                                  const ref = editorVoiceTarget.reference;
                                  const setId = editingCustomSet.id;
                                  const recordedBy = playerName || (userEmail || '').split('@')[0] || 'Anonymous';
                                  const email = userEmail || '';
                                  const seq = (editorSaveSeqRef.current[ref] || 0) + 1;
                                  editorSaveSeqRef.current[ref] = seq;
                                  const isLatest = () => editorSaveSeqRef.current[ref] === seq;
                                  const prevJob = editorUploadJobRef.current[ref];
                                  setEditorVoiceStatus(prev => ({ ...prev, [ref]: 'processing' }));
                                  const job = (async () => {
                                    // Serialize same-verse re-records so the last take wins on the
                                    // server, not whichever upload finishes last.
                                    if (prevJob) { try { await prevJob; } catch { /* prior take failed — still record this one */ } }
                                    if (!isLatest()) return;
                                    try {
                                      const finalBlob = beautify ? await bakeBeautifiedBlob(blob, mime) : blob;
                                      if (!isLatest()) return; // superseded during the bake
                                      const meta = await uploadVerseVoice({ email, setId, reference: ref, blob: finalBlob, mime, dur, recordedBy });
                                      if (!isLatest()) return; // a newer take already replaced this one
                                      setEditorVerseVoices(prev => ({ ...prev, [ref]: meta }));
                                      // No success toast — the mic button turning green is enough,
                                      // and extra notifications distract mid-recording.
                                      setEditorVoiceStatus(prev => { const n = { ...prev }; delete n[ref]; return n; });
                                    } catch (e) {
                                      if (!isLatest()) return;
                                      setEditorVoiceStatus(prev => ({ ...prev, [ref]: 'error' }));
                                      // A permission conflict (this verse was recorded under a
                                      // different account) is NOT a transient failure — re-recording
                                      // will keep failing. Say the real reason instead of "re-record".
                                      const locked = /original recorder/i.test(String(e?.message || ''));
                                      setToast(locked
                                        ? t('這節之前是用別的帳號錄的,無法覆蓋。請先刪掉這一行再重加,或用原本的帳號登入。', 'This paragraph was recorded under a different account and can’t be overwritten. Remove and re-add this row, or sign in with the original account.')
                                        : t('錄音處理失敗,請重錄這節', 'Recording failed — please re-record this paragraph'));
                                      setTimeout(() => setToast(null), locked ? 7000 : 4000);
                                    }
                                  })();
                                  editorUploadJobRef.current[ref] = job;
                                  job.finally(() => { if (editorUploadJobRef.current[ref] === job) delete editorUploadJobRef.current[ref]; });
                                }}
                                onCancel={() => setEditorVoiceTarget(null)}
                                onDone={() => setEditorVoiceTarget(null)}
                              />
                            )}

                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <button type="button" onClick={() => {
                                setEditingCustomSet({
                                  ...editingCustomSet,
                                  verses: [...editingCustomSet.verses, { reference: '', text: '', textEn: '' }]
                                });
                              }} style={{ background: '#e2e8f0', color: '#475569', border: '1px dashed #94a3b8', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', flex: 1, fontWeight: 'bold' }}>
                                + {t("新增一段", "Add paragraph")}
                              </button>
                              <button type="button" onClick={() => setBulkImportState({ zh: '', en: '', busy: false })}
                                title={t('把中文與英文全文各貼一份，按段落自動配對成一段一段', 'Paste the full Chinese and English texts; paragraphs are paired one by one')}
                                style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px dashed #93c5fd', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', flex: 1, fontWeight: 'bold' }}>
                                📋 {t("貼上全文對照匯入", "Paste full text (both languages)")}
                              </button>
                            </div>

                            {bulkImportState && (() => {
                              const zhParas = splitParagraphs(bulkImportState.zh);
                              const enParas = splitParagraphs(bulkImportState.en);
                              const mismatch = zhParas.length && enParas.length && zhParas.length !== enParas.length;
                              const boxStyle = { width: '100%', minHeight: '220px', padding: '0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: '0.95rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' };
                              return (
                              <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000, padding: '1rem' }}>
                                <div style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', width: 'min(960px, 100%)', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
                                  <h3 style={{ margin: '0 0 0.4rem', color: '#1e293b' }}>📋 {t('貼上全文，自動配對段落', 'Paste both texts, paragraphs are paired')}</h3>
                                  <p style={{ margin: '0 0 0.8rem', color: '#64748b', fontSize: '0.88rem', lineHeight: 1.5 }}>
                                    {t('左邊貼中文全文、右邊貼英文全文。段落用空行分開（沒有空行時就一行一段），第 1 段中文會配第 1 段英文，依此類推。翻譯是作者自己寫的，不用機器翻譯。', 'Chinese on the left, English on the right. Separate paragraphs with a blank line (or one per line). Paragraph 1 pairs with paragraph 1, and so on. Translations are your own — no machine translation.')}
                                  </p>
                                  <div style={{ display: 'grid', gridTemplateColumns: isNarrowEditor ? '1fr' : '1fr 1fr', gap: '0.8rem' }}>
                                    <div>
                                      <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>{t('中文', 'Chinese')} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({zhParas.length})</span></div>
                                      <textarea value={bulkImportState.zh} onChange={e => setBulkImportState(st => ({ ...st, zh: e.target.value }))} lang="zh-Hant"
                                        placeholder={'床前明月光，\n疑是地上霜。\n\n舉頭望明月，\n低頭思故鄉。'} style={boxStyle} />
                                    </div>
                                    <div>
                                      <div style={{ fontWeight: 700, color: '#334155', marginBottom: 4 }}>English <span style={{ color: '#94a3b8', fontWeight: 500 }}>({enParas.length})</span></div>
                                      <textarea value={bulkImportState.en} onChange={e => setBulkImportState(st => ({ ...st, en: e.target.value }))} lang="en"
                                        placeholder={'Before my bed, the moonlight glows,\nAs if frost had settled on the ground.\n\nI lift my head to watch the moon,\nThen lower it, thinking of home.'} style={boxStyle} />
                                    </div>
                                  </div>
                                  {mismatch ? (
                                    <div style={{ margin: '0.6rem 0 0', padding: '0.6rem 0.8rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e', fontSize: '0.85rem' }}>
                                      {t('兩邊段落數不同（中文 {a} 段、英文 {b} 段）。仍可匯入，多出來的段落另一邊會留白，之後可以在列表裡補。', 'Paragraph counts differ (Chinese {a}, English {b}). You can still import; the extra paragraphs get a blank other side you can fill in later.').replace('{a}', String(zhParas.length)).replace('{b}', String(enParas.length))}
                                    </div>
                                  ) : null}
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem', alignItems: 'center' }}>
                                    <button type="button" onClick={() => setBulkImportState(null)} style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', padding: '0.55rem 1rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                                      {t('取消', 'Cancel')}
                                    </button>
                                    <button type="button" disabled={!zhParas.length && !enParas.length} onClick={runBulkImport} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '0.55rem 1.1rem', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                                      {t('匯入 {n} 段', 'Import {n} paragraphs').replace('{n}', String(Math.max(zhParas.length, enParas.length)))}
                                    </button>
                                  </div>
                                </div>
                              </div>
                              );
                            })()}
                          </div>

                          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input type="checkbox" id="publishSet" checked={editingCustomSet.isPublished || false} onChange={e => setEditingCustomSet({ ...editingCustomSet, isPublished: e.target.checked })} style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }} />
                            <label htmlFor="publishSet" style={{ fontWeight: 'bold', color: '#475569', cursor: 'pointer' }}>{t("公開此內容集 (Publish to Global Verse Sets)", "Publish to Global Collections")}</label>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
                            {editingCustomSet.id ? (
                              <button type="button" onClick={() => {
                                // Two-tap confirm — window.confirm is dead inside the iOS App.
                                if (deleteArmedId !== editingCustomSet.id) { armDelete(editingCustomSet.id); return; }
                                setDeleteArmedId(null);

                                // Remove from local custom sets + localStorage
                                const updatedSets = customVerseSets.filter(s => s.id !== editingCustomSet.id);
                                setCustomVerseSets(updatedSets);
                                localStorage.setItem('verseRain_custom_sets', JSON.stringify(updatedSets));

                                // If published, also remove from PartyKit
                                if (publishedVerseSets.some(p => p.id === editingCustomSet.id)) {
                                  fetch(`${PARTY_DB}/custom-sets`, {
                                    method: "DELETE",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ id: editingCustomSet.id, adminEmail: userEmail, adminName: playerName })
                                  }).catch(e => console.error("Delete-from-published failed", e));
                                  setPublishedVerseSets(prev => prev.filter(p => p.id !== editingCustomSet.id));
                                }

                                setToast(t('內容集已刪除', 'Set deleted'));
                                setTimeout(() => setToast(null), 3000);
                                setEditingCustomSet(null);
                              }} style={{ background: deleteArmedId === editingCustomSet.id ? '#b91c1c' : '#ef4444', color: 'white', border: deleteArmedId === editingCustomSet.id ? '2px solid #fecaca' : 'none', padding: '0.8rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}>
                                {deleteArmedId === editingCustomSet.id ? t('再按一次確認刪除', 'Tap again to confirm') : t("刪除內容集", "Delete Set")}
                              </button>
                            ) : <span />}
                            <button type="button" onClick={() => {
                              if (!editingCustomSet.title) return alert(t("請填寫標題", "Please fill in title"));
                              if (!editingCustomSet.verses.some(v => (v.text || '').trim() || (v.textEn || '').trim())) return alert(t("請至少輸入一段內容", "Please add at least one paragraph"));

                              const sourceLang = editingCustomSet.sourceLang || (baseLang(version) === 'en' ? 'en' : 'zh');
                              const setObj = {
                                ...editingCustomSet,
                                sourceLang,
                                verses: normalizeItemsForSave(editingCustomSet.verses, sourceLang),
                                language: 'cuv',
                                id: editingCustomSet.id || `custom-${Date.now()}`,
                                authorName: (editingCustomSet.authorName && editingCustomSet.authorName !== "Anonymous")
                                  ? editingCustomSet.authorName
                                  : (playerName || "Anonymous"),
                                lastEditedAt: new Date().toISOString(),
                                lastEditorName: playerName || "Anonymous"
                              };

                              let updatedSets;
                              if (editingCustomSet.id) {
                                if (customVerseSets.some(s => s.id === setObj.id)) {
                                  updatedSets = customVerseSets.map(s => s.id === setObj.id ? setObj : s);
                                } else {
                                  updatedSets = [setObj, ...customVerseSets];
                                }
                              } else {
                                updatedSets = [setObj, ...customVerseSets];
                              }

                              setCustomVerseSets(updatedSets);
                              localStorage.setItem('verseRain_custom_sets', JSON.stringify(updatedSets));

                              // Handle publishing sync
                              if (setObj.isPublished) {
                                const existingPublishedSet = publishedVerseSets.find(p => p.id === setObj.id);
                                const originalAuthorName = (existingPublishedSet?.authorName && existingPublishedSet.authorName !== "Anonymous")
                                  ? existingPublishedSet.authorName
                                  : ((setObj.authorName && setObj.authorName !== "Anonymous") ? setObj.authorName : (playerName || "Anonymous"));
                                const publishedObj = {
                                  ...setObj,
                                  authorName: originalAuthorName,
                                  lastEditorName: playerName || "Anonymous",
                                  lastEditedAt: new Date().toISOString()
                                };
                                fetch(`${PARTY_DB}/custom-sets`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ ...publishedObj, adminEmail: userEmail, adminName: playerName })
                                }).then(async (res) => {
                                  if (res.ok) return;
                                  // Surface the failure — silent 403s made
                                  // creators think their set was published
                                  // when nobody else could see it.
                                  const d = await res.json().catch(() => ({}));
                                  setToast(t('發布失敗:{error}。其他人將看不到這個內容集。', "Publish failed: {error}. Others won't see this set.").replace('{error}', String(d.error || res.status)));
                                  setTimeout(() => setToast(null), 6000);
                                  setPublishedVerseSets(prev => prev.filter(p => p.id !== setObj.id));
                                }).catch(e => console.error("Publish failed", e));

                                setPublishedVerseSets(prev => {
                                  const exists = prev.find(p => p.id === setObj.id);
                                  if (exists) return prev.map(p => p.id === setObj.id ? publishedObj : p);
                                  return [publishedObj, ...prev];
                                });
                              } else {
                                fetch(`${PARTY_DB}/custom-sets`, {
                                  method: "DELETE",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ id: setObj.id, adminEmail: userEmail, adminName: playerName })
                                }).catch(e => console.error("Unpublish failed", e));

                                setPublishedVerseSets(prev => prev.filter(p => p.id !== setObj.id));
                              }

                              setEditingCustomSet(null);
                            }} style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer' }}>
                              {t("儲存內容集", "Save Set")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <button type="button" onClick={() => {
                            setEditingCustomSet({ title: '', description: '', verses: [{ version: 'CUV', reference: '', text: '' }] });
                          }} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', marginBottom: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>+</span> {t("建立新內容集", "Create New Set")}
                          </button>

                          {customVerseSets.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8', border: '2px dashed #e2e8f0', borderRadius: '8px' }}>
                              {t("你還沒有建立任何專屬內容集。點擊上方按鈕開始！", "You haven't created any custom sets yet. Click the button above to start!")}
                            </div>
                          ) : (() => {
                            const PER_PAGE = 10;
                            const totalPages = Math.max(1, Math.ceil(sortedCustomSets.length / PER_PAGE));
                            const page = Math.min(customSetsPage, totalPages);
                            const pageSets = sortedCustomSets.slice((page - 1) * PER_PAGE, page * PER_PAGE);
                            return (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
                                <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{t('排序', 'Sort')}</span>
                                <select
                                  value={customSetsSort}
                                  onChange={e => { setCustomSetsSort(e.target.value); setCustomSetsPage(1); }}
                                  style={{ padding: '0.4rem 0.7rem', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#334155', fontSize: '0.9rem', cursor: 'pointer' }}
                                >
                                  <option value="newest">{t('最新', 'Newest')}</option>
                                  <option value="title">{t('標題', 'Title')}</option>
                                  <option value="popular">{t('最受歡迎', 'Most Popular')}</option>
                                  <option value="favorites">{t('我的最愛', 'Favorites')}</option>
                                </select>
                              </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                              {pageSets.map(set => (
                                <div key={set.id} style={{ border: '1px solid #cbd5e1', borderRadius: '8px', padding: '1.5rem', position: 'relative' }}>
                                  <div style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                                    <button type="button" onClick={() => {
                                      // Play straight from the list — same flow as the set page's 播放
                                      // button (opens the 隨機/按序 chooser), no need to open 瀏覽 first.
                                      initAudio();
                                      if (!set?.verses?.length) return;
                                      setPlayOrderChooser(set);
                                    }} title={t("連續播放這個內容集（隨機或按序）", "Continuously play this collection (shuffled or in order)")} style={{ background: '#8b5cf6', border: '1px solid #7c3aed', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '4px' }}><Headphones size={14} fill="white" /> {t("播放", "Play")}</button>
                                    <button type="button" onClick={() => setEditingCustomSet({ ...set, verses: set.verses?.map(parseVerseRef) || [] })} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', color: '#475569' }}>{t("編輯", "Edit")}</button>
                                  </div>
                                  <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', paddingRight: '120px' }}>{set.title}</h3>
                                  {/* Clamp long rich-text intros to ~3 lines so the list stays scannable.
                                      line-clamp handles plain text; maxHeight backstops embedded headings/
                                      images whose line boxes line-clamp can't count. Full intro still shows
                                      on the set's play page. */}
                                  <div
                                    className="ql-editor-content"
                                    style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxHeight: '4.4em' }}
                                    dangerouslySetInnerHTML={{ __html: set.description }}
                                  />
                                  <div style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 'bold' }}>{set.verses?.length || 0} {t("段", "paragraphs")}</div>
                                </div>
                              ))}
                            </div>
                              {totalPages > 1 && (
                                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.6rem', marginTop: '1.2rem' }}>
                                  <button
                                    type="button"
                                    disabled={page <= 1}
                                    onClick={() => setCustomSetsPage(page - 1)}
                                    style={{ padding: '0.4rem 0.9rem', borderRadius: 6, border: '1px solid #cbd5e1', background: page <= 1 ? '#f1f5f9' : 'white', color: '#475569', cursor: page <= 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                                  >← {t('上一頁', 'Prev')}</button>
                                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{t('第 {page} / {total} 頁', 'Page {page} / {total}').replace('{page}', String(page)).replace('{total}', String(totalPages))}</span>
                                  <button
                                    type="button"
                                    disabled={page >= totalPages}
                                    onClick={() => setCustomSetsPage(page + 1)}
                                    style={{ padding: '0.4rem 0.9rem', borderRadius: 6, border: '1px solid #cbd5e1', background: page >= totalPages ? '#f1f5f9' : 'white', color: '#475569', cursor: page >= totalPages ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                                  >{t('下一頁', 'Next')} →</button>
                                </div>
                              )}
                            </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {mainTab === 'multiplayer' && (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', textAlign: 'center' }}>
                  <h2 style={{ marginTop: 0, marginBottom: '1.5rem', fontFamily: 'var(--app-font-family)', color: '#8b5cf6' }}>{(multiplayerState?.matchType === 'individual' || multiplayerRoomMode === 'individual') ? t("邀人PK", "Invite PK") : t("多人遊戲", "Multiplayer")}</h2>

                  {!playerName ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center', background: '#f8fafc', padding: '2rem', borderRadius: '16px', border: '2px dashed #cbd5e1' }}>
                      <h3 style={{ color: '#475569', margin: 0, fontSize: '1.5rem' }}>{t("請先告訴我們你的名字！", "First, what's your name?")}</h3>
                      <p style={{ color: '#94a3b8', margin: 0 }}>{t("選一個頭像，或直接輸入文字", "Pick an avatar, or just type your name")}</p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '350px' }}>
                        {[
                          { id: 'brave', label: t('勇敢', 'Brave'), Icon: Crown, color: '#f59e0b' },
                          { id: 'joy', label: t('喜樂', 'Joy'), Icon: Star, color: '#f97316' },
                          { id: 'team', label: t('隊友', 'Teammate'), Icon: Users, color: '#3b82f6' },
                          { id: 'quick', label: t('快手', 'Quick'), Icon: Zap, color: '#eab308' },
                          { id: 'learner', label: t('學習', 'Learner'), Icon: Library, color: '#8b5cf6' },
                          { id: 'love', label: t('愛心', 'Love'), Icon: Heart, color: '#ef4444' },
                          { id: 'listener', label: t('聆聽', 'Listener'), Icon: Headphones, color: '#06b6d4' },
                          { id: 'rain', label: t('雨滴', 'Rain'), Icon: CloudRain, color: '#0ea5e9' }
                        ].map(({ id, label, Icon, color }) => (
                          <button key={id} type="button" className="block-tile" onClick={() => {
                            const input = document.getElementById('guestNameInput');
                            if (input) {
                              input.value = label;
                              input.focus();
                            }
                          }} style={{ cursor: 'pointer', padding: '0.65rem', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', color, minWidth: '72px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                            <Icon size={26} />
                            <span style={{ color: '#475569', fontSize: '0.75rem', fontWeight: 700 }}>{label}</span>
                          </button>
                        ))}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', width: '100%', maxWidth: '300px', marginTop: '1rem' }}>
                        <input id="guestNameInput" type="text" placeholder={t("你的暱稱", "Your nickname")} style={{ width: '100%', padding: '1rem', borderRadius: '12px', border: '2px solid #cbd5e1', fontSize: '1.2rem', fontWeight: 'bold', boxSizing: 'border-box' }} onKeyDown={(e) => {
                          if (e.key === 'Enter') document.getElementById('guestNameBtn')?.click();
                        }} />
                        <button id="guestNameBtn" onClick={() => {
                          const val = document.getElementById('guestNameInput').value.trim();
                          if (val) {
                            setPlayerName(val);
                            localStorage.setItem('verserain_player_name', val);
                          }
                        }} className="primary-button" style={{ width: '100%', background: '#3b82f6', color: 'white', border: 'none', padding: '1rem', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1.2rem' }}>{t("出發！", "Go!")}</button>
                      </div>
                    </div>
                  ) : !multiplayerRoomId ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '-1rem' }}>{playerName.substring(0, 2)}</div>
                      <p style={{ color: '#64748b', fontSize: '1.1rem', maxWidth: '520px', lineHeight: 1.6 }}>{t("老師先選擇隊伍數量，再建立房間。學生加入一個聖靈果子隊伍，最後用隊伍平均分排名。", "The teacher chooses the number of teams, then hosts a room. Students join a Fruit of the Spirit team, and final standings are ranked by team average score.")}</p>

                      <div style={{ width: '100%', maxWidth: '520px', background: '#f8fafc', border: '1px solid #dbeafe', borderRadius: '12px', padding: '1rem', textAlign: 'left' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                          <label htmlFor="teamCountSelect" style={{ color: '#334155', fontWeight: 'bold' }}>{t("隊伍數量", "Number of Teams")}</label>
                          <select
                            id="teamCountSelect"
                            value={multiplayerTeamCount}
                            onChange={(e) => setMultiplayerTeamCount(Number(e.target.value))}
                            style={{ padding: '0.55rem 0.75rem', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', color: '#1e293b', fontWeight: 'bold', fontSize: '1rem' }}
                          >
                            {Array.from({ length: 8 }, (_, i) => i + 2).map(count => (
                              <option key={count} value={count}>{count}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: '0.5rem' }}>
                          {TEAM_OPTIONS.slice(0, multiplayerTeamCount).map(team => (
                            <div key={team.id} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.45rem 0.55rem', background: 'white', border: `1px solid ${team.color}55`, borderRadius: '8px', color: '#334155', fontWeight: 'bold', fontSize: '0.9rem' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />
                              <span>{t(team.name, team.enName)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%', maxWidth: '300px', padding: '0.7rem 0.9rem', background: multiplayerHostPlays ? '#eff6ff' : '#f8fafc', border: `1px solid ${multiplayerHostPlays ? '#93c5fd' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', color: '#334155', fontWeight: 'bold', fontSize: '0.92rem' }}>
                        <input
                          type="checkbox"
                          checked={multiplayerHostPlays}
                          onChange={(e) => setMultiplayerHostPlays(e.target.checked)}
                          style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: 'pointer', flex: '0 0 auto' }}
                        />
                        <span style={{ textAlign: 'left', lineHeight: 1.3 }}>
                          {t("我也要一起比賽", "I'll play too")}
                          <span style={{ display: 'block', fontWeight: 'normal', color: '#94a3b8', fontSize: '0.78rem' }}>
                            {t("關閉則只當主持人（不計分）", "Off = host only, you won't compete")}
                          </span>
                        </span>
                      </label>

                      <button
                        onClick={() => {
                          const newRoom = createRoomCode();
                          setMultiplayerRoomMode('team');
                          setMultiplayerRoomRole('host');
                          setMultiplayerRoomId(newRoom);
                        }}
                        style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '1rem 2rem', borderRadius: '8px', fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s', width: '100%', maxWidth: '300px' }}
                      >
                        {t("建立房間 (Host Game)", "Create Room")}
                      </button>

                      <div style={{ display: 'flex', alignItems: 'center', width: '100%', maxWidth: '300px' }}>
                        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }}></div>
                        <span style={{ padding: '0 1rem', color: '#94a3b8', fontSize: '0.9rem', fontWeight: 'bold' }}>{t("或", "OR")}</span>
                        <div style={{ flex: 1, height: '1px', backgroundColor: '#e2e8f0' }}></div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', width: '100%', maxWidth: '300px' }}>
                        <input
                          id="joinRoomInput"
                          type="text"
                          placeholder={t("輸入房間代碼", "Enter Room Code")}
                          maxLength={4}
                          inputMode="latin"
                          autoCapitalize="characters"
                          style={{ flex: 1, padding: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', textTransform: 'uppercase', textAlign: 'center', fontSize: '1.1rem', fontWeight: 'bold' }}
                          onChange={(e) => e.target.value = sanitizeRoomCode(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('joinRoomBtn')?.click(); }}
                        />
                        <button
                          id="joinRoomBtn"
                          onClick={() => {
                            const code = sanitizeRoomCode(document.getElementById('joinRoomInput')?.value);
                            if (code && code.length === 4) {
                              const roomCode = code.substring(0, 4);
                              setJoinRoomError(null);
                              isGuestJoinRef.current = true;
                              setMultiplayerRoomMode(null);
                              setMultiplayerRoomRole('player');
                              setMultiplayerRoomId(roomCode);
                              // Start 5s timeout — if no STATE_UPDATE arrives, room likely doesn't exist
                              if (joinRoomTimeoutRef.current) clearTimeout(joinRoomTimeoutRef.current);
                              joinRoomTimeoutRef.current = setTimeout(() => {
                                if (isGuestJoinRef.current) {
                                  setJoinRoomError(roomCode);
                                  setMultiplayerRoomMode(null);
                                  setMultiplayerRoomRole('player');
                                  setMultiplayerRoomId(null);
                                  isGuestJoinRef.current = false;
                                }
                              }, 5000);
                            }
                          }}
                          style={{ background: '#10b981', color: 'white', border: 'none', padding: '0 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          {t("加入", "Join")}
                        </button>
                      </div>

                      {joinRoomError && (
                        <div style={{ width: '100%', maxWidth: '300px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '0.8rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                          <div>
                            <div style={{ fontWeight: 'bold', color: '#dc2626', fontSize: '0.95rem' }}>
                              {t('找不到房間「{room}」', 'Room "{room}" not found').replace('{room}', String(joinRoomError))}
                            </div>
                            <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '2px' }}>
                              {t('請確認房間代碼是否正確', 'Please check the room code and try again')}
                            </div>
                          </div>
                          <button onClick={() => setJoinRoomError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', padding: '0 0.2rem' }}><X size={16} /></button>
                        </div>
                      )}
                    </div>
                  ) : multiplayerState?.status === 'ready_check' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
                      <div style={{ padding: '1.5rem', backgroundColor: '#fdf4ff', borderRadius: '8px', border: '2px dashed #d946ef', width: '100%', maxWidth: '460px' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', color: '#86198f' }}>{multiplayerState.matchType === 'team' ? t("多人遊戲準備！", "Multiplayer Ready!") : t("準備比賽！", "Get Ready!")}</h3>
                        <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: getRoomColor(multiplayerRoomId) || '#3b82f6', letterSpacing: '6px', marginBottom: '0.5rem', background: (getRoomColor(multiplayerRoomId) || '#3b82f6') + '18', borderRadius: '6px', padding: '0.3rem 1rem', display: 'inline-block', border: `2px solid ${getRoomColor(multiplayerRoomId) || '#3b82f6'}` }}>{multiplayerRoomId}</div>
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 0.8rem 0' }}>{t("分享此代碼讓更多人加入", "Share this code to let others join")}</p>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                          <div style={{ background: 'white', padding: '0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                            <QRCodeSVG value={buildPublicShareUrl(window.location.pathname, { room: multiplayerRoomId, ref: personalCode })} size={100} />
                          </div>
                          <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: 0 }}>{t("或掃描此 QR Code 快速加入", "or scan QR to join")}</p>
                        </div>
                        {(() => {
                          // *_solo: preview verse 0 in the player's own language (text localizes
                          // once fetched; the reference label localizes instantly).
                          const solo = multiplayerRoomId && multiplayerState.playMode?.endsWith('_solo');
                          const refLabel = solo ? mpLocalRefFor(multiplayerState.verseRef) : multiplayerState.verseRef;
                          const previewText = solo ? mpLocalTextFor(multiplayerState.verseRef, multiplayerState.verseText) : multiplayerState.verseText;
                          return (<>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#c026d3', marginBottom: '0.5rem' }}>{refLabel}</div>
                            <div style={{ fontSize: '1rem', color: '#701a75', marginBottom: '1rem', fontStyle: 'italic', maxWidth: '300px', lineHeight: '1.4' }}>"{previewText}"</div>
                          </>);
                        })()}
                        <p style={{ color: '#a21caf', fontSize: '0.9rem', margin: 0 }}>{multiplayerState.matchType === 'team' ? t("選好隊伍並準備後，老師就可以開始。", "Choose a team, get ready, then the teacher can start.") : t("雙方準備就緒後即將開始", "Match starts when both are ready")}</p>
                      </div>

                      {multiplayerState.matchType === 'team' && multiplayerState.players[myClientId] && (
                        <div style={{ width: '100%', maxWidth: '520px', background: '#f8fafc', border: '1px solid #dbeafe', borderRadius: '12px', padding: '1rem' }}>
                          <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155', textAlign: 'left' }}>{t("選擇你的隊伍", "Choose Your Team")}</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                            {(multiplayerState.teams || TEAM_OPTIONS).map(team => {
                              const selected = multiplayerState.players[myClientId]?.teamId === team.id;
                              const locked = Boolean(multiplayerState.players[myClientId]?.teamId);
                              const members = Object.values(multiplayerState.players || {}).filter(p => p.connected && p.teamId === team.id);
                              return (
                                <button
                                  key={team.id}
                                  onClick={() => {
                                    if (!locked && socketRef.current) socketRef.current.send(JSON.stringify({ type: 'SELECT_TEAM', teamId: team.id }));
                                  }}
                                  disabled={locked}
                                  style={{ border: `2px solid ${selected ? team.color : '#e2e8f0'}`, background: selected ? `${team.color}18` : 'white', borderRadius: '10px', padding: '0.9rem', cursor: locked ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', opacity: locked && !selected ? 0.55 : 1 }}
                                >
                                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                    <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />
                                    <span style={{ color: '#1e293b', fontWeight: 'bold', fontSize: '1rem' }}>{t(team.name, team.enName || team.name)}</span>
                                  </span>
                                  <span style={{ color: selected ? team.color : '#64748b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{selected ? t("已選", "Picked") : `${members.length}`}</span>
                                </button>
                              );
                            })}
                          </div>
                          {multiplayerState.players[myClientId]?.teamId && (
                            <p style={{ margin: '0.75rem 0 0 0', color: '#16a34a', fontWeight: 'bold', fontSize: '0.9rem' }}>{t("隊伍已鎖定，請按準備。", "Team locked. Press ready when you are set.")}</p>
                          )}
                        </div>
                      )}

                      {multiplayerState.matchType === 'team' && multiplayerState.host === myClientId && !multiplayerState.players[myClientId] && (
                        <div style={{ width: '100%', maxWidth: '520px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                          {(multiplayerState.teams || TEAM_OPTIONS).map(team => {
                            const members = Object.values(multiplayerState.players || {}).filter(p => p.connected && p.teamId === team.id);
                            return (
                              <div key={team.id} style={{ background: `${team.color}12`, border: `1px solid ${team.color}55`, borderRadius: '10px', padding: '0.85rem', textAlign: 'left' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                  <strong style={{ color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.45rem' }}><span style={{ width: '10px', height: '10px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />{t(team.name, team.enName || team.name)}</strong>
                                  <span style={{ color: team.color, fontWeight: 'bold' }}>{members.length}</span>
                                </div>
                                <div style={{ color: '#64748b', fontSize: '0.85rem', minHeight: '1.2rem' }}>
                                  {members.length > 0 ? members.map(p => p.name).join('、') : t("等待加入", "Waiting")}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {multiplayerState.host !== myClientId && !multiplayerState.players[myClientId]?.isReady && (
                        <div style={{ textAlign: 'center', marginTop: '1rem', color: '#3b82f6', fontWeight: 'bold', fontSize: '1.05rem', backgroundColor: '#eff6ff', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                          <Info size={18} /> {multiplayerState.matchType === 'team' && !multiplayerState.players[myClientId]?.teamId ? t("請先選一個隊伍", "Choose one team first") : t("如果你準備好了，請按下「我準備好了」的鍵", "If you are ready, please press the 'I am ready' button")}
                        </div>
                      )}

                      {multiplayerState.matchType === 'team' && multiplayerState.host === myClientId && multiplayerState.players[myClientId] && (
                        <div style={{ textAlign: 'center', marginTop: '1rem', color: '#15803d', fontWeight: 'bold', fontSize: '1.05rem', backgroundColor: '#f0fdf4', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}>
                          <Info size={18} /> {!multiplayerState.players[myClientId]?.teamId ? t("你是主持人並一起參賽 — 請先選一個隊伍，再按「比賽開始」", "You're hosting and competing — choose a team first, then press Start") : t("你是主持人並一起參賽，準備好就按「比賽開始」", "You're hosting and competing — press Start when ready")}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '1rem', margin: '0.5rem 0 1.5rem 0', justifyContent: 'center' }}>
                        <button
                          onClick={() => {
                            if (socketRef.current) socketRef.current.close();
                            setMultiplayerRoomMode(null);
                            setMultiplayerRoomRole('player');
                            setMultiplayerRoomId(null);
                            setMultiplayerState(null);
                          }}
                          style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1', padding: '0.8rem 1.5rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                          {t("離開", "Leave")}
                        </button>

                        {multiplayerState.host === myClientId ? (
                          <button
                            onClick={() => {
                              if (socketRef.current) socketRef.current.send(JSON.stringify({ type: 'HOST_START_GAME' }));
                            }}
                            disabled={multiplayerState.matchType === 'team' && (!canStartTeamMatch(multiplayerState) || (multiplayerState.players[myClientId] && !multiplayerState.players[myClientId].teamId))}
                            style={{ background: '#ec4899', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '6px', fontSize: '1.1rem', fontWeight: 'bold', cursor: (multiplayerState.matchType === 'team' && (!canStartTeamMatch(multiplayerState) || (multiplayerState.players[myClientId] && !multiplayerState.players[myClientId].teamId))) ? 'not-allowed' : 'pointer', opacity: (multiplayerState.matchType === 'team' && (!canStartTeamMatch(multiplayerState) || (multiplayerState.players[myClientId] && !multiplayerState.players[myClientId].teamId))) ? 0.55 : 1, transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(236, 72, 153, 0.5)' }}
                          >
                            {t("比賽開始", "Start Game")}
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (socketRef.current) socketRef.current.send(JSON.stringify({ type: 'PLAYER_READY' }));
                            }}
                            disabled={multiplayerState.players[myClientId]?.isReady || (multiplayerState.matchType === 'team' && !multiplayerState.players[myClientId]?.teamId)}
                            style={{ background: multiplayerState.players[myClientId]?.isReady ? '#10b981' : '#3b82f6', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '6px', fontSize: '1.1rem', fontWeight: 'bold', cursor: multiplayerState.players[myClientId]?.isReady || (multiplayerState.matchType === 'team' && !multiplayerState.players[myClientId]?.teamId) ? 'default' : 'pointer', opacity: multiplayerState.matchType === 'team' && !multiplayerState.players[myClientId]?.teamId ? 0.55 : 1, transition: 'all 0.2s', boxShadow: multiplayerState.players[myClientId]?.isReady ? 'none' : '0 4px 6px -1px rgba(59, 130, 246, 0.5)' }}
                          >
                            {multiplayerState.players[myClientId]?.isReady ? t("✔️ 已準備", "✔️ Ready") : t("我準備好了", "I am ready")}
                          </button>
                        )}
                      </div>

                      <div style={{ width: '100%', maxWidth: '400px', textAlign: 'left' }}>
                        <h4 style={{ color: '#475569', marginBottom: '0.5rem' }}>{t("玩家狀態:", "Player Status:")}</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          {Object.values(multiplayerState.players).map(p => {
                            const team = getTeamById(p.teamId, multiplayerState.teams);
                            return (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.8rem', backgroundColor: p.isReady ? '#dcfce7' : '#f1f5f9', borderRadius: '6px', border: p.isReady ? '1px solid #86efac' : '1px solid transparent' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', minWidth: 0 }}>
                                  <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: team?.color || p.color, boxShadow: '0 0 0 2px white, 0 0 0 4px ' + (team?.color || p.color) }}></div>
                                  <span style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '1.1rem', minWidth: 0 }}>{p.name} {multiplayerState.host === p.id ? '(Host)' : ''}</span>
                                  {team && <span style={{ color: team.color, background: `${team.color}16`, border: `1px solid ${team.color}55`, borderRadius: '999px', padding: '0.15rem 0.5rem', fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{t(team.name, team.enName || team.name)}</span>}
                                </div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: p.isReady ? '#15803d' : '#94a3b8', whiteSpace: 'nowrap' }}>
                                  {p.isReady ? t("✔️ 已準備", "✔️ READY") : t("等待中...", "WAITING")}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : showMultiplayerVersePicker && multiplayerState?.host === myClientId ? (
                    <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', padding: '1.5rem', width: '100%', maxWidth: '500px', textAlign: 'left', border: '1px solid #cbd5e1' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
                        <h3 style={{ margin: 0, color: '#334155' }}>
                          {pickerSelectedSet ? pickerSelectedSet.title : t("選擇比賽內容集", "Select Paragraph Group")}
                        </h3>
                        <button onClick={() => setShowMultiplayerVersePicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><XCircle size={24} /></button>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem', backgroundColor: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <label style={{ fontWeight: 'bold', color: '#475569', minWidth: '80px' }}>{t("遊戲模式", "Game Mode")}:</label>
                          <select
                            value={multiplayerPlayMode}
                            onChange={(e) => setMultiplayerPlayMode(e.target.value)}
                            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', flex: 1, backgroundColor: '#fff', fontSize: '1rem', outline: 'none' }}
                          >
                            <option value="square_solo">{t("獨立九宮格 (Solo Square)", "Solo Square")}</option>
                            <option value="rain_solo">{t("雨滴瀑布 (VerseRain)", "ParagraphRain")}</option>
                            <option value="voice_solo">{t('語音模式 (Voice Mode)', 'Voice Mode')}</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                          <label style={{ fontWeight: 'bold', color: '#475569', minWidth: '80px' }}>{t("難度級別", "Difficulty")}:</label>
                          <select
                            value={multiplayerDistractionLevel}
                            onChange={(e) => setMultiplayerDistractionLevel(Number(e.target.value))}
                            style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', flex: 1, backgroundColor: '#fff', fontSize: '1rem', outline: 'none' }}
                          >
                            <option value={0}>{t("等級 0 (無干擾方塊，2x2)", "Level 0 (No fakes, 2x2)")}</option>
                            <option value={1}>{t("等級 1 (少量干擾，2x2)", "Level 1 (Few fakes, 2x2)")}</option>
                            <option value={2}>{t("等級 2 (中等干擾，3x3)", "Level 2 (Medium fakes, 3x3)")}</option>
                            <option value={3}>{t("等級 3 (極限干擾，3x3)", "Level 3 (Max fakes, 3x3)")}</option>
                          </select>
                        </div>
                      </div>

                      {/* ── Search Bar ── */}
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ position: 'relative' }}>
                          <span style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#94a3b8', display: 'flex', alignItems: 'center' }}><Search size={18} /></span>
                          <input
                            id="mpVerseSearchInput"
                            type="text"
                            placeholder={t("搜尋內容（書卷、章節、內文…）", "Search paragraphs (book, chapter, text…)")}
                            value={multiplayerSearchText}
                            onChange={(e) => { setMultiplayerSearchText(e.target.value); setPickerSelectedSet(null); }}
                            autoFocus
                            style={{ width: '100%', padding: '0.75rem 0.9rem 0.75rem 2.4rem', borderRadius: '8px', border: '2px solid #a78bfa', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', boxShadow: '0 0 0 3px #ede9fe' }}
                          />
                          {multiplayerSearchText && (
                            <button onClick={() => setMultiplayerSearchText('')} style={{ position: 'absolute', right: '0.7rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.1rem', padding: '0' }}><X size={18} /></button>
                          )}
                        </div>
                      </div>

                      {/* ── Search Results ── */}
                      {multiplayerSearchText.trim().length > 0 ? (() => {
                        const q = multiplayerSearchText.trim().toLowerCase();
                        const verseResults = [];
                        const setResults = [];
                        for (const set of activeVerseSets) {
                          if ((set.title || '').toLowerCase().includes(q)) {
                            setResults.push(set);
                          }
                          for (const v of (set.verses || [])) {
                            if (
                              (v.reference || '').toLowerCase().includes(q) ||
                              (v.title || '').toLowerCase().includes(q) ||
                              (v.text || '').toLowerCase().includes(q)
                            ) {
                              if (!verseResults.some(r => r.reference === v.reference)) verseResults.push(v);
                            }
                          }
                        }
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                              <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 'bold' }}>
                                {(setResults.length > 0 || verseResults.length > 0) ? `${t('找到', 'Found')} ${setResults.length > 0 ? setResults.length + ' ' + t('個內容集', 'sets') + (verseResults.length > 0 ? ' , ' : '') : ''}${verseResults.length > 0 ? verseResults.length + ' ' + t('段', 'paragraphs') : ''}` : t('找不到符合的項目', 'No matches found')}
                              </span>
                              {multiplayerSelectedVerses.length > 0 && (
                                <button
                                  onClick={() => {
                                    setActiveVerse(multiplayerSelectedVerses[0]);
                                    setPlayMode(multiplayerPlayMode);
                                    setDistractionLevel(multiplayerDistractionLevel);
                                    setInitAutoStart({ trigger: true, isAuto: false, isMultiplayerReadyCheck: true, campaignQueue: multiplayerSelectedVerses, verse: multiplayerSelectedVerses[0], playMode: multiplayerPlayMode });
                                    setShowMultiplayerVersePicker(false);
                                  }}
                                  style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.5rem 1.2rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                                >
                                  ✓ {t('完成揀選', 'Finish')} ({multiplayerSelectedVerses.length})
                                </button>
                              )}
                            </div>
                            
                            {/* Matching Verse Sets */}
                            {setResults.length > 0 && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.7rem', marginBottom: '1rem' }}>
                                {setResults.map(set => (
                                  <button
                                    key={set.id}
                                    onClick={() => { setPickerSelectedSet(set); setMultiplayerSearchText(''); setShowPickerBrowser(true); }}
                                    style={{ padding: '0.9rem', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', color: '#334155', fontWeight: 'bold', cursor: 'pointer', textAlign: 'center', transition: 'background 0.2s', fontSize: '0.9rem' }}
                                    onMouseOver={(e) => e.currentTarget.style.background = '#ede9fe'}
                                    onMouseOut={(e) => e.currentTarget.style.background = '#f8fafc'}
                                  >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                      {customVerseSets.some(c => c.id === set.id) && <Crown size={16} />}
                                      {set.title}
                                    </span>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem', fontWeight: 'normal' }}>{set.verses?.length || 0} {t('節', 'paragraphs')}</div>
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Matching Verses */}
                            {verseResults.length > 0 && (
                              <div style={{ maxHeight: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingRight: '0.3rem' }}>
                                {verseResults.slice(0, 80).map(v => {
                                  const isSelected = multiplayerSelectedVerses.some(sv => sv.reference === v.reference);
                                  return (
                                    <div
                                      key={v.reference}
                                      onClick={() => {
                                        if (isSelected) {
                                          setMultiplayerSelectedVerses(prev => prev.filter(sv => sv.reference !== v.reference));
                                        } else {
                                          setMultiplayerSelectedVerses(prev => [...prev, v]);
                                        }
                                      }}
                                      style={{ padding: '0.8rem 1rem', border: `2px solid ${isSelected ? '#10b981' : '#e2e8f0'}`, borderRadius: '8px', background: isSelected ? '#ecfdf5' : '#fafafa', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.2rem', transition: 'all 0.15s' }}
                                      onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.borderColor = '#a78bfa'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)'; }}
                                      onMouseOut={(e) => { e.currentTarget.style.borderColor = isSelected ? '#10b981' : '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 'bold', color: '#7c3aed', fontSize: '1rem' }}>{formatVerseReferenceForDisplay(v.reference, version)}</span>
                                        {isSelected && <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1.1rem' }}>✓</span>}
                                      </div>
                                      {v.title && <span style={{ fontSize: '0.85rem', color: '#475569' }}>{v.title}</span>}
                                      {v.text && <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{v.text}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })() : (
                        /* ── Browse by Set (collapsed by default) ── */
                        <div>
                          <button
                            onClick={() => setShowPickerBrowser(v => !v)}
                            style={{ width: '100%', background: '#f1f5f9', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '0.75rem 1rem', cursor: 'pointer', color: '#64748b', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.95rem' }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><Library size={16} /> {t('瀏覽內容集', 'Browse Collections')}</span>
                            <span style={{ fontSize: '0.8rem' }}>{showPickerBrowser ? '▲' : '▼'}</span>
                          </button>
                          {showPickerBrowser && (
                            !pickerSelectedSet ? (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.7rem', maxHeight: '340px', overflowY: 'auto', marginTop: '0.75rem' }}>
                                {activeVerseSets.map(set => (
                                  <button
                                    key={set.id}
                                    onClick={() => setPickerSelectedSet(set)}
                                    style={{ padding: '0.9rem', border: '1px solid #cbd5e1', borderRadius: '8px', background: '#f8fafc', color: '#334155', fontWeight: 'bold', cursor: 'pointer', textAlign: 'center', transition: 'background 0.2s', fontSize: '0.9rem' }}
                                    onMouseOver={(e) => e.currentTarget.style.background = '#ede9fe'}
                                    onMouseOut={(e) => e.currentTarget.style.background = '#f8fafc'}
                                  >
                                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                      {customVerseSets.some(c => c.id === set.id) && <Crown size={16} />}
                                      {set.title}
                                    </span>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem', fontWeight: 'normal' }}>{set.verses?.length || 0} {t('節', 'paragraphs')}</div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '360px', overflowY: 'auto', paddingRight: '0.3rem', marginTop: '0.75rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.4rem' }}>
                                  <button onClick={() => { setPickerSelectedSet(null); setMultiplayerSelectedVerses([]); }} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0' }}>
                                    <span>←</span> {t('返回內容集', 'Back to Groups')}
                                  </button>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#f8fafc', padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                                      <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{t('隨機', 'Rand')} ({pickerSelectedSet.verses?.length || 0})</span>
                                      <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: '4px', overflow: 'hidden' }}>
                                        <button onClick={() => setRandomPickCount(Math.max(1, (parseInt(randomPickCount) || 1) - 1))} style={{ width: '24px', height: '24px', border: 'none', background: '#e2e8f0', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', transform: 'none' }}>-</button>
                                        <input type="number" min="1" max={pickerSelectedSet.verses?.length || 1} value={randomPickCount || 1} onChange={(e) => setRandomPickCount(e.target.value === '' ? '' : Math.min(pickerSelectedSet.verses?.length || 1, Math.max(1, parseInt(e.target.value))))} style={{ width: '36px', height: '24px', padding: '0', border: 'none', background: 'white', outline: 'none', textAlign: 'center', fontSize: '0.9rem', color: '#334155', fontWeight: 'bold', margin: '0' }} />
                                        <button onClick={() => setRandomPickCount(Math.min(pickerSelectedSet.verses?.length || 1, (parseInt(randomPickCount) || 1) + 1))} style={{ width: '24px', height: '24px', border: 'none', background: '#e2e8f0', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', transform: 'none' }}>+</button>
                                      </div>
                                      <button onClick={() => { if (!pickerSelectedSet?.verses) return; const sel = [...pickerSelectedSet.verses].sort(() => 0.5 - Math.random()).slice(0, randomPickCount); setActiveVerse(sel[0]); setPlayMode(multiplayerPlayMode); setDistractionLevel(multiplayerDistractionLevel); setInitAutoStart({ trigger: true, isAuto: false, isMultiplayerReadyCheck: true, campaignQueue: sel, verse: sel[0], playMode: multiplayerPlayMode }); setShowMultiplayerVersePicker(false); }} style={{ background: '#8b5cf6', color: 'white', border: 'none', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem' }}><Dices size={13} /> {t('開始', 'Start')}</button>
                                    </div>
                                    {multiplayerSelectedVerses.length > 0 && (
                                      <button onClick={() => { setActiveVerse(multiplayerSelectedVerses[0]); setPlayMode(multiplayerPlayMode); setDistractionLevel(multiplayerDistractionLevel); setInitAutoStart({ trigger: true, isAuto: false, isMultiplayerReadyCheck: true, campaignQueue: multiplayerSelectedVerses, verse: multiplayerSelectedVerses[0], playMode: multiplayerPlayMode }); setShowMultiplayerVersePicker(false); }} style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.4rem 0.9rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.85rem' }}>
                                        ✓ {t('完成揀選', 'Finish')} ({multiplayerSelectedVerses.length})
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {pickerSelectedSet.verses?.map(v => {
                                  const isSelected = multiplayerSelectedVerses.some(sv => sv.reference === v.reference);
                                  return (
                                    <div key={v.reference} onClick={() => { if (isSelected) { setMultiplayerSelectedVerses(prev => prev.filter(sv => sv.reference !== v.reference)); } else { setMultiplayerSelectedVerses(prev => [...prev, v]); } }} style={{ padding: '0.8rem 1rem', border: `2px solid ${isSelected ? '#10b981' : '#e2e8f0'}`, borderRadius: '8px', background: isSelected ? '#ecfdf5' : '#fafafa', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.2rem', transition: 'all 0.15s' }} onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.borderColor = '#a78bfa'; }} onMouseOut={(e) => { e.currentTarget.style.borderColor = isSelected ? '#10b981' : '#e2e8f0'; }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 'bold', color: '#7c3aed', fontSize: '1rem' }}>{formatVerseReferenceForDisplay(v.reference, version)}</span>
                                        {isSelected && <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span>}
                                      </div>
                                      {v.title && <span style={{ fontSize: '0.85rem', color: '#475569' }}>{v.title}</span>}
                                      {v.text && <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{v.text}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
                      <div style={{ padding: '1.5rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', width: '100%', maxWidth: '400px' }}>
                        {(!multiplayerState?.host || multiplayerState.host === myClientId) ? (
                          <>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#334155' }}>{t("等待玩家...", "Waiting...")}</h3>
                            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: getRoomColor(multiplayerRoomId) || '#3b82f6', letterSpacing: '6px', marginBottom: '0.8rem', background: (getRoomColor(multiplayerRoomId) || '#3b82f6') + '18', borderRadius: '8px', padding: '0.4rem 1.2rem', display: 'inline-block', border: `3px solid ${getRoomColor(multiplayerRoomId) || '#3b82f6'}`, boxShadow: `0 0 16px ${getRoomColor(multiplayerRoomId) || '#3b82f6'}44` }}>{multiplayerRoomId}</div>
                            <p style={{ color: '#94a3b8', fontSize: '0.9rem', margin: 0 }}>{t("請朋友輸入上方的代碼來加入您的遊戲", "Ask your friend to enter this code to join")}</p>

                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                              <div style={{ background: 'white', padding: '0.5rem', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                                <QRCodeSVG value={buildPublicShareUrl(window.location.pathname, { room: multiplayerRoomId, ref: personalCode })} size={120} />
                              </div>
                              <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: 0 }}>{t("或掃描上方 QR Code 快速加入", "or scan QR to join")}</p>
                            </div>
                          </>
                        ) : (
                          <>
                            <h3 style={{ margin: '0 0 1rem 0', color: '#3b82f6' }}>{multiplayerState?.status === 'playing' ? t("比賽進行中", "Match in progress") : t("等待遊戲開始...", "Waiting for game...")}</h3>
                            <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: getRoomColor(multiplayerRoomId) || '#3b82f6', letterSpacing: '6px', marginBottom: '0.8rem', background: (getRoomColor(multiplayerRoomId) || '#3b82f6') + '18', borderRadius: '8px', padding: '0.4rem 1.2rem', display: 'inline-block', border: `3px solid ${getRoomColor(multiplayerRoomId) || '#3b82f6'}`, boxShadow: `0 0 16px ${getRoomColor(multiplayerRoomId) || '#3b82f6'}44` }}>{multiplayerRoomId}</div>
                            <p style={{ color: '#0ea5e9', fontSize: '1.05rem', margin: '1rem 0 0 0', fontWeight: 'bold', lineHeight: 1.5 }}>
                              {multiplayerState?.status === 'playing'
                                ? t("請先選擇隊伍，", "Choose a team first,")
                                : t("現在等候遊戲主人選好內容，", "Waiting for the host to")} <br /> {multiplayerState?.status === 'playing' ? t("就可以加入這場比賽。", "then you can join this match.") : t("請稍後。。。", "select paragraphs, please wait...")}
                            </p>
                          </>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                        <button
                          onClick={() => {
                            if (socketRef.current) socketRef.current.close();
                            setMultiplayerRoomMode(null);
                            setMultiplayerRoomRole('player');
                            setMultiplayerRoomId(null);
                            setMultiplayerState(null);
                          }}
                          style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1', padding: '1.6rem 3rem', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1.4rem' }}
                        >
                          {t("離開房間", "Leave Room")}
                        </button>

                        {multiplayerState?.host === myClientId && (
                          <button
                            onClick={() => {
                              setShowMultiplayerVersePicker(true);
                              setPickerSelectedSet(null);
                              setMultiplayerSearchText('');
                              setShowPickerBrowser(false);
                            }}
                            disabled={!multiplayerState || (multiplayerState.matchType !== 'team' && Object.keys(multiplayerState.players).length < 2)}
                            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '6px', fontSize: '1.1rem', fontWeight: 'bold', cursor: !multiplayerState || (multiplayerState.matchType !== 'team' && Object.keys(multiplayerState?.players || {}).length < 2) ? 'not-allowed' : 'pointer', opacity: !multiplayerState || (multiplayerState.matchType !== 'team' && Object.keys(multiplayerState?.players || {}).length < 2) ? 0.5 : 1 }}
                          >
                            {t("選擇比賽內容", "Select Paragraph")}
                          </button>
                        )}
                      </div>

                      {multiplayerState && multiplayerState.players && (
                        <div style={{ width: '100%', maxWidth: '520px', textAlign: 'left', marginTop: '1rem' }}>
                          {multiplayerState.matchType === 'team' && multiplayerState.host !== myClientId && (
                            <div style={{ background: '#f8fafc', border: '1px solid #dbeafe', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                              <h4 style={{ margin: '0 0 0.75rem 0', color: '#334155' }}>{t("選擇你的隊伍", "Choose Your Team")}</h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                                {(multiplayerState.teams || TEAM_OPTIONS).map(team => {
                                  const selected = multiplayerState.players[myClientId]?.teamId === team.id;
                                  const locked = Boolean(multiplayerState.players[myClientId]?.teamId);
                                  const members = Object.values(multiplayerState.players || {}).filter(p => p.connected && p.teamId === team.id);
                                  return (
                                    <button
                                      key={team.id}
                                      onClick={() => {
                                        if (!locked && socketRef.current) socketRef.current.send(JSON.stringify({ type: 'SELECT_TEAM', teamId: team.id }));
                                      }}
                                      disabled={locked}
                                      style={{ border: `2px solid ${selected ? team.color : '#e2e8f0'}`, background: selected ? `${team.color}18` : 'white', borderRadius: '10px', padding: '0.9rem', cursor: locked ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', opacity: locked && !selected ? 0.55 : 1 }}
                                    >
                                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                                        <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />
                                        <span style={{ color: '#1e293b', fontWeight: 'bold', fontSize: '1rem' }}>{t(team.name, team.enName || team.name)}</span>
                                      </span>
                                      <span style={{ color: selected ? team.color : '#64748b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{selected ? t("已選", "Picked") : `${members.length}`}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {multiplayerState.players[myClientId]?.teamId && (
                                <p style={{ margin: '0.75rem 0 0 0', color: '#16a34a', fontWeight: 'bold', fontSize: '0.9rem' }}>{multiplayerState.status === 'playing' ? t("隊伍已鎖定，正在加入比賽。", "Team locked. Joining the match.") : t("隊伍已鎖定，等老師選內容。", "Team locked. Wait for the teacher to choose paragraphs.")}</p>
                              )}
                            </div>
                          )}
                          {multiplayerState.matchType === 'team' && multiplayerState.host === myClientId ? (
                            <>
                              <h4 style={{ color: '#475569', marginBottom: '0.5rem' }}>{t("隊伍狀態:", "Team Status:")}</h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                                {(multiplayerState.teams || TEAM_OPTIONS).map(team => {
                                  const members = Object.values(multiplayerState.players || {}).filter(p => p.connected && p.teamId === team.id);
                                  return (
                                    <div key={team.id} style={{ background: `${team.color}12`, border: `1px solid ${team.color}55`, borderRadius: '10px', padding: '0.85rem' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <strong style={{ color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.45rem' }}><span style={{ width: '10px', height: '10px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />{t(team.name, team.enName || team.name)}</strong>
                                        <span style={{ color: team.color, fontWeight: 'bold' }}>{members.length}</span>
                                      </div>
                                      <div style={{ color: '#64748b', fontSize: '0.85rem', minHeight: '1.2rem' }}>
                                        {members.length > 0 ? members.map(p => p.name).join('、') : t("等待加入", "Waiting")}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <>
                              <h4 style={{ color: '#475569', marginBottom: '0.5rem' }}>{t("已加入的玩家:", "Players Joined:")}</h4>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {Object.values(multiplayerState.players).map(p => {
                                  const team = getTeamById(p.teamId, multiplayerState.teams);
                                  return (
                                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.8rem', backgroundColor: '#f1f5f9', borderRadius: '6px' }}>
                                      <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: team?.color || p.color, boxShadow: '0 0 0 2px white, 0 0 0 4px ' + (team?.color || p.color) }}></div>
                                      <span style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '1.1rem' }}>{p.name} {multiplayerState.host === p.id ? '(Host)' : ''}</span>
                                      {team && <span style={{ color: team.color, background: `${team.color}16`, border: `1px solid ${team.color}55`, borderRadius: '999px', padding: '0.15rem 0.5rem', fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{t(team.name, team.enName || team.name)}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                    </div>
                  )}
                </div>
              )}

              {mainTab === 'versesets' && (
                <>

                  {/* The Verse Sets Table */}
                  <div className="versesets-table-card" style={{ backgroundColor: '#ffffff', overflowX: 'auto', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    {selectedSetId === null ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '1rem', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCustomSet(null);
                              setMainTab('custom_verses');
                            }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1rem', borderRadius: '8px', border: '1px solid #c4b5fd', background: canCreateCustomSets ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : '#f8fafc', color: canCreateCustomSets ? '#ffffff' : '#475569', fontWeight: 'bold', cursor: 'pointer', boxShadow: canCreateCustomSets ? '0 4px 10px rgba(124, 58, 237, 0.22)' : 'none' }}
                            title={canCreateCustomSets ? t('建立自訂內容集', 'Create custom sets') : t('登入後即可建立自訂內容集', 'Sign in to create custom collections')}
                          >
                            {canCreateCustomSets ? <Crown size={18} /> : <Lock size={18} />}
                            {t('我的內容集', 'My Custom Sets')}
                          </button>
                          <select
                            value={versesetsSort}
                            onChange={(e) => { setVersesetsSort(e.target.value); setVersesetsPage(1); }}
                            style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', background: '#f8fafc', color: '#334155', fontWeight: 'bold', cursor: 'pointer' }}
                          >
                            <option value="newest">{t("最新", "Newest")}</option>
                            <option value="title">{t("標題", "Title")}</option>
                            <option value="popular">{t("最受歡迎", "Most Popular")}</option>
                          </select>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', color: '#475569', fontSize: '0.9rem' }}>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', width: '50px' }}><Library size={18} /></th>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("標題", "Title")}</th>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("作者", "Author")}</th>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', textAlign: 'right' }}>{t("點閱次數", "Views")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const totalPages = Math.ceil(sortedVerseSetList.length / 10) || 1;
                              const currentPage = Math.min(versesetsPage, totalPages);
                              const currentSetList = sortedVerseSetList.slice((currentPage - 1) * 10, currentPage * 10);

                              return currentSetList.map((set, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: i % 2 === 0 ? '#ffffff' : '#f8fafc', transition: 'background 0.2s', cursor: 'pointer' }} onClick={() => {
                                  setSelectedSetId(set.id);
                                  fetch(`${PARTY_DB}/custom-sets/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: set.id, adminEmail: userEmail, adminName: playerName }) }).catch(e => e);
                                  setViewCounts(prev => ({ ...prev, [set.id]: (prev[set.id] || 0) + 1 }));
                                }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#eff6ff'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#ffffff' : '#f8fafc'}>
                                  <td style={{ padding: '1rem', textAlign: 'center', color: '#3b82f6', fontSize: '1.2rem' }}>{customVerseSets.some(c => c.id === set.id) ? <Crown size={22} /> : <Library size={22} />}</td>
                                  <td style={{ padding: '1rem', fontWeight: 'bold', color: '#1e293b', fontSize: '1.05rem' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleFavoriteVerseSet(set);
                                        }}
                                        title={favoriteVerseSetIdSet.has(set.id) ? t('從我的最愛移除', 'Remove from favorites') : (userEmail ? t('加入我的最愛', 'Add to favorites') : t('登入後可加入我的最愛', 'Log in to save favorites'))}
                                        aria-label={favoriteVerseSetIdSet.has(set.id) ? t('從我的最愛移除', 'Remove from favorites') : t('加入我的最愛', 'Add to favorites')}
                                        style={{
                                          width: '30px',
                                          height: '30px',
                                          borderRadius: '8px',
                                          border: favoriteVerseSetIdSet.has(set.id) ? '1px solid #facc15' : '1px solid #cbd5e1',
                                          background: favoriteVerseSetIdSet.has(set.id) ? '#fef3c7' : '#ffffff',
                                          color: favoriteVerseSetIdSet.has(set.id) ? '#ca8a04' : '#94a3b8',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          padding: 0,
                                          flex: '0 0 auto'
                                        }}
                                      >
                                        <Star size={17} fill={favoriteVerseSetIdSet.has(set.id) ? 'currentColor' : 'none'} />
                                      </button>
                                      <span>{set.title}</span>
                                    </span>
                                    {SHOW_SET_LIST_ROW_ACTIONS && isAdmin && (
                                      <span style={{ marginLeft: '1rem', display: 'inline-flex', gap: '0.5rem' }}>
                                        <button onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingCustomSet({ ...set, isPublished: true, verses: set.verses?.map(parseVerseRef) || [] });
                                          setMainTab('custom_verses');
                                        }} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: '#475569' }}>Admin {t('編輯', 'Edit')}</button>
                                        {isSuperAdmin && (
                                          <button onClick={(e) => {
                                            e.stopPropagation();
                                            // Two-tap confirm — window.confirm is dead inside the iOS App.
                                            if (deleteArmedId !== `admin-${set.id}`) { armDelete(`admin-${set.id}`); return; }
                                            setDeleteArmedId(null);
                                            const publishedExists = publishedVerseSets.some(p => p.id === set.id);
                                            if (!publishedExists) {
                                              const nextHidden = Array.from(new Set([...(hiddenOfficialSetIds || []), set.id]));
                                              setHiddenOfficialSetIds(nextHidden);
                                              localStorage.setItem('verseRain_hidden_official_sets', JSON.stringify(nextHidden));
                                              return;
                                            }
                                            fetch(`${PARTY_DB}/custom-sets`, {
                                              method: "DELETE",
                                              headers: { "Content-Type": "application/json" },
                                              body: JSON.stringify({ id: set.id, adminEmail: userEmail, adminName: playerName })
                                            })
                                              .then(async (res) => {
                                                if (!res.ok) {
                                                  const msg = await res.text().catch(() => '');
                                                  throw new Error(msg || `HTTP ${res.status}`);
                                                }
                                                setPublishedVerseSets(prev => prev.filter(p => p.id !== set.id));
                                                setToast(t('內容集已刪除', 'Set deleted'));
                                                setTimeout(() => setToast(null), 3000);
                                              })
                                              .catch((err) => {
                                                console.error(err);
                                                setToast(t("刪除失敗，請重新登入後再試。", "Delete failed. Please log in again and try once more."));
                                                setTimeout(() => setToast(null), 4000);
                                              });
                                          }} style={{ background: deleteArmedId === `admin-${set.id}` ? '#b91c1c' : '#fee2e2', border: '1px solid #fca5a5', color: deleteArmedId === `admin-${set.id}` ? 'white' : '#ef4444', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>{deleteArmedId === `admin-${set.id}` ? t('確認刪除？', 'Confirm?') : `Admin ${t('刪除', 'Delete')}`}</button>
                                        )}
                                      </span>
                                    )}
                                    {SHOW_SET_LIST_ROW_ACTIONS && (
                                    <button onClick={(e) => { e.stopPropagation(); copyVerseSetToMine(set); }}
                                      title={t('複製成我的內容集，可自行編輯，不影響原本的', 'Copy into my sets — edit freely without touching the original')}
                                      style={{ marginLeft: isAdmin ? '0.5rem' : '1rem', background: '#eef2ff', border: '1px solid #c7d2fe', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', color: '#4338ca' }}>
                                      {t('複製', 'Copy')}
                                    </button>
                                    )}
                                  </td>
                                  <td style={{ padding: '1rem', color: '#337ab7', fontSize: '0.9rem', fontWeight: 'bold' }}>{set.authorName && set.authorName !== "Anonymous" ? set.authorName : (String(set.id).startsWith("custom-") ? t('匿名玩家', 'Anonymous') : t('Verserain 官方', 'Official'))}</td>
                                  <td style={{ padding: '1rem', textAlign: 'right', color: '#64748b', fontWeight: 'bold' }}>{viewCounts[set.id] || 0}</td>
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>

                        {/* Pagination for Verse Sets */}
                        {(() => {
                          const totalPages = Math.ceil(sortedVerseSetList.length / 10) || 1;
                          if (totalPages <= 1) return null;
                          const PAGE_GROUP_SIZE = 10;
                          const groupStart = Math.floor((versesetsPage - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1;
                          const groupEnd = Math.min(totalPages, groupStart + PAGE_GROUP_SIZE - 1);
                          const visiblePages = Array.from({ length: groupEnd - groupStart + 1 }, (_, idx) => groupStart + idx);
                          const canGoPreviousGroup = groupStart > 1;
                          const canGoNextGroup = groupEnd < totalPages;
                          return (
                            <div className="versesets-pagination" style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: '0.5rem', borderTop: '1px solid #e2e8f0' }}>
                              <button
                                onClick={() => setVersesetsPage(Math.max(1, groupStart - PAGE_GROUP_SIZE))}
                                disabled={!canGoPreviousGroup}
                                className="versesets-page-step"
                                title={t("前 10 頁", "Previous 10 pages")}
                                style={{
                                  padding: '0.55rem 0.9rem',
                                  borderRadius: '8px',
                                  border: '1px solid #cbd5e1',
                                  background: !canGoPreviousGroup ? '#f1f5f9' : '#ffffff',
                                  color: !canGoPreviousGroup ? '#94a3b8' : '#475569',
                                  fontWeight: 'bold',
                                  cursor: !canGoPreviousGroup ? 'not-allowed' : 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {'<'}
                              </button>

                              <div className="versesets-page-window" style={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
                                <div className="versesets-page-scroll" style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', padding: '0.35rem 0.1rem', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}>
                                  {visiblePages.map((pageNumber) => {
                                    const isCurrent = versesetsPage === pageNumber;
                                    return (
                                      <button
                                        key={pageNumber}
                                        onClick={() => setVersesetsPage(pageNumber)}
                                        className="versesets-page-button"
                                        style={{
                                          padding: '0.55rem 0.9rem',
                                          borderRadius: '8px',
                                          border: isCurrent ? 'none' : '1px solid #cbd5e1',
                                          background: isCurrent ? '#3b82f6' : '#ffffff',
                                          color: isCurrent ? '#ffffff' : '#475569',
                                          fontWeight: 'bold',
                                          cursor: 'pointer',
                                          transition: 'all 0.2s',
                                          minWidth: '44px',
                                          flex: '0 0 auto',
                                          scrollSnapAlign: 'center'
                                        }}
                                      >
                                        {pageNumber}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <button
                                onClick={() => setVersesetsPage(Math.min(totalPages, groupEnd + 1))}
                                disabled={!canGoNextGroup}
                                className="versesets-page-step"
                                title={t("後 10 頁", "Next 10 pages")}
                                style={{
                                  padding: '0.55rem 0.9rem',
                                  borderRadius: '8px',
                                  border: '1px solid #cbd5e1',
                                  background: !canGoNextGroup ? '#f1f5f9' : '#ffffff',
                                  color: !canGoNextGroup ? '#94a3b8' : '#475569',
                                  fontWeight: 'bold',
                                  cursor: !canGoNextGroup ? 'not-allowed' : 'pointer',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {'>'}
                              </button>
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', flexWrap: 'wrap', gap: '1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: '1 1 360px', minWidth: 0 }}>
                            <button
                              onClick={() => setSelectedSetId(null)}
                              style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', padding: '0 1.15rem', height: '44px', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', color: '#ffffff', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0, boxShadow: '0 4px 12px rgba(37,99,235,0.3)', transition: 'transform 0.1s' }}
                              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                              <Home size={18} color="white" /> {t("返回目錄", "Back to Menu")}
                            </button>
                            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t("目前選擇", "Current Set")}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFavoriteVerseSet(currentSet);
                                    }}
                                    title={favoriteVerseSetIdSet.has(currentSet?.id) ? t('從我的最愛移除', 'Remove from favorites') : (userEmail ? t('加入我的最愛', 'Add to favorites') : t('登入後可加入我的最愛', 'Log in to save favorites'))}
                                    aria-label={favoriteVerseSetIdSet.has(currentSet?.id) ? t('從我的最愛移除', 'Remove from favorites') : t('加入我的最愛', 'Add to favorites')}
                                    style={{ width: '30px', height: '30px', borderRadius: '8px', border: favoriteVerseSetIdSet.has(currentSet?.id) ? '1px solid #facc15' : '1px solid #cbd5e1', background: favoriteVerseSetIdSet.has(currentSet?.id) ? '#fef3c7' : '#ffffff', color: favoriteVerseSetIdSet.has(currentSet?.id) ? '#ca8a04' : '#94a3b8', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, flex: '0 0 auto' }}
                                  >
                                    <Star size={17} fill={favoriteVerseSetIdSet.has(currentSet?.id) ? 'currentColor' : 'none'} />
                                  </button>
                                  <span style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentSet?.title}</span>
                                </span>
                              </div>
                              <div style={{ marginLeft: 'auto', textAlign: 'right', color: '#64748b', fontSize: '0.85rem', fontWeight: 'bold', flexShrink: 0, maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <div>
                                  <span style={{ color: '#94a3b8', marginRight: '0.35rem' }}>{t("作者", "Author")}</span>
                                  <button
                                    type="button"
                                    onClick={() => setAuthorSetsModal({ authorName: currentSetAuthorName })}
                                    style={{ background: 'none', border: 'none', padding: 0, color: '#337ab7', fontSize: 'inherit', fontWeight: 'inherit', cursor: 'pointer', textDecoration: 'none' }}
                                    onMouseOver={(e) => { e.currentTarget.style.color = '#1d4ed8'; e.currentTarget.style.textDecoration = 'underline'; }}
                                    onMouseOut={(e) => { e.currentTarget.style.color = '#337ab7'; e.currentTarget.style.textDecoration = 'none'; }}
                                    title={t("查看這位作者的內容集", "View this author's verse sets")}
                                  >
                                    {currentSetAuthorName === '匿名玩家' ? t('匿名玩家', 'Anonymous') : currentSetAuthorName === 'Verserain 官方' ? t('Verserain 官方', 'Official') : currentSetAuthorName}
                                  </button>
                                </div>
                                {currentSetLastEditorName && (
                                  <div style={{ marginTop: '0.18rem', color: '#94a3b8', fontSize: '0.78rem', fontWeight: 'bold' }}>
                                    {t("最後編輯", "Last edited by")} <span style={{ color: '#64748b' }}>{currentSetLastEditorName}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Top Level Action Bar */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>

                            <button
                              onClick={() => {
                                // Push the set to /share-set BEFORE handing the
                                // URL out — otherwise recipients in fresh
                                // contexts (Skool in-app webview, new device,
                                // logged-out) hit the viewSet fallback chain
                                // and the /share-set GET 404s, leaving them
                                // staring at the home page. Pushing first means
                                // the fallback can always resolve the id.
                                pushSetForSharing(currentSet);
                                // Share the sequential-listen experience: the
                                // recipient hears the WHOLE set in order
                                // (creator recordings included) via the /lc card.
                                pushSetForSharing(currentSet, true);
                                const link = buildPublicShareUrl('/lc', {
                                  set: currentSet.id,
                                  order: 'seq',
                                  version,
                                });
                                setQrShareModal({ url: link, reference: currentSet.title });
                              }}
                              title={t("分享聆聽連結(按序播放全部內容)", "Share listening link (all paragraphs in order)")}
                              style={{ backgroundColor: '#ffffff', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '6px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.1s' }}
                              onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = '#3b82f6'; }}
                              onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                            >
                              <Share2 size={16} />
                            </button>

                            <button
                              onClick={() => {
                                initAudio();
                                if (!currentSet?.verses?.length) return;
                                setPlayOrderChooser(currentSet);
                              }}
                              title={t("連續播放這個內容集（隨機或按序）", "Continuously play this collection (shuffled or in order)")}
                              style={{ backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', padding: '0 0.8rem', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s', fontWeight: 'bold', gap: '5px' }}
                              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                              <Headphones size={16} fill="white" /> {t("播放", "Play")}
                            </button>

                            <button
                              onClick={() => {
                                initAudio();
                                const queue = [...currentSet.verses];
                                const selCount = parseInt(randomPickCount) || 1;
                                const sel = queue.sort(() => 0.5 - Math.random()).slice(0, selCount);
                                
                                setCampaignQueue(sel);
                                setActiveCampaignSetId(currentSet.id);
                                setActiveCampaignSetTotal(sel.length);
                                
                                const pm = playMode.endsWith('_solo') ? playMode : playMode === 'square' ? 'square_solo' : playMode === 'rain' ? 'rain_solo' : 'voice_solo';
                                setMultiplayerPlayMode(pm);
                                setMultiplayerDistractionLevel(distractionLevel);
                                
                                pendingInvitePKRef.current = {
                                  queue: sel,
                                  pm: pm,
                                  dl: distractionLevel
                                };
                                
                                setMainTab('multiplayer');
                                const newRoom = createRoomCode();
                                setMultiplayerRoomMode('individual');
                                setMultiplayerRoomRole('player');
                                setMultiplayerRoomId(newRoom);
                              }}
                              title={t("開房間邀請連線遊玩", "Invite players for the whole set")}
                              style={{ backgroundColor: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '0 0.8rem', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s', fontWeight: 'bold', gap: '5px' }}
                              onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                              onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            >
                              <Users size={16} /> {t("邀人PK", "Invite")}
                            </button>

                            {(playerName === currentSet?.authorName || playerName === 'hungry@G') && (
                              <button
                                onClick={() => {
                                  setEditingCustomSet({ ...currentSet, isPublished: true, verses: currentSet.verses?.map(parseVerseRef) || [] });
                                  setMainTab('custom_verses');
                                }}
                                title={t("編輯這個內容集", "Edit this collection")}
                                style={{ backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '0 0.8rem', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s', fontWeight: 'bold', gap: '5px' }}
                                onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                                onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                              >
                                <Edit size={16} color="white" /> {t("編輯", "Edit")}
                              </button>
                            )}
                          </div>
                        </div>
                        {currentSet?.description && (
                          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#ffffff' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!('speechSynthesis' in window)) return;
                                  if (descTtsState === 'playing') {
                                    window.speechSynthesis.pause();
                                    setDescTtsState('paused');
                                    return;
                                  }
                                  if (descTtsState === 'paused') {
                                    window.speechSynthesis.resume();
                                    setDescTtsState('playing');
                                    return;
                                  }
                                  // idle → start fresh
                                  const tmp = document.createElement('div');
                                  tmp.innerHTML = currentSet.description || '';
                                  // Sanitize the description for TTS so URLs,
                                  // markdown syntax characters, and bare
                                  // protocol fragments aren't read out loud
                                  // — that "https colon slash slash ..."
                                  // recital is unpleasant.
                                  const text = (tmp.textContent || '')
                                    // Drop URLs (http(s)://, www., bare youtube embeds)
                                    .replace(/https?:\/\/\S+/gi, ' ')
                                    .replace(/\bwww\.\S+/gi, ' ')
                                    // Drop markdown link [label](url) — keep label only
                                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                                    // Strip markdown emphasis & headers/blockquote/list markers
                                    .replace(/[*_~`]+/g, ' ')        // **bold** *italic* ~~strike~~ `code`
                                    .replace(/^#{1,6}\s+/gm, '')      // # ## ### headings
                                    .replace(/^\s*>\s+/gm, '')        // > blockquotes
                                    .replace(/^\s*[-+]\s+/gm, '')     // - + list bullets
                                    .replace(/^\s*\d+\.\s+/gm, '')    // 1. 2. ordered list
                                    // Collapse whitespace
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                  if (!text) return;
                                  initAudio();
                                  stopSpeechIfActive();
                                  const lang = getVoiceLangForVersion(version);
                                  // 中文朗讀時把出處唸成口語:「3:16」→「第三章16節」、
                                  // 「4:1-3」→「第四章1到3節」。
                                  const zhLike = !isEnglishBibleVersion(version) && !['ko', 'ja', 'fa', 'ar', 'he'].includes(version);
                                  const speechText = zhLike ? humanizeChineseReferencesForSpeech(text) : text;
                                  // Chunk by sentence to keep utterances short (some
                                  // browsers cap utterance length and silently fail).
                                  const chunks = speechText.match(/[^。！？!?.\n]+[。！？!?.\n]?/g) || [speechText];
                                  let i = 0;
                                  const speakNext = () => {
                                    if (i >= chunks.length) { setDescTtsState('idle'); return; }
                                    const u = new SpeechSynthesisUtterance(chunks[i++]);
                                    u.lang = lang;
                                    u.rate = 1.0;
                                    try { const v = pickSpeechVoice(lang); if (v) u.voice = v; } catch {}
                                    u.onend = speakNext;
                                    u.onerror = () => setDescTtsState('idle');
                                    window.speechSynthesis.speak(u);
                                  };
                                  setDescTtsState('playing');
                                  speakNext();
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.9rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: descTtsState === 'playing' ? '#fde68a' : '#ffffff', color: '#334155', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}
                                title={descTtsState === 'playing' ? t('暫停朗讀', 'Pause reading') : descTtsState === 'paused' ? t('繼續朗讀', 'Resume reading') : t('朗讀說明', 'Read description')}
                              >
                                {descTtsState === 'playing' ? <Pause size={14} /> : <Play size={14} />}
                                {descTtsState === 'playing' ? t('暫停', 'Pause') : descTtsState === 'paused' ? t('繼續', 'Resume') : t('朗讀', 'Read')}
                              </button>
                            </div>
                            <div style={{ color: '#334155', fontSize: '1rem', lineHeight: '1.6' }} dangerouslySetInnerHTML={{ __html: currentSet.description }} className="ql-editor-content" />
                          </div>
                        )}
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                          <thead>
                            <tr style={{ backgroundColor: '#f8fafc', color: '#475569', fontSize: '0.9rem' }}>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("段落 (點擊觀看)", "Paragraph (click to view)")}</th>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', textAlign: 'center', width: '100px' }}>{t("排行", "Rank")}</th>
                              <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0', width: '140px', textAlign: 'center' }}>{t("操作", "Action")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {VERSES_DB.map((v, i) => {
                              const vBest = parseInt(localStorage.getItem(`verseRainBestScore_${v.reference}`)) || 0;
                              const isSelected = selectedVerseRefs.includes(v.reference);

                              return (
                                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: isSelected ? '#eff6ff' : (i % 2 === 0 ? '#ffffff' : '#f8fafc'), transition: 'background 0.2s', cursor: 'pointer' }} onClick={() => toggleSelection(v.reference)}>
                                  <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: '#1e293b', fontSize: '0.95rem' }} onClick={(e) => { e.stopPropagation(); setVerseViewModal({ ...v, setId: currentSet?.id }); }}>
                                    <button style={{ background: 'none', border: 'none', padding: 0, margin: 0, color: '#3b82f6', textDecoration: 'underline', cursor: 'pointer', fontWeight: 'bold', fontSize: 'inherit', fontFamily: 'inherit' }}>
                                      {formatVerseReferenceForDisplay(v.reference, version)}
                                    </button>
                                  </td>
                                  <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                    <button
                                      style={{ background: 'transparent', border: '1px solid #fbbf24', color: '#d97706', padding: '0.3rem 0.6rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap', fontWeight: 'bold' }}
                                      onClick={() => {
                                        setLeaderboardModalVerse(v);
                                        setIsFetchingLeaderboard(true);
                                        fetch(`/api/get-scores?verseRef=${encodeURIComponent(v.reference)}`)
                                          .then(res => res.json())
                                          .then(data => setLeaderboardModalData(data && Array.isArray(data.alltime) ? data : { alltime: Array.isArray(data) ? data : [], monthly: [], daily: [] }))
                                          .catch(() => setLeaderboardModalData({ alltime: [], monthly: [], daily: [] }))
                                          .finally(() => setIsFetchingLeaderboard(false));
                                      }}
                                    >
                                      <Trophy size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '3px' }} /> {vBest > 0 ? vBest : t('排行榜', 'Rank')}
                                    </button>
                                  </td>
                                  <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                                    <div style={{ display: 'flex', flexDirection: 'row', gap: '0.4rem', justifyContent: 'center' }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          playSingleVerseCard(v, currentSet);
                                        }}
                                        title={(currentSetVoices[v.reference] || currentSetVoiceRefs.has(v.reference))
                                          ? (currentSetVoices[v.reference]
                                              ? t('播放這一段({name}親聲朗讀)', 'Play this paragraph (read by {name})').replace('{name}', String(currentSetVoices[v.reference].recordedBy || t('創作者', 'the creator')))
                                              : t('這節有人聲錄音', 'This paragraph has a voice recording'))
                                          : t("播放這一段", "Play this paragraph")}
                                        style={{ position: 'relative', backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s' }}
                                        onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                        onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                      >
                                        <Headphones size={14} fill="white" />
                                        {(currentSetVoices[v.reference] || currentSetVoiceRefs.has(v.reference)) && (
                                          <span style={{ position: 'absolute', top: '-7px', right: '-7px', fontSize: '0.8rem', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))' }} aria-label={t('有人聲錄音', 'Voice recording available')}>⭐</span>
                                        )}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Open the same challenge chooser (mode + difficulty)
                                          // as the set-level 挑戰, but scoped to this one verse.
                                          openChallengeSetup({
                                            subtitle: formatVerseReferenceForDisplay(v.reference, version),
                                            run: () => {
                                              setCampaignQueue(null);
                                              setCampaignResults([]);
                                              setActiveVerse(v);
                                              setSelectedVerseRefs([v.reference]);
                                              if (currentSet?.id) setSelectedSetId(currentSet.id);
                                              setTimeout(() => startGame(false, v), 50);
                                            },
                                          });
                                        }}
                                        title={t("挑戰這一段", "Challenge this paragraph")}
                                        style={{ backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s' }}
                                        onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                        onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                      >
                                        <Zap size={14} fill="white" />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Share the LISTEN experience (/lc card link with the
                                          // set context) — recipients hear the verse (creator
                                          // recording when available) instead of jumping straight
                                          // into a challenge.
                                          pushSetForSharing(currentSet, true);
                                          const verseIdx = (currentSet?.verses || []).findIndex(x => x?.reference === v.reference);
                                          const link = buildPublicShareUrl('/lc', {
                                            set: currentSet?.id,
                                            ...(verseIdx >= 0 ? { i: verseIdx } : { verse: v.reference }),
                                            version,
                                          });
                                          setQrShareModal({ url: link, reference: v.reference });
                                        }}
                                        title={t("分享聆聽連結", "Share listening link")}
                                        style={{ backgroundColor: '#ffffff', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '6px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.1s' }}
                                        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; e.currentTarget.style.color = '#3b82f6'; e.currentTarget.style.borderColor = '#3b82f6'; }}
                                        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                                      >
                                        <Share2 size={14} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>

                </>
              )}

              {mainTab === 'garden' && (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <h2 style={{ color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}><TreePine size={28} color="#10b981" /> {t("我的園子", "My Garden")}</h2>
                    <button
                      type="button"
                      onClick={() => setMainTab('custom_verses')}
                      style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#b45309', padding: '0.45rem 1rem', borderRadius: '20px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <Crown size={16} /> {t('我的內容集', 'My Custom Sets')} →
                    </button>
                  </div>
                  <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1rem' }}>
                    {t("每挑戰一節新內容，就會在空地上長出嫩芽。持續練習讓它長大！通過內容變成大樹，創新高則結出果子。", "Each new paragraph you challenge sprouts a seedling. Keep practicing to grow it! Clearing a paragraph makes it a full tree; new high scores bear fruit.")}
                  </p>

                  {/* Phase 1: Personal-progress hero cards (today + streak + accumulation) */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
                    {/* Today + Streak (combined) */}
                    <div style={{ background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', border: '1px solid #6ee7b7', borderRadius: '14px', padding: '1.3rem 1.5rem', textAlign: 'center', boxShadow: '0 2px 6px rgba(16,185,129,0.08)' }}>
                      <div style={{ color: '#065f46', fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>{t('今日問候', "Today's Greeting")}</div>
                      <div style={{ color: '#065f46', fontSize: '1.05rem', marginBottom: '1rem', fontWeight: 600 }}>
                        {playerName
                          ? t('{name}，今日的內容雨活動已累積 {n} 分', `{name}, {n} point${personalProgress.todayCount === 1 ? '' : 's'} from today's VerseRain activity`).replace('{name}', String(playerName)).replace('{n}', String(personalProgress.todayCount))
                          : t('今日的內容雨活動已累積 {n} 分', `{n} point${personalProgress.todayCount === 1 ? '' : 's'} from today's VerseRain activity`).replace('{n}', String(personalProgress.todayCount))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '2.6rem', filter: personalProgress.currentStreak > 0 ? 'none' : 'grayscale(1) opacity(0.4)' }}>🔥</span>
                        <span style={{ fontSize: '3rem', fontWeight: 800, color: '#047857', lineHeight: 1 }}>{personalProgress.currentStreak}</span>
                      </div>
                      <div style={{ color: '#047857', fontSize: '0.95rem', fontWeight: 600, marginTop: '0.3rem' }}>
                        {personalProgress.currentStreak > 0
                          ? t('連續 {n} 天', '{n}-day streak').replace('{n}', String(personalProgress.currentStreak))
                          : t('今天開始建立連續紀錄吧！', 'Start your streak today!')}
                      </div>
                      {personalProgress.longestStreak > personalProgress.currentStreak && (
                        <div style={{ color: '#059669', fontSize: '0.78rem', marginTop: '0.35rem', opacity: 0.8 }}>
                          {t('最長連續：{n} 天', 'Best: {n} days').replace('{n}', String(personalProgress.longestStreak))}
                        </div>
                      )}
                    </div>

                    {/* Personal cumulative stats */}
                    <div style={{ background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '1px solid #93c5fd', borderRadius: '14px', padding: '1.3rem 1.5rem', boxShadow: '0 2px 6px rgba(59,130,246,0.08)' }}>
                      <div style={{ color: '#1e3a8a', fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.7rem', textAlign: 'center' }}>{t('個人累積', 'Cumulative')}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem 1rem' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#1d4ed8', lineHeight: 1 }}>{personalProgress.totalActivities}</div>
                          <div style={{ fontSize: '0.78rem', color: '#1e3a8a', marginTop: '0.25rem' }}>{t('已挑戰', 'Plays')}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#1d4ed8', lineHeight: 1 }}>{personalProgress.treesPlanted}</div>
                          <div style={{ fontSize: '0.78rem', color: '#1e3a8a', marginTop: '0.25rem' }}>{t('已栽種', 'Trees')}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#1d4ed8', lineHeight: 1 }}>{personalProgress.champVerses}</div>
                          <div style={{ fontSize: '0.78rem', color: '#1e3a8a', marginTop: '0.25rem' }}>{t('結果子', 'Fruited')}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#1d4ed8', lineHeight: 1 }}>{totalFruits}</div>
                          <div style={{ fontSize: '0.78rem', color: '#1e3a8a', marginTop: '0.25rem' }}>{t('總果子', 'Fruits')}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* My Referrer card — shows who invited me, or a CTA to bind */}
                  <InviterCard
                    inviterCode={myInviterCode}
                    inviterName={myInviterName}
                    canEdit={!myInviterCode}
                    onOpenBindModal={() => setShowBindInviterModal(true)}
                    t={t}
                  />

                  {/* My Harvest Basket Header */}
                  <div style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', padding: '2rem', borderRadius: '16px', border: '1px solid #fde68a', marginBottom: '2rem', textAlign: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
                    <ShoppingBasket size={64} color="#d97706" style={{ marginBottom: '0.5rem', animation: 'bounce 2s infinite' }} />
                    <h3 style={{ margin: 0, fontSize: '1.8rem', color: '#b45309', marginBottom: '0.5rem' }}>{t("我的收成", "My Harvest")}</h3>
                    <p style={{ margin: 0, color: '#92400e', fontSize: '1.1rem', marginBottom: '1.5rem' }}>
                      {t("過關斬將結出果子，提升你的互惠階級！", "Clear paragraphs to bear fruit and level up!")}
                    </p>

                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '1rem', background: '#fff', padding: '1rem 2rem', borderRadius: '50px', border: '2px solid #fbbf24', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)', flexWrap: 'wrap', justifyContent: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderRight: '2px solid #fcd34d', paddingRight: '1rem' }}>
                        <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {t("總果子數量", "Total Fruits")}
                          <button
                            onClick={() => setShowFruitInfo(true)}
                            title={t("查看果子來源說明", "How are fruits counted?")}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', lineHeight: '1', fontSize: '1rem', animation: 'pulse 2s infinite', display: 'flex', alignItems: 'center', color: '#94a3b8' }}
                          ><Info size={16} /></button>
                        </span>
                        <span style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#d97706', lineHeight: '1', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>{totalFruits} <Apple size={28} /></span>
                      </div>
                      <button
                        onClick={() => setShowLevelInfo(true)}
                        onMouseEnter={e => Object.assign(e.currentTarget.style, { transform: 'scale(1.05)', backgroundColor: '#f8fafc' })}
                        onMouseLeave={e => Object.assign(e.currentTarget.style, { transform: 'scale(1)', backgroundColor: 'transparent' })}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.5rem 1rem', background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 0.2s', borderRadius: '12px' }}
                      >
                        <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {t("目前階級", "Current Level")} <Info size={16} style={{ animation: 'pulse 2s infinite' }} />
                        </span>
                        <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: skoolLevel.level >= 3 ? '#8b5cf6' : '#2563eb' }}>
                          Lv.{skoolLevel.level} {t(skoolLevel.title, skoolLevel.enTitle)}
                        </span>
                      </button>
                    </div>

                    {skoolLevel.next !== null && (
                      <div style={{ marginTop: '1.5rem', maxWidth: '400px', margin: '1.5rem auto 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#92400e', marginBottom: '0.3rem', fontWeight: 'bold' }}>
                          <span>Lv.{skoolLevel.level}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Lv.{skoolLevel.level + 1} ({skoolLevel.next}<Apple size={14} />)</span>
                        </div>
                        <div style={{ width: '100%', height: '14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, (totalFruits / skoolLevel.next) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #fbbf24, #f59e0b)', transition: 'width 1s ease-in-out' }} />
                        </div>
                      </div>
                    )}

                    {/* Gamification Invite Block (Unlocked for Lv.2+, Teaser for Lv.1) */}
                    <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
                      <h4 style={{ margin: 0, color: skoolLevel.level >= 2 ? '#10b981' : '#94a3b8', fontSize: '1.3rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Mail size={24} /> {t("邀請朋友一起玩", "Invite Friends to Play")}
                      </h4>

                      {skoolLevel.level >= 2 ? (
                        <>
                          <p style={{ margin: 0, color: '#475569', fontSize: '1rem', lineHeight: '1.5', marginBottom: '1.2rem' }}>
                            {t("你的專屬推廣連結：當朋友們透過此連結直接進入加入 VerseRain，並完成他們的第一次背經遊戲，雙方都會自動獲得「推廣點數」獎勵，同時你也將累積推廣大使進度！", "Your personal invite link: When friends load ParagraphRain via this link and complete their first game, both of you earn bonus points!")}
                          </p>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                            <input
                              readOnly
                              value={buildPublicShareUrl('/', { ref: personalCode })}
                              style={{ flex: 1, minWidth: '220px', padding: '0.8rem', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#334155', fontSize: '0.95rem' }}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(buildPublicShareUrl('/', { ref: personalCode }));
                                setToast(t("邀請連結已複製！快發給好朋友吧！", "Invite link copied! Share it with friends!"));
                                setTimeout(() => setToast(null), 3500);
                              }}
                              style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s', minHeight: '44px' }}
                              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            >
                              {t("複製", "Copy")}
                            </button>
                            {typeof QRCodeSVG !== 'undefined' && (
                              <button
                                onClick={() => setQrShareModal({ url: buildPublicShareUrl('/', { ref: personalCode }), reference: 'VerseRain 遊戲邀請' })}
                                style={{ background: '#10b981', color: 'white', border: 'none', padding: '0 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s', minHeight: '44px' }}
                              >
                                {t("QR 碼", "QR Code")}
                              </button>
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.8rem' }}>
                          <p style={{ margin: 0, color: '#64748b', fontSize: '1rem', lineHeight: '1.5' }}>
                            {t("想要擁有你的個人推薦碼並賺取推廣點數嗎？", "Want to get your personal invite code and earn referral points?")}
                          </p>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#f1f5f9', padding: '0.6rem 1rem', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                            <Lock size={18} />
                            <span style={{ color: '#475569', fontSize: '0.95rem' }}>
                              {t("再結出 ", "Bear ")} <strong>{2 - totalFruits}</strong> {t(" 個果子，達到 Lv.2 即可解鎖個人專屬連結！", " more fruits to reach Lv.2 and unlock your invite link!")}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {(() => {
                    const entries = Object.entries(gardenData).filter(([k]) => k !== '_activity');
                    const treeCount = entries.length;
                    const cellsPerField = 100;
                    const maxGridIndex = entries.reduce((max, [, data]) => Math.max(max, data.gridIndex), -1);
                    const fieldCount = Math.max(1, Math.ceil((maxGridIndex + 1) / cellsPerField));

                    // Build grid lookup: gridIndex -> { ref, stage, fruits }
                    const gridMap = {};
                    entries.forEach(([ref, data]) => {
                      gridMap[data.gridIndex] = { ref, ...data };
                    });

                    // Stage visuals
                    const applePositions = [
                      { top: '30%', left: '50%' }, // 1
                      { top: '45%', left: '30%' }, // 2
                      { top: '45%', left: '70%' }, // 3
                      { top: '25%', left: '35%' }, // 4
                      { top: '25%', left: '65%' }, // 5
                      { top: '55%', left: '50%' }, // 6
                      { top: '35%', left: '20%' }, // 7
                      { top: '35%', left: '80%' }, // 8
                      { top: '15%', left: '50%' }, // 9
                    ];

                    const stageEmoji = (stage, fruits) => {
                      if (stage <= 0) return '';
                      if (stage <= 3) return <img src="/assets/garden/tree-seedling.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 10px 10px rgba(0,0,0,0.2))' }} alt="seedling" />;
                      if (stage <= 6) return <img src="/assets/garden/tree-sapling.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 15px 15px rgba(0,0,0,0.2))' }} alt="sapling" />;
                      if (stage <= 9) return <img src="/assets/garden/tree-mature.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.3))' }} alt="mature tree" />;

                      if (fruits > 0) {
                        const displayApples = Math.min(fruits, 9);
                        return (
                          <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ position: 'absolute', width: '150%', height: '150%', transform: 'translateY(-15%)' }}>
                              <img src="/assets/garden/tree-mature.png" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.3))' }} alt="mature tree" />
                              {Array.from({ length: displayApples }).map((_, idx) => (
                                <div key={idx} style={{
                                  position: 'absolute',
                                  top: applePositions[idx].top,
                                  left: applePositions[idx].left,
                                  fontSize: '14px',
                                  transform: 'translate(-50%, -50%)',
                                  filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.4))',
                                  zIndex: 2,
                                  pointerEvents: 'none',
                                }}><Apple size={14} fill="#dc2626" color="#b91c1c" /></div>
                              ))}
                            </div>
                            {fruits > 9 && (
                              <span style={{ position: 'absolute', top: '-15px', right: '-15px', fontSize: '12px', fontWeight: 'bold', color: '#b91c1c', background: 'rgba(255,255,255,0.9)', borderRadius: '6px', padding: '1px 4px', zIndex: 3, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                +{fruits - 9}
                              </span>
                            )}
                          </div>
                        );
                      }
                      return <img src="/assets/garden/tree-mature.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.3))' }} alt="mature tree" />;
                    };

                    const stageLabel = (stage) => {
                      if (stage === 1) return t('嫩芽', 'Seedling');
                      if (stage <= 3) return t('幼苗', 'Sprout');
                      if (stage <= 5) return t('小樹', 'Sapling');
                      if (stage <= 8) return t('成長中', 'Growing');
                      if (stage === 9) return t('快完成了', 'Almost there');
                      return t('大樹', 'Full Tree');
                    };

                    const stageBg = (stage) => {
                      if (stage === 0) return '#e8f5e9';
                      if (stage <= 3) return '#c8e6c9';
                      if (stage <= 6) return '#a5d6a7';
                      if (stage <= 9) return '#81c784';
                      return '#66bb6a';
                    };

                    return (
                      <div>
                        {/* Stats bar */}
                        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                          <div style={{ padding: '0.5rem 1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', color: '#0f172a', fontWeight: '500' }}>
                            <Sprout size={18} /> {t("種植", "Planted")}: <strong>{treeCount}</strong>
                          </div>
                          <div style={{ padding: '0.5rem 1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', color: '#4c1d95', fontWeight: '500' }}>
                            <TreePine size={18} /> {t("大樹", "Full Trees")}: <strong>{entries.filter(([, d]) => d.stage >= 10).length}</strong>
                          </div>
                          <div style={{ padding: '0.5rem 1rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fde68a', color: '#7f1d1d', fontWeight: '500' }}>
                            <Apple size={18} /> {t("果子", "Fruits")}: <strong>{entries.reduce((sum, [, d]) => sum + (d.fruits || 0), 0)}</strong>
                          </div>
                        </div>

                        {/* Mode & Level Controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', padding: '0.8rem 1rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{t("點擊查看內容，雙擊開始挑戰！", "Click to view, double-click to challenge!")}</span>
                        </div>

                        {/* The Grid - Isometric */}
                        {(() => {
                          const hour = new Date().getHours();
                          let envBg = 'linear-gradient(to bottom, #bae6fd, #e0f2fe)'; // Day
                          if (hour >= 19 || hour < 5) envBg = 'linear-gradient(to bottom, #0f172a, #1e1b4b)'; // Night
                          else if (hour >= 17) envBg = 'linear-gradient(to bottom, #fca5a5, #fef08a)'; // Sunset
                          else if (hour >= 5 && hour < 8) envBg = 'linear-gradient(to bottom, #fce7f3, #fef08a)'; // Sunrise

                          // Square-ish field layout: rows = ceil(sqrt(n)), cols = ceil(n/rows)
                          const fieldRows = Math.ceil(Math.sqrt(fieldCount));
                          const fieldCols = Math.ceil(fieldCount / fieldRows);

                          // Auto-zoom to fit all fields: each field = 10×48 + 9×2 = 498px
                          const FIELD_PX = 498, FIELD_GAP = 40;
                          const contentW = fieldCols * FIELD_PX + Math.max(0, fieldCols - 1) * FIELD_GAP;
                          const contentH = fieldRows * FIELD_PX + Math.max(0, fieldRows - 1) * FIELD_GAP;
                          const fitScale = Math.min(520 / (contentW + 40), 460 / (contentH + 40), 1);
                          const gardenInitialScale = Math.max(0.25, Math.round(fitScale * 0.85 * 100) / 100);

                          return (
                            <div style={{
                              overflow: 'hidden',
                              width: '100%',
                              height: '60vh',
                              minHeight: '400px',
                              borderRadius: '12px',
                              border: '4px solid #334155',
                              background: envBg,
                              position: 'relative',
                              boxShadow: 'inset 0 10px 30px rgba(0,0,0,0.1)'
                            }}>
                              <TransformWrapper initialScale={gardenInitialScale} minScale={0.2} maxScale={4} centerOnInit={true} doubleClick={{ disabled: true }}>
                                {({ zoomIn, zoomOut, resetTransform }) => (
                                  <>
                                    <div style={{ position: 'absolute', bottom: '15px', right: '15px', zIndex: 10, display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.8)', padding: '5px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
                                      <button onClick={() => zoomIn()} style={{ width: '32px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                      <button onClick={() => zoomOut()} style={{ width: '32px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                      <button onClick={() => resetTransform()} style={{ width: '32px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RotateCw size={18} /></button>
                                    </div>
                                    <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px' }}>
                                      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${fieldCols}, auto)`, justifyContent: 'center', gap: '40px' }}>
                                        {Array.from({ length: fieldCount }).map((_, fieldIdx) => (
                                          <div key={fieldIdx} style={{
                                            display: 'grid',
                                            gridTemplateColumns: `repeat(10, 48px)`,
                                            gridTemplateRows: `repeat(10, 48px)`,
                                            gap: '2px',
                                            background: (hour >= 19 || hour < 5) ? 'rgba(30, 41, 59, 0.4)' : 'rgba(34, 197, 94, 0.3)',
                                            border: '2px solid rgba(255,255,255,0.2)',
                                            borderRadius: '8px',
                                          }}>
                                            {Array.from({ length: cellsPerField }).map((_, i) => {
                                              const globalIndex = fieldIdx * cellsPerField + i;
                                              const cell = gridMap[globalIndex];
                                              const isEmpty = !cell;

                                              return (
                                                <div
                                                  key={globalIndex}
                                                  onClick={() => {
                                                    if (cell) {
                                                      if (gardenClickTimer.current) { clearTimeout(gardenClickTimer.current); gardenClickTimer.current = null; return; }
                                                      gardenClickTimer.current = setTimeout(async () => {
                                                        gardenClickTimer.current = null;
                                                        const allCurrentVerses = [...safeActiveSets, ...customVerseSets].flatMap(s => s.verses);
                                                        let targetVerse = findVerseByRef(allCurrentVerses, cell.ref);
                                                        let detectedLang = version;
                                                        if (!targetVerse) {
                                                          setIsLangsLoading(true);
                                                          const langKeys = ['en', 'cuv', 'cuvs'];
                                                          for (const lang of langKeys) {
                                                            if (lang === version) continue;
                                                            let data = loadedLangs[lang];
                                                            if (!data) {
                                                              data = await loadLanguageSets(lang);
                                                              setLoadedLangs(prev => ({ ...prev, [lang]: data }));
                                                            }
                                                            const found = findVerseByRef(data.verses, cell.ref);
                                                            if (found) { targetVerse = found; detectedLang = lang; break; }
                                                          }
                                                          setIsLangsLoading(false);
                                                        }
                                                        setSelectedGardenCell({
                                                          ref: cell.ref,
                                                          text: targetVerse?.text || '',
                                                          stage: cell.stage,
                                                          fruits: cell.fruits || 0,
                                                          setId: cell.setId,
                                                          verse: targetVerse,
                                                          detectedLang,
                                                        });
                                                        setTimeout(() => {
                                                          const popup = document.getElementById('garden-verse-popup');
                                                          if (popup) popup.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                                        }, 100);
                                                      }, 300);
                                                    }
                                                  }}
                                                  onDoubleClick={async () => {
                                                    if (cell) {
                                                      if (gardenClickTimer.current) { clearTimeout(gardenClickTimer.current); gardenClickTimer.current = null; }
                                                      const allCurrentVerses = [...safeActiveSets, ...customVerseSets].flatMap(s => s.verses);
                                                      let targetVerse = findVerseByRef(allCurrentVerses, cell.ref);
                                                      let detectedLang = version;
                                                      if (!targetVerse) {
                                                        setIsLangsLoading(true);
                                                        const langKeys = ['en', 'cuv', 'cuvs'];
                                                        for (const lang of langKeys) {
                                                          if (lang === version) continue;
                                                          let data = loadedLangs[lang];
                                                          if (!data) {
                                                            data = await loadLanguageSets(lang);
                                                            setLoadedLangs(prev => ({ ...prev, [lang]: data }));
                                                          }
                                                          const found = findVerseByRef(data.verses, cell.ref);
                                                          if (found) { targetVerse = found; detectedLang = lang; break; }
                                                        }
                                                        setIsLangsLoading(false);
                                                      }
                                                      if (targetVerse) {
                                                        setSelectedGardenCell(null);
                                                        if (detectedLang !== version) {
                                                          versionBeforeChallenge.current = version;
                                                          setVersion(detectedLang);
                                                        }
                                                        openChallengeSetup({
                                                          subtitle: targetVerse.reference,
                                                          run: () => {
                                                            setActiveVerse(targetVerse);
                                                            setSelectedVerseRefs([targetVerse.reference]);
                                                            if (cell.setId) setSelectedSetId(cell.setId);
                                                            setTimeout(() => startGame(false, targetVerse), 50);
                                                          },
                                                        });
                                                      }
                                                    }
                                                  }}
                                                  title={cell ? `${cell.ref} — ${stageLabel(cell.stage)}${cell.fruits ? ` fruit x ${cell.fruits}` : ''}` : t('空地', 'Empty')}
                                                  style={{
                                                    width: '48px', height: '48px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: cell ? '20px' : '10px',
                                                    background: cell ? stageBg(cell.stage) : '#5d4037',
                                                    border: cell ? '1px solid rgba(0,0,0,0.1)' : 'none',
                                                    cursor: cell ? 'pointer' : 'default', transition: 'transform 0.1s, filter 0.2s', userSelect: 'none'
                                                  }}
                                                  onMouseOver={e => { if (cell) { e.currentTarget.style.filter = 'brightness(1.15)'; e.currentTarget.style.transform = 'scale(1.08)'; } }}
                                                  onMouseOut={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.transform = ''; }}
                                                >
                                                  {cell ? stageEmoji(cell.stage, cell.fruits || 0) : ''}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ))}
                                      </div>
                                    </TransformComponent>
                                  </>
                                )}
                              </TransformWrapper>
                            </div>
                          );
                        })()}
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}><Smartphone size={15} /> {t("可用手指滑動來瀏覽園子", "Swipe to pan around the garden")}</p>

                        {/* Verse Info Popup Modal */}
                        {selectedGardenCell && (
                          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setSelectedGardenCell(null)}>
                            <div id="garden-verse-popup" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '400px', padding: '1.5rem', background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)', borderRadius: '15px', border: '3px solid #86efac', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', position: 'relative', animation: 'flashSuccess 0.3s ease-out' }}>
                              <button onClick={() => setSelectedGardenCell(null)} style={{ position: 'absolute', top: '10px', right: '15px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.4rem', fontWeight: 'bold' }}><X size={22} /></button>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' }}>
                                <div style={{ width: '60px', height: '60px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <div style={{ width: '100%', height: '100%', position: 'absolute', bottom: '0', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                                    {stageEmoji(selectedGardenCell.stage, selectedGardenCell.fruits)}
                                  </div>
                                </div>
                                <span style={{ fontWeight: 'bold', color: '#166534', fontSize: '1.2rem' }}>{selectedGardenCell.ref}</span>
                                <span style={{ fontSize: '0.85rem', color: '#166534', background: '#b2f5ea', padding: '3px 10px', borderRadius: '12px', fontWeight: 'bold' }}>{stageLabel(selectedGardenCell.stage)}</span>
                                {selectedGardenCell.detectedLang && selectedGardenCell.detectedLang !== version && (
                                  <span style={{ fontSize: '0.75rem', color: '#1d4ed8', background: '#dbeafe', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                                    {isEnglishBibleVersion(selectedGardenCell.detectedLang) ? 'English 🇬🇧' : baseLang(selectedGardenCell.detectedLang) === 'cuvs' ? '简体 🇨🇳' : '繁體 🇹🇼'}
                                  </span>
                                )}
                              </div>
                              <p style={{ color: '#334155', lineHeight: '1.6', fontSize: '1rem', margin: '1rem 0 0.8rem', fontStyle: 'italic', maxHeight: '30vh', overflowY: 'auto' }}>
                                "{selectedGardenCell.text || t('(內容內容未找到)', '(Paragraph text not found)')}"
                              </p>
                              {selectedGardenCell.detectedLang && selectedGardenCell.detectedLang !== version && (
                                <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 1rem', textAlign: 'center' }}>
                                  {t('將暫時切換語言來挑戰，完成後自動恢復', 'Will temporarily switch language for this challenge, then restore')}
                                </p>
                              )}
                              <button onClick={() => {
                                if (selectedGardenCell.verse) {
                                  if (selectedGardenCell.detectedLang && selectedGardenCell.detectedLang !== version) {
                                    versionBeforeChallenge.current = version;
                                    setVersion(selectedGardenCell.detectedLang);
                                  }
                                  setActiveVerse(selectedGardenCell.verse);
                                  setSelectedVerseRefs([selectedGardenCell.verse.reference]);
                                  if (selectedGardenCell.setId) setSelectedSetId(selectedGardenCell.setId);
                                  setSelectedGardenCell(null);
                                  setTimeout(() => startGame(false, selectedGardenCell.verse), 50);
                                }
                              }} style={{ width: '100%', justifyContent: 'center', background: '#22c55e', color: 'white', border: 'none', padding: '0.8rem', borderRadius: '10px', fontWeight: 'bold', fontSize: '1.1rem', cursor: selectedGardenCell.verse ? 'pointer' : 'not-allowed', opacity: selectedGardenCell.verse ? 1 : 0.5, boxShadow: '0 4px 12px rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Play size={20} /> {t('挑戰這一段', 'Challenge this paragraph')}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Legend */}
                        <div style={{ marginTop: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.9rem', color: '#475569', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><img src="/assets/garden/tree-seedling.png" style={{ height: '28px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' }} alt="seedling" /> {t("幼苗 (練習中)", "Sprout (practicing)")}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><img src="/assets/garden/tree-sapling.png" style={{ height: '32px', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.2))' }} alt="sapling" /> {t("小樹 (持續成長)", "Sapling (growing)")}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><img src="/assets/garden/tree-mature.png" style={{ height: '36px', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))' }} alt="mature tree" /> {t("大樹 (通過!)", "Full tree (cleared!)")}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Apple size={18} /> {t("結果子 (創新高!)", "Fruit (new record!)")}</span>
                        </div>
                      </div>
                    );
                  })()}

                  <ActivityHeatmap t={t} activityMap={gardenData?._activity || {}} />

                  {/* Reciprocity History */}
                  <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderBottom: '1px solid #cbd5e1', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
                      <h3 style={{ margin: 0, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Info size={18} /> {t('互惠點數紀錄', 'Reciprocity History')}
                      </h3>
                      <div style={{ marginLeft: 'auto', fontSize: '0.9rem', color: '#475569', fontWeight: 'bold' }}>
                        {t('推薦果子', 'Referral Fruits')} <span style={{ color: '#ea580c' }}>{referralOnlyPoints}</span> <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span> {t('內容集被玩', 'Custom Sets Played')} <span style={{ color: '#ea580c' }}>{creatorOnlyPoints}</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                      {/* Referrals */}
                      <div>
                        <h4 style={{ color: '#0369a1', marginTop: 0, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Users size={18} /> {t('推薦紀錄', 'Referrals')}
                        </h4>
                        {referralHistory && referralHistory.length > 0 ? (() => {
                          // Group: same player + same type → sum amounts, keep latest timestamp
                          const grouped = [];
                          const keyMap = {};
                          referralHistory.forEach(h => {
                            const key = `${h.type}::${h.player}`;
                            if (keyMap[key] !== undefined) {
                              grouped[keyMap[key]].amount += h.amount;
                              if (h.timestamp > grouped[keyMap[key]].timestamp) grouped[keyMap[key]].timestamp = h.timestamp;
                              grouped[keyMap[key]].count = (grouped[keyMap[key]].count || 1) + 1;
                            } else {
                              keyMap[key] = grouped.length;
                              grouped.push({ ...h, count: 1 });
                            }
                          });
                          const totalPages = Math.ceil(grouped.length / HISTORY_PAGE_SIZE);
                          const page = Math.min(referralHistoryPage, totalPages);
                          const sliced = grouped.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);
                          return (
                            <>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {sliced.map((h, i) => (
                                  <div key={i} style={{ background: '#fff', padding: '10px 15px', borderRadius: '8px', borderLeft: h.type === 'referred' ? '4px solid #10b981' : '4px solid #3b82f6', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontSize: '0.9rem', color: '#475569' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>{new Date(h.timestamp).toLocaleString()} {h.count > 1 && <span style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: '10px', padding: '1px 7px', fontSize: '0.7rem', fontWeight: 'bold', marginLeft: '4px' }}>×{h.count}</span>}</div>
                                    {h.type === 'referred' ? (
                                      <span>{t('推薦了玩家', 'Referred player')} <strong style={{ color: '#0f766e' }}>{h.player}</strong> {t('加入了 VerseRain', 'to ParagraphRain')} <span style={{ color: '#10b981', fontWeight: 'bold' }}>(+{h.amount} {t('點', 'pts')})</span></span>
                                    ) : (
                                      <span>{t('透過', 'Joined via')} <strong style={{ color: '#1d4ed8' }}>{h.player}</strong> {t('的推薦加入', "'s referral")} <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>(+{h.amount} {t('點', 'pts')})</span></span>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {totalPages > 1 && (
                                <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '10px' }}>
                                  <button onClick={() => setReferralHistoryPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: page <= 1 ? '#f1f5f9' : '#fff', color: page <= 1 ? '#94a3b8' : '#334155', cursor: page <= 1 ? 'default' : 'pointer', fontWeight: 'bold' }}>‹</button>
                                  {Array.from({ length: totalPages }, (_, idx) => (
                                    <button key={idx} onClick={() => setReferralHistoryPage(idx + 1)} style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', background: page === idx + 1 ? '#0369a1' : '#f1f5f9', color: page === idx + 1 ? '#fff' : '#334155', cursor: 'pointer', fontWeight: 'bold' }}>{idx + 1}</button>
                                  ))}
                                  <button onClick={() => setReferralHistoryPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: page >= totalPages ? '#f1f5f9' : '#fff', color: page >= totalPages ? '#94a3b8' : '#334155', cursor: page >= totalPages ? 'default' : 'pointer', fontWeight: 'bold' }}>›</button>
                                </div>
                              )}
                            </>
                          );
                        })() : (
                          <div style={{ padding: '1.5rem', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#94a3b8', textAlign: 'center', fontSize: '0.9rem' }}>
                            {t('尚未有任何推薦紀錄。分享邀請碼邀請朋友獲得互惠點數！', 'No referral history yet. Share your invite code to get reciprocity points!')}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>

                </div>
              )}

              {mainTab === 'leaderboard' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                  {/* 1. 排行榜切換按鈕 */}
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                    <button onClick={() => { setGlobalLeaderboardTab('daily'); setPageGlobalLeaderboard(1); setPagePopularVerses(1); }} style={{ padding: '0.8rem 2rem', border: 'none', background: globalLeaderboardTab === 'daily' ? '#10b981' : '#e2e8f0', color: globalLeaderboardTab === 'daily' ? 'white' : '#475569', borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', transition: 'all 0.2s', boxShadow: globalLeaderboardTab === 'daily' ? '0 4px 6px -1px rgba(16, 185, 129, 0.4)' : 'none' }}>{t("本日排行", "Daily")}</button>
                    <button onClick={() => { setGlobalLeaderboardTab('monthly'); setPageGlobalLeaderboard(1); setPagePopularVerses(1); }} style={{ padding: '0.8rem 2rem', border: 'none', background: globalLeaderboardTab === 'monthly' ? '#8b5cf6' : '#e2e8f0', color: globalLeaderboardTab === 'monthly' ? 'white' : '#475569', borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', transition: 'all 0.2s', boxShadow: globalLeaderboardTab === 'monthly' ? '0 4px 6px -1px rgba(139, 92, 246, 0.4)' : 'none' }}>{t("本月排行", "Monthly")}</button>
                    <button onClick={() => { setGlobalLeaderboardTab('alltime'); setPageGlobalLeaderboard(1); setPagePopularVerses(1); }} style={{ padding: '0.8rem 2rem', border: 'none', background: globalLeaderboardTab === 'alltime' ? '#3b82f6' : '#e2e8f0', color: globalLeaderboardTab === 'alltime' ? 'white' : '#475569', borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', transition: 'all 0.2s', boxShadow: globalLeaderboardTab === 'alltime' ? '0 4px 6px -1px rgba(59, 130, 246, 0.4)' : 'none' }}>{t("歷史總榜", "All Time")}</button>
                  </div>

                  {/* 2. 個人總積分排行榜 - reads from globalLeaderboardData (Redis) */}
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <h2 style={{ color: '#1e293b', marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Trophy color="#2563eb" /> {t("個人總積分排行榜", "Player Total Score Leaderboard")}
                      <button
                        onClick={() => setShowLevelInfo(true)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: '#94a3b8', transition: 'color 0.2s' }}
                        onMouseOver={(e) => e.currentTarget.style.color = '#3b82f6'}
                        onMouseOut={(e) => e.currentTarget.style.color = '#94a3b8'}
                        title={t("階層說明", "Level Info")}
                      >
                        <Info size={18} />
                      </button>
                    </h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.9rem' }}>
                          <th style={{ padding: '0.8rem 1rem', width: '50px' }}><Trophy size={18} /></th>
                          <th style={{ padding: '0.8rem 1rem' }}>{t("玩家名稱", "Player Name")}</th>
                          <th style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>{t("總積分", "Total Score")}</th>
                          <th style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>{t("完成次數", "Clears")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const entries = globalLeaderboardData[globalLeaderboardTab] || [];
                          if (isFetchingGlobalLeaderboard) {
                            return <tr><td colSpan="4" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><Hourglass size={16} /> {t("載入中...", "Loading...")}</span></td></tr>;
                          }
                          if (entries.length === 0) {
                            return <tr><td colSpan="4" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>{t("目前尚無紀錄", "No records yet")}</td></tr>;
                          }
                          const alltimeClears = {};
                          (globalLeaderboardData.alltime || []).forEach(({ name, clears }) => {
                            if (!name) return;
                            alltimeClears[name] = clears || 0;
                          });

                          return entries
                            .slice((pageGlobalLeaderboard - 1) * 10, pageGlobalLeaderboard * 10)
                            .map(({ name, total, clears }, relativeIdx) => {
                              const idx = (pageGlobalLeaderboard - 1) * 10 + relativeIdx;
                              return (
                                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                  <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: idx === 0 ? '#d97706' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#64748b', fontSize: '1.2rem' }}>#{idx + 1}</td>
                                  <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: '#1e293b', fontFamily: cjkDataFontStack }}>
                                    <span style={{ fontFamily: cjkDataFontStack }}>{name}</span> {name === playerName && <Crown size={14} style={{ color: '#fbbf24', marginLeft: '5px' }} />}
                                    <button
                                      onClick={async () => {
                                        setViewingPlayerGarden({ playerName: name, gardenData: null, loading: true });
                                        try {
                                          const [gardenRes, pointsRes] = await Promise.all([
                                            fetch(`${PARTY_DB}/garden?player=${encodeURIComponent(name)}`),
                                            fetch(`/api/get-creator-points?author=${encodeURIComponent(name)}`).catch(() => null)
                                          ]);
                                          const data = await gardenRes.json();
                                          let creatorPts = 0;
                                          let refPts = 0;
                                          if (pointsRes && pointsRes.ok) {
                                            try {
                                              const ptsData = await pointsRes.json();
                                              creatorPts = ptsData.points || 0;
                                              refPts = ptsData.referralPoints || 0;
                                            } catch (e) {}
                                          }
                                          if (data.success) {
                                            setViewingPlayerGarden({ playerName: name, gardenData: data.gardenData, creatorPoints: creatorPts, referralPoints: refPts, loading: false });
                                          } else {
                                            setViewingPlayerGarden({ playerName: name, gardenData: {}, creatorPoints: creatorPts, referralPoints: refPts, loading: false, error: t('該玩家尚未分享園地', 'This player has not shared their garden yet') });
                                          }
                                        } catch {
                                          setViewingPlayerGarden({ playerName: name, gardenData: {}, loading: false, error: t('無法載入', 'Failed to load') });
                                        }
                                      }}
                                      style={{ marginLeft: '8px', fontSize: '0.8rem', backgroundColor: '#f1f5f9', color: '#2563eb', padding: '0.2rem 0.6rem', borderRadius: '12px', border: '1px solid #bfdbfe', whiteSpace: 'nowrap', cursor: 'pointer', fontWeight: 'bold', transition: 'all 0.2s' }}
                                      onMouseOver={e => { e.currentTarget.style.backgroundColor = '#dbeafe'; e.currentTarget.style.borderColor = '#3b82f6'; }}
                                      onMouseOut={e => { e.currentTarget.style.backgroundColor = '#f1f5f9'; e.currentTarget.style.borderColor = '#bfdbfe'; }}
                                      title={t('點擊查看此玩家的園地', "Click to view this player's garden")}
                                    >
                                      {(() => {
                                        // Only use true fruits when globalFruitsMap has been loaded
                                        const hasGardenData = globalFruitsMap && Object.keys(globalFruitsMap).length > 0;
                                        if (hasGardenData) {
                                          const gardenFruits = globalFruitsMap[name] || 0;
                                          const bonus = globalLeaderboardData && globalLeaderboardData.bonusFruitsMap && globalLeaderboardData.bonusFruitsMap[name];
                                          const creatorFruits = (bonus && bonus.creatorPoints) || 0;
                                          const lvl = getSkoolLevel(gardenFruits + creatorFruits);
                                          return <><Sprout size={15} /> Lv.{lvl.level} {t(lvl.title, lvl.enTitle)}</>;
                                        }
                                        // Fallback: garden data not loaded yet, use clears
                                        const lvl = getSkoolLevel(alltimeClears[name] || clears);
                                        return <><Sprout size={15} /> Lv.{lvl.level} {t(lvl.title, lvl.enTitle)}</>;
                                      })()}
                                    </button>

                                  </td>
                                  <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#3b82f6' }}>{(total || 0).toLocaleString()}</td>
                                  <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>{clears || 0}</td>
                                </tr>
                              );
                            });
                        })()}
                      </tbody>
                    </table>
                    {(() => {
                      const totalEntries = (globalLeaderboardData[globalLeaderboardTab] || []).length;
                      const totalPages = Math.max(1, Math.ceil(totalEntries / 10));
                      if (totalPages > 1) {
                        return (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1.5rem', gap: '1rem' }}>
                            <button onClick={() => setPageGlobalLeaderboard(p => Math.max(1, p - 1))} disabled={pageGlobalLeaderboard === 1} style={{ background: pageGlobalLeaderboard === 1 ? '#f1f5f9' : '#e2e8f0', color: pageGlobalLeaderboard === 1 ? '#cbd5e1' : '#475569', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: pageGlobalLeaderboard === 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t("上一頁", "Prev")}</button>
                            <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 'bold' }}>{pageGlobalLeaderboard} / {totalPages}</span>
                            <button onClick={() => setPageGlobalLeaderboard(p => Math.min(totalPages, p + 1))} disabled={pageGlobalLeaderboard === totalPages} style={{ background: pageGlobalLeaderboard === totalPages ? '#f1f5f9' : '#e2e8f0', color: pageGlobalLeaderboard === totalPages ? '#cbd5e1' : '#475569', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: pageGlobalLeaderboard === totalPages ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t("下一頁", "Next")}</button>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* 4. 最受歡迎內容集 */}
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <h2 style={{ color: '#1e293b', marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}><Trophy color="#f59e0b" /> {t("最受歡迎內容集", "Most Popular Collections")}</h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.9rem' }}>
                          <th style={{ padding: '0.8rem 1rem', width: '50px' }}><Trophy size={18} /></th>
                          <th style={{ padding: '0.8rem 1rem' }}>{t("標題", "Title")}</th>
                          <th style={{ padding: '0.8rem 1rem' }}>{t("作者", "Author")}</th>
                          <th style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>{t("點閱次數", "Views")}</th>
                          <th style={{ padding: '0.8rem 1rem', width: '60px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const sortedSets = [...activeVerseSets]
                            .sort((a, b) => (viewCounts[b.id] || 0) - (viewCounts[a.id] || 0));
                          const paginatedSets = sortedSets.slice((pagePopularSets - 1) * 10, pagePopularSets * 10);
                          return paginatedSets.map((set, relativeIdx) => {
                            const idx = (pagePopularSets - 1) * 10 + relativeIdx;
                            return (
                              <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', transition: 'background 0.2s' }} onClick={() => {
                                setMainTab('versesets');
                                setSelectedSetId(set.id);
                                fetch(`${PARTY_DB}/custom-sets/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: set.id, adminEmail: userEmail, adminName: playerName }) }).catch(e => e);
                                setViewCounts(prev => ({ ...prev, [set.id]: (prev[set.id] || 0) + 1 }));
                              }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#eff6ff'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: idx === 0 ? '#d97706' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#64748b', fontSize: '1.2rem' }}>#{idx + 1}</td>
                                <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: '#1e293b' }}>{set.title}</td>
                                <td style={{ padding: '0.8rem 1rem', color: '#3b82f6' }}>{set.authorName && set.authorName !== "Anonymous" ? set.authorName : (String(set.id).startsWith("custom-") ? t('匿名玩家', 'Anonymous') : t('Verserain 官方', 'Official'))}</td>
                                <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>{viewCounts[set.id] || 0}</td>
                                <td style={{ padding: '0.8rem 0' }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMainTab('versesets');
                                      setSelectedSetId(set.id);
                                      fetch(`${PARTY_DB}/custom-sets/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: set.id, adminEmail: userEmail, adminName: playerName }) }).catch(e => e);
                                      setViewCounts(prev => ({ ...prev, [set.id]: (prev[set.id] || 0) + 1 }));
                                    }}
                                    style={{ backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s' }}
                                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                  >
                                    <Zap size={14} fill="white" />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                    {(() => {
                      const totalEntries = activeVerseSets.length;
                      const totalPages = Math.max(1, Math.ceil(totalEntries / 10));
                      if (totalPages > 1) {
                        return (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1.5rem', gap: '1rem' }}>
                            <button onClick={() => setPagePopularSets(p => Math.max(1, p - 1))} disabled={pagePopularSets === 1} style={{ background: pagePopularSets === 1 ? '#f1f5f9' : '#e2e8f0', color: pagePopularSets === 1 ? '#cbd5e1' : '#475569', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: pagePopularSets === 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t("上一頁", "Prev")}</button>
                            <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 'bold' }}>{pagePopularSets} / {totalPages}</span>
                            <button onClick={() => setPagePopularSets(p => Math.min(totalPages, p + 1))} disabled={pagePopularSets === totalPages} style={{ background: pagePopularSets === totalPages ? '#f1f5f9' : '#e2e8f0', color: pagePopularSets === totalPages ? '#cbd5e1' : '#475569', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: pagePopularSets === totalPages ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t("下一頁", "Next")}</button>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* 3. 最受歡迎內容排行榜 */}
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <h2 style={{ color: '#1e293b', marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}><Trophy color="#10b981" /> {t("最受歡迎內容排行榜", "Most Popular Paragraphs")}</h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '0.9rem' }}>
                          <th style={{ padding: '0.8rem 1rem', width: '50px' }}><Trophy size={18} /></th>
                          <th style={{ padding: '0.8rem 1rem' }}>{t("段落", "Reference")}</th>
                          <th style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>{t("遊玩次數", "Plays")}</th>
                          <th style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>{t("完成次數", "Completes")}</th>
                          <th style={{ padding: '0.8rem 1rem', width: '60px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const allVerses = Object.entries((globalVerseStats[globalLeaderboardTab] || {}))
                            .sort((a, b) => b[1].plays - a[1].plays || b[1].completes - a[1].completes);
                          const paginatedVerses = allVerses.slice((pagePopularVerses - 1) * 10, pagePopularVerses * 10);

                          if (allVerses.length === 0) {
                            return <tr><td colSpan="5" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>{t("目前尚無內容紀錄", "No records yet")}</td></tr>;
                          }

                          return paginatedVerses.map(([ref, stats], relativeIdx) => {
                            const idx = (pagePopularVerses - 1) * 10 + relativeIdx;
                            return (
                              <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: idx === 0 ? '#d97706' : idx === 1 ? '#94a3b8' : idx === 2 ? '#b45309' : '#64748b', fontSize: '1.2rem' }}>#{idx + 1}</td>
                                <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: '#1e293b' }}>{ref}</td>
                                <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#10b981' }}>{stats.plays}</td>
                                <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>{stats.completes}</td>
                                <td style={{ padding: '0.8rem 0' }}>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      // Search current set first, then ALL language pools (fixes iPhone 'verse not found')
                                      let targetVerse = findVerseByRef(VERSES_DB, ref);
                                      let detectedLang = null;
                                      if (!targetVerse) {
                                        const allCurrentVerses = safeActiveSets.flatMap(s => s.verses);
                                        targetVerse = findVerseByRef(allCurrentVerses, ref);
                                      }
                                      if (!targetVerse) {
                                        setIsLangsLoading(true);
                                        const langKeys = ['en', 'cuv', 'cuvs'];
                                        for (const lang of langKeys) {
                                          if (lang === version) continue;
                                          let data = loadedLangs[lang];
                                          if (!data) {
                                            data = await loadLanguageSets(lang);
                                            setLoadedLangs(prev => ({ ...prev, [lang]: data }));
                                          }
                                          const found = findVerseByRef(data.verses, ref);
                                          if (found) { targetVerse = found; detectedLang = lang; break; }
                                        }
                                        setIsLangsLoading(false);
                                      }
                                      if (targetVerse) {
                                        if (detectedLang) {
                                          versionBeforeChallenge.current = version;
                                          setVersion(detectedLang);
                                        }
                                        setActiveVerse(targetVerse);
                                        setTimeout(() => startGame(false, targetVerse), 200);
                                      } else {
                                        setToast(t('本機找不到此內容', 'Paragraph not found locally'));
                                      }
                                    }}
                                    style={{ backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'transform 0.1s' }}
                                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                                  >
                                    <Zap size={14} fill="white" />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                    {(() => {
                      const totalEntries = Object.keys((globalVerseStats[globalLeaderboardTab] || {})).length;
                      const totalPages = Math.max(1, Math.ceil(totalEntries / 10));
                      if (totalPages > 1) {
                        return (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1.5rem', gap: '1rem' }}>
                            <button onClick={() => setPagePopularVerses(p => Math.max(1, p - 1))} disabled={pagePopularVerses === 1} style={{ background: pagePopularVerses === 1 ? '#f1f5f9' : '#e2e8f0', color: pagePopularVerses === 1 ? '#cbd5e1' : '#475569', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: pagePopularVerses === 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t("上一頁", "Prev")}</button>
                            <span style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 'bold' }}>{pagePopularVerses} / {totalPages}</span>
                            <button onClick={() => setPagePopularVerses(p => Math.min(totalPages, p + 1))} disabled={pagePopularVerses === totalPages} style={{ background: pagePopularVerses === totalPages ? '#f1f5f9' : '#e2e8f0', color: pagePopularVerses === totalPages ? '#cbd5e1' : '#475569', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: pagePopularVerses === totalPages ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{t("下一頁", "Next")}</button>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                </div>
              )}
              {mainTab === 'search' && (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <h2 style={{ color: '#1e293b', marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}><Search color="#0369a1" /> {t("搜尋內容", "Search Paragraphs")}</h2>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("輸入關鍵字，例如「利未記」或「醫治」...", "Enter keyword...")}
                    style={{ width: '100%', padding: '0.8rem 1rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '1rem', marginBottom: '2rem', boxSizing: 'border-box' }}
                  />

                  {(() => {
                    if (!searchQuery.trim()) return <div style={{ color: '#64748b' }}>{t("請輸入關鍵字開始搜尋。", "Please enter a keyword to search.")}</div>;
                    const query = searchQuery.trim().toLowerCase();
                    // Search in sets — title, description, or author name.
                    const matchingSets = activeVerseSets.filter(s =>
                      s && s.title && (
                        s.title.toLowerCase().includes(query) ||
                        (s.description && s.description.replace(/<[^>]+>/g, '').toLowerCase().includes(query)) ||
                        (s.authorName && s.authorName.toLowerCase().includes(query))
                      )
                    );
                    // Search in individual paragraphs — label/title/text substring.
                    const matchingVerses = activeVerseSets.flatMap(s =>
                      (s && s.verses) ? s.verses.map(v => ({ ...v, setId: s.id, setName: s.title })) : []
                    ).filter(v =>
                      v && (
                        (v.reference && v.reference.toLowerCase().includes(query)) ||
                        (v.title && v.title.toLowerCase().includes(query)) ||
                        (v.text && v.text.toLowerCase().includes(query))
                      )
                    );

                    return (
                      <div>
                        {matchingSets.length > 0 && (
                          <div style={{ marginBottom: '2rem' }}>
                            <h3 style={{ color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>{t("內容集資料夾", "Collections")} ({matchingSets.length})</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '1rem' }}>
                              {(() => {
                                const totalPages = Math.ceil(matchingSets.length / 10);
                                const paginatedSets = matchingSets.slice((searchSetsPage - 1) * 10, searchSetsPage * 10);
                                return paginatedSets.map(set => (
                                  <div key={set.id} onClick={() => { setSelectedSetId(set.id); setMainTab('versesets'); }} style={{ padding: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', backgroundColor: '#f8fafc', display: 'flex', alignItems: 'center', gap: '1rem', transition: 'background-color 0.2s' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#eff6ff'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}>
                                    <div style={{ color: '#3b82f6' }}><Library size={34} /></div>
                                    <div>
                                      <div style={{ fontWeight: 'bold', color: '#1e293b', fontSize: '1.1rem' }}>{set.title}</div>
                                      <div style={{ color: '#3b82f6', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                                        {t('作者', 'Author')}：{set.authorName && set.authorName !== "Anonymous" ? set.authorName : (String(set.id).startsWith("custom-") ? t('匿名玩家', 'Anonymous') : t('Verserain 官方', 'Official'))}
                                      </div>
                                      <div className="ql-editor-content" style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.3rem', maxHeight: '4.5em', overflow: 'hidden', textOverflow: 'ellipsis' }} dangerouslySetInnerHTML={{ __html: set.description }} />
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>

                            {/* Search Sets Pagination */}
                            {Math.ceil(matchingSets.length / 10) > 1 && (
                              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                                {Array.from({ length: Math.ceil(matchingSets.length / 10) }).map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => setSearchSetsPage(idx + 1)}
                                    style={{
                                      padding: '0.5rem 1rem',
                                      borderRadius: '8px',
                                      border: searchSetsPage === idx + 1 ? 'none' : '1px solid #cbd5e1',
                                      background: searchSetsPage === idx + 1 ? '#8b5cf6' : '#ffffff',
                                      color: searchSetsPage === idx + 1 ? '#ffffff' : '#475569',
                                      fontWeight: 'bold',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s',
                                      minWidth: '40px'
                                    }}
                                  >
                                    {idx + 1}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {matchingVerses.length > 0 && (
                          <div>
                            <h3 style={{ color: '#334155', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1rem' }}>{t("單獨段落", "Individual Paragraphs")} ({matchingVerses.length})</h3>
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                  <tr style={{ backgroundColor: '#f8fafc', color: '#475569', fontSize: '0.9rem' }}>
                                    <th style={{ padding: '0.8rem 1rem', borderBottom: '2px solid #cbd5e1' }}>{t("所屬內容集", "From Set")}</th>
                                    <th style={{ padding: '0.8rem 1rem', borderBottom: '2px solid #cbd5e1' }}>{t("段落", "Reference")}</th>
                                    <th style={{ padding: '0.8rem 1rem', borderBottom: '2px solid #cbd5e1' }}>{t("內容片段", "Preview")}</th>
                                    <th style={{ padding: '0.8rem 1rem', borderBottom: '2px solid #cbd5e1', textAlign: 'right' }}>{t("直接遊玩", "Play")}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const totalPages = Math.ceil(matchingVerses.length / 10);
                                    const paginatedVerses = matchingVerses.slice((searchVersesPage - 1) * 10, searchVersesPage * 10);
                                    return paginatedVerses.map((v, i) => (
                                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', transition: 'background-color 0.1s' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <td style={{ padding: '0.8rem 1rem', fontSize: '0.85rem' }}>
                                          {v.setId ? (
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setSelectedSetId(v.setId); setMainTab('versesets'); }}
                                              title={t("前往這個內容集", "Go to this collection")}
                                              style={{ background: 'transparent', border: 'none', color: '#0ea5e9', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                                              onMouseOver={(e) => e.target.style.textDecoration = 'underline'}
                                              onMouseOut={(e) => e.target.style.textDecoration = 'none'}
                                            >
                                              {v.setName}
                                            </button>
                                          ) : (
                                            <span style={{ color: '#64748b' }}>{v.setName}</span>
                                          )}
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem', fontWeight: 'bold', color: '#0369a1', fontSize: '0.95rem' }}>
                                          <button onClick={(e) => { e.stopPropagation(); setVerseViewModal(v); }} style={{ background: 'transparent', border: 'none', color: '#0ea5e9', fontWeight: 'bold', fontSize: '0.95rem', cursor: 'pointer', padding: 0, textAlign: 'left' }} onMouseOver={(e) => e.target.style.textDecoration = 'underline'} onMouseOut={(e) => e.target.style.textDecoration = 'none'}>
                                            {formatVerseReferenceForDisplay(v.reference, version)}
                                          </button>
                                        </td>
                                        <td style={{ padding: '0.8rem 1rem', color: '#475569', fontSize: '0.9rem' }}>{v.text.substring(0, 35)}...</td>
                                        <td style={{ padding: '0.8rem 1rem', textAlign: 'right' }}>
                                          <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                                            <button
                                              onClick={() => {
                                                // Resolve the parent set from setId and open it in the
                                                // custom-verses editor. Works for both user-owned custom
                                                // sets (in-place edit) and built-in topical sets (saves
                                                // as a fork into customVerseSets, leaving the original
                                                // untouched).
                                                const parentSet = activeVerseSets.find(s => s && s.id === v.setId);
                                                if (!parentSet) return;
                                                setMainTab('custom_verses');
                                                setEditingCustomSet({ ...parentSet, verses: parentSet.verses?.map(parseVerseRef) || [] });
                                              }}
                                              title={t("編輯這個內容集", "Edit this collection")}
                                              style={{ backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '50%', width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                            >
                                              <Edit size={14} />
                                            </button>
                                            <button
                                              onClick={() => {
                                                initAudio();
                                                setCampaignQueue(null);
                                                setCampaignResults([]);
                                                setActiveVerse(v);
                                                setTimeout(() => startGame(false, v), 50);
                                              }}
                                              title={t("遊玩這篇內容", "Play this paragraph")}
                                              style={{ backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                            >
                                              <Play size={16} fill="white" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ));
                                  })()}
                                </tbody>
                              </table>
                            </div>

                            {/* Search Verses Pagination */}
                            {Math.ceil(matchingVerses.length / 10) > 1 && (
                              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
                                {Array.from({ length: Math.ceil(matchingVerses.length / 10) }).map((_, idx) => (
                                  <button
                                    key={idx}
                                    onClick={() => setSearchVersesPage(idx + 1)}
                                    style={{
                                      padding: '0.5rem 1rem',
                                      borderRadius: '8px',
                                      border: searchVersesPage === idx + 1 ? 'none' : '1px solid #cbd5e1',
                                      background: searchVersesPage === idx + 1 ? '#8b5cf6' : '#ffffff',
                                      color: searchVersesPage === idx + 1 ? '#ffffff' : '#475569',
                                      fontWeight: 'bold',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s',
                                      minWidth: '40px'
                                    }}
                                  >
                                    {idx + 1}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {matchingSets.length === 0 && matchingVerses.length === 0 && (
                          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px', marginTop: '1rem' }}>
                            {t("很抱歉，沒有找到符合條件的內容或群組。", "Sorry, no matching paragraphs or sets found.")}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {mainTab === 'map' && (() => {
                // Lazy-load Leaflet only when map tab is opened
                return (
                  <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                    <div style={{ padding: '1.5rem 2rem 1rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Map size={24} />
                      <div>
                        <h2 style={{ margin: 0, color: '#1e293b', fontSize: '1.2rem' }}>{t('誰在玩：全球玩家地圖', "Who's Playing: Global Player Map")}</h2>
                        <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '0.85rem' }}>{t('點擊標記查看玩家成績，雙擊遊戲房間加入戰局！', 'Click a marker to see scores, double click a room to join!')}</p>
                      </div>
                    </div>
                    <React.Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>{t('地圖載入中…', 'Loading map…')}</div>}>
                    <WorldMap t={t} playerName={playerName} userEmail={userEmail}
                      currentMode={mapView}
                      focusLocation={mapFocus}
                      onToggleMode={(coord) => {
                        setMapView(v => (v === '2d' ? '3d' : '2d'));
                        if (coord && typeof coord.lat === 'number') setMapFocus(coord);
                      }}
                      playTone={playPulseTone}
                      playWelcome={playWelcomeFanfare}
                      onEnableAudio={initAudio}
                      onViewGarden={(name) => {
                      handleViewPlayerGarden(name);
                    }} onJoinRoom={(roomId) => {
                      setMainTab('multiplayer');
                      setJoinRoomError(null);
                      isGuestJoinRef.current = true;
                      setMultiplayerRoomMode(null);
                      setMultiplayerRoomRole('player');
                      setMultiplayerRoomId(roomId);
                      if (joinRoomTimeoutRef.current) clearTimeout(joinRoomTimeoutRef.current);
                      joinRoomTimeoutRef.current = setTimeout(() => {
                        if (isGuestJoinRef.current) {
                          setJoinRoomError(roomId);
                          setMultiplayerRoomMode(null);
                          setMultiplayerRoomRole('player');
                          setMultiplayerRoomId(null);
                          isGuestJoinRef.current = false;
                        }
                      }, 5000);
                    }} />
                    </React.Suspense>
                  </div>
                );
              })()}

              {mainTab === 'manual' && (
                <div className="ls-manual" style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', color: '#334155', lineHeight: 1.7 }}>
                  <h1 style={{ marginTop: 0, color: '#1e293b', fontSize: '1.6rem' }}>{t('聽&說 操作手冊', 'Listen&Speak Guide')}</h1>
                  <p><span dangerouslySetInnerHTML={{ __html: t('歡迎使用 <strong>聽&說 Listen&Speak</strong>！這是一個把「聽、跟著說、背起來」放在一起的雙語學習平台。<br />內建《唐詩三百首》，也可以放進任何你喜歡的好文：中英對照、一段一段，還能用自己的聲音錄下來分享。', 'Welcome to <strong>Listen&Speak</strong> — a bilingual platform for listening, repeating, and memorising.<br />It ships with the 300 Tang Poems, and you can add any text you love: Chinese and English side by side, paragraph by paragraph, in your own voice.') }} /></p>

                  <h2 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginTop: '2rem' }}>{t('一、五種語言', '1. Five languages')}</h2>
                  <p>{t('左上角的「版本」可以選：繁體中文、簡體中文、繁體與注音符號、簡體與羅馬拼音、English。', 'The "Version" picker at the top left offers Traditional Chinese, Simplified Chinese, Traditional with Bopomofo, Simplified with Pinyin, and English.')}</p>
                  <ul>
                    <li><span dangerouslySetInnerHTML={{ __html: t('<strong>注音／拼音是語言的一種：</strong>選「繁體與注音符號」，每個字右邊會直排注音（像課本）；選「簡體與羅馬拼音」，拼音會標在字的上方。適合小朋友認字。', '<strong>Bopomofo and Pinyin are languages here:</strong> pick "Traditional with Bopomofo" and every character gets vertical Bopomofo on its right (like a schoolbook); pick "Simplified with Pinyin" and pinyin sits above each character. Great for young readers.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('<strong>第二語言：</strong>聆聽畫面下方可以選第二語言，例如主語言「繁體與注音」、第二語言「English」，每一段下面就會顯示對照的英文。', '<strong>Second language:</strong> at the bottom of the listening screen pick a second language — e.g. main "Traditional with Bopomofo", second "English" — and the matching English shows under each paragraph.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('<strong>簡體是自動轉的：</strong>作者只要輸入繁體與英文，簡體版會自動產生。', '<strong>Simplified is generated:</strong> authors type Traditional Chinese and English; the Simplified version is produced automatically.') }} /></li>
                  </ul>

                  <h2 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginTop: '2rem' }}>{t('二、聽一聽', '2. Listen')}</h2>
                  <ul>
                    <li><span dangerouslySetInnerHTML={{ __html: t('大廳的 <strong>「好文欣賞」</strong>：每日一首，或挑一個主題集連續聆聽。', 'The <strong>Good Reads</strong> card on the home screen: a poem a day, or pick a collection and listen continuously.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('大廳的 <strong>「聽與說」</strong>：所有公開的內容集。點進一個內容集，按「播放」就能一段一段聽；「播放方式」可以設定播放時間、字體大小與聲音來源。', 'The <strong>Listen &amp; Speak</strong> card: every public collection. Open one and press Play to hear it paragraph by paragraph; "Playback mode" sets duration, font size, and the voice.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('「朗讀第二語言」會暫時把主／次語言對調，用第二語言落字並朗讀，適合練外語。', '"Read the second language" temporarily swaps the two languages — the text falls and is read in the second language. Handy for practising a foreign language.') }} /></li>
                  </ul>

                  <h2 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginTop: '2rem' }}>{t('三、說一說：用自己的聲音', '3. Speak: in your own voice')}</h2>
                  <ul>
                    <li><span dangerouslySetInnerHTML={{ __html: t('聆聽時按 🎙️ 麥克風，照著唸一遍並儲存，下次再聽這一段就是你的聲音。', 'While listening, tap the 🎙️ microphone, read the paragraph aloud and save — next time you hear this paragraph, it is your voice.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('任何登入的人都可以錄；「聲音」選單能切換作者、其他朋友或電腦語音。「自動」會優先播真人的聲音。', 'Anyone signed in can record; the voice menu switches between the author, other friends, or the computer voice. "Auto" prefers a real voice.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('喜歡誰的朗讀，按 <strong>「鼓勵」</strong> 留一句話或一段語音給他。', 'Like someone\'s reading? Tap <strong>Encourage</strong> to leave them a note or a voice message.') }} /></li>
                  </ul>

                  <h2 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginTop: '2rem' }}>{t('四、背起來：挑戰', '4. Memorise: challenges')}</h2>
                  <ul>
                    <li><span dangerouslySetInnerHTML={{ __html: t('每一段旁邊的 <strong>⚡ 挑戰</strong>：選九宮格、落字雨或語音模式，把打散的詞依序點回來，或直接開口背。', 'The <strong>⚡ Challenge</strong> next to each paragraph: choose Grid, Falling Words, or Voice mode — tap the scrambled words back into order, or simply recite.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('每挑戰一段，「我的園子」就長出一棵樹；通關變大樹，創新高結果子。', 'Every challenge plants a tree in <strong>My Garden</strong>; clearing it grows the tree, and new high scores bear fruit.') }} /></li>
                  </ul>

                  <h2 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginTop: '2rem' }}>{t('五、建立自己的內容集', '5. Create your own collection')}</h2>
                  <ol>
                    <li><span dangerouslySetInnerHTML={{ __html: t('登入後從「聽與說」進入 <strong>「我的內容集」</strong>，按「建立新內容集」。', 'Sign in, open <strong>My Collections</strong> from Listen &amp; Speak, and tap "Create new collection".') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('填標題與簡介，選「原文語言」（中文或英文）。', 'Enter a title and description and choose the original language (Chinese or English).') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('每一段有 <strong>標籤、中文、English</strong> 三個欄位：中文和英文對照著輸入，翻譯由作者自己寫，不用機器翻譯。標籤留空會自動變成「第 1 段」。', 'Each paragraph has <strong>label, Chinese, English</strong>: type the two languages side by side — translations are your own, no machine translation. Leave the label blank and it becomes "Part 1".') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('文章很長？用 <strong>「貼上全文對照匯入」</strong>：左邊貼中文全文、右邊貼英文全文，空行分段，第 1 段配第 1 段。', 'Long text? Use <strong>Paste full text</strong>: Chinese on the left, English on the right, blank lines between paragraphs — paragraph 1 pairs with paragraph 1.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('每一段都可以先在編輯器裡 🎙️ 錄音。勾選「公開」再儲存，大家就能聽、挑戰與分享。', 'You can 🎙️ record each paragraph right in the editor. Tick "Public" and save so everyone can listen, challenge, and share.') }} /></li>
                  </ol>

                  <h2 style={{ borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginTop: '2rem' }}>{t('六、多人遊戲與誰在玩', '6. Multiplayer and Who\'s Playing')}</h2>
                  <ul>
                    <li><span dangerouslySetInnerHTML={{ __html: t('<strong>多人遊戲</strong>：開一個房間邀請家人或同學，每個人用自己的語言（含注音／拼音）看同一段，一起比賽。', '<strong>Multiplayer</strong>: open a room for family or classmates; everyone sees the same paragraph in their own language (Bopomofo and Pinyin included) and competes together.') }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t('<strong>誰在玩</strong>：看看世界各地正在練習的人；點標記看成績，雙擊進行中的房間可直接加入。', '<strong>Who\'s Playing</strong>: see who is practising around the world; click a marker for scores, double-click an open room to join.') }} /></li>
                  </ul>
                </div>
              )}

              {mainTab === 'about' && (
                <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', color: '#334155', lineHeight: '1.6' }}>
                  <h2 style={{ marginTop: 0, marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', fontFamily: 'var(--app-font-family)', color: '#3b82f6' }}>
                    {t('Verse Rain 讓背記內容變得生動有趣！', 'ParagraphRain makes text memorization fun!')}
                  </h2>

                  <p style={{ marginBottom: '1rem' }}>
                    {t('一間華人教會使用 VerseRain 應用程式為會眾舉辦了「聖經背誦比賽」。家庭和小組中的所有年齡層都能參與。他們架設了四台投影機，讓四個隊伍能同時在相同的內容集上進行挑戰模式的比賽。', 'A Chinese church used the VerseRain app to host a "Bible Memorization Contest" for its congregation. All ages in families and small groups participated. They set up four projectors, allowing four teams to compete simultaneously in Challenge Mode using the same verse sets.')}
                  </p>
                  <iframe width="560" height="315" src="//www.youtube.com/embed/2tFxeesKISk" frameBorder="0" allowFullScreen=""></iframe>

                  <p style={{ marginBottom: '1.5rem', marginTop: '1.5rem' }}>
                    {t('一位四歲的男孩和三歲的妹妹急切地想展示他們能用中文背誦「主禱文」來遊玩 VerseRain。他們都是在美國出生的，卻能夠用中文閱讀並遊玩這款遊戲。', 'A four-year-old boy and his three-year-old sister eagerly showed off how they could recite the "Lord\'s Prayer" in Chinese by playing VerseRain. Born in the US, they are able to read Chinese and play this game.')}
                  </p>
                  <iframe width="560" height="315" src="//www.youtube.com/embed/Tty82Gn1gvQ" frameBorder="0" allowFullScreen=""></iframe>

                  <p style={{ marginBottom: '1.5rem', marginTop: '1.5rem' }}>
                    {t('聖經內容的單字會從天而降，玩家只要按照正確的順序點擊內容就能獲得分數。內容被點擊時，會用語音朗讀出來，從視覺和語音的聽覺兩方面來加強您的記憶。', 'Words of bible paragraphs fall from the sky, and you score points by clicking the paragraph in the correct order. The paragraph is spoken out loud when clicked to reinforce your memory audibly and spelling visually.')}
                  </p>

                  <ul style={{ paddingLeft: '1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <li>{t('學習多種語言的聖經內容！', 'Learn bible paragraphs in multiple languages!')}</li>
                    <li>{t('點擊單字時會有文字轉語音的朗讀功能，來加深您對內容背誦的印象。', 'Text to Speech verbal reading as you click the words to impress your memory on paragraph recitation.')}</li>
                    <li>{t('透過 verserain，能支援近乎無限多的內容、內容集以及多種聖經譯本可以使用。', 'Through paragraphrain, it supports virtually unlimited number of paragraphs, collections, and multiple bible versions.')}</li>
                    <li>{t('提供多種挑戰難度，無論是小孩還是成人都非常適合來挑戰自己的極限。', 'Multiple difficulty levels offered to be played by kids to adults.')}</li>
                    <li>{t('挑戰模式有助於加強記憶同一個內容集中的多段相關內容。', 'Challenge mode helps to strengthen the memory of multiple related paragraphs in the same collection.')}</li>
                    <li>{t('線上排行榜能激勵會眾、青年團契和小組成員一起參與遊玩、共同精進！', 'Online Leaderboard to motivate congregation, youth fellowships and small group members to participate and improve together!')}</li>
                    <li><span dangerouslySetInnerHTML={{ __html: t("<strong>全新語音模式：</strong> 結合最先進的拼音模糊辨識技術，您可以直接開口背誦！即使發音不夠標準也能智慧通關，用語音大聲宣告神的話語，還能獲得額外的 50% 分數加成。", "<strong>New Voice Mode:</strong> Combining state-of-the-art fuzzy pinyin recognition, you can recite directly with your voice! Even with non-standard pronunciation, you can intelligently pass the level. Proclaim God's word loudly and gain an extra 50% score bonus.") }} /></li>
                    <li><span dangerouslySetInnerHTML={{ __html: t("<strong>多人即時連線對戰：</strong> 支援創建專屬房間，讓全家大小或小組成員在各自的手機上，同步挑戰同一組內容，享受刺激的即時競技樂趣！", "<strong>Multiplayer Real-time Battle:</strong> Support creating private rooms, allowing family or group members to simultaneously challenge the same paragraphs on their phones, enjoying the thrill of real-time competition!") }} /></li>
                  </ul>

                </div>
              )}

            </div>
          </div>
        )}

        {gameState === 'playing' && !isAutoPlay && (isBlindMode || playMode?.startsWith('voice')) && (
          <React.Suspense fallback={<div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#94a3b8' }}>{t('載入中…', 'Loading…')}</div>}>
          <BlindModeGame
            key={activeVerse?.reference}
            activeVerse={activeVerse}
            activePhrases={activePhrases}
            currentSeqIndex={currentSeqIndex}
            onWordMatch={(block) => {
              setScore(s => s + 100 + (combo * 50));
              setCombo(c => c + 1);
              setCurrentSeqIndex(prev => {
                const nextSeq = prev + 1;
                currentSeqRef.current = nextSeq;
                return nextSeq;
              });
            }}
            onWordMiss={() => {
              setCombo(0);
              setHealth(h => {
                const newHealth = Math.max(0, h - 1);
                healthRef.current = newHealth;
                return newHealth;
              });
              setCurrentSeqIndex(prev => {
                const nextSeq = prev + 1;
                currentSeqRef.current = nextSeq;
                return nextSeq;
              });
            }}
            onFail={() => {
              setGameState('menu');
            }}
            health={health}
            timeLeft={timeLeft}
            score={score}
            combo={combo}
            speakText={speakText}
            formatVerseReferenceForSpeech={formatVerseReferenceForSpeech}
            formatVerseReferenceForDisplay={formatVerseReferenceForDisplay}
            onResumeTimer={() => { isGameTimerPausedRef.current = false; }}
            isDebugMode={isDebugMode}
            skipReadback={skipReadback}
            playMode={playMode}
            playDing={() => {
              if (!window.__sharedDingCtx) {
                window.__sharedDingCtx = new (window.AudioContext || window.webkitAudioContext)();
              }
              const actx = window.__sharedDingCtx;
              if (actx.state === 'suspended') actx.resume();
              const osc = actx.createOscillator();
              const gn = actx.createGain();
              osc.type = 'sine';
              osc.frequency.setValueAtTime(1000, actx.currentTime);
              gn.gain.setValueAtTime(0, actx.currentTime);
              gn.gain.linearRampToValueAtTime(0.25, actx.currentTime + 0.02);
              gn.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 1.0);
              osc.connect(gn); gn.connect(actx.destination);
              osc.start(); osc.stop(actx.currentTime + 1.0);
            }}
            version={version}
            t={t}
          />
          </React.Suspense>
        )}

        {gameState === 'playing' && (isAutoPlay || (!isBlindMode && !playMode?.startsWith('voice'))) && (
          <div
            key={`${playMode}-${activeVerse.reference}-${distractionLevel}`}
            onClick={handleGlobalClick}
            style={{ position: 'absolute', width: '100vw', height: '100dvh', top: 0, left: 0, overflow: 'hidden' }}
          >
            <div className="game-hud" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '0.5rem 1rem', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: '0.75rem', alignItems: 'start', zIndex: 10, pointerEvents: 'none' }}>
              <div className="game-hud-row game-hud-left" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', pointerEvents: 'auto', minWidth: 0 }}>
                <button
                  className="hud-glass game-hud-chip game-exit-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (timerRef.current) clearInterval(timerRef.current);
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                    setGameState('menu');
                  }}
                  style={{ padding: '0.75rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}
                >
                  <XCircle size={22} />
                </button>
                {!isAutoPlay && !multiplayerRoomId && (
                  <button
                    className="hud-glass game-hud-chip game-demo-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Stop the countdown timer
                      if (timerRef.current) clearInterval(timerRef.current);
                      // Cancel any ongoing speech
                      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                      // Reset score for this round
                      setScore(0);
                      setCombo(0);
                      // Activate autoplay from current position
                      setIsAutoPlay(true);
                      isAutoPlayRef.current = true;
                    }}
                    title={t('電腦自動完成（分數歸零）', 'Auto-complete (score resets to 0)')}
                    style={{ padding: '0.5rem 0.8rem', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', color: '#4ade80', fontWeight: 'bold', fontSize: '0.85rem' }}
                  >
                    <Play size={16} fill="#4ade80" />
                    <span style={{ fontSize: '0.8rem' }}>{t('示範', 'Play')}</span>
                  </button>
                )}

                {!isAutoPlay && !multiplayerRoomId && (
                  <div className="hud-glass game-hud-chip game-status-chip" style={{ padding: '0.3rem 0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center', height: '100%', minHeight: '36px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: '#f87171' }}>
                      {[...Array(3)].map((_, i) => (
                        <Heart key={i} size={16} fill={i < health ? '#f87171' : 'transparent'} strokeWidth={i < health ? 0 : 2} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '1rem', fontWeight: 'bold', color: '#fbbf24' }}>
                      <Zap size={16} fill="#fbbf24" strokeWidth={0} /> {combo}x
                    </div>
                  </div>
                )}

                {!isAutoPlay && !multiplayerRoomId && (
                  <div className="hud-glass game-hud-chip game-score-chip" style={{ padding: '0.3rem 0.8rem', display: 'flex', alignItems: 'center', gap: '1rem', minHeight: '36px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <div style={{ color: '#fbbf24', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '-2px' }}>
                        <Crown size={10} /> {bestScore}
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#fff', fontFamily: 'monospace' }}>
                        {String(score).padStart(6, '0')}
                      </div>
                    </div>
                  </div>
                )}

                {/* Multiplayer HUD */}
                {!isAutoPlay && multiplayerRoomId && multiplayerState && multiplayerState.players && (
                  <div className="hud-glass game-hud-chip game-multiplayer-chip" style={{ padding: '0.3rem 0.8rem', display: 'flex', alignItems: 'center', gap: '1rem', minHeight: '36px', border: '1px solid rgba(59, 130, 246, 0.5)' }}>
                    <div style={{ color: '#93c5fd', fontSize: '0.8rem', fontWeight: 'bold', marginRight: '-0.3rem' }}>{t("我", "Me")}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem', color: '#f87171' }}>
                      {[...Array(3)].map((_, i) => (
                        <Heart key={i} size={14} fill={i < health ? '#f87171' : 'transparent'} strokeWidth={i < health ? 0 : 2} />
                      ))}
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#fff', fontFamily: 'monospace' }}>
                      {String(score).padStart(6, '0')}
                    </div>
                  </div>
                )}
              </div>

              {!isAutoPlay && (
                <div className="hud-glass game-hud-reference" style={{ justifySelf: 'center', padding: '0.35rem 1rem', display: 'flex', alignItems: 'center', minHeight: '40px', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 'clamp(1.35rem, 3vw, 2.1rem)', lineHeight: 1, fontWeight: 900, color: '#bfdbfe', textShadow: '0 3px 16px rgba(147, 197, 253, 0.45)', whiteSpace: 'nowrap' }}>{formatVerseReferenceForDisplay(activeVerse.reference, version)}</span>
                </div>
              )}

              <div className="game-hud-row game-hud-right" style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: '0.75rem', pointerEvents: 'auto' }}>
                {!isAutoPlay && (
                  <div className="hud-glass game-hud-chip game-timer-chip" style={{ padding: '0.45rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.55rem', minHeight: '42px' }}>
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 'bold' }}>T</div>
                    <div style={{ fontSize: 'clamp(1.25rem, 2vw, 1.7rem)', color: timeLeft <= 1000 ? '#f87171' : '#cbd5e1', fontFamily: 'monospace', fontWeight: 'bold', lineHeight: 1 }}>
                      {String(Math.floor(timeLeft / 100)).padStart(2, '0')}.{String(timeLeft % 100).padStart(2, '0')}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!isAutoPlay && (() => {
              const HUD_PAGE_SIZE = 6;
              const startIdx = Math.floor(currentSeqIndex / HUD_PAGE_SIZE) * HUD_PAGE_SIZE;
              const currentPhrasesWindow = activePhrases.slice(startIdx, currentSeqIndex);

              return (
                <div className="game-next-bar" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'auto', display: 'flex', flexDirection: 'column' }}>
                  <div className="hud-glass game-next-panel" style={{ padding: '0.5rem 5vw', background: 'rgba(15, 23, 42, 0.85)', borderRadius: '16px 16px 0 0', borderTop: '1px solid rgba(255,255,255,0.1)', borderLeft: '1px solid rgba(255,255,255,0.1)', borderRight: '1px solid rgba(255,255,255,0.1)', borderBottom: 'none' }}>
                    <div className="game-next-text" style={{ fontSize: 'clamp(1rem, 4vw, 1.4rem)', lineHeight: '1.8', color: '#cbd5e1', wordBreak: 'break-word', alignContent: 'flex-start' }}>
                      {currentPhrasesWindow.map((phrase, localIdx) => (
                        <span key={startIdx + localIdx} style={{ color: '#fbbf24', fontWeight: 'bold' }}>{phrase} </span>
                      ))}
                      {currentSeqIndex < activePhrases.length && (
                        <span id="stack-cursor" style={{ display: 'inline-block', color: '#94a3b8', fontWeight: 'bold', padding: '0 0.4rem', border: '2px dashed rgba(251, 191, 36, 0.4)', borderRadius: '6px', margin: '0 0.2rem', background: 'rgba(251, 191, 36, 0.05)', transition: 'all 0.3s' }}>
                          Next: {maskPhraseForPreview(activePhrases[currentSeqIndex])}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {isAutoPlay ? (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6rem 5vw 2rem' }}>
                <div className="hud-glass" style={{ padding: 'clamp(1.5rem, 4vw, 3rem)', textAlign: 'center', maxWidth: '1000px', width: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
                  <h2 style={{ fontSize: 'clamp(1.2rem, 3vh, 2rem)', color: speakingTitle ? '#fbbf24' : '#93c5fd', transition: 'color 0.3s', marginBottom: '1rem', fontWeight: 'bold' }}>{formatVerseReferenceForDisplay(activeVerse.reference, version)}</h2>
                  <div style={{
                    fontSize: (() => {
                      const lengthWeight = isEnglishBibleVersion(version) ? activeVerse.text.length / 2.5 : activeVerse.text.length;
                      if (lengthWeight > 120) return 'clamp(1rem, min(4.5vw, 3vh), 1.5rem)';
                      if (lengthWeight > 70) return 'clamp(1.2rem, min(5vw, 3.5vh), 2rem)';
                      return 'clamp(1.5rem, min(6vw, 4vh), 3rem)';
                    })(),
                    color: '#fff', lineHeight: '1.6', fontWeight: 'bold'
                  }}>
                    {activePhrases.map((phrase, idx) => {
                      let color = '#cbd5e1';
                      if (idx < currentSeqIndex) color = '#93c5fd';
                      if (idx === currentSeqIndex && !speakingTitle) color = '#fbbf24';
                      return <span key={idx} style={{ color, transition: 'color 0.3s' }}>{phrase}{" "}</span>;
                    })}
                  </div>
                </div>
              </div>
            ) : playMode.startsWith('square') ? (
              <div className="square-grid-container">
                <div className="square-grid-inner" style={{ display: 'grid', gridTemplateColumns: `repeat(${squareGridSize}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${squareGridSize}, minmax(0, 1fr))`, gap: 'clamp(0.5rem, 1.6vmin, 1.25rem)', width: 'min(98vw, 1600px)', height: '100%', pointerEvents: 'auto' }}>
                  {blocks.map(block => {
                    let appliedClasses = 'falling-block-inner square-block-tile';
                    if (block.error) appliedClasses += ' error-shake';
                    if (block.correct && (!block.claimedBy || block.claimedBy === myClientId)) appliedClasses += ' success-flash';

                    let blockStyle = { cursor: 'pointer', padding: 'clamp(0.6rem, 2.2vmin, 2rem)', fontSize: squareBlockFontSize, display: 'flex', alignItems: 'center', justifyContent: 'center', wordBreak: 'break-word', overflowWrap: 'anywhere', hyphens: 'auto', textAlign: 'center', visibility: block.hidden ? 'hidden' : 'visible', borderRadius: 'clamp(16px, 2.2vmin, 30px)' };

                    if (block.claimedBy) {
                      // Block instantly disappears physically so the flying clone can animate
                      blockStyle.visibility = 'hidden';
                    }

                    return (
                      <div key={block.id} data-id={block.id} className={appliedClasses} onClick={(e) => { e.stopPropagation(); handleBlockClick(block); }} style={blockStyle}>
                        {!block.hidden && block.text}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div style={{ position: 'absolute', width: '100vw', height: '100dvh', top: 0, left: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                {blocks.map((block) => {
                  let appliedClasses = 'falling-block-inner';
                  if (block.error) appliedClasses += ' error-shake';
                  if (block.correct) appliedClasses += ' success-flash';

                  return (
                    <div
                      key={block.id}
                      className="falling-wrapper"
                      data-id={block.id}
                      style={{
                        position: 'absolute',
                        top: '-30px',
                        left: `${Math.min(block.xPos, 68)}%`,
                        animation: `fall ${block.duration}s linear forwards`,
                        animationPlayState: 'running',
                        zIndex: block.seqIndex === currentSeqIndex ? 50 : 10
                      }}
                      onAnimationEnd={(e) => handleAnimationEnd(e, block.id)}
                    >
                      <div
                        className={appliedClasses}
                        onClick={(e) => { e.stopPropagation(); handleBlockClick(block); }}
                        style={{
                          pointerEvents: 'auto',
                          cursor: 'pointer',
                          minWidth: 'clamp(140px, 27vw, 330px)',
                          maxWidth: 'min(78vw, 520px)',
                          minHeight: 'clamp(3.3rem, 15vh, 140px)',
                          fontSize: getRainBlockFontSize(block.text),
                          padding: 'clamp(0.6rem, 2.6vh, 2rem) clamp(0.9rem, 3.2vw, 2rem)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          wordBreak: 'break-word',
                          hyphens: 'auto',
                          textAlign: 'center',
                        }}
                      >
                        {block.text}
                      </div>
                    </div>
                  );
                })}
              </div>

            )}

            {/* Flying Blocks Animation Layer */}
            {gameState === 'playing' && multiplayerRoomId && flyingBlocks.map(fb => (
              <div
                key={fb.id}
                className="falling-block-inner flying-block-anim"
                style={{
                  '--startX': fb.startX,
                  '--startY': fb.startY,
                  '--endX': fb.endX,
                  '--endY': fb.endY,
                  width: fb.width,
                  height: fb.height,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'clamp(0.9rem, 2.5vw, 1.5rem)',
                  backgroundColor: fb.color,
                  borderColor: fb.color,
                  boxShadow: `0 0 20px ${fb.color}`,
                  color: '#fff',
                  wordBreak: 'break-word', hyphens: 'auto', textAlign: 'center'
                }}
              >
                {fb.text}
              </div>
            ))}

            {multiplayerRoomId && health <= 0 && multiplayerState?.playMode !== 'square_solo' && (
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', animation: 'flashSuccess 0.5s ease-out' }}>
                <div style={{ color: '#ef4444', marginBottom: '1rem' }}><XCircle size={64} /></div>
                <h2 style={{ color: '#fca5a5', fontSize: '2.5rem', fontWeight: 'bold', marginBottom: '1rem', textShadow: '0 2px 10px rgba(239,68,68,0.5)' }}>{t("您已出局！", "You're Out!")}</h2>
                <div style={{ fontSize: '1.2rem', color: '#cbd5e1', background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', textAlign: 'center', maxWidth: '80%' }}>
                  {t("防線已經崩潰。請等待隊友完成...", "Defenses breached. Please wait for your teammates...")}
                  {multiplayerState?.campaignQueue && multiplayerState.campaignQueue.length > 1 ? (
                    <div style={{ marginTop: '1rem', color: '#10b981', fontWeight: 'bold' }}>
                      {t("下一局加油，還有", "Cheer up for next round! You have")} {multiplayerState.campaignQueue.length - 1} {t("次的機會", "more rounds.")}
                    </div>
                  ) : multiplayerState?.campaignQueue && multiplayerState.campaignQueue.length === 1 ? (
                    <div style={{ marginTop: '1rem', color: '#fbbf24', fontWeight: 'bold' }}>
                      {t("這是最後一關了！為隊友祈禱吧！", "This is the final round! Pray for your teammates!")}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {gameState === 'waiting_for_others' && multiplayerState && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '1rem', flexDirection: 'column' }}>
            <div className="hud-glass" style={{ background: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', padding: '3rem 2rem', width: '100%', maxWidth: '600px', border: '1px solid rgba(16, 185, 129, 0.4)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', textAlign: 'center' }}>
              <h2 style={{ fontSize: '2rem', color: '#10b981', fontWeight: 'bold', margin: 0 }}>{multiplayerState.matchType === 'team' && multiplayerState.host === myClientId ? t("多人遊戲進行中", "Multiplayer in Progress") : t("你完成了所有內容！", "You finished all paragraphs!")}</h2>
              <p style={{ color: '#94a3b8', fontSize: '1rem', margin: 0, animation: 'bounce 2s infinite' }}>{multiplayerState.matchType === 'team' && multiplayerState.host === myClientId ? t("可隨時結束比賽，結果會用隊伍平均分排名。", "You can end the match anytime. Teams are ranked by average score.") : multiplayerState.matchType === 'team' ? t("等待比賽結束，結果會用隊伍平均分排名。", "Waiting for the match to end. Teams are ranked by average score.") : t("等待其他玩家完成...", "Waiting for others to finish...")}</p>
              <div style={{ display: 'flex', gap: '1rem', width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
                {multiplayerState?.host === myClientId && (
                  <button
                    onClick={() => {
                      if (socketRef.current) socketRef.current.send(JSON.stringify({ type: 'FORCE_END_GAME' }));
                    }}
                    style={{ background: '#ef4444', color: 'white', border: 'none', padding: '0.75rem 2rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.5)' }}
                  >
                    {t("比賽結束", "End Match Now")}
                  </button>
                )}
                {multiplayerState.matchType === 'team' && multiplayerState.host !== myClientId && multiplayerState.status === 'playing' && multiplayerState.playMode?.endsWith('_solo') && (
                  <button
                    onClick={restartTeamSoloRun}
                    style={{ background: '#10b981', color: 'white', border: 'none', padding: '0.75rem 2rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.5)' }}
                  >
                    {t("再挑戰一次", "Play Again")}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (socketRef.current) {
                      socketRef.current.close();
                      socketRef.current = null;
                    }
                    multiplayerSoloActiveRef.current = false;
                    setGameState('menu');
                    setMultiplayerRoomMode(null);
                    setMultiplayerRoomRole('player');
                    setMultiplayerRoomId(null);
                    setMultiplayerState(null);
                  }}
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '0.75rem 2rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', transition: 'all 0.2s' }}
                >
                  {t("離開遊戲", "Leave Game")}
                </button>
              </div>
              {multiplayerState.matchType === 'team' ? (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.5rem' }}>
                  {getTeamResultsFromState(multiplayerState).map((team, idx) => {
                    const totalMembers = team.playerCount || 1;
                    const completedPct = Math.min(100, ((team.completedCount || 0) / totalMembers) * 100);
                    return (
                      <div key={team.id} style={{ background: idx === 0 ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)', border: `1px solid ${idx === 0 ? '#fbbf24' : `${team.color}66`}`, borderRadius: '10px', padding: '0.9rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0 }}>
                            <span style={{ color: idx === 0 ? '#fbbf24' : '#64748b', fontWeight: 'bold', fontSize: '1.1rem' }}>#{idx + 1}</span>
                            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />
                            <strong style={{ color: '#e2e8f0', fontSize: '1.1rem' }}>{t(team.name, team.enName || team.name)}</strong>
                          </span>
                          <span style={{ color: team.color, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{team.averageScore} avg</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.9rem' }}>
                          <span>{team.playerCount} {t("人", "players")}</span>
                          <span>{t("完成", "Done")} {team.completedCount || 0} / {team.playerCount}</span>
                        </div>
                        <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${completedPct}%`, height: '100%', background: team.color, transition: 'width 0.5s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.5rem' }}>
                  {Object.values(multiplayerState.players || {}).filter(p => p.connected).map(p => {
                  const totalVerses = localCampaignListRef.current.length || 1;
                  const versesCompleted = p.isFinished ? totalVerses : (p.versesCompleted || 0);
                  const totalScore = Math.max(multiplayerState.campaignResults?.reduce((acc, round) => acc + Math.max(0, round.scores?.[p.id] || 0), 0) || 0, p.bestScore || 0);
                  const isMe = p.id === myClientId;
                  return (
                    <div key={p.id} style={{ background: isMe ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isMe ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '10px', padding: '0.8rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 'bold', color: isMe ? '#10b981' : '#e2e8f0', fontSize: '1rem' }}>{p.name}{isMe ? ` ${t("(你)", "(You)")}` : ''}</span>
                        <span style={{ color: p.isFinished ? '#10b981' : '#fbbf24', fontWeight: 'bold', fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>{p.isFinished ? <><Trophy size={14} /> {t("完成！", "Done!")}</> : `${versesCompleted} / ${totalVerses}`}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'monospace', color: '#93c5fd', fontSize: '1rem' }}>{totalScore} pts</span>
                        <span style={{ display: 'flex', gap: '2px' }}>
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Heart key={i} size={14} color={i < (p.health || 0) ? '#ef4444' : '#475569'} fill={i < (p.health || 0) ? '#ef4444' : 'none'} />
                          ))}
                        </span>
                      </div>
                      <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${(versesCompleted / totalVerses) * 100}%`, height: '100%', background: p.isFinished ? '#10b981' : '#3b82f6', transition: 'width 0.5s' }} />
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {gameState === 'multiplayer_results' && multiplayerState && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '1rem', flexDirection: 'column' }}>
            <div className="hud-glass" style={{ background: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', padding: '3rem 2rem', width: '100%', maxWidth: '800px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', textAlign: 'center', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <h2 style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: 0, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '12px' }}><Trophy size={40} color="#fbbf24" fill="#fbbf24" /> {multiplayerState.matchType === 'team' ? t("多人遊戲結束！", "Multiplayer Complete!") : multiplayerState.campaignResults?.length > 1 ? t("連戰結束！", "Marathon Completed!") : t("對局結束！", "Game Over!")}</h2>
              <div style={{ display: 'flex', gap: '1rem', width: '100%', flexWrap: 'wrap' }}>
                <button
                  onClick={() => {
                    multiplayerSoloActiveRef.current = false;
                    setGameState('menu');
                    setMultiplayerRoomMode(null);
                    setMultiplayerRoomRole('player');
                    setMultiplayerRoomId(null);
                    if (socketRef.current) socketRef.current.close();
                  }}
                  style={{ flex: '1 1 180px', padding: '1rem', background: 'rgba(255,255,255,0.1)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  {t("離開對戰", "Leave Match")}
                </button>

                {multiplayerState?.host === myClientId && (
                  <button
                    onClick={() => {
                      multiplayerSoloActiveRef.current = false;
                      socketRef.current.send(JSON.stringify({ type: 'RESTART_GAME' }));
                      setGameState('menu');
                    }}
                    style={{ flex: '1 1 180px', padding: '1rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    {t("回到大廳", "Return to Lobby")}
                  </button>
                )}
              </div>

              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1.5rem', margin: '1.5rem 0', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>

                <h3 style={{ margin: 0, textAlign: 'left', color: '#94a3b8', borderBottom: '2px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>{multiplayerState.matchType === 'team' ? t("隊伍排名", "Team Standings") : t("總排名", "Final Standings")}</h3>
                {multiplayerState.matchType === 'team' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {getTeamResultsFromState(multiplayerState).map((team, idx) => (
                      <div key={team.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: '1rem', padding: '1.2rem', backgroundColor: idx === 0 ? 'rgba(251, 191, 36, 0.12)' : 'rgba(255,255,255,0.03)', border: `1px solid ${idx === 0 ? '#fbbf24' : `${team.color}66`}`, borderRadius: '10px' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? '#fbbf24' : '#64748b' }}>#{idx + 1}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', minWidth: 0 }}>
                          <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: team.color, flex: '0 0 auto' }} />
                          <div style={{ textAlign: 'left', minWidth: 0 }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#e2e8f0' }}>{t(team.name, team.enName || team.name)}</div>
                            <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.2rem' }}>{team.playerCount} {t("人", "players")} · {t("計分", "Scoring")} {team.scoringCount || 0} · {t("總分", "Total")} {team.totalScore}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: team.color, fontFamily: 'monospace' }}>{team.averageScore}</div>
                          <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 'bold' }}>{t("平均分", "AVG")}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {Object.values(multiplayerState.players)
                      .map(p => {
                        const totalScore = multiplayerState.campaignResults?.reduce((acc, round) => acc + Math.max(0, round.scores[p.id] || 0), 0) || p.score;
                        return { ...p, totalScore };
                      })
                      .sort((a, b) => b.totalScore - a.totalScore)
                      .map((p, idx) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem', backgroundColor: idx === 0 ? 'rgba(251, 191, 36, 0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${idx === 0 ? '#fbbf24' : 'rgba(255,255,255,0.1)'}`, borderRadius: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: idx === 0 ? '#fbbf24' : '#64748b' }}>#{idx + 1}</div>
                            <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: p.color, boxShadow: '0 0 0 2px rgba(255,255,255,0.2)' }}></div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#e2e8f0' }}>{p.name} {p.id === myClientId ? '(You)' : ''}</div>
                          </div>
                          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#3b82f6', fontFamily: 'monospace' }}>{p.totalScore}</div>
                        </div>
                      ))}
                  </div>
                )}

                {multiplayerState.matchType !== 'team' && multiplayerState.campaignResults?.length > 1 && (
                  <>
                    <h3 style={{ margin: '1rem 0 0 0', textAlign: 'left', color: '#94a3b8', borderBottom: '2px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>{t("回合紀錄", "Round History")}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                      {multiplayerState.campaignResults.map((round, rIdx) => (
                        <div key={rIdx} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', padding: '1rem' }}>
                          <div style={{ color: '#93c5fd', fontWeight: 'bold', textAlign: 'left', marginBottom: '0.5rem' }}>{t("回合", "Round")} {rIdx + 1}: {round.verseRef}</div>
                          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {Object.keys(round.scores)
                              .sort((a, b) => round.scores[b] - round.scores[a])
                              .map((pid, rank) => {
                                const player = multiplayerState.players[pid];
                                if (!player) return null;
                                return (
                                  <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#cbd5e1', background: rank === 0 ? 'rgba(16, 185, 129, 0.2)' : 'transparent', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                                    {rank === 0 && <span style={{ color: '#10b981' }}>★</span>}
                                    {player.name}: <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{Math.max(0, round.scores[pid])}</span>
                                  </div>
                                )
                              })
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

            </div>
          </div>
        )}

        {gameState === 'intermission' && multiplayerState && (() => {
          const isSoloMP = multiplayerRoomId && multiplayerState.playMode?.endsWith('_solo');
          const nextVerseData = isSoloMP ? localNextVerse : multiplayerState.campaignQueue?.[0];
          // In *_solo, preview the next verse in the player's own language.
          const nextVerseText = (isSoloMP && nextVerseData) ? mpLocalTextFor(nextVerseData.reference, nextVerseData.text) : nextVerseData?.text;
          const nextVerseRef = (isSoloMP && nextVerseData) ? mpLocalRefFor(nextVerseData.reference) : nextVerseData?.reference;
          const remaining = isSoloMP
            ? localCampaignListRef.current.length - localVerseIndexRef.current
            : multiplayerState.campaignQueue?.length;
          return (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '1rem', flexDirection: 'column' }}>
              <div className="hud-glass" style={{ background: 'rgba(15, 23, 42, 0.95)', borderRadius: '12px', padding: '4rem 2rem', width: '100%', maxWidth: '600px', boxShadow: '0 25px 50px -12px rgba(16, 185, 129, 0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', border: '1px solid rgba(16, 185, 129, 0.5)' }}>
                <h2 style={{ fontSize: '2.5rem', color: '#10b981', marginBottom: '1.5rem', fontWeight: 'bold' }}>{t("太棒了！準備下一回合", "Great job! Get ready...")}</h2>
                <p style={{ color: '#cbd5e1', fontSize: '1.5rem', marginBottom: '2.5rem' }}>
                  {t("還剩", "Remaining:")} <strong style={{ color: '#fff' }}>{remaining}</strong> {t("段", "paragraphs")}
                </p>
                <p style={{ color: '#93c5fd', fontSize: '1.8rem', fontWeight: 'bold', marginBottom: '1rem' }}>
                  {t("接下來：", "Next Up:")} {nextVerseRef}
                </p>
                {nextVerseText && (
                  <div style={{ color: '#e2e8f0', fontSize: '1.1rem', marginBottom: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', maxHeight: '150px', overflowY: 'auto' }}>
                    {nextVerseText}
                  </div>
                )}
                <div style={{ fontSize: '6rem', fontWeight: 'bold', color: '#fbbf24', animation: 'bounce 1s infinite' }}>
                  {intermissionCountdown}
                </div>
              </div>
            </div>
          );
        })()}

        {gameState === 'gameover' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', zIndex: 20, position: 'relative' }}>
            {isFailed ? (
              <div className="hud-glass" style={{ padding: 'clamp(1.5rem, 4vw, 3rem)', textAlign: 'center', width: '90%', maxWidth: '900px', border: '1px solid #f87171', maxHeight: '95dvh', display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: 'clamp(1.2rem, 3vh, 1.8rem)', color: '#f87171', marginBottom: 'clamp(0.5rem, 2vh, 1rem)' }}>{t("再接再厲！", "Try Again!")}</h2>
                <div style={{ background: 'rgba(0,0,0,0.5)', padding: 'clamp(1rem, 3vw, 2.5rem)', borderRadius: '16px', marginBottom: 'clamp(1rem, 3vh, 2.5rem)', overflowY: 'auto', flex: 1 }}>
                  <p style={{ fontSize: 'clamp(1.2rem, 3.5vh, 2.2rem)', color: '#fff', fontWeight: 'bold', marginBottom: 'clamp(0.5rem, 2vh, 1.5rem)', textTransform: 'uppercase', letterSpacing: '2px' }}>{formatVerseReferenceForDisplay(activeVerse.reference, version)}</p>
                  <div style={{ fontSize: 'clamp(1.2rem, 3.5vh, 2.2rem)', color: '#fff', lineHeight: '1.6', fontWeight: 'bold' }}>
                    {activePhrases.map((phrase, idx) => (
                      <span key={idx} style={{ color: idx % 2 === 0 ? '#93c5fd' : '#cbd5e1' }}>{phrase}{" "}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center' }}>
                  <button
                    onClick={() => startGame()}
                    className="play-btn"
                    style={{
                      flex: '1 1 200px', maxWidth: '400px', background: '#3b82f6', color: 'white', border: 'none', padding: 'clamp(0.8rem, 2vh, 1.2rem)',
                      fontSize: 'clamp(1.1rem, 2.5vh, 1.3rem)', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
                      boxShadow: '0 0 15px rgba(59, 130, 246, 0.5)', transition: 'all 0.2s', flexShrink: 0
                    }}
                  >
                    <RotateCcw size={24} /> {t("再玩一次", "Play Again")}
                  </button>
                  {campaignQueue !== null ? (
                    campaignQueue.length > 0 ? (
                      <button
                        onClick={() => {
                          setActiveVerse(campaignQueue[0]);
                          setCampaignQueue(campaignQueue.slice(1));
                          setTimeout(() => startGame(false, campaignQueue[0]), 50);
                        }}
                        className="play-btn"
                        style={{
                          flex: '1 1 200px', maxWidth: '400px', background: '#64748b', color: 'white', border: 'none', padding: 'clamp(0.8rem, 2vh, 1.2rem)',
                          fontSize: 'clamp(1.1rem, 2.5vh, 1.3rem)', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
                        }}
                      >
                        {t("跳過", "Skip")}
                      </button>
                    ) : (
                      <button
                        onClick={() => setGameState('campaign-results')}
                        className="play-btn"
                        style={{
                          flex: '1 1 200px', maxWidth: '400px', background: '#8b5cf6', color: 'white', border: 'none', padding: 'clamp(0.8rem, 2vh, 1.2rem)',
                          fontSize: 'clamp(1.1rem, 2.5vh, 1.3rem)', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s'
                        }}
                      >
                        {t("查看成績", "View Results")}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => setGameState('menu')}
                      className="play-btn"
                      style={{
                        flex: '1 1 200px', maxWidth: '400px', background: '#475569', color: 'white', border: 'none', padding: 'clamp(0.8rem, 2vh, 1.2rem)',
                        fontSize: 'clamp(1.1rem, 2.5vh, 1.3rem)', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', transition: 'all 0.2s'
                      }}
                    >
                      <Home size={20} /> {t("跳過", "Give Up")}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="hud-glass" style={{ padding: 'clamp(1.5rem, 4vw, 3rem)', textAlign: 'center', width: '90%', maxWidth: '800px', maxHeight: '95dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', animation: isNewHighScore || isFlawless ? 'flashSuccess 1s ease-out' : 'none' }}>

                <div style={{ flexShrink: 0 }}>
                  {isNewHighScore ? (
                    <Crown size={48} color="#fbbf24" style={{ margin: '0 auto clamp(0.5rem, 2vh, 1.5rem)', animation: 'bounce 1s infinite' }} />
                  ) : isFlawless ? (
                    <Star size={48} color="#34d399" style={{ margin: '0 auto clamp(0.5rem, 2vh, 1.5rem)' }} />
                  ) : (
                    <Trophy size={48} color="#fbbf24" style={{ margin: '0 auto clamp(0.5rem, 2vh, 1.5rem)' }} />
                  )}

                  <h2 style={{ fontSize: 'clamp(1.8rem, 4vh, 2.5rem)', marginBottom: '0.5rem', color: '#fff' }}>
                    {isNewHighScore ? t("新高分！", "New High Score!") : isFlawless ? t("完美無瑕！", "Flawless!") : ""}
                  </h2>

                  {isFlawless && !isNewHighScore && (
                    <div style={{ color: '#34d399', fontSize: 'clamp(1rem, 2vh, 1.2rem)', marginBottom: 'clamp(0.5rem, 2vh, 1rem)', fontWeight: 'bold' }}>
                      {t("完美的順序！", "Perfect Sequence!")}
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: 'clamp(1rem, 3vw, 2rem)', borderRadius: '16px', margin: 'clamp(0.5rem, 2vh, 2rem) 0', overflowY: 'auto', flex: 1, minHeight: '150px' }}>
                  <p style={{ fontSize: 'clamp(1.3rem, 3.5vh, 2.2rem)', color: '#fff', fontWeight: 'bold', marginBottom: 'clamp(0.5rem, 2vh, 1rem)', textTransform: 'uppercase', letterSpacing: '1px' }}>{formatVerseReferenceForDisplay(activeVerse.reference, version)}</p>
                  <div style={{ fontSize: 'clamp(1.3rem, 3.5vh, 2.2rem)', color: '#fff', lineHeight: '1.5', fontWeight: 'bold' }}>
                    {activePhrases.map((phrase, idx) => (
                      <span key={idx} style={{ color: idx % 2 === 0 ? '#93c5fd' : '#cbd5e1' }}>{phrase}{" "}</span>
                    ))}
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(1rem, 3vw, 2.5rem)', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 'clamp(0.5rem, 2vh, 1rem)', marginTop: '0.5rem' }}>
                    
                    {/* Left: Final Score */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 'clamp(0.9rem, 2vh, 1.1rem)', color: '#cbd5e1' }}>{t("最終得分", "Final Score")}</div>
                      <strong style={{ color: isNewHighScore ? '#fbbf24' : '#fff', fontSize: 'clamp(2.5rem, 6vh, 3.5rem)', display: 'block', marginTop: '0.2rem', lineHeight: '1' }}>{score}</strong>
                    </div>

                    {/* Right: Breakdown */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 'clamp(1rem, 3vw, 2.5rem)' }}>
                      <div style={{ fontSize: 'clamp(0.85rem, 1.8vh, 1rem)', color: '#93c5fd', marginBottom: '0.3rem', fontWeight: 'bold' }}>
                        {t("通關基礎分", "Base Score")}: {pureBaseScore}
                      </div>
                      {timeBonus > 0 && (
                        <div style={{ fontSize: 'clamp(0.85rem, 1.8vh, 1rem)', color: '#34d399', marginBottom: '0.3rem', fontWeight: 'bold' }}>
                          {t("時間加成", "Time Bonus")}: {(timeLeft / 100).toFixed(2)}s × {(playMode === 'blind' || playMode?.startsWith('voice')) ? '75' : '50'} = +{timeBonus}
                          {(playMode === 'blind' || playMode?.startsWith('voice')) && (
                            <div style={{ fontSize: 'clamp(0.7rem, 1.5vh, 0.8rem)', color: '#fbbf24', marginTop: '0.1rem' }}>
                              ({t("語音權重 +50%", "Voice +50%")})
                            </div>
                          )}
                        </div>
                      )}
                      {distractionLevel > 0 && !isFailed && (
                        <div style={{ fontSize: 'clamp(0.85rem, 1.8vh, 1rem)', color: '#f59e0b', fontWeight: 'bold' }}>
                          {t("難度加成", "Difficulty Multiplier")}: × {(1 + distractionLevel * 0.1).toFixed(1)} {t('(難度 {n})', '(Lv {n})').replace('{n}', String(distractionLevel))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Home and Play Again buttons placed HERE — always visible above the leaderboard */}
                  {campaignQueue === null && (
                    <div style={{ display: 'flex', gap: '1rem', width: '100%', maxWidth: '350px', margin: 'clamp(0.6rem, 2vh, 1rem) auto' }}>
                      <button
                        onClick={() => {
                          // If the challenge came from a reading, drop the player
                          // back into it (so they can ‹ › to the next verse and
                          // ⚡ again) instead of the lobby.
                          const back = readerReturnRef.current;
                          readerReturnRef.current = null;
                          setGameState('menu');
                          setCampaignQueue(null);
                          if (back) setContinuousRainSet(back);
                        }}
                        className="play-btn"
                        style={{
                          flex: 1,
                          background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)',
                          padding: 'clamp(0.6rem, 1.5vh, 0.9rem)',
                          fontSize: 'clamp(0.9rem, 2vh, 1.05rem)', fontWeight: 'bold',
                          borderRadius: '12px', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          gap: '0.4rem', transition: 'all 0.2s'
                        }}
                      >
                        {readerReturnRef.current
                          ? (<><Headphones size={18} /> {t("返回朗讀", "Back to reading")}</>)
                          : (<><Home size={18} /> {t("回到主頁", "Home")}</>)}
                      </button>
                      <button
                        onClick={() => startGame()}
                        className="play-btn"
                        style={{
                          flex: 1,
                          background: '#3b82f6', color: 'white', border: 'none',
                          padding: 'clamp(0.6rem, 1.5vh, 0.9rem)',
                          fontSize: 'clamp(0.9rem, 2vh, 1.05rem)', fontWeight: 'bold',
                          borderRadius: '12px', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          gap: '0.4rem', boxShadow: '0 0 15px rgba(59, 130, 246, 0.5)', transition: 'all 0.2s'
                        }}
                      >
                        <RotateCcw size={18} /> {t("再玩一次", "Play Again")}
                      </button>
                    </div>
                  )}

                  {campaignQueue !== null ? (
                    campaignQueue.length > 0 ? (
                      <button
                        onClick={() => {
                          setActiveVerse(campaignQueue[0]);
                          setCampaignQueue(campaignQueue.slice(1));
                          setTimeout(() => startGame(false, campaignQueue[0]), 50);
                        }}
                        className="play-btn"
                        style={{
                          width: '100%', maxWidth: '300px', background: '#3b82f6', color: 'white', border: 'none', padding: 'clamp(0.8rem, 2vh, 1rem)',
                          fontSize: 'clamp(1.1rem, 2.5vh, 1.2rem)', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: '0 0 15px rgba(59, 130, 246, 0.5)', transition: 'all 0.2s', margin: '0 auto 1rem auto'
                        }}
                      >
                        {t("下一回合", "Next Round")}
                      </button>
                    ) : (
                      <button
                        onClick={() => setGameState('campaign-results')}
                        className="play-btn"
                        style={{
                          width: '100%', maxWidth: '300px', background: '#8b5cf6', color: 'white', border: 'none', padding: 'clamp(0.8rem, 2vh, 1rem)',
                          fontSize: 'clamp(1.1rem, 2.5vh, 1.2rem)', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', boxShadow: '0 0 15px rgba(139, 92, 246, 0.5)', transition: 'all 0.2s', margin: '0 auto 1rem auto'
                        }}
                      >
                        {t("查看最終成績", "View Final Results")}
                      </button>
                    )
                  ) : null}

                  {!isAutoPlayRef.current && (
                    <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '12px', padding: '1rem', marginTop: '1rem', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <h3 style={{ margin: '0 0 1rem 0', color: '#fbbf24', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                        <Trophy size={18} /> {t("全域英雄榜", "Global Leaderboard")}
                      </h3>

                      {!playerName ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                          <p style={{ margin: 0, fontSize: '0.95rem', color: '#e2e8f0', textAlign: 'center' }}>{t("想要將神聖高分刻在群組榜單上嗎？", "Want to carve your high score on the leaderboard?")}</p>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                            {[
                              { id: 'brave', label: t('勇敢', 'Brave'), Icon: Crown },
                              { id: 'joy', label: t('喜樂', 'Joy'), Icon: Star },
                              { id: 'quick', label: t('快手', 'Quick'), Icon: Zap },
                              { id: 'love', label: t('愛心', 'Love'), Icon: Heart },
                              { id: 'rain', label: t('雨滴', 'Rain'), Icon: CloudRain }
                            ].map(({ id, label, Icon }) => (
                              <button key={id} type="button" onClick={() => {
                                const input = document.getElementById('playerNameInput');
                                if (input) {
                                  input.value = label;
                                  input.focus();
                                }
                              }} style={{ cursor: 'pointer', padding: '0.45rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: '8px', transition: 'background 0.2s', color: '#f8fafc', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Icon size={18} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{label}</span>
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                            <input
                              type="text"
                              placeholder={t("你的雷雨暱稱", "Your Nickname")}
                              id="playerNameInput"
                              style={{ flex: 1, padding: '0.8rem', borderRadius: '8px', border: 'none', outline: 'none', fontSize: '1rem' }}
                            />
                            <button
                              className="primary-button"
                              style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0 1.5rem', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                              onClick={() => {
                                const name = document.getElementById('playerNameInput').value.trim();
                                if (!name) return;
                                setPlayerName(name);
                                localStorage.setItem('verserain_player_name', name);
                                setIsSubmittingScore(true);
                                const actualModeName = distractionLevel > 0 ? `${playMode}-dx${distractionLevel}` : playMode;
                                fetch('/api/submit-score', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ name: name, score: score, verseRef: activeVerse.reference, mode: actualModeName })
                                }).then(() => fetch(`/api/get-scores?verseRef=${encodeURIComponent(activeVerse.reference)}`))
                                  .then(res => res.json())
                                  .then(data => setLeaderboard(data && Array.isArray(data.alltime) ? data : { alltime: Array.isArray(data) ? data : [], monthly: [], daily: [] }))
                                  .catch(e => console.log(e))
                                  .finally(() => setIsSubmittingScore(false));
                              }}
                            >
                              {t("送出", "Submit")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.9rem', textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '0.5rem' }}>
                            {[{ id: 'daily', label: t('今天', 'Today') }, { id: 'monthly', label: t('30天 (本月)', '30 days (Month)') }, { id: 'alltime', label: t('歷史', 'All-Time') }].map(tab => (
                              <button
                                key={tab.id}
                                onClick={() => setLeaderboardTab(tab.id)}
                                style={{ flex: 1, padding: '0.4rem 0', background: leaderboardTab === tab.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: 'none', borderBottom: leaderboardTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent', color: leaderboardTab === tab.id ? '#60a5fa' : '#94a3b8', fontWeight: leaderboardTab === tab.id ? 'bold' : 'normal', cursor: 'pointer', fontSize: '0.85rem', transition: 'all 0.2s' }}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ maxHeight: '130px', overflowY: 'auto', paddingRight: '0.2rem' }}>
                            {isSubmittingScore ? (
                              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>{t("上傳分數中...", "Submitting...")}</div>
                            ) : leaderboard && Array.isArray(leaderboard[leaderboardTab]) && leaderboard[leaderboardTab].length > 0 ? (
                              leaderboard[leaderboardTab].map((entry, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                  <span style={{ color: i === 0 ? '#fbbf24' : i === 1 ? '#e2e8f0' : i === 2 ? '#b45309' : '#94a3b8', fontWeight: i < 3 ? 'bold' : 'normal', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <span style={{ width: '16px', textAlign: 'right' }}>{i + 1}.</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                      <span>{entry.name}</span>
                                      <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.3rem', background: entry.mode === 'square' ? 'rgba(139, 92, 246, 0.4)' : 'rgba(59, 130, 246, 0.4)', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{entry.mode || 'rain'}</span>
                                    </span>
                                  </span>
                                  <span style={{ color: '#cbd5e1', fontWeight: 'bold' }}>{entry.score}</span>
                                </div>
                              ))
                            ) : (
                              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '1rem 0' }}>{t("尚無排行紀錄，您是第一位！", "No records yet. Be the first!")}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {gameState === 'campaign-results' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', width: '100vw', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: 'calc(env(safe-area-inset-top) + 2rem) 1rem 4rem' }}>
            <div className="hud-glass" style={{ padding: 'clamp(1.5rem, 4vw, 3rem)', textAlign: 'center', width: '90%', maxWidth: '800px', display: 'flex', flexDirection: 'column', animation: 'flashSuccess 1s ease-out' }}>
              <Trophy size={48} color="#fbbf24" style={{ margin: '0 auto 1rem' }} />
              <h2 style={{ fontSize: 'clamp(2rem, 4vh, 2.5rem)', color: '#fff', marginBottom: '1.5rem' }}>{t("所有關卡完成！", "All Rounds Conquered!")}</h2>

              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '16px', padding: '1.5rem', overflowY: 'auto', maxHeight: '50vh', marginBottom: '2rem' }}>
                {campaignResults.map((result, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: i < campaignResults.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ color: '#93c5fd', fontWeight: 'bold', fontSize: '1.1rem' }}>{result.verse.reference}</div>
                      <div style={{ color: result.health > 0 ? (result.flawless ? '#34d399' : '#93c5fd') : '#f87171', fontSize: '0.9rem' }}>
                        {result.health > 0 ? (result.flawless ? t('完美', 'Perfect') : t('過關', 'Cleared')) : t('錯失', 'Missed')}
                      </div>
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: result.health > 0 ? '#fbbf24' : '#64748b' }}>{result.score}</div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: '1.5rem', color: '#cbd5e1', marginBottom: '2rem' }}>
                {t("總計得分", "Total Score")}: <strong style={{ color: '#fbbf24', fontSize: '3rem', display: 'block', marginTop: '0.5rem' }}>{campaignResults.reduce((sum, r) => sum + r.score, 0)}</strong>
              </div>

              <button
                onClick={() => {
                  setGameState('menu');
                  setCampaignQueue(null);
                }}
                className="play-btn"
                style={{
                  background: '#3b82f6', color: 'white', border: 'none', padding: '1rem',
                  fontSize: '1.2rem', fontWeight: 'bold', borderRadius: '12px', cursor: 'pointer', margin: '0 auto', maxWidth: '300px', width: '100%'
                }}
              >{t("回到主頁", "Back to Home")}</button>
            </div>
          </div>
        )}
        {leaderboardModalVerse && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(5px)' }} onClick={() => setLeaderboardModalVerse(null)}>
            <div className="hud-glass" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(59, 130, 246, 0.3)' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', color: '#93c5fd', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Trophy size={20} /> {t("英雄榜", "Leaderboard")}</h2>
                  <div style={{ color: '#cbd5e1' }}>{leaderboardModalVerse.reference}</div>
                </div>
                <button onClick={() => setLeaderboardModalVerse(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.25rem' }}><XCircle size={24} /></button>
              </div>

              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
                {[{ id: 'daily', label: t('今天', 'Today') }, { id: 'monthly', label: t('30天 (本月)', '30 days (Month)') }, { id: 'alltime', label: t('歷史', 'All-Time') }].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setLeaderboardModalTab(tab.id)}
                    style={{ flex: 1, padding: '1rem 0', background: leaderboardModalTab === tab.id ? 'rgba(59, 130, 246, 0.2)' : 'transparent', border: 'none', borderBottom: leaderboardModalTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent', color: leaderboardModalTab === tab.id ? '#60a5fa' : '#94a3b8', fontWeight: leaderboardModalTab === tab.id ? 'bold' : 'normal', cursor: 'pointer', transition: 'all 0.2s', fontSize: '1rem' }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, minHeight: '300px' }}>
                {isFetchingLeaderboard ? (
                  <div style={{ color: '#94a3b8', textAlign: 'center', margin: '2rem 0' }}>{t("載入排行榜中...", "Loading Leaderboard...")}</div>
                ) : leaderboardModalData && Array.isArray(leaderboardModalData[leaderboardModalTab]) && leaderboardModalData[leaderboardModalTab].length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {leaderboardModalData[leaderboardModalTab].map((entry, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <span style={{ fontSize: '1.2rem', fontWeight: 'bold', width: '24px', textAlign: 'center', color: i === 0 ? '#fbbf24' : i === 1 ? '#e2e8f0' : i === 2 ? '#b45309' : '#94a3b8' }}>{i + 1}</span>
                          <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: i < 3 ? 'bold' : 'normal', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span>{entry.name}</span>
                            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', background: entry.mode === 'square' ? 'rgba(139, 92, 246, 0.4)' : 'rgba(59, 130, 246, 0.4)', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#93c5fd' }}>{entry.mode || 'rain'}</span>
                          </span>
                        </div>
                        <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{entry.score}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', textAlign: 'center', margin: '2rem 0' }}>{t("尚無排行紀錄，趕緊成為第一位吧！", "No records yet. Be the first!")}</div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Reset-password modal — opened by the ?resetToken= link from the
            忘記密碼 email. The token is single-use and expires in 30 minutes;
            the server never had the old password to send back. */}
        {resetToken && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: '1rem' }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: '1.6rem 1.5rem', width: 'min(420px, 100%)', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
              <h3 style={{ marginTop: 0, color: '#1e293b', textAlign: 'center' }}>{t("設定新密碼", "Set a new password")}</h3>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', textAlign: 'center' }}>
                {t("這個連結只能使用一次，30 分鐘內有效。", "This link works once and is valid for 30 minutes.")}
              </div>
              <input id="resetPw1" type="password" autoComplete="new-password" placeholder={t("新密碼（至少 6 個字元）", "New password (at least 6 characters)")}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: '0.6rem', fontSize: '0.95rem' }} />
              <input id="resetPw2" type="password" autoComplete="new-password" placeholder={t("再輸入一次新密碼", "Confirm new password")}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: '0.8rem', fontSize: '0.95rem' }} />
              {resetError && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.7rem', fontWeight: 'bold' }}>{resetError}</div>}
              <button
                disabled={resetBusy}
                onClick={async () => {
                  const pw1 = document.getElementById('resetPw1')?.value || '';
                  const pw2 = document.getElementById('resetPw2')?.value || '';
                  if (pw1.length < 6) return setResetError(t("密碼至少需要 6 個字元", "Password must be at least 6 characters"));
                  if (pw1 !== pw2) return setResetError(t("兩次輸入的密碼不一致", "The two passwords do not match"));
                  setResetBusy(true);
                  setResetError("");
                  try {
                    const res = await fetch(`${PARTY_DB}/reset-password`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ token: resetToken, newPassword: pw1 })
                    });
                    const data = await res.json();
                    if (data.success) {
                      setResetToken(null);
                      alert(t("密碼已更新，請用新密碼登入。", "Your password has been updated. Please log in with it."));
                      setShowLoginModal('login');
                    } else {
                      setResetError(data.error || t("重設失敗", "Reset failed"));
                    }
                  } catch {
                    setResetError(t("無法連線到伺服器", "Server unreachable"));
                  } finally {
                    setResetBusy(false);
                  }
                }}
                style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: 'none', background: resetBusy ? '#94a3b8' : '#3b82f6', color: '#fff', fontWeight: 'bold', cursor: resetBusy ? 'default' : 'pointer', fontSize: '0.95rem' }}
              >
                {resetBusy ? t("處理中…", "Working…") : t("更新密碼", "Update password")}
              </button>
              <div style={{ textAlign: 'center', marginTop: '0.9rem' }}>
                <span onClick={() => { setResetToken(null); setResetError(""); }} style={{ color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}>{t("取消", "Cancel")}</span>
              </div>
            </div>
          </div>
        )}
        {/* Login Account Modal */}
        {challengeSetup && (
          <ChallengeSetupModal
            t={t}
            subtitle={challengeSetup.subtitle}
            value={challengeSetup.value}
            onChange={(v) => setChallengeSetup(c => (c ? { ...c, value: v } : c))}
            onStart={confirmChallengeSetup}
            onCancel={() => setChallengeSetup(null)}
          />
        )}

        {showLoginModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000, padding: '1rem' }}>
            <div style={{ background: '#ffffff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', display: 'flex', flexDirection: 'column', gap: '1.5rem', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, color: '#1e293b', fontSize: '1.5rem', fontWeight: 'bold' }}>
                  {showLoginModal === 'signup' ? t("註冊新帳號", "Sign Up") : (showLoginModal === 'verify' ? t("輸入驗證碼", "Enter Code") : t("登入帳號", "Log In"))}
                </h2>
                <button
                  onClick={() => setShowLoginModal(null)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <XCircle size={24} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {showLoginModal === 'verify' ? (
                  <>
                    <div style={{ fontSize: '0.9rem', color: '#64748b', textAlign: 'center' }}>
                      {t("驗證碼已寄至 ", "Code sent to ")} <strong style={{ color: '#1e293b' }}>{verifyEmail}</strong>
                    </div>
                    <input
                      id="modalCodeInput"
                      type="text"
                      placeholder={t("6位數驗證碼", "6-digit Code")}
                      maxLength={6}
                      style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontSize: '1.2rem', outline: 'none', textAlign: 'center', letterSpacing: '4px', fontWeight: 'bold' }}
                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                    />
                  </>
                ) : (
                  <>
                    <OAuthButtons
                      onGoogleCredential={(accessToken) => handleOAuthSignIn('google', { accessToken })}
                      onAppleCredential={(idToken, extra) => handleOAuthSignIn('apple', { idToken, ...(extra || {}) })}
                      disabled={authLoading}
                      t={t}
                    />

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                      <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
                      <span>{t("或", "or")}</span>
                      <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
                    </div>

                    <input
                      id="modalEmailInput"
                      type="email"
                      placeholder={t("電子郵件", "Email Address")}
                      style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontSize: '0.95rem', outline: 'none' }}
                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                    />

                    <input
                      id="modalPasswordInput"
                      type="password"
                      placeholder={t("密碼", "Password")}
                      style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontSize: '0.95rem', outline: 'none' }}
                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                    />

                    {showLoginModal === 'signup' && (
                      <input
                        id="modalPlayerNameInput"
                        type="text"
                        maxLength={20}
                        defaultValue={playerName}
                        placeholder={t("顯示暱稱", "Display Name")}
                        style={{ padding: '0.8rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#1e293b', fontSize: '0.95rem', outline: 'none' }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
                      />
                    )}
                  </>
                )}
              </div>

              {authError && <div style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'center', marginTop: '-0.5rem', fontWeight: 'bold' }}>{authError}</div>}

              <button
                disabled={authLoading}
                onClick={async () => {
                  if (showLoginModal === 'verify') {
                    const codeInput = document.getElementById('modalCodeInput');
                    const code = codeInput ? codeInput.value.trim() : '';
                    if (!code) { setAuthError("請輸入驗證碼 (Verification code required)"); return; }

                    setAuthLoading(true);
                    setAuthError("");
                    try {
                      const res = await fetch(`${PARTY_DB}/verify-email`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: verifyEmail, code, personalCode: localStorage.getItem('verserain_personal_code') || undefined })
                      });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        alert(t("驗證成功！請重新登入。", "Verification successful! Please log in."));
                        setShowLoginModal('login');
                      } else {
                        setAuthError(data.error || "驗證失敗 (Verification Error)");
                      }
                    } catch (err) {
                      setAuthError("連線失敗 (Connection Error)");
                    } finally {
                      setAuthLoading(false);
                    }
                    return;
                  }

                  const emailInput = document.getElementById('modalEmailInput');
                  const passInput = document.getElementById('modalPasswordInput');
                  const nameInput = document.getElementById('modalPlayerNameInput');

                  const email = emailInput ? emailInput.value.trim() : '';
                  const password = passInput ? passInput.value.trim() : '';
                  const nameStr = nameInput ? nameInput.value.trim() : '';

                  if (!email || !password) {
                    setAuthError("請輸入 Email 與 密碼 (Email & Password required)");
                    return;
                  }

                  setAuthLoading(true);
                  setAuthError("");

                  try {
                    const endpoint = showLoginModal === 'signup' ? '/register' : '/login';
                    const inviter = localStorage.getItem('verserain_inviter') || undefined;
                    // Send this device's local code so the server can bind it as
                    // the account's canonical code on first login/registration.
                    const localCode = localStorage.getItem('verserain_personal_code') || undefined;
                    const payload = { email, password, nickname: nameStr, inviter, personalCode: localCode };

                    // Hit PartyKit Backend
                    const host = PARTY_DB + endpoint;
                    const response = await fetch(host, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload)
                    });

                    const data = await response.json();

                    if (response.ok && data.success) {
                      if (showLoginModal === 'signup') {
                        // Registration: server sends verification email
                        setVerifyEmail(email);
                        setShowLoginModal('verify');
                        alert(t(
                          "註冊成功！請至您的信箱查看驗證碼。",
                          "Registration successful! Please check your email for the verification code."
                        ));
                      } else {
                        // Login: server returns the full user object
                        const prevEmail = localStorage.getItem('verserain_player_email');
                        if (prevEmail && prevEmail !== data.user.email) {
                          localStorage.removeItem('verseRain_gardenData');
                          setGardenData({});
                        }
                        const isPrem = !!data.user.isPremium;
                        setPlayerName(data.user.name || email.split('@')[0]);
                        setUserEmail(data.user.email);
                        setIsPremium(isPrem);
                        localStorage.setItem('verserain_player_name', data.user.name || email.split('@')[0]);
                        localStorage.setItem('verserain_player_email', data.user.email);
                        localStorage.setItem('verserain_is_premium', isPrem ? 'true' : 'false');
                        // Email/password account → clear any stale OAuth marker so
                        // the profile editor shows the password fields for them.
                        localStorage.removeItem('verserain_auth_provider');
                        if (data.user.personalCode) adoptAccountPersonalCode(data.user.personalCode);

                        if (data.user.city) localStorage.setItem('verserain_custom_city', data.user.city);
                        else localStorage.removeItem('verserain_custom_city');

                        if (data.user.country) localStorage.setItem('verserain_custom_country', data.user.country);
                        else localStorage.removeItem('verserain_custom_country');

                        // Cross-device referral restore — same logic as OAuth path.
                        // Server's invitedBy wins over stale local cache until claimed.
                        if (!localStorage.getItem('verserain_invite_claimed')) {
                          const ownCode = localStorage.getItem('verserain_personal_code');
                          if (data.user.invitedBy && data.user.invitedBy !== ownCode) {
                            localStorage.setItem('verserain_inviter', data.user.invitedBy);
                          }
                        }
                        
                        // Force a submit to update map immediately with correct location
                        if (geoRef.current) {
                          fetch('/api/submit-location', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              name: data.user.name || email.split('@')[0],
                              score: 0,
                              lat: parseFloat(geoRef.current.latitude),
                              lng: parseFloat(geoRef.current.longitude),
                              country: data.user.country || geoRef.current.country_name || geoRef.current.country || '',
                              city: data.user.city || geoRef.current.city || '',
                              verseRef: '',
                              roomId: multiplayerRoomRef.current || null
                            })
                          }).catch(() => {});
                        }
                        
                        setShowLoginModal(null);
                      }
                    } else {
                      if (data.requiresVerification) {
                        setVerifyEmail(email);
                        setShowLoginModal('verify');
                        alert(t("請先驗證您的電子郵件", "Please verify your email first"));
                      }
                      setAuthError(data.error || "連線失敗 (Connection Error)");
                    }
                  } catch (err) {
                    setAuthError("無法連線到伺服器 (Server unreachable)");
                  } finally {
                    setAuthLoading(false);
                  }
                }}
                style={{ background: authLoading ? '#94a3b8' : '#3b82f6', color: 'white', border: 'none', padding: '0.8rem', borderRadius: '6px', fontSize: '1rem', fontWeight: 'bold', cursor: authLoading ? 'not-allowed' : 'pointer', transition: 'background 0.2s', marginTop: '0.5rem' }}
                onMouseOver={(e) => { if (!authLoading) e.target.style.background = '#2563eb' }}
                onMouseOut={(e) => { if (!authLoading) e.target.style.background = '#3b82f6' }}
              >
                {authLoading ? "..." : (showLoginModal === 'verify' ? t("驗證", "Verify") : (showLoginModal === 'signup' ? t("建立新帳號 ", "Create Account") : t("登入", "Log In")))}
              </button>

              <div style={{ textAlign: 'center', fontSize: '0.9rem', color: '#64748b', marginTop: '0.5rem' }}>
                {showLoginModal === 'verify' ? (
                  <span onClick={() => setShowLoginModal('login')} style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold' }}>{t("返回登入", "Back to Login")}</span>
                ) : showLoginModal === 'signup' ? (
                  <>
                    {t("已經有帳號？", "Already have an account? ")}
                    <span onClick={() => setShowLoginModal('login')} style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold' }}>{t("在此登入", "Log in here")}</span>
                  </>
                ) : (
                  <>
                    {t("還沒有帳號？", "Don't have an account? ")}
                    <span onClick={() => setShowLoginModal('signup')} style={{ color: '#3b82f6', cursor: 'pointer', fontWeight: 'bold' }}>{t("立即註冊", "Sign up")}</span>
                    <div style={{ marginTop: '0.8rem' }}>
                      <span onClick={async () => {
                        const emailInput = document.getElementById('modalEmailInput');
                        const email = emailInput ? emailInput.value.trim() : '';
                        if (!email) return alert(t("請先在上方的信箱欄位輸入您的信箱！", "Please enter your email first!"));

                        setAuthLoading(true);
                        setAuthError("");
                        try {
                          const res = await fetch(`${PARTY_DB}/forgot-password`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ email })
                          });
                          const data = await res.json();
                          if (data.success) {
                            // The server sends a single-use reset LINK now — it
                            // cannot send the password back, because it only
                            // stores a hash of it.
                            setAuthError("");
                            alert(t(
                              "重設密碼的連結已寄到您的信箱，30 分鐘內有效。",
                              "A password reset link has been sent to your email. It is valid for 30 minutes."
                            ));
                          } else {
                            setAuthError(data.error || t("查詢失敗", "Failed to retrieve password"));
                          }
                        } catch (err) {
                          setAuthError(t("無法連線到伺服器", "Server unreachable"));
                        } finally {
                          setAuthLoading(false);
                        }
                      }} style={{ color: '#94a3b8', cursor: 'pointer', textDecoration: 'underline' }}>{t("忘記密碼？", "Forgot Password?")}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Daily Push opt-in Modal */}
        {/* Bind Inviter Modal — manually attach a referrer when the QR auto-bind failed */}
        {showBindInviterModal && (
          <BindInviterModal
            t={t}
            personalCode={personalCode}
            userEmail={userEmail}
            setMyInviterCode={setMyInviterCode}
            setToast={setToast}
            onClose={() => setShowBindInviterModal(false)}
          />
        )}
        {deepLinkStartGate && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1300, padding: '1rem' }}>
            <button
              onClick={beginDeepLinkStart}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'center', color: '#e2e8f0', padding: '2rem' }}
            >
              <div style={{ width: '96px', height: '96px', margin: '0 auto 1.2rem', borderRadius: '50%', background: 'linear-gradient(135deg, #34d399, #10b981)', display: 'grid', placeItems: 'center', boxShadow: '0 12px 40px rgba(16,185,129,0.45)' }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                {t('點一下開始', 'Tap to Start')}
              </div>
              <div style={{ fontSize: '0.95rem', color: '#94a3b8' }}>
                {t('內容會朗讀出聲 🔊', 'The paragraph will be read aloud 🔊')}
              </div>
            </button>
          </div>
        )}
        {playOrderChooser && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setPlayOrderChooser(null); }}>
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.6rem 1.5rem', width: '100%', maxWidth: '380px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)', textAlign: 'center' }}>
              <h3 style={{ margin: '0 0 0.3rem', color: '#1e293b' }}>{t('播放方式', 'Play Mode')}</h3>
              <p style={{ margin: '0 0 1.2rem', color: '#64748b', fontSize: '0.9rem' }}>
                {playOrderChooser.title} · {selectedPlayDuration.minutes
                  ? t('{n} 分鐘後停止', 'Stops after {n} min').replace('{n}', selectedPlayDuration.minutes)
                  : t('無限循環播放', 'Loops forever')}
              </p>
              <div style={{ margin: '0 0 1.1rem', textAlign: 'left' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600 }}>
                  ⏱️ {t('播放時間', 'Duration')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.45rem' }}>
                  {PLAY_DURATION_OPTIONS.map(option => {
                    const active = option.value === selectedPlayDuration.value;
                    const labelText = option.minutes
                      ? t('{n}分', '{n}m').replace('{n}', option.minutes)
                      : t('無限', '∞');
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPlayDurationChoice(option.value)}
                        style={{
                          padding: '0.52rem 0.35rem',
                          borderRadius: '999px',
                          border: active ? '2px solid #2563eb' : '1px solid #cbd5e1',
                          background: active ? '#eff6ff' : '#fff',
                          color: active ? '#1d4ed8' : '#475569',
                          fontWeight: active ? 800 : 600,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {labelText}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ margin: '0 0 1.1rem', textAlign: 'left' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Aa {t('字體大小', 'Font size')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.45rem' }}>
                  {PLAY_FONT_OPTIONS.map(option => {
                    const active = option.value === selectedPlayFont.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPlayFontChoice(option.value)}
                        style={{
                          padding: '0.52rem 0.35rem',
                          borderRadius: '999px',
                          border: active ? '2px solid #2563eb' : '1px solid #cbd5e1',
                          background: active ? '#eff6ff' : '#fff',
                          color: active ? '#1d4ed8' : '#475569',
                          fontWeight: active ? 800 : 600,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {t(option.label, option.enLabel)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {voiceOptions && (voiceOptions.ownerHasVoice || voiceOptions.contributors.length > 0) && (() => {
                const pill = (active) => ({
                  padding: '0.5rem 0.75rem', borderRadius: '999px', border: active ? '2px solid #8b5cf6' : '1px solid #cbd5e1',
                  background: active ? '#f5f3ff' : '#fff', color: active ? '#6d28d9' : '#475569', fontWeight: active ? 700 : 500,
                  fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                });
                const isSel = (pred) => voiceChoice ? pred(voiceChoice) : false;
                return (
                  <div style={{ margin: '0 0 1.1rem', textAlign: 'left' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 600 }}>
                      🔊 {t('聲音來源', 'Voice')}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {/* Auto = current default (your own › author › TTS). */}
                      <button onClick={() => setVoiceChoice(null)} style={pill(!voiceChoice)}>
                        ✨ {t('自動', 'Auto')}
                      </button>
                      <button onClick={() => setVoiceChoice({ type: 'tts' })} style={pill(isSel(v => v.type === 'tts'))}>
                        💻 {t('電腦語音', 'Computer voice')}
                      </button>
                      {voiceOptions.ownerHasVoice && (
                        <button onClick={() => setVoiceChoice({ type: 'owner' })} style={pill(isSel(v => v.type === 'owner'))}>
                          🎙️ {voiceOptions.ownerName ? t('作者:{n}', 'Author: {n}').replace('{n}', voiceOptions.ownerName) : t('作者錄音', 'Author')}
                        </button>
                      )}
                      {voiceOptions.contributors.map((c) => {
                        const mine = voiceOptions.mineId && c.ownerId === voiceOptions.mineId;
                        const active = isSel(v => v.type === 'personal' && v.ownerId === c.ownerId);
                        return (
                          <button key={c.ownerId} onClick={() => setVoiceChoice({ type: 'personal', ownerId: c.ownerId, label: c.recordedBy })} style={pill(active)}>
                            🎙️ {c.recordedBy || t('某人', 'Someone')}{mine ? ` ${t('(你)', '(you)')}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', gap: '0.8rem' }}>
                <button
                  onClick={() => startContinuousPlay(playOrderChooser, 'random')}
                  style={{ flex: 1, padding: '0.9rem 0.5rem', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)', color: '#fff', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}
                >
                  🔀 {t('隨機', 'Shuffle')}
                </button>
                <button
                  onClick={() => startContinuousPlay(playOrderChooser, 'sequential')}
                  style={{ flex: 1, padding: '0.9rem 0.5rem', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #60a5fa, #3b82f6)', color: '#fff', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}
                >
                  🔁 {t('按序', 'In Order')}
                </button>
              </div>
              <button onClick={() => setPlayOrderChooser(null)} style={{ marginTop: '0.9rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>
                {t('取消', 'Cancel')}
              </button>
            </div>
          </div>
        )}
        {showPushPrompt && !deepLinkStartGate && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) snoozePushPrompt(); }}>
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.8rem 1.6rem', width: '100%', maxWidth: '420px', boxShadow: '0 20px 40px rgba(0,0,0,0.18)', textAlign: 'center' }}>
              <div style={{ fontSize: '2.4rem', marginBottom: '0.6rem' }}>🌧️</div>
              <h2 style={{ margin: '0 0 0.6rem 0', fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b' }}>
                {t('每天早上 7 點，一段開啟你的一天', 'Start each day with a paragraph at 7am')}
              </h2>
              <p style={{ margin: '0 0 1.4rem 0', color: '#475569', fontSize: '0.95rem', lineHeight: 1.55 }}>
                {t('開啟推播後，每天早上會收到當日內容，點一下就能聆聽。', 'Turn on push and each morning the day\'s verse arrives — tap to listen.')}
              </p>
              <button
                onClick={async () => {
                  const ok = await subscribeMorningPush();
                  setShowPushPrompt(false);
                  if (ok) {
                    setToast(t('已開啟每日一首推播 🌧️', 'Daily Paragraph Push is on 🌧️'));
                    setTimeout(() => setToast(null), 4000);
                  } else {
                    // Denied or needs guidance — the full modal explains what to do.
                    setShowPushModal(true);
                  }
                }}
                style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '10px', background: 'linear-gradient(135deg, #34d399, #10b981)', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', marginBottom: '0.6rem' }}
              >
                {t('開啟每日一首推播', 'Turn On Daily Paragraph Push')}
              </button>
              <button
                onClick={snoozePushPrompt}
                style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: '10px', background: '#f1f5f9', color: '#475569', border: 'none', fontSize: '0.95rem', cursor: 'pointer', marginBottom: '0.4rem' }}
              >
                {t('之後再提醒我', 'Remind Me Later')}
              </button>
              <button
                onClick={dismissPushPromptForever}
                style={{ width: '100%', padding: '0.5rem', background: 'transparent', color: '#94a3b8', border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}
              >
                {t('不用了，別再詢問', 'No Thanks, Don\'t Ask Again')}
              </button>
            </div>
          </div>
        )}
        {showPushModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setShowPushModal(false); }}>
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.8rem 1.6rem', width: '100%', maxWidth: '440px', boxShadow: '0 20px 40px rgba(0,0,0,0.18)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 'bold', color: '#1e293b' }}>
                  🌧️ {t('每日一首推播', 'Daily Paragraph Push')}
                </h2>
                <button onClick={() => setShowPushModal(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><XCircle size={22} /></button>
              </div>
              {pushStatus === 'unsupported' && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', borderRadius: '8px', fontSize: '0.92rem', lineHeight: 1.5 }}>
                  {t('此瀏覽器不支援推播。請用桌面 Chrome / Edge / Firefox 或 Android Chrome 來啟用。', 'This browser does not support push. Please use desktop Chrome / Edge / Firefox or Android Chrome.')}
                </div>
              )}
              {pushStatus === 'needs-pwa' && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '1rem', borderRadius: '8px', fontSize: '0.92rem', lineHeight: 1.5 }}>
                  <p style={{ margin: '0 0 0.6rem 0', fontWeight: 'bold' }}>
                    {t('iOS 需要先把 VerseRain 加到主畫面', 'On iOS, add ParagraphRain to your Home Screen first')}
                  </p>
                  <ol style={{ margin: '0 0 0.3rem 1rem', padding: 0 }}>
                    <li>{t('用 Safari 打開 verserain.com（不要用 App）', 'Open paragraphrain.com in Safari (not the App)')}</li>
                    <li>{t('點下方分享圖示 → 加入主畫面', 'Tap Share → Add to Home Screen')}</li>
                    <li>{t('從主畫面點 VerseRain icon 打開', 'Open ParagraphRain from the Home Screen icon')}</li>
                    <li>{t('再回到這頁開啟推播', 'Come back here and turn on push')}</li>
                  </ol>
                </div>
              )}
              {pushStatus === 'denied' && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', borderRadius: '8px', fontSize: '0.92rem', lineHeight: 1.5 }}>
                  {hasNativeDailyPush()
                    ? t('通知權限已關閉。請到 iPhone 設定 → VerseRain → 通知 → 允許通知，再回來重試。', 'Notifications are off. Please enable them in iPhone Settings → ParagraphRain → Notifications, then retry.')
                    : t('瀏覽器已封鎖通知。請到網站設定 → 通知 → 允許，再回來重試。', 'Notifications are blocked. Please allow notifications in your browser site settings, then retry.')}
                </div>
              )}
              {(pushStatus === 'idle' || pushStatus === 'subscribed') && (
                <>
                  <p style={{ margin: '0 0 1.2rem 0', color: '#475569', fontSize: '0.95rem', lineHeight: 1.55 }}>
                    {t('開啟後，每天上午 7 點（你的時區）會收到當日 dailyverses.net 內容推播，點通知一鍵進入「聆聽」。', 'Once enabled, each morning at 7am (your timezone) you\'ll get a push of the day\'s verse from dailyverses.net. Tap to start listening.')}
                  </p>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.7rem 0.9rem', fontSize: '0.85rem', color: '#475569', marginBottom: '1.2rem' }}>
                    <strong>{t('時區', 'Timezone')}:</strong> {typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '—'}
                    <br />
                    <strong>{t('語言', 'Language')}:</strong> {BIBLE_LANGUAGE_OPTIONS.find(o => o.value === version)?.label || version}
                  </div>
                  {pushStatus === 'subscribed' ? (
                    <button
                      onClick={async () => { await unsubscribeMorningPush(); }}
                      style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '10px', background: '#ef4444', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      {t('關閉推播', 'Disable Push')}
                    </button>
                  ) : (
                    <button
                      onClick={async () => { const ok = await subscribeMorningPush(); if (ok) setShowPushModal(false); }}
                      style={{ width: '100%', padding: '0.85rem 1rem', borderRadius: '10px', background: 'linear-gradient(135deg, #34d399, #10b981)', color: '#fff', border: 'none', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      <Volume2 size={18} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                      {t('開啟每日推播', 'Enable Daily Push')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* QR Code Share Modal */}
        {qrShareModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '1rem', backdropFilter: 'blur(8px)' }} onClick={(e) => { if (e.target === e.currentTarget) setQrShareModal(null); }}>
            <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderRadius: '20px', padding: 'clamp(1.5rem, 4vw, 3rem)', width: '100%', maxWidth: '420px', boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 100px rgba(59,130,246,0.15)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', border: '1px solid rgba(59,130,246,0.3)', animation: 'flashSuccess 0.4s ease-out' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Share2 size={20} color="#60a5fa" /> {t("掃描 QR 碼來挑戰！", "Scan to Challenge!")}
                </h3>
                <button onClick={() => setQrShareModal(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.25rem' }}><XCircle size={24} /></button>
              </div>

              <div style={{ color: '#fbbf24', fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', fontWeight: 'bold', textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}><Library size={22} /> {qrShareModal.reference}</span>
              </div>

              <canvas
                ref={(canvas) => {
                  if (canvas && qrShareModal) {
                    QRCode.toCanvas(canvas, qrShareModal.url, {
                      width: Math.min(280, window.innerWidth - 120),
                      margin: 2,
                      color: { dark: '#1e293b', light: '#ffffff' }
                    });
                  }
                }}
                style={{ borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', background: '#fff', padding: '12px' }}
              />

              <p style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', margin: 0 }}>
                {t("讓大家掃描這個 QR 碼，一起來挑戰這段內容！", "Have everyone scan this QR code to challenge this paragraph together!")}
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(qrShareModal.url);
                      setToast(t("分享連結已複製到剪貼簿！", "Share link copied!"));
                      setTimeout(() => setToast(null), 3000);
                    } catch (err) {
                      alert(qrShareModal.url);
                    }
                  }}
                  style={{ flex: 1, padding: '0.75rem', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.25)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><Share2 size={15} /> {t("複製連結", "Copy Link")}</span>
                </button>
                <button
                  onClick={() => setQrShareModal(null)}
                  style={{ flex: 1, padding: '0.75rem', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', fontSize: '0.95rem', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                >
                  {t("關閉", "Close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Verse View Modal */}
        {verseViewModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) { setVerseViewModal(null); stopVerseModalAudio(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } }}>
            <div style={{ background: '#ffffff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '600px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', display: 'flex', flexDirection: 'column', gap: '1.5rem', border: '1px solid #e2e8f0', maxHeight: '85vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>
                <h2 style={{ margin: 0, color: '#1e293b', fontSize: '1.6rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ color: '#3b82f6' }}>{verseViewModal.reference}</span>
                  <button
                    onClick={async () => {
                      updateGarden('activity_only', 'listen');
                      const vLang = getSpeechLangForVersion(version);
                      const opts = await gatherVerseVoiceOptions(verseViewModal.setId, verseViewModal.reference);
                      // >1 recording → let the listener choose whose voice to hear.
                      if (opts.length > 1) {
                        setVerseVoicePicker({ setId: verseViewModal.setId, reference: verseViewModal.reference, text: verseViewModal.text, vLang, options: opts });
                        return;
                      }
                      // Exactly one recording → play it; none → TTS.
                      if (opts.length === 1) {
                        const ok = await playVerseVoiceOption(verseViewModal.setId, opts[0]);
                        if (ok) return;
                      }
                      speakText(verseViewModal.text, 1.0, vLang);
                    }}
                    title={t("朗讀", "Read aloud")}
                    style={{ background: '#ecfdf5', color: '#10b981', border: '1px solid #a7f3d0', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all 0.2s', padding: 0 }}
                    onMouseOver={(e) => { e.currentTarget.style.background = '#d1fae5'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = '#ecfdf5'; e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    <Headphones size={20} />
                  </button>
                  {/* 留言 / 鼓勵 — shown when this verse has any recording. Picks
                      the recording directly when there's one, else lets the
                      viewer choose which recording to comment on. */}
                  {verseViewModal.setId && currentSetVoiceRefs.has(verseViewModal.reference) && (
                    <button
                      onClick={async () => {
                        const opts = await gatherVerseVoiceOptions(verseViewModal.setId, verseViewModal.reference);
                        const withOwner = opts.filter(o => o.ownerId);
                        if (withOwner.length === 0) { setToast(t('這節還沒有錄音可留言', 'No recording to comment on yet')); setTimeout(() => setToast(null), 2500); return; }
                        if (withOwner.length === 1) {
                          openVoiceComments(verseViewModal.setId, verseViewModal.reference, withOwner[0]);
                        } else {
                          const vLang = getSpeechLangForVersion(version);
                          setVerseVoicePicker({ setId: verseViewModal.setId, reference: verseViewModal.reference, text: verseViewModal.text, vLang, options: opts });
                        }
                      }}
                      title={t('留言 / 鼓勵', 'Comment / encourage')}
                      style={{ background: '#f5f3ff', color: '#8b5cf6', border: '1px solid #ddd6fe', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}
                      onMouseOver={(e) => { e.currentTarget.style.background = '#ede9fe'; e.currentTarget.style.transform = 'scale(1.05)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = '#f5f3ff'; e.currentTarget.style.transform = 'scale(1)'; }}
                    >💬</button>
                  )}
                </h2>
                <button
                  onClick={() => {
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                    stopVerseModalAudio();
                    setVerseViewModal(null);
                  }}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <XCircle size={26} />
                </button>
              </div>

              {/* flex:1 + minHeight:0 — without them a flex child never shrinks
                  below its content, so long passages overflowed past 85vh with
                  no scrollbar and the tail of the verse was unreachable. */}
              <div style={{ color: '#475569', fontSize: '1.2rem', lineHeight: '1.8', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingRight: '1rem', fontWeight: '500', fontFamily: 'var(--app-font-family)', wordBreak: 'break-word' }}>
                <span className="ls-on-light"><Annotated text={verseViewModal.text} mode={annotationOf(version)} /></span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid #e2e8f0', gap: '1rem' }}>
                <button
                  onClick={() => {
                    setVerseViewModal(null);
                    stopVerseModalAudio();
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                  }}
                  style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1', padding: '0.6rem 1.5rem', borderRadius: '6px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s' }}
                >
                  {t("關閉", "Close")}
                </button>
                <button
                  onClick={() => {
                    setVerseViewModal(null);
                    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                    initAudio();
                    setCampaignQueue(null);
                    setCampaignResults([]);
                    setActiveVerse(verseViewModal);
                    setTimeout(() => startGame(false, verseViewModal), 50);
                  }}
                  style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '6px', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background 0.2s' }}
                  onMouseOver={(e) => e.target.style.background = '#2563eb'}
                  onMouseOut={(e) => e.target.style.background = '#3b82f6'}
                >
                  <Play size={16} fill="white" /> {t("立刻挑戰", "Play Now")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 單節錄音選擇 — 同一節有多個錄音時,選擇要聽誰的聲音 */}
        {verseVoicePicker && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1300, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setVerseVoicePicker(null); }}>
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem 1.4rem', width: '100%', maxWidth: '360px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
              <h3 style={{ margin: '0 0 0.3rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Headphones size={20} color="#10b981" /> {t('選擇聲音', 'Choose a voice')}
              </h3>
              <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '0.85rem' }}>{verseVoicePicker.reference}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {verseVoicePicker.options.map((opt, i) => {
                  const cnt = opt.ownerId ? voiceCommentCounts[`${verseVoicePicker.reference}||${opt.ownerId}`] : null;
                  return (
                  <div key={opt.voiceId || i} style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                    <button
                      onClick={async () => {
                        const pk = verseVoicePicker;
                        setVerseVoicePicker(null);
                        const ok = await playVerseVoiceOption(pk.setId, opt);
                        if (!ok) speakText(pk.text, 1.0, pk.vLang);
                      }}
                      style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0.7rem 0.9rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#334155', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                      onMouseOver={(e) => { e.currentTarget.style.background = '#eef2ff'; e.currentTarget.style.borderColor = '#c7d2fe'; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
                    >
                      <span aria-hidden="true">🎙️</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {opt.kind === 'owner'
                          ? (opt.recordedBy ? t('作者:{n}', 'Author: {n}').replace('{n}', opt.recordedBy) : t('作者錄音', 'Author'))
                          : `${opt.recordedBy || t('某人', 'Someone')}${opt.mine ? ` ${t('(你)', '(you)')}` : ''}`}
                        {cnt && (cnt.comments > 0 || cnt.likes > 0) && (
                          <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#94a3b8', fontWeight: 500 }}>
                            {cnt.likes > 0 ? `❤️${cnt.likes} ` : ''}{cnt.comments > 0 ? `💬${cnt.comments}` : ''}
                          </span>
                        )}
                      </span>
                      <Play size={15} color="#8b5cf6" fill="#8b5cf6" />
                    </button>
                    {opt.ownerId && (
                      <button
                        title={t('留言 / 鼓勵', 'Comments')}
                        onClick={() => openVoiceComments(verseVoicePicker.setId, verseVoicePicker.reference, opt)}
                        style={{ flexShrink: 0, width: 44, borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#8b5cf6', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.15rem' }}
                      >💬</button>
                    )}
                  </div>
                  );
                })}
                {/* 電腦語音 fallback — always offered as the last option. */}
                <button
                  onClick={() => {
                    const pk = verseVoicePicker;
                    setVerseVoicePicker(null);
                    stopVerseModalAudio();
                    speakText(pk.text, 1.0, pk.vLang);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.7rem 0.9rem', borderRadius: '10px', border: '1px dashed #cbd5e1', background: '#fff', color: '#64748b', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span aria-hidden="true">💻</span>
                  <span style={{ flex: 1 }}>{t('電腦語音', 'Computer voice')}</span>
                  <Play size={15} color="#94a3b8" fill="#94a3b8" />
                </button>
              </div>
              <button onClick={() => setVerseVoicePicker(null)} style={{ marginTop: '1rem', width: '100%', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>
                {t('取消', 'Cancel')}
              </button>
            </div>
          </div>
        )}

        {/* 錄音留言面板 — comments + likes on ONE recording */}
        {voiceCommentPanel && (() => {
          const meLc = (userEmail || '').toLowerCase();
          const isAdminEmail = ['samhsiung@gmail.com', 'davidhwang1125@gmail.com', 'hsiungsam@gmail.com', 'hungry4grace@gmail.com', 'verserain.admin@gmail.com'].includes(meLc);
          const canModerate = isAdminEmail || voiceCommentPanel.mine || (currentSet?.ownerEmail && String(currentSet.ownerEmail).toLowerCase() === meLc && currentSet.id === voiceCommentPanel.setId);
          const recRx = voiceCommentData?.recordingReactions || [];
          const myLiked = recRx.some(r => r.from === meLc && r.emoji === '❤️');
          const commentEmojis = ['❤️', '🙏'];
          return (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2700, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setVoiceCommentPanel(null); }}>
            <div style={{ background: '#fff', borderRadius: '14px', width: '100%', maxWidth: '440px', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
              {/* Header */}
              <div style={{ padding: '1.1rem 1.3rem 0.8rem', borderBottom: '1px solid #eef2f7' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.05rem' }}>💬 {t('留言 / 鼓勵', 'Comments')}</div>
                    <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {voiceCommentPanel.reference} · 🎙️ {voiceCommentPanel.recordedBy || t('某人', 'Someone')}{voiceCommentPanel.mine ? ` ${t('(你)', '(you)')}` : ''}
                    </div>
                  </div>
                  <button onClick={() => setVoiceCommentPanel(null)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0, flexShrink: 0 }}><XCircle size={22} /></button>
                </div>
                {/* Recording-level like */}
                <button
                  onClick={() => { if (!userEmail) { setShowLoginModal('login'); return; } likeRecording('❤️'); }}
                  title={t('為這個錄音按讚', 'Like this recording')}
                  style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.8rem', borderRadius: 999, border: myLiked ? '1px solid #fecaca' : '1px solid #e2e8f0', background: myLiked ? '#fef2f2' : '#f8fafc', color: myLiked ? '#dc2626' : '#475569', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  ❤️ {t('讚', 'Like')}{recRx.filter(r => r.emoji === '❤️').length > 0 ? ` · ${recRx.filter(r => r.emoji === '❤️').length}` : ''}
                </button>
              </div>
              {/* Comment list */}
              <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0.9rem 1.3rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {voiceCommentData === null && <div style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center' }}>{t('載入中…', 'Loading…')}</div>}
                {voiceCommentData && voiceCommentData.comments.length === 0 && (
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', padding: '1rem 0' }}>{t('還沒有留言。留下第一句鼓勵吧！', 'No comments yet — leave the first word of encouragement!')}</div>
                )}
                {voiceCommentData && voiceCommentData.comments.map((c) => {
                  const canDelete = c.author === meLc || canModerate;
                  return (
                    <div key={c.cid} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, color: '#334155', fontSize: '0.88rem' }}>{c.authorName || t('某人', 'Someone')}</span>
                        <span style={{ color: '#cbd5e1', fontSize: '0.72rem' }}>{new Date(c.at).toLocaleDateString()}</span>
                        {canDelete && (
                          <button onClick={() => deleteVoiceComment(c.cid)} title={t('刪除', 'Delete')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.8rem', padding: '0 4px' }}>✕</button>
                        )}
                      </div>
                      {c.type === 'voice' ? (
                        <button onClick={() => playCommentAudio(voiceCommentPanel.setId, c.voiceId, c.voiceMime)} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.4rem 0.8rem', borderRadius: 8, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#6d28d9', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                          ▶ {t('語音留言', 'Voice comment')}{c.voiceDur ? ` · ${Math.round(c.voiceDur)}s` : ''}
                        </button>
                      ) : (
                        <div style={{ color: '#334155', fontSize: '0.92rem', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{c.text}</div>
                      )}
                      {/* Per-comment reactions */}
                      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        {commentEmojis.map((em) => {
                          const n = (c.reactions || []).filter(r => r.emoji === em).length;
                          const mine = (c.reactions || []).some(r => r.from === meLc && r.emoji === em);
                          return (
                            <button key={em} onClick={() => { if (!userEmail) { setShowLoginModal('login'); return; } reactVoiceComment(c.cid, em); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0.15rem 0.5rem', borderRadius: 999, border: mine ? '1px solid #c7d2fe' : '1px solid #e2e8f0', background: mine ? '#eef2ff' : '#fff', color: '#475569', fontSize: '0.78rem', cursor: 'pointer' }}>
                              {em}{n > 0 ? ` ${n}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Composer */}
              <div style={{ borderTop: '1px solid #eef2f7', padding: '0.8rem 1.3rem 1rem' }}>
                {userEmail ? (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <textarea
                      value={voiceCommentText}
                      onChange={(e) => setVoiceCommentText(e.target.value.slice(0, 1000))}
                      placeholder={t('留一句鼓勵…', 'Leave an encouragement…')}
                      rows={1}
                      style={{ flex: 1, resize: 'none', minHeight: 40, maxHeight: 120, padding: '0.55rem 0.7rem', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: '0.92rem', fontFamily: 'inherit', color: '#334155' }}
                    />
                    <button onClick={() => setCommentRecTarget(voiceCommentPanel)} title={t('錄語音留言', 'Record a voice comment')} style={{ flexShrink: 0, width: 42, height: 42, borderRadius: '50%', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#dc2626', cursor: 'pointer', fontSize: '1.2rem' }}>🎙️</button>
                    <button onClick={submitTextComment} disabled={voiceCommentBusy || !voiceCommentText.trim()} style={{ flexShrink: 0, height: 42, padding: '0 1rem', borderRadius: 10, border: 'none', background: voiceCommentText.trim() ? 'linear-gradient(135deg,#8b5cf6,#6d28d9)' : '#e2e8f0', color: '#fff', fontWeight: 700, cursor: voiceCommentText.trim() ? 'pointer' : 'default' }}>{t('送出', 'Send')}</button>
                  </div>
                ) : (
                  <button onClick={() => setShowLoginModal('login')} style={{ width: '100%', padding: '0.7rem', borderRadius: 10, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontWeight: 600, cursor: 'pointer' }}>
                    {t('登入後即可留言 / 鼓勵', 'Sign in to comment')}
                  </button>
                )}
              </div>
            </div>
          </div>
          );
        })()}

        {/* 語音留言錄音器 — records an audio comment on a recording */}
        {commentRecTarget && (
          <VerseVoiceRecorder
            t={t}
            reference={commentRecTarget.reference}
            verseText={t('留一段話,鼓勵 {n} 🎙️', 'Leave a spoken word of encouragement for {n} 🎙️').replace('{n}', commentRecTarget.recordedBy || t('這位錄音者', 'this reader'))}
            onUpload={({ blob, mime, dur }) => {
              const target = commentRecTarget;
              setCommentRecTarget(null);
              (async () => {
                try {
                  await uploadVoiceComment({ email: userEmail, name: recordedByNameApp(), setId: target.setId, reference: target.reference, targetOwnerId: target.targetOwnerId, blob, mime, dur });
                  await refreshVoiceComments(target);
                } catch (e) { console.error('voice comment failed', e); }
              })();
            }}
            onCancel={() => setCommentRecTarget(null)}
            onDone={() => setCommentRecTarget(null)}
            zIndex={2720}
          />
        )}

        {/* 鼓勵收件匣 — encouragement I've received on my recordings */}
        {showEncouragePanel && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1360, padding: '1rem' }} onClick={(e) => { if (e.target === e.currentTarget) setShowEncouragePanel(false); }}>
            <div style={{ background: '#fff', borderRadius: '14px', width: '100%', maxWidth: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
              <div style={{ padding: '1.1rem 1.3rem 0.8rem', borderBottom: '1px solid #eef2f7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.05rem' }}>🔔 {t('收到的鼓勵', 'Encouragement received')}</div>
                <button onClick={() => setShowEncouragePanel(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}><XCircle size={22} /></button>
              </div>
              <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0.6rem 0' }}>
                {(encourageInbox?.items || []).length === 0 && (
                  <div style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem 1rem' }}>{t('還沒有收到鼓勵。錄下你的聲音分享給大家吧！', 'No encouragement yet — record and share your voice!')}</div>
                )}
                {(encourageInbox?.items || []).map((it, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '0.6rem 1.3rem' }}>
                    <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>{it.kind === 'like' ? (it.emoji || '❤️') : '💬'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#334155', fontSize: '0.9rem', lineHeight: 1.45 }}>
                        <b>{it.fromName || t('某人', 'Someone')}</b>{' '}
                        {it.kind === 'like'
                          ? t('喜歡你在〈{ref}〉的錄音', 'liked your recording of {ref}').replace('{ref}', it.reference || '')
                          : t('在〈{ref}〉留言鼓勵你', 'commented on your recording of {ref}').replace('{ref}', it.reference || '')}
                      </div>
                      {it.preview && it.kind === 'comment' && <div style={{ color: '#64748b', fontSize: '0.82rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.preview}</div>}
                      <div style={{ color: '#cbd5e1', fontSize: '0.72rem', marginTop: 2 }}>{new Date(it.at).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}


        {/* Offline / Reconnecting Banner */}
        {!isOnline && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, backgroundColor: '#dc2626', color: 'white', padding: '6px 16px', textAlign: 'center', zIndex: 10000, fontSize: '0.85rem', fontWeight: 600 }}>
            {t('網路已斷開，部分功能暫時無法使用', 'Offline — some features are unavailable')}
          </div>
        )}
        {isOnline && multiplayerRoomId && !wsConnected && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, backgroundColor: '#f59e0b', color: '#1e293b', padding: '6px 16px', textAlign: 'center', zIndex: 10000, fontSize: '0.85rem', fontWeight: 600 }}>
            {t('重新連線中…', 'Reconnecting…')}
          </div>
        )}

        {/* Toast Notification Overlay */}
        {toast && (
          <div style={{ position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e293b', color: 'white', padding: '0.8rem 1.5rem', borderRadius: '50px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: '8px', animation: 'fadeInUp 0.3s ease-out', fontWeight: 'bold' }}>
            <Star size={18} fill="#fbbf24" stroke="#fbbf24" />
            {toast}
          </div>
        )}

        {/* Fruit Info Modal */}
        {showFruitInfo && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowFruitInfo(false)}>
            <div style={{ background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #fffbeb, #fef3c7)' }}>
                <h3 style={{ margin: 0, color: '#b45309', fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Apple size={22} /> {t("果子數量怎麼算？", "How are fruits counted?")}
                </h3>
                <button onClick={() => setShowFruitInfo(false)} style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', color: '#94a3b8', cursor: 'pointer' }}><X size={24} /></button>
              </div>
              <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ margin: 0, color: '#475569', lineHeight: '1.7', fontSize: '0.97rem' }}>
                  {t("你的總果子數量由兩部分組成：", "Your total fruit count has two components:")}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', background: '#f0fdf4', borderRadius: '10px', padding: '0.9rem 1rem', border: '1px solid #bbf7d0' }}>
                    <TreePine size={24} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#166534', marginBottom: '0.2rem' }}>
                        {t("遊戲果子", "Game Fruits")} — <span style={{ color: '#d97706' }}>{localFruits}</span>
                      </div>
                      <div style={{ color: '#475569', fontSize: '0.9rem', lineHeight: '1.5' }}>
                        {t("每次挑戰一節已「過關」的內容並創下個人最高分，這棵樹就會結出一顆果子。果子數量就是你在「我的園子」裡所有樹上果子的總和。", "Each time you beat your personal best on a verse you've already cleared, that tree bears a fruit. This total counts all fruits across every tree in your garden.")}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', background: '#eff6ff', borderRadius: '10px', padding: '0.9rem 1rem', border: '1px solid #bfdbfe' }}>
                    <Share2 size={24} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#1d4ed8', marginBottom: '0.2rem' }}>
                        {t("推廣點數", "Referral Points")} — <span style={{ color: '#d97706' }}>{creatorPoints}</span>
                      </div>
                      <div style={{ color: '#475569', fontSize: '0.9rem', lineHeight: '1.5' }}>
                        {t("當你分享的邀請連結帶來新玩家，或你創作了廣受歡迎的自訂內容集，系統會自動為你累積推廣點數。", "When your invite link brings in new players, or your custom collections are widely used, the system automatically adds referral points to your total.")}
                      </div>
                    </div>
                  </div>
                </div>
                <div style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', borderRadius: '10px', padding: '0.9rem 1rem', border: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ color: '#92400e', fontWeight: 'bold', fontSize: '0.95rem' }}>
                    <Apple size={18} /> {t("遊戲果子", "Game")} {localFruits} + {t("推廣點數", "Referral")} {creatorPoints}
                  </span>
                  <span style={{ color: '#b45309', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    = {totalFruits}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Level Info Modal */}
        {showLevelInfo && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowLevelInfo(false)}>
            <div style={{ background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Trophy size={24} /> {t("互惠階級說明", "Level System")}
                </h3>
                <button onClick={() => setShowLevelInfo(false)} style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', color: '#94a3b8', cursor: 'pointer' }}><X size={24} /></button>
              </div>

              <div style={{ padding: '1.5rem', overflowY: 'auto' }}>
                <p style={{ color: '#475569', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                  {t("在園子裡持續照顧樹苗並結出果子，就能提升你的互惠階級！", "Bear fruits in your garden to level up!")}
                  {t("（建立專屬內容集不需要階級 —— 登入就可以。）", " Creating custom collections needs no level — just sign in.")}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {SKOOL_LEVELS.map(levelObj => {
                    const isCurrent = skoolLevel.level === levelObj.level;
                    const isUnlocked = skoolLevel.level >= levelObj.level;

                    return (
                      <div key={levelObj.level} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '1rem 1.5rem', borderRadius: '12px',
                        background: isCurrent ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : (isUnlocked ? '#f8fafc' : '#ffffff'),
                        border: `2px solid ${isCurrent ? '#22c55e' : (isUnlocked ? '#e2e8f0' : '#f1f5f9')}`,
                        transition: 'transform 0.2s', transform: isCurrent ? 'scale(1.02)' : 'none',
                        boxShadow: isCurrent ? '0 4px 12px rgba(34, 197, 94, 0.15)' : 'none'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: isCurrent ? '#22c55e' : (isUnlocked ? '#64748b' : '#cbd5e1'), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem' }}>
                            {levelObj.level}
                          </div>
                          <div>
                            <div style={{ fontWeight: 'bold', color: isCurrent ? '#15803d' : (isUnlocked ? '#334155' : '#94a3b8'), fontSize: '1.1rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                              {t(levelObj.title, levelObj.enTitle)}

                              {levelCounts !== null && levelCounts._total > 0 && (
                                <span style={{ fontSize: '0.85rem', color: '#64748b', marginLeft: '12px', fontWeight: 'bold', background: '#f1f5f9', padding: '4px 10px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <Users size={14} /> {levelCounts[levelObj.level] || 0} {t("人", "players")} ({levelCounts._total > 0 ? Math.round(((levelCounts[levelObj.level] || 0) / levelCounts._total) * 100) : 0}%)
                                </span>
                              )}

                              {isCurrent && <span style={{ fontSize: '0.9rem', color: '#059669', marginLeft: '8px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><Info size={14} /> {t("目前階級", "You are here")}</span>}
                            </div>
                          </div>
                        </div>
                        <div style={{ fontWeight: 'bold', color: isUnlocked ? '#d97706' : '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Apple size={18} /> {levelObj.points}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ padding: '1rem 1.5rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', textAlign: 'center' }}>
                <button onClick={() => setShowLevelInfo(false)} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0.8rem 2rem', borderRadius: '8px', fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer' }}>
                  {t("關閉", "Close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Player Garden Viewer Modal */}
        {viewingPlayerGarden && (() => {
          const vgData = viewingPlayerGarden.gardenData || {};
          const vgEntries = Object.entries(vgData).filter(([k]) => k !== '_activity');
          const vgTreeCount = vgEntries.length;
          const vgGameFruits = vgEntries.reduce((sum, [, d]) => sum + (d.fruits || 0), 0);
          const vgCreatorFruits = viewingPlayerGarden.creatorPoints || 0;
          const vgReferralFruits = viewingPlayerGarden.referralPoints || 0;
          const vgTotalFruits = vgGameFruits + vgCreatorFruits + vgReferralFruits;
          const vgCellsPerField = 100;
          const vgMaxGridIndex = vgEntries.reduce((max, [, data]) => Math.max(max, data.gridIndex), -1);
          const vgFieldCount = Math.max(1, Math.ceil((vgMaxGridIndex + 1) / vgCellsPerField));
          const vgGridMap = {};
          vgEntries.forEach(([ref, data]) => { vgGridMap[data.gridIndex] = { ref, ...data }; });

          const applePositions = [
            { top: '30%', left: '50%' }, // 1
            { top: '45%', left: '30%' }, // 2
            { top: '45%', left: '70%' }, // 3
            { top: '25%', left: '35%' }, // 4
            { top: '25%', left: '65%' }, // 5
            { top: '55%', left: '50%' }, // 6
            { top: '35%', left: '20%' }, // 7
            { top: '35%', left: '80%' }, // 8
            { top: '15%', left: '50%' }, // 9
          ];

          const stageEmoji = (stage, fruits) => {
            if (stage <= 0) return '';
            if (stage <= 3) return <img src="/assets/garden/tree-seedling.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 10px 10px rgba(0,0,0,0.2))' }} alt="seedling" />;
            if (stage <= 6) return <img src="/assets/garden/tree-sapling.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 15px 15px rgba(0,0,0,0.2))' }} alt="sapling" />;
            if (stage <= 9) return <img src="/assets/garden/tree-mature.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.3))' }} alt="mature tree" />;

            if (fruits > 0) {
              const displayApples = Math.min(fruits, 9);
              return (
                <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'absolute', width: '150%', height: '150%', transform: 'translateY(-15%)' }}>
                    <img src="/assets/garden/tree-mature.png" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.3))' }} alt="mature tree" />
                    {Array.from({ length: displayApples }).map((_, idx) => (
                      <div key={idx} style={{
                        position: 'absolute',
                        top: applePositions[idx].top,
                        left: applePositions[idx].left,
                        fontSize: '14px',
                        transform: 'translate(-50%, -50%)',
                        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.4))',
                        zIndex: 2,
                        pointerEvents: 'none',
                      }}><Apple size={14} fill="#dc2626" color="#b91c1c" /></div>
                    ))}
                  </div>
                  {fruits > 9 && (
                    <span style={{ position: 'absolute', top: '-15px', right: '-15px', fontSize: '12px', fontWeight: 'bold', color: '#b91c1c', background: 'rgba(255,255,255,0.9)', borderRadius: '6px', padding: '1px 4px', zIndex: 3, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                      +{fruits - 9}
                    </span>
                  )}
                </div>
              );
            }
            return <img src="/assets/garden/tree-mature.png" style={{ width: '150%', height: '150%', objectFit: 'contain', transform: 'translateY(-15%)', filter: 'drop-shadow(0 20px 20px rgba(0,0,0,0.3))' }} alt="mature tree" />;
          };
          const stageBg = (stage) => {
            if (stage <= 0) return '#e8f5e9';
            if (stage <= 3) return '#c8e6c9';
            if (stage <= 6) return '#a5d6a7';
            if (stage <= 9) return '#81c784';
            return '#66bb6a';
          };

          return (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(4px)' }} onClick={() => { setViewingPlayerGarden(null); setGuestGardenCell(null); }}>
              <div style={{ background: '#fff', borderRadius: '16px', width: '100%', maxWidth: '800px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ padding: '1.2rem 1.5rem', background: 'linear-gradient(135deg, #065f46, #047857)', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Leaf size={24} /> {viewingPlayerGarden.playerName} {t('的園地', "'s Garden")}
                    </h3>
                    <div style={{ fontSize: '0.85rem', opacity: 0.8, marginTop: '4px' }}>
                      <div style={{ marginBottom: '4px' }}>
                        {vgTreeCount} {t('棵植物', 'plants')} · {t('點擊查看，雙擊挑戰！', 'Click to view, double-click to challenge!')}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Apple size={16} /> {t('總果子', 'Total Fruits')}: <strong>{vgTotalFruits}</strong></span>
                        <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                          ( {t('內容', 'Paragraphs')} {vgGameFruits} | {t('推薦', 'Referral')} {vgReferralFruits} | {t('內容集分享', 'Sets Shared')} {vgCreatorFruits} )
                        </span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => { setViewingPlayerGarden(null); setGuestGardenCell(null); }} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', fontSize: '1.4rem', cursor: 'pointer', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={22} /></button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.2rem' }}>
                  {viewingPlayerGarden.loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', fontSize: '1.1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}><Hourglass size={20} /> {t('載入中...', 'Loading...')}</div>
                  ) : viewingPlayerGarden.error ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#f43f5e', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}><Frown size={20} /> {viewingPlayerGarden.error}</div>
                  ) : vgTreeCount === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}><Sprout size={20} /> {t('這個玩家的園地還是空的！', 'This player\'s garden is empty!')}</div>
                  ) : (
                    <>
                      {/* Garden Grid - Isometric */}
                      {(() => {
                        const hour = new Date().getHours();
                        let envBg = 'linear-gradient(to bottom, #bae6fd, #e0f2fe)'; // Day
                        if (hour >= 19 || hour < 5) envBg = 'linear-gradient(to bottom, #0f172a, #1e1b4b)'; // Night
                        else if (hour >= 17) envBg = 'linear-gradient(to bottom, #fca5a5, #fef08a)'; // Sunset
                        else if (hour >= 5 && hour < 8) envBg = 'linear-gradient(to bottom, #fce7f3, #fef08a)'; // Sunrise

                        // Square-ish field layout
                        const vgFieldRows = Math.ceil(Math.sqrt(vgFieldCount));
                        const vgFieldCols = Math.ceil(vgFieldCount / vgFieldRows);

                        // Auto-zoom to fit all fields
                        const vgContentW = vgFieldCols * 498 + Math.max(0, vgFieldCols - 1) * 40;
                        const vgContentH = vgFieldRows * 498 + Math.max(0, vgFieldRows - 1) * 40;
                        const vgFitScale = Math.min(520 / (vgContentW + 40), 420 / (vgContentH + 40), 1);
                        const vgInitialScale = Math.max(0.25, Math.round(vgFitScale * 0.85 * 100) / 100);

                        return (
                          <div style={{
                            overflow: 'hidden',
                            width: '100%',
                            height: '50vh',
                            minHeight: '350px',
                            borderRadius: '12px',
                            border: '4px solid #334155',
                            background: envBg,
                            position: 'relative',
                            boxShadow: 'inset 0 10px 30px rgba(0,0,0,0.1)'
                          }}>
                            <TransformWrapper initialScale={vgInitialScale} minScale={0.2} maxScale={4} centerOnInit={true} doubleClick={{ disabled: true }}>
                              {({ zoomIn, zoomOut, resetTransform }) => (
                                <>
                                  <div style={{ position: 'absolute', bottom: '15px', right: '15px', zIndex: 10, display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.8)', padding: '5px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
                                    <button onClick={() => zoomIn()} style={{ width: '32px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                    <button onClick={() => zoomOut()} style={{ width: '32px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                    <button onClick={() => resetTransform()} style={{ width: '32px', height: '32px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RotateCw size={18} /></button>
                                  </div>
                                  <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '20px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${vgFieldCols}, auto)`, justifyContent: 'center', gap: '40px' }}>
                                      {Array.from({ length: vgFieldCount }).map((_, fieldIdx) => (
                                        <div key={fieldIdx} style={{
                                          display: 'grid',
                                          gridTemplateColumns: `repeat(10, 48px)`,
                                          gridTemplateRows: `repeat(10, 48px)`,
                                          gap: '2px',
                                          background: (hour >= 19 || hour < 5) ? 'rgba(30, 41, 59, 0.4)' : 'rgba(34, 197, 94, 0.3)',
                                          border: '2px solid rgba(255,255,255,0.2)',
                                          borderRadius: '8px',
                                        }}>
                                          {Array.from({ length: vgCellsPerField }).map((_, i) => {
                                            const globalIndex = fieldIdx * vgCellsPerField + i;
                                            const cell = vgGridMap[globalIndex];
                                            const isEmpty = !cell;
                                            return (
                                              <div key={globalIndex}
                                                onClick={() => {
                                                  if (!cell) return;
                                                  if (guestGardenClickTimer.current) { clearTimeout(guestGardenClickTimer.current); guestGardenClickTimer.current = null; return; }
                                                  guestGardenClickTimer.current = setTimeout(async () => {
                                                    guestGardenClickTimer.current = null;
                                                    const allVerses = [...safeActiveSets, ...customVerseSets].flatMap(s => s.verses);
                                                    let targetVerse = findVerseByRef(allVerses, cell.ref);
                                                    if (!targetVerse) {
                                                      setIsLangsLoading(true);
                                                      const langKeys = ['en', 'cuv', 'cuvs'];
                                                      for (const lang of langKeys) {
                                                        let data = loadedLangs[lang];
                                                        if (!data) {
                                                          data = await loadLanguageSets(lang);
                                                          setLoadedLangs(prev => ({ ...prev, [lang]: data }));
                                                        }
                                                        const found = findVerseByRef(data.verses, cell.ref);
                                                        if (found) { targetVerse = found; break; }
                                                      }
                                                      setIsLangsLoading(false);
                                                    }
                                                    setGuestGardenCell({ ref: cell.ref, text: targetVerse?.text || '', stage: cell.stage, fruits: cell.fruits || 0 });
                                                  }, 250);
                                                }}
                                                onDoubleClick={async () => {
                                                  if (!cell) return;
                                                  if (guestGardenClickTimer.current) { clearTimeout(guestGardenClickTimer.current); guestGardenClickTimer.current = null; }
                                                  const allVerses = [...safeActiveSets, ...customVerseSets].flatMap(s => s.verses);
                                                  let targetVerse = findVerseByRef(allVerses, cell.ref);
                                                  let detectedLang = version;
                                                  if (!targetVerse) {
                                                    setIsLangsLoading(true);
                                                    const langKeys = ['en', 'cuv', 'cuvs'];
                                                    for (const lang of langKeys) {
                                                      let data = loadedLangs[lang];
                                                      if (!data) {
                                                        data = await loadLanguageSets(lang);
                                                        setLoadedLangs(prev => ({ ...prev, [lang]: data }));
                                                      }
                                                      const found = findVerseByRef(data.verses, cell.ref);
                                                      if (found) { targetVerse = found; detectedLang = lang; break; }
                                                    }
                                                    setIsLangsLoading(false);
                                                  }
                                                  if (targetVerse) {
                                                    setGuestGardenCell(null);
                                                    setViewingPlayerGarden(null);
                                                    if (detectedLang !== version) { versionBeforeChallenge.current = version; setVersion(detectedLang); }
                                                    openChallengeSetup({
                                                      subtitle: targetVerse.reference,
                                                      run: () => {
                                                        setActiveVerse(targetVerse);
                                                        setSelectedVerseRefs([targetVerse.reference]);
                                                        setTimeout(() => startGame(false, targetVerse), 50);
                                                      },
                                                    });
                                                  }
                                                }}
                                                style={{
                                                  width: '48px', height: '48px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                  fontSize: cell ? '20px' : '10px',
                                                  background: cell ? stageBg(cell.stage) : '#5d4037',
                                                  border: cell ? '1px solid rgba(0,0,0,0.1)' : 'none',
                                                  cursor: cell ? 'pointer' : 'default', transition: 'transform 0.1s, filter 0.2s', userSelect: 'none'
                                                }}
                                                onMouseOver={e => { if (cell) { e.currentTarget.style.filter = 'brightness(1.15)'; e.currentTarget.style.transform = 'scale(1.08)'; } }}
                                                onMouseOut={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.transform = ''; }}
                                              >
                                                {cell ? stageEmoji(cell.stage, cell.fruits || 0) : ''}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ))}
                                    </div>
                                  </TransformComponent>
                                </>
                              )}
                            </TransformWrapper>
                          </div>
                        );
                      })()}

                      {/* Verse preview on single click */}
                      {guestGardenCell && (
                        <div style={{ marginTop: '1rem', padding: '1rem 1.5rem', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #86efac', position: 'relative' }}>
                          <button onClick={() => setGuestGardenCell(null)} style={{ position: 'absolute', top: '8px', right: '12px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}><X size={20} /></button>
                          <div style={{ fontWeight: 'bold', color: '#166534', marginBottom: '6px' }}>{guestGardenCell.ref}</div>
                          <div style={{ color: '#1e293b', lineHeight: '1.8', fontSize: '1rem' }}>{guestGardenCell.text || t('（在此裝置上未找到內容文字，但仍可雙擊挑戰）', '(Text not found on this device, but you can still double-click to challenge)')}</div>
                          <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '8px' }}>{t('雙擊格子開始挑戰！', 'Double-click the cell to start challenging!')}</div>
                        </div>
                      )}
                      <div style={{ marginTop: '0.8rem', fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}><Smartphone size={14} /> {t('可用手指滑動來瀏覽園子', 'Swipe to browse the garden')}</div>
                      <div style={{ marginTop: '1.5rem' }}>
                        <ActivityHeatmap t={t} activityMap={vgData?._activity || {}} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {authorSetsModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.52)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: 'white', borderRadius: '14px', width: '100%', maxWidth: '760px', maxHeight: '88vh', overflow: 'hidden', position: 'relative', boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)', border: '1px solid #dbeafe' }}>
            <div style={{ padding: '1.5rem 1.75rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#64748b', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.35rem' }}>{t("作者的內容集", "Author's Verse Sets")}</div>
                <h2 style={{ color: '#1e293b', margin: 0, fontSize: '1.35rem', lineHeight: 1.25, overflowWrap: 'anywhere' }}>
                  {authorSetsModal.authorName === '匿名玩家' ? t('匿名玩家', 'Anonymous') : authorSetsModal.authorName === 'Verserain 官方' ? t('Verserain 官方', 'Official') : authorSetsModal.authorName}
                </h2>
              </div>
              <button
                onClick={() => setAuthorSetsModal(null)}
                style={{ background: '#ffffff', border: '1px solid #cbd5e1', color: '#64748b', width: '36px', height: '36px', borderRadius: '8px', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}
                title={t("關閉", "Close")}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '1rem 1.75rem 1.5rem', overflowY: 'auto', maxHeight: 'calc(88vh - 104px)' }}>
              {authorVerseSets.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', fontWeight: 'bold' }}>{t("目前沒有內容集", "No collections found")}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {authorVerseSets.map((set) => (
                    <button
                      key={set.id}
                      type="button"
                      onClick={() => {
                        setSelectedSetId(set.id);
                        setAuthorSetsModal(null);
                        setMainTab('versesets');
                        fetch(`${PARTY_DB}/custom-sets/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: set.id, adminEmail: userEmail, adminName: playerName }) }).catch(e => e);
                        setViewCounts(prev => ({ ...prev, [set.id]: (prev[set.id] || 0) + 1 }));
                      }}
                      style={{ width: '100%', textAlign: 'left', background: set.id === currentSet?.id ? '#eff6ff' : '#ffffff', border: set.id === currentSet?.id ? '1px solid #93c5fd' : '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'center', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = set.id === currentSet?.id ? '#93c5fd' : '#e2e8f0'; e.currentTarget.style.backgroundColor = set.id === currentSet?.id ? '#eff6ff' : '#ffffff'; }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', color: '#1e293b', fontWeight: 'bold', fontSize: '1rem', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{set.title}</span>
                        <span style={{ display: 'block', color: '#64748b', fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {(set.verses?.length || 0)} {t("段", "paragraphs")} · {(viewCounts[set.id] || 0)} {t("點閱次數", "views")}
                        </span>
                      </span>
                      <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                        {set.id === currentSet?.id ? t("目前選擇", "Current") : t("查看", "Open")}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showSetLeaderboard && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '1rem' }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '12px', width: '100%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
            <button onClick={() => { setShowSetLeaderboard(false); setLeaderboardPage(0); setLeaderboardSetId(null); }} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}><X size={24} /></button>
            <h2 style={{ color: '#1e293b', marginTop: 0, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px' }}><Trophy color="#f59e0b" /> {t("內容集通關紀錄", "Collection Records")}</h2>
            
            {isLoadingLeaderboard ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>{t('載入中...', 'Loading...')}</div>
            ) : leaderboardData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>{t('目前還沒有通關紀錄', 'No records found yet')}</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginBottom: '1rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', color: '#475569', fontSize: '0.9rem' }}>
                      <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("排行", "Rank")}</th>
                      <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("玩家", "Player")}</th>
                      <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("總分", "Total Score")}</th>
                      <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("通過內容數", "Passed")}</th>
                      <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("模式", "Mode")}</th>
                      <th style={{ padding: '1rem', borderBottom: '2px solid #e2e8f0' }}>{t("日期", "Date")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardData.map((record, index) => {
                      const formatModeName = (modeString) => {
                        if (!modeString || modeString.includes('未知')) return t('未知', 'Unknown');
                        let result = modeString;
                        result = result.replace(/square_solo/i, t('九宮格', 'Square'));
                        result = result.replace(/VerseRain/i, t('內容雨', 'ParagraphRain'));
                        result = result.replace(/rain/i, t('內容雨', 'ParagraphRain'));
                        result = result.replace(/VoiceMode/i, t('語音模式', 'Voice Mode'));
                        result = result.replace(/-dx(\d+)/i, (match, p1) => ` ${t('難度', 'Difficulty')} ${p1}`);
                        return result;
                      };
                      return (
                      <tr key={index} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '1rem', fontWeight: 'bold', color: index === 0 ? '#fbbf24' : index === 1 ? '#94a3b8' : index === 2 ? '#b45309' : '#64748b' }}>#{leaderboardPage * 10 + index + 1}</td>
                        <td style={{ padding: '1rem', fontWeight: 'bold', color: '#334155' }}>{record.name}</td>
                        <td style={{ padding: '1rem', color: '#f59e0b', fontWeight: 'bold' }}>{record.score}</td>
                        <td style={{ padding: '1rem', color: '#64748b' }}>{record.passedCount} / {record.totalCount}</td>
                        <td style={{ padding: '1rem', color: '#64748b' }}>{formatModeName(record.mode)}</td>
                        <td style={{ padding: '1rem', color: '#64748b', fontSize: '0.85rem' }}>{record.date ? new Date(record.date).toLocaleDateString() : ''}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
                  <button 
                    disabled={leaderboardPage === 0}
                    onClick={() => setLeaderboardPage(p => p - 1)}
                    style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: leaderboardPage === 0 ? '#f1f5f9' : '#ffffff', color: leaderboardPage === 0 ? '#94a3b8' : '#334155', cursor: leaderboardPage === 0 ? 'not-allowed' : 'pointer' }}
                  >
                    {t("上一頁", "Prev")}
                  </button>
                  <span style={{ color: '#64748b', fontSize: '0.9rem' }}>{t("第", "Page")} {leaderboardPage + 1} {t("頁", " ")} / {t("共", "Total")} {Math.ceil(leaderboardTotal / 10)} {t("頁", "Pages")}</span>
                  <button 
                    disabled={(leaderboardPage + 1) * 10 >= leaderboardTotal}
                    onClick={() => setLeaderboardPage(p => p + 1)}
                    style={{ padding: '0.5rem 1rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: (leaderboardPage + 1) * 10 >= leaderboardTotal ? '#f1f5f9' : '#ffffff', color: (leaderboardPage + 1) * 10 >= leaderboardTotal ? '#94a3b8' : '#334155', cursor: (leaderboardPage + 1) * 10 >= leaderboardTotal ? 'not-allowed' : 'pointer' }}
                  >
                    {t("下一頁", "Next")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      </div>{/* end RTL/font wrapper */}
    </>
  );
}
