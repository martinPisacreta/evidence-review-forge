import { hashDraft } from './approval.js';

const fields = ['user', 'site', 'destination'];
const present = value => typeof value === 'string' && value.trim().length > 0;
const same = (left, right) => fields.every(key => left?.[key] === right?.[key]);

function checkedBinding(binding) {
  if (!fields.every(key => present(binding?.[key])))
    throw new Error('INVALID_BINDING');
  return Object.fromEntries(fields.map(key => [key, binding[key]]));
}

// Call only from trusted backend composition, after context resolution.
// save receives a draft already validated by prepare_comment.
// The panel retrieves it by trusted binding, never by browser-supplied identity.
export function createDraftRepository(storage) {
  return {
    async save(binding, draft) {
      const owner = checkedBinding(binding);
      const value = structuredClone(draft);
      const draftHash = hashDraft(value);
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const snapshot = await storage.load();
        const drafts = snapshot.state.drafts ?? [];
        if (!Array.isArray(drafts)) throw new Error('INVALID_DRAFT_REPOSITORY');
        const retained = drafts.filter(row => !same(row.binding, owner));
        const next = { ...snapshot.state, drafts: [...retained,
          { binding: owner, draft: value, draftHash }] };
        if (await storage.compareAndSwap(snapshot.version, next))
          return { draftHash };
      }
      throw new Error('STORE_CONTENTION');
    },

    async load(binding) {
      const owner = checkedBinding(binding);
      const snapshot = await storage.load();
      const drafts = snapshot.state.drafts ?? [];
      if (!Array.isArray(drafts)) throw new Error('INVALID_DRAFT_REPOSITORY');
      const matches = drafts.filter(row => same(row.binding, owner));
      if (matches.length === 0) throw new Error('DRAFT_NOT_FOUND');
      if (matches.length !== 1) throw new Error('INVALID_DRAFT_REPOSITORY');
      const record = matches[0];
      if (hashDraft(record.draft) !== record.draftHash)
        throw new Error('STORED_DRAFT_CHANGED');
      return structuredClone(record.draft);
    }
  };
}
