import { z } from 'zod'

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url('must be an absolute URL'),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1, 'is required'),
  VITE_LEGAL_ENTITY_NAME: z.string().trim().min(1, 'is required'),
  VITE_LEGAL_CONTACT_EMAIL: z.string().trim().email('must be an email address'),
})

/** Who operates the service; named in the public legal pages that Meta's app review requires. */
export type LegalIdentity = {
  entityName: string
  contactEmail: string
}

export type Env = {
  apiBaseUrl: string
  clerkPublishableKey: string
  legal: LegalIdentity
}

export class EnvError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid frontend environment: ${issues.join('; ')}`)
    this.name = 'EnvError'
  }
}

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    throw new EnvError(result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`))
  }
  return {
    apiBaseUrl: result.data.VITE_API_BASE_URL.replace(/\/+$/, ''),
    clerkPublishableKey: result.data.VITE_CLERK_PUBLISHABLE_KEY,
    legal: {
      entityName: result.data.VITE_LEGAL_ENTITY_NAME,
      contactEmail: result.data.VITE_LEGAL_CONTACT_EMAIL,
    },
  }
}
