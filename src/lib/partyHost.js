// Backend location, shared by every module that talks to it: the
// listenspeak-party Worker on our own Cloudflare account (PartyServer — moved
// off PartyKit's hosted platform in Oct 2026). In dev you can point the app at
// a local `npm run dev:party -- --port 1999` with
//   localStorage.setItem('ls_party_host', 'http://127.0.0.1:1999')
// and reload.
const override = (() => {
  try { return import.meta.env.DEV && typeof localStorage !== 'undefined' ? localStorage.getItem('ls_party_host') : null; } catch { return null; }
})();
export const PARTY_ORIGIN = override || 'https://listenspeak-party.verserain.workers.dev';
export const PARTY_WS_HOST = PARTY_ORIGIN.replace(/^https?:\/\//, '');
export const PARTY_DB = `${PARTY_ORIGIN}/parties/main/global-auth-db`;
