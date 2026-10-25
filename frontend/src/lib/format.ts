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

/**
 * A US-dollar amount from the plain decimal string the API sends (for example "0.000432"),
 * formatted from the string itself so no precision is lost to a float. Whole dollars and up show
 * cents; smaller amounts show up to four decimals so a fraction of a cent is not displayed as
 * zero, and an amount too small even for that reads "<$0.0001".
 */
export function formatUsd(amount: string, locale?: string): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new RangeError(`Not a decimal amount: ${amount}`)
  const money = (value: string, maximumFractionDigits: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(value)
  const dollars = /^0*[1-9]/.test(amount)
  const formatted = money(amount, dollars ? 2 : 4)
  const nonzero = /[1-9]/.test(amount)
  return nonzero && !/[1-9]/.test(formatted) ? `<${money('0.0001', 4)}` : formatted
}
