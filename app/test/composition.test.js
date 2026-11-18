import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/composition.js';
import { createMemoryStorage } from '../src/store-adapter.js';

function fixture() {
  const page = { documentId: '123', version: 1,
    text: 'Verified deployment procedure.' };
  const draft = { text: 'Follow the verified procedure.', citations: [
    { documentId: '123', version: 1, quote: page.text }
  ] };
  const context = { principal: { accountId: 'trusted-user' },
    installContext: 'trusted-installation' };
  const panelContext = { accountId: 'trusted-user',
    installContext: context.installContext,
    extension: { issue: { key: 'TEST-1' } } };
  const sent = [];
  const application = createApplication({ storage: createMemoryStorage(),
    confluence: { async getPage() { return structuredClone(page); } },
    jira: { async createComment(input) {
      sent.push(structuredClone(input));
      return { commentId: 'comment-1' };
    } },
    async resolveIssue(key) {
      if (key !== 'TEST-1') throw new Error('PRODUCT_HTTP_403');
      return key;
    },
    async destinationForContext(value) {
      const key = value?.extension?.issue?.key;
      if (!key) throw new Error('TRUSTED_ISSUE_REQUIRED');
      return key;
    }
  });
  const prepare = value => application.prepareComment({
    issueKey: 'TEST-1',
    proposalRequest: JSON.stringify(value ?? draft),
    context: { principal: { accountId: 'forged-user' } },
    destination: 'FORGED-99'
  }, context);
  const show = () => application.approvalResolvers.showDraft({
    context: panelContext
  });
  const approve = review => application.approvalResolvers.approve({
    context: panelContext, payload: { reviewId: review.reviewId }
  });
  return { application, context, panelContext, draft, page, sent,
    prepare, show, approve };
}

test('composition maps inputs and executes an approved draft once', async () => {
  const f = fixture();
  const evidence = await f.application.collectEvidence({ documentId: '123' },
    f.context);
  assert.deepEqual(evidence, [f.page]);
  await f.prepare();
  const review = await f.show();
  assert.deepEqual(review.binding, { user: 'trusted-user',
    site: 'trusted-installation', destination: 'TEST-1' });
  const approval = await f.approve(review);
  const input = { issueKey: 'TEST-1', approvalId: approval.approvalId, idempotencyKey: 'attempt-1',
    draft: { text: 'Forged replacement' }, destination: 'FORGED-99' };
  const results = await Promise.all([
    f.application.executeApprovedComment(input, f.context),
    f.application.executeApprovedComment(input, f.context)
  ]);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, `${f.draft.text}

Source: Confluence page 123, version 1
${f.page.text}`);
  assert.equal(f.sent[0].binding.destination, 'TEST-1');
  assert.ok(results.some(result => result.status === 'succeeded'));
  const history = await f.application.getActionHistory({}, f.context);
  assert.equal(history.comments.length, 1);
  assert.equal(history.comments[0].status, 'succeeded');
});

test('payload context cannot replace missing trusted context', async () => {
  const f = fixture();
  await assert.rejects(() => f.application.prepareComment({
    proposalRequest: JSON.stringify(f.draft), context: f.context
  }, {}), /TRUSTED_CONTEXT_REQUIRED/);
  await assert.rejects(() => f.application.approvalResolvers.showDraft({
    payload: { context: f.panelContext }, context: {}
  }), /TRUSTED_CONTEXT_REQUIRED/);
  assert.equal(f.sent.length, 0);
});

test('a replacement canonical draft invalidates the displayed review', async () => {
  const f = fixture();
  await f.prepare();
  const review = await f.show();
  await f.prepare({ ...f.draft, text: 'A changed proposed comment.' });
  await assert.rejects(() => f.approve(review), /DRAFT_CHANGED/);
  assert.equal(f.sent.length, 0);
});

test('changed source version prevents execution of an approved draft', async () => {
  const f = fixture();
  await f.prepare();
  const approval = await f.approve(await f.show());
  f.page.version = 2;
  assert.deepEqual(await f.application.executeApprovedComment({
    issueKey: 'TEST-1', approvalId: approval.approvalId, idempotencyKey: 'attempt-1'
  }, f.context), { status: 'rejected', reason: 'INVALID_CITATIONS' });
  assert.equal(f.sent.length, 0);
});

