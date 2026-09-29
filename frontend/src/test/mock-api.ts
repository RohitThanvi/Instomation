import { vi, type Mock } from 'vitest'

export interface RecordedCall {
  method: string
  path: string
  headers: Headers
  body: unknown
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown }

/**
 * Installs a fake `fetch` keyed by "METHOD /path". Any request without a handler fails the
 * test loudly, so a screen can never silently hit an endpoint the test did not expect.
 */
export function installMockApi(handlers: Record<string, Handler>): {
  calls: RecordedCall[]
  fetchMock: Mock<typeof fetch>
} {
  const calls: RecordedCall[] = []
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const method = init?.method ?? 'GET'
    const call: RecordedCall = {
      method,
      path: url.pathname,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
    calls.push(call)
    const handler = handlers[`${method} ${url.pathname}`]
    if (handler === undefined) {
      return Promise.reject(new Error(`Unexpected request: ${method} ${url.pathname}`))
    }
    const { status = 200, body } = handler(call)
    return Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

export const emptyPage = { items: [], next_cursor: null }
