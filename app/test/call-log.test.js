import test from 'node:test';
import assert from 'node:assert/strict';
import { createActions } from '../src/actions.js';

test('prepare_comment logs exactly once per call without private content', async t => {
  const lines = [];
  t.mock.method(console, 'log', line => lines.push(line));
  const text = 'PRIVATE COMMENT CONTENT 104';
  const quote = 'Source evidence for the test.';
  const draft = { text, citations: [{ documentId: 'document-test', version: 1, quote }] };
  const actions = createActions({
    storage: {
      async load() { return { version: 0, state: { approvals: [], comments: [] } }; },
      async compareAndSwap() { return true; }
    },
    confluence: { async getPage() {
      return { documentId: 'document-test', version: 1, text: quote };
    } },
    jira: {},
    context: { user: 'private-user-104', site: 'private-site-104', destination: 'DESIGN-14' }
  });
  await actions.prepare_comment({ draft });
  assert.equal(lines.length, 1);
  const first = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(first).sort(), ['at', 'draftRef', 'event', 'issueKey', 'via']);
  assert.equal(first.event, 'prepare_comment_called');
  assert.equal(first.issueKey, 'DESIGN-14');
  assert.equal(first.via, 'agent');
  assert.equal(first.draftRef, null);
  assert.equal(new Date(first.at).toISOString(), first.at);
  await actions.prepare_comment({ draft });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => JSON.parse(line).event),
    ['prepare_comment_called', 'prepare_comment_called']);
  assert.deepEqual(lines.map(line => JSON.parse(line).issueKey), ['DESIGN-14', 'DESIGN-14']);
  for (const line of lines) {
    for (const privateValue of [text, quote, 'document-test', 'private-user-104', 'private-site-104'])
      assert.equal(line.includes(privateValue), false);
  }
});
