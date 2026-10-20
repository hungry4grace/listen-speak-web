import { test } from 'node:test';
import assert from 'node:assert/strict';
import Server from './server.js';

test('a POSTed ripple reaches open maps, and is a quiet no-op when nobody watches', async () => {
  const post = (body) => new Request('https://x.workers.dev/parties/main/global-lobby', { method: 'POST', body: JSON.stringify(body) });
  const sent = [];
  let conns = [];
  const room = { id: 'global-lobby', storage: { async get() {}, async put() {}, async delete() {}, async list() { return new Map(); } }, broadcast: (m) => sent.push(m), getConnections: () => conns };
  const srv = new Server(room);
  let res = await srv.onRequest(post({ type: 'PULSE', name: '小明', action: 'listen' }));
  assert.equal(res.status, 204);
  assert.equal(sent.length, 0);
  conns = [{ id: 'map-viewer' }];
  await srv.onRequest(post({ type: 'PULSE', name: '小明', action: 'done' }));
  await srv.onRequest(post({ type: 'PULSE', name: '小明', action: 'done' }));
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0]).action, 'done');
});
