/**
 * Thrown by API functions whose backend endpoint does not exist yet.
 * Nothing is sent over the network and nothing is faked: screens catch this and
 * render an explicit "not yet available" state.
 */
export class NotYetAvailableError extends Error {
  constructor(readonly feature: string) {
    super(`${feature} is not available yet.`)
    this.name = 'NotYetAvailableError'
  }
}

export function isNotYetAvailable(value: unknown): value is NotYetAvailableError {
  return value instanceof NotYetAvailableError
}
