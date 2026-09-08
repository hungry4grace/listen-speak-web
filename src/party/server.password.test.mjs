// Password storage: hashing, legacy-cleartext migration, and the reset-link
// flow that replaced emailing the password back to the user.
//
// Run: node --test src/party/server.password.test.mjs

import assert from 'node:assert';
import { test } from 'node:test';
import Server, {
  hashPassword, verifyPassword, isHashedPassword, sha256Hex, generateResetToken,
} from './server.js';

const BASE = 'https://x.partykit.dev/parties/main/global-auth-db';

function makeServer(initial = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    map,
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
    // Real PartyKit storage.list honours { prefix }; mirror that so a rename's
    // prefix scan (migratePlayerName) doesn't sweep unrelated keys.
    async list(opts) {
      if (opts && opts.prefix) {
        const out = new Map();
        for (const [k, v] of map) if (k.startsWith(opts.prefix)) out.set(k, v);
        return out;
      }
      return map;
    },
  };
  const srv = new Server({ id: 'global-auth-db', storage, env: {} });
  const sent = [];
  srv.sendEmail = async (to, subject, html) => { sent.push({ to, subject, html }); return { success: true }; };
  return { srv, storage, sent };
}

const post = (srv, path, body) =>
  srv.onRequest(new Request(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

// ── hashing primitives ────────────────────────────────────────────────────

test('hash is salted: same password hashes differently every time', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.notStrictEqual(a, b, 'two hashes of the same password must differ');
  assert.ok(isHashedPassword(a));
  assert.ok(await verifyPassword('correct horse', a));
  assert.ok(await verifyPassword('correct horse', b));
});

test('hash does not contain the password', async () => {
  const h = await hashPassword('sup3rSecret');
  assert.ok(!h.includes('sup3rSecret'));
});

test('wrong password fails, empty password never passes', async () => {
  const h = await hashPassword('right');
  assert.strictEqual(await verifyPassword('wrong', h), false);
  assert.strictEqual(await verifyPassword('', h), false);
  assert.strictEqual(await verifyPassword(null, h), false);
  assert.strictEqual(await verifyPassword('right', ''), false);
  assert.strictEqual(await verifyPassword('right', null), false);
});

test('malformed stored hashes are rejected, not crashed on', async () => {
  for (const bad of ['pbkdf2$', 'pbkdf2$abc$def$ghi', 'pbkdf2$1000$!!!$!!!', 'pbkdf2$0$AA$AA']) {
    assert.strictEqual(await verifyPassword('x', bad), false, `should reject ${bad}`);
  }
});

test('legacy cleartext rows still verify (so existing users can log in)', async () => {
  assert.ok(!isHashedPassword('plaintext123'));
  assert.ok(await verifyPassword('plaintext123', 'plaintext123'));
  assert.strictEqual(await verifyPassword('nope', 'plaintext123'), false);
});

// ── endpoint behaviour ────────────────────────────────────────────────────

test('register stores a hash, never the password', async () => {
  const { srv, storage } = makeServer();
  const res = await post(srv, '/register', { email: 'A@Example.com', password: 'hunter2', nickname: 'Ann' });
  assert.strictEqual(res.status, 200);
  const user = storage.map.get('user:a@example.com');
  assert.ok(isHashedPassword(user.password), 'stored password must be hashed');
  assert.ok(!JSON.stringify(user).includes('hunter2'), 'cleartext must not appear anywhere on the record');
  assert.ok(await verifyPassword('hunter2', user.password));
});

test('login migrates a legacy cleartext row to a hash in place', async () => {
  const { srv, storage } = makeServer({
    'user:old@example.com': { email: 'old@example.com', password: 'oldpass', name: 'Old', verified: true },
  });
  const res = await post(srv, '/login', { email: 'old@example.com', password: 'oldpass' });
  assert.strictEqual(res.status, 200, 'legacy user must still be able to log in');

  const user = storage.map.get('user:old@example.com');
  assert.ok(isHashedPassword(user.password), 'row should be upgraded on successful login');
  assert.ok(await verifyPassword('oldpass', user.password), 'same password must still work after upgrade');

  // And the upgraded row keeps working on the next login.
  assert.strictEqual((await post(srv, '/login', { email: 'old@example.com', password: 'oldpass' })).status, 200);
  assert.strictEqual((await post(srv, '/login', { email: 'old@example.com', password: 'wrong' })).status, 401);
});

test('a failed login does NOT migrate or alter the stored password', async () => {
  const { srv, storage } = makeServer({
    'user:old@example.com': { email: 'old@example.com', password: 'oldpass', name: 'Old', verified: true },
  });
  assert.strictEqual((await post(srv, '/login', { email: 'old@example.com', password: 'guess' })).status, 401);
  assert.strictEqual(storage.map.get('user:old@example.com').password, 'oldpass');
});

test('forgot-password emails a link and never the password', async () => {
  const { srv, storage, sent } = makeServer({
    'user:a@example.com': { email: 'a@example.com', password: 'cleartextpw', name: 'Ann', verified: true },
  });
  const res = await post(srv, '/forgot-password', { email: 'a@example.com' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(sent.length, 1);
  assert.ok(!sent[0].html.includes('cleartextpw'), 'the email must not contain the password');
  assert.ok(sent[0].html.includes('resetToken='), 'the email must carry a reset link');

  // Only the token HASH is persisted.
  const keys = [...storage.map.keys()].filter((k) => k.startsWith('reset:'));
  assert.strictEqual(keys.length, 1);
  const rawToken = /resetToken=([a-f0-9]+)/.exec(sent[0].html)[1];
  assert.strictEqual(keys[0], `reset:${await sha256Hex(rawToken)}`);
  assert.ok(!storage.map.has(`reset:${rawToken}`), 'raw token must never be a storage key');
});

test('reset-password sets a new hashed password and burns the token', async () => {
  const { srv, storage, sent } = makeServer({
    'user:a@example.com': { email: 'a@example.com', password: 'oldpw', name: 'Ann', verified: false },
  });
  await post(srv, '/forgot-password', { email: 'a@example.com' });
  const token = /resetToken=([a-f0-9]+)/.exec(sent[0].html)[1];

  const res = await post(srv, '/reset-password', { token, newPassword: 'brandNew1' });
  assert.strictEqual(res.status, 200);

  const user = storage.map.get('user:a@example.com');
  assert.ok(isHashedPassword(user.password));
  assert.ok(await verifyPassword('brandNew1', user.password));
  assert.strictEqual(user.verified, true, 'proving mailbox control also verifies the account');

  // New password works, old one does not.
  assert.strictEqual((await post(srv, '/login', { email: 'a@example.com', password: 'brandNew1' })).status, 200);
  assert.strictEqual((await post(srv, '/login', { email: 'a@example.com', password: 'oldpw' })).status, 401);

  // Single use.
  assert.strictEqual((await post(srv, '/reset-password', { token, newPassword: 'again123' })).status, 400);
});

test('expired reset token is refused', async () => {
  const { srv, storage } = makeServer({
    'user:a@example.com': { email: 'a@example.com', password: 'oldpw', name: 'Ann', verified: true },
  });
  const token = generateResetToken();
  storage.map.set(`reset:${await sha256Hex(token)}`, { email: 'a@example.com', expiresAt: Date.now() - 1000 });

  const res = await post(srv, '/reset-password', { token, newPassword: 'brandNew1' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(storage.map.get('user:a@example.com').password, 'oldpw', 'password must be untouched');
});

test('unknown / short-password resets are refused', async () => {
  const { srv } = makeServer({
    'user:a@example.com': { email: 'a@example.com', password: 'oldpw', name: 'Ann', verified: true },
  });
  assert.strictEqual((await post(srv, '/reset-password', { token: 'deadbeef', newPassword: 'brandNew1' })).status, 400);
  assert.strictEqual((await post(srv, '/reset-password', { token: 'deadbeef' })).status, 400);
  assert.strictEqual((await post(srv, '/reset-password', { token: 'x', newPassword: '12345' })).status, 400);
});

test('update-profile response never carries the credential field', async () => {
  const { srv, storage } = makeServer();
  await post(srv, '/register', { email: 'a@example.com', password: 'hunter2', nickname: 'Ann' });
  const res = await post(srv, '/update-profile', { email: 'a@example.com', password: 'hunter2', newPassword: 'hunter3' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(!('password' in body.user), 'password must be stripped from the response');
  assert.ok(!JSON.stringify(body).includes('hunter3'));
  assert.ok(await verifyPassword('hunter3', storage.map.get('user:a@example.com').password));
});

// ── OAuth accounts (no password) can edit their profile ────────────────────

test('OAuth account updates name/city/country WITHOUT a password', async () => {
  const { srv, storage } = makeServer({
    'user:g@example.com': { email: 'g@example.com', password: null, oauthProvider: 'google', name: 'Old', verified: true },
  });
  const res = await post(srv, '/update-profile', { email: 'g@example.com', newName: 'New', newCity: 'Taipei', newCountry: 'Taiwan' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  const saved = storage.map.get('user:g@example.com');
  assert.strictEqual(saved.name, 'New');
  assert.strictEqual(saved.city, 'Taipei');
  assert.strictEqual(saved.country, 'Taiwan');
  assert.strictEqual(saved.password, null, 'OAuth account keeps password:null');
});

test('OAuth account update ignores a supplied newPassword (stays password-less)', async () => {
  const { srv, storage } = makeServer({
    'user:g@example.com': { email: 'g@example.com', password: null, oauthProvider: 'apple', name: 'Old', verified: true },
  });
  const res = await post(srv, '/update-profile', { email: 'g@example.com', newName: 'New', newPassword: 'sneaky1' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(storage.map.get('user:g@example.com').password, null, 'newPassword must not set a password on an OAuth account');
});

test('password account still requires the current password', async () => {
  const { srv } = makeServer();
  await post(srv, '/register', { email: 'p@example.com', password: 'hunter2', nickname: 'Pat' });
  // Missing password → 400; wrong password → 401; both leave the row unchanged.
  assert.strictEqual((await post(srv, '/update-profile', { email: 'p@example.com', newName: 'X' })).status, 400);
  assert.strictEqual((await post(srv, '/update-profile', { email: 'p@example.com', password: 'wrong', newName: 'X' })).status, 401);
});

// ── OAuth session marker (Option A): trust the client's login method ────────

test('a LINE session (authProvider) updates a password account without its password', async () => {
  // David's case: the record has a password and no oauthProvider yet, but the
  // request comes from a LINE session. Update succeeds, password is untouched,
  // and oauthProvider self-heals so the account is classified correctly later.
  const { srv, storage } = makeServer();
  await post(srv, '/register', { email: 'd@example.com', password: 'hunter2', nickname: 'David' });
  const before = storage.map.get('user:d@example.com').password;
  const res = await post(srv, '/update-profile', { email: 'd@example.com', authProvider: 'line', newName: 'David(LINE)', newCity: 'New Taipei' });
  assert.strictEqual(res.status, 200);
  const saved = storage.map.get('user:d@example.com');
  assert.strictEqual(saved.name, 'David(LINE)');
  assert.strictEqual(saved.city, 'New Taipei');
  assert.strictEqual(saved.password, before, 'password must be left untouched');
  assert.strictEqual(saved.oauthProvider, 'line', 'oauthProvider self-heals from the client hint');
});

test('update-profile on an unknown email returns 404 (not the password error)', async () => {
  const { srv } = makeServer();
  const res = await post(srv, '/update-profile', { email: 'nobody@example.com', newName: 'X' });
  assert.strictEqual(res.status, 404);
});
