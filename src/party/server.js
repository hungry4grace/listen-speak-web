// Opaque, stable per-account id for the personal-voice layer: sha256(email)
// prefix. Lets share links carry "whose voice" without exposing the email,
// and survives playerName changes. The client computes the same value.
async function voiceOwnerId(email) {
  const data = new TextEncoder().encode(String(email || '').toLowerCase().trim());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ─── Password storage ────────────────────────────────────────────────────
// Accounts used to store the password in cleartext and /forgot-password
// emailed it back. That meant anyone with storage access — or any future
// leak — held every user's actual password, and since people reuse
// passwords the blast radius reached well beyond VerseRain.
//
// Now: PBKDF2-SHA256, 16 random bytes of salt per account, serialised as
//   pbkdf2$<iterations>$<saltBase64>$<hashBase64>
// Cloudflare Workers ship crypto.subtle, so this needs no dependency.
// (argon2id/bcrypt would be stronger but neither runs natively there.)
//
// Legacy cleartext rows still verify — see verifyPassword — and each one is
// rewritten as a hash the next time its owner successfully logs in, so no
// forced reset is needed.
// Cloudflare Workers (which PartyKit runs on) caps PBKDF2 at 100,000
// iterations and throws above it — 210,000 made every register/login return
// 500 in production. The iteration count is stored per-hash, so this can be
// raised later without invalidating existing hashes if the cap ever lifts.
const PBKDF2_ITERATIONS = 100000;

const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Length-independent comparison, so a wrong password can't be narrowed down
// by timing how long the check took.
function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function isHashedPassword(stored) {
  return typeof stored === 'string' && stored.startsWith('pbkdf2$');
}

export async function hashPassword(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return `pbkdf2$${iterations}$${bytesToB64(salt)}$${bytesToB64(bits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || password == null || password === '') return false;
  // Legacy cleartext row — still accepted so existing users can log in; the
  // caller upgrades the record to a hash right after.
  if (!isHashedPassword(stored)) return timingSafeEqual(password, stored);
  const parts = String(stored).split('$');
  if (parts.length !== 4) return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  let salt;
  try { salt = b64ToBytes(parts[2]); } catch { return false; }
  const candidate = await hashPassword(password, salt, iterations);
  return timingSafeEqual(candidate, stored);
}

// Reset tokens are stored HASHED too (`reset:<sha256(token)>`), so a storage
// leak yields nothing usable — the raw token only ever exists in the email.
export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateResetToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export default class Server {
  constructor(room) {
    this.room = room;
    // In-memory state for this match
    this.state = {
      status: 'waiting', // waiting, playing, finished
      blocks: [], // The array of scramble block objects
      currentSeqIndex: 0,
      players: {}, // Map of connection.id -> { id, name, score, connected }
      host: null,
      hostName: null,
      matchType: null, // team, individual
      teamCount: 9,
      teams: this.getDefaultTeams(),
      teamResults: [],
      verseRef: null
    };
  }

  getDefaultTeams(count = 9) {
    const teams = [
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
    return teams.slice(0, Math.min(9, Math.max(2, Number(count) || 9)));
  }

  setTeamCount(count) {
    this.state.teamCount = Math.min(9, Math.max(2, Number(count) || 9));
    this.state.teams = this.getDefaultTeams(this.state.teamCount);
  }

  getPlayerColor(index) {
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    return colors[index % colors.length];
  }

  getTeamResults() {
    const teams = this.state.teams || this.getDefaultTeams();
    const results = teams.map(team => {
      const members = Object.values(this.state.players || {}).filter(p => p.teamId === team.id);
      const membersWithScores = members.map(player => {
        const scoreFromRounds = (this.state.campaignResults || []).reduce((sum, round) => {
          return sum + Math.max(0, round.scores?.[player.id] || 0);
        }, 0);
        return { ...player, totalScore: Math.max(scoreFromRounds, player.bestScore || 0, player.score || 0) };
      });
      const scoringMembers = membersWithScores.filter(p => (p.versesCompleted || 0) > 0 || p.isFinished || p.totalScore > 0);
      const totalScore = scoringMembers.reduce((sum, p) => sum + p.totalScore, 0);
      return {
        ...team,
        playerCount: members.length,
        scoringCount: scoringMembers.length,
        completedCount: members.filter(p => p.isFinished).length,
        totalScore,
        averageScore: scoringMembers.length > 0 ? Math.round(totalScore / scoringMembers.length) : 0
      };
    }).filter(team => team.playerCount > 0);

    return results.sort((a, b) => {
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
      return b.playerCount - a.playerCount;
    });
  }

  getPlayerTotalScore(playerId) {
    return (this.state.campaignResults || []).reduce((sum, round) => {
      return sum + Math.max(0, round.scores?.[playerId] || 0);
    }, 0);
  }

  canStartTeamGame() {
    const players = Object.values(this.state.players || {}).filter(p => p.connected);
    return players.some(p => p.teamId);
  }

  // --- Email Utility Function ---
  async sendEmail(to, subject, html) {
    const resendApiKey = this.room.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("Missing RESEND_API_KEY");
      return { success: false, error: "Missing Email API Key" };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: "VerseRain <noreply@verserain.com>",
          to: to,
          subject: subject,
          html: html
        })
      });
      const data = await response.json();
      if (response.ok) return { success: true, data };
      console.error("Resend API Error", data);
      return { success: false, error: data.message || "Failed to send email" };
    } catch (e) {
      console.error("Email fetch error", e);
      return { success: false, error: e.message };
    }
  }

  // ─── OAuth ID Token verification ────────────────────────────────────────────
  // Verifies a Google ID token end-to-end: signature, issuer, audience, expiry,
  // and email_verified. Returns the decoded payload on success or null on any
  // failure. Never trusts an unverified JWT body — Google's RSA signature is
  // the only thing that proves the token wasn't forged by an attacker.

  // Module-level cache for Google's JWKS (~1h TTL).
  static _googleJwksCache = null;
  static _googleJwksCacheAt = 0;

  // Allowed Google OAuth Client IDs. Tokens whose `aud` (and `azp` for access
  // tokens) doesn't match one of these are rejected — otherwise an attacker
  // could log in as anyone using a token they minted in their own OAuth app.
  //   [0] Web client used by https://verserain.com
  //   [1] iOS client used by the VerseRain iOS app (Bundle ID
  //       com.hopeofglory.verserain). Fill in after creating the iOS OAuth
  //       client in Google Cloud Console.
  static GOOGLE_CLIENT_IDS = [
    "761845973381-2eqaapf2m64voq5gvod1vo5p48o1niua.apps.googleusercontent.com", // web
    "761845973381-2gakrrvbmtqg66ds3uo5dscdleggevml.apps.googleusercontent.com"  // iOS
  ].filter(Boolean);

  // Convenience alias for code that only needs to refer to the primary one.
  static get GOOGLE_CLIENT_ID() { return this.GOOGLE_CLIENT_IDS[0]; }

  async fetchGoogleJwks() {
    const now = Date.now();
    if (Server._googleJwksCache && now - Server._googleJwksCacheAt < 60 * 60 * 1000) {
      return Server._googleJwksCache;
    }
    const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!res.ok) return null;
    const jwks = await res.json();
    Server._googleJwksCache = jwks;
    Server._googleJwksCacheAt = now;
    return jwks;
  }

  base64UrlToUint8Array(b64u) {
    const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  base64UrlDecodeJson(b64u) {
    const bytes = this.base64UrlToUint8Array(b64u);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  }

  // Validate a Google access token by calling tokeninfo + userinfo. tokeninfo
  // tells us which client_id and scopes the token was issued for; userinfo
  // gives us the user's verified email. Both succeed only for live tokens
  // from Google.
  async verifyGoogleAccessToken(accessToken) {
    try {
      // 1. tokeninfo confirms the audience (which OAuth client issued it)
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
      );
      if (!tokenInfoRes.ok) return null;
      const tokenInfo = await tokenInfoRes.json();
      const allowedIds = Server.GOOGLE_CLIENT_IDS;
      if (!allowedIds.includes(tokenInfo.aud) && !allowedIds.includes(tokenInfo.azp)) {
        return null;
      }
      if (tokenInfo.expires_in && Number(tokenInfo.expires_in) <= 0) return null;

      // 2. userinfo gives us the email + sub + name
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!userInfoRes.ok) return null;
      const userInfo = await userInfoRes.json();
      if (!userInfo.email) return null;
      if (userInfo.email_verified === false) return null;
      return userInfo; // { sub, email, email_verified, name, given_name, picture }
    } catch (e) {
      console.error("Google access token verify failed", e);
      return null;
    }
  }

  // ─── Apple Sign In ──────────────────────────────────────────────────────────
  // Apple's ID token is a JWT signed with one of the keys at
  // https://appleid.apple.com/auth/keys. `iss` is "https://appleid.apple.com",
  // `aud` is either the Services ID (web flow) or the iOS app's Bundle ID
  // (native flow). `email` is only present the FIRST time the user signs in
  // unless they re-enable name/email sharing in Settings → Apple ID → Sign In
  // With Apple — we deal with that in the /oauth-login handler.
  static _appleJwksCache = null;
  static _appleJwksCacheAt = 0;

  //   [0] Web client — Services ID created in Apple Developer portal
  //   [1] iOS client — Bundle ID of the native iOS app
  static APPLE_CLIENT_IDS = [
    "com.verserain.web.signin",     // web Services ID — update if you used a different one
    "com.hopeofglory.verserain"     // iOS Bundle ID
  ].filter(Boolean);

  async fetchAppleJwks() {
    const now = Date.now();
    if (Server._appleJwksCache && now - Server._appleJwksCacheAt < 60 * 60 * 1000) {
      return Server._appleJwksCache;
    }
    const res = await fetch("https://appleid.apple.com/auth/keys");
    if (!res.ok) return null;
    const jwks = await res.json();
    Server._appleJwksCache = jwks;
    Server._appleJwksCacheAt = now;
    return jwks;
  }

  async verifyAppleIdToken(idToken) {
    try {
      const parts = String(idToken || "").split(".");
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, signatureB64] = parts;

      const header = this.base64UrlDecodeJson(headerB64);
      const payload = this.base64UrlDecodeJson(payloadB64);
      if (!header || !payload) return null;

      const jwks = await this.fetchAppleJwks();
      if (!jwks || !Array.isArray(jwks.keys)) return null;
      const jwk = jwks.keys.find(k => k.kid === header.kid && k.kty === "RSA");
      if (!jwk) return null;

      const publicKey = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg || "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );

      const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const signature = this.base64UrlToUint8Array(signatureB64);
      const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, data);
      if (!valid) return null;

      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) return null;
      if (payload.iss !== "https://appleid.apple.com") return null;
      if (!Server.APPLE_CLIENT_IDS.includes(payload.aud)) return null;
      // Apple omits `email` after the first sign-in. The `sub` claim is the
      // stable user identifier, so we accept tokens without an email — the
      // /oauth-login handler synthesizes a fallback email from sub in that case.
      if (payload.email_verified === false || payload.email_verified === "false") return null;

      return payload;
    } catch (e) {
      console.error("Apple ID token verify failed", e);
      return null;
    }
  }

  // ─── LINE Login ─────────────────────────────────────────────────────────────
  // LINE uses the plain OAuth2 authorization-code flow: the web client
  // redirects to access.line.me and comes back with ?code=..., which it hands
  // to /oauth-login. We exchange the code for tokens here because that step
  // needs the channel secret (set with: npx partykit env add LINE_CHANNEL_SECRET),
  // then validate the returned id_token through LINE's verify endpoint, which
  // checks signature/expiry and echoes back the decoded claims.
  // Must match LINE_CHANNEL_ID in src/oauthConfig.js.
  static LINE_CHANNEL_ID = "2010381708";

  async verifyLineCode(code, redirectUri) {
    try {
      const secret = this.room.env.LINE_CHANNEL_SECRET;
      if (!secret || !Server.LINE_CHANNEL_ID) {
        console.error("LINE login not configured (LINE_CHANNEL_SECRET / LINE_CHANNEL_ID)");
        return null;
      }
      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: String(code || ""),
          redirect_uri: String(redirectUri || ""),
          client_id: Server.LINE_CHANNEL_ID,
          client_secret: String(secret),
        }),
      });
      if (!tokenRes.ok) {
        console.error("LINE token exchange failed", tokenRes.status, await tokenRes.text().catch(() => ""));
        return null;
      }
      const tokens = await tokenRes.json();
      if (!tokens.id_token) return null;

      const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          id_token: tokens.id_token,
          client_id: Server.LINE_CHANNEL_ID,
        }),
      });
      if (!verifyRes.ok) return null;
      const payload = await verifyRes.json(); // { iss, sub, aud, name, picture, email? }
      if (payload.iss !== "https://access.line.me") return null;
      if (payload.aud !== Server.LINE_CHANNEL_ID) return null;
      return payload;
    } catch (e) {
      console.error("LINE code verify failed", e);
      return null;
    }
  }

  async verifyGoogleIdToken(idToken) {
    try {
      const parts = String(idToken || "").split(".");
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, signatureB64] = parts;

      const header = this.base64UrlDecodeJson(headerB64);
      const payload = this.base64UrlDecodeJson(payloadB64);
      if (!header || !payload) return null;

      // Find the matching key by kid.
      const jwks = await this.fetchGoogleJwks();
      if (!jwks || !Array.isArray(jwks.keys)) return null;
      const jwk = jwks.keys.find(k => k.kid === header.kid && k.kty === "RSA");
      if (!jwk) return null;

      // Import the JWK as a verification key.
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg || "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );

      const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
      const signature = this.base64UrlToUint8Array(signatureB64);
      const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, data);
      if (!valid) return null;

      // Claim checks.
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) return null;
      if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") return null;
      if (!Server.GOOGLE_CLIENT_IDS.includes(payload.aud)) return null;
      if (!payload.email) return null;
      if (payload.email_verified === false) return null;

      return payload;
    } catch (e) {
      console.error("Google ID token verify failed", e);
      return null;
    }
  }

  // Move all data keyed by a (mutable) display name from oldName -> newName.
  //
  // playerName is NOT a stable identity (see the Teams note: identity is
  // email), yet garden + private-sets are still keyed by it for legacy
  // reasons. Renaming therefore used to orphan a user's progress under the
  // old name AND leave a stale duplicate on the leaderboard. This makes the
  // rename authoritative server-side so progress follows the account instead
  // of relying on the client's localStorage carrying it over (which breaks
  // across devices / in-app browsers). Merge semantics mirror the client:
  // per-verse max(stage, fruits); _activity merged per-day by max.
  async migratePlayerName(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    try {
      // --- garden:<name> ---
      const oldGarden = await this.room.storage.get(`garden:${oldName}`);
      if (oldGarden && typeof oldGarden === 'object') {
        const target = (await this.room.storage.get(`garden:${newName}`)) || {};
        const merged = { ...target };
        for (const [ref, entry] of Object.entries(oldGarden)) {
          if (ref === '_activity') continue;
          if (!merged[ref]) {
            merged[ref] = entry;
          } else {
            merged[ref] = {
              ...merged[ref],
              stage: Math.max(merged[ref].stage || 0, entry.stage || 0),
              fruits: Math.max(merged[ref].fruits || 0, entry.fruits || 0),
            };
          }
        }
        const act = { ...(target._activity || {}) };
        for (const [day, v] of Object.entries(oldGarden._activity || {})) {
          act[day] = Math.max(act[day] || 0, v || 0);
        }
        merged._activity = act;
        await this.room.storage.put(`garden:${newName}`, merged);
        await this.room.storage.delete(`garden:${oldName}`);
      }

      // --- private-sets:<name>[:...] (legacy blob + chunked per-set keys) ---
      const legacy = await this.room.storage.get(`private-sets:${oldName}`);
      if (legacy !== undefined) {
        if ((await this.room.storage.get(`private-sets:${newName}`)) === undefined) {
          await this.room.storage.put(`private-sets:${newName}`, legacy);
        }
        await this.room.storage.delete(`private-sets:${oldName}`);
      }
      const oldPrefix = `private-sets:${oldName}:`;
      const chunks = await this.room.storage.list({ prefix: oldPrefix });
      for (const [key, value] of chunks.entries()) {
        const tail = key.slice(oldPrefix.length);
        await this.room.storage.put(`private-sets:${newName}:${tail}`, value);
        await this.room.storage.delete(key);
      }
    } catch (e) {
      console.error("migratePlayerName failed", oldName, "->", newName, e);
    }
  }

  // --- HTTP Authentication API & Webhook Endpoints ---
  async onRequest(request) {
    // We only process auth requests on a dedicated "auth" room to keep the DB cohesive
    if (this.room.id === "global-auth-db" || request.url.includes("/global-auth-db/")) {
      // Handle preflight CORS logic for the browser frontend
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          }
        });
      }

      const corsHeaders = { "Access-Control-Allow-Origin": "*" };
      const url = new URL(request.url);

      // DAU day boundary. The audience is UTC+8 (Taiwan/HK), so we roll the
      // "day" at local midnight, not UTC midnight (which would be 8am local).
      // Accepts an epoch-ms arg so we can bucket a stored ISO createdAt too.
      const dauDay = (ms = Date.now()) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);

      if (request.method === "POST") {

        // 0. Presence / DAU ping. Fired once by the frontend on app load —
        // this is the ONLY reliable "opened the app today" signal, because
        // returning users restore a local session and never re-hit /login.
        // Identity: logged-in users are keyed by email ("u:"), guests by a
        // stable per-device id ("d:"). One key per (day, identity), idempotent.
        if (url.pathname.endsWith('/seen')) {
           try {
              const { deviceId, email } = await request.json().catch(() => ({}));
              const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
              const id = cleanEmail
                 ? 'u:' + cleanEmail
                 : (typeof deviceId === 'string' && deviceId.trim() ? 'd:' + deviceId.trim().slice(0, 64) : '');
              if (id) await this.room.storage.put(`dau:${dauDay()}:${id}`, Date.now());
              return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'seen failed' }), { status: 500, headers: corsHeaders });
           }
        }
        
        // 1. Skool Webhook Endpoint (From Zapier / Skool Platform)
        // Expected payload from Skool: { email: "user@example.com", name: "David" }
        if (url.pathname.endsWith('/skool-webhook')) {
           try {
              const payload = await request.json();
              const email = payload.email || (payload.member && payload.member.email);
              const name = payload.name || payload.first_name || (payload.member && payload.member.name) || "Premium Member";
              
              if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers: corsHeaders });
              
              let user = await this.room.storage.get(`user:${email.toLowerCase()}`);
              
              // If user exists, upgrade them. If not, create a "ghost" account that will be claimed when they register.
              if (user) {
                 user.isPremium = true;
                 user.skoolName = name;
                 await this.room.storage.put(`user:${email.toLowerCase()}`, user);
              } else {
                 await this.room.storage.put(`user:${email.toLowerCase()}`, { email: email.toLowerCase(), skoolName: name, isPremium: true, password: null });
              }
              
              return new Response(JSON.stringify({ success: true, message: 'Webhook processed' }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500, headers: corsHeaders });
           }
        }
        
        // 2. User Registration Endpoint
        if (url.pathname.endsWith('/register')) {
           try {
              const { email, password, nickname, inviter, personalCode } = await request.json();
              if (!email || !password) return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: corsHeaders });

              let user = await this.room.storage.get(`user:${email.toLowerCase()}`);

              // Handle conflict or claim ghost account
              if (user && user.password) {
                 return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409, headers: corsHeaders });
              }

              // Generate a 6-digit verification code
              const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

              // If a webhook already created a ghost record, we preserve `isPremium`
              const isPremium = user ? user.isPremium : false;
              const finalName = (user && user.skoolName) ? user.skoolName : (nickname || "Player");

              const newUserObj = { email: email.toLowerCase(), password: await hashPassword(password), name: finalName, isPremium, verificationCode, verified: false, createdAt: new Date().toISOString() };
              // Bind inviter (referral code from ?ref=) to this account so it
              // survives cross-device login — set once on creation only.
              const cleanInviter = typeof inviter === 'string' ? inviter.trim() : '';
              if (cleanInviter && !(user && user.invitedBy)) {
                 newUserObj.invitedBy = cleanInviter;
              } else if (user && user.invitedBy) {
                 newUserObj.invitedBy = user.invitedBy;
              }
              // Bind a canonical personalCode to the account so every device that
              // logs in reuses the SAME code (referral key + fruit-points key).
              // Without this, each browser/device generates its own random code
              // and reads a different referral-points bucket -> mismatched totals.
              const cleanPersonalCode = typeof personalCode === 'string' ? personalCode.trim() : '';
              if (user && user.personalCode) {
                 newUserObj.personalCode = user.personalCode; // preserve a ghost/existing binding
              } else if (cleanPersonalCode) {
                 newUserObj.personalCode = cleanPersonalCode;
              }
              await this.room.storage.put(`user:${email.toLowerCase()}`, newUserObj);
              
              // Send the OTP via email
              const emailHtml = `
                <div style="font-family: sans-serif; color: #333;">
                  <h2>歡迎加入 VerseRain！</h2>
                  <p>您的帳號驗證碼為：</p>
                  <h1 style="color: #3b82f6; letter-spacing: 5px;">${verificationCode}</h1>
                  <p>請在應用程式中輸入此驗證碼以啟用您的帳號。</p>
                </div>
              `;
              await this.sendEmail(email.toLowerCase(), "VerseRain 帳號驗證碼 (Account Verification)", emailHtml);
              
              return new Response(JSON.stringify({ success: true, message: 'Verification email sent' }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'Registration failed' }), { status: 500, headers: corsHeaders });
           }
        }

        // 2.5 Email Verification Endpoint
        if (url.pathname.endsWith('/verify-email')) {
           try {
              const { email, code, personalCode } = await request.json();
              if (!email || !code) return new Response(JSON.stringify({ error: 'Email and code required' }), { status: 400, headers: corsHeaders });

              let user = await this.room.storage.get(`user:${email.toLowerCase()}`);
              if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });

              if (user.verificationCode !== code && code !== "888888") { // Backdoor code for emergency override if needed
                 return new Response(JSON.stringify({ error: 'Invalid verification code' }), { status: 401, headers: corsHeaders });
              }

              user.verified = true;
              user.verificationCode = null; // Clear code after use
              // Bind the canonical personalCode here too, in case registration
              // didn't capture it (defensive — keeps every device on one code).
              const cleanVerifyCode = typeof personalCode === 'string' ? personalCode.trim() : '';
              if (!user.personalCode && cleanVerifyCode) {
                 user.personalCode = cleanVerifyCode;
              }
              await this.room.storage.put(`user:${email.toLowerCase()}`, user);

              return new Response(JSON.stringify({ success: true, user: { email: user.email, name: user.name, isPremium: user.isPremium, personalCode: user.personalCode || null } }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 500, headers: corsHeaders });
           }
        }

        // 3. User Login Endpoint
        if (url.pathname.endsWith('/login')) {
           try {
              const { email, password, inviter, personalCode } = await request.json();
              if (!email || !password) return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: corsHeaders });

              let user = await this.room.storage.get(`user:${email.toLowerCase()}`);

              if (!user || !(await verifyPassword(password, user.password))) {
                 return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers: corsHeaders });
              }

              // Enforce verification only if a verification code exists. (Allows old users without this flag to still login).
              if (user.verified === false) {
                 return new Response(JSON.stringify({ error: '請先驗證您的電子郵件 (Please verify your email first)', requiresVerification: true }), { status: 403, headers: corsHeaders });
              }

              let dirty = false;

              // Transparent upgrade: this account still held a cleartext
              // password and the owner just proved they know it, so replace it
              // with a hash right here. Every active account migrates itself on
              // next login — no forced reset, no migration script.
              //
              // Deliberately non-fatal: the credential has ALREADY been
              // verified at this point, so a hashing failure must never turn a
              // valid login into a 500. (It did exactly that in production when
              // the iteration count exceeded the Workers cap — the account
              // simply stays cleartext and migrates on a later login.)
              if (!isHashedPassword(user.password)) {
                 try {
                    user.password = await hashPassword(password);
                    dirty = true;
                 } catch (hashErr) {
                    console.error('password upgrade failed; leaving row as-is', hashErr);
                 }
              }

              // Late-bind inviter if a returning user logs in from a new
              // device with a ?ref= link in the URL and we never recorded it.
              const cleanInviter = typeof inviter === 'string' ? inviter.trim() : '';
              if (cleanInviter && !user.invitedBy) {
                 user.invitedBy = cleanInviter;
                 dirty = true;
              }

              // Late-bind personalCode for legacy accounts created before codes
              // were stored server-side. The FIRST device to log in donates its
              // local code as the canonical one; thereafter every device reuses
              // it (returned below), so referral/fruit keys line up everywhere.
              const cleanPersonalCode = typeof personalCode === 'string' ? personalCode.trim() : '';
              if (!user.personalCode && cleanPersonalCode) {
                 user.personalCode = cleanPersonalCode;
                 dirty = true;
              }

              if (dirty) {
                 await this.room.storage.put(`user:${email.toLowerCase()}`, user);
              }

              return new Response(JSON.stringify({ success: true, user: { email: user.email, name: user.name, isPremium: user.isPremium, invitedBy: user.invitedBy || null, personalCode: user.personalCode || null } }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'Login failed' }), { status: 500, headers: corsHeaders });
           }
        }

        // 3.2. OAuth Login (Google / Apple / LINE).
        // Verifies the provider credential on the server, then matches or
        // auto-creates a user by email. No password is required because the
        // OAuth provider has already verified the email. Three credential
        // shapes are accepted:
        //   { idToken }      — Google "One Tap" / Apple Sign-In JWT we verify
        //                      against the provider's public keys.
        //   { accessToken }  — Google access token from the popup OAuth flow;
        //                      we verify it by calling Google's userinfo
        //                      endpoint, which only succeeds if the token is
        //                      live and was issued to OUR client_id (since
        //                      we never share it with another party).
        //   { code, redirectUri } — LINE authorization code from the redirect
        //                      flow; we exchange it using the channel secret
        //                      and verify the resulting id_token.
        if (url.pathname.endsWith('/oauth-login')) {
           try {
              const body = await request.json();
              const { provider, idToken, accessToken, code, redirectUri, inviter } = body;
              if (!provider || (!idToken && !accessToken && !code)) {
                 return new Response(JSON.stringify({ error: 'provider and credential required' }), { status: 400, headers: corsHeaders });
              }

              let payload = null;
              if (provider === 'google') {
                 if (idToken) {
                    payload = await this.verifyGoogleIdToken(idToken);
                 } else if (accessToken) {
                    payload = await this.verifyGoogleAccessToken(accessToken);
                 }
              } else if (provider === 'apple') {
                 if (idToken) {
                    payload = await this.verifyAppleIdToken(idToken);
                 }
              } else if (provider === 'line') {
                 // { code, redirectUri } — authorization code from the LINE
                 // redirect flow; exchanged + verified server-side.
                 if (code) {
                    payload = await this.verifyLineCode(code, redirectUri);
                 }
              } else {
                 return new Response(JSON.stringify({ error: 'Unsupported OAuth provider' }), { status: 400, headers: corsHeaders });
              }

              if (!payload) {
                 return new Response(JSON.stringify({ error: 'Invalid OAuth token' }), { status: 401, headers: corsHeaders });
              }

              const sub = payload.sub;
              if (!sub) {
                 return new Response(JSON.stringify({ error: 'OAuth token missing sub' }), { status: 401, headers: corsHeaders });
              }
              // Apple drops `email` after the first sign-in, so the client may
              // pass it alongside the idToken on first registration. If we
              // still have no email, fall back to a stable private-relay-style
              // address keyed on sub so the account row has a unique key.
              let email = String(payload.email || body.email || '').toLowerCase().trim();
              if (!email && provider === 'apple') {
                 email = `apple_${sub}@privaterelay.verserain.com`;
              }
              // LINE only returns an email once the channel is granted the
              // email permission — until then, key the account on sub.
              if (!email && provider === 'line') {
                 email = `line_${sub}@privaterelay.verserain.com`;
              }
              if (!email) {
                 return new Response(JSON.stringify({ error: 'OAuth token missing email' }), { status: 401, headers: corsHeaders });
              }
              const displayName = payload.name || payload.given_name || body.name || email.split('@')[0];

              // Bind inviter (referral code from ?ref=) to this account so it
              // survives cross-device login — set once, never overwrite.
              const cleanInviter = typeof inviter === 'string' ? inviter.trim() : '';

              let user = await this.room.storage.get(`user:${email}`);
              if (!user) {
                 // First-time OAuth user — auto-create as verified.
                 user = {
                    email,
                    password: null,
                    name: displayName,
                    isPremium: false,
                    verified: true,
                    oauthProvider: provider,
                    oauthSub: sub,
                    createdAt: new Date().toISOString()
                 };
                 if (cleanInviter) user.invitedBy = cleanInviter;
                 await this.room.storage.put(`user:${email}`, user);
              } else {
                 // Existing user — record OAuth identity so future logins can
                 // be tracked, mark as verified (Google already verified the
                 // email so old unverified accounts can finish onboarding),
                 // but never overwrite their existing password or display name.
                 let dirty = false;
                 if (!user.verified) { user.verified = true; user.verificationCode = null; dirty = true; }
                 if (!user.oauthProvider) { user.oauthProvider = provider; dirty = true; }
                 if (!user.oauthSub) { user.oauthSub = sub; dirty = true; }
                 if (cleanInviter && !user.invitedBy) { user.invitedBy = cleanInviter; dirty = true; }
                 if (dirty) await this.room.storage.put(`user:${email}`, user);
              }

              return new Response(JSON.stringify({
                 success: true,
                 user: {
                    email: user.email,
                    name: user.name || displayName,
                    isPremium: user.isPremium || false,
                    city: user.city,
                    country: user.country,
                    invitedBy: user.invitedBy || null
                 }
              }), { status: 200, headers: corsHeaders });
           } catch (e) {
              console.error("OAuth login failed", e);
              return new Response(JSON.stringify({ error: 'OAuth login failed' }), { status: 500, headers: corsHeaders });
           }
        }

        // 3.5. Update Profile
        if (url.pathname.endsWith('/update-profile')) {
           try {
              const { email, password, newPassword, newName, newCity, newCountry, authProvider } = await request.json();
              if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers: corsHeaders });

              let user = await this.room.storage.get(`user:${email.toLowerCase()}`);
              if (!user) return new Response(JSON.stringify({ error: '帳號不存在 (account not found)' }), { status: 404, headers: corsHeaders });

              // Skip the password step for OAuth (Google/Apple/LINE) profile edits.
              // Two signals mean "no password needed": the stored record is already
              // an OAuth account (oauthProvider set, or password:null), OR the
              // request comes from an OAuth session (the client sends authProvider).
              // The latter covers accounts that predate oauthProvider or that also
              // have a password (a user who now signs in with LINE). These are
              // low-stakes fields (display name / city / country) and the password
              // is never changed on this path.
              const clientOAuth = typeof authProvider === 'string' && authProvider.trim() !== '';
              const isOAuthAccount = !!user.oauthProvider || user.password == null || clientOAuth;
              if (!isOAuthAccount) {
                 if (!password) return new Response(JSON.stringify({ error: 'Email and current password required' }), { status: 400, headers: corsHeaders });
                 if (!(await verifyPassword(password, user.password))) {
                    return new Response(JSON.stringify({ error: '密碼錯誤 (Invalid password)' }), { status: 401, headers: corsHeaders });
                 }
              }

              const oldName = user.name;
              // Password accounts only: set the chosen new password, or upgrade a
              // legacy cleartext row now that its owner has authenticated. OAuth
              // accounts don't use passwords, so leave user.password untouched.
              if (!isOAuthAccount) {
                 if (newPassword) user.password = await hashPassword(newPassword);
                 else if (!isHashedPassword(user.password)) user.password = await hashPassword(password);
              } else if (clientOAuth && !user.oauthProvider) {
                 // Self-heal: record the OAuth identity so this account is
                 // classified correctly (without the client hint) next time.
                 user.oauthProvider = authProvider.trim();
              }
              if (newName) user.name = newName;
              if (newCity !== undefined) user.city = newCity;
              if (newCountry !== undefined) user.country = newCountry;

              await this.room.storage.put(`user:${email.toLowerCase()}`, user);

              // Carry garden + private-sets to the new name so a rename never
              // orphans progress or duplicates the player on the leaderboard.
              if (newName && oldName && newName !== oldName) {
                 await this.migratePlayerName(oldName, newName);
              }

              // Never echo the credential field back to the client — this used
              // to return the cleartext password in the response body.
              const { password: _pw, verificationCode: _vc, ...safeUser } = user;
              return new Response(JSON.stringify({ success: true, user: safeUser }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'Update failed' }), { status: 500, headers: corsHeaders });
           }
        }

        // 3.6 Bind inviter — user finds out after the fact that they never
        // got bound (their ?ref= URL got stripped by an iOS deep-link or
        // similar), and wants to attach themselves to a referrer. Set-once
        // only — already-bound accounts can't change their referrer this
        // way (prevents griefing / late-attribution farming).
        if (url.pathname.endsWith('/bind-inviter') && request.method === 'POST') {
           try {
              const { email, inviter } = await request.json();
              const cleanEmail = String(email || '').toLowerCase().trim();
              const cleanInviter = String(inviter || '').trim();
              if (!cleanEmail || !cleanInviter) {
                 return new Response(JSON.stringify({ error: 'email and inviter required' }), { status: 400, headers: corsHeaders });
              }
              const user = await this.room.storage.get(`user:${cleanEmail}`);
              if (!user) {
                 return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });
              }
              if (user.invitedBy) {
                 return new Response(JSON.stringify({ success: true, invitedBy: user.invitedBy, alreadyBound: true }), { status: 200, headers: corsHeaders });
              }
              user.invitedBy = cleanInviter;
              await this.room.storage.put(`user:${cleanEmail}`, user);
              return new Response(JSON.stringify({ success: true, invitedBy: cleanInviter }), { status: 200, headers: corsHeaders });
           } catch (e) {
              return new Response(JSON.stringify({ error: 'Failed to bind inviter' }), { status: 500, headers: corsHeaders });
           }
        }

        // 3.8. Forgot Password
        if (url.pathname.endsWith('/forgot-password')) {
           try {
              const { email } = await request.json();
              if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400, headers: corsHeaders });
              
              let user = await this.room.storage.get(`user:${email.toLowerCase()}`);
              if (!user) return new Response(JSON.stringify({ error: '找不到此信箱，請確認是否輸入正確 (Email not found)' }), { status: 404, headers: corsHeaders });
              
              // Send a single-use reset LINK, never the password. Only the
              // sha256 of the token is stored, so a storage leak can't be
              // replayed into an account takeover.
              const token = generateResetToken();
              const tokenHash = await sha256Hex(token);
              const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
              await this.room.storage.put(`reset:${tokenHash}`, { email: email.toLowerCase(), expiresAt });

              const resetUrl = `https://www.verserain.com/?resetToken=${token}`;
              const emailHtml = `
                <div style="font-family: sans-serif; color: #333;">
                  <h2>VerseRain 重設密碼</h2>
                  <p>您好，${user.name || '玩家'}！</p>
                  <p>請點下面的按鈕設定新密碼。這個連結 <strong>30 分鐘內有效</strong>，且只能使用一次。</p>
                  <p style="margin: 24px 0;">
                    <a href="${resetUrl}" style="background: #3b82f6; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">設定新密碼</a>
                  </p>
                  <p style="font-size: 12px; color: #666;">按鈕無法點擊時，請複製這個網址到瀏覽器：<br>${resetUrl}</p>
                  <p style="font-size: 12px; color: #666;">如果不是您本人要求重設密碼，請忽略這封信，您的密碼不會有任何變動。</p>
                </div>
              `;
              const emailResult = await this.sendEmail(email.toLowerCase(), "VerseRain 重設密碼 (Reset your password)", emailHtml);

              if (!emailResult.success) {
                 return new Response(JSON.stringify({ error: '發送電子郵件失敗 (Failed to send email)' }), { status: 500, headers: corsHeaders });
              }

              return new Response(JSON.stringify({ success: true, message: 'Reset link sent to email' }), { status: 200, headers: corsHeaders });
           } catch(e) {
              return new Response(JSON.stringify({ error: 'System error processing request' }), { status: 500, headers: corsHeaders });
           }
        }

        // 5.1 Consume a reset link and set a new password. Single use: the
        // token record is deleted whether or not the write succeeds, so a
        // leaked link can never be replayed.
        if (url.pathname.endsWith('/reset-password')) {
           try {
              const { token, newPassword } = await request.json();
              if (!token || !newPassword) {
                 return new Response(JSON.stringify({ error: '缺少參數 (Token and new password required)' }), { status: 400, headers: corsHeaders });
              }
              if (String(newPassword).length < 6) {
                 return new Response(JSON.stringify({ error: '密碼至少需要 6 個字元 (Password must be at least 6 characters)' }), { status: 400, headers: corsHeaders });
              }

              const tokenHash = await sha256Hex(token);
              const record = await this.room.storage.get(`reset:${tokenHash}`);
              if (!record) {
                 return new Response(JSON.stringify({ error: '連結無效或已使用過 (Invalid or already-used link)' }), { status: 400, headers: corsHeaders });
              }
              await this.room.storage.delete(`reset:${tokenHash}`);
              if (!record.expiresAt || Date.now() > record.expiresAt) {
                 return new Response(JSON.stringify({ error: '連結已過期，請重新申請 (Link expired — please request a new one)' }), { status: 400, headers: corsHeaders });
              }

              const user = await this.room.storage.get(`user:${record.email}`);
              if (!user) {
                 return new Response(JSON.stringify({ error: '找不到帳號 (Account not found)' }), { status: 404, headers: corsHeaders });
              }
              user.password = await hashPassword(newPassword);
              // Proving control of the mailbox also settles verification.
              user.verified = true;
              user.verificationCode = null;
              await this.room.storage.put(`user:${record.email}`, user);

              return new Response(JSON.stringify({
                 success: true,
                 user: { email: user.email, name: user.name, isPremium: user.isPremium, personalCode: user.personalCode || null }
              }), { status: 200, headers: corsHeaders });
           } catch {
              return new Response(JSON.stringify({ error: 'System error processing request' }), { status: 500, headers: corsHeaders });
           }
        }

      }

      const isCustomSetWriteAuthorized = () => {
        const configuredToken = this.room.env.ADMIN_TOKEN || this.room.env.PARTYKIT_ADMIN_TOKEN;
        if (!configuredToken) return false;
        const authHeader = request.headers.get("authorization") || "";
        const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
          ? authHeader.slice(7).trim()
          : "";
        const xAdminToken = request.headers.get("x-admin-token") || "";
        const xApiKey = request.headers.get("x-api-key") || "";
        return bearerToken === configuredToken || xAdminToken === configuredToken || xApiKey === configuredToken;
      };
      const isTrustedAdminEmail = (email = "") => {
        const normalized = String(email || "").trim().toLowerCase();
        if (!normalized) return false;
        return [
          "samhsiung@gmail.com",
          "davidhwang1125@gmail.com",
          "hsiungsam@gmail.com",
          "hungry4grace@gmail.com",
          "verserain.admin@gmail.com"
        ].includes(normalized);
      };
      const isTrustedAdminName = (name = "") => {
        const normalized = String(name || "").trim().toLowerCase();
        if (!normalized) return false;
        return ["hungry@g", "hungry@me", "verserain", "admin"].includes(normalized);
      };

      // 3.95 台語漢字本 chapter proxy — the source site (lingshyang.com) has
      // no CORS headers and no API, so the browser can't fetch it directly.
      // We fetch + parse server-side and cache the parsed chapter in storage
      // (a chapter is a few KB — far under the 128KB key limit).
      // GET /taibible?book=<1-66>&chapter=<n> → { success, verses: {n: text} }
      if (url.pathname.endsWith('/taibible') && request.method === 'GET') {
        const TAI_BOOK_CODES = ['gen','exo','lev','num','deu','jos','jug','rut','1sa','2sa','1ki','2ki','1ch','2ch','ezr','neh','est','job','psm','pro','ecc','son','isa','jer','lam','eze','dan','hos','joe','amo','oba','jon','mic','nah','hab','zep','hag','zec','mal','mat','mak','luk','jhn','act','rom','1co','2co','gal','eph','phl','col','1ts','2ts','1ti','2ti','tit','mon','heb','jas','1pe','2pe','1jn','2jn','3jn','jud','rev'];
        // Rare Taiwanese characters the site renders as <img> glyphs.
        const TAI_GLYPHS = { boe:'袂', in:'𪜶', tiam:'踮', tiau:'牢', gau:'賢', hiat:'㧒', ki:'基', lo:'路', ko:'哥', lut:'甪', moa:'幔', nit:'躡', nith:'躡', nih:'躡', oh:'僫', poa:'盤', sui:'遂', teh:'啲', teng:'碇', thang:'迵', thoa:'豸', thun:'踐', ti:'蹬', to:'杜', tok:'度', phoe:'頰', chhih:'匆', tioh:'著', chong:'傱' };
        try {
          const bookId = parseInt(url.searchParams.get('book') || '', 10);
          const chapter = parseInt(url.searchParams.get('chapter') || '', 10);
          if (!(bookId >= 1 && bookId <= 66) || !(chapter >= 1 && chapter <= 176)) {
            return new Response(JSON.stringify({ error: 'book (1-66) + chapter required' }), { status: 400, headers: corsHeaders });
          }
          const cacheKey = `taibible:${bookId}:${chapter}`;
          const cached = await this.room.storage.get(cacheKey);
          if (cached) {
            return new Response(JSON.stringify({ success: true, verses: cached }), { status: 200, headers: corsHeaders });
          }
          const code = TAI_BOOK_CODES[bookId - 1];
          const res = await fetch(`https://lingshyang.com/taiwan_Bible/${code}/${code}${chapter}.htm`);
          if (!res.ok) {
            return new Response(JSON.stringify({ error: `source HTTP ${res.status}` }), { status: 502, headers: corsHeaders });
          }
          let html = await res.text();
          html = html.replace(/<img\s[^>]*src="\.\.\/([a-z0-9]+)\.jpg"[^>]*\/?>/gi, (_, name) => TAI_GLYPHS[name] || '');
          const verses = {};
          const re = new RegExp(`${chapter}:(\\d+)\\s*</font>\\s*<td[^>]*>([\\s\\S]*?)(?=<tr>|</table>|</TABLE>|$)`, 'g');
          let m;
          while ((m = re.exec(html)) !== null) {
            const text = m[2]
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/\s+/g, '')
              // Drop inline POJ pronunciation glosses + stray latin debris.
              .replace(/[（(][^（()）]*[A-Za-zÀ-ɏ][^（()）]*[）)]/g, '')
              .replace(/[（(][A-Za-zÀ-ɏ·ⁿ\-\s]+/g, '')
              .replace(/[A-Za-zÀ-ɏõ]+/g, '')
              .trim();
            if (text) verses[parseInt(m[1], 10)] = text;
          }
          if (Object.keys(verses).length === 0) {
            return new Response(JSON.stringify({ error: 'no verses parsed' }), { status: 502, headers: corsHeaders });
          }
          await this.room.storage.put(cacheKey, verses);
          return new Response(JSON.stringify({ success: true, verses }), { status: 200, headers: corsHeaders });
        } catch (e) {
          return new Response(JSON.stringify({ error: 'taibible fetch failed' }), { status: 500, headers: corsHeaders });
        }
      }

      // 3.9 View Counts Endpoint
      if (url.pathname.endsWith('/custom-sets/view')) {
         try {
            if (request.method === "POST") {
               const { id } = await request.json();
               if (!id) return new Response(JSON.stringify({ error: 'ID required' }), { status: 400, headers: corsHeaders });
               let c = await this.room.storage.get(`views:${id}`) || 0;
               await this.room.storage.put(`views:${id}`, c + 1);
               return new Response(JSON.stringify({ success: true, views: c + 1 }), { status: 200, headers: corsHeaders });
            }
            if (request.method === "GET") {
               const list = await this.room.storage.list({ prefix: "views:" });
               const views = Object.fromEntries(list.entries());
               return new Response(JSON.stringify(views), { status: 200, headers: corsHeaders });
            }
         } catch(e) {
            return new Response(JSON.stringify({ error: 'System error' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4. Published Custom Verse Sets Endpoint
      if (url.pathname.endsWith('/custom-sets')) {
         try {
            if (request.method === "GET") {
               const list = await this.room.storage.list({ prefix: "verseset:" });
               const sets = Array.from(list.values());
               return new Response(JSON.stringify(sets), { status: 200, headers: corsHeaders });
            } else if (request.method === "POST") {
               // Publishing is open to any logged-in user (owner-protected):
               // a set id can only be overwritten by its original publisher's
               // email, or by an admin. This lets creators like Bene publish
               // without being on the admin whitelist while preventing
               // strangers from overwriting someone else's published set.
               const payload = await request.json();
               const isAdmin = isCustomSetWriteAuthorized() || isTrustedAdminEmail(payload?.adminEmail) || isTrustedAdminName(payload?.adminName);
               const requesterEmail = String(payload?.adminEmail || '').trim().toLowerCase();
               if (!payload?.id) {
                  return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
               }
               const existing = await this.room.storage.get(`verseset:${payload.id}`);
               if (!isAdmin) {
                  if (!requesterEmail) {
                     return new Response(JSON.stringify({ error: 'Login required to publish' }), { status: 403, headers: corsHeaders });
                  }
                  // Non-admins may create NEW sets or update sets they own.
                  // Legacy sets without ownerEmail are treated as admin-owned.
                  if (existing && existing.ownerEmail !== requesterEmail) {
                     return new Response(JSON.stringify({ error: 'Only the original publisher can update this set' }), { status: 403, headers: corsHeaders });
                  }
               }
               if (existing && existing.authorName && existing.authorName !== "Anonymous") {
                  payload.authorName = existing.authorName;
               }
               if (payload.lastEditorName) {
                  payload.lastEditedAt = payload.lastEditedAt || new Date().toISOString();
               }
               // Bind ownership on first publish; preserve it on updates.
               payload.ownerEmail = existing?.ownerEmail || requesterEmail || '';
               await this.room.storage.put(`verseset:${payload.id}`, payload);
               return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            } else if (request.method === "DELETE") {
               const { id, adminEmail, adminName } = await request.json();
               const isAdmin = isCustomSetWriteAuthorized() || isTrustedAdminEmail(adminEmail) || isTrustedAdminName(adminName);
               if (!isAdmin) {
                  const requesterEmail = String(adminEmail || '').trim().toLowerCase();
                  const existing = await this.room.storage.get(`verseset:${id}`);
                  // Unpublish is allowed for the set's own publisher.
                  if (!existing) {
                     return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
                  }
                  if (!requesterEmail || existing.ownerEmail !== requesterEmail) {
                     return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
                  }
               }
               await this.room.storage.delete(`verseset:${id}`);
               return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
            }
         } catch(e) {
            return new Response(JSON.stringify({ error: 'DB error' }), { status: 500, headers: corsHeaders });
         }
      }


      // 4.7 Web Push subscriptions — per-user. The frontend hands us the
      // PushSubscription JSON (endpoint + keys) plus the user's IANA
      // timezone. The hourly GitHub Actions cron pulls the full list,
      // figures out which users it's currently 7am for, and sends the
      // notifications via the web-push library outside this room.
      if (url.pathname.endsWith('/save-push-subscription') && request.method === 'POST') {
         try {
            const body = await request.json();
            const { playerName, email, subscription, timezone, version, hour } = body;
            if (!playerName || !subscription || !subscription.endpoint) {
               return new Response(JSON.stringify({ error: 'playerName + subscription required' }), { status: 400, headers: corsHeaders });
            }
            // Use the subscription endpoint URL as the storage key so the same
            // device updating its subscription doesn't create duplicates.
            const id = subscription.endpoint;
            await this.room.storage.put(`push:${id}`, {
               playerName,
               email: email || '',
               subscription,
               timezone: timezone || 'Asia/Taipei',
               version: version || 'cuv',
               hour: typeof hour === 'number' ? hour : 7,
               updatedAt: new Date().toISOString(),
            });
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to save subscription' }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/delete-push-subscription') && request.method === 'POST') {
         try {
            const { playerName, endpoint } = await request.json();
            if (endpoint) {
               // Targeted delete by endpoint (most precise).
               await this.room.storage.delete(`push:${endpoint}`);
            } else if (playerName) {
               // Fallback: wipe every subscription registered under this player.
               const list = await this.room.storage.list({ prefix: 'push:' });
               for (const [key, val] of list.entries()) {
                  if (val?.playerName === playerName) await this.room.storage.delete(key);
               }
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to delete subscription' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /push-subscriptions — returns ALL subscriptions for the cron
      // sender. Requires the admin token (same token used to publish to
      // the global custom-sets list) so random fetchers can't enumerate.
      if (url.pathname.endsWith('/push-subscriptions') && request.method === 'GET') {
         try {
            if (!isCustomSetWriteAuthorized()) {
               return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
            }
            const list = await this.room.storage.list({ prefix: 'push:' });
            const subscriptions = Array.from(list.values());
            return new Response(JSON.stringify({ success: true, subscriptions }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to list subscriptions' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4.8 APNs device tokens — the native iOS app's counterpart to the
      // Web Push subscriptions above. The App Store wrapper can't do Web
      // Push (WKWebView has no PushManager), so it registers with Apple
      // for remote notifications and uploads its device token here. The
      // same hourly cron that sends Web Push also reads /apns-tokens and
      // delivers the daily verse through Apple's push service.
      if (url.pathname.endsWith('/save-apns-token') && request.method === 'POST') {
         try {
            const body = await request.json();
            const { playerName, email, token, timezone, version, hour } = body;
            if (!playerName || !token || typeof token !== 'string') {
               return new Response(JSON.stringify({ error: 'playerName + token required' }), { status: 400, headers: corsHeaders });
            }
            // Device token as the key — iOS can rotate tokens, and the app
            // re-uploads on every launch, so the newest row always wins and
            // a rotated token simply becomes a new row (the stale one gets
            // cleaned up when APNs returns 410 for it).
            await this.room.storage.put(`apns:${token}`, {
               playerName,
               email: email || '',
               token,
               timezone: timezone || 'Asia/Taipei',
               version: version || 'cuv',
               hour: typeof hour === 'number' ? hour : 7,
               updatedAt: new Date().toISOString(),
            });
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to save APNs token' }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/delete-apns-token') && request.method === 'POST') {
         try {
            const { token, playerName } = await request.json();
            if (token) {
               await this.room.storage.delete(`apns:${token}`);
            } else if (playerName) {
               const list = await this.room.storage.list({ prefix: 'apns:' });
               for (const [key, val] of list.entries()) {
                  if (val?.playerName === playerName) await this.room.storage.delete(key);
               }
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to delete APNs token' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /apns-tokens — cron-only, same admin gate as /push-subscriptions.
      if (url.pathname.endsWith('/apns-tokens') && request.method === 'GET') {
         try {
            if (!isCustomSetWriteAuthorized()) {
               return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });
            }
            const list = await this.room.storage.list({ prefix: 'apns:' });
            const tokens = Array.from(list.values());
            return new Response(JSON.stringify({ success: true, tokens }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list APNs tokens' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4.10 Verse-set creator voices — 題庫創作者親聲朗讀. The set's creator
      // records individual verses; listeners hear the creator's voice instead
      // of TTS. Keyed by (setId, reference) — the SAME verse (e.g. John 1:1)
      // in DIFFERENT sets carries independent recordings. One recording per
      // (set, verse); re-recording replaces, but only the original recorder's
      // email may replace (so strangers can't overwrite a creator's voice).
      // Audio chunks are stored under `set-voice:<setId>:<voiceId>:<idx>`,
      // using a content-addressed chunk pipeline. refKey = encodeURIComponent
      // of the verse reference so ':' in references can't break key parsing.

      // POST /sets/verse-voice/chunk — { email, setId, voiceId, index, total, data }
      if (url.pathname.endsWith('/sets/verse-voice/chunk') && request.method === 'POST') {
         try {
            const { email, setId, voiceId, index, total, data } = await request.json();
            if (!email || !setId || !voiceId) return new Response(JSON.stringify({ error: 'email, setId, voiceId required' }), { status: 400, headers: corsHeaders });
            const idx = Number(index), tot = Number(total);
            if (!Number.isInteger(idx) || !Number.isInteger(tot) || idx < 0 || tot < 1 || idx >= tot) return new Response(JSON.stringify({ error: 'bad chunk index' }), { status: 400, headers: corsHeaders });
            // 120 chunks ≈ 27 min at 48kbps opus — long-scripture readings
            // chunk automatically; this cap is an abuse guard, not a UX limit.
            if (tot > 120) return new Response(JSON.stringify({ error: 'too many chunks (max 120)' }), { status: 400, headers: corsHeaders });
            if (typeof data !== 'string' || !data || data.length > 110000) return new Response(JSON.stringify({ error: 'bad chunk data' }), { status: 400, headers: corsHeaders });
            if (!/^v_[A-Za-z0-9]{6,20}$/.test(voiceId)) return new Response(JSON.stringify({ error: 'bad voiceId' }), { status: 400, headers: corsHeaders });
            await this.room.storage.put(`set-voice:${String(setId)}:${voiceId}:${idx}`, data);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to save voice chunk' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/verse-voice/set — { email, setId, reference, voiceId, voiceMime, voiceDur, recordedBy }
      if (url.pathname.endsWith('/sets/verse-voice/set') && request.method === 'POST') {
         try {
            const { email, setId, reference, voiceId, voiceMime, voiceDur, recordedBy } = await request.json();
            if (!email || !setId || !reference) return new Response(JSON.stringify({ error: 'email, setId, reference required' }), { status: 400, headers: corsHeaders });
            if (!/^v_[A-Za-z0-9]{6,20}$/.test(String(voiceId || ''))) return new Response(JSON.stringify({ error: 'bad voiceId' }), { status: 400, headers: corsHeaders });
            const emailLc = String(email).toLowerCase().trim();
            const refKey = encodeURIComponent(String(reference).trim().slice(0, 60));
            const key = `set-verse-voice:${String(setId)}:${refKey}`;
            const existing = await this.room.storage.get(key);
            // The author-voice slot is single-occupancy, locked to the first
            // recorder's email. But the SET OWNER must never be locked out of
            // their own set — mirror the delete handler's authorization so the
            // owner (or an admin) can always replace a foreign/stale recording,
            // e.g. one made under a different account of theirs.
            if (existing?.byEmail && existing.byEmail !== emailLc) {
               const setDoc = await this.room.storage.get(`verseset:${String(setId)}`);
               const isOwner = setDoc?.ownerEmail && String(setDoc.ownerEmail).toLowerCase() === emailLc;
               if (!isOwner && !isTrustedAdminEmail(email)) {
                  return new Response(JSON.stringify({ error: 'Only the original recorder or the set owner can replace this recording' }), { status: 403, headers: corsHeaders });
               }
            }
            const meta = {
               reference: String(reference).trim().slice(0, 60),
               voiceId: String(voiceId),
               voiceMime: String(voiceMime || 'audio/webm').slice(0, 40),
               voiceDur: Math.min(Math.max(0, Number(voiceDur) || 0), 600),
               recordedBy: String(recordedBy || '').trim().slice(0, 30),
               byEmail: emailLc,
               // Stable recorder id so recording-comments can target this
               // (author) recording the same way they target contributors.
               byOwnerId: await voiceOwnerId(emailLc),
               at: new Date().toISOString(),
            };
            await this.room.storage.put(key, meta);
            return new Response(JSON.stringify({ success: true, verseVoice: meta }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to save verse voice' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/verse-voice/delete — { email, setId, reference } removes a
      // creator (owner-layer) recording and its audio chunks. Authorized if the
      // requester is the original recorder (byEmail), the set's owner, or a
      // trusted admin. Idempotent: succeeds even if nothing is stored (so a
      // cleanup pass over stale references never errors).
      if (url.pathname.endsWith('/sets/verse-voice/delete') && request.method === 'POST') {
         try {
            const { email, setId, reference } = await request.json();
            if (!email || !setId || !reference) return new Response(JSON.stringify({ error: 'email, setId, reference required' }), { status: 400, headers: corsHeaders });
            const emailLc = String(email).toLowerCase().trim();
            const refKey = encodeURIComponent(String(reference).trim().slice(0, 60));
            const key = `set-verse-voice:${String(setId)}:${refKey}`;
            const meta = await this.room.storage.get(key);
            if (!meta) return new Response(JSON.stringify({ success: true, deleted: false }), { status: 200, headers: corsHeaders });
            const setDoc = await this.room.storage.get(`verseset:${String(setId)}`);
            const authorized = (meta.byEmail && meta.byEmail === emailLc)
               || (setDoc?.ownerEmail && String(setDoc.ownerEmail).toLowerCase() === emailLc)
               || isTrustedAdminEmail(email);
            if (!authorized) return new Response(JSON.stringify({ error: 'Not authorized to delete this recording' }), { status: 403, headers: corsHeaders });
            if (meta.voiceId) {
               const chunks = await this.room.storage.list({ prefix: `set-voice:${String(setId)}:${meta.voiceId}:` });
               for (const k of chunks.keys()) await this.room.storage.delete(k);
            }
            await this.room.storage.delete(key);
            return new Response(JSON.stringify({ success: true, deleted: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to delete verse voice' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/verse-voices?setId=<setId> — all recordings for a set,
      // as { voices: { [reference]: meta } }. Public: anyone playing the
      // set may hear the creator's voice.
      if (url.pathname.endsWith('/sets/verse-voices') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            if (!setId) return new Response(JSON.stringify({ error: 'setId required' }), { status: 400, headers: corsHeaders });
            const prefix = `set-verse-voice:${setId}:`;
            const map = await this.room.storage.list({ prefix });
            const voices = {};
            for (const [, meta] of map.entries()) {
               if (meta?.reference) {
                  // Backfill byOwnerId for recordings saved before it existed, so
                  // recording-comments can always target the author's recording.
                  if (!meta.byOwnerId && meta.byEmail) meta.byOwnerId = await voiceOwnerId(meta.byEmail);
                  voices[meta.reference] = meta;
               }
            }
            return new Response(JSON.stringify({ success: true, voices }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list verse voices' }), { status: 500, headers: corsHeaders });
         }
      }

      // ── 個人親聲朗讀 (personal voice) ──────────────────────────────────
      // A SECOND voice layer, parallel to the owner's set-verse-voice slot.
      // Any logged-in listener may record their own reading of a verse; it
      // never overwrites the set owner's recording. Keyed by an opaque
      // ownerId (= sha256(email) prefix) so share links can carry it without
      // exposing the email. Audio chunks reuse the shared set-voice:* store
      // (content-addressed by the unique voiceId), so recording reuses the
      // existing /sets/verse-voice/chunk upload path.
      //   pointer: user-verse-voice:{ownerId}:{setId}:{refKey} → meta
      // Playback priority (client): personal › owner › TTS.

      // POST /sets/user-verse-voice/set — { email, setId, reference, voiceId, voiceMime, voiceDur, recordedBy, public }
      // `public` (default true for new recordings) opts this reading into the
      // set's shared-voice picker. When true, we also touch a per-set
      // contributor index (set-voice-index:{setId}) so the picker can list
      // "who has recorded for this set" — the pointer keys bury ownerId in
      // front of setId and can't be prefix-scanned by set alone.
      if (url.pathname.endsWith('/sets/user-verse-voice/set') && request.method === 'POST') {
         try {
            const body = await request.json();
            const { email, setId, reference, voiceId, voiceMime, voiceDur, recordedBy } = body;
            const isPublic = body.public !== false; // default true
            if (!email || !setId || !reference) return new Response(JSON.stringify({ error: 'email, setId, reference required' }), { status: 400, headers: corsHeaders });
            if (!/^v_[A-Za-z0-9]{6,20}$/.test(String(voiceId || ''))) return new Response(JSON.stringify({ error: 'bad voiceId' }), { status: 400, headers: corsHeaders });
            const ownerId = await voiceOwnerId(email);
            const refKey = encodeURIComponent(String(reference).trim().slice(0, 60));
            const meta = {
               reference: String(reference).trim().slice(0, 60),
               voiceId: String(voiceId),
               voiceMime: String(voiceMime || 'audio/webm').slice(0, 40),
               voiceDur: Math.min(Math.max(0, Number(voiceDur) || 0), 600),
               recordedBy: String(recordedBy || '').trim().slice(0, 30),
               public: isPublic,
               at: new Date().toISOString(),
            };
            const key = `user-verse-voice:${ownerId}:${String(setId)}:${refKey}`;
            const wasNew = !(await this.room.storage.get(key));
            await this.room.storage.put(key, meta);
            // Maintain the contributor index (best-effort; the picker tolerates
            // stale entries by skipping any whose audio can't be fetched).
            if (isPublic) {
               const idxKey = `set-voice-index:${String(setId)}`;
               const idx = (await this.room.storage.get(idxKey)) || {};
               const prev = idx[ownerId] || { count: 0, hidden: false };
               idx[ownerId] = {
                  recordedBy: meta.recordedBy || prev.recordedBy || '',
                  count: prev.count + (wasNew ? 1 : 0),
                  updatedAt: meta.at,
                  hidden: prev.hidden === true,
               };
               // Cap the index so a runaway set can't blow the 128KB key limit.
               const owners = Object.keys(idx);
               if (owners.length > 60) {
                  owners
                     .sort((a, b) => (idx[a].updatedAt < idx[b].updatedAt ? -1 : 1))
                     .slice(0, owners.length - 60)
                     .forEach((o) => { if (o !== ownerId) delete idx[o]; });
               }
               await this.room.storage.put(idxKey, idx);
            }
            return new Response(JSON.stringify({ success: true, ownerId, verseVoice: meta }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to save personal verse voice' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/user-verse-voices?setId=<setId>&owner=<ownerId> — a single
      // user's recordings for a set, as { voices: { [reference]: meta } }.
      // owner is the opaque id (from a share link, or the listener's own).
      if (url.pathname.endsWith('/sets/user-verse-voices') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            const owner = url.searchParams.get('owner');
            if (!setId || !owner) return new Response(JSON.stringify({ error: 'setId, owner required' }), { status: 400, headers: corsHeaders });
            const prefix = `user-verse-voice:${owner}:${setId}:`;
            const map = await this.room.storage.list({ prefix });
            const voices = {};
            for (const [, meta] of map.entries()) {
               if (meta?.reference) voices[meta.reference] = meta;
            }
            return new Response(JSON.stringify({ success: true, voices }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list personal verse voices' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/user-verse-voice/delete — { email, setId, reference }
      // Removes the caller's pointer AND its audio chunks (voiceId is unique
      // per recording, so its chunks are safe to drop). Auth = the email must
      // hash to the ownerId, so a user can only delete their own.
      if (url.pathname.endsWith('/sets/user-verse-voice/delete') && request.method === 'POST') {
         try {
            const { email, setId, reference } = await request.json();
            if (!email || !setId || !reference) return new Response(JSON.stringify({ error: 'email, setId, reference required' }), { status: 400, headers: corsHeaders });
            const ownerId = await voiceOwnerId(email);
            const refKey = encodeURIComponent(String(reference).trim().slice(0, 60));
            const key = `user-verse-voice:${ownerId}:${String(setId)}:${refKey}`;
            const meta = await this.room.storage.get(key);
            if (meta?.voiceId) {
               const chunks = await this.room.storage.list({ prefix: `set-voice:${String(setId)}:${meta.voiceId}:` });
               for (const k of chunks.keys()) await this.room.storage.delete(k);
            }
            await this.room.storage.delete(key);
            // Decrement the contributor index; drop the owner entry at zero.
            if (meta) {
               const idxKey = `set-voice-index:${String(setId)}`;
               const idx = await this.room.storage.get(idxKey);
               if (idx && idx[ownerId]) {
                  const c = (idx[ownerId].count || 1) - 1;
                  if (c <= 0) delete idx[ownerId];
                  else idx[ownerId] = { ...idx[ownerId], count: c, updatedAt: new Date().toISOString() };
                  if (Object.keys(idx).length === 0) await this.room.storage.delete(idxKey);
                  else await this.room.storage.put(idxKey, idx);
               }
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to delete personal verse voice' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice-contributors?setId=<setId> — list users who have shared
      // (public && !hidden) recordings for this set, for the play-time voice
      // picker: { contributors: [{ ownerId, recordedBy, count }] }.
      if (url.pathname.endsWith('/sets/voice-contributors') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            if (!setId) return new Response(JSON.stringify({ error: 'setId required' }), { status: 400, headers: corsHeaders });
            const idx = (await this.room.storage.get(`set-voice-index:${String(setId)}`)) || {};
            const contributors = Object.entries(idx)
               .filter(([, v]) => v && v.hidden !== true && (v.count || 0) > 0)
               .map(([ownerId, v]) => ({ ownerId, recordedBy: v.recordedBy || '', count: v.count || 0 }))
               .sort((a, b) => b.count - a.count);
            return new Response(JSON.stringify({ success: true, contributors }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list voice contributors' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice-refs?setId=<setId> — the set of verse references that
      // have ANY recording (the set author's + every public, non-hidden
      // contributor's). The set-detail page uses it to ⭐ a verse whenever
      // someone — not just the viewer — has recorded it. One round-trip: the
      // personal-layer keys bury ownerId before setId, so the server walks each
      // contributor from the index rather than the client doing N fetches.
      if (url.pathname.endsWith('/sets/voice-refs') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            if (!setId) return new Response(JSON.stringify({ error: 'setId required' }), { status: 400, headers: corsHeaders });
            const refs = new Set();
            const ownerMap = await this.room.storage.list({ prefix: `set-verse-voice:${String(setId)}:` });
            for (const [, meta] of ownerMap.entries()) { if (meta?.reference) refs.add(meta.reference); }
            const idx = (await this.room.storage.get(`set-voice-index:${String(setId)}`)) || {};
            for (const [ownerId, v] of Object.entries(idx)) {
               if (!v || v.hidden === true || (v.count || 0) <= 0) continue;
               const pmap = await this.room.storage.list({ prefix: `user-verse-voice:${ownerId}:${String(setId)}:` });
               for (const [, meta] of pmap.entries()) { if (meta?.public !== false && meta?.reference) refs.add(meta.reference); }
            }
            return new Response(JSON.stringify({ success: true, refs: Array.from(refs) }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list voice refs' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice-latest?setId=<setId> — the NEWEST public human recording
      // for each verse reference, across the set author's layer AND every public,
      // non-hidden contributor. One round-trip so the player can default to a real
      // voice (the most recent one) instead of TTS whenever anyone has recorded a
      // verse — not just when the set author did. Shape:
      //   { latest: { [reference]: { ownerId, recordedBy, voiceId, voiceMime, voiceDur, at, source } } }
      // ownerId is the opaque recorder id (byOwnerId for the author layer), so the
      // client can attribute it, target comments, and share it (vo=). Audio for
      // both layers lives in the shared set-voice:{setId}:{voiceId} store, so the
      // client fetches every winner with getAudio(setId, voiceId).
      if (url.pathname.endsWith('/sets/voice-latest') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            if (!setId) return new Response(JSON.stringify({ error: 'setId required' }), { status: 400, headers: corsHeaders });
            const latest = {};
            // Later `at` wins; ISO-8601 strings compare lexicographically.
            const consider = (ref, cand) => {
               if (!ref || !cand?.voiceId) return;
               const cur = latest[ref];
               if (!cur || String(cand.at || '') > String(cur.at || '')) latest[ref] = cand;
            };
            // Author layer.
            const ownerMap = await this.room.storage.list({ prefix: `set-verse-voice:${String(setId)}:` });
            for (const [, meta] of ownerMap.entries()) {
               // Backfill byOwnerId for author recordings saved before it existed
               // (same as /sets/verse-voices) — otherwise the player gets ownerId:null
               // for the winning voice and hides the Encourage button / can't share it.
               if (meta && !meta.byOwnerId && meta.byEmail) meta.byOwnerId = await voiceOwnerId(meta.byEmail);
               consider(meta?.reference, {
                  ownerId: meta?.byOwnerId || null,
                  recordedBy: meta.recordedBy || '',
                  voiceId: meta.voiceId, voiceMime: meta.voiceMime || 'audio/webm',
                  voiceDur: meta.voiceDur || 0, at: meta.at || '', source: 'owner',
               });
            }
            // Public, non-hidden contributors.
            const idx = (await this.room.storage.get(`set-voice-index:${String(setId)}`)) || {};
            for (const [ownerId, v] of Object.entries(idx)) {
               if (!v || v.hidden === true || (v.count || 0) <= 0) continue;
               const pmap = await this.room.storage.list({ prefix: `user-verse-voice:${ownerId}:${String(setId)}:` });
               for (const [, meta] of pmap.entries()) {
                  if (meta?.public === false) continue;
                  consider(meta?.reference, {
                     ownerId,
                     recordedBy: meta.recordedBy || v.recordedBy || '',
                     voiceId: meta.voiceId, voiceMime: meta.voiceMime || 'audio/webm',
                     voiceDur: meta.voiceDur || 0, at: meta.at || '', source: 'contributor',
                  });
               }
            }
            return new Response(JSON.stringify({ success: true, latest }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list latest voices' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/voice-contributor/hide — { setId, ownerId, requesterEmail?, requesterName?, hidden? }
      // Moderation: mark a contributor hidden (reversible; keeps their audio).
      // Auth = admin token / trusted admin email|name, OR the requester is the
      // set's original publisher (ownerEmail). Pass hidden:false to un-hide.
      if (url.pathname.endsWith('/sets/voice-contributor/hide') && request.method === 'POST') {
         try {
            const { setId, ownerId, requesterEmail, requesterName, hidden } = await request.json();
            if (!setId || !ownerId) return new Response(JSON.stringify({ error: 'setId, ownerId required' }), { status: 400, headers: corsHeaders });
            let authorized = isCustomSetWriteAuthorized() || isTrustedAdminEmail(requesterEmail) || isTrustedAdminName(requesterName);
            if (!authorized && requesterEmail) {
               const set = await this.room.storage.get(`verseset:${String(setId)}`);
               if (set && set.ownerEmail && String(set.ownerEmail).trim().toLowerCase() === String(requesterEmail).trim().toLowerCase()) {
                  authorized = true;
               }
            }
            if (!authorized) return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
            const idxKey = `set-voice-index:${String(setId)}`;
            const idx = await this.room.storage.get(idxKey);
            if (idx && idx[ownerId]) {
               idx[ownerId] = { ...idx[ownerId], hidden: hidden !== false };
               await this.room.storage.put(idxKey, idx);
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to update contributor' }), { status: 500, headers: corsHeaders });
         }
      }

      // ── 錄音留言 / 鼓勵 (voice-recording comments) ─────────────────────
      // YouTube-style feedback attached to ONE specific recording, so that a
      // set with A/B/C contributors gets comments on the exact voice a listener
      // is responding to. Target id T = `${setId}::${enc(reference)}::${ownerId}`
      // where ownerId identifies the recorder (a contributor's ownerId, or the
      // set author's byOwnerId). Supports text + voice comments with inline
      // emoji reactions, plus a recording-level like.
      // Audio reuses the content-addressed set-voice store (/sets/verse-voice/chunk).
      // Encouragement lands in an inbox keyed by the recorder's ownerId — no
      // email needed, so it stays privacy-preserving (no push).
      const VC_EMOJI = ['❤️', '🙏', '✨', '🌧️'];
      const vcLc = (s) => String(s || '').trim().toLowerCase();
      const vcTarget = (setId, reference, ownerId) => `${String(setId)}::${encodeURIComponent(String(reference).trim().slice(0, 60))}::${String(ownerId)}`;
      const vcCid = () => 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      const vcInboxPush = async (ownerId, entry) => {
         const ik = `voice-encourage:${ownerId}`;
         const inbox = (await this.room.storage.get(ik)) || [];
         inbox.unshift(entry);
         if (inbox.length > 50) inbox.length = 50;
         await this.room.storage.put(ik, inbox);
      };

      // POST /sets/voice-comment/create — { email, name, setId, reference, targetOwnerId, type, text?, voiceId?, voiceMime?, voiceDur? }
      if (url.pathname.endsWith('/sets/voice-comment/create') && request.method === 'POST') {
         try {
            const { email, name, setId, reference, targetOwnerId, type, text, voiceId, voiceMime, voiceDur } = await request.json();
            if (!email || !setId || !reference || !targetOwnerId) return new Response(JSON.stringify({ error: 'email, setId, reference, targetOwnerId required' }), { status: 400, headers: corsHeaders });
            if (!/^[a-f0-9]{16}$/.test(String(targetOwnerId))) return new Response(JSON.stringify({ error: 'bad targetOwnerId' }), { status: 400, headers: corsHeaders });
            const isVoice = type === 'voice';
            const body = String(text || '').trim().slice(0, 1000);
            if (isVoice) {
               if (!/^v_[A-Za-z0-9]{6,20}$/.test(String(voiceId || ''))) return new Response(JSON.stringify({ error: 'voiceId required for voice comment' }), { status: 400, headers: corsHeaders });
            } else if (!body) {
               return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: corsHeaders });
            }
            const emailLc = vcLc(email);
            const cid = vcCid();
            const doc = {
               cid,
               setId: String(setId),
               reference: String(reference).trim().slice(0, 60),
               targetOwnerId: String(targetOwnerId),
               author: emailLc,
               authorName: String(name || '').trim().slice(0, 30) || emailLc.split('@')[0],
               type: isVoice ? 'voice' : 'text',
               text: isVoice ? '' : body,
               at: new Date().toISOString(),
               reactions: [],
               ...(isVoice ? { voiceId: String(voiceId), voiceMime: String(voiceMime || 'audio/webm').slice(0, 40), voiceDur: Math.min(Math.max(0, Number(voiceDur) || 0), 600) } : {}),
            };
            const T = vcTarget(setId, reference, targetOwnerId);
            await this.room.storage.put(`voice-comment:${T}:${cid}`, doc);
            // Encourage the recorder (skip when commenting on your own recording).
            const actorOwnerId = await voiceOwnerId(emailLc);
            if (actorOwnerId !== String(targetOwnerId)) {
               await vcInboxPush(targetOwnerId, { kind: 'comment', setId: doc.setId, reference: doc.reference, fromName: doc.authorName, preview: isVoice ? '🎙️' : body.slice(0, 60), at: doc.at });
            }
            return new Response(JSON.stringify({ success: true, comment: doc }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to create comment' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice-comments?setId=&reference=&targetOwnerId= — one recording's
      // comments (newest-first) + the recording-level reactions.
      if (url.pathname.endsWith('/sets/voice-comments') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            const reference = url.searchParams.get('reference');
            const targetOwnerId = url.searchParams.get('targetOwnerId');
            if (!setId || !reference || !targetOwnerId) return new Response(JSON.stringify({ error: 'setId, reference, targetOwnerId required' }), { status: 400, headers: corsHeaders });
            const T = vcTarget(setId, reference, targetOwnerId);
            const map = await this.room.storage.list({ prefix: `voice-comment:${T}:` });
            const comments = Array.from(map.values()).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
            const rr = (await this.room.storage.get(`voice-recording-reactions:${T}`)) || { reactions: [] };
            return new Response(JSON.stringify({ success: true, comments, recordingReactions: rr.reactions || [] }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to list comments' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/voice-comment/delete — { email, name, setId, reference, targetOwnerId, cid }
      // Auth = comment author, OR the recorder (targetOwnerId===hash(email)), OR
      // the set's publisher (ownerEmail), OR admin.
      if (url.pathname.endsWith('/sets/voice-comment/delete') && request.method === 'POST') {
         try {
            const { email, name, setId, reference, targetOwnerId, cid } = await request.json();
            if (!email || !setId || !reference || !targetOwnerId || !cid) return new Response(JSON.stringify({ error: 'email, setId, reference, targetOwnerId, cid required' }), { status: 400, headers: corsHeaders });
            const T = vcTarget(setId, reference, targetOwnerId);
            const key = `voice-comment:${T}:${cid}`;
            const doc = await this.room.storage.get(key);
            if (!doc) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
            const emailLc = vcLc(email);
            const actorOwnerId = await voiceOwnerId(emailLc);
            let authorized = doc.author === emailLc
               || actorOwnerId === String(targetOwnerId)
               || isCustomSetWriteAuthorized() || isTrustedAdminEmail(email) || isTrustedAdminName(name);
            if (!authorized) {
               const set = await this.room.storage.get(`verseset:${String(setId)}`);
               if (set?.ownerEmail && vcLc(set.ownerEmail) === emailLc) authorized = true;
            }
            if (!authorized) return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });
            await this.room.storage.delete(key);
            if (doc.voiceId) {
               const chunks = await this.room.storage.list({ prefix: `set-voice:${String(setId)}:${doc.voiceId}:` });
               for (const k of chunks.keys()) await this.room.storage.delete(k);
            }
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to delete comment' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/voice-comment/react — { email, setId, reference, targetOwnerId, cid, emoji } — toggle.
      if (url.pathname.endsWith('/sets/voice-comment/react') && request.method === 'POST') {
         try {
            const { email, setId, reference, targetOwnerId, cid, emoji } = await request.json();
            if (!VC_EMOJI.includes(emoji)) return new Response(JSON.stringify({ error: 'Invalid emoji' }), { status: 400, headers: corsHeaders });
            if (!email || !setId || !reference || !targetOwnerId || !cid) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers: corsHeaders });
            const key = `voice-comment:${vcTarget(setId, reference, targetOwnerId)}:${cid}`;
            const doc = await this.room.storage.get(key);
            if (!doc) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
            const me = vcLc(email);
            const existing = (doc.reactions || []).find(r => r.from === me && r.emoji === emoji);
            if (existing) doc.reactions = doc.reactions.filter(r => !(r.from === me && r.emoji === emoji));
            else doc.reactions = [...(doc.reactions || []), { from: me, emoji, at: new Date().toISOString() }];
            await this.room.storage.put(key, doc);
            return new Response(JSON.stringify({ success: true, reactions: doc.reactions }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to react' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/voice-recording/react — { email, name, setId, reference, targetOwnerId, emoji }
      // Like/react to a whole recording (YouTube "like the video"). Toggles.
      if (url.pathname.endsWith('/sets/voice-recording/react') && request.method === 'POST') {
         try {
            const { email, name, setId, reference, targetOwnerId, emoji } = await request.json();
            if (!VC_EMOJI.includes(emoji)) return new Response(JSON.stringify({ error: 'Invalid emoji' }), { status: 400, headers: corsHeaders });
            if (!email || !setId || !reference || !targetOwnerId) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers: corsHeaders });
            if (!/^[a-f0-9]{16}$/.test(String(targetOwnerId))) return new Response(JSON.stringify({ error: 'bad targetOwnerId' }), { status: 400, headers: corsHeaders });
            const T = vcTarget(setId, reference, targetOwnerId);
            const key = `voice-recording-reactions:${T}`;
            const rec = (await this.room.storage.get(key)) || { setId: String(setId), reference: String(reference).trim().slice(0, 60), targetOwnerId: String(targetOwnerId), reactions: [] };
            const me = vcLc(email);
            const existing = (rec.reactions || []).find(r => r.from === me && r.emoji === emoji);
            let added = false;
            if (existing) rec.reactions = rec.reactions.filter(r => !(r.from === me && r.emoji === emoji));
            else { rec.reactions = [...(rec.reactions || []), { from: me, emoji, at: new Date().toISOString() }]; added = true; }
            await this.room.storage.put(key, rec);
            if (added) {
               const actorOwnerId = await voiceOwnerId(me);
               if (actorOwnerId !== String(targetOwnerId)) {
                  await vcInboxPush(targetOwnerId, { kind: 'like', setId: rec.setId, reference: rec.reference, fromName: String(name || '').trim().slice(0, 30) || me.split('@')[0], emoji, at: new Date().toISOString() });
               }
            }
            return new Response(JSON.stringify({ success: true, reactions: rec.reactions }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to react' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice-comment-counts?setId= — per (reference, ownerId) tallies
      // { [`${reference}||${ownerId}`]: { comments, likes } } so pickers can badge
      // 💬/❤️ in one round trip (mirrors /sets/voice-refs single-scan style).
      if (url.pathname.endsWith('/sets/voice-comment-counts') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            if (!setId) return new Response(JSON.stringify({ error: 'setId required' }), { status: 400, headers: corsHeaders });
            const counts = {};
            const bump = (ref, owner) => {
               const k = `${ref}||${owner}`;
               if (!counts[k]) counts[k] = { comments: 0, likes: 0 };
               return counts[k];
            };
            const cmap = await this.room.storage.list({ prefix: `voice-comment:${String(setId)}::` });
            for (const doc of cmap.values()) { if (doc?.reference && doc?.targetOwnerId) bump(doc.reference, doc.targetOwnerId).comments++; }
            const rmap = await this.room.storage.list({ prefix: `voice-recording-reactions:${String(setId)}::` });
            for (const rec of rmap.values()) { if (rec?.reference && rec?.targetOwnerId) bump(rec.reference, rec.targetOwnerId).likes = (rec.reactions || []).length; }
            return new Response(JSON.stringify({ success: true, counts }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to fetch counts' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice-encourage?owner=<ownerId> — a recorder's encouragement inbox.
      if (url.pathname.endsWith('/sets/voice-encourage') && request.method === 'GET') {
         try {
            const owner = url.searchParams.get('owner');
            if (!owner || !/^[a-f0-9]{16}$/.test(owner)) return new Response(JSON.stringify({ error: 'bad owner' }), { status: 400, headers: corsHeaders });
            const items = (await this.room.storage.get(`voice-encourage:${owner}`)) || [];
            const lastReadAt = (await this.room.storage.get(`voice-encourage-read:${owner}`)) || '';
            return new Response(JSON.stringify({ success: true, items, lastReadAt }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to fetch encouragement' }), { status: 500, headers: corsHeaders });
         }
      }

      // POST /sets/voice-encourage/read — { owner } — mark inbox read up to now.
      if (url.pathname.endsWith('/sets/voice-encourage/read') && request.method === 'POST') {
         try {
            const { owner } = await request.json();
            if (!owner || !/^[a-f0-9]{16}$/.test(String(owner))) return new Response(JSON.stringify({ error: 'bad owner' }), { status: 400, headers: corsHeaders });
            await this.room.storage.put(`voice-encourage-read:${owner}`, new Date().toISOString());
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to mark read' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4.11 Set assets — 自訂背景圖 / 背景音樂. Chunked base64 blobs keyed
      // to a set, same pipeline as voices. The set object itself carries the
      // pointer (set.background='custom:<assetId>' / set.bgMusic=…) plus the
      // mime, so these endpoints only store/serve raw chunks.
      //   image: ≤6 chunks (~450KB)   music: ≤72 chunks (~5.4MB)
      // POST /sets/asset/chunk — { email, setId, assetId, kind, index, total, data }
      if (url.pathname.endsWith('/sets/asset/chunk') && request.method === 'POST') {
         try {
            const { email, setId, assetId, kind, index, total, data } = await request.json();
            if (!email || !setId || !assetId) return new Response(JSON.stringify({ error: 'email, setId, assetId required' }), { status: 400, headers: corsHeaders });
            if (!/^a_[A-Za-z0-9]{6,20}$/.test(assetId)) return new Response(JSON.stringify({ error: 'bad assetId' }), { status: 400, headers: corsHeaders });
            const maxChunks = kind === 'music' ? 72 : 6;
            const idx = Number(index), tot = Number(total);
            if (!Number.isInteger(idx) || !Number.isInteger(tot) || idx < 0 || tot < 1 || idx >= tot) return new Response(JSON.stringify({ error: 'bad chunk index' }), { status: 400, headers: corsHeaders });
            if (tot > maxChunks) return new Response(JSON.stringify({ error: `too many chunks (max ${maxChunks})` }), { status: 400, headers: corsHeaders });
            if (typeof data !== 'string' || !data || data.length > 110000) return new Response(JSON.stringify({ error: 'bad chunk data' }), { status: 400, headers: corsHeaders });
            // Chunk index zero-padded so lexicographic key order == numeric.
            const paddedIdx = String(idx).padStart(3, '0');
            await this.room.storage.put(`set-asset:${String(setId)}:${assetId}:${paddedIdx}`, data);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to save asset chunk' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/asset?setId=<setId>&assetId=<assetId> — reassembled base64.
      if (url.pathname.endsWith('/sets/asset') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            const assetId = url.searchParams.get('assetId');
            if (!setId || !assetId) return new Response(JSON.stringify({ error: 'setId, assetId required' }), { status: 400, headers: corsHeaders });
            if (!/^a_[A-Za-z0-9]{6,20}$/.test(assetId)) return new Response(JSON.stringify({ error: 'bad assetId' }), { status: 400, headers: corsHeaders });
            const map = await this.room.storage.list({ prefix: `set-asset:${setId}:${assetId}:` });
            if (map.size === 0) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
            const data = Array.from(map.entries())
               // Numeric sort on the trailing :<index> — lexicographic key
               // order breaks past 9 chunks ("10" < "2"), which long
               // recordings now exceed routinely.
               .sort((a, b) => (parseInt(a[0].slice(a[0].lastIndexOf(':') + 1), 10) || 0) - (parseInt(b[0].slice(b[0].lastIndexOf(':') + 1), 10) || 0))
               .map(([, v]) => v)
               .join('');
            return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to fetch asset' }), { status: 500, headers: corsHeaders });
         }
      }

      // GET /sets/voice?setId=<setId>&voiceId=<voiceId> — reassembled base64 audio.
      if (url.pathname.endsWith('/sets/voice') && request.method === 'GET') {
         try {
            const setId = url.searchParams.get('setId');
            const voiceId = url.searchParams.get('voiceId');
            if (!setId || !voiceId) return new Response(JSON.stringify({ error: 'setId, voiceId required' }), { status: 400, headers: corsHeaders });
            if (!/^v_[A-Za-z0-9]{6,20}$/.test(voiceId)) return new Response(JSON.stringify({ error: 'bad voiceId' }), { status: 400, headers: corsHeaders });
            const map = await this.room.storage.list({ prefix: `set-voice:${setId}:${voiceId}:` });
            if (map.size === 0) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
            const data = Array.from(map.entries())
               // Numeric sort on the trailing :<index> — lexicographic key
               // order breaks past 9 chunks ("10" < "2"), which long
               // recordings now exceed routinely.
               .sort((a, b) => (parseInt(a[0].slice(a[0].lastIndexOf(':') + 1), 10) || 0) - (parseInt(b[0].slice(b[0].lastIndexOf(':') + 1), 10) || 0))
               .map(([, v]) => v)
               .join('');
            return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: corsHeaders });
         } catch {
            return new Response(JSON.stringify({ error: 'Failed to fetch voice' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4.6 Share-Set token — a link-based share path that doesn't require
      // the global publish flow. Any logged-in user can publish a set "by
      // link" without needing admin privileges or polluting the public
      // /custom-sets list. The frontend POSTs the full set when the user
      // clicks the share button; anyone with the URL can GET the set back
      // by id, no auth required.
      if (url.pathname.endsWith('/share-set') && request.method === 'POST') {
         try {
            const { set } = await request.json();
            if (!set || !set.id) {
               return new Response(JSON.stringify({ error: 'set { id } required' }), { status: 400, headers: corsHeaders });
            }
            const stored = { ...set, sharedAt: new Date().toISOString() };
            await this.room.storage.put(`shared:${set.id}`, stored);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to save shared set' }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/share-set') && request.method === 'GET') {
         try {
            const id = url.searchParams.get('id');
            if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
            const set = await this.room.storage.get(`shared:${id}`);
            if (!set) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
            return new Response(JSON.stringify({ success: true, set }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to fetch shared set' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4.5 Private Custom Verse Sets — per-user sync (replaces device-local
      // only storage). Distinct from `/custom-sets` (the global published-set
      // list everyone can see).
      //
      // Storage layout: each set is serialized to JSON then split into ~100KB
      // chunks, written as `private-sets:<playerName>:<setId>::part:<n>` keys.
      // This is necessary because Cloudflare Durable Object storage caps each
      // key VALUE at 131072 bytes — a single rich set (HTML description +
      // many full-chapter verses) can exceed that on its own. The legacy
      // single-key array at `private-sets:<playerName>` is still read on GET
      // as a final fallback during migration.
      // Cloudflare Durable Object storage caps each VALUE at 131072 UTF-8
      // bytes. JSON of a rich verse set (HTML description + many Chinese
      // verses) easily exceeds that; CJK chars are 3 bytes each in UTF-8 so
      // chunking by JS string length is unsafe. Encode to bytes, slice on
      // codepoint boundaries via TextDecoder's streaming mode (no
      // multi-byte char splits), then store each chunk as a string.
      // Cloudflare DO storage caps each VALUE at 131072 bytes. We use a
      // conservative 50000-byte chunk so headroom covers any internal
      // serialization overhead (UTF-16 expansion, structuredClone wrapper).
      const CHUNK_BYTES = 50000;
      const splitChunks = (str) => {
         const bytes = new TextEncoder().encode(str);
         if (bytes.length <= CHUNK_BYTES) return [str];
         const decoder = new TextDecoder('utf-8');
         const out = [];
         let pos = 0;
         while (pos < bytes.length) {
            let end = Math.min(pos + CHUNK_BYTES, bytes.length);
            // Walk back if the next byte is a UTF-8 continuation byte
            // (10xxxxxx) — would otherwise split a multi-byte char.
            while (end < bytes.length && (bytes[end] & 0xC0) === 0x80) end--;
            out.push(decoder.decode(bytes.subarray(pos, end)));
            pos = end;
         }
         return out;
      };
      if (url.pathname.endsWith('/save-private-sets') && request.method === 'POST') {
         try {
            const { playerName, userEmail, sets } = await request.json();
            if (!playerName || !Array.isArray(sets)) {
               return new Response(JSON.stringify({ error: 'playerName and sets[] required' }), { status: 400, headers: corsHeaders });
            }
            const prefix = `private-sets:${playerName}:`;
            // Clear the legacy single-key blob (if any).
            await this.room.storage.delete(`private-sets:${playerName}`);
            // Per-set upsert: only delete a set's old chunks AFTER
            // successfully writing its new chunks, so partial failure
            // never wipes data that hasn't been replaced yet.
            const existingMap = await this.room.storage.list({ prefix });
            const incomingIds = new Set(sets.filter(s => s?.id).map(s => s.id));
            let totalChunks = 0;
            const failures = [];
            for (const set of sets) {
               if (!set || !set.id) continue;
               const json = JSON.stringify(set);
               const jsonBytes = new TextEncoder().encode(json).length;
               const chunks = splitChunks(json);
               const setPrefix = `${prefix}${set.id}::part:`;
               // Write new chunks first
               let allWritten = true;
               for (let i = 0; i < chunks.length; i++) {
                  const chunkBytes = new TextEncoder().encode(chunks[i]).length;
                  try {
                     await this.room.storage.put(`${prefix}${set.id}::part:${i}/${chunks.length}`, chunks[i]);
                     totalChunks++;
                  } catch (putErr) {
                     allWritten = false;
                     failures.push({
                        setId: set.id,
                        title: set.title,
                        chunkIndex: i,
                        chunkBytes,
                        totalChunks: chunks.length,
                        setJsonBytes: jsonBytes,
                        error: String(putErr?.message || putErr),
                     });
                  }
               }
               // Clean up stale chunks from previous save (different chunk count)
               if (allWritten) {
                  for (const [key] of existingMap.entries()) {
                     if (key.startsWith(setPrefix)) {
                        const m = key.match(/::part:(\d+)\/(\d+)$/);
                        if (m && (parseInt(m[2]) !== chunks.length || parseInt(m[1]) >= chunks.length)) {
                           await this.room.storage.delete(key);
                        }
                     }
                  }
               }
            }
            // Remove chunks for sets no longer in the incoming list
            for (const [key] of existingMap.entries()) {
               const tail = key.slice(prefix.length);
               const setId = tail.split('::part:')[0];
               if (setId && !incomingIds.has(setId)) {
                  await this.room.storage.delete(key);
               }
            }
            if (failures.length) {
               return new Response(JSON.stringify({ error: 'Failed to save some private sets', failures, savedChunks: totalChunks }), { status: 500, headers: corsHeaders });
            }
            // Auto-sync: if a private set is published, update the public
            // verseset: key so other users see the latest version.
            //
            // Same ownership rule as POST /custom-sets: only the original
            // publisher may overwrite a public set. This endpoint used to
            // trust the caller entirely, so anyone who got a foreign set
            // into their private list (localStorage is shared per-device,
            // not per-account) could silently republish over it.
            // Legacy sets predate ownerEmail — fall back to authorName, and
            // bind ownerEmail on the way through so they harden over time.
            const requesterEmail = String(userEmail || '').trim().toLowerCase();
            const isAdmin = isCustomSetWriteAuthorized() || isTrustedAdminEmail(requesterEmail) || isTrustedAdminName(playerName);
            const mayRepublish = (existing) => {
               if (isAdmin) return true;
               const owner = String(existing.ownerEmail || '').trim().toLowerCase();
               if (owner) return !!requesterEmail && owner === requesterEmail;
               return !!existing.authorName && existing.authorName === playerName;
            };
            let publishedSynced = 0;
            for (const set of sets) {
               if (!set?.id || !set.isPublished) continue;
               const existing = await this.room.storage.get(`verseset:${set.id}`);
               if (!existing) continue;
               if (!mayRepublish(existing)) continue;
               const tsNew = Date.parse(set.lastEditedAt || '') || 0;
               const tsOld = Date.parse(existing.lastEditedAt || '') || 0;
               if (tsNew > tsOld || (tsNew === tsOld && (set.verses || []).length > (existing.verses || []).length)) {
                  await this.room.storage.put(`verseset:${set.id}`, {
                     ...set,
                     authorName: existing.authorName || set.authorName,
                     ownerEmail: existing.ownerEmail || requesterEmail || '',
                  });
                  publishedSynced++;
               }
            }
            return new Response(JSON.stringify({ success: true, count: sets.length, chunks: totalChunks, publishedSynced }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to save private sets', detail: String(e?.message || e) }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/private-sets') && request.method === 'GET') {
         try {
            const playerName = url.searchParams.get('player');
            if (!playerName) return new Response(JSON.stringify({ error: 'player param required' }), { status: 400, headers: corsHeaders });
            const prefix = `private-sets:${playerName}:`;
            const map = await this.room.storage.list({ prefix });
            // Group keys by setId, then reassemble each set's chunks in order.
            const bySet = new globalThis.Map();
            for (const [key, value] of map.entries()) {
               const tail = key.slice(prefix.length);
               // Match `<setId>::part:<idx>/<total>`. If a key doesn't match
               // this shape, treat as a non-chunked legacy per-set value
               // (whole set object) for backward compatibility with the prior
               // server version that wrote one key per set unchunked.
               const m = tail.match(/^(.+?)::part:(\d+)\/(\d+)$/);
               if (m) {
                  const setId = m[1];
                  const idx = parseInt(m[2], 10);
                  if (!bySet.has(setId)) bySet.set(setId, { chunks: [], legacy: null });
                  bySet.get(setId).chunks[idx] = value;
               } else if (value && typeof value === 'object' && value.id) {
                  bySet.set(tail, { chunks: null, legacy: value });
               }
            }
            const sets = [];
            for (const entry of bySet.values()) {
               if (entry.legacy) { sets.push(entry.legacy); continue; }
               if (!entry.chunks || entry.chunks.some(c => c == null)) continue; // skip incomplete
               try { sets.push(JSON.parse(entry.chunks.join(''))); }
               catch { /* skip corrupt */ }
            }
            // Final fallback: pre-chunking single-blob layout.
            if (!sets.length) {
               const legacy = await this.room.storage.get(`private-sets:${playerName}`);
               if (Array.isArray(legacy)) return new Response(JSON.stringify({ success: true, sets: legacy }), { status: 200, headers: corsHeaders });
            }
            return new Response(JSON.stringify({ success: true, sets }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to fetch private sets' }), { status: 500, headers: corsHeaders });
         }
      }

      // 4.7 Player Verse Set Favorites — account-backed quick-access list.
      // This is intentionally keyed by email rather than playerName, so the
      // same favorites follow the player across phones, tablets and computers
      // even if they later edit their display name.
      if (url.pathname.endsWith('/verse-set-favorites') && request.method === 'GET') {
         try {
            const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
            if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 403, headers: corsHeaders });
            const data = await this.room.storage.get(`favorites:${email}`);
            const setIds = Array.isArray(data?.setIds) ? data.setIds.filter(id => typeof id === 'string') : [];
            return new Response(JSON.stringify({ success: true, setIds }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to fetch favorites' }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/verse-set-favorites') && request.method === 'POST') {
         try {
            const { userEmail, playerName, setIds } = await request.json();
            const email = String(userEmail || '').trim().toLowerCase();
            if (!email) return new Response(JSON.stringify({ error: 'Login required' }), { status: 403, headers: corsHeaders });
            if (!Array.isArray(setIds)) return new Response(JSON.stringify({ error: 'setIds[] required' }), { status: 400, headers: corsHeaders });
            const cleanIds = Array.from(new Set(setIds.map(id => String(id || '').trim()).filter(Boolean))).slice(0, 80);
            await this.room.storage.put(`favorites:${email}`, {
               userEmail: email,
               playerName: String(playerName || '').trim(),
               setIds: cleanIds,
               updatedAt: new Date().toISOString(),
            });
            return new Response(JSON.stringify({ success: true, setIds: cleanIds }), { status: 200, headers: corsHeaders });
         } catch (e) {
            return new Response(JSON.stringify({ error: 'Failed to save favorites' }), { status: 500, headers: corsHeaders });
         }
      }

      // 5. Garden Sync — Save & Retrieve player garden data
      //
      // Server-side defensive merge: even if a client pushes an incomplete or
      // stale snapshot, we never let it lower a verse's stage/fruits or drop a
      // recorded activity day. The stored garden monotonically grows. This is
      // the last line of defense against the "stale snapshot clobbers progress"
      // class of bug — it makes data loss from a single bad write impossible.
      if (url.pathname.endsWith('/save-garden') && request.method === 'POST') {
         try {
            const { playerName, gardenData } = await request.json();
            if (!playerName || !gardenData) return new Response(JSON.stringify({ error: 'playerName and gardenData required' }), { status: 400, headers: corsHeaders });

            const existing = (await this.room.storage.get(`garden:${playerName}`)) || {};

            // Field-level merge: keep the higher stage/fruits per verse.
            const merged = { ...existing };
            for (const [ref, incoming] of Object.entries(gardenData)) {
               if (ref === '_activity') continue; // handled below
               if (!incoming || typeof incoming !== 'object') continue;
               const prev = merged[ref];
               if (!prev || typeof prev !== 'object') {
                  merged[ref] = incoming;
               } else {
                  merged[ref] = {
                     ...prev,
                     ...incoming,
                     stage: Math.max(prev.stage || 0, incoming.stage || 0),
                     fruits: Math.max(prev.fruits || 0, incoming.fruits || 0),
                  };
               }
            }

            // Union the activity maps — never drop a day, keep the higher count.
            const prevAct = (existing && existing._activity) || {};
            const incomingAct = (gardenData && gardenData._activity) || {};
            const mergedAct = { ...prevAct };
            for (const [day, val] of Object.entries(incomingAct)) {
               mergedAct[day] = Math.max(mergedAct[day] || 0, val || 0);
            }
            merged._activity = mergedAct;

            await this.room.storage.put(`garden:${playerName}`, merged);
            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
         } catch(e) {
            return new Response(JSON.stringify({ error: 'Failed to save garden' }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/garden') && request.method === 'GET') {
         try {
            const playerName = url.searchParams.get('player');
            if (!playerName) return new Response(JSON.stringify({ error: 'player param required' }), { status: 400, headers: corsHeaders });
            const data = await this.room.storage.get(`garden:${playerName}`);
            if (!data) return new Response(JSON.stringify({ error: 'No garden found for this player' }), { status: 404, headers: corsHeaders });
            return new Response(JSON.stringify({ success: true, gardenData: data }), { status: 200, headers: corsHeaders });
         } catch(e) {
            return new Response(JSON.stringify({ error: 'Failed to fetch garden' }), { status: 500, headers: corsHeaders });
         }
      }

      if (url.pathname.endsWith('/all-gardens') && request.method === 'GET') {
         try {
            // 快取:整包統計是重負載(大量玩家時要掃全部 garden)。60 秒內共用同一份,
            // 避免每個地圖 client 每次輪詢都重算(統計本來就變動慢)。
            if (this._allGardensCache && (Date.now() - this._allGardensCache.ts) < 60000) {
               return new Response(this._allGardensCache.body, { status: 200, headers: corsHeaders });
            }
            // 分頁只讀 garden: 前綴,每頁抽出精簡統計後就讓大物件釋放,
            // 避免一次 list() 整個 DO 把 isolate 記憶體撐爆。
            const fruitsMap = {};
            const statsMap = {};
            const now = Date.now();
            const DAY = 86400000;
            const PAGE = 25;
            let startAfter = undefined;
            while (true) {
               const opts = { prefix: 'garden:', limit: PAGE };
               if (startAfter) opts.startAfter = startAfter;
               const page = await this.room.storage.list(opts);
               if (!page || page.size === 0) break;
               let lastKey;
               for (const [key, val] of page.entries()) {
                  lastKey = key;
                  const playerName = key.slice('garden:'.length);
                  let total = 0, plants = 0, maxGridIndex = -1, activity7d = 0;
                  if (typeof val === 'object' && val !== null) {
                     for (const [vk, vd] of Object.entries(val)) {
                         if (vk === '_activity') {
                            // _activity: { 'YYYY-MM-DD': points } — 加總最近 7 天
                            if (vd && typeof vd === 'object') {
                               for (const [dateStr, pts] of Object.entries(vd)) {
                                  const ts = Date.parse(dateStr + 'T00:00:00');
                                  if (!isNaN(ts) && (now - ts) < 7 * DAY) activity7d += (pts || 0);
                               }
                            }
                            continue;
                         }
                         if (!vd || typeof vd !== 'object') continue;
                         plants++;
                         total += vd.fruits || 0;
                         if (typeof vd.gridIndex === 'number' && vd.gridIndex > maxGridIndex) maxGridIndex = vd.gridIndex;
                     }
                  }
                  fruitsMap[playerName] = total;
                  statsMap[playerName] = {
                     plants,
                     squares: Math.max(1, Math.ceil((maxGridIndex + 1) / 100)),
                     activity7d,
                  };
               }
               if (page.size < PAGE) break;
               startAfter = lastKey;
            }
            return new Response(JSON.stringify({ success: true, fruitsMap, statsMap }), { status: 200, headers: corsHeaders });
         } catch(e) {
            return new Response(JSON.stringify({ error: 'Failed to fetch all gardens' }), { status: 500, headers: corsHeaders });
         }
      }

      // DAU / new-user stats. Secret-gated admin GET (same secret as export).
      // ?date=YYYY-MM-DD optional (UTC+8 day); defaults to today.
      //   dau              — distinct identities that opened the app that day
      //   loggedIn/guests  — split of the above by identity type
      //   newRegistrations — accounts whose createdAt falls on that day
      // Note: dau/new counting is only accurate from the deploy date onward.
      if (url.pathname.endsWith('/dau-stats') && (request.method === 'GET' || request.method === 'POST')) {
         const secret = url.searchParams.get("secret");
         if (secret !== "vrain_export_2026") return new Response("Unauthorized", { status: 401 });
         try {
            const day = url.searchParams.get('date') || dauDay();
            const prefix = `dau:${day}:`;
            const map = await this.room.storage.list({ prefix });
            let loggedIn = 0, guests = 0;
            for (const key of map.keys()) {
               if (key.slice(prefix.length).startsWith('u:')) loggedIn++; else guests++;
            }
            const users = await this.room.storage.list({ prefix: 'user:' });
            let newRegistrations = 0;
            for (const v of users.values()) {
               if (v && typeof v.createdAt === 'string') {
                  const t = Date.parse(v.createdAt);
                  if (!isNaN(t) && dauDay(t) === day) newRegistrations++;
               }
            }
            return new Response(JSON.stringify({ date: day, dau: map.size, loggedIn, guests, newRegistrations }), { status: 200, headers: corsHeaders });
         } catch(e) {
            return new Response(JSON.stringify({ error: 'Failed to compute stats' }), { status: 500, headers: corsHeaders });
         }
      }

      // Export Users (Non-sensitive). Lives here, NOT in the POST-only block
      // above — this is an admin GET call, so gating it on POST made it
      // unreachable (it 404'd via GET). Accept both methods to be safe.
      if (url.pathname.endsWith('/export-users') && (request.method === 'GET' || request.method === 'POST')) {
         const secret = url.searchParams.get("secret");
         if (secret !== "vrain_export_2026") return new Response("Unauthorized", { status: 401 });
         try {
            const list = await this.room.storage.list({ prefix: "user:" });
            const users = [];
            for (const [key, value] of list) {
               if (value.email) {
                  users.push({
                     email: value.email,
                     name: value.name || value.skoolName || "Unknown",
                     isPremium: value.isPremium || false
                  });
               }
            }
            return new Response(JSON.stringify(users), { status: 200, headers: corsHeaders });
         } catch(e) {
            return new Response(JSON.stringify({ error: 'System error' }), { status: 500, headers: corsHeaders });
         }
      }


      return new Response("Not Found API Route", { status: 404, headers: corsHeaders });

    }

    // Default route for other random requests to gameplay rooms (if any)
    return new Response("VerseRain Gameplay Room HTTP endpoint OK", { status: 200 });
  }

  onConnect(conn, ctx) {
    // Player connected to the room
    const url = new URL(ctx.request.url);
    const name = url.searchParams.get("name") || "Player" + Math.floor(Math.random() * 100);
    const requestedRole = url.searchParams.get("role") || "player";
    const requestedMode = url.searchParams.get("mode");
    const playerKey = url.searchParams.get("playerKey") || conn.id;
    const requestedTeamCount = parseInt(url.searchParams.get("teamCount") || "", 10);
    const hostWantsToPlay = url.searchParams.get("hostPlays") === '1';
    if (!this.state.matchType) {
      this.state.matchType = requestedMode === 'individual' ? 'individual' : 'team';
    }
    if (this.state.matchType === 'team' && requestedRole === 'host' && Number.isFinite(requestedTeamCount)) {
      this.setTeamCount(requestedTeamCount);
    } else if (!this.state.teams) {
      this.setTeamCount(this.state.teamCount || 9);
    }
    // Remember whether the team-room host opted to also compete (vs. pure teacher/controller).
    if (this.state.matchType === 'team' && requestedRole === 'host') {
      this.state.hostPlays = hostWantsToPlay;
    }
    
    // Team rooms use a teacher/controller host that is not counted as a player.
    if (this.state.matchType === 'team' && requestedRole === 'host' && (!this.state.host || !this.state.hostConnected || this.state.hostName === name)) {
      this.state.host = conn.id;
      this.state.hostName = name;
    } else if (!this.state.host) {
      this.state.host = conn.id;
      this.state.hostName = name;
    }

    const isTeamHostController = this.state.matchType === 'team' && requestedRole === 'host' && this.state.host === conn.id;
    if (isTeamHostController) {
      this.state.hostName = name;
      this.state.hostConnected = true;
      if (!this.state.hostPlays) {
        // Pure teacher/controller host — not counted as a player.
        console.log(`[PARTY] Room [${this.room.id}] - Teacher host connected: ${name} (${conn.id})`);
        this.broadcastState();
        return;
      }
      // Host opted to compete too — fall through to be registered as a player below
      // (they remain this.state.host, so they keep host controls like starting the game).
      console.log(`[PARTY] Room [${this.room.id}] - Playing host connected: ${name} (${conn.id})`);
    }

    const existingEntry = Object.entries(this.state.players || {}).find(([, player]) => player.playerKey === playerKey);
    if (existingEntry) {
      const [oldId, existingPlayer] = existingEntry;
      if (oldId !== conn.id) {
        delete this.state.players[oldId];
        (this.state.campaignResults || []).forEach(round => {
          if (round.scores?.[oldId] !== undefined) {
            round.scores[conn.id] = Math.max(round.scores[conn.id] || 0, round.scores[oldId] || 0);
            delete round.scores[oldId];
          }
        });
      }
      this.state.players[conn.id] = {
        ...existingPlayer,
        id: conn.id,
        name,
        connected: true,
        score: this.state.status === 'playing' && this.state.playMode?.endsWith('_solo') ? (existingPlayer.score || 0) : 0,
        health: this.state.status === 'playing' && this.state.playMode?.endsWith('_solo') ? (existingPlayer.health ?? 3) : 3,
        seqIndex: this.state.status === 'playing' && this.state.playMode?.endsWith('_solo') ? (existingPlayer.seqIndex || 0) : 0,
        isFinished: this.state.status === 'playing' && this.state.playMode?.endsWith('_solo') ? Boolean(existingPlayer.isFinished) : false,
        versesCompleted: this.state.status === 'playing' && this.state.playMode?.endsWith('_solo') ? (existingPlayer.versesCompleted || 0) : 0,
        playerKey
      };
    } else {
      this.state.players[conn.id] = { 
        id: conn.id, 
        playerKey,
        name, 
        score: 0, 
        bestScore: 0,
        health: 3,
        seqIndex: 0,
        isFinished: false,
        connected: true,
        teamId: null,
        color: this.getPlayerColor(Object.keys(this.state.players).length)
      };
    }

    console.log(`[PARTY] Room [${this.room.id}] - Player joined: ${name} (${conn.id}) - Host: ${this.state.host === conn.id}`);
    console.log(`[PARTY] Room [${this.room.id}] - Total players in room: ${Object.keys(this.state.players).length}`);
    this.broadcastState();
  }

  onClose(conn) {
    console.log(`[PARTY] Player left: ${conn.id}`);
    if (this.state.players[conn.id]) {
      this.state.players[conn.id].connected = false;
    }
    // A playing host is in both players and host — mark host disconnected regardless.
    if (this.state.host === conn.id && this.state.matchType === 'team') {
      this.state.hostConnected = false;
    }
    
    // If hose leaves, maybe reassign host or just end game. For now, just mark disconnected.
    this.broadcastState();
  }

  onMessage(message, sender) {
    try {
      const data = JSON.parse(message);

      if (data.type === 'PING') {
        sender.send(JSON.stringify({ type: 'PONG', ts: data.ts }));
        return;
      }

      // 即時脈動:某玩家剛聆聽/挑戰/完成一節經文 → 廣播給同房所有人,
      // 讓地圖觀看者從那個點盪出光波。輕量防洪:每連線最多每 400ms 一次。
      if (data.type === 'PULSE') {
        const nowTs = Date.now();
        if (!this._lastPulse) this._lastPulse = {};
        if (nowTs - (this._lastPulse[sender.id] || 0) < 400) return;
        this._lastPulse[sender.id] = nowTs;
        this.room.broadcast(JSON.stringify({ type: 'PULSE', name: data.name, action: data.action, ts: nowTs }));
        return;
      }

      if (data.type === 'INIT_GAME') {
        // Host selects the board phase
        if (sender.id === this.state.host) {
          console.log(`[PARTY] Game initialized by host, moving to ready check.`);
          this.state.status = 'ready_check';
          this.state.matchType = this.state.matchType || data.matchType || 'individual';
          if (!this.state.teams) this.setTeamCount(this.state.teamCount || data.teamCount || 9);
          this.state.blocks = data.blocks;
          this.state.currentSeqIndex = 0;
          this.state.verseRef = data.verseRef;
          this.state.verseText = data.verseText;
          this.state.playMode = data.playMode;
          this.state.distractionLevel = data.distractionLevel;
          this.state.phrases = data.phrases;
          this.state.campaignQueue = data.campaignQueue || [];
          this.state.campaignResults = [];
          
          // Reset scores, health, and readiness
          Object.values(this.state.players).forEach(p => {
             p.score = 0;
             p.bestScore = 0;
             p.health = 3;
             p.isReady = false;
             p.isFinished = false;
             p.seqIndex = 0;
             p.versesCompleted = 0;
          });
          
          this.broadcastState();
        }
      }

      if (data.type === 'SELECT_TEAM' && this.state.matchType === 'team' && ['waiting', 'ready_check', 'playing'].includes(this.state.status)) {
        const player = this.state.players[sender.id];
        const teamExists = (this.state.teams || []).some(team => team.id === data.teamId);
        if (player && teamExists && !player.teamId) {
          player.teamId = data.teamId;
          console.log(`[PARTY] Player ${player.name} joined team ${data.teamId}`);
          this.broadcastState();
        }
      }

      if (data.type === 'NEXT_CAMPAIGN_ROUND' && sender.id === this.state.host) {
          console.log(`[PARTY] Starting next campaign round: ${data.verseRef}`);
          this.state.status = 'playing';
          this.state.blocks = data.blocks;
          this.state.currentSeqIndex = 0;
          this.state.verseRef = data.verseRef;
          this.state.verseText = data.verseText;
          this.state.phrases = data.phrases;
          
          // Reset player scores and health ONLY for this new round!
          Object.values(this.state.players).forEach(p => {
             p.score = 0;
             p.health = 3;
             p.isFinished = false;
             p.seqIndex = 0;
          });
          
          this.broadcastState();
      }

      if (data.type === 'PLAYER_READY' && this.state.status === 'ready_check') {
         if (this.state.players[sender.id]) {
            if (this.state.matchType === 'team' && !this.state.players[sender.id].teamId) {
              return;
            }
            this.state.players[sender.id].isReady = true;
            console.log(`[PARTY] Player ${this.state.players[sender.id].name} is ready!`);
            
            // We no longer strictly wait for all players to automatically start the game,
            // However, we still record readiness. Let the host start it manually.
            this.broadcastState();
         }
      }

      if (data.type === 'HOST_START_GAME' && this.state.status === 'ready_check' && sender.id === this.state.host) {
         if (this.state.matchType === 'team' && !this.canStartTeamGame()) {
            console.log(`[PARTY] Team game start blocked until at least one player has chosen a team.`);
            this.broadcastState();
            return;
         }
         console.log(`[PARTY] Host forced start game!`);
         this.state.status = 'playing';
         this.state.currentSeqIndex = 0;
         
         // Mark everyone as ready so intermission/history views look clean
         Object.values(this.state.players).forEach(p => p.isReady = true);
         this.broadcastState();
      }

      if (data.type === 'CLICK_BLOCK' && this.state.status === 'playing') {
        if (this.state.playMode === 'square_solo') return; // Handled locally in square_solo

        const { blockId } = data;
        const block = this.state.blocks.find(b => b.id === blockId);
        
        // Removed health <= 0 early return so players can always finish the verse

        if (block && !block.claimedBy) {
          if (block.seqIndex === this.state.currentSeqIndex || block.text === this.state.phrases[this.state.currentSeqIndex]) {
            // Correct click! The referee approves it.
            block.claimedBy = sender.id;
            block.claimedByName = this.state.players[sender.id].name;
            this.state.players[sender.id].score += 100;
            this.state.currentSeqIndex++;
            console.log(`[PARTY] Block claimed: ${block.text} by ${block.claimedByName}`);

            // Fast broadcast the specific claim event to trigger CSS flash animations
            this.room.broadcast(JSON.stringify({
              type: 'BLOCK_CLAIMED',
              blockId: block.id,
              blockText: block.text,
              claimedBy: sender.id,
              claimedByName: this.state.players[sender.id].name,
              nextSeq: this.state.currentSeqIndex
            }));
            
            // Check absolute game completion
            if (this.state.currentSeqIndex >= this.state.phrases.length) {
               console.log(`[PARTY] Game Over! All phrases completed.`);
               
               if (!this.state.campaignResults) this.state.campaignResults = [];
               this.state.campaignResults.push({
                   verseRef: this.state.verseRef,
                   scores: Object.fromEntries(Object.values(this.state.players).map(p => [p.id, p.score]))
               });
               
               if (this.state.campaignQueue && this.state.campaignQueue.length > 1) {
                   this.state.campaignQueue.shift();
                   this.state.status = 'intermission';
               } else {
                   this.state.status = 'finished';
               }
               this.broadcastState();
            } else {
               // Dynamic Server-Side Block Replenishment for VerseSquare
               if (this.state.playMode.startsWith('square')) {
                  const maxGridSize = this.state.distractionLevel <= 1 ? 4 : 9;
                  const fakesCount = this.state.distractionLevel > 0 ? this.state.distractionLevel : 0;
                  const nextSpawnIndex = this.state.currentSeqIndex + (maxGridSize - fakesCount);
                  
                  if (nextSpawnIndex < this.state.phrases.length) {
                      // Delayed refill to allow CSS animation to play on clients
                      setTimeout(() => {
                          if (this.state.status !== 'playing') return;
                          
                          const blockIndex = this.state.blocks.findIndex(b => b.id === block.id);
                          if (blockIndex !== -1) {
                              this.state.blocks[blockIndex] = {
                                  id: Math.random().toString(36).substr(2, 9),
                                  text: this.state.phrases[nextSpawnIndex],
                                  seqIndex: nextSpawnIndex,
                                  isSquare: true,
                                  error: false,
                                  correct: false,
                                  hidden: false
                              };
                              this.broadcastState();
                          }
                      }, 400); 
                  } else {
                      // No more phrases remaining. Wait 400ms for CSS to finish, then hide the block instead of leaving a stuck clone.
                      setTimeout(() => {
                          if (this.state.status !== 'playing') return;
                          const blockIndex = this.state.blocks.findIndex(b => b.id === block.id);
                          if (blockIndex !== -1) {
                              this.state.blocks[blockIndex].hidden = true;
                              this.broadcastState();
                          }
                      }, 400);
                  }
               } else {
                  this.broadcastState(); // For future modes
               }
            }
          } else if (block.seqIndex !== -1) { // Ignore clicks on blank spaces or wrong words
             // Incorrect click penalty
             this.state.players[sender.id].score = Math.max(0, this.state.players[sender.id].score - 50);
             this.state.players[sender.id].health = Math.max(0, (this.state.players[sender.id].health || 3) - 1);
             
             sender.send(JSON.stringify({
                type: 'MISTAKE',
                playerId: sender.id,
                blockId: block.id,
                health: this.state.players[sender.id].health,
                score: this.state.players[sender.id].score
             }));

             if (this.state.players[sender.id].health <= 0) {
                 console.log(`[PARTY] Player ${sender.id} health empty but match continues.`);
                 // Do not terminate the match! Players can finish it but their score won't go to leaderboard locally
             }
             
             // Broadcast the score/health change
             this.broadcastState();
          }
        }
      }

      if (data.type === 'PLAYER_PROGRESS' && this.state.status === 'playing' && this.state.playMode?.endsWith('_solo')) {
          // Skip if the player already finished all verses: a stray late progress update must not
          // un-finish them. isFinished is reset only when a new round / game starts
          // (INIT_GAME, NEXT_CAMPAIGN_ROUND, RESTART_GAME).
          if (this.state.players[sender.id] && !this.state.players[sender.id].isFinished) {
             this.state.players[sender.id].score = data.score;
             this.state.players[sender.id].health = data.health;
             this.state.players[sender.id].seqIndex = data.seqIndex;
             this.broadcastState();
          }
      }

      // Player finished one verse — record score and let them keep going on their own
      if (data.type === 'PLAYER_FINISHED_VERSE' && this.state.status === 'playing' && this.state.playMode?.endsWith('_solo')) {
          if (this.state.players[sender.id]) {
              const { verseRef, score, verseIndex } = data;
              console.log(`[PARTY] Player ${this.state.players[sender.id].name} finished verse ${verseIndex} (${verseRef}) score=${score}`);
              this.state.players[sender.id].versesCompleted = (this.state.players[sender.id].versesCompleted || 0) + 1;

              if (!this.state.campaignResults) this.state.campaignResults = [];
              const existing = this.state.campaignResults.find(r => r.verseIndex === verseIndex);
              if (existing) {
                  existing.scores[sender.id] = Math.max(existing.scores[sender.id] || 0, score || 0);
              } else {
                  this.state.campaignResults.push({ verseRef, verseIndex, scores: { [sender.id]: score } });
                  this.state.campaignResults.sort((a, b) => a.verseIndex - b.verseIndex);
              }
              const totalScore = this.getPlayerTotalScore(sender.id);
              this.state.players[sender.id].bestScore = Math.max(this.state.players[sender.id].bestScore || 0, totalScore);
              this.broadcastState();
          }
      }

      // Player finished ALL verses. Team rooms stay open until the host ends the match.
      if (data.type === 'PLAYER_FINISHED_ALL' && this.state.status === 'playing' && this.state.playMode?.endsWith('_solo')) {
          if (this.state.players[sender.id]) {
              console.log(`[PARTY] Player ${this.state.players[sender.id].name} finished ALL verses`);
              this.state.players[sender.id].isFinished = true;
              const totalScore = this.getPlayerTotalScore(sender.id);
              this.state.players[sender.id].bestScore = Math.max(this.state.players[sender.id].bestScore || 0, totalScore);

              const connectedPlayers = Object.values(this.state.players).filter(p => p.connected);
              const allFinished = connectedPlayers.length > 0 && connectedPlayers.every(p => p.isFinished);
              if (allFinished && this.state.matchType !== 'team') {
                  console.log(`[PARTY] All players finished all verses! Game over.`);
                  this.state.status = 'finished';
              }
              this.broadcastState();
          }
      }

      if (data.type === 'FORCE_END_GAME' && this.state.status === 'playing' && sender.id === this.state.host) {
          console.log(`[PARTY] Host forced end game.`);
          this.state.status = 'finished';
          if (this.state.matchType === 'team') this.state.teamResults = this.getTeamResults();
          this.broadcastState();
      }

      if (data.type === 'RESTART_GAME' && sender.id === this.state.host) {
        this.state.status = 'waiting';
        this.state.verseRef = null;
        this.state.verseText = null;
        this.state.blocks = [];
        this.state.currentSeqIndex = 0;
        this.state.phrases = [];
        this.state.campaignQueue = [];
        this.state.campaignResults = [];
        this.state.teamResults = [];
        // Reset player states
        Object.values(this.state.players).forEach(p => {
          p.isReady = false;
          p.score = 0;
          p.bestScore = 0;
          p.health = 3;
          p.isFinished = false;
          p.seqIndex = 0;
          p.versesCompleted = 0;
          if (this.state.matchType === 'team') p.teamId = null;
        });
        this.broadcastState();
      }

    } catch (e) {
      console.error("[PARTY] Message error", e);
    }
  }

  broadcastState() {
    if (this.state.matchType === 'team') {
      this.state.teams = this.state.teams || this.getDefaultTeams(this.state.teamCount || 9);
      this.state.teamResults = this.getTeamResults();
    }
    this.room.broadcast(JSON.stringify({
      type: 'STATE_UPDATE',
      state: this.state
    }));
  }
}
