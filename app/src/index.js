import api, { route } from '@forge/api';
import ResolverModule from '@forge/resolver';
// @forge/resolver is CommonJS (exports.default): with "type": "module" the default import is the module object.
const Resolver = ResolverModule.default ?? ResolverModule;
import { kvs, Filter, FilterConditions } from '@forge/kvs';
import { createEntityStorage, isConditionalCheckFailure } from './entity-storage.js';
import { createProductClients } from './product-clients.js';
import { createApplication } from './composition.js';
import { createStorageInitializer } from './initialize-storage.js';

// Official SDK entry point. SDK-free tests import the factories directly.
const clients = createProductClients({ api, route });
// A rejected conditional write was not committed, so the caller may reload and recompute.
// Observed on the real site 2026-10-29: ForgeKvsAPIError code CONDITIONAL_CHECK_FAILED.
const storage = createEntityStorage({ kvs, Filter, FilterConditions,
  isConditionalFailure: isConditionalCheckFailure });
const application = createApplication({ storage, ...clients });
const initializeState = createStorageInitializer({ kvs });

// Lifecycle events supply no user-controlled storage key or replacement state.
// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/
export async function initializeStorage() {
  const result = await initializeState();
  console.log('EVIDENCE_STORE_INITIALIZATION',
    result.created ? 'created' : 'existing-preserved');
  return result;
}

export const findRelatedPages = (payload, context) =>
  application.findRelatedPages(payload, context);

export const collectEvidence = (payload, context) =>
  application.collectEvidence(payload, context);

export const prepareComment = (payload, context) =>
  application.prepareComment(payload, context);

export const executeApprovedComment = (payload, context) =>
  application.executeApprovedComment(payload, context);

export const getActionHistory = (payload, context) =>
  application.getActionHistory(payload, context);

// Approval creation is available exclusively through the human issue panel.
// Forward Forge's resolver request unchanged; never merge payload into context.
const resolver = new Resolver();
for (const name of ['showDraft', 'approve', 'revoke', 'getActionHistory', 'executeApproved']) {
  resolver.define(name, request => application.approvalResolvers[name](request));
}
export const approvalResolver = resolver.getDefinitions();
