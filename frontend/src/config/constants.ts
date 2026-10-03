export const STORAGE_KEYS = {
  selectedOrganization: 'instomation.selectedOrganization',
  onboardingReturn: 'instomation.onboardingReturn',
  onboardingDraftPrefix: 'instomation.onboardingDraft.',
} as const

export const API_PREFIX = '/api/v1'

export const QUERY_STALE_MS = 30_000
export const QUERY_MAX_RETRIES = 2
export const PAGE_SIZE = 50

export const ROUTES = {
  home: '/',
  signIn: '/sign-in',
  signUp: '/sign-up',
  onboarding: '/onboarding',
  instagramSettings: '/settings/instagram',
} as const
