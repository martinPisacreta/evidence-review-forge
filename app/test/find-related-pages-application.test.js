import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/composition.js';
import { createProductClients } from '../src/product-clients.js';
import { createMemoryStorage } from '../src/store-adapter.js';

function fixture({ edges = [], errors, jiraStatus = 200 } = {}) {
  const calls = [];
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300, status,
    async json() { return body; }
  });
  const user = {
    async requestJira(path) {
      calls.push({ kind: 'jira', path });
      return response({ key: 'DESIGN-8', id: '66401' }, jiraStatus);
    },
    async requestTeamworkGraph(query, variables, operationName, extensions, headers) {
      calls.push({ kind: 'graph', query, variables, operationName, extensions, headers });
      return response({ data: { customQuery: { edges } },
        ...(errors === undefined ? {} : { errors }) });
    }
  };
  const route = (parts, ...values) => parts.reduce(
    (text, part, index) => text + part + (values[index] ?? ''), '');
  const clients = createProductClients({ api: { asUser: () => user }, route });
  const storage = createMemoryStorage();
  const application = createApplication({ storage, ...clients });
  const context = { principal: { accountId: 'trusted-user' },
    installContext: 'trusted-installation', cloudId: 'trusted-cloud' };
  return { application, storage, context, calls };
}

test('empty related pages include the warning and preserve stored state', async () => {
  const f = fixture();
  const before = structuredClone(await f.storage.load());
  assert.deepEqual(await f.application.findRelatedPages(
    { issueKey: 'DESIGN-8' }, f.context), {
    pages: [],
    warning: 'empty result does not prove there is no relationship'
  });
  assert.deepEqual(await f.storage.load(), before);
  assert.deepEqual(f.calls.map(call => call.kind), ['jira', 'graph']);
});

test('related pages use trusted cloudId despite forged payload context', async () => {
  const id = 'ari:cloud:confluence:trusted-cloud:page/5767169';
  const f = fixture({ edges: [{ node: { columns: [{ value: { id,
    data: { __typename: 'ConfluencePage', id, title: 'Related procedure' }
  } }] } }] });
  const before = structuredClone(await f.storage.load());
  const result = await f.application.findRelatedPages({
    issueKey: 'DESIGN-8', cloudId: 'forged-cloud',
    context: { cloudId: 'forged-cloud', principal: { accountId: 'forged-user' } }
  }, f.context);
  assert.deepEqual(result, { pages: [
    { pageId: '5767169', title: 'Related procedure' }
  ] });
  assert.equal(f.calls[1].variables.queryParams.issueId,
    'ari:cloud:jira:trusted-cloud:issue/66401');
  assert.equal(f.calls[1].operationName, 'EvidenceReview_RelatedPages');
  assert.equal(f.calls[1].extensions, undefined);
  assert.deepEqual(f.calls[1].headers, {
    'X-Query-Context': 'ari:cloud:platform::site/trusted-cloud'
  });
  assert.deepEqual(await f.storage.load(), before);
});

test('invalid related-pages issue keys use the existing public rejection', async () => {
  const f = fixture();
  for (const issueKey of [undefined, null, '', ' DESIGN-8', 'DESIGN-8 ', 42]) {
    assert.deepEqual(await f.application.findRelatedPages(
      { issueKey }, f.context),
    { status: 'rejected', reason: 'INVALID_ISSUE_KEY' });
  }
  assert.deepEqual(f.calls, []);
});

test('related-pages GraphQL errors propagate through the result wrapper', async () => {
  const f = fixture({ errors: [{ message: 'Denied' }] });
  await assert.rejects(f.application.findRelatedPages(
    { issueKey: 'DESIGN-8' }, f.context),
  { message: 'TEAMWORK_GRAPH_GRAPHQL_ERROR: Denied' });
});

test('related-pages Jira authorization failures use the existing rejection', async () => {
  const f = fixture({ jiraStatus: 403 });
  assert.deepEqual(await f.application.findRelatedPages(
    { issueKey: 'DESIGN-8' }, f.context),
  { status: 'rejected', reason: 'PRODUCT_HTTP_403' });
  assert.deepEqual(f.calls.map(call => call.kind), ['jira']);
});

