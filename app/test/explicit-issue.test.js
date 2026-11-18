import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/composition.js';
import { createMemoryStorage } from '../src/store-adapter.js';
import { createProductClients } from '../src/product-clients.js';

function fixture() {
  const storage = createMemoryStorage();
  const sent = [];
  const checked = [];
  const pages = [];
  const context = { principal: { accountId: 'user-1' },
    installContext: 'installation-1' };
  const draft = { text: 'Synthetic comment.', citations: [
    { documentId: '123', version: 1, quote: 'Synthetic evidence.' }
  ] };
  const application = createApplication({ storage,
    confluence: { async getPage({ documentId, binding }) {
      pages.push(structuredClone(binding));
      return { documentId, version: 1, text: 'Synthetic evidence.' };
    } },
    jira: { async createComment(input) {
      sent.push(structuredClone(input));
      return { commentId: 'comment-1' };
    } },
    async resolveIssue(key) {
      checked.push(key);
      if (!['TEST-1', 'TEST-2'].includes(key))
        throw new Error('PRODUCT_HTTP_403');
      return key;
    },
    async destinationForContext(value) {
      const key = value?.extension?.issue?.key;
      if (!key) throw new Error('TRUSTED_ISSUE_REQUIRED');
      return key;
    }
  });
  const prepare = issueKey => application.prepareComment({ issueKey,
    proposalRequest: JSON.stringify(draft) }, context);
  const panel = issueKey => ({ accountId: 'user-1',
    installContext: 'installation-1', extension: { issue: { key: issueKey } } });
  return { application, storage, sent, checked, pages, context, prepare, panel };
}

test('collection binds only trusted user and installation without resolving an issue', async () => {
  const f = fixture();
  await f.application.collectEvidence({ documentId: '123', issueKey: 'DENIED-1',
    context: { principal: { accountId: 'forged' } } }, f.context);
  assert.deepEqual(f.checked, []);
  assert.deepEqual(f.pages, [{ user: 'user-1', site: 'installation-1' }]);
});

test('unauthorized issue rejects preparation and execution without state changes', async () => {
  const f = fixture();
  const before = await f.storage.load();
  assert.deepEqual(await f.prepare('DENIED-1'), { status: 'rejected', reason: 'PRODUCT_HTTP_403' });
  assert.deepEqual(await f.application.executeApprovedComment({
    issueKey: 'DENIED-1', approvalId: 'invented', idempotencyKey: 'attempt-1'
  }, f.context), { status: 'rejected', reason: 'PRODUCT_HTTP_403' });
  assert.deepEqual(await f.storage.load(), before);
  assert.equal(f.sent.length, 0);
  assert.equal(f.pages.length, 0);
});

test('approval for another authorized issue is rejected and remains usable for its own issue', async () => {
  const f = fixture();
  await f.prepare('TEST-1');
  await f.prepare('TEST-2');
  const context = f.panel('TEST-1');
  const review = await f.application.approvalResolvers.showDraft({ context });
  const approval = await f.application.approvalResolvers.approve({ context,
    payload: { reviewId: review.reviewId } });
  const before = await f.storage.load();
  assert.deepEqual(await f.application.executeApprovedComment({
    issueKey: 'TEST-2', approvalId: approval.approvalId, idempotencyKey: 'wrong-issue'
  }, f.context), { status: 'rejected', reason: 'APPROVAL_NOT_FOUND' });
  assert.equal(f.sent.length, 0);
  assert.deepEqual(await f.storage.load(), before);
  const result = await f.application.executeApprovedComment({
    issueKey: 'TEST-1', approvalId: approval.approvalId, idempotencyKey: 'right-issue'
  }, f.context);
  assert.equal(result.status, 'succeeded');
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].binding.destination, 'TEST-1');
});

test('product issue resolution uses asUser GET and rejects permission failures', async () => {
  const calls = [];
  let status = 200;
  let users = 0;
  const clients = createProductClients({
    route: (parts, ...values) => parts.reduce((s, part, i) =>
      s + part + (values[i] ?? ''), ''),
    api: { asUser() {
      users += 1;
      return { async requestJira(path, options) {
        calls.push({ path, options });
        return { ok: status === 200, status,
          async json() { return { id: '10001', key: 'TEST-1' }; } };
      } };
    } }
  });
  assert.equal(await clients.resolveIssue('TEST-1'), 'TEST-1');
  assert.equal(calls[0].path, '/rest/api/3/issue/TEST-1?fields=summary');
  assert.equal(calls[0].options.method ?? 'GET', 'GET');
  status = 403;
  await assert.rejects(() => clients.resolveIssue('DENIED-1'), /PRODUCT_HTTP_403/);
  assert.equal(users, 2);
});
