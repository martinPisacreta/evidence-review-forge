Status, 18 November 2026: these eight steps were run end to end by the author on a development installation of the app (development versions 3.8.0 and 3.9.0) with the synthetic material below. Production version 2.1.0 was built from the same source on the same day. On 19 November 2026 the author installed that production build in Jira and Confluence on the same test site, next to the development installation, and ran the steps once on a new synthetic issue (collect, prepare, load, approve, publish, repeat, reload): one Success row and exactly one Jira comment. It has not been installed on a separate site, so a judge's run is the first check of a fresh installation.

# Evidence Review: judge walkthrough

Prepare a cited Jira response, review it as a person, authorize one execution attempt, and check publication and replay. Use only the synthetic material below. Expected results are acceptance criteria for your run on your own installation.

## Before you start

You need an authorized test site with Jira, Confluence and Rovo, permission to create a page and issue, and permission to install and use the app in both products. Use the installation link given in the Devpost submission.

Keep the same authenticated user and installation context throughout collection, preparation, approval, history lookup and execution. Start from Jira. Use Evidence Review Assistant for collection and preparation, then the Jira issue panel for approval, execution and replay. An enabled MCP client remains an alternative for users who already have it.

Only replace <PAGE_ID> and <ISSUE_KEY> in the prompts. Use the actual version returned for your page. The panel handles the matching approval and execution key; you do not need to retrieve or enter them manually. Never copy identifiers from historical demonstrations. Do not edit the source page or replace the prepared draft during this run.

## Create the synthetic Confluence page

Title:

```text
SYNTHETIC Evidence Review — demo workspace procedure
```

Body:

```text
Synthetic training procedure. No customer systems or personal data are involved.
To reset the synthetic workspace, select Reset demo workspace and confirm Start fresh.
This procedure applies only to the fictional demo workspace used in this recording.
```

Publish the page. Find its numeric page ID in its address: for a URL containing /pages/123456789/, the ID is 123456789. This number is illustrative; use your own page's number as <PAGE_ID>. Do not use the space key or page title. If your URL does not expose a numeric page ID, stop and ask the site administrator to identify it; do not guess.

## Create the synthetic Jira issue

Summary:

```text
SYNTHETIC — How do I reset the demo workspace?
```

Description:

```text
Synthetic support exercise for Evidence Review. Explain how to reset the fictional demo workspace using the synthetic Confluence procedure. Prepare a cited response for human review. Do not publish before panel approval. No real customer or personal data is involved.
```

Use the issue key Jira assigns as <ISSUE_KEY>. Open that issue and record its initial comment count. If a direct issue link redirects to onboarding, try opening the issue from the project list; this workaround was recorded on the development site. Record the actual result.

## Numbered walkthrough

### 1. Collect the evidence

In Rovo, select Evidence Review Assistant. Paste:

```text
Use collect_evidence only with documentId="<PAGE_ID>". Show the returned documentId, numeric version and excerpt. Retain them for this walkthrough. Confirm whether the excerpt contains this exact sentence: To reset the synthetic workspace, select Reset demo workspace and confirm Start fresh. Do not prepare, approve or publish anything.
```

**Expected:** your page ID, its actual current version and an excerpt containing the sentence exactly. Never assume version 1. Rovo's wording varies; in the recorded run it listed the documentId, version 1, the three-line excerpt and confirmed the sentence.

**If it differs:** stop. Record the actual response and check page access and contents. Do not invent evidence or proceed with a missing quotation.

### 2. Prepare the comment without publishing

In the same conversation, paste:

```text
Use prepare_comment only for issueKey="<ISSUE_KEY>" with text equal to "To reset the synthetic workspace, select Reset demo workspace and confirm Start fresh.", documentId="<PAGE_ID>", version equal to the numeric version returned by collect_evidence in this conversation, and quote equal to that same exact sentence. Do not approve or execute anything.
```

