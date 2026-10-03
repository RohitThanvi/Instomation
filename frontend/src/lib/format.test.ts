import { describe, expect, it } from 'vitest'
import { formatCount, formatPercent, formatShortDate } from './format'

describe('format', () => {
  it('groups thousands', () => {
    expect(formatCount(1240, 'en-US')).toBe('1,240')
    expect(formatCount(0, 'en-US')).toBe('0')
  })

  it('renders a 0-1 ratio as a whole percent', () => {
    expect(formatPercent(0.62, 'en-US')).toBe('62%')
    expect(formatPercent(1, 'en-US')).toBe('100%')
    expect(formatPercent(0.6249, 'en-US')).toBe('62%')
  })

  it('formats a calendar date without shifting the day for any viewer time zone', () => {
    expect(formatShortDate('2026-09-01', 'en-US')).toBe('Sep 1')
    expect(formatShortDate('2026-12-31', 'en-US')).toBe('Dec 31')
  })
})
