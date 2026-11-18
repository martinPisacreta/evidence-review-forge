import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval, emptyStore } from '../src/approval.js';
import { createMemoryStorage, createStoreAdapter } from '../src/store-adapter.js';

const binding = { user: 'user-1', site: 'site-1', destination: 'SUP-42' };
const extracts = [{ documentId: 'page-1', version: 1, text: 'Review evidence.' }];
const draft = { text: 'Please review [page-1 v1].', citations: [
  { documentId: 'page-1', version: 1, quote: 'Review evidence.' }
] };
const request = { key: 'request-1', approvalId: 'approval-1', binding, draft, extracts };

function setup() {
  const initial = createApproval(emptyStore(), { id: 'approval-1', binding,
    draft, extracts, expiresAt: 2000 }, 1000);
  const memory = createMemoryStorage(initial);
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let reads = 0;
  let conflicts = 0;
  const racingStorage = {
    async load() {
      const snapshot = await memory.load();
      reads += 1;
      // Both first callers must observe version zero before either can commit.
      if (reads <= 2) {
        if (reads === 2) release();
        await barrier;
      }
      return snapshot;
    },
    async compareAndSwap(version, state) {
      const committed = await memory.compareAndSwap(version, state);
      if (!committed) conflicts += 1;
      return committed;
    }
  };
  return { adapter: createStoreAdapter(racingStorage), memory,
    conflicts: () => conflicts };
}

test('same approval and key: one committed execution permission', async () => {
  const { adapter, memory, conflicts } = setup();
  const results = await Promise.all([
    adapter.beginComment(request, 1100),
    adapter.beginComment(request, 1100)
  ]);
  assert.equal(results.filter(result => result.shouldExecute).length, 1);
  assert.equal(results.filter(result => !result.shouldExecute).length, 1);
  assert.equal(conflicts(), 1);
  const { state } = await memory.load();
  assert.equal(state.comments.length, 1);
  assert.equal(state.approvals[0].consumedAt, 1100);
});

test('same approval and different keys: losing request is rejected', async () => {
  const { adapter, memory, conflicts } = setup();
  const results = await Promise.allSettled([
    adapter.beginComment(request, 1100),
    adapter.beginComment({ ...request, key: 'request-2' }, 1100)
  ]);
  const winners = results.filter(result => result.status === 'fulfilled');
  const losers = results.filter(result => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(winners[0].value.shouldExecute, true);
  assert.equal(losers.length, 1);
  assert.match(losers[0].reason.message, /APPROVAL_USED/);
  assert.equal(conflicts(), 1);
  assert.equal((await memory.load()).state.comments.length, 1);
});

test('uncertain result survives concurrent retries without another execution', async () => {
  const { adapter, memory } = setup();
  await Promise.all([
    adapter.beginComment(request, 1100),
    adapter.beginComment(request, 1100)
  ]);
  await adapter.finishComment({ key: request.key, binding, status: 'uncertain' }, 1200);
  const retries = await Promise.all([
    adapter.beginComment(request, 1300),
    adapter.beginComment(request, 1300)
  ]);
  assert.ok(retries.every(result => !result.shouldExecute));
  assert.ok(retries.every(result => result.record.status === 'uncertain'));
  const { state } = await memory.load();
  assert.equal(state.comments.length, 1);
  assert.equal(state.comments[0].status, 'uncertain');
});
