import { randomUUID } from 'node:crypto';
import { logCall } from './call-log.js';
import { createApproval, hashDraft } from './approval.js';
import { createActions } from './actions.js';
import { createStoreAdapter } from './store-adapter.js';

const TTL = 15 * 60 * 1000;
const present = value => typeof value === 'string' && value.trim();
const same = (a, b) => ['user', 'site', 'destination'].every(k => a[k] === b[k]);
// UI resolver request.context is backend supplied, never bridge getContext().
// The deployed panel receives its issue from trusted backend context.
export function createApprovalResolvers({ storage, confluence,
  draftForContext, now = Date.now, newId = randomUUID }) {
  const adapter = createStoreAdapter(storage);
  function bindingFor(context) {
    const binding = { user: context?.accountId, site: context?.installContext,
      destination: context?.extension?.issue?.key };
    if (!Object.values(binding).every(present))
      throw new Error('TRUSTED_CONTEXT_REQUIRED');
    return binding;
  }
  async function prepare(context, binding, allowMissing = false) {
    // Only a missing canonical draft becomes an explicit empty-panel result.
    let storedDraft;
    try { storedDraft = await draftForContext(context); }
    catch (error) {
      if (allowMissing && error?.message === 'DRAFT_NOT_FOUND') return null;
      throw error;
    }
    const draft = structuredClone(storedDraft);
    const actions = createActions({ storage, confluence, context: binding, via: 'resolver',
      jira: { createComment() { throw new Error('PANEL_CANNOT_EXECUTE'); } } });
    return actions.prepare_comment({ draft });
  }
  async function commit(transition) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const snapshot = await storage.load();
      const result = transition(snapshot.state);
      if (await storage.compareAndSwap(snapshot.version, result.state))
        return structuredClone(result.value);
    }
    throw new Error('STORE_CONTENTION');
  }
  return {
    async getActionHistory({ context }) {
      const binding = bindingFor(context);
      const actions = createActions({ storage, confluence, context: binding, via: 'resolver', now,
        jira: { createComment() { throw new Error('PANEL_CANNOT_EXECUTE'); } } });
      return actions.get_action_history();
    },
    async showDraft({ context }) {
      logCall({ event: 'resolver_called:showDraft',
        issueKey: context?.extension?.issue?.key, via: 'resolver' });
      const binding = bindingFor(context);
      const prepared = await prepare(context, binding, true);
      if (prepared === null) return { status: 'no_proposal' };
      const createdAt = now();
      const review = { id: newId(), binding, draftHash: prepared.draftHash,
        createdAt, expiresAt: createdAt + TTL, consumedAt: null };
      if (!Number.isSafeInteger(createdAt) || createdAt < 0)
        throw new Error('INVALID_TIME');
      return commit(state => {
        const reviews = state.reviews ?? [];
        if (reviews.some(r => r.id === review.id)) throw new Error('INVALID_REVIEW_ID');
        return { state: { ...state, reviews: [...reviews, review] },
          value: { reviewId: review.id, binding, draft: prepared.draft,
            draftHash: review.draftHash, extracts: prepared.extracts,
            expiresAt: review.expiresAt } };
      });
    },
    async approve({ payload, context }) {
      logCall({ event: 'resolver_called:approve',
        issueKey: context?.extension?.issue?.key, via: 'resolver' });
      const binding = bindingFor(context);
      const reviewId = payload?.reviewId;
      if (!present(reviewId)) throw new Error('INVALID_REVIEW_ID');
      const prepared = await prepare(context, binding);
      const timestamp = now();
      const id = newId();
      return commit(state => {
        const review = (state.reviews ?? []).find(r =>
          r.id === reviewId && same(r.binding, binding));
        if (!review) throw new Error('REVIEW_NOT_FOUND');
        if (review.consumedAt !== null) throw new Error('REVIEW_USED');
        if (timestamp < review.createdAt || timestamp >= review.expiresAt)
          throw new Error('REVIEW_EXPIRED');
        if (review.draftHash !== hashDraft(prepared.draft))
          throw new Error('DRAFT_CHANGED');
        const approved = createApproval(state, { id, binding,
          draft: prepared.draft, extracts: prepared.extracts,
          expiresAt: timestamp + TTL }, timestamp);
        return { state: { ...approved, reviews: state.reviews.map(r =>
          r.id === reviewId ? { ...r, consumedAt: timestamp } : r) },
          value: { approvalId: id, draftHash: review.draftHash, binding,
            expiresAt: timestamp + TTL } };
      });
    },
    async revoke({ payload, context }) {
      const binding = bindingFor(context);
      const id = payload?.approvalId;
      if (!present(id)) throw new Error('INVALID_APPROVAL_ID');
      await adapter.revokeApproval({ id, binding }, now());
      return { approvalId: id, revoked: true };
    }
  };
}
// Register these functions exclusively in the human panel's Forge resolver.
// Do not expose approval creation as a Rovo/MCP tool.
// Persist reviews in the same durable installation-scoped CAS aggregate.
// The UI and action destination resolvers must use the same canonical issue key.
