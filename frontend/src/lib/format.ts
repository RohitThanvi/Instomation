export function formatCount(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** `ratio` is 0 to 1. */
export function formatPercent(ratio: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio)
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
