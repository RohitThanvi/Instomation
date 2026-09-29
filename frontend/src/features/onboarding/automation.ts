import type { AutomationPreferences } from '@/api/business'
import { FEATURES } from '@/api/instagram'

export const DEFAULT_AUTOMATION: AutomationPreferences = {
  reply_to_comments: true,
  reply_to_dms: true,
  private_reply_from_comments: false,
  handoff_on_request: true,
  handoff_on_complaint: true,
  handoff_on_low_confidence: true,
}

type IsEnabled = (feature: string) => boolean

/** A reply action the server has not enabled is always stored as off, whatever the form held. */
export function normalizeAutomation(
  values: AutomationPreferences,
  isEnabled: IsEnabled,
): AutomationPreferences {
  return {
    ...values,
    reply_to_comments: values.reply_to_comments && isEnabled(FEATURES.commentReply),
    reply_to_dms: values.reply_to_dms && isEnabled(FEATURES.dmReply),
    private_reply_from_comments:
      values.private_reply_from_comments && isEnabled(FEATURES.privateReply),
  }
}

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
    will.push('Send one private message to a commenter, within Instagram’s time limit.')
  if (settings?.handoff_on_request)
    will.push('Hand the conversation to a person when someone asks for one.')
  if (settings?.handoff_on_complaint)
    will.push('Hand over when someone sounds upset or raises a complaint.')
  if (settings?.handoff_on_low_confidence)
    will.push('Hand over when it is not confident in its answer.')

  const willNot = [
    'Reply in a conversation once it has been handed to a person.',
    'Message people who have not commented on or messaged your account first.',
    'Ask for, see or store your Instagram password.',
    'Use anything other than Instagram’s official tools.',
  ]
  return { will, willNot }
}
