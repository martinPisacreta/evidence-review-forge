'use strict';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyStore, verifyCitations, hashDraft, createApproval, revokeApproval,
  beginComment, finishComment } from '../src/approval.js';
const binding = { user: 'user-1', site: 'site-1', destination: 'SUP-42' };
const extracts = [{ documentId: 'page-1', version: 3, text: 'Review evidence before saving.' }];
const draft = { text: 'Review required [page-1 v3].',
  citations: [{ documentId: 'page-1', version: 3, quote: 'Review evidence' }] };
const request = { key: 'request-1', approvalId: 'approval-1', binding, draft, extracts };
function approved() {
  return createApproval(emptyStore(), { id: 'approval-1', binding, draft, extracts,
    expiresAt: 2000 }, 1000);
}
function frozen(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen); Object.freeze(value);
  }
  return value;
}
test('valid reservation consumes approval without mutating inputs', () => {
  const original = frozen(approved());
  const result = beginComment(original, frozen({ ...request }), 1100);
  assert.equal(result.shouldExecute, true);
  assert.equal(result.store.approvals[0].consumedAt, 1100);
  assert.equal(result.record.status, 'pending');
  assert.equal(original.approvals[0].consumedAt, null);
  assert.equal(original.comments.length, 0);
});
test('used approval cannot authorize a different request', () => {
  const { store } = beginComment(approved(), request, 1100);
  assert.throws(() => beginComment(store, { ...request, key: 'request-2' }, 1101),
    /APPROVAL_USED/);
});
test('changed draft invalidates approval', () => {
  assert.throws(() => beginComment(approved(), { ...request,
    draft: { ...draft, text: 'Changed content' } }, 1100), /DRAFT_CHANGED/);
});
test('approval expires at its exact deadline', () => {
  assert.throws(() => beginComment(approved(), request, 2000), /APPROVAL_EXPIRED/);
});
test('revoked approval cannot execute', () => {
  const store = revokeApproval(approved(), { id: 'approval-1', binding }, 1050);
  assert.throws(() => beginComment(store, request, 1100), /APPROVAL_REVOKED/);
});
test('invented quote and wrong source version are rejected', () => {
  assert.equal(verifyCitations([{ ...draft.citations[0], quote: 'Invented' }], extracts), false);
  assert.equal(verifyCitations([{ ...draft.citations[0], version: 4 }], extracts), false);
  assert.throws(() => beginComment(approved(), { ...request, extracts: [] }, 1100),
    /INVALID_CITATIONS/);
});
test('empty and ambiguous evidence is rejected', () => {
  assert.equal(verifyCitations([], extracts), false);
  assert.equal(verifyCitations([{ ...draft.citations[0], quote: ' ' }], extracts), false);
  assert.equal(verifyCitations(draft.citations, [...extracts, ...extracts]), false);
});
test('same idempotency key with different content conflicts', () => {
  const { store } = beginComment(approved(), request, 1100);
  assert.throws(() => beginComment(store, { ...request,
    draft: { ...draft, text: 'Other comment' } }, 1101), /IDEMPOTENCY_CONFLICT/);
});
test('replays never authorize another execution for any recorded status', () => {
  const pending = beginComment(approved(), request, 1100).store;
  for (const status of ['pending', 'succeeded', 'failed', 'uncertain']) {
    const store = status === 'pending' ? pending : finishComment(pending,
      { key: request.key, binding, status, commentId: status === 'succeeded' ? 'comment-7' : null }, 1200);
    const replay = beginComment(store, request, 3000);
    assert.equal(replay.shouldExecute, false);
    assert.equal(replay.record.status, status);
    assert.equal(replay.store, store);
  }
});
test('approval binds user, site and destination', () => {
  for (const field of ['user', 'site', 'destination']) {
    assert.throws(() => beginComment(approved(), { ...request,
      binding: { ...binding, [field]: 'other' } }, 1100), /APPROVAL_NOT_FOUND/);
  }
});
test('citation changes alter the approved hash', () => {
  const changed = { ...draft, citations: [{ ...draft.citations[0], quote: 'before saving' }] };
  assert.notEqual(hashDraft(draft), hashDraft(changed));
  assert.throws(() => beginComment(approved(), { ...request, draft: changed }, 1100),
    /DRAFT_CHANGED/);
});
test('uncertain outcome can be reconciled without a new execution', () => {
  const pending = beginComment(approved(), request, 1100).store;
  const uncertain = finishComment(pending, { key: request.key, binding, status: 'uncertain' }, 1200);
  const confirmed = finishComment(uncertain, { key: request.key, binding,
    status: 'succeeded', commentId: 'comment-7' }, 1300);
  assert.equal(beginComment(confirmed, request, 1400).record.commentId, 'comment-7');
  assert.throws(() => finishComment(confirmed, { key: request.key, binding,
    status: 'failed' }, 1500), /RESULT_FINAL/);
});
