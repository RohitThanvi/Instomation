/** Full-page navigation (e.g. to Meta's consent screen). Isolated so tests can replace it. */
export function navigateToExternal(url: string): void {
  window.location.assign(url)
}
