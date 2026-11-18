import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalResolvers } from '../src/approval-resolver.js';
import { loadProposalView } from '../src/frontend/proposal-view.js';

const context = { accountId: 'synthetic-user',
  installContext: 'synthetic-installation',
  extension: { issue: { key: 'DESIGN-8' } } };

function fixture(error) {
  const calls = { drafts: 0, reads: 0, writes: 0, pages: 0 };
  const resolvers = createApprovalResolvers({
    storage: {
      async load() { calls.reads += 1; throw new Error('UNEXPECTED_READ'); },
      async compareAndSwap() {
        calls.writes += 1; throw new Error('UNEXPECTED_WRITE');
      }
    },
    confluence: { async getPage() {
      calls.pages += 1; throw new Error('UNEXPECTED_PAGE_READ');
    } },
    async draftForContext(received) {
      calls.drafts += 1;
      assert.deepEqual(received, context);
      throw error;
    }
  });
  return { resolvers, calls };
}

test('missing canonical draft returns an empty panel without writes', async () => {
  const f = fixture(new Error('DRAFT_NOT_FOUND'));
  const result = await f.resolvers.showDraft({ context });
  assert.deepEqual(result, { status: 'no_proposal' });
  assert.deepEqual(f.calls, { drafts: 1, reads: 0, writes: 0, pages: 0 });
});

test('other draft failures propagate unchanged', async () => {
  for (const code of ['STORAGE_UNAVAILABLE', 'FORBIDDEN',
    'DRAFT_NOT_FOUND: unexpected detail']) {
    const error = new Error(code);
    const f = fixture(error);
    await assert.rejects(() => f.resolvers.showDraft({ context }),
      received => received === error);
    assert.equal(f.calls.writes, 0);
  }
});

test('missing draft does not hide invalid trusted context', async () => {
  const f = fixture(new Error('DRAFT_NOT_FOUND'));
  await assert.rejects(() => f.resolvers.showDraft({ context: {} }),
    /TRUSTED_CONTEXT_REQUIRED/);
  assert.equal(f.calls.drafts, 0);
});

test('approval still rejects a missing draft without granting permission', async () => {
  const error = new Error('DRAFT_NOT_FOUND');
  const f = fixture(error);
  await assert.rejects(() => f.resolvers.approve({ context,
    payload: { reviewId: 'synthetic-review' } }), received => received === error);
  assert.equal(f.calls.writes, 0);
});

test('empty backend response produces the exact message and no review', async () => {
  const f = fixture(new Error('DRAFT_NOT_FOUND'));
  const view = await loadProposalView(async name => {
    assert.equal(name, 'showDraft');
    return f.resolvers.showDraft({ context });
  });
  assert.deepEqual(view, { review: null,
    message: 'No proposal has been prepared for this issue yet.' });
});

test('a prepared review remains available for human inspection', async () => {
  const review = { reviewId: 'synthetic-review', binding: {
    destination: 'DESIGN-8' }, draft: { text: 'Synthetic comment', citations: [] } };
  const view = await loadProposalView(async () => review);
  assert.equal(view.review, review);
  assert.equal(view.message,
    'Review the complete comment, destination and quoted evidence.');
});

test('bridge errors propagate to the existing generic error handler', async () => {
  for (const code of ['DRAFT_NOT_FOUND', 'NETWORK_ERROR', 'FORBIDDEN']) {
    const error = new Error(code);
    await assert.rejects(() => loadProposalView(async () => { throw error; }),
      received => received === error);
  }
});
