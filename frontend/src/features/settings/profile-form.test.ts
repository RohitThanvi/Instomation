import { describe, expect, it } from 'vitest'
import { COMMUNICATION_TONES, PROFILE_LIMITS, type BusinessProfile } from '@/api/business'
import {
  profileToForm,
  sameProfile,
  validateProfile,
  type ProfileErrors,
  type ProfileForm,
} from './profile-form'

function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    brand_name: 'Glow Studio',
    description: 'Handmade skincare.',
    industry: 'Skincare',
    location: 'Jaipur',
    website: 'https://glow.example',
    contact_info: { Email: 'hi@glow.example' },
    policies: { Returns: '30 days' },
    communication_style: 'friendly',
    custom_instructions: 'Sign off with a flower.',
    ...overrides,
  }
}

function form(overrides: Partial<ProfileForm> = {}): ProfileForm {
  return { ...profileToForm(profile()), ...overrides }
}

function failure(values: ProfileForm): ProfileErrors {
  const result = validateProfile(values)
  if (result.ok) throw new Error('expected validation to fail')
  return result.errors
}

describe('profileToForm', () => {
  it('shows an unset field as empty text and the maps as rows', () => {
    const values = profileToForm(
      profile({ brand_name: null, location: null, website: null, custom_instructions: null }),
    )
    expect(values).toMatchObject({
      brand_name: '',
      location: '',
      website: '',
      custom_instructions: '',
    })
    expect(values.contact).toEqual([{ key: 'Email', value: 'hi@glow.example' }])
    expect(values.policies).toEqual([{ key: 'Returns', value: '30 days' }])
  })
})