test('panel history is reachable through the composed resolvers', async () => {
  const f = fixture();
  await f.prepare();
  const review = await f.show();
  const approval = await f.approve(review);
  await f.application.executeApprovedComment({ issueKey: 'TEST-1',
    approvalId: approval.approvalId, idempotencyKey: 'attempt-1' }, f.context);
  const history = await f.application.approvalResolvers.getActionHistory({
    context: f.panelContext, payload: { context: { accountId: 'forged-user' } }
  });
  assert.equal(history.comments.length, 1);
  assert.equal(history.comments[0].status, 'succeeded');
  assert.equal(history.approvals[0].binding.user, 'trusted-user');
  assert.equal(f.sent.length, 1);
});

test('every resolver name registered in index.js exists in the composition', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  const list = /for \(const name of \[([^\]]+)\]\) \{\s*resolver\.define/.exec(source);
  assert.ok(list, 'resolver registration list not found in src/index.js');
  const names = list[1].split(',').map(name => name.trim().replace(/'/g, ''));
  assert.ok(names.includes('getActionHistory'));
  const { application } = fixture();
  for (const name of names)
    assert.equal(typeof application.approvalResolvers[name], 'function', name);
});


function panelExecutionFixture({ uncertain = false } = {}) {
  const storage = createMemoryStorage();
  const page = { documentId: '123', version: 1, text: 'Verified procedure.' };
  const draft = { text: 'Follow the procedure.', citations: [
    { documentId: '123', version: 1, quote: page.text }
  ] };
  const sent = [];
  let time = 1000;
  const context = { accountId: 'panel-user', installContext: 'panel-site',
    extension: { issue: { key: 'TEST-1' } } };
  const actionContext = { principal: { accountId: context.accountId },
    installContext: context.installContext };
  const create = () => createApplication({ storage,
    now: () => time,
    confluence: { async getPage() { return structuredClone(page); } },
    jira: { async createComment(input) {
      sent.push(structuredClone(input));
      if (uncertain) throw new Error('Connection lost after sending');
      return { commentId: 'panel-comment-1' };
    } },
    async resolveIssue(key) {
      if (key !== 'TEST-1') throw new Error('PRODUCT_HTTP_403');
      return key;
    },
    async destinationForContext(value) {
      return value?.extension?.issue?.key;
    }
  });
  const app = create();
  const prepare = value => app.prepareComment({ issueKey: 'TEST-1',
    proposalRequest: JSON.stringify(value ?? draft) }, actionContext);
  const approved = async () => {
    await prepare();
    const review = await app.approvalResolvers.showDraft({ context });
    return app.approvalResolvers.approve({ context,
      payload: { reviewId: review.reviewId } });
  };
  const execute = (approvalId, application = app, extra = {}) =>
    application.approvalResolvers.executeApproved({ context,
      payload: { ...extra, approvalId } });
  const history = (application = app) =>
    application.approvalResolvers.getActionHistory({ context });
  return { app, create, context, page, draft, sent, prepare, approved,
    execute, history, advance: value => { time += value; } };
}

test('panel execution publishes canonical content and exposes its history', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  assert.equal(f.sent.length, 0, 'approval alone must not publish');
  const result = await f.execute(approval.approvalId);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.key, `panel-approved:${approval.approvalId}`);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, `${f.draft.text}

Source: Confluence page 123, version 1
${f.page.text}`);
  assert.deepEqual(f.sent[0].binding, { user: 'panel-user',
    site: 'panel-site', destination: 'TEST-1' });
  const history = await f.history();
  assert.equal(history.comments.length, 1);
  assert.equal(history.comments[0].key, result.key);
  assert.equal(history.comments[0].status, 'succeeded');
});

test('panel concurrent execution and sequential repetition send only once', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  const results = await Promise.all([f.execute(approval.approvalId),
    f.execute(approval.approvalId)]);
  const repeated = await f.execute(approval.approvalId);
  assert.equal(f.sent.length, 1);
  for (const result of results) assert.equal(result.key, repeated.key);
  assert.equal(repeated.status, 'succeeded');
  assert.deepEqual(await f.execute(approval.approvalId), repeated);
  assert.equal((await f.history()).comments.length, 1);
});

test('panel repetition survives application recreation over the same storage', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  const result = await f.execute(approval.approvalId);
  const recreated = f.create();
  assert.deepEqual(await f.execute(approval.approvalId, recreated), result);
  assert.equal(f.sent.length, 1);
  assert.equal((await f.history(recreated)).comments.length, 1);
});

