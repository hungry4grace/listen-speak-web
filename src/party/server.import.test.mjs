// PartyKit → PartyServer move (Oct 2026): /admin/export only on PartyKit and
// only to the admin token; /admin/import off by default, admin only, merges
// into what the new server holds and changes nothing on a second run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Server from './server.js';

const BASE = 'https://x.workers.dev/parties/main/global-auth-db';
function makeServer(room) {
  const map = new Map();
  const storage = {
    map,
    async get(k) { return map.has(k) ? map.get(k) : undefined; },
    async put(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
    async list({ prefix = '', start = '', limit = Infinity } = {}) {
      const keys = [...map.keys()].filter(k => k.startsWith(prefix) && k >= start).sort().slice(0, limit);
      return new Map(keys.map(k => [k, map.get(k)]));
    },
  };
  const srv = new Server({ id: 'global-auth-db', storage, ...room });
  return { srv, map };
}
const imp = async (srv, body, token = 'tok') => {
  const r = await srv.onRequest(new Request(`${BASE}/admin/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json().catch(() => null) };
};

test('export pages through every key, admin only, and never on the new server', async () => {
  const { srv, map } = makeServer({ env: { ADMIN_TOKEN: 'tok' } });
  for (let i = 0; i < 650; i++) map.set(`k:${String(i).padStart(4, '0')}`, { i });
  const get = async (q, token = 'tok', s = srv) => {
    const r = await s.onRequest(new Request(`${BASE}/admin/export${q}`, { headers: { 'x-admin-token': token } }));
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  assert.equal((await get('', 'wrong')).status, 401);
  const seen = [];
  let after = '';
  for (let guard = 0; guard < 10; guard++) {
    const r = await get(after ? `?after=${encodeURIComponent(after)}` : '');
    assert.equal(r.status, 200);
    seen.push(...r.body.entries.map(([k]) => k));
    if (!r.body.next) break;
    after = r.body.next;
  }
  assert.equal(seen.length, 650);
  assert.equal(new Set(seen).size, 650);
  const ps = makeServer({ env: { ADMIN_TOKEN: 'tok' }, partyserver: true });
  assert.equal((await get('', 'tok', ps.srv)).status, 404);
});

test('import is off unless MIGRATION_IMPORT is "on", and needs the admin token', async () => {
  const off = makeServer({ env: { ADMIN_TOKEN: 'tok' } });
  assert.equal((await imp(off.srv, { entries: [['verseset:a', { id: 'a' }]] })).status, 404);
  const on = makeServer({ env: { ADMIN_TOKEN: 'tok', MIGRATION_IMPORT: 'on' } });
  assert.equal((await imp(on.srv, { entries: [['verseset:a', { id: 'a' }]] }, 'wrong')).status, 401);
  assert.equal(off.map.size + on.map.size, 0);
});

test('import fills what is missing; the new server wins; twice changes nothing', async () => {
  const { srv, map } = makeServer({ env: { ADMIN_TOKEN: 'tok', MIGRATION_IMPORT: 'on' } });
  map.set('verseset:s1', { id: 's1', title: 'edited on new' });
  map.set('views:s1', 3);
  map.set('private-sets:A:p1::part:0', 'new-p1');
  const body = { entries: [
    ['user:a@b.com', { email: 'a@b.com', password: 'pbkdf2$1$x$y' }],
    ['verseset:s1', { id: 's1', title: 'old' }],
    ['verseset:s2', { id: 's2' }],
    ['views:s1', 40],
    ['private-sets:A:p1::part:0', 'old-0'], ['private-sets:A:p1::part:1', 'old-1'],
    ['private-sets:A:p2::part:0', 'old-p2'],
    ['reset:abc', { email: 'a@b.com' }],
    ['garden:A', { 'John 3:16': { stage: 3 } }],
  ] };
  const r = await imp(srv, body);
  assert.deepEqual(r.body, { success: true, written: 3, merged: 1, skipped: 5 });
  assert.equal(map.get('user:a@b.com').password, 'pbkdf2$1$x$y');
  assert.equal(map.get('verseset:s1').title, 'edited on new');
  assert.equal(map.get('views:s1'), 40);
  assert.equal(map.has('private-sets:A:p1::part:1'), false);
  assert.equal(map.get('private-sets:A:p2::part:0'), 'old-p2');
  for (const k of ['reset:abc', 'garden:A']) assert.equal(map.has(k), false);
  assert.deepEqual((await imp(srv, body)).body, { success: true, written: 0, merged: 0, skipped: 9 });
});
