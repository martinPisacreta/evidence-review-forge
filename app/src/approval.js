'use strict';
import { createHash } from 'node:crypto';
// Pure transitions only. Trusted callers supply identity, time and recovered evidence.
// The adapter must atomically persist reservations BEFORE any Jira request.
// Human approval must originate in an authenticated UI, never an LLM tool.
const fail = code => { throw new Error(code); };
const text = value => typeof value === 'string' && value.trim().length > 0;
const clock = now => { if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_TIME'); };
const emptyStore = () => ({ approvals: [], comments: [] });
function validBinding(binding) {
  if (!binding || !['user', 'site', 'destination'].every(k => text(binding[k])))
    fail('INVALID_BINDING');
}
function sameBinding(a, b) {
  return ['user', 'site', 'destination'].every(k => a[k] === b[k]);
}
function verifyCitations(citations, extracts) {
  if (!Array.isArray(citations) || !citations.length || !Array.isArray(extracts))
    return false;
  return citations.every(c => {
    if (!c || !text(c.documentId) || !Number.isSafeInteger(c.version) ||
        c.version < 1 || !text(c.quote)) return false;
    const matches = extracts.filter(e => e && e.documentId === c.documentId &&
      e.version === c.version);
    return matches.length === 1 && typeof matches[0].text === 'string' &&
      matches[0].text.includes(c.quote);
  });
}
function hashDraft(draft) {
  if (!draft || !text(draft.text) || !Array.isArray(draft.citations))
    fail('INVALID_DRAFT');
  const citations = draft.citations.map(c => {
    if (!c || !text(c.documentId) || !Number.isSafeInteger(c.version) ||
        c.version < 1 || !text(c.quote)) fail('INVALID_CITATION');
    return [c.documentId, c.version, c.quote];
  });
  return createHash('sha256').update(JSON.stringify([draft.text, citations])).digest('hex');
}
function createApproval(store, { id, binding, draft, extracts, expiresAt }, now) {
  clock(now); validBinding(binding);
  if (!text(id) || store.approvals.some(a => a.id === id)) fail('INVALID_APPROVAL_ID');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) fail('INVALID_EXPIRY');
  if (!verifyCitations(draft?.citations, extracts)) fail('INVALID_CITATIONS');
  const approval = { id, binding: { ...binding }, draftHash: hashDraft(draft),
    createdAt: now, expiresAt, revokedAt: null, consumedAt: null };
  return { ...store, approvals: [...store.approvals, approval] };
}
function lookupApproval(store, id, binding) {
  validBinding(binding);
  const approval = store.approvals.find(a => a.id === id);
  if (!approval || !sameBinding(approval.binding, binding)) fail('APPROVAL_NOT_FOUND');
  return approval;
}
function replaceApproval(store, approval) {
  return { ...store, approvals: store.approvals.map(a =>
    a.id === approval.id ? approval : a) };
}
function revokeApproval(store, { id, binding }, now) {
  clock(now);
  const approval = lookupApproval(store, id, binding);
  if (now < approval.createdAt) fail('INVALID_TIME');
  if (approval.consumedAt !== null) fail('APPROVAL_USED');
  if (approval.revokedAt !== null) return store;
  return replaceApproval(store, { ...approval, revokedAt: now });
}
function beginComment(store, { key, approvalId, binding, draft, extracts }, now) {
  clock(now); validBinding(binding);
  if (!text(key)) fail('INVALID_KEY');
  const draftHash = hashDraft(draft);
  const existing = store.comments.find(c => c.key === key && sameBinding(c.binding, binding));
  if (existing) {
    if (existing.draftHash !== draftHash) fail('IDEMPOTENCY_CONFLICT');
    return { store, shouldExecute: false, record: existing };
  }
  if (!verifyCitations(draft.citations, extracts)) fail('INVALID_CITATIONS');
  const approval = lookupApproval(store, approvalId, binding);
  if (approval.revokedAt !== null) fail('APPROVAL_REVOKED');
  if (approval.consumedAt !== null) fail('APPROVAL_USED');
  if (now < approval.createdAt) fail('INVALID_TIME');
  if (now >= approval.expiresAt) fail('APPROVAL_EXPIRED');
  if (approval.draftHash !== draftHash) fail('DRAFT_CHANGED');
  const consumed = replaceApproval(store, { ...approval, consumedAt: now });
  const record = { key, approvalId, binding: { ...binding }, draftHash,
    status: 'pending', commentId: null, reservedAt: now, updatedAt: now };
  return { store: { ...consumed, comments: [...consumed.comments, record] },
    shouldExecute: true, record };
}
function finishComment(store, { key, binding, status, commentId = null }, now) {
  clock(now); validBinding(binding);
  const record = store.comments.find(c => c.key === key && sameBinding(c.binding, binding));
  if (!record) fail('COMMENT_NOT_FOUND');
  if (!['succeeded', 'failed', 'uncertain'].includes(status)) fail('INVALID_STATUS');
  if (!['pending', 'uncertain'].includes(record.status)) fail('RESULT_FINAL');
  if (now < record.updatedAt) fail('INVALID_TIME');
  if (status === 'succeeded' ? !text(commentId) : commentId !== null) fail('INVALID_RESULT');
  const updated = { ...record, status, commentId, updatedAt: now };
  return { ...store, comments: store.comments.map(c => c === record ? updated : c) };
}
// A replay never authorizes another request, including pending/failed/uncertain results.
// Reconcile an uncertain remote outcome; these functions cannot prove remote delivery.
// Citation matching proves excerpt membership, not that the prose follows from it.
export { emptyStore, verifyCitations, hashDraft, createApproval,
  revokeApproval, beginComment, finishComment };
