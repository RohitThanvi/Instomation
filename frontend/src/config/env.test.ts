import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from './env'

describe('parseEnv', () => {
  it('returns typed config and trims trailing slashes from the API URL', () => {
    const env = parseEnv({
      VITE_API_BASE_URL: 'https://api.example.com//',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
    })
    expect(env).toEqual({ apiBaseUrl: 'https://api.example.com', clerkPublishableKey: 'pk_test_x' })
  })

  it('reports every missing or invalid variable', () => {
    try {
      parseEnv({ VITE_API_BASE_URL: 'not-a-url' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError)
      const { issues } = error as EnvError
      expect(issues).toHaveLength(2)
      expect(issues.join(' ')).toContain('VITE_API_BASE_URL')
      expect(issues.join(' ')).toContain('VITE_CLERK_PUBLISHABLE_KEY')
    }
  })
})
