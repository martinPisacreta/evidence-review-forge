import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageInitializer } from '../src/initialize-storage.js';
import { emptyStore } from '../src/approval.js';

function fixture(initial) {
  let row = structuredClone(initial);
  const writes = [];
  const entity = {
    async set(key, value, options) {
      writes.push(structuredClone({ key, value, options }));
      assert.equal(key, 'state');
      assert.deepEqual(options, { keyPolicy: 'FAIL_IF_EXISTS' });
      // Check and insertion are atomic in this fake.
      if (row !== undefined) throw new Error('KEY_EXISTS');
      row = structuredClone(value);
    },
    async get(key) {
      assert.equal(key, 'state');
      return structuredClone(row);
    }
  };
  const kvs = { entity(name) {
    assert.equal(name, 'evidence-state');
    return entity;
  } };
  return { entity, writes, initialize: createStorageInitializer({ kvs }),
    read: () => structuredClone(row) };
}

test('missing state is created at version zero', async () => {
  const f = fixture();
  assert.deepEqual(await f.initialize(), { created: true });
  assert.deepEqual(f.read(), { version: 0, state: emptyStore() });
  assert.equal(f.writes.length, 1);
});

test('existing state and all additional fields remain unchanged', async () => {
  const existing = { version: 17, state: {
    approvals: [{ id: 'approval-used', consumedAt: 123 }],
    comments: [{ key: 'attempt-1', status: 'uncertain' }],
    drafts: [{ draftHash: 'synthetic-hash' }],
    reviews: [{ id: 'review-1' }]
  } };
  const f = fixture(existing);
  assert.deepEqual(await f.initialize(), { created: false });
  assert.deepEqual(await f.initialize(), { created: false });
  assert.deepEqual(f.read(), existing);
});

test('concurrent lifecycle events create exactly one initial row', async () => {
  const f = fixture();
  const results = await Promise.all([f.initialize(), f.initialize()]);
  assert.equal(results.filter(result => result.created).length, 1);
  assert.equal(results.filter(result => !result.created).length, 1);
  assert.deepEqual(f.read(), { version: 0, state: emptyStore() });
});

test('write failure with no confirmed state propagates unchanged', async () => {
  const f = fixture();
  const failure = new Error('STORAGE_UNAVAILABLE');
  f.entity.set = async () => { throw failure; };
  await assert.rejects(f.initialize, error => error === failure);
  assert.equal(f.read(), undefined);
});

test('failed confirmation read preserves the original write error', async () => {
  const f = fixture();
  const failure = new Error('WRITE_OUTCOME_UNKNOWN');
  f.entity.set = async () => { throw failure; };
  f.entity.get = async () => { throw new Error('READ_UNAVAILABLE'); };
  await assert.rejects(f.initialize, error => error === failure);
});

test('malformed existing state is rejected without replacement', async () => {
  const existing = { version: -1, state: { approvals: [], comments: [] } };
  const f = fixture(existing);
  await assert.rejects(f.initialize, /INVALID_STORED_STATE/);
  assert.deepEqual(f.read(), existing);
});
