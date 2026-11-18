import { createActions } from './actions.js';

const present = value => typeof value === 'string' && value.trim().length > 0;
// Forge invokes handlers as (payload, context). payload.context is not used.
// installContext is the installation's context ARI, not a bare cloudId.
// destinationForContext is trusted backend code; it receives no payload.
// It must return an authorized Jira destination or reject the invocation.
export function createForgeHandlers({ storage, confluence, jira,
  destinationForContext, now = Date.now, timeoutMs = 1000 }) {
  if (typeof destinationForContext !== 'function')
    throw new Error('DESTINATION_RESOLVER_REQUIRED');

  async function actionsFor(context) {
    const user = context?.principal?.accountId;
    const site = context?.installContext;
    if (!present(user) || !present(site))
      throw new Error('TRUSTED_CONTEXT_REQUIRED');
    const destination = await destinationForContext(context);
    if (!present(destination)) throw new Error('TRUSTED_DESTINATION_REQUIRED');
    return createActions({ storage, confluence, jira, now, timeoutMs,
      context: { user, site, destination } });
  }

  return {
    async collectEvidence(payload, context) {
      const actions = await actionsFor(context);
      return actions.collect_evidence({ documentIds: payload?.documentIds });
    },
    async prepareComment(payload, context) {
      const actions = await actionsFor(context);
      return actions.prepare_comment({ draft: payload?.draft });
    },
    async executeApprovedComment(payload, context) {
      const actions = await actionsFor(context);
      return actions.execute_approved_comment({ key: payload?.key,
        approvalId: payload?.approvalId, draft: payload?.draft });
    },
    async getActionHistory(_payload, context) {
      const actions = await actionsFor(context);
      return actions.get_action_history();
    }
  };
}
// Factory only: SDK wiring, manifest input mapping and authorized destination
// resolution must be supplied by the real Forge integration.
// No identity, site, destination or approval claim is imported from payload.
