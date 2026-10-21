// Map ripples (即時脈動): "someone just listened / played / finished here".
// A tab viewing the map holds the global-lobby socket and sends through it;
// every other tab sends a one-off POST instead, so the lobby's Durable
// Object can sleep (and stop billing) whenever nobody has the map open.
import { PARTY_DB } from './partyHost.js';

const LOBBY_URL = PARTY_DB.replace(/global-auth-db$/, 'global-lobby');
let lastPostAt = 0;

export function sendPulse(socket, name, action, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!name || !action) return;
  const payload = JSON.stringify({ type: 'PULSE', name, action });
  try {
    if (socket && socket.readyState === 1) { socket.send(payload); return; }
  } catch { /* fall through to POST */ }
  if (now() - lastPostAt < 2000) return;
  lastPostAt = now();
  try {
    // text/plain + no-cors: a "simple" request, so no CORS preflight.
    fetchImpl(LOBBY_URL, { method: 'POST', body: payload, mode: 'no-cors', keepalive: true }).catch(() => {});
  } catch { /* best effort */ }
}
