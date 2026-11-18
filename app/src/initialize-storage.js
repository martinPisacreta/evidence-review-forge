import { emptyStore } from './approval.js';

// Conditional entity creation:
// https://developer.atlassian.com/platform/forge/storage-reference/entities-api/
// Installation lifecycle event:
// https://developer.atlassian.com/platform/forge/events-reference/life-cycle/
// Trigger registration:
// https://developer.atlassian.com/platform/forge/manifest-reference/modules/trigger/

export function createStorageInitializer({ kvs,
  entityName = 'evidence-state', key = 'state' }) {
  return async function initializeStorage() {
    const entity = kvs.entity(entityName);
    try {
      await entity.set(key, { version: 0, state: emptyStore() },
        { keyPolicy: 'FAIL_IF_EXISTS' });
      return { created: true };
    } catch (writeError) {
      // A duplicate event or concurrent installer may have created the row.
      // Confirm the postcondition without guessing SDK error codes.
      // This read never authorizes an unconditional replacement.
      let existing;
      try { existing = await entity.get(key); }
      catch { throw writeError; }
      if (existing === undefined || existing === null) throw writeError;
      if (!Number.isInteger(existing.version) || existing.version < 0 ||
          existing.version > 2147483647 ||
          !Array.isArray(existing.state?.approvals) ||
          !Array.isArray(existing.state?.comments))
        throw new Error('INVALID_STORED_STATE');
      // Existence is confirmed; the cause of the write error remains unknown.
      // Preserve every field, including drafts, reviews and uncertain outcomes.
      return { created: false };
    }
  };
}
