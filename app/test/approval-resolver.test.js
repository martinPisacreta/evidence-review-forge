import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalResolvers } from '../src/approval-resolver.js';
import { createMemoryStorage } from '../src/store-adapter.js';
import { createActions } from '../src/actions.js';
import { hashDraft } from '../src/approval.js';

const context = { accountId: 'human-1',
  installContext: 'ari:cloud:jira::site/site-1',
  extension: { issue: { key: 'SUP-42' } } };
const binding = { user: context.accountId, site: context.installContext,
  destination: context.extension.issue.key };
const draft = { text: 'Review the evidence.', citations: [
  { documentId: 'page-1', version: 1, quote: 'Evidence.' }
] };
function fixture() {
  const storage = createMemoryStorage();
  let current = structuredClone(draft);
  let timestamp = 1000;
  let sequence = 0;
  let sends = 0;
  const confluence = { async getPage() {
    return { documentId: 'page-1', version: 1, text: 'Evidence.' };
  } };
  const panel = createApprovalResolvers({ storage, confluence,
    draftForContext(received) {
      assert.equal(received, context); return current;
    }, now: () => timestamp, newId: () => `server-${++sequence}` });
  const actions = createActions({ storage, confluence, context: binding,
    now: () => timestamp, jira: { async createComment() {
      sends += 1; return { commentId: 'comment-1' };
    } } });
  return { panel, storage, actions, sends: () => sends,
    change() { current.text = 'Changed after display.'; },
    time(value) { timestamp = value; } };
}
const hostile = { user: 'attacker', site: 'other-site', destination: 'BAD-1',
  context: { accountId: 'attacker' }, draft: { text: 'Injected' },
  draftHash: 'invented', expiresAt: Number.MAX_SAFE_INTEGER };

test('approval uses trusted context, server draft and a fixed fifteen-minute lifetime', async () => {
  const f = fixture();
  const shown = await f.panel.showDraft({ context, payload: hostile });
  assert.deepEqual(shown.draft, draft);
  assert.deepEqual(shown.binding, binding);
  assert.equal(shown.extracts[0].text, 'Evidence.');
  f.time(2000);
  const result = await f.panel.approve({ context,
    payload: { ...hostile, reviewId: shown.reviewId } });
  const approval = (await f.storage.load()).state.approvals[0];
  assert.deepEqual(approval.binding, binding);
  assert.equal(approval.draftHash, hashDraft(draft));
  assert.equal(approval.expiresAt - approval.createdAt, 15 * 60 * 1000);
  assert.equal(result.expiresAt, approval.expiresAt);
  assert.equal(f.sends(), 0);
  await assert.rejects(f.panel.showDraft({ context: {}, payload: hostile }),
    /TRUSTED_CONTEXT_REQUIRED/);
  await assert.rejects(f.panel.approve({ context: {},
    payload: { ...hostile, reviewId: shown.reviewId } }), /TRUSTED_CONTEXT_REQUIRED/);
});

test('changing the canonical draft after display rejects approval', async () => {
  const f = fixture();
  const shown = await f.panel.showDraft({ context });
  f.change();
  await assert.rejects(f.panel.approve({ context,
    payload: { reviewId: shown.reviewId, draftHash: shown.draftHash } }), /DRAFT_CHANGED/);
  assert.equal((await f.storage.load()).state.approvals.length, 0);
});

test('revocation prevents execution and cannot be bypassed with payload identity', async () => {
  const f = fixture();
  const shown = await f.panel.showDraft({ context });
  const approved = await f.panel.approve({ context, payload: { reviewId: shown.reviewId } });
  await f.panel.revoke({ context,
    payload: { ...hostile, approvalId: approved.approvalId } });
  await assert.rejects(f.actions.execute_approved_comment({ key: 'request-1',
    approvalId: approved.approvalId, draft }), /APPROVAL_REVOKED/);
  assert.equal(f.sends(), 0);
});

test('concurrent clicks consume a displayed review once', async () => {
  const f = fixture();
  const shown = await f.panel.showDraft({ context });
  const request = { context, payload: { reviewId: shown.reviewId } };
  const results = await Promise.allSettled([
    f.panel.approve(request), f.panel.approve(request)
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /REVIEW_USED/);
  assert.equal((await f.storage.load()).state.approvals.length, 1);
});

test('missing and expired displayed reviews cannot create approvals', async () => {
  const f = fixture();
  await assert.rejects(f.panel.approve({ context, payload: { reviewId: 'invented' } }),
    /REVIEW_NOT_FOUND/);
  const shown = await f.panel.showDraft({ context });
  f.time(shown.expiresAt);
  await assert.rejects(f.panel.approve({ context, payload: { reviewId: shown.reviewId } }),
    /REVIEW_EXPIRED/);
  assert.equal((await f.storage.load()).state.approvals.length, 0);
});
