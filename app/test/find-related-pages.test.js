import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductClients } from '../src/product-clients.js';

const cloudId = 'test-cloud';
const pageAri = `ari:cloud:confluence:${cloudId}:page/5767169`;
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  async json() { return body; }
});
const pageResult = { data: { customQuery: { edges: [
  { node: { columns: [{ value: { id: pageAri, data: {
    __typename: 'ConfluencePage', id: pageAri,
    title: 'Related procedure for DESIGN-8'
  } } }] } }
] } } };

function fixture(graphResponse = response(pageResult), jiraStatus = 200) {
  const calls = [];
  const user = {
    async requestJira(path, options) {
      calls.push({ kind: 'jira', path, options });
      return response({ key: 'DESIGN-8', id: '66401' }, jiraStatus);
    },
    async requestTeamworkGraph(query, variables, operationName, extensions, headers) {
      calls.push({ kind: 'graph', query, variables, operationName, extensions, headers });
      return graphResponse;
    }
  };
  const api = { asUser() { return user; } };
  const route = (parts, ...values) => parts.reduce(
    (text, part, index) => text + part + (values[index] ?? ''), '');
  return { clients: createProductClients({ api, route }), calls };
}

test('related pages returns numeric page ID and title using the authorized issue ARI', async () => {
  const { clients, calls } = fixture();
  assert.deepEqual(await clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
    [{ pageId: '5767169', title: 'Related procedure for DESIGN-8' }]);
  assert.deepEqual(calls.map(call => call.kind), ['jira', 'graph']);
  assert.equal(calls[0].path, '/rest/api/3/issue/DESIGN-8?fields=summary');
  const graph = calls[1];
  assert.equal(graph.operationName, 'EvidenceReview_RelatedPages');
  assert.equal(graph.extensions, undefined);
  assert.deepEqual(graph.headers, {
    'X-Query-Context': 'ari:cloud:platform::site/test-cloud'
  });
  assert.match(graph.query, /query EvidenceReview_RelatedPages\(/);
  assert.match(graph.query, /on ConfluencePage \{ id title \}/);
  assert.deepEqual(graph.variables, {
    queryKey: '00000000-0000-0000-0000-000000000000',
    queryParams: { issueId: 'ari:cloud:jira:test-cloud:issue/66401' }
  });
});

test('related pages preserves a genuine empty graph result', async () => {
  const { clients } = fixture(response({ data: { customQuery: { edges: [] } } }));
  assert.deepEqual(await clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }), []);
});

test('related pages rejects GraphQL errors even when data is present', async () => {
  const { clients } = fixture(response({ ...pageResult, errors: [{ message: 'Denied' }] }));
  await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
    { message: 'TEAMWORK_GRAPH_GRAPHQL_ERROR: Denied' });
});

test('related pages rejects HTTP errors rather than returning an empty result', async () => {
  const { clients } = fixture(response({}, 503));
  await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
    { message: 'TEAMWORK_GRAPH_HTTP_503' });
});

test('related pages uses the existing invalid issue key rejection before network access', async () => {
  const { clients, calls } = fixture();
  for (const issueKey of ['', ' DESIGN-8', 'DESIGN-8 ', null, 42]) {
    await assert.rejects(clients.findRelatedPages({ issueKey, cloudId }),
      { message: 'INVALID_ISSUE_KEY' });
    await assert.rejects(clients.resolveIssue(issueKey),
      { message: 'INVALID_ISSUE_KEY' });
  }
  assert.deepEqual(calls, []);
});

test('related pages requires Jira authorization before querying the graph', async () => {
  const { clients, calls } = fixture(response(pageResult), 403);
  await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
    { message: 'PRODUCT_HTTP_403' });
  assert.deepEqual(calls.map(call => call.kind), ['jira']);
});

test('related pages rejects malformed graph responses', async () => {
  for (const body of [{}, { data: { customQuery: { edges: null } } },
    { data: { customQuery: { edges: [{ node: { columns: [] } }] } } }]) {
    const { clients } = fixture(response(body));
    await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
      { message: 'INVALID_TEAMWORK_GRAPH_RESPONSE' });
  }
});


test('GraphQL diagnostics normalize whitespace and truncate the first message', async () => {
  const raw = '  Query\r\ncontext\tinvalid: ' + 'x'.repeat(200);
  const expected = ('Query context invalid: ' + 'x'.repeat(200)).slice(0, 160);
  const { clients } = fixture(response({ errors: [
    { message: raw }, { message: 'SECOND_ERROR_MUST_NOT_APPEAR' }
  ] }));
  await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
    { message: `TEAMWORK_GRAPH_GRAPHQL_ERROR: ${expected}` });
});

test('GraphQL diagnostics retain the generic error without a usable first message', async () => {
  for (const first of [null, {}, { message: null }, { message: 42 },
    { message: ' \r\n\t' }]) {
    const { clients } = fixture(response({ errors: [first, { message: 'Ignored' }] }));
    await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
      { message: 'TEAMWORK_GRAPH_GRAPHQL_ERROR' });
  }
});

test('GraphQL diagnostics suppress credential and header details before truncation', async () => {
  for (const message of [
    'Authorization: Bearer private-value',
    'Bearer\r\nprivate-value',
    'token=private-value',
    'X-Query-Context: private-site',
    'headers: private-value',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    'x'.repeat(170) + ' api_key=private-value'
  ]) {
    const { clients } = fixture(response({ errors: [{ message }] }));
    await assert.rejects(clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId }),
      { message: 'TEAMWORK_GRAPH_GRAPHQL_ERROR' });
  }
});


test('related pages sends the registered persisted query key and issue parameters', async () => {
  const { clients, calls } = fixture();
  await clients.findRelatedPages({ issueKey: 'DESIGN-8', cloudId });
  const graph = calls.find(call => call.kind === 'graph');
  assert.deepEqual(graph.variables, {
    queryKey: '00000000-0000-0000-0000-000000000000',
    queryParams: { issueId: 'ari:cloud:jira:test-cloud:issue/66401' }
  });
  assert.match(graph.query, /\$queryKey: String!/);
  assert.match(graph.query, /\$queryParams: CypherRequestParams/);
  assert.match(graph.query, /customQuery\(queryKey: \$queryKey, queryParams: \$queryParams, first: 25\)/);
  assert.doesNotMatch(graph.query, /cypherQuery/);
});
