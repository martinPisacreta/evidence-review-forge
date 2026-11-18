// SDK-free presentation mapping. Reading history never executes an action.
const statuses = {
  succeeded: { label: 'Success', appearance: 'success' },
  failed: { label: 'Failed', appearance: 'removed' },
  pending: { label: 'Pending', appearance: 'inprogress' },
  uncertain: { label: 'Uncertain', appearance: 'moved' }
};
const sameBinding = (a, b) => Boolean(a && b) &&
  ['user', 'site', 'destination'].every(field => a[field] === b[field]);

export function buildRunHistoryView(history) {
  if (!Array.isArray(history?.comments) || !Array.isArray(history?.approvals))
    throw new Error('INVALID_HISTORY');
  return [...history.comments]
    .sort((a, b) => b.reservedAt - a.reservedAt)
    .slice(0, 10)
    .map(record => {
      const approval = history.approvals.find(candidate =>
        candidate.id === record.approvalId &&
        sameBinding(candidate.binding, record.binding));
      const timestamp = record.reservedAt;
      const dateTime = Number.isSafeInteger(timestamp) && timestamp >= 0 &&
        !Number.isNaN(new Date(timestamp).getTime())
        ? new Date(timestamp).toISOString() : 'Time unavailable';
      const status = Object.hasOwn(statuses, record.status)
        ? record.status : 'uncertain';
      return {
        key: record.key,
        dateTime,
        action: 'Post Jira comment',
        approvedBy: approval?.binding?.user || 'Approval unavailable',
        status,
        ...statuses[status]
      };
    });
}

export async function loadRunHistoryView(invoke) {
  return buildRunHistoryView(await invoke('getActionHistory'));
}
