// Tests the real Server class register/verify-email/login endpoints for
// canonical personalCode binding (fixes网页/App 果子不一致).

import assert from 'node:assert';
import Server from './server.js';

const BASE = 'https://x.partykit.dev/parties/main/global-auth-db';

function makeServer(initial = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    map,
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
    async list() { return map; },
  };
  const srv = new Server({ id: 'global-auth-db', storage });
  srv.sendEmail = async () => ({ ok: true }); // stub mail
  return { srv, storage };
}
const req = (p, b, m = 'POST') => new Request(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });
const json = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { __raw: t }; } };

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

console.log('personalCode canonical binding:');

await test('register binds the device code to the account', async () => {
  const { srv, storage } = makeServer();
  await srv.onRequest(req('/register', { email: 'a@x.com', password: 'pw', nickname: 'A', personalCode: 'CodeAAA222' }));
  const user = storage.map.get('user:a@x.com');
  assert.strictEqual(user.personalCode, 'CodeAAA222');
});

await test('verify-email returns the bound code', async () => {
  const { srv, storage } = makeServer();
  await srv.onRequest(req('/register', { email: 'b@x.com', password: 'pw', nickname: 'B', personalCode: 'CodeBBB222' }));
  const code = storage.map.get('user:b@x.com').verificationCode;
  const res = await srv.onRequest(req('/verify-email', { email: 'b@x.com', code }));
  const data = await json(res);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(data.user.personalCode, 'CodeBBB222');
});

await test('SECOND device logging in gets the SAME canonical code (not its own)', async () => {
  const { srv, storage } = makeServer();
  // device 1 registers + verifies with its local code
  await srv.onRequest(req('/register', { email: 'c@x.com', password: 'pw', nickname: 'C', personalCode: 'Device1AAA2' }));
  const vcode = storage.map.get('user:c@x.com').verificationCode;
  await srv.onRequest(req('/verify-email', { email: 'c@x.com', code: vcode }));
  // device 2 logs in carrying ITS OWN different local code
  const res = await srv.onRequest(req('/login', { email: 'c@x.com', password: 'pw', personalCode: 'Device2BBB2' }));
  const data = await json(res);
  assert.strictEqual(data.user.personalCode, 'Device1AAA2', 'device 2 must receive the account canonical code, not its own');
  // and the account record must NOT have been overwritten
  assert.strictEqual(storage.map.get('user:c@x.com').personalCode, 'Device1AAA2');
});

await test('LEGACY account (no stored code) gets late-bound on first login', async () => {
  // Simulate an old verified user created before codes were stored.
  const { srv, storage } = makeServer({
    'user:d@x.com': { email: 'd@x.com', password: 'pw', name: 'D', isPremium: false, verified: true },
  });
  const res = await srv.onRequest(req('/login', { email: 'd@x.com', password: 'pw', personalCode: 'LegacyAAA22' }));
  const data = await json(res);
  assert.strictEqual(data.user.personalCode, 'LegacyAAA22');
  assert.strictEqual(storage.map.get('user:d@x.com').personalCode, 'LegacyAAA22');
});

await test('login without a code does not wipe an existing binding', async () => {
  const { srv, storage } = makeServer({
    'user:e@x.com': { email: 'e@x.com', password: 'pw', name: 'E', isPremium: false, verified: true, personalCode: 'KeepThis22' },
  });
  const res = await srv.onRequest(req('/login', { email: 'e@x.com', password: 'pw' }));
  const data = await json(res);
  assert.strictEqual(data.user.personalCode, 'KeepThis22');
  assert.strictEqual(storage.map.get('user:e@x.com').personalCode, 'KeepThis22');
});

console.log(`\n${passed} assertions passed.`);
