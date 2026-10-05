import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatMessageTime,
  formatPercent,
  formatRelativeTime,
  formatShortDate,
} from './format'

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

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-04T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const SEC = 1000
  const MIN = 60 * SEC
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it.each([
    [10 * SEC, 'now'],
    [5 * MIN, '5 min. ago'],
    [3 * HOUR, '3 hr. ago'],
    [DAY, 'yesterday'],
    [3 * DAY, '3 days ago'],
  ])('renders %i ms ago as "%s"', (elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), now, 'en-US')).toBe(expected)
  })

  it('falls back to a calendar date after a week, with the year only when it differs', () => {
    expect(formatRelativeTime('2026-09-01T10:00:00Z', now, 'en-US')).toBe('Sep 1')
    expect(formatRelativeTime('2025-09-01T10:00:00Z', now, 'en-US')).toBe('Sep 1, 2025')
  })

  it('never shows the future as "ago" when clocks are slightly off', () => {
    expect(formatRelativeTime(new Date(now.getTime() + 5 * SEC).toISOString(), now, 'en-US')).toBe(
      'now',
    )
  })
})

describe('formatMessageTime', () => {
  it('shows the date and time in the requested zone', () => {
    expect(formatMessageTime('2026-10-04T09:05:00Z', 'en-US', 'UTC')).toBe('Oct 4, 9:05 AM')
    expect(formatMessageTime('2026-10-04T09:05:00Z', 'en-US', 'Asia/Kolkata')).toBe(
      'Oct 4, 2:35 PM',
    )
  })
})
