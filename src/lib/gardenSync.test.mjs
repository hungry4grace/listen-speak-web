// Tests the pure sync logic that App.jsx actually imports and runs.
import assert from 'node:assert';
import {
  mergeGardens, stampTodayLogin, classifyGardenResponse,
  decideGardenSync, buildFruitAuthorKeys, aggregateFruitResults,
} from './gardenSync.js';

const TODAY = '2026-06-16';
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

console.log('frontend garden-sync decisions:');

await test('NON-200 response => do NOT push to cloud (the回退 fix)', async () => {
  const local = { 'John 3:16': { stage: 2, fruits: 1 } };
  const cls = await classifyGardenResponse(resp(500, null));
  const d = decideGardenSync(cls, local, TODAY);
  assert.strictEqual(d.shouldPushToCloud, false, 'must not overwrite cloud on 500');
  assert.ok(d.garden['John 3:16'], 'local still shown');
});

await test('network error (unknown) => do NOT push to cloud', async () => {
  const local = { 'Ps 23:1': { stage: 5, fruits: 3 } };
  const d = decideGardenSync({ kind: 'unknown' }, local, TODAY);
  assert.strictEqual(d.shouldPushToCloud, false);
});

await test('200 with remote => merge and push', async () => {
  const local = { 'John 3:16': { stage: 2, fruits: 1 } };
  const remote = { gardenData: { 'John 3:16': { stage: 9, fruits: 4 }, 'Ps 23:1': { stage: 1, fruits: 0 } } };
  const cls = await classifyGardenResponse(resp(200, remote));
  const d = decideGardenSync(cls, local, TODAY);
  assert.strictEqual(d.shouldPushToCloud, true);
  assert.strictEqual(d.garden['John 3:16'].stage, 9, 'higher remote stage kept');
  assert.strictEqual(d.garden['John 3:16'].fruits, 4);
  assert.ok(d.garden['Ps 23:1'], 'remote-only verse preserved');
});

await test('404 (new player) => safe to push local up', async () => {
  const local = { 'John 3:16': { stage: 3, fruits: 2 } };
  const cls = await classifyGardenResponse(resp(404, null));
  const d = decideGardenSync(cls, local, TODAY);
  assert.strictEqual(d.shouldPushToCloud, true);
  assert.strictEqual(d.garden['John 3:16'].stage, 3);
});

await test('merge keeps higher local value when local is ahead', async () => {
  const m = mergeGardens({ 'A': { stage: 1, fruits: 1 } }, { 'A': { stage: 4, fruits: 0 } });
  assert.strictEqual(m['A'].stage, 4);
  assert.strictEqual(m['A'].fruits, 1);
});

await test('activity days are unioned across remote+local', async () => {
  const m = mergeGardens({ _activity: { '2026-06-15': 1000 } }, { _activity: { '2026-06-14': 100 } });
  assert.strictEqual(m._activity['2026-06-15'], 1000);
  assert.strictEqual(m._activity['2026-06-14'], 100);
});

await test('stampTodayLogin sets today >=100 without lowering existing', async () => {
  assert.strictEqual(stampTodayLogin({}, TODAY)._activity[TODAY], 100);
  assert.strictEqual(stampTodayLogin({ _activity: { [TODAY]: 1000 } }, TODAY)._activity[TODAY], 1000);
});

console.log('\nfruit aggregation (果子两端一致):');

await test('author keys dedupe playerName/code/prev', () => {
  const keys = buildFruitAuthorKeys('Nate', 'CodeX', ['CodeOld', 'CodeX', '']);
  assert.deepStrictEqual([...keys].sort(), ['CodeOld', 'CodeX', 'Nate'].sort());
});

await test('aggregate sums points across all keys incl. old code', () => {
  const results = [
    { points: 10, referralPoints: 0, creatorHistory: [{ timestamp: 2 }], referralHistory: [] },
    { points: 0, referralPoints: 5, creatorHistory: [], referralHistory: [{ timestamp: 1 }] },  // current code
    { points: 0, referralPoints: 7, creatorHistory: [], referralHistory: [{ timestamp: 3 }] },  // old code — must be counted
    null,
  ];
  const agg = aggregateFruitResults(results);
  assert.strictEqual(agg.creator, 10);
  assert.strictEqual(agg.referral, 12, 'old-code referral fruits must be included');
  assert.strictEqual(agg.total, 22);
  assert.deepStrictEqual(agg.refHist.map(h => h.timestamp), [3, 1], 'sorted desc');
});

console.log(`\n${passed} assertions passed.`);
