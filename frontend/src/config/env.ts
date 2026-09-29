import { z } from 'zod'

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url('must be an absolute URL'),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1, 'is required'),
})

export type Env = {
  apiBaseUrl: string
  clerkPublishableKey: string
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
  }
}
