/** What each recorded kind of AI request is for, in the words a business owner would use. */
const PURPOSE_LABELS: Record<string, string> = {
  dm_reply: 'Direct message replies',
  comment_reply: 'Comment replies',
  moderation: 'Safety checks',
}

/** An unfamiliar purpose is shown as it is (readably), never hidden or rejected. */
export function purposeLabel(purpose: string): string {
  const known = PURPOSE_LABELS[purpose]
  if (known !== undefined) return known
  const words = purpose.replaceAll('_', ' ').trim()
  return words === '' ? 'Other' : words.charAt(0).toUpperCase() + words.slice(1)
}
