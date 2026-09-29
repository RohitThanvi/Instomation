/** Holds the organization id sent as the `X-Organization-ID` selection header. */
export interface TenantHeader {
  get: () => string | null
  set: (organizationId: string | null) => void
}

export function createTenantHeader(): TenantHeader {
  let current: string | null = null
  return {
    get: () => current,
    set: (organizationId) => {
      current = organizationId
    },
  }
}
