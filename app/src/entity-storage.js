// Observed Forge conflict: only this code confirms a rejected conditional write.
export function isConditionalCheckFailure(error) {
  return error?.code === 'CONDITIONAL_CHECK_FAILED';
}

// Inject { kvs, Filter, FilterConditions } from the official SDK at integration.
// Entity schema: version (integer), state (any). One bounded aggregate per key.
// Provision { version: 0, state: emptyStore() } with FAIL_IF_EXISTS in trusted
// setup, never an unconditional write or a reset of an existing aggregate.
// Missing storage fails closed; this module does not initialize it.
export function createEntityStorage({ kvs, Filter, FilterConditions,
  entityName = 'evidence-state', key = 'state',
  isConditionalFailure = isConditionalCheckFailure }) {
  const validVersion = value => Number.isInteger(value) &&
    value >= 0 && value <= 2147483647;

  async function load() {
    const row = await kvs.entity(entityName).get(key);
    if (row === undefined || row === null)
      throw new Error('STORE_NOT_INITIALIZED');
    if (!validVersion(row.version) || !row.state ||
        !Array.isArray(row.state.approvals) || !Array.isArray(row.state.comments))
      throw new Error('INVALID_STORED_STATE');
    return structuredClone({ version: row.version, state: row.state });
  }

  async function compareAndSwap(expectedVersion, nextState) {
    if (!validVersion(expectedVersion) || expectedVersion === 2147483647)
      throw new Error('INVALID_STORE_VERSION');
    const replacement = structuredClone({
      version: expectedVersion + 1, state: nextState
    });
    const conditions = new Filter().and('version',
      FilterConditions.equalTo(expectedVersion));
    try {
      await kvs.transact().set(key, replacement, {
        entityName, conditions
      }).execute();
      return true;
    } catch (error) {
      // Only a confirmed conditional rejection permits recomputation.
      // Match the confirmed Forge error code, never message fragments.
      // Timeouts, unknown errors and uncertain commits must propagate.
      if (isConditionalFailure(error) === true) return false;
      throw error;
    }
  }

  return { load, compareAndSwap };
}
// Persist approval consumption and comment reservation in the same aggregate.
// No transaction here includes the remote Jira write. Respect Forge size limits.
