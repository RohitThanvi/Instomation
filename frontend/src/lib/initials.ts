const MAX_INITIALS = 2

/** Up to two capital letters from a name or Instagram handle; `?` when there is nothing to use. */
export function initialsOf(name: string): string {
  const letters = name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter((part) => part.length > 0)
    .slice(0, MAX_INITIALS)
    .map((part) => part.charAt(0).toUpperCase())
  return letters.join('') || '?'
}
