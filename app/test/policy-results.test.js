import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/composition.js';
import { createMemoryStorage, createStoreAdapter } from '../src/store-adapter.js';
import { policyResult } from '../src/policy-result.js';

async function fixture() {
  const storage = createMemoryStorage();
  const adapter = createStoreAdapter(storage);
  const context = { principal: { accountId: 'user-1' }, installContext: 'site-1' };
  const binding = { user: 'user-1', site: 'site-1', destination: 'TEST-1' };
  const draft = { text: 'Review the procedure.', citations: [
    { documentId: '123', version: 1, quote: 'Verified procedure.' },
    { documentId: '456', version: 2, quote: 'Second source.' }
  ] };
  const pages = [
    { documentId: '123', version: 1, text: 'Verified procedure.' },
    { documentId: '456', version: 2, text: 'Second source.' }
  ];
  const sent = [];
  let timestamp = 1100;
  let denied = false;
  const application = createApplication({ storage, now: () => timestamp,
    confluence: { async getPage({ documentId }) {
      return structuredClone(pages.find(page => page.documentId === documentId));
    } },
    jira: { async createComment(input) {
      sent.push(structuredClone(input));
      return { commentId: 'comment-1' };
    } },
    async resolveIssue(key) {
      if (denied) throw new Error('PRODUCT_HTTP_403');
      return key;
    },
    async destinationForContext(value) { return value.extension.issue.key; }
  });
  const prepare = (value = draft, issueKey = 'TEST-1') =>
    application.prepareComment({ issueKey, proposalRequest: JSON.stringify(value) }, context);
  await prepare();
  await adapter.createApproval({ id: 'approval-1', binding, draft,
    extracts: pages, expiresAt: 2000 }, 1000);
  const execute = (extra = {}) => application.executeApprovedComment({
    issueKey: 'TEST-1', approvalId: 'approval-1', idempotencyKey: 'attempt-1',
    ...extra
  }, context);
  return { storage, adapter, binding, draft, pages, sent, prepare, execute,
    setTime(value) { timestamp = value; }, deny() { denied = true; } };
}

test('publishes canonical text and every citation, ignoring replacement payload', async () => {
  const f = await fixture();
  const result = await f.execute({ draft: { text: 'FORGED', citations: [] },
    text: 'FORGED', citations: [{ documentId: '999', version: 9, quote: 'FORGED' }] });
  assert.equal(result.status, 'succeeded');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, 'Review the procedure.\n\n' +
    'Source: Confluence page 123, version 1\nVerified procedure.\n\n' +
    'Source: Confluence page 456, version 2\nSecond source.');
  assert.deepEqual(await f.execute(), result);
  assert.deepEqual(await f.execute({ idempotencyKey: 'attempt-2' }),
    { status: 'rejected', reason: 'APPROVAL_USED' });
  assert.equal(f.sent.length, 1);
});

for (const reason of ['APPROVAL_EXPIRED', 'APPROVAL_REVOKED',
  'APPROVAL_NOT_FOUND', 'DRAFT_CHANGED', 'INVALID_CITATIONS', 'PRODUCT_HTTP_403']) {
  test(`${reason} returns a rejection without posting or changing approval state`, async () => {
    const f = await fixture();
    let extra = {};
    if (reason === 'APPROVAL_EXPIRED') f.setTime(2000);
    if (reason === 'APPROVAL_REVOKED')
      await f.adapter.revokeApproval({ id: 'approval-1', binding: f.binding }, 1100);
    if (reason === 'APPROVAL_NOT_FOUND') {
      await f.prepare(f.draft, 'TEST-2');
      extra = { issueKey: 'TEST-2' };
    }
    if (reason === 'DRAFT_CHANGED')
      await f.prepare({ ...f.draft, text: 'Changed canonical draft.' });
    if (reason === 'INVALID_CITATIONS') f.pages[0].version = 2;
    if (reason === 'PRODUCT_HTTP_403') f.deny();
    const before = await f.storage.load();
    assert.deepEqual(await f.execute(extra), { status: 'rejected', reason });
    assert.deepEqual(await f.storage.load(), before);
    assert.equal(f.sent.length, 0);
  });
}

test('unexpected failures remain errors', async () => {
  const failure = new Error('STORE_UNAVAILABLE');
  const action = policyResult(async () => { throw failure; });
  await assert.rejects(action(), error => error === failure);
});
