# Evidence Review — app source

This folder holds the source of the Forge app described in the repository README: it prepares Jira comments with cited Confluence evidence, and publishes one only after a person approves it in the Jira issue panel.

- `src/` — the application, the product adapters and the Jira approval panel (`src/frontend/`).
- `test/` — local tests with synthetic fixtures and in-memory fakes.
- `manifest.yml` — the Forge modules, Rovo agent, actions and permissions.
- `package.json`, `package-lock.json` — dependencies and the test command.

## Run the local tests

The tests use Node's built-in test runner and fakes only. They need no Atlassian account, no network and no installed dependencies. With Node 22, from this folder:

```sh
node --test
```

Checked on 18 November 2026 from a fresh copy of this folder with no `node_modules`: 149 of 149 tests pass. Checked again on 20 November 2026 after the call-logging and approval-panel changes: 159 of 159 tests pass. `npm test` runs the same command.

`npm ci` is only needed to lint or deploy with the Forge CLI. The lockfile was checked with `npm ci --dry-run`; a full install and a deploy from this copy were not performed.

## Two placeholders

This source is the one deployed to production on 20 November 2026 (major version 2; it adds call logging and an approval-panel fix to the build of 18 November, version 2.1.0), except for two identifiers that belong to the author's app registration:

- `manifest.yml`: the app id is `REPLACE-WITH-YOUR-APP-ID`. Run `forge register` to get your own.
- `src/product-clients.js`: `RELATED_PAGES_QUERY_KEY` is a placeholder. The related-pages lookup uses a Teamwork Graph persisted query registered for one app; to use it you must register your own query and put its key there. The tests assert the same placeholder value.

## Where to look first

- The approval and its checks (single use, expiry, a changed draft invalidates it, citations verified against the retrieved excerpt): `src/approval.js` and `test/approval.test.js`.
- One execution per approval under repeated or concurrent requests: `test/concurrency.test.js`.
- The route from the Jira panel to publication (`executeApproved`) and the refusal when the source version changed: `src/composition.js` and `test/composition.test.js`.
- The published text is rendered only from the draft that was hashed and approved: `src/comment-text.js`.

What was run on a real site, and what was not, is in [JUDGE-WALKTHROUGH.md](../JUDGE-WALKTHROUGH.md).
