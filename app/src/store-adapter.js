import { emptyStore, createApproval, revokeApproval,
  beginComment, finishComment } from './approval.js';

// Storage contract, scoped to one trusted installation:
// load(): Promise<{ version, state }> returns an isolated snapshot.
// compareAndSwap(version, state): Promise<boolean> atomically replaces the
// WHOLE state only if the stored version matches, incrementing that version.
// Approval consumption and comment reservation must commit together.
// A get() followed by an unconditional set() does not satisfy this contract.
// Never perform network calls or other side effects inside a transition.

export function createMemoryStorage(initial = emptyStore()) {
  let state = structuredClone(initial);
  let version = 0;
  return {
    async load() {
      return { version, state: structuredClone(state) };
    },
    async compareAndSwap(expectedVersion, nextState) {
      // No await between the check and replacement: atomic in this JS process.
      if (expectedVersion !== version) return false;
      const replacement = structuredClone(nextState);
      state = replacement;
      version += 1;
      return true;
    }
  };
}

export function createStoreAdapter(storage) {
  async function commit(transition) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const snapshot = await storage.load();
      const result = transition(snapshot.state);
      if (await storage.compareAndSwap(snapshot.version, result.store))
        return structuredClone(result);
      // Recompute against fresh state; never return a losing reservation.
    }
    throw new Error('STORE_CONTENTION');
  }

  return {
    createApproval(input, now) {
      const request = structuredClone(input);
      return commit(state => ({ store: createApproval(state, request, now) }));
    },
    revokeApproval(input, now) {
      const request = structuredClone(input);
      return commit(state => ({ store: revokeApproval(state, request, now) }));
    },
    beginComment(input, now) {
      const request = structuredClone(input);
      return commit(state => beginComment(state, request, now));
    },
    finishComment(input, now) {
      const request = structuredClone(input);
      return commit(state => ({ store: finishComment(state, request, now) }));
    }
  };
}

// Only a successfully committed shouldExecute=true permits a Jira attempt.
// A rejected or ambiguous storage response grants no execution permission.
// Trusted callers provide authenticated bindings, evidence and server time.
// This memory implementation is a process-local simulation, not Forge storage.
// It loses all state on restart and provides no cross-process coordination.
// Pending/uncertain outcomes require reconciliation, never automatic reposting.