test('panel execution rejects absent and nonexistent approvals', async () => {
  const f = panelExecutionFixture();
  await f.prepare();
  for (const id of [undefined, '', 'not-an-approval']) {
    assert.deepEqual(await f.execute(id),
      { status: 'rejected', reason: 'APPROVAL_NOT_FOUND' });
  }
  assert.equal(f.sent.length, 0);
});

test('panel execution rejects revoked approval', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  await f.app.approvalResolvers.revoke({ context: f.context,
    payload: { approvalId: approval.approvalId } });
  assert.deepEqual(await f.execute(approval.approvalId),
    { status: 'rejected', reason: 'APPROVAL_REVOKED' });
  assert.equal(f.sent.length, 0);
});

test('panel execution rejects expired approval', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  f.advance(15 * 60 * 1000);
  assert.deepEqual(await f.execute(approval.approvalId),
    { status: 'rejected', reason: 'APPROVAL_EXPIRED' });
  assert.equal(f.sent.length, 0);
});

test('panel execution rejects changed canonical draft', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  await f.prepare({ ...f.draft, text: 'Changed after approval.' });
  assert.deepEqual(await f.execute(approval.approvalId),
    { status: 'rejected', reason: 'DRAFT_CHANGED' });
  assert.equal(f.sent.length, 0);
});

test('panel execution rejects changed evidence', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  f.page.version = 2;
  assert.deepEqual(await f.execute(approval.approvalId),
    { status: 'rejected', reason: 'INVALID_CITATIONS' });
  assert.equal(f.sent.length, 0);
});

test('panel execution ignores browser identity, destination, draft and key', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  const result = await f.execute(approval.approvalId, f.app, {
    issueKey: 'FOREIGN-99', accountId: 'foreign-user',
    installContext: 'foreign-site', destination: 'FOREIGN-99',
    context: { accountId: 'foreign-user', extension: { issue: { key: 'FOREIGN-99' } } },
    draft: { text: 'Injected comment' }, idempotencyKey: 'injected-key'
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.key, `panel-approved:${approval.approvalId}`);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].binding.destination, 'TEST-1');
  assert.equal(f.sent[0].binding.user, 'panel-user');
  assert.ok(f.sent[0].text.startsWith(f.draft.text));
  assert.equal(f.sent.filter(item => item.binding.destination === 'FOREIGN-99').length, 0);
});

test('panel execution requires trusted server context', async () => {
  const f = panelExecutionFixture();
  const approval = await f.approved();
  await assert.rejects(() => f.app.approvalResolvers.executeApproved({
    context: {}, payload: { approvalId: approval.approvalId, context: f.context }
  }), /TRUSTED_CONTEXT_REQUIRED/);
  assert.equal(f.sent.length, 0);
});

test('uncertain panel execution is never sent again, including after recreation', async () => {
  const f = panelExecutionFixture({ uncertain: true });
  const approval = await f.approved();
  const result = await f.execute(approval.approvalId);
  assert.equal(result.status, 'uncertain');
  assert.deepEqual(await f.execute(approval.approvalId), result);
  assert.deepEqual(await f.execute(approval.approvalId, f.create()), result);
  assert.equal(f.sent.length, 1);
  assert.equal((await f.history()).comments[0].status, 'uncertain');
});


function simplePreparation(f, overrides = {}) {
  return { issueKey: 'TEST-1', text: f.draft.text,
    documentId: f.page.documentId, version: f.page.version,
    quote: f.page.text, ...overrides };
}

test('simple preparation saves the same canonical draft and hash as JSON', async () => {
  const f = fixture();
  const json = await f.prepare();
  const simple = await f.application.prepareComment(simplePreparation(f), f.context);
  assert.equal(typeof simple.draftHash, 'string');
  assert.ok(simple.draftHash.length > 0);
  assert.equal(simple.draftHash, json.draftHash);
  assert.deepEqual(simple.draft, json.draft);
  assert.equal(simple.message,
    'Draft saved for human review in the Jira panel. Nothing was published.');
  const review = await f.show();
  assert.ok(review.reviewId);
  assert.equal(f.sent.length, 0);
});

