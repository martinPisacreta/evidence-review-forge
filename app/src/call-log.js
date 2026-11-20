import { createHash } from 'node:crypto';

export function logCall({ event, issueKey, draftId, via }) {
  console.log(JSON.stringify({
    event,
    at: new Date().toISOString(),
    issueKey: typeof issueKey === 'string' ? issueKey : null,
    draftRef: typeof draftId === 'string' && draftId.length
      ? createHash('sha256').update(draftId).digest('hex').slice(0, 8)
      : null,
    via
  }));
}
