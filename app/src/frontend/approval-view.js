// SDK-free panel presentation; server authorization remains unchanged.
export const initialApprovalMessage = 'Load the current proposal to review it.';
const sameBinding = (a, b) => ['user', 'site', 'destination'].every(field =>
  typeof a?.[field] === 'string' && a[field].length > 0 && a[field] === b?.[field]);

export function selectCurrentApproval(records, review, now = Date.now()) {
  if (!review || typeof review.draftHash !== 'string' || !review.draftHash ||
      !Array.isArray(records?.approvals) || !Array.isArray(records?.comments))
    return null;
  const candidates = records.approvals.filter(candidate =>
    typeof candidate.id === 'string' && candidate.id.length > 0 &&
    candidate.effectiveStatus === 'pending' &&
    candidate.consumedAt == null && candidate.revokedAt == null &&
    Number.isSafeInteger(candidate.createdAt) && candidate.createdAt <= now &&
    Number.isSafeInteger(candidate.expiresAt) && candidate.expiresAt > now &&
    candidate.draftHash === review.draftHash &&
    sameBinding(candidate.binding, review.binding) &&
    !records.comments.some(record => record.approvalId === candidate.id));
  candidates.sort((a, b) => b.createdAt - a.createdAt);
  return candidates[0]
    ? { approvalId: candidates[0].id, expiresAt: candidates[0].expiresAt }
    : null;
}

const rejectionMessages = {
  APPROVAL_EXPIRED: 'Comment not published: the approval has expired. Load the current proposal to review it again.',
  APPROVAL_USED: 'Comment not published: the approval has already been used. Check run history.',
  APPROVAL_REVOKED: 'Comment not published: the approval was revoked. Load the current proposal to review it again.',
  DRAFT_CHANGED: 'Comment not published: the draft has changed since approval. Load the current proposal to review it again.'
};
const outcomeMessages = {
  succeeded: 'Comment published. Repeating returns the same execution record.',
  pending: 'Execution pending. Repeating checks the same attempt.',
  uncertain: 'Outcome uncertain. Check Jira; repeating will not send again.',
  failed: 'Execution recorded as failed. Repeating returns the same record.'
};

export function executionMessage(result) {
  if (result?.status === 'rejected')
    return Object.hasOwn(rejectionMessages, result.reason)
      ? rejectionMessages[result.reason]
      : 'Comment not published: the server rejected the request. Load the current proposal and check run history.';
  return Object.hasOwn(outcomeMessages, result?.status)
    ? outcomeMessages[result.status]
    : 'Outcome unconfirmed. Check Jira and run history.';
}
