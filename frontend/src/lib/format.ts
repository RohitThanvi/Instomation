export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** Formats a calendar date (`YYYY-MM-DD`) without letting the viewer's time zone shift the day. */
export function formatShortDate(isoDate: string, locale?: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

const SECOND_MS = 1000
const NEARLY_NOW_SECONDS = 45
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_WEEK = 7

/** Compact "how long ago", falling back to a calendar date after a week. */
export function formatRelativeTime(iso: string, now: Date = new Date(), locale?: string): string {
  const then = new Date(iso)
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / SECOND_MS))
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (seconds < NEARLY_NOW_SECONDS) return rtf.format(0, 'second')
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE)
  if (minutes < MINUTES_PER_HOUR) return rtf.format(-minutes, 'minute')
  const hours = Math.round(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / HOURS_PER_DAY)
  if (days < DAYS_PER_WEEK) return rtf.format(-days, 'day')
  const sameYear = then.getFullYear() === now.getFullYear()
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(then)
}

/** Date and time of a message, in the viewer's time zone unless one is given. */
export function formatMessageTime(iso: string, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(iso))
}
