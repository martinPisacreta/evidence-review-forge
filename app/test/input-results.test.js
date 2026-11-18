import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/composition.js';
import { createMemoryStorage } from '../src/store-adapter.js';
import { policyResult } from '../src/policy-result.js';

function fixture() {
  const storage = createMemoryStorage();
  const sent = [];
  const context = { principal: { accountId: 'user-1' }, installContext: 'site-1' };
  const draft = { text: 'Review.', citations: [
    { documentId: '123', version: 1, quote: 'Evidence.' }
  ] };
  const application = createApplication({ storage,
    async resolveIssue(key) {
      if (key !== key.trim()) throw new Error('INVALID_ISSUE_KEY');
      return key;
    },
    async destinationForContext(value) { return value.extension.issue.key; },
    confluence: { async getPage({ documentId }) {
      if (!/^[0-9]+$/.test(documentId)) throw new Error('INVALID_DOCUMENT_ID');
      return { documentId, version: 1, text: 'Evidence.' };
    } },
    jira: { async createComment(input) {
      sent.push(input);
      return { commentId: 'unexpected-comment' };
    } }
  });
  const prepare = proposalRequest => application.prepareComment({
    issueKey: 'TEST-1', proposalRequest
  }, context);
  return { application, storage, sent, context, draft, prepare };
}

for (const value of [undefined, null, {}, [], 42, '', '{broken']) {
  test(`invalid proposalRequest ${JSON.stringify(value)} rejects without writes`, async () => {
    const f = fixture();
    const before = await f.storage.load();
    assert.deepEqual(await f.prepare(value),
      { status: 'rejected', reason: 'INVALID_PROPOSAL_REQUEST' });
    assert.deepEqual(await f.storage.load(), before);
    assert.equal(f.sent.length, 0);
  });
}

const cases = [
  ['INVALID_DRAFT', null],
  ['INVALID_DRAFT', { text: '', citations: [] }],
  ['INVALID_DRAFT', { text: 'Review.', citations: 'wrong' }],
  ['INVALID_CITATION', { text: 'Review.', citations: [null] }],
  ['INVALID_CITATION', { text: 'Review.', citations: [
    { documentId: '123', version: 0, quote: 'Evidence.' }
  ] }]
];
for (const [reason, draft] of cases) {
  test(`serialized malformed draft rejects with ${reason}: ${JSON.stringify(draft)}`, async () => {
    const f = fixture();
    const before = await f.storage.load();
    assert.deepEqual(await f.prepare(JSON.stringify(draft)), { status: 'rejected', reason });
    assert.deepEqual(await f.storage.load(), before);
    assert.equal(f.sent.length, 0);
  });
}

test('invalid issue and document inputs return explicit rejections without writes', async () => {
  const f = fixture();
  const before = await f.storage.load();
  for (const issueKey of [undefined, '', ' TEST-1']) {
    assert.deepEqual(await f.application.prepareComment({ issueKey,
      proposalRequest: JSON.stringify(f.draft) }, f.context),
    { status: 'rejected', reason: 'INVALID_ISSUE_KEY' });
  }
  for (const documentId of [undefined, '', 123]) {
    assert.deepEqual(await f.application.collectEvidence({ documentId }, f.context),
      { status: 'rejected', reason: 'INVALID_DOCUMENT_IDS' });
  }
  assert.deepEqual(await f.application.collectEvidence({ documentId: 'abc' }, f.context),
    { status: 'rejected', reason: 'INVALID_DOCUMENT_ID' });
  assert.deepEqual(await f.storage.load(), before);
  assert.equal(f.sent.length, 0);
});

test('serialized valid draft succeeds and invalid execution keys leave it unchanged', async () => {
  const f = fixture();
  assert.equal((await f.prepare(JSON.stringify(f.draft))).requiresHumanApproval, true);
  const before = await f.storage.load();
  for (const idempotencyKey of [undefined, '', 123]) {
    assert.deepEqual(await f.application.executeApprovedComment({
      issueKey: 'TEST-1', approvalId: 'not-approved', idempotencyKey
    }, f.context), { status: 'rejected', reason: 'INVALID_KEY' });
  }
  assert.deepEqual(await f.storage.load(), before);
  assert.equal(f.sent.length, 0);
});

test('internal invalid-state errors and unexpected failures still propagate', async () => {
  for (const reason of ['INVALID_BINDING', 'INVALID_TIMEOUT', 'INVALID_PAGE',
    'INVALID_TIME', 'STORE_UNAVAILABLE']) {
    const failure = new Error(reason);
    await assert.rejects(policyResult(async () => { throw failure; })(),
      error => error === failure);
  }
});
