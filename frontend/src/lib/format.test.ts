import { describe, expect, it } from 'vitest'
import {
  formatCount,
  formatMessageTime,
  formatRelativeTime,
  formatShortDate,
  formatUsd,
} from './format'

describe('format', () => {
  it('groups thousands', () => {
    expect(formatCount(1240, 'en-US')).toBe('1,240')
    expect(formatCount(0, 'en-US')).toBe('0')
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

describe('formatUsd', () => {
  it.each([
    ['0', '$0.00'],
    ['0.5', '$0.50'],
    ['1', '$1.00'],
    ['12.3456', '$12.35'],
    ['1234.5', '$1,234.50'],
    ['123456789012.123456', '$123,456,789,012.12'],
  ])('shows %s as whole dollars and cents from one dollar up', (amount, expected) => {
    expect(formatUsd(amount, 'en-US')).toBe(expected)
  })

  it('rounds half up exactly, from the digits rather than a float', () => {
    // 1.005 is below 1.005 as a float (1.00499999999999989...), so a float would give $1.00.
    expect(formatUsd('1.005', 'en-US')).toBe('$1.01')
    expect(formatUsd('12.345', 'en-US')).toBe('$12.35')
  })

  it('keeps up to four decimals below a dollar so a fraction of a cent is not shown as zero', () => {
    expect(formatUsd('0.000432', 'en-US')).toBe('$0.0004')
    expect(formatUsd('0.0128', 'en-US')).toBe('$0.0128')
    expect(formatUsd('0.99994', 'en-US')).toBe('$0.9999')
  })

  it('says "less than" for an amount too small to show, but not for a true zero', () => {
    expect(formatUsd('0.00004', 'en-US')).toBe('<$0.0001')
    expect(formatUsd('0.000049', 'en-US')).toBe('<$0.0001')
    expect(formatUsd('0.000000', 'en-US')).toBe('$0.00')
    expect(formatUsd('0.00005', 'en-US')).toBe('$0.0001')
  })

  it('follows the viewer locale', () => {
    expect(formatUsd('1234.5', 'de-DE')).toBe('1.234,50\u00a0$')
  })

  it.each(['', '-1', '1e-7', '1,5', 'abc', ' 1', '1.'])('refuses %j instead of guessing', (bad) => {
    expect(() => formatUsd(bad)).toThrow(RangeError)
  })
})
