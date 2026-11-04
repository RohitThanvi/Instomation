import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from './env'

describe('parseEnv', () => {
  it('returns typed config and trims trailing slashes from the API URL', () => {
    const env = parseEnv({
      VITE_API_BASE_URL: 'https://api.example.com//',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
      VITE_LEGAL_ENTITY_NAME: '  Acme Labs  ',
      VITE_LEGAL_CONTACT_EMAIL: 'privacy@acme.test',
    })
    expect(env).toEqual({
      apiBaseUrl: 'https://api.example.com',
      clerkPublishableKey: 'pk_test_x',
      legal: { entityName: 'Acme Labs', contactEmail: 'privacy@acme.test' },
    })
  })

  it('reports every missing or invalid variable', () => {
    try {
      parseEnv({ VITE_API_BASE_URL: 'not-a-url' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError)
      const { issues } = error as EnvError
      expect(issues).toHaveLength(4)
      for (const name of [
        'VITE_API_BASE_URL',
        'VITE_CLERK_PUBLISHABLE_KEY',
        'VITE_LEGAL_ENTITY_NAME',
        'VITE_LEGAL_CONTACT_EMAIL',
      ]) {
        expect(issues.join(' ')).toContain(name)
      }
    }
  })

  it('rejects a contact address that is not an email', () => {
    expect(() =>
      parseEnv({
        VITE_API_BASE_URL: 'https://api.example.com',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x',
        VITE_LEGAL_ENTITY_NAME: 'Acme Labs',
        VITE_LEGAL_CONTACT_EMAIL: 'not-an-email',
      }),
    ).toThrow(/VITE_LEGAL_CONTACT_EMAIL/)
  })
})
