// OAuth provider configuration.
//
// SETUP STEPS:
// ─── Google ─────────────────────────────────────────────────────────────────
//   1. Go to https://console.cloud.google.com/apis/credentials
//   2. Create project (or reuse existing) → "OAuth consent screen":
//        User Type: External; App name: VerseRain; Support email: hungry4grace@gmail.com
//        Authorized domains: verserain.com
//        Scopes: openid, email, profile
//   3. Credentials → "Create Credentials" → "OAuth client ID":
//        Application type: Web application
//        Authorized JavaScript origins:
//          https://verserain.com
//          https://www.verserain.com
//          http://localhost:5173
//          http://localhost:5177
//        Authorized redirect URIs: (leave empty — we use ID token flow, not redirect)
//   4. Copy the Client ID below.
//
// ─── Apple ──────────────────────────────────────────────────────────────────
//   Requires a paid Apple Developer account ($99/year).
//   1. https://developer.apple.com/account/resources/identifiers/list
//   2. Create an "App ID" first (e.g. com.verserain.web) and enable
//      "Sign In with Apple" capability.
//   3. Create a "Services ID" (e.g. com.verserain.web.signin):
//        - Enable Sign In with Apple
//        - Configure → primary App ID = the one above
//        - Domains: verserain.com, www.verserain.com
//        - Return URLs: https://verserain.com/  (must be HTTPS; trailing slash matters)
//   4. The Services ID becomes your APPLE_CLIENT_ID.
//
// ─── LINE ───────────────────────────────────────────────────────────────────
//   1. Go to https://developers.line.biz/console/
//   2. Create a Provider (e.g. "VerseRain") → Create a "LINE Login" channel:
//        Region: Taiwan; App types: Web app
//   3. Channel → "LINE Login" tab → Callback URL — add one per line:
//        https://www.verserain.com/
//        https://verserain.com/
//        http://localhost:5173/
//   4. Channel → "Basic settings" tab:
//        - Copy "Channel ID" into LINE_CHANNEL_ID below AND into
//          LINE_CHANNEL_ID in src/party/server.js (they must match).
//        - Copy "Channel secret" and store it server-side (NEVER here):
//            npx partykit env add LINE_CHANNEL_SECRET
//          then redeploy:  npx partykit deploy
//   5. Optional: Basic settings → OpenID Connect → apply for the "Email address
//      permission". Once approved, set LINE_REQUEST_EMAIL = true so LINE
//      accounts log in with their real email. Without it, accounts are keyed
//      on a synthetic line_<sub>@privaterelay.verserain.com address.
//
// After editing, redeploy. No secrets are stored here — these IDs are public.

export const GOOGLE_CLIENT_ID = '761845973381-2eqaapf2m64voq5gvod1vo5p48o1niua.apps.googleusercontent.com';

export const LINE_CHANNEL_ID = '2010381708';
export const LINE_REQUEST_EMAIL = false;  // only after LINE grants the email permission

// Kick off the LINE Login redirect flow. LINE has no popup JS SDK for plain
// web apps, so we navigate to the authorize page and LINE sends the user back
// to <origin>/?code=...&state=line_... — handled in App.jsx, which forwards
// the code to the PartyKit /oauth-login endpoint for the server-side token
// exchange (the channel secret never reaches the browser).
export function startLineLogin() {
  const state = 'line_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const redirectUri = window.location.origin + '/';
  sessionStorage.setItem('verserain_line_state', state);
  sessionStorage.setItem('verserain_line_redirect', redirectUri);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_CHANNEL_ID,
    redirect_uri: redirectUri,
    state,
    scope: 'profile openid' + (LINE_REQUEST_EMAIL ? ' email' : ''),
  });
  window.location.href = 'https://access.line.me/oauth2/v2.1/authorize?' + params.toString();
}

// Fill in after creating the Services ID in Apple Developer portal.
// Must match one of APPLE_CLIENT_IDS in src/party/server.js.
export const APPLE_CLIENT_ID = '';  // e.g. 'com.verserain.web.signin'
export const APPLE_REDIRECT_URI = (typeof window !== 'undefined' ? window.location.origin : '') + '/';

// Hash an OAuth provider's stable sub claim into a password the existing
// email/password backend can verify. The sub is opaque per-provider so we
// namespace it. This lets us reuse the existing /register and /login routes
// without modifying the PartyKit backend.
export async function deriveOAuthPassword(provider, sub) {
  const seed = `verserain-oauth-v1::${provider}::${sub}`;
  const bytes = new TextEncoder().encode(seed);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Decode a JWT payload (no signature verification — backend should verify in
// prod, but for our derived-password flow the sub binding is what matters).
export function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}
