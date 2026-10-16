import type { AutomationPreferences } from '@/api/business'
import { FEATURES } from '@/api/instagram'

/** Private replies start off, like on the server: the owner opts in. */
export const DEFAULT_AUTOMATION: AutomationPreferences = {
  reply_to_comments: true,
  reply_to_dms: true,
  private_reply_from_comments: false,
}

type IsEnabled = (feature: string) => boolean

/**
 * A reply action the server has not enabled is always stored as off, whatever the form held. A
 * private reply answers a comment, so it is also off whenever comment replies are.
 */
export function normalizeAutomation(
  values: AutomationPreferences,
  isEnabled: IsEnabled,
): AutomationPreferences {
  const comments = values.reply_to_comments && isEnabled(FEATURES.commentReply)
  return {
    reply_to_comments: comments,
    reply_to_dms: values.reply_to_dms && isEnabled(FEATURES.dmReply),
    private_reply_from_comments:
      comments && values.private_reply_from_comments && isEnabled(FEATURES.privateReply),
  }
}

/**
 * When the assistant steps aside. Not settings: the pipeline decides this for every reply, and
 * the model, not a rule, recognises the kinds of message that need a person.
 */
export const HANDOFF_RULES: readonly string[] = [
  'It cannot answer from your business information.',
  'Its confidence in the reply is below the threshold.',
  'The message reads as a threat.',
  'The model recognises a refund, complaint, legal matter, custom quote, or a change to an order or booking.',
]

/** What the assistant will and will not do, derived from the chosen settings and server capabilities. */
export function buildCommitments(
  automation: AutomationPreferences | undefined,
  isEnabled: IsEnabled,
): { will: string[]; willNot: string[] } {
  const settings = automation === undefined ? undefined : normalizeAutomation(automation, isEnabled)
  const will: string[] = []
  if (settings?.reply_to_comments)
    will.push('Reply to comments on your posts in your chosen voice.')
  if (settings?.reply_to_dms) will.push('Reply to people who message you first.')
  if (settings?.private_reply_from_comments)
    will.push('Send a commenter one private message when the answer needs more detail.')
  if (will.length > 0) {
    will.push('Hand a conversation to a person when it cannot answer or is not confident.')
    will.push('Hand over messages that read as threats, and aim to pass refunds and complaints on.')
  }

  const willNot = [
    'Reply in a conversation once it has been handed to a person.',
    'Message people who have not commented on or messaged your account first.',
    'Ask for, see or store your Instagram password.',
    'Use anything other than Instagram’s official tools.',
  ]
  return { will, willNot }
}
