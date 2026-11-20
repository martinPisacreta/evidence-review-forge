import { logCall } from './call-log.js';
import { hashDraft, verifyCitations } from './approval.js';
import { commentText } from './comment-text.js';
import { createStoreAdapter } from './store-adapter.js';

// Context and clients come from the trusted backend, never chat or page text.
// Clients must enforce resource permissions; this module performs no fetch.
export function createActions({ storage, confluence, jira, findRelatedPages, context,
  now = Date.now, timeoutMs = 1000, via = 'agent' }) {
  const binding = structuredClone(context);
  const present = value => typeof value === 'string' && value.trim();
  if (!['user', 'site'].every(k => present(binding?.[k])))
    throw new Error('INVALID_BINDING');
  if (binding.destination !== undefined && !present(binding.destination))
    throw new Error('INVALID_BINDING');
  const fields = present(binding.destination)
    ? ['user', 'site', 'destination'] : ['user', 'site'];
  function requireDestination() {
    if (!present(binding.destination)) throw new Error('ISSUE_BINDING_REQUIRED');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error('INVALID_TIMEOUT');
  const adapter = createStoreAdapter(storage);
  const same = value => fields.every(k => value.binding[k] === binding[k]);
  const ownComments = state => state.comments.filter(same);

  async function find_related_pages(input) {
    const issueKey = input?.issueKey;
    if (typeof issueKey !== 'string' || !issueKey.trim() ||
        issueKey !== issueKey.trim())
      throw new Error('INVALID_ISSUE_KEY');
    if (typeof findRelatedPages !== 'function')
      throw new Error('RELATED_PAGES_CLIENT_REQUIRED');
    const pages = await findRelatedPages({ issueKey, cloudId: binding.cloudId });
    if (!Array.isArray(pages))
      throw new Error('INVALID_TEAMWORK_GRAPH_RESPONSE');
    return pages.length ? { pages } : { pages,
      warning: 'empty result does not prove there is no relationship' };
  }

  async function collect_evidence(input) {
    const { documentIds } = structuredClone(input);
    if (!Array.isArray(documentIds) || !documentIds.length || documentIds.length > 25 ||
        !documentIds.every(id => typeof id === 'string' && id.trim()))
      throw new Error('INVALID_DOCUMENT_IDS');
    const extracts = [];
    for (const documentId of new Set(documentIds)) {
      const page = await confluence.getPage({ documentId, binding: { ...binding } });
      if (page?.documentId !== documentId || !Number.isSafeInteger(page.version) ||
          page.version < 1 || typeof page.text !== 'string')
        throw new Error('INVALID_PAGE');
      // Project data fields only; no instruction, approval or draft is imported.
      extracts.push({ documentId, version: page.version, text: page.text });
    }
    return extracts;
  }

  async function currentEvidence(draft) {
    hashDraft(draft);
    const extracts = await collect_evidence({
      documentIds: draft.citations.map(c => c.documentId)
    });
    if (!verifyCitations(draft.citations, extracts))
      throw new Error('INVALID_CITATIONS');
    return extracts;
  }

  async function prepare_comment(input) {
    logCall({ event: 'prepare_comment_called', issueKey: binding.destination,
      draftId: input?.draft?.id, via });
    requireDestination();
    const { draft } = structuredClone(input);
    const extracts = await currentEvidence(draft);
    return { draft, draftHash: hashDraft(draft), extracts, requiresHumanApproval: true };
  }

  async function execute_approved_comment(input) {
    logCall({ event: 'execute_approved_comment_called', issueKey: binding.destination,
      draftId: input?.draft?.id, via });
    requireDestination();
    const { key, approvalId, draft } = structuredClone(input);
    const draftHash = hashDraft(draft);
    const text = commentText(draft);
    const snapshot = await storage.load();
    const existing = ownComments(snapshot.state).find(c => c.key === key);
    if (existing) {
      if (existing.draftHash !== draftHash) throw new Error('IDEMPOTENCY_CONFLICT');
      return structuredClone(existing);
    }
    const extracts = await currentEvidence(draft);
    // Only the persisted approval can authorize this atomic reservation.
    const reservation = await adapter.beginComment({
      key, approvalId, binding, draft, extracts
    }, now());
    if (!reservation.shouldExecute) return reservation.record;
    let timer;
    let status = 'uncertain';
    let commentId = null;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => jira.createComment({
          binding: { ...binding }, text, idempotencyKey: key
        })),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('JIRA_TIMEOUT')), timeoutMs);
        })
      ]);
      if (typeof result?.commentId === 'string' && result.commentId.trim()) {
        status = 'succeeded';
        commentId = result.commentId;
      }
    } catch {
      // An exception does not establish whether Jira accepted the comment.
      // A late response is never permission to send again.
    } finally {
      clearTimeout(timer);
    }
    const finished = await adapter.finishComment({
      key, binding, status, commentId
    }, now());
    return ownComments(finished.store).find(c => c.key === key);
  }

  async function get_action_history() {
    const { state } = await storage.load();
    const currentTime = now();
    const withIsoTimes = record => {
      const result = { ...record };
      for (const field of ['createdAt', 'expiresAt', 'revokedAt', 'consumedAt',
        'reservedAt', 'updatedAt']) {
        if (Object.hasOwn(record, field) &&
            (typeof record[field] === 'number' || record[field] === null)) {
          result[field + 'Iso'] = record[field] === null
            ? null : new Date(record[field]).toISOString();
        }
      }
      return result;
    };
    return structuredClone({
      approvals: state.approvals.filter(same).map(approval => ({
        ...withIsoTimes(approval),
        effectiveStatus: approval.consumedAt != null ? 'consumed'
          : approval.revokedAt != null ? 'revoked'
          : currentTime >= approval.expiresAt ? 'expired' : 'pending'
      })),
      comments: ownComments(state).map(withIsoTimes),
      recipientDeliveryVerified: false
    });
  }

  // No action creates approvals or interprets approval claims in supplied text.
  // Memory storage is a simulation; Forge store initialization and history retrieval were verified on the development site.
  // A failed outcome commit leaves a reservation, never permission to resend.
  return { find_related_pages, collect_evidence, prepare_comment, execute_approved_comment, get_action_history };
}
