// Render only the canonical draft whose text and citations were hashed.
export function commentText(draft) {
  return draft.text + draft.citations.map(citation =>
    `\n\nSource: Confluence page ${citation.documentId}, version ${citation.version}\n${citation.quote}`
  ).join('');
}
