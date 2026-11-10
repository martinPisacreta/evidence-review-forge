# Privacy Policy — Evidence Review

Evidence Review processes Atlassian account identifiers (accountId), installation context, and Jira issue keys to associate records with the authenticated user and installation. Draft text and quoted content may contain personal information supplied by users.

The app saves canonical drafts containing comment text and citations: Confluence page identifiers, versions, and selected quotes. Approval records contain identifiers, user and installation bindings, the destination issue, a draft hash, and creation, expiry, revocation, and consumption timestamps. Execution records contain an idempotency key, approval identifier, bindings, draft hash, status, Jira comment identifier when successful, and timestamps.

These records are stored in the installation's Atlassian Forge application storage. The app reads Confluence page text to retrieve and verify citations. Selected quotes are saved within drafts and included in Jira comments when an approved execution succeeds. Preparing a draft does not publish a comment.

The reviewed application code communicates with Atlassian through Jira, Confluence, and Teamwork Graph APIs. It contains no data transmissions to developer-operated servers or other external services; the manifest declares no external data egress. Page text is processed for citations rather than exported to a developer-operated service.

The reviewed code implements no automatic deletion schedule or fixed retention period. Saving a new draft replaces the previous draft for the same user, installation, and issue. Approval expiry prevents execution with that approval; it does not delete the record. Immediate deletion upon uninstall is not established by this code.

Use synthetic data on test sites. Request help through the repository's issue tracker without including credentials, personal data, or private content.
