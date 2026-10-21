import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendPulse } from './pulse.js';

test('ripples go through an open map socket, else one throttled POST to the lobby', () => {
  const sent = [];
  const socket = { readyState: 1, send: (m) => sent.push(m) };
  const posts = [];
  const fetchImpl = (url, opts) => { posts.push({ url, opts }); return Promise.resolve(); };
  sendPulse(socket, '小明', 'listen', { fetchImpl, now: () => 10_000 });
  assert.equal(sent.length, 1);
  assert.equal(posts.length, 0);
  sendPulse(null, '小明', 'done', { fetchImpl, now: () => 20_000 });
  sendPulse(null, '小明', 'done', { fetchImpl, now: () => 20_500 }); // throttled
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/parties\/main\/global-lobby$/);
  assert.equal(posts[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(posts[0].opts.body), { type: 'PULSE', name: '小明', action: 'done' });
  sendPulse(null, '', 'done', { fetchImpl, now: () => 99_000 });
  assert.equal(posts.length, 1);
});
