import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalResolvers } from '../src/approval-resolver.js';
import { createMemoryStorage } from '../src/store-adapter.js';

const context = { accountId: 'human-1', installContext: 'site-1',
  extension: { issue: { key: 'SUP-42' } } };
const binding = { user: 'human-1', site: 'site-1', destination: 'SUP-42' };

function fixture() {
  const statuses = ['succeeded', 'failed', 'pending', 'uncertain'];
  const approval = { id: 'approval-1', binding: { ...binding },
    createdAt: 1000, expiresAt: 10000, revokedAt: null, consumedAt: 2000 };
  const comments = statuses.map((status, index) => ({
    key: `run-${index}`, approvalId: approval.id, binding: { ...binding },
    status, reservedAt: 2000 + index, updatedAt: 3000 + index
  }));
  const foreign = ['user', 'site', 'destination'].map(field => ({
    ...binding, [field]: 'other'
  }));
  const storage = createMemoryStorage({
    approvals: [approval, ...foreign.map((value, index) => ({
      ...approval, id: `foreign-${index}`, binding: value
    }))],
    comments: [...comments, ...foreign.map((value, index) => ({
      ...comments[0], key: `foreign-${index}`, binding: value
    }))]
  });
  const panel = createApprovalResolvers({
    storage: { load: () => storage.load(), compareAndSwap() {
      throw new Error('HISTORY_MUST_NOT_WRITE');
    } },
    confluence: { getPage() { throw new Error('HISTORY_MUST_NOT_FETCH'); } },
    draftForContext() { throw new Error('HISTORY_MUST_NOT_REQUIRE_DRAFT'); },
    now: () => 5000
  });
  return { storage, panel };
}

test('panel history exposes all four stored outcomes within the trusted binding only', async () => {
  const { storage, panel } = fixture();
  const before = await storage.load();
  const history = await panel.getActionHistory({ context, payload: {
    user: 'other', site: 'other', destination: 'other',
    context: { accountId: 'other' }
  } });
  assert.deepEqual(history.comments.map(record => record.status),
    ['succeeded', 'failed', 'pending', 'uncertain']);
  assert.equal(history.approvals.length, 1);
  assert.equal(history.approvals[0].binding.user, 'human-1');
  assert.equal(history.comments[0].reservedAtIso, new Date(2000).toISOString());
  assert.deepEqual(await storage.load(), before);
});

test('panel history rejects missing trusted context even when payload supplies it', async () => {
  const { panel } = fixture();
  await assert.rejects(panel.getActionHistory({ payload: { context } }),
    /TRUSTED_CONTEXT_REQUIRED/);
  for (const invalid of [
    { ...context, accountId: undefined },
    { ...context, installContext: undefined },
    { ...context, extension: {} }
  ]) {
    await assert.rejects(panel.getActionHistory({ context: invalid, payload: context }),
      /TRUSTED_CONTEXT_REQUIRED/);
  }
});
