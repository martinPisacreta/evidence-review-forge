// DRAFT UI KIT — NOT BUILT OR TESTED WITH THE OFFICIAL SDK.
// Resolver registration, canonical drafts and deployment were verified on the development site.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Lozenge, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { loadProposalView } from './proposal-view.js';
import { buildRunHistoryView } from './history-view.js';
import { selectCurrentApproval, executionMessage, initialApprovalMessage } from './approval-view.js';

function App() {
  const [review, setReview] = useState(null);
  const [approval, setApproval] = useState(null);
  const [currentProposal, setCurrentProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialApprovalMessage);
  const [history, setHistory] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  async function loadHistory(proposal = currentProposal) {
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const records = await invoke('getActionHistory');
      setHistory(buildRunHistoryView(records));
      // History alone cannot establish which draft is current.
      setApproval(selectCurrentApproval(records, proposal));
    } catch {
      setHistory(null);
      setApproval(null);
      setHistoryError('Run history could not be loaded. Refresh history to try again.');
    } finally {
      setHistoryBusy(false);
    }
  }
  useEffect(() => { void loadHistory(null); }, []);
  useEffect(() => {
    if (!approval) return;
    const timer = setTimeout(() => {
      setApproval(null);
      setReview(null);
      setCurrentProposal(null);
      setMessage(initialApprovalMessage);
    }, Math.max(0, approval.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [approval]);
  async function run(operation) {
    setBusy(true);
    try { await operation(); }
    catch {
      setReview(null);
      setApproval(null);
      setCurrentProposal(null);
      setMessage('The operation could not be confirmed. Reload before approving.');
    } finally { setBusy(false); }
  }
  async function load() {
    setReview(null);
    setApproval(null);
    setCurrentProposal(null);
    const result = await loadProposalView(invoke);
    setReview(result.review);
    setCurrentProposal(result.review);
    setMessage(result.message);
    await loadHistory(result.review);
  }
  async function approve() {
    const result = await invoke('approve', { reviewId: review.reviewId });
    setApproval(result);
    setReview(null);
    setMessage('Approval recorded. Approval does not publish; use Run approved comment to publish.');
  }
  async function executeApproved() {
    let rejected = false;
    try {
      const result = await invoke('executeApproved', {
        approvalId: approval.approvalId
      });
      rejected = result?.status === 'rejected';
      if (rejected) {
        setApproval(null);
        setReview(null);
        setCurrentProposal(null);
      }
      setMessage(executionMessage(result));
    } catch {
      setMessage('Execution could not be confirmed. Check Jira and run history. Repeating uses the same attempt.');
    } finally {
      await loadHistory(rejected ? null : currentProposal);
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
      <Button isDisabled={historyBusy} onClick={() => loadHistory()}>Refresh history</Button>
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
