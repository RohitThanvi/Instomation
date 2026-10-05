export const STORAGE_KEYS = {
  selectedOrganization: 'instomation.selectedOrganization',
  onboardingReturn: 'instomation.onboardingReturn',
  onboardingDraftPrefix: 'instomation.onboardingDraft.',
} as const

export const API_PREFIX = '/api/v1'

export const QUERY_STALE_MS = 30_000
export const QUERY_MAX_RETRIES = 2
export const PAGE_SIZE = 50

/** Inbox. The server caps `limit` at 100. */
export const MESSAGE_PAGE_SIZE = 100
/** A thread is loaded page by page up to this many pages (1,000 messages) before it is cut off. */
export const MAX_THREAD_PAGES = 10
export const INBOX_LIST_REFETCH_MS = 20_000
export const THREAD_REFETCH_MS = 10_000
/** Faster polling while an outbound message is still waiting to be delivered. */
export const PENDING_MESSAGE_REFETCH_MS = 3_000
/** Mirrors the backend: `String(50)` per tag, at most 50 tags, 4,000 characters per message. */
export const MAX_TAG_LENGTH = 50
export const MAX_TAGS = 50
export const MAX_MESSAGE_LENGTH = 4000

export const ROUTES = {
  home: '/',
  signIn: '/sign-in',
  signUp: '/sign-up',
  onboarding: '/onboarding',
  inbox: '/inbox',
  instagramSettings: '/settings/instagram',
} as const