test('payload identity cannot replace missing trusted invocation context', async () => {
  const f = fixture();
  await assert.rejects(f.application.findRelatedPages(
    { issueKey: 'DESIGN-8', context: f.context }, {}),
  { message: 'TRUSTED_CONTEXT_REQUIRED' });
  assert.deepEqual(f.calls, []);
});

test('payload cloudId cannot replace missing trusted cloudId', async () => {
  const f = fixture();
  const { cloudId, ...context } = f.context;
  await assert.rejects(f.application.findRelatedPages(
    { issueKey: 'DESIGN-8', cloudId }, context),
  { message: 'TRUSTED_CLOUD_ID_REQUIRED' });
  assert.deepEqual(f.calls.map(call => call.kind), ['jira']);
});


for (const product of ['jira', 'confluence']) {
  test(`related pages derive cloudId from trusted ${product} installation`, async () => {
    const f = fixture();
    const { cloudId, ...context } = f.context;
    context.installContext = `ari:cloud:${product}::site/${cloudId}`;
    const before = structuredClone(await f.storage.load());
    assert.deepEqual(await f.application.findRelatedPages({
      issueKey: 'DESIGN-8',
      cloudId: 'forged-cloud',
      installContext: 'ari:cloud:jira::site/forged-cloud',
      context: { cloudId: 'forged-cloud',
        installContext: 'ari:cloud:confluence::site/forged-cloud' }
    }, context), { pages: [],
      warning: 'empty result does not prove there is no relationship' });
    assert.equal(f.calls[1].variables.queryParams.issueId,
      'ari:cloud:jira:trusted-cloud:issue/66401');
    assert.deepEqual(await f.storage.load(), before);
  });
}

test('related pages reject malformed installation ARIs despite forged payload identifiers', async () => {
  for (const installContext of [
    'trusted-installation',
    'ari:cloud:other::site/trusted-cloud',
    'ari:cloud:jira:unexpected:site/trusted-cloud',
    'ari:cloud:jira::site/',
    'ari:cloud:jira::site/trusted-cloud/extra',
    'ari:cloud:jira::site/trusted:cloud',
    'ari:cloud:jira::site/trusted cloud',
    ' ari:cloud:jira::site/trusted-cloud',
    'ari:cloud:jira::site/trusted-cloud\n'
  ]) {
    const f = fixture();
    const { cloudId, ...context } = f.context;
    context.installContext = installContext;
    await assert.rejects(f.application.findRelatedPages({
      issueKey: 'DESIGN-8', cloudId,
      installContext: `ari:cloud:jira::site/${cloudId}`,
      context: f.context
    }, context), { message: 'TRUSTED_CLOUD_ID_REQUIRED' });
    assert.deepEqual(f.calls.map(call => call.kind), ['jira']);
  }
});

test('explicit trusted cloudId takes precedence over installation cloudId', async () => {
  const f = fixture();
  const context = { ...f.context,
    installContext: 'ari:cloud:jira::site/different-cloud' };
  await f.application.findRelatedPages({ issueKey: 'DESIGN-8',
    cloudId: 'forged-cloud',
    installContext: 'ari:cloud:jira::site/forged-cloud' }, context);
  assert.equal(f.calls[1].variables.queryParams.issueId,
    'ari:cloud:jira:trusted-cloud:issue/66401');
});

test('invalid explicit cloudId is rejected rather than replaced by installation fallback', async () => {
  const f = fixture();
  await assert.rejects(f.application.findRelatedPages({
    issueKey: 'DESIGN-8'
  }, { ...f.context, cloudId: 'invalid/cloud',
    installContext: 'ari:cloud:jira::site/trusted-cloud' }),
  { message: 'TRUSTED_CLOUD_ID_REQUIRED' });
  assert.deepEqual(f.calls.map(call => call.kind), ['jira']);
});
