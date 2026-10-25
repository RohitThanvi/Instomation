import { describe, expect, it } from 'vitest'
import { purposeLabel } from './labels'

describe('purposeLabel', () => {
  it.each([
    ['dm_reply', 'Direct message replies'],
    ['comment_reply', 'Comment replies'],
    ['moderation', 'Safety checks'],
  ])('names %s for a business owner', (purpose, label) => {
    expect(purposeLabel(purpose)).toBe(label)
  })

  it('shows an unfamiliar purpose readably instead of hiding it', () => {
    expect(purposeLabel('brand_voice_check')).toBe('Brand voice check')
    expect(purposeLabel('embedding')).toBe('Embedding')
  })

  it('never returns an empty label', () => {
    expect(purposeLabel('')).toBe('Other')
    expect(purposeLabel('__')).toBe('Other')
  })
})