Rovo shows a **Please review** card listing the issue key, text, document ID, version and quote. Check them and select **Confirm selected** once.

**Expected:** Rovo answers that the draft was saved for human review, that preparation does not publish, and points to the Jira issue panel **Evidence Review approval**. Inspect the issue: its comment count must remain unchanged. In the two recorded runs on development version 3.9.0 there was one card and one answer.

**If it differs:** if Rovo shows the card again or gives no answer, do not prepare a replacement: open the panel and use **Load proposal** (step 3) to see whether the draft was stored. In two earlier runs, on a version that asked Rovo for serialized JSON, the card appeared two or three times although the draft was stored. INVALID_PROPOSAL_REQUEST means the inputs were incomplete or malformed; it is not permission to publish. An unexpected comment is a failure of this preparation check.

### 3. Open and review the issue panel

On your Jira issue, open the issue's apps button and choose **Evidence Review approval**. On a new issue the panel is not shown by default; after its first use on an issue Jira shows it directly. Select **Load proposal**. No agent prompt is needed.

**Expected:** the panel displays the current proposal for your issue, the complete comment and a citation to your page at the collected version with the exact quotation. The recorded panel run displayed: “Citations match retrieved excerpts; correctness still needs human review.” Compare the destination, text and citation yourself. Loading the proposal must not publish a comment. On a fresh issue with no prior executions, Run history should show “No executions recorded.”

**If it differs:** do not approve. Record missing controls, load errors or content mismatches. Do not supply a different issue's identifiers to work around a failure.

### 4. Approve as a person

After reviewing the proposal, personally click **Approve this comment for one attempt, valid for 15 minutes**. No chat prompt replaces this action.

**Expected:** “Approval recorded. Approval does not publish; use Run approved comment to publish.” An approval expiry and the **Run approved comment** button are displayed. The comment count remains unchanged. On this fresh issue, Run history still shows “No executions recorded.”

**If it differs:** stop before execution. Record the actual panel response. If approval expires before execution, review the current proposal and approve again through the panel; do not bypass expiry.

### 5. Execute one approved attempt

In the same issue panel, click **Run approved comment** once. No agent prompt or manual approval ID or execution key is needed.

**Expected:** “Comment published. Repeating returns the same execution record.” Run history shows one **Success** row with “Post Jira comment”, a UTC timestamp and the approver account ID. Independently inspect Jira: exactly one new comment should contain the sentence, a source line identifying your Confluence page and collected version, and the exact quote. Publication remains unverified until the comment is inspected.

**If it differs:** record the actual response and inspect comments and history. For an uncertain outcome, do not obtain a new approval to resend. The frontend contains “Outcome uncertain. Check Jira; repeating will not send again.”; this outcome through the button was not exercised on a site. If records remain inconclusive, stop.

### 6. Repeat the same execution

After confirming the first attempt, click **Run approved comment** a second time in the same panel. Do not prepare another draft or obtain another approval.

**Expected:** “Comment published. Repeating returns the same execution record.” Run history still shows the same single **Success** row, and Jira's comment count remains unchanged. This behavior was recorded on development versions 3.8.0 and 3.9.0.

**If it differs:** stop and retain both responses, history observations and comment counts. Do not create a new approval to bypass the existing execution record.

### 7. Reload the page and repeat

Reload the Jira issue page and reopen **Evidence Review approval** if needed. Check that the panel recovers the same approval with the same expiry and displays **Run approved comment**, without asking for a new approval. Click that button a third time.

**Expected:** the recovered approval has the same expiry; the button is available without another approval. After the click: “Comment published. Repeating returns the same execution record.” Run history still shows the same single **Success** row. Inspect Jira again: exactly one comment has been added across all three clicks. Approval recovery and this third-click behavior were recorded on development versions 3.8.0 and 3.9.0.

**If it differs:** stop and record the actual panel response, expiry, history and comment count. Do not approve again or prepare another draft to force recovery.

