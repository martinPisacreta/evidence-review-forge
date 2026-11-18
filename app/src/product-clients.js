// SDK dependencies are injected by index.js; this module imports no @forge code.
const present = value => typeof value === 'string' && value.trim().length > 0;

async function readJson(response) {
  if (!response.ok) throw new Error(`PRODUCT_HTTP_${response.status}`);
  return response.json();
}

function documentText(serialized) {
  const document = JSON.parse(serialized);
  if (document?.type !== 'doc' || !Array.isArray(document.content))
    throw new Error('INVALID_DOCUMENT_BODY');
  function extract(node) {
    if (node?.type === 'text') return node.text ?? '';
    if (node?.type === 'hardBreak') return '\n';
    const content = Array.isArray(node?.content)
      ? node.content.map(extract).join('') : '';
    const block = ['paragraph', 'heading', 'listItem', 'tableRow', 'codeBlock'];
    return content + (block.includes(node?.type) ? '\n' : '');
  }
  return extract(document).trim();
}

const RELATED_PAGES_QUERY_KEY = '00000000-0000-0000-0000-000000000000';
const relatedPagesOperation = 'EvidenceReview_RelatedPages';
const relatedPagesQuery = `
query EvidenceReview_RelatedPages($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: 25) {
    edges { node { columns { value {
      ... on CypherQueryResultNode {
        id
        data { __typename ... on ConfluencePage { id title } }
      }
    } } } }
  }
}`;

function graphErrorMessage(errors) {
  const raw = errors[0]?.message;
  if (typeof raw !== 'string') return 'TEAMWORK_GRAPH_GRAPHQL_ERROR';
  // Suppress diagnostics that appear to contain credentials or headers.
  const sensitive = /(?:bearer\s|basic\s|authorization|cookie|x-query-context|headers?\s*[:=]|(?:token|secret|password|api[-_ ]?key)\s*[:=]|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/i;
  const normalized = raw.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  if (!normalized || sensitive.test(normalized))
    return 'TEAMWORK_GRAPH_GRAPHQL_ERROR';
  return `TEAMWORK_GRAPH_GRAPHQL_ERROR: ${normalized.slice(0, 160)}`;
}

export function createProductClients({ api, route }) {
  if (typeof api?.asUser !== 'function' || typeof route !== 'function')
    throw new Error('PRODUCT_CLIENT_DEPENDENCIES_REQUIRED');

  async function authorizedIssue(issueKey) {
    // An explicit key selects a resource; asUser establishes authorization.
    if (!present(issueKey) || issueKey !== issueKey.trim())
      throw new Error('INVALID_ISSUE_KEY');
    const response = await api.asUser().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary`,
      { headers: { Accept: 'application/json' } });
    const issue = await readJson(response);
    if (!present(issue.key) || !present(issue.id))
      throw new Error('INVALID_JIRA_ISSUE');
    return issue;
  }

  async function resolveIssue(issueKey) {
    return (await authorizedIssue(issueKey)).key;
  }

  async function findRelatedPages({ issueKey, cloudId }) {
    const issue = await authorizedIssue(issueKey);
    // cloudId must come from trusted backend context, never action input.
    if (!present(cloudId) || cloudId !== cloudId.trim() ||
        /[:/\s]/.test(cloudId))
      throw new Error('TRUSTED_CLOUD_ID_REQUIRED');
    if (!/^[0-9]+$/.test(issue.id)) throw new Error('INVALID_JIRA_ISSUE');
    const issueId = `ari:cloud:jira:${cloudId}:issue/${issue.id}`;
    const response = await api.asUser().requestTeamworkGraph(
      relatedPagesQuery, {
        queryKey: RELATED_PAGES_QUERY_KEY,
        queryParams: { issueId }
      }, relatedPagesOperation, undefined, {
        'X-Query-Context': `ari:cloud:platform::site/${cloudId}`
      });
    if (!response.ok)
      throw new Error(`TEAMWORK_GRAPH_HTTP_${response.status}`);
    const result = await response.json();
    if (result?.errors !== undefined && !Array.isArray(result.errors))
      throw new Error('INVALID_TEAMWORK_GRAPH_RESPONSE');
    if (result?.errors?.length)
      throw new Error(graphErrorMessage(result.errors));
    const edges = result?.data?.customQuery?.edges;
    if (!Array.isArray(edges))
      throw new Error('INVALID_TEAMWORK_GRAPH_RESPONSE');
    const pages = new Map();
    for (const edge of edges) {
      const columns = edge?.node?.columns;
      if (!Array.isArray(columns) || columns.length !== 1)
        throw new Error('INVALID_TEAMWORK_GRAPH_RESPONSE');
      const value = columns[0]?.value;
      const page = value?.data;
      const match = typeof page?.id === 'string'
        ? /^ari:cloud:confluence:([^:]+):page\/([0-9]+)$/.exec(page.id)
        : null;
      if (page?.__typename !== 'ConfluencePage' || !match ||
          match[1] !== cloudId || value.id !== page.id || !present(page.title))
        throw new Error('INVALID_TEAMWORK_GRAPH_PAGE');
      pages.set(match[2], { pageId: match[2], title: page.title });
    }
    return [...pages.values()];
  }

  const confluence = {
    async getPage({ documentId }) {
      if (!present(documentId) || !/^[0-9]+$/.test(documentId))
        throw new Error('INVALID_DOCUMENT_ID');
      const response = await api.asUser().requestConfluence(
        route`/wiki/api/v2/pages/${documentId}?body-format=atlas_doc_format`,
        { headers: { Accept: 'application/json' } });
      const page = await readJson(response);
      const value = page.body?.atlas_doc_format?.value;
      if (String(page.id) !== documentId || page.status !== 'current' ||
          !Number.isSafeInteger(page.version?.number) ||
          page.version.number < 1 || typeof value !== 'string')
        throw new Error('INVALID_CONFLUENCE_PAGE');
      return { documentId, version: page.version.number, text: documentText(value) };
    }
  };

  const jira = {
    async createComment({ binding, text }) {
      if (!present(binding?.destination) || !present(text))
        throw new Error('INVALID_COMMENT');
      // Jira does not provide idempotency here. Durable reservation happens
      // before this call; ambiguous results must never trigger an automatic retry.
      const body = { body: { type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text }] }
      ] } };
      const response = await api.asUser().requestJira(
        route`/rest/api/3/issue/${binding.destination}/comment`,
        { method: 'POST', headers: { Accept: 'application/json',
          'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await readJson(response);
      if (!present(result.id)) throw new Error('COMMENT_OUTCOME_UNCONFIRMED');
      return { commentId: result.id };
    }
  };

  async function destinationForContext(context) {
    // Panel destinations originate exclusively in backend resolver context.
    const issueKey = context?.extension?.issue?.key;
    if (!present(issueKey)) throw new Error('TRUSTED_ISSUE_REQUIRED');
    return resolveIssue(issueKey);
  }

  return { confluence, jira, resolveIssue, destinationForContext, findRelatedPages };
}
