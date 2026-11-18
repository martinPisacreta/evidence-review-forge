// SDK-free presentation mapping; unexpected bridge failures propagate.
export async function loadProposalView(invoke) {
  const result = await invoke('showDraft');
  if (result?.status === 'no_proposal') {
    return { review: null,
      message: 'No proposal has been prepared for this issue yet.' };
  }
  return { review: result,
    message: 'Review the complete comment, destination and quoted evidence.' };
}
