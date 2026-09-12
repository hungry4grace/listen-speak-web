// Personal-voice visibility: who may see one recording, and the contributor
// index that drives every "who recorded for this set" listing.
//
// The stakes here are a user's own voice: a recording marked private must not
// be reachable by anyone browsing the set, while staying playable for whoever
// the owner handed a share link to. Recordings written before the flag existed
// have no `public` field and must keep working.
//
// Run: node --test src/party/server.voice.test.mjs

import assert from 'node:assert';
import { test } from 'node:test';
import Server, { isUserVoiceVisible, ownerIndexEntryFor } from './server.js';

const BASE = 'https://x.partykit.dev/parties/main/global-auth-db';

function makeServer(initial = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    map,
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
    async list(opts) {
      if (opts && opts.prefix) {
        const out = new Map();
        for (const [k, v] of map) if (k.startsWith(opts.prefix)) out.set(k, v);
        return out;
      }
      return map;
    },
  };
  return { srv: new Server({ id: 'global-auth-db', storage, env: {} }), storage };
}

const post = (srv, path, body) =>
  srv.onRequest(new Request(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
const get = (srv, path) => srv.onRequest(new Request(`${BASE}${path}`));

const OWNER = 'a'.repeat(16);
const STRANGER = 'b'.repeat(16);

// ── isUserVoiceVisible ────────────────────────────────────────────────────

test('a recording with no public field is visible — legacy rows predate the flag', () => {
  const legacy = { reference: 'John 3:16', voiceId: 'v_abc123' };
  assert.equal(isUserVoiceVisible(legacy, null, OWNER, null), true);
  assert.equal(isUserVoiceVisible(legacy, STRANGER, OWNER, null), true);
});

test('public: true is visible to anyone', () => {
  const pub = { voiceId: 'v_abc123', public: true };
  assert.equal(isUserVoiceVisible(pub, null, OWNER, null), true);
  assert.equal(isUserVoiceVisible(pub, STRANGER, OWNER, null), true);
});

test('private is hidden from a stranger and from an anonymous caller', () => {
  const priv = { voiceId: 'v_abc123', public: false };
  assert.equal(isUserVoiceVisible(priv, null, OWNER, null), false);
  assert.equal(isUserVoiceVisible(priv, STRANGER, OWNER, null), false);
});

test('private is visible to its owner', () => {
  const priv = { voiceId: 'v_abc123', public: false };
  assert.equal(isUserVoiceVisible(priv, OWNER, OWNER, null), true);
});

test('private is visible to whoever quotes its voiceId — that is the share link', () => {
  const priv = { voiceId: 'v_abc123', public: false };
  assert.equal(isUserVoiceVisible(priv, null, OWNER, 'v_abc123'), true);
  // A different recording's id must not unlock this one.
  assert.equal(isUserVoiceVisible(priv, null, OWNER, 'v_zzz999'), false);
});

test('no meta is never visible', () => {
  assert.equal(isUserVoiceVisible(null, OWNER, OWNER, null), false);
  assert.equal(isUserVoiceVisible(undefined, OWNER, OWNER, 'v_abc123'), false);
});

// ── ownerIndexEntryFor ────────────────────────────────────────────────────

test('index entry counts only public recordings', () => {
  const entry = ownerIndexEntryFor(null, [
    { public: true }, { public: false }, { public: true },
  ], 'Amy', '2026-01-01T00:00:00.000Z');
  assert.equal(entry.count, 2);
  assert.equal(entry.recordedBy, 'Amy');
});

test('legacy field-less recordings count as public', () => {
  const entry = ownerIndexEntryFor(null, [{ reference: 'John 3:16' }], 'Amy');
  assert.equal(entry.count, 1);
});

test('all-private means no index entry — a private-only recorder is not a contributor', () => {
  assert.equal(ownerIndexEntryFor(null, [{ public: false }, { public: false }], 'Amy'), null);
  assert.equal(ownerIndexEntryFor({ count: 3 }, [], 'Amy'), null);
});

test('moderation hide survives a recompute', () => {
  const entry = ownerIndexEntryFor({ hidden: true, recordedBy: 'Amy' }, [{ public: true }], '');
  assert.equal(entry.hidden, true);
  assert.equal(entry.recordedBy, 'Amy', 'falls back to the stored name when none is supplied');
});

// ── /sets/user-verse-voices ───────────────────────────────────────────────

const EMAIL = 'amy@example.com';
// sha256('amy@example.com').slice(0,16) — computed via the server's own helper
// in the test below rather than hard-coded, so the two can't drift apart.
async function ownerIdFor(srv, email) {
  const res = await post(srv, '/sets/user-verse-voice/set', {
    email, setId: 'probe', reference: 'probe', voiceId: 'v_probe1',
  });
  return (await res.json()).ownerId;
}

test('listing hides a private recording from a stranger but shows it to its owner', async () => {
  const { srv } = makeServer();
  const owner = await ownerIdFor(srv, EMAIL);

  await post(srv, '/sets/user-verse-voice/set', {
    email: EMAIL, setId: 's1', reference: 'John 3:16', voiceId: 'v_pub111', public: true,
  });
  await post(srv, '/sets/user-verse-voice/set', {
    email: EMAIL, setId: 's1', reference: 'John 3:17', voiceId: 'v_priv22', public: false,
  });

  // A stranger — this is the path every voice picker takes, carrying only the
  // ownerId, which is public information.
  const anon = await (await get(srv, `/sets/user-verse-voices?setId=s1&owner=${owner}`)).json();
  assert.deepEqual(Object.keys(anon.voices), ['John 3:16']);

  // The owner, identified by email.
  const mine = await (await get(srv, `/sets/user-verse-voices?setId=s1&owner=${owner}&email=${encodeURIComponent(EMAIL)}`)).json();
  assert.deepEqual(Object.keys(mine.voices).sort(), ['John 3:16', 'John 3:17']);

  // Someone else's email must not unlock it.
  const other = await (await get(srv, `/sets/user-verse-voices?setId=s1&owner=${owner}&email=${encodeURIComponent('bob@example.com')}`)).json();
  assert.deepEqual(Object.keys(other.voices), ['John 3:16']);
});

test('a listed contributor does not leak their private recordings on other verses', async () => {
  // The subtle case: one public recording makes you a contributor, and the
  // picker then loads your whole set — which used to serve your private ones.
  const { srv } = makeServer();
  const owner = await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_pub111', public: true });
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v2', voiceId: 'v_priv22', public: false });

  const contributors = await (await get(srv, '/sets/voice-contributors?setId=s1')).json();
  assert.equal(contributors.contributors.length, 1, 'still a contributor thanks to v1');

  const seen = await (await get(srv, `/sets/user-verse-voices?setId=s1&owner=${owner}`)).json();
  assert.deepEqual(Object.keys(seen.voices), ['v1'], 'v2 stays hidden');
});

test('a share link unlocks exactly the recording it names', async () => {
  const { srv } = makeServer();
  const owner = await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_priv11', public: false });
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v2', voiceId: 'v_priv22', public: false });

  const shared = await (await get(srv, `/sets/user-verse-voices?setId=s1&owner=${owner}&unlisted=v_priv11`)).json();
  assert.deepEqual(Object.keys(shared.voices), ['v1'], 'only the named recording, not the whole private set');
});

// ── /sets/user-verse-voice/visibility ─────────────────────────────────────

test('toggling to public adds the owner to the contributor index', async () => {
  // Without this, a default-private recording could never become discoverable:
  // /voice-refs and /voice-latest only walk owners present in the index.
  const { srv } = makeServer();
  await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_priv11', public: false });

  let contributors = await (await get(srv, '/sets/voice-contributors?setId=s1')).json();
  assert.equal(contributors.contributors.length, 0, 'private-only recorder is not listed');
  let refs = await (await get(srv, '/sets/voice-refs?setId=s1')).json();
  assert.deepEqual(refs.refs, []);

  const res = await post(srv, '/sets/user-verse-voice/visibility', { email: EMAIL, setId: 's1', reference: 'v1', public: true });
  assert.equal(res.status, 200);

  contributors = await (await get(srv, '/sets/voice-contributors?setId=s1')).json();
  assert.equal(contributors.contributors.length, 1, 'now discoverable');
  refs = await (await get(srv, '/sets/voice-refs?setId=s1')).json();
  assert.deepEqual(refs.refs, ['v1']);
});

test('toggling the last public recording back to private removes the contributor', async () => {
  const { srv } = makeServer();
  await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_pub111', public: true });

  await post(srv, '/sets/user-verse-voice/visibility', { email: EMAIL, setId: 's1', reference: 'v1', public: false });

  const contributors = await (await get(srv, '/sets/voice-contributors?setId=s1')).json();
  assert.equal(contributors.contributors.length, 0);
  const refs = await (await get(srv, '/sets/voice-refs?setId=s1')).json();
  assert.deepEqual(refs.refs, []);
});

test('only the owner can change visibility', async () => {
  const { srv } = makeServer();
  await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_pub111', public: true });

  // A different email hashes to a different ownerId, so it addresses a key
  // that doesn't exist rather than someone else's recording.
  const res = await post(srv, '/sets/user-verse-voice/visibility', {
    email: 'bob@example.com', setId: 's1', reference: 'v1', public: false,
  });
  assert.equal(res.status, 404);

  const refs = await (await get(srv, '/sets/voice-refs?setId=s1')).json();
  assert.deepEqual(refs.refs, ['v1'], 'untouched');
});

test('visibility requires an explicit boolean', async () => {
  const { srv } = makeServer();
  await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_pub111', public: true });
  const res = await post(srv, '/sets/user-verse-voice/visibility', { email: EMAIL, setId: 's1', reference: 'v1' });
  assert.equal(res.status, 400, 'a missing flag must not be read as "make it private"');
});

// ── re-recording ──────────────────────────────────────────────────────────

test('re-recording replaces the previous take and re-derives visibility', async () => {
  const { srv } = makeServer();
  const owner = await ownerIdFor(srv, EMAIL);
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_pub111', public: true });
  await post(srv, '/sets/user-verse-voice/set', { email: EMAIL, setId: 's1', reference: 'v1', voiceId: 'v_new222', public: false });

  const mine = await (await get(srv, `/sets/user-verse-voices?setId=s1&owner=${owner}&email=${encodeURIComponent(EMAIL)}`)).json();
  assert.equal(Object.keys(mine.voices).length, 1, 'one recording per verse');
  assert.equal(mine.voices.v1.voiceId, 'v_new222', 'the newer take wins');
  assert.equal(mine.voices.v1.public, false);

  // The old ±1 bookkeeping only incremented on public writes and never
  // decremented on a public→private re-record, leaving a phantom contributor.
  const contributors = await (await get(srv, '/sets/voice-contributors?setId=s1')).json();
  assert.equal(contributors.contributors.length, 0);
});