### 8. Inspect Run history

Inspect **Run history** on the same issue. No agent prompt is needed.

**Expected:** one **Success** row corresponding to the successful execution, still unchanged after the second click, page reload and third click. Correlate it using the displayed UTC timestamp, “Post Jira comment” and approver account ID. Record the visible rows and the final comment count.

**If it differs:** record the panel text and installed version. “Run history could not be loaded. Refresh history to try again.” is an error, not an empty successful history. A successful publication and a working history panel are separate checks. Do not execute another comment to make a row appear.

## Optional: start from a Teamwork Graph suggestion

If you do not know which page to cite, the agent can suggest one. This needs a Confluence page that links the Jira issue (for example with a Jira issue link in its body). In Rovo, with Evidence Review Assistant selected, paste:

```text
Which Confluence pages are related to Jira issue <ISSUE_KEY>? Use find_related_pages only. Show each page title and page ID. Do not collect, prepare, approve or publish anything.
```

**Expected:** the title and page ID of each page that the Teamwork Graph relates to the issue. A suggestion is not evidence: continue with step 1 using that page ID, so the excerpt and version are retrieved before anything is prepared.

**If it differs:** an empty answer means no related page was found for that issue; use a page ID you know and start at step 1. The page in the recorded run had existed for days, and how long a new link takes to appear was not measured. The lookup uses a persisted Teamwork Graph query registered for this app; it was run on the development installation only.

## What was and was not checked

Checked by the author on a development installation, 18 November 2026, with synthetic records only:

- Evidence collection, preparation with one confirmation card, and the stored draft seen through **Load proposal** on new issues (two runs, development version 3.9.0).
- The whole route starting from a Teamwork Graph suggestion (19 November 2026, development version 3.9.0, an existing synthetic issue and a synthetic page that links it): `find_related_pages` returned that page, `collect_evidence` returned its version 1 and excerpt, one sentence of the excerpt was prepared with one confirmation card, approved in the panel and published with **Run approved comment**: one new Success row and exactly one new Jira comment citing that page and version.
- The apps-button entry path to the panel on new issues.
- Approval without publication, one publication through **Run approved comment**, a second click, approval recovery after a page reload and a third click: one Success row and exactly one Jira comment throughout (three separate issues, development versions 3.8.0 and 3.9.0).
- Revocation on a fourth issue (development version 3.9.0): after approving, **Revoke approval** showed "Approval revoked." and removed **Run approved comment** from the panel. After a page reload the panel did not recover the revoked approval and did not show the button. Run history stayed empty and the issue had no comment. **Load proposal** then showed the same stored draft, which would need a new approval.
- The production build (version 2.1.0) installed on the author's test site, one run on 19 November 2026 on a new synthetic issue: `collect_evidence` returned the page, version 1 and the excerpt; `prepare_comment` showed the confirmation card, it was confirmed once and Rovo then showed the card a second time, which was left unconfirmed; **Load proposal** in the production panel showed the stored draft; approval showed an expiry and "No executions recorded."; **Run approved comment** showed "Comment published. Repeating returns the same execution record." and one Success row; a second click kept one Success row; after a page reload the issue had exactly one comment with its source page and version. With both installations on one site the agent selector lists several agents with the same name and the apps button lists two panels with the same title; the production panel was identified by the environment in its frame address.

Not checked:

- The production build on a site other than the author's test site: a fresh installation and its permission prompts in both products.
- Expired, changed-draft and uncertain outcomes through the button, and a second user identity. Because the panel removes the button after revocation, an execution attempt against a revoked approval was not made on a site either. These are covered by automated tests of the composed application only.
- Creating the synthetic Confluence page from scratch in the same run (an existing synthetic page with the text above was used).

An enabled MCP client can still call the app's tools directly; that route is described in skills/evidence-review/SKILL.md and is not needed for this walkthrough.

Keep credentials, tokens, full contexts and personal data out of any record of your run.
