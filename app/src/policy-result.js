// Known caller-input and policy failures become explicit public rejections.
// Configuration, storage, malformed upstream responses and unexpected failures propagate.
const reasons = new Set([
  'INVALID_PROPOSAL_REQUEST', 'INVALID_ISSUE_KEY',
  'INVALID_DOCUMENT_ID', 'INVALID_DOCUMENT_IDS',
  'INVALID_DRAFT', 'INVALID_CITATION', 'INVALID_KEY',
  'APPROVAL_USED', 'APPROVAL_EXPIRED', 'APPROVAL_REVOKED',
  'APPROVAL_NOT_FOUND', 'DRAFT_CHANGED', 'INVALID_CITATIONS',
  'IDEMPOTENCY_CONFLICT', 'DRAFT_NOT_FOUND',
  'PRODUCT_HTTP_401', 'PRODUCT_HTTP_403', 'PRODUCT_HTTP_404'
]);

export function policyResult(action) {
  return async (...args) => {
    try { return await action(...args); }
    catch (error) {
      if (!reasons.has(error?.message)) throw error;
      return { status: 'rejected', reason: error.message };
    }
  };
}
