import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCurrentApproval, executionMessage, initialApprovalMessage } from '../src/frontend/approval-view.js';

const now = 10000;
const binding = { user: 'test-user', site: 'test-site', destination: 'DESIGN-12' };
const review = { binding, draftHash: 'current-draft' };
function approval(overrides = {}) {
  return { id: 'current', binding: { ...binding }, draftHash: review.draftHash,
    createdAt: 9000, expiresAt: 15000, consumedAt: null, revokedAt: null,
    effectiveStatus: 'pending', ...overrides };
}

test('reload does not restore an old used approval when the newer one expired', () => {
  const records = { approvals: [
    approval({ id: 'old-used', createdAt: 1000, expiresAt: 2000,
      consumedAt: 1500, effectiveStatus: 'consumed' }),
    approval({ id: 'newer-expired', createdAt: 3000, expiresAt: 4000,
      effectiveStatus: 'expired' })
  ], comments: [{ approvalId: 'old-used', key: 'panel-approved:old-used' }] };
  assert.equal(selectCurrentApproval(records, review, now), null);
});

test('reload requires a verified current draft before offering an approval', () => {
  assert.equal(selectCurrentApproval({ approvals: [approval()], comments: [] },
    null, now), null);
});

test('a pending approval for another draft is not offered', () => {
  assert.equal(selectCurrentApproval({ approvals: [
    approval({ draftHash: 'previous-draft' })
  ], comments: [] }, review, now), null);
});

test('a current unused unrevoked unexpired approval can be offered', () => {
  assert.deepEqual(selectCurrentApproval({ approvals: [approval()], comments: [] },
    review, now), { approvalId: 'current', expiresAt: 15000 });
});

test('expired, consumed, revoked and executed approvals are not actionable', () => {
  for (const overrides of [
    { expiresAt: now }, { effectiveStatus: 'expired' },
    { consumedAt: 9500 }, { effectiveStatus: 'consumed' },
    { revokedAt: 9500 }, { effectiveStatus: 'revoked' },
    { createdAt: now + 1 }
  ]) {
    assert.equal(selectCurrentApproval({ approvals: [approval(overrides)],
      comments: [] }, review, now), null);
  }
  assert.equal(selectCurrentApproval({ approvals: [approval()],
    comments: [{ approvalId: 'current', key: 'any-existing-attempt' }] }, review, now), null);
});

test('selects the newest eligible approval without mutating history', () => {
  const records = { approvals: [
    approval({ id: 'older', createdAt: 8000 }), approval(),
    approval({ id: 'newer-revoked', createdAt: 9500, revokedAt: 9600 })
  ], comments: [] };
  const before = structuredClone(records);
  assert.deepEqual(selectCurrentApproval(records, review, now),
    { approvalId: 'current', expiresAt: 15000 });
  assert.deepEqual(records, before);
});

test('an approval for another user, site or issue is not offered', () => {
  for (const field of ['user', 'site', 'destination']) {
    assert.equal(selectCurrentApproval({ approvals: [approval({
      binding: { ...binding, [field]: 'other' }
    })], comments: [] }, review, now), null);
  }
});

test('existing server rejection codes have distinct readable explanations', () => {
  const cases = [
    ['APPROVAL_EXPIRED', /approval has expired/i],
    ['APPROVAL_USED', /approval has already been used/i],
    ['APPROVAL_REVOKED', /approval was revoked/i],
    ['DRAFT_CHANGED', /draft has changed/i]
  ];
  const messages = cases.map(([reason, expected]) => {
    const message = executionMessage({ status: 'rejected', reason });
    assert.match(message, /^Comment not published:/);
    assert.match(message, expected);
    assert.equal(message.includes(reason), false);
    return message;
  });
  assert.equal(new Set(messages).size, cases.length);
  assert.match(executionMessage({ status: 'rejected', reason: 'UNKNOWN' }),
    /server rejected the request/);
});

test('execution outcomes retain their existing presentation', () => {
  for (const [status, expected] of [
    ['succeeded', /Comment published/], ['pending', /Execution pending/],
    ['uncertain', /Outcome uncertain/], ['failed', /recorded as failed/]
  ]) assert.match(executionMessage({ status }), expected);
  assert.equal(initialApprovalMessage, 'Load the current proposal to review it.');
});
