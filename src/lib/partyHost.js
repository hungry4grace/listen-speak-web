// Backend (PartyKit) location, shared by every module that talks to it.
// In dev you can point the app at a local `npx partykit dev --port 1999` with
//   localStorage.setItem('ls_party_host', 'http://127.0.0.1:1999')
// and reload; production always uses the deployed listenspeak-party project.
const override = (() => {
  try { return import.meta.env.DEV && typeof localStorage !== 'undefined' ? localStorage.getItem('ls_party_host') : null; } catch { return null; }
})();
export const PARTY_ORIGIN = override || 'https://listenspeak-party.hungry4grace.partykit.dev';
export const PARTY_WS_HOST = PARTY_ORIGIN.replace(/^https?:\/\//, '');
export const PARTY_DB = `${PARTY_ORIGIN}/parties/main/global-auth-db`;
