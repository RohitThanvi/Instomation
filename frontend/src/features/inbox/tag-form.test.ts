import { describe, expect, it } from 'vitest'
import { MAX_TAG_LENGTH } from '@/config/constants'
import { isDuplicateTag, tagFormSchema } from './tag-form'

describe('tag form', () => {
  it('trims and accepts a normal tag', () => {
    expect(tagFormSchema.parse({ tag: '  vip  ' }).tag).toBe('vip')
  })

  it('rejects an empty tag and one longer than the backend column allows', () => {
    expect(tagFormSchema.safeParse({ tag: '   ' }).success).toBe(false)
    expect(tagFormSchema.safeParse({ tag: 'x'.repeat(MAX_TAG_LENGTH) }).success).toBe(true)
    expect(tagFormSchema.safeParse({ tag: 'x'.repeat(MAX_TAG_LENGTH + 1) }).success).toBe(false)
  })

  it('treats tags that differ only by case as duplicates', () => {
    expect(isDuplicateTag(['VIP'], 'vip')).toBe(true)
    expect(isDuplicateTag(['VIP'], 'wholesale')).toBe(false)
    expect(isDuplicateTag([], 'vip')).toBe(false)
  })
})
