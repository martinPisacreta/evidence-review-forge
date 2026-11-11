# Evidence Review

Evidence Review is an Atlassian Forge app built for Codegeist 2026. A Rovo agent collects evidence from Confluence and prepares a Jira comment that cites the exact page, version and quote. Nothing is published until a person reviews the destination, comment and citation in the issue panel and approves one attempt.

- Before approval: the issue panel shows the canonical draft and its citation.
- Approval is bound to the user, the installation, the issue and the draft, and it expires after 15 minutes.
- Execution re-checks the evidence before posting; changed, expired, revoked or already used approvals are rejected without posting.
- Related Confluence pages can be found through the Teamwork Graph API (Forge Preview).

**How it differs from built-in options.** Atlassian documents that [Rovo agents ask for confirmation before consequential tools](https://support.atlassian.com/rovo/docs/agent-actions/) and that [Jira Service Management AI answers](https://support.atlassian.com/jira-service-management-cloud/docs/atlassian-intelligence-answers-in-the-virtual-agent/) reply automatically in connected channels once activated (read 11 Nov 2026). Evidence Review adds a reviewable link between each proposed comment and the exact Confluence version and quote it relies on, with a single-use, expiring approval. We have not tested the alternatives, so we do not claim exclusivity.

This repository holds the app's public policies and the support channel:

- [Privacy policy](PRIVACY.md)
- [Terms of use](TERMS.md)
- [Support](SUPPORT.md): use this repository's [issue tracker](../../issues).

The app is intended for test sites with synthetic data.
