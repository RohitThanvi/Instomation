import { useCallback, useState } from 'react'
import { z } from 'zod'
import {
  automationPreferencesSchema,
  productsSchema,
  profileSchema,
  styleSchema,
} from '@/api/business'
import { STORAGE_KEYS } from '@/config/constants'
import { readStorage, writeStorage } from '@/lib/storage'

export const onboardingDraftSchema = z
  .object({
    profile: profileSchema,
    products: productsSchema,
    style: styleSchema,
    automation: automationPreferencesSchema,
  })
  .partial()
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>

function storageKey(organizationId: string): string {
  return `${STORAGE_KEYS.onboardingDraftPrefix}${organizationId}`
}

/** Anything unreadable or off-schema is discarded rather than trusted. */
export function loadDraft(organizationId: string): OnboardingDraft {
  const raw = readStorage(storageKey(organizationId))
  if (raw === null) return {}
  try {
    const parsed = onboardingDraftSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/**
 * Onboarding answers cannot be saved server-side yet, so they are kept in this browser
 * (per workspace) until the backend endpoints exist.
 */
export function useOnboardingDraft(organizationId: string | null) {
  const [draft, setDraft] = useState<OnboardingDraft>(() =>
    organizationId === null ? {} : loadDraft(organizationId),
  )

  const saveSection = useCallback(
    <K extends keyof OnboardingDraft>(section: K, value: OnboardingDraft[K]) => {
      const next: OnboardingDraft = { ...draft, [section]: value }
      setDraft(next)
      if (organizationId !== null) writeStorage(storageKey(organizationId), JSON.stringify(next))
    },
    [draft, organizationId],
  )

  return { draft, saveSection }
}
