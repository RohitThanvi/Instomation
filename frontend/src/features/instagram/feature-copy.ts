import { FEATURES, type SupportedFeature } from '@/api/instagram'

export const FEATURE_COPY: Record<SupportedFeature, { label: string; description: string }> = {
  [FEATURES.commentReply]: {
    label: 'Reply to comments',
    description: 'Answer questions and comments on your posts in your chosen voice.',
  },
  [FEATURES.dmReply]: {
    label: 'Reply to direct messages',
    description: 'Answer people who message you first, within Instagram’s messaging window.',
  },
  [FEATURES.privateReply]: {
    label: 'Continue a comment in private',
    description: 'Send one private message to a commenter, within the time Instagram allows.',
  },
}

export const SUPPORTED_FEATURES: readonly SupportedFeature[] = Object.values(FEATURES)
