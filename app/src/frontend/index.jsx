// DRAFT UI KIT — NOT BUILT OR TESTED WITH THE OFFICIAL SDK.
// Resolver registration, canonical drafts and deployment were verified on the development site.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Lozenge, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { loadProposalView } from './proposal-view.js';
import { buildRunHistoryView } from './history-view.js';

function App() {
  const [review, setReview] = useState(null);
  const [approval, setApproval] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Load the current proposal to review it.');
  const [history, setHistory] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  async function loadHistory() {
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const records = await invoke('getActionHistory');
      setHistory(buildRunHistoryView(records));
      // Recover an existing approval after reopening; never create a new one.
      const recoverable = records.approvals.filter(candidate =>
        candidate.effectiveStatus === 'pending' ||
        records.comments.some(record =>
          record.approvalId === candidate.id &&
          record.key === `panel-approved:${candidate.id}`));
      recoverable.sort((a, b) => b.createdAt - a.createdAt);
      setApproval(current => current ?? (recoverable[0]
        ? { approvalId: recoverable[0].id, expiresAt: recoverable[0].expiresAt }
        : null));
    } catch {
      setHistory(null);
      setHistoryError('Run history could not be loaded. Refresh history to try again.');
    } finally {
      setHistoryBusy(false);
    }
  }
  useEffect(() => { void loadHistory(); }, []);
  async function run(operation) {
    setBusy(true);
    try { await operation(); }
    catch {
      setReview(null);
      setApproval(null);
      setMessage('The operation could not be confirmed. Reload before approving.');
    } finally { setBusy(false); }
  }
  async function load() {
    setReview(null);
    setApproval(null);
    const result = await loadProposalView(invoke);
    setReview(result.review);
    setMessage(result.message);
  }
  async function approve() {
    const result = await invoke('approve', { reviewId: review.reviewId });
    setApproval(result);
    setReview(null);
    setMessage('Approval recorded. Approval does not publish; use Run approved comment to publish.');
  }
  async function executeApproved() {
    try {
      const result = await invoke('executeApproved', {
        approvalId: approval.approvalId
      });
      const messages = {
        succeeded: 'Comment published. Repeating returns the same execution record.',
        pending: 'Execution pending. Repeating checks the same attempt.',
        uncertain: 'Outcome uncertain. Check Jira; repeating will not send again.',
        failed: 'Execution recorded as failed. Repeating returns the same record.'
      };
      setMessage(result.status === 'rejected'
        ? `Comment not published: ${result.reason}`
        : messages[result.status] ?? 'Outcome unconfirmed. Check Jira and run history.');
    } catch {
      setMessage('Execution could not be confirmed. Check Jira and run history. Repeating uses the same attempt.');
    } finally {
      await loadHistory();
    }
  }
  async function revoke() {
    await invoke('revoke', { approvalId: approval.approvalId });
    setApproval(null);
    setMessage('Approval revoked.');
  }
  return (
    <Stack space="space.200">
      <Heading as="h2">Evidence Review</Heading>
      <Text>Review the destination, comment and citation before approving.</Text>
      <Text>{message}</Text>
      <Button isDisabled={busy} onClick={() => run(load)}>Load proposal</Button>
      {review && <>
        <Text>Destination: {review.binding.destination}</Text>
        <Text>Installation: {review.binding.site}</Text>
        <Text>Comment: {review.draft.text}</Text>
        {review.draft.citations.map((citation, index) => (
          <Text key={index}>
            {citation.documentId} — version {citation.version}: {citation.quote}
          </Text>
        ))}
        <Text>Citations match retrieved excerpts; correctness still needs human review.</Text>
        <Button isDisabled={busy} onClick={() => run(approve)}>
          Approve this comment for one attempt, valid for 15 minutes
        </Button>
      </>}
      {approval && <>
        <Text>Approval expires: {new Date(approval.expiresAt).toISOString()}</Text>
        <Button isDisabled={busy} onClick={() => run(executeApproved)}>
          Run approved comment
        </Button>
        <Text>Repeating checks the same attempt and does not post another comment.</Text>
        <Button isDisabled={busy} onClick={() => run(revoke)}>Revoke approval</Button>
      </>}
      <Heading as="h2">Run history</Heading>
      <Text>Your latest 10 executions for this issue. Times are in UTC.</Text>
      <Button isDisabled={historyBusy} onClick={loadHistory}>Refresh history</Button>
      {historyBusy && <Text>Loading run history…</Text>}
      {historyError && <Text>{historyError}</Text>}
      {history !== null && history.length === 0 && <Text>No executions recorded.</Text>}
      {history?.map(row => (
        <Stack key={row.key} space="space.050" alignInline="start">
          <Lozenge appearance={row.appearance}>{row.label}</Lozenge>
          <Text>Date and time: {row.dateTime}</Text>
          <Text>Action: {row.action}</Text>
          <Text>Approved by (account ID): {row.approvedBy}</Text>
          {row.status === 'uncertain' && (
            <Text>The outcome is unconfirmed. Check Jira before taking further action.</Text>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

ForgeReconciler.render(<App />);
