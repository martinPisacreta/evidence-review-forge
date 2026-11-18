import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntityStorage, isConditionalCheckFailure } from '../src/entity-storage.js';
import { createDraftRepository } from '../src/draft-repository.js';
import { createActions } from '../src/actions.js';
import { emptyStore, createApproval, hashDraft } from '../src/approval.js';

const binding = { user: 'user-1', site: 'site-1', destination: 'TEST-1' };
const draft = { text: 'Review.', citations: [
  { documentId: '123', version: 1, quote: 'Evidence.' }
] };
const page = { documentId: '123', version: 1, text: 'Evidence.' };

function fixture(initial, failure) {
  let row = { version: 0, state: structuredClone(initial) };
  const stats = { reads: 0, writes: 0 };
  class Filter {
    and(_field, expected) { this.expected = expected; return this; }
  }
  const kvs = {
    entity() { return { async get() {
      stats.reads += 1;
      return structuredClone(row);
    } }; },
    transact() { return {
      set(_key, replacement, { conditions }) {
        return { async execute() {
          stats.writes += 1;
          if (stats.writes === 1) {
            if (failure?.code === 'CONDITIONAL_CHECK_FAILED') {
              row.version += 1;
              row.state.concurrent = 'preserve me';
              row.state.drafts = [{ binding: { ...binding, destination: 'TEST-2' },
                draft: structuredClone(draft), draftHash: hashDraft(draft) }];
            }
            throw failure;
          }
          assert.equal(conditions.expected, row.version);
          row = structuredClone(replacement);
        } };
      }
    }; }
  };
  const storage = createEntityStorage({ kvs, Filter,
    FilterConditions: { equalTo: value => value },
    isConditionalFailure: isConditionalCheckFailure });
  return { storage, stats, snapshot: () => structuredClone(row) };
}

test('classifier recognizes only the exact conditional failure code', () => {
  assert.equal(isConditionalCheckFailure({ code: 'CONDITIONAL_CHECK_FAILED' }), true);
  for (const error of [null, undefined, {},
    new Error('CONDITIONAL_CHECK_FAILED'),
    { code: 'TIMEOUT' }, { code: 'conditional_check_failed' },
    { cause: { code: 'CONDITIONAL_CHECK_FAILED' } }]) {
    assert.equal(isConditionalCheckFailure(error), false);
  }
});

test('draft save reloads and recomputes after a confirmed conflict', async () => {
  const f = fixture(emptyStore(), { code: 'CONDITIONAL_CHECK_FAILED' });
  await createDraftRepository(f.storage).save(binding, draft);
  const row = f.snapshot();
  assert.equal(f.stats.writes, 2);
  assert.equal(f.stats.reads, 2);
  assert.equal(row.state.concurrent, 'preserve me');
  assert.equal(row.state.drafts.length, 2);
  assert.deepEqual(await createDraftRepository(f.storage).load(binding), draft);
});

for (const failure of [Object.assign(new Error('unavailable'), { code: 'TIMEOUT' }),
  new Error('CONDITIONAL_CHECK_FAILED')]) {
  test(`draft save propagates ${failure.message} without retrying`, async () => {
    const f = fixture(emptyStore(), failure);
    await assert.rejects(createDraftRepository(f.storage).save(binding, draft),
      error => error === failure);
    assert.equal(f.stats.writes, 1);
    assert.equal(f.stats.reads, 1);
    assert.deepEqual(f.snapshot(), { version: 0, state: emptyStore() });
  });
}

for (const conditional of [true, false]) {
  test(`execution reservation retries only a confirmed conflict: ${conditional}`, async () => {
    const failure = Object.assign(new Error('storage failure'), {
      code: conditional ? 'CONDITIONAL_CHECK_FAILED' : 'TIMEOUT'
    });
    const initial = createApproval(emptyStore(), { id: 'approval-1', binding,
      draft, extracts: [page], expiresAt: 2000 }, 1000);
    const f = fixture(initial, failure);
    let sends = 0;
    const actions = createActions({ storage: f.storage, context: binding,
      now: () => 1100, confluence: { async getPage() { return page; } },
      jira: { async createComment() {
        const reserved = f.snapshot().state;
        assert.equal(reserved.approvals[0].consumedAt, 1100);
        assert.equal(reserved.comments[0].status, 'pending');
        assert.equal(reserved.concurrent, 'preserve me');
        sends += 1;
        return { commentId: 'comment-1' };
      } } });
    const request = { key: 'attempt-1', approvalId: 'approval-1', draft };
    if (conditional) {
      assert.equal((await actions.execute_approved_comment(request)).status, 'succeeded');
      assert.equal(f.stats.writes, 3);
      assert.equal(sends, 1);
      await actions.execute_approved_comment(request);
      assert.equal(sends, 1);
      assert.equal(f.stats.writes, 3);
    } else {
      await assert.rejects(actions.execute_approved_comment(request), error => error === failure);
      assert.equal(f.stats.writes, 1);
      assert.equal(sends, 0);
      assert.deepEqual(f.snapshot(), { version: 0, state: initial });
    }
  });
}