test('simple preparation accepts a digits-only version string', async () => {
  const f = fixture();
  const json = await f.prepare();
  const simple = await f.application.prepareComment(
    simplePreparation(f, { version: '1' }), f.context);
  assert.equal(simple.draftHash, json.draftHash);
  assert.deepEqual(simple.draft, json.draft);
  assert.equal(f.sent.length, 0);
});

for (const missing of ['text', 'documentId', 'version', 'quote']) {
  test(`simple preparation rejects missing ${missing}`, async () => {
    const f = fixture();
    const input = simplePreparation(f);
    delete input[missing];
    const result = await f.application.prepareComment(input, f.context);
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, 'INVALID_PROPOSAL_REQUEST');
    assert.equal(f.sent.length, 0);
  });
}

test('preparation rejects JSON combined with all simple inputs', async () => {
  const f = fixture();
  const result = await f.application.prepareComment(simplePreparation(f, {
    proposalRequest: JSON.stringify(f.draft)
  }), f.context);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'INVALID_PROPOSAL_REQUEST');
  assert.equal(f.sent.length, 0);
});

test('preparation rejects JSON combined with even one simple input', async () => {
  const f = fixture();
  const result = await f.application.prepareComment({ issueKey: 'TEST-1',
    proposalRequest: JSON.stringify(f.draft), text: f.draft.text }, f.context);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'INVALID_PROPOSAL_REQUEST');
  assert.equal(f.sent.length, 0);
});

for (const version of ['', '1.0', ' 1', '1 ', '1' + String.fromCharCode(10), '+1', '1e0',
  '9007199254740993', null, true, 1.5]) {
  test(`simple preparation rejects invalid version ${JSON.stringify(version)}`, async () => {
    const f = fixture();
    const result = await f.application.prepareComment(
      simplePreparation(f, { version }), f.context);
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, 'INVALID_PROPOSAL_REQUEST');
    assert.equal(f.sent.length, 0);
  });
}

test('simple preparation preserves rejection of a quote absent from the excerpt', async () => {
  const f = fixture();
  const invalid = { ...f.draft, citations: [{ ...f.draft.citations[0],
    quote: 'A quotation not present in the retrieved source.' }] };
  const json = await f.prepare(invalid);
  const simple = await f.application.prepareComment(
    simplePreparation(f, { quote: invalid.citations[0].quote }), f.context);
  assert.equal(json.status, 'rejected');
  assert.deepEqual(simple, json);
  assert.equal(f.sent.length, 0);
});

test('simple preparation flows through panel approval and repeated execution with one send', async () => {
  const f = fixture();
  await f.application.collectEvidence({ documentId: f.page.documentId }, f.context);
  const prepared = await f.application.prepareComment(simplePreparation(f), f.context);
  assert.ok(prepared.draftHash);
  assert.equal(f.sent.length, 0);
  const review = await f.show();
  const approval = await f.approve(review);
  assert.equal(f.sent.length, 0);
  const request = { context: f.panelContext,
    payload: { approvalId: approval.approvalId } };
  const first = await f.application.approvalResolvers.executeApproved(request);
  const repeated = await f.application.approvalResolvers.executeApproved(request);
  assert.equal(first.status, 'succeeded');
  assert.deepEqual(repeated, first);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].text, `${f.draft.text}

Source: Confluence page 123, version 1
${f.page.text}`);
});

test('simple preparation treats an empty or null proposalRequest as absent', async () => {
  for (const empty of ['', null, undefined]) {
    const f = fixture();
    const json = await f.prepare();
    const simple = await f.application.prepareComment(
      simplePreparation(f, { proposalRequest: empty }), f.context);
    assert.equal(simple.draftHash, json.draftHash);
    assert.equal(f.sent.length, 0);
  }
});

test('JSON preparation ignores empty simple inputs but empty everything is rejected', async () => {
  const f = fixture();
  const json = await f.prepare();
  const again = await f.application.prepareComment({ issueKey: 'TEST-1',
    proposalRequest: JSON.stringify(f.draft), text: '', documentId: null,
    version: '', quote: undefined }, f.context);
  assert.equal(again.draftHash, json.draftHash);
  const none = await f.application.prepareComment({ issueKey: 'TEST-1',
    proposalRequest: '', text: '', documentId: '', version: '', quote: '' }, f.context);
  assert.equal(none.status, 'rejected');
  assert.equal(none.reason, 'INVALID_PROPOSAL_REQUEST');
  assert.equal(f.sent.length, 0);
});
