import { createActions } from './actions.js';
import { logCall } from './call-log.js';

const panelInvocation = Symbol('panelInvocation');
import { createApprovalResolvers } from './approval-resolver.js';
import { createDraftRepository } from './draft-repository.js';
import { policyResult } from './policy-result.js';

const present = value => typeof value === 'string' && value.trim().length > 0;

// SDK-free composition. Only index.js supplies official SDK dependencies.
export function createApplication({ storage, confluence, jira,
  destinationForContext, resolveIssue, findRelatedPages: relatedPagesClient,
  now = Date.now, timeoutMs = 20000 }) {
  const drafts = createDraftRepository(storage);

  async function bindingFor(context, panel = false) {
    const user = panel ? context?.accountId : context?.principal?.accountId;
    const site = context?.installContext;
    if (!present(user) || !present(site))
      throw new Error('TRUSTED_CONTEXT_REQUIRED');
    return { user, site };
  }

  async function issueBinding(context, issueKey) {
    const identity = await bindingFor(context);
    if (!present(issueKey)) throw new Error('INVALID_ISSUE_KEY');
    const destination = await resolveIssue(issueKey);
    if (!present(destination)) throw new Error('AUTHORIZED_ISSUE_REQUIRED');
    return { ...identity, destination };
  }

  function actionsFor(binding, via = 'agent') {
    return createActions({ storage, confluence, jira,
      findRelatedPages: relatedPagesClient, context: binding,
      now, timeoutMs, via });
  }

  async function panelContext(context) {
    const binding = await bindingFor(context, true);
    const destination = await destinationForContext(context);
    if (!present(destination)) throw new Error('TRUSTED_DESTINATION_REQUIRED');
    return { accountId: binding.user, installContext: binding.site,
      extension: { issue: { key: destination } } };
  }

  const panel = createApprovalResolvers({ storage, confluence, now,
    draftForContext: context => drafts.load({
      user: context.accountId, site: context.installContext,
      destination: context.extension.issue.key
    }) });

  async function invokePanel(name, request) {
    const context = await panelContext(request?.context);
    return panel[name]({ context, payload: request?.payload });
  }

  const application = {
    async findRelatedPages(payload, context) {
      const identity = await bindingFor(context);
      // Identity and cloudId come exclusively from trusted invocation context.
      const installation = /^ari:cloud:(jira|confluence)::site\/([^:\/\s]+)$/.exec(
        identity.site);
      const cloudId = context?.cloudId ?? installation?.[2];
      const binding = { ...identity, cloudId };
      return actionsFor(binding).find_related_pages({
        issueKey: payload?.issueKey
      });
    },

    async collectEvidence(payload, context) {
      const binding = await bindingFor(context);
      return actionsFor(binding).collect_evidence({
        documentIds: [payload?.documentId]
      });
    },

    async prepareComment(payload, context) {
      const binding = await issueBinding(context, payload?.issueKey);
      // Rovo may send unused optional inputs as null or empty text: those count as absent.
      const has = key => payload?.[key] !== undefined && payload[key] !== null &&
        payload[key] !== '';
      const fields = ['text', 'documentId', 'version', 'quote'];
      const simpleCount = fields.filter(has).length;
      let draft;
      if (has('proposalRequest')) {
        if (simpleCount || typeof payload.proposalRequest !== 'string')
          throw new Error('INVALID_PROPOSAL_REQUEST');
        try { draft = JSON.parse(payload.proposalRequest); }
        catch { throw new Error('INVALID_PROPOSAL_REQUEST'); }
      } else {
        if (simpleCount !== fields.length)
          throw new Error('INVALID_PROPOSAL_REQUEST');
        let version = payload.version;
        if (typeof version === 'string') {
          if (!version.length || /[^0-9]/.test(version))
            throw new Error('INVALID_PROPOSAL_REQUEST');
          version = Number(version);
        }
        if (!Number.isSafeInteger(version))
          throw new Error('INVALID_PROPOSAL_REQUEST');
        draft = { text: payload.text, citations: [{
          documentId: payload.documentId, version, quote: payload.quote
        }] };
      }
      // Both input forms use the existing draft and evidence validation below.
      const prepared = await actionsFor(binding).prepare_comment({ draft });
      await drafts.save(binding, prepared.draft);
      return { ...prepared, message: prepared.message ??
        'Draft saved for human review in the Jira panel. Nothing was published.' };
    },

    async executeApprovedComment(payload, context) {
      const binding = await issueBinding(context, payload?.issueKey);
      // Retrieve canonical content; the caller cannot substitute a draft.
      const draft = await drafts.load(binding);
      return actionsFor(binding, context?.[panelInvocation] ? 'resolver' : 'agent')
        .execute_approved_comment({
        key: payload?.idempotencyKey, approvalId: payload?.approvalId, draft
      });
    },

    async getActionHistory(_payload, context) {
      const binding = await bindingFor(context);
      return actionsFor(binding).get_action_history();
    },

    approvalResolvers: {
      showDraft: request => invokePanel('showDraft', request),
      approve: request => invokePanel('approve', request),
      revoke: request => invokePanel('revoke', request),
      getActionHistory: request => invokePanel('getActionHistory', request),
      executeApproved: policyResult(async request => {
        logCall({ event: 'resolver_called:executeApproved',
          issueKey: request?.context?.extension?.issue?.key, via: 'resolver' });
        const context = await panelContext(request?.context);
        const approvalId = request?.payload?.approvalId;
        if (!present(approvalId))
          return { status: 'rejected', reason: 'APPROVAL_NOT_FOUND' };
        // Only server context supplies identity and destination. The approval
        // determines the request key across clicks, reloads and app instances.
        return application.executeApprovedComment({
          issueKey: context.extension.issue.key, approvalId,
          idempotencyKey: `panel-approved:${approvalId}`
        }, { [panelInvocation]: true, principal: { accountId: context.accountId },
          installContext: context.installContext });
      })
    }
  };
  for (const name of ['findRelatedPages', 'collectEvidence', 'prepareComment',
    'executeApprovedComment', 'getActionHistory']) {
    application[name] = policyResult(application[name]);
  }
  return application;
}
