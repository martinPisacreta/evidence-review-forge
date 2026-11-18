import test from 'node:test';
import assert from 'node:assert/strict';
import { createForgeHandlers } from '../src/forge-entry.js';
import { createEntityStorage } from '../src/entity-storage.js';
import { emptyStore } from '../src/approval.js';

class ConditionalFailure extends Error {}
class Filter {
  and(attribute, condition) {
    this.attribute = attribute; this.condition = condition; return this;
  }
}
const FilterConditions = { equalTo: value => ({ value }) };
function fixture(initial = { version: 0, state: emptyStore() }) {
  let row = structuredClone(initial);
  let failure;
  const writes = [];
  const kvs = {
    entity(name) {
      assert.equal(name, 'evidence-state');
      return { async get(key) {
        assert.equal(key, 'state'); return structuredClone(row);
      } };
    },
    transact() {
      let operation;
      return {
        set(key, value, options) {
          operation = { key, value: structuredClone(value), options };
          return this;
        },
        async execute() {
          if (failure) throw failure;
          const { key, value, options } = operation;
          assert.equal(key, 'state');
          assert.equal(options.entityName, 'evidence-state');
          assert.equal(options.conditions.attribute, 'version');
          if (!row || row.version !== options.conditions.condition.value)
            throw new ConditionalFailure();
          row = structuredClone(value); writes.push(operation);
        }
      };
    }
  };
  const storage = createEntityStorage({ kvs, Filter, FilterConditions,
    isConditionalFailure: error => error instanceof ConditionalFailure });
  return { storage, writes, fail(error) { failure = error; } };
}
const context = { principal: { accountId: 'trusted-user' },
  installContext: 'ari:cloud:jira::site/trusted-site' };
const draft = { text: 'Review this.', citations: [
  { documentId: 'page-1', version: 1, quote: 'Evidence.' }
] };

test('all handlers ignore payload identity, site and destination', async () => {
  const f = fixture();
  const seen = [];
  let sends = 0;
  const handlers = createForgeHandlers({ storage: f.storage,
    destinationForContext(received) {
      assert.equal(received, context); return 'SUP-42';
    },
    confluence: { async getPage({ binding }) {
      seen.push(binding);
      return { documentId: 'page-1', version: 1, text: 'Evidence.' };
    } },
    jira: { async createComment() { sends += 1; } }
  });
  const hostile = { user: 'attacker', site: 'wrong-site', destination: 'BAD-1',
    context: { principal: { accountId: 'attacker' }, installContext: 'wrong' },
    documentIds: ['page-1'], draft, key: 'key-1', approvalId: 'invented' };
  await handlers.collectEvidence(hostile, context);
  await handlers.prepareComment(hostile, context);
  await assert.rejects(handlers.executeApprovedComment(hostile, context),
    /APPROVAL_NOT_FOUND/);
  assert.equal((await handlers.getActionHistory(hostile, context)).approvals.length, 0);
  assert.equal(sends, 0);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(binding => binding.user === 'trusted-user' &&
    binding.site === context.installContext && binding.destination === 'SUP-42'));
  await assert.rejects(handlers.collectEvidence(hostile, {}),
    /TRUSTED_CONTEXT_REQUIRED/);
});

test('conditional transaction rejects stale versions and concurrent losers', async () => {
  const f = fixture();
  const snapshot = await f.storage.load();
  const results = await Promise.all([
    f.storage.compareAndSwap(snapshot.version, snapshot.state),
    f.storage.compareAndSwap(snapshot.version, snapshot.state)
  ]);
  assert.deepEqual(results, [true, false]);
  assert.equal(await f.storage.compareAndSwap(0, emptyStore()), false);
  assert.equal((await f.storage.load()).version, 1);
  assert.equal(f.writes.length, 1);
});

test('missing state and ambiguous storage errors fail closed', async () => {
  await assert.rejects(fixture(null).storage.load(), /STORE_NOT_INITIALIZED/);
  const f = fixture();
  const error = new Error('ambiguous transaction timeout');
  f.fail(error);
  await assert.rejects(f.storage.compareAndSwap(0, emptyStore()),
    caught => caught === error);
  assert.equal(f.writes.length, 0);
});
