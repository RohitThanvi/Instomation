import { ROUTES } from '@/config/constants'

export const ONBOARDING_STEPS = [
  { slug: 'welcome', title: 'Welcome' },
  { slug: 'account-type', title: 'Account type' },
  { slug: 'instagram', title: 'Connect Instagram' },
  { slug: 'profile', title: 'Profile' },
  { slug: 'offerings', title: 'Products and services' },
  { slug: 'voice', title: 'Communication style' },
  { slug: 'automation', title: 'Automation' },
  { slug: 'review', title: 'Review' },
  { slug: 'activate', title: 'Activate' },
] as const

export type StepSlug = (typeof ONBOARDING_STEPS)[number]['slug']

/** Steps after this one need a workspace, which is created here. */
export const ACCOUNT_TYPE_INDEX = 1

export function stepIndex(slug: string | undefined): number {
  return ONBOARDING_STEPS.findIndex((step) => step.slug === slug)
}

export function stepPath(slug: StepSlug): string {
  return `${ROUTES.onboarding}/${slug}`
}

export function stepAt(index: number): StepSlug | null {
  return ONBOARDING_STEPS[index]?.slug ?? null
}
