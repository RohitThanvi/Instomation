import { describe, expect, it } from 'vitest'
import { changedFields, validateEntry, type EntryFormValues } from './entry-schema'

const VALID: EntryFormValues = { kind: 'faq', title: 'Opening hours', content: 'We open at 9.' }

describe('validateEntry', () => {
  it('accepts a complete entry and trims it', () => {
    expect(validateEntry({ ...VALID, title: '  Hours  ', content: '\n9 to 5\n' })).toEqual({
      ok: true,
      values: { kind: 'faq', title: 'Hours', content: '9 to 5' },
    })
  })

  it('rejects blank text, including whitespace only, naming each field', () => {
    const result = validateEntry({ ...VALID, title: '   ', content: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.title).toMatch(/title/i)
      expect(result.errors.content).toMatch(/information/i)
    }
  })

  it.each([
    ['title', { title: 'x'.repeat(301) }, 'title'],
    ['content', { content: 'x'.repeat(4001) }, 'content'],
  ] as const)('rejects a %s over the server limit', (_name, patch, field) => {
    const result = validateEntry({ ...VALID, ...patch })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[field]).toBeDefined()
  })

  it('accepts text exactly at the server limit', () => {
    expect(validateEntry({ ...VALID, title: 'x'.repeat(300), content: 'x'.repeat(4000) }).ok).toBe(
      true,
    )
  })
})

describe('changedFields', () => {
  it('sends only what changed', () => {
    expect(changedFields(VALID, { ...VALID, title: 'New title' })).toEqual({ title: 'New title' })
    expect(changedFields(VALID, { ...VALID, kind: 'policy', content: 'Closed Sundays.' })).toEqual({
      kind: 'policy',
      content: 'Closed Sundays.',
    })
  })

  it('sends nothing when nothing changed', () => {
    expect(changedFields(VALID, { ...VALID })).toEqual({})
  })
})
