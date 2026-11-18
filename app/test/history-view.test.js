import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunHistoryView, loadRunHistoryView } from '../src/frontend/history-view.js';

const binding = { user: 'human-1', site: 'site-1', destination: 'SUP-42' };
function fixture(statuses = ['succeeded', 'failed', 'pending', 'uncertain']) {
  return {
    approvals: [{ id: 'approval-1', binding: { ...binding } }],
    comments: statuses.map((status, index) => ({
      key: `run-${index}`, approvalId: 'approval-1', binding: { ...binding },
      status, reservedAt: 1000 + index, updatedAt: 2000 + index
    }))
  };
}

test('all four execution states have distinct text and appearance', () => {
  const rows = buildRunHistoryView(fixture());
  assert.deepEqual(rows.map(row => [row.status, row.label, row.appearance]), [
    ['uncertain', 'Uncertain', 'moved'],
    ['pending', 'Pending', 'inprogress'],
    ['failed', 'Failed', 'removed'],
    ['succeeded', 'Success', 'success']
  ]);
  for (const row of rows) {
    assert.equal(row.action, 'Post Jira comment');
    assert.equal(row.approvedBy, 'human-1');
  }
  assert.equal(rows[0].dateTime, new Date(1003).toISOString());
});

test('shows only the ten latest reservations without mutating history', () => {
  const history = fixture(Array(12).fill('pending'));
  history.comments[0].updatedAt = 999999;
  const original = structuredClone(history);
  const rows = buildRunHistoryView(history);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].key, 'run-11');
  assert.equal(rows[9].key, 'run-2');
  assert.deepEqual(history, original);
});

test('does not attribute an execution to an unrelated approval', () => {
  for (const field of ['user', 'site', 'destination']) {
    const history = fixture(['succeeded']);
    history.approvals[0].binding[field] = 'other';
    assert.equal(buildRunHistoryView(history)[0].approvedBy, 'Approval unavailable');
  }
  const history = fixture(['succeeded']);
  history.approvals[0].id = 'other-approval';
  assert.equal(buildRunHistoryView(history)[0].approvedBy, 'Approval unavailable');
});

test('unknown outcomes remain uncertain and missing times stay explicit', () => {
  const history = fixture(['unexpected']);
  delete history.comments[0].reservedAt;
  const [row] = buildRunHistoryView(history);
  assert.equal(row.status, 'uncertain');
  assert.equal(row.label, 'Uncertain');
  assert.equal(row.dateTime, 'Time unavailable');
});

test('empty history differs from an invalid response', () => {
  assert.deepEqual(buildRunHistoryView({ comments: [], approvals: [] }), []);
  assert.throws(() => buildRunHistoryView(null), /INVALID_HISTORY/);
  assert.throws(() => buildRunHistoryView({ comments: [] }), /INVALID_HISTORY/);
});

test('loads history once without invoking execution or approval operations', async () => {
  const calls = [];
  const rows = await loadRunHistoryView(async (...args) => {
    calls.push(args);
    return fixture(['uncertain']);
  });
  assert.deepEqual(calls, [['getActionHistory']]);
  assert.equal(rows[0].status, 'uncertain');
});

test('bridge failures propagate without retries or an empty success result', async () => {
  let calls = 0;
  await assert.rejects(loadRunHistoryView(async () => {
    calls += 1;
    throw new Error('BRIDGE_FAILURE');
  }), /BRIDGE_FAILURE/);
  assert.equal(calls, 1);
});