describe('validateProfile', () => {
  it('turns a form back into exactly the profile it came from', () => {
    const result = validateProfile(profileToForm(profile()))
    expect(result).toEqual({ ok: true, profile: profile() })
  })

  it.each(COMMUNICATION_TONES)('keeps the %s tone through a round trip', (tone) => {
    const stored = profile({ communication_style: tone })
    expect(validateProfile(profileToForm(stored))).toEqual({ ok: true, profile: stored })
  })

  it('trims text and stores a blank field as null, like the server', () => {
    const result = validateProfile(
      form({ brand_name: '  Glow  ', industry: '   ', website: '', custom_instructions: '' }),
    )
    expect(result).toMatchObject({
      ok: true,
      profile: { brand_name: 'Glow', industry: null, website: null, custom_instructions: null },
    })
  })

  it('rejects text over each field limit and names the field', () => {
    const errors = failure(
      form({
        brand_name: 'x'.repeat(PROFILE_LIMITS.brandName + 1),
        industry: 'x'.repeat(PROFILE_LIMITS.industry + 1),
        location: 'x'.repeat(PROFILE_LIMITS.location + 1),
        description: 'x'.repeat(PROFILE_LIMITS.description + 1),
        custom_instructions: 'x'.repeat(PROFILE_LIMITS.instructions + 1),
      }),
    )
    expect(Object.keys(errors.fields).sort()).toEqual([
      'brand_name',
      'custom_instructions',
      'description',
      'industry',
      'location',
    ])
  })

  it('accepts text exactly at the limit', () => {
    expect(validateProfile(form({ brand_name: 'x'.repeat(PROFILE_LIMITS.brandName) })).ok).toBe(
      true,
    )
  })

  it('accepts only an http(s) website, within its length', () => {
    expect(validateProfile(form({ website: 'glow.example' })).ok).toBe(false)
    expect(validateProfile(form({ website: 'ftp://glow.example' })).ok).toBe(false)
    expect(failure(form({ website: 'glow.example' })).fields.website).toMatch(/https/)
    const long = `https://${'a'.repeat(PROFILE_LIMITS.website)}.example`
    expect(failure(form({ website: long })).fields.website).toBeDefined()
    expect(validateProfile(form({ website: 'http://glow.example' })).ok).toBe(true)
  })

  it('ignores a row left completely blank', () => {
    const result = validateProfile(
      form({
        contact: [
          { key: '', value: '' },
          { key: ' ', value: '  ' },
        ],
        policies: [],
      }),
    )
    expect(result).toMatchObject({ ok: true, profile: { contact_info: {}, policies: {} } })
  })

  it('needs both a name and a value on a started row', () => {
    const errors = failure(
      form({
        contact: [
          { key: 'Phone', value: '' },
          { key: '', value: '555' },
        ],
      }),
    )
    expect(errors.contact).toEqual({ 0: 'Add a value', 1: 'Add a name for this' })
  })

  it('limits the length of a name and of a value, per list', () => {
    const errors = failure(
      form({
        contact: [
          { key: 'k'.repeat(PROFILE_LIMITS.mapKey + 1), value: 'v' },
          { key: 'ok', value: 'v'.repeat(PROFILE_LIMITS.contactValue + 1) },
        ],
        policies: [{ key: 'ok', value: 'v'.repeat(PROFILE_LIMITS.contactValue + 1) }],
      }),
    )
    expect(errors.contact[0]).toMatch(/50 characters/)
    expect(errors.contact[1]).toMatch(/200 characters/)
    // A policy may be longer than a contact detail.
    expect(errors.policies).toEqual({})
  })

  it('accepts a name and a value exactly at their limits', () => {
    const result = validateProfile(
      form({
        contact: [
          {
            key: 'k'.repeat(PROFILE_LIMITS.mapKey),
            value: 'v'.repeat(PROFILE_LIMITS.contactValue),
          },
        ],
        policies: [{ key: 'p', value: 'v'.repeat(PROFILE_LIMITS.policyValue) }],
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a policy value one over its own, longer limit', () => {
    const errors = failure(
      form({ policies: [{ key: 'p', value: 'v'.repeat(PROFILE_LIMITS.policyValue + 1) }] }),
    )
    expect(errors.policies[0]).toMatch(/500 characters/)
  })

  it('rejects a name used twice, because the second would silently replace the first', () => {
    const errors = failure(
      form({
        policies: [
          { key: 'Returns', value: '30 days' },
          { key: ' Returns ', value: '60 days' },
        ],
      }),
    )
    expect(errors.policies).toEqual({ 1: 'This name is already used above' })
  })

  it('stops at the maximum number of items for each list', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ key: `k${String(index)}`, value: 'v' }))
    expect(validateProfile(form({ contact: rows(PROFILE_LIMITS.contactItems) })).ok).toBe(true)
    expect(failure(form({ contact: rows(PROFILE_LIMITS.contactItems + 1) })).contactList).toBe(
      'You can add up to 10 contact details',
    )
    expect(failure(form({ policies: rows(PROFILE_LIMITS.policyItems + 1) })).policiesList).toBe(
      'You can add up to 10 policies',
    )
  })

  it('reports problems in several places at once', () => {
    const errors = failure(
      form({ brand_name: 'x'.repeat(201), contact: [{ key: 'a', value: '' }] }),
    )
    expect(errors.fields.brand_name).toBeDefined()
    expect(errors.contact[0]).toBe('Add a value')
  })
})

describe('sameProfile', () => {
  it('is true for equal profiles whatever the order of the maps', () => {
    const a = profile({ policies: { A: '1', B: '2' } })
    const b = profile({ policies: { B: '2', A: '1' } })
    expect(sameProfile(a, b)).toBe(true)
  })

  it.each<[string, Partial<BusinessProfile>]>([
    ['brand name', { brand_name: 'Other' }],
    ['industry', { industry: null }],
    ['location', { location: 'Delhi' }],
    ['website', { website: null }],
    ['description', { description: 'New' }],
    ['instructions', { custom_instructions: null }],
    ['tone', { communication_style: 'strict_business' }],
    ['a contact detail', { contact_info: { Email: 'other@glow.example' } }],
    ['a policy', { policies: { Returns: '14 days' } }],
    ['an added policy', { policies: { Returns: '30 days', Shipping: 'Free' } }],
  ])('notices a change to %s', (_name, change) => {
    expect(sameProfile(profile(), profile(change))).toBe(false)
  })
})
