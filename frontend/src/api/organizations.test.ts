import { describe, expect, it } from 'vitest'
import { organizationSchema } from './organizations'

// Shape captured from a live `POST /api/v1/organizations` response.
const WIRE_ORGANIZATION = {
  id: '3f0c2a9e-6d4b-4c1a-9b7e-1a2b3c4d5e6f',
  name: 'Acme Studio',
  account_type: 'business',
  role: 'owner',
}

describe('organizationSchema', () => {
  it('accepts the lowercase enum values the backend actually sends', () => {
    expect(organizationSchema.parse(WIRE_ORGANIZATION).role).toBe('owner')
  })

  it.each(['owner', 'admin', 'manager', 'staff'])('accepts role %s', (role) => {
    expect(organizationSchema.safeParse({ ...WIRE_ORGANIZATION, role }).success).toBe(true)
  })

  it('rejects uppercase roles, which the backend never sends', () => {
    expect(organizationSchema.safeParse({ ...WIRE_ORGANIZATION, role: 'OWNER' }).success).toBe(
      false,
    )
  })
})
