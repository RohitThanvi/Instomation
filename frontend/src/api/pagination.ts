interface Page<T> {
  items: T[]
  next_cursor: string | null
}

/** Follows `next_cursor` until exhausted. Only for small, bounded collections. */
export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
): Promise<T[]> {
  const all: T[] = []
  let cursor: string | null = null
  do {
    const page: Page<T> = await fetchPage(cursor)
    all.push(...page.items)
    cursor = page.next_cursor
  } while (cursor !== null)
  return all
}
