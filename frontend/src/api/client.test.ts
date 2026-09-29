import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApiClient } from './client'
import { ApiError, CLIENT_ERROR_CODES } from './errors'

const schema = z.object({ ok: z.boolean() })
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(
  fetchImpl: typeof fetch,
  token: string | null = 'tok_123',
  organizationId: string | null = null,
) {
  return createApiClient({
    baseUrl: 'https://api.test',
    getToken: () => Promise.resolve(token),
    getSelectedOrganizationId: () => organizationId,
    fetchImpl,
  })
}

describe('createApiClient', () => {
  it('sends bearer token, a valid request id and no tenant header by default', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }))
    await setup(fetchImpl).request({ path: '/api/v1/auth/me', schema })

    const [url, init] = fetchImpl.mock.calls[0] ?? []
    const headers = new Headers(init?.headers)
    expect(url).toBe('https://api.test/api/v1/auth/me')
    expect(headers.get('Authorization')).toBe('Bearer tok_123')
    expect(headers.get('X-Request-ID')).toMatch(/^[A-Za-z0-9._-]{8,64}$/)
    expect(headers.has('X-Organization-ID')).toBe(false)
  })

  it('sends the organization selection header only when one is selected', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }))
    await setup(fetchImpl, 'tok', 'org-1').request({ path: '/x', schema })
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('X-Organization-ID')).toBe(
      'org-1',
    )
  })

  it('serialises query params, skipping null and undefined', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }))
    await setup(fetchImpl).request({
      path: '/x',
      schema,
      query: { limit: 50, cursor: null, q: undefined },
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.test/x?limit=50')
  })

  it('parses the server error envelope into a typed ApiError', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ error: { code: 'PERMISSION_DENIED', message: 'You cannot do that.' } }, 403),
      )
    const error = await setup(fetchImpl)
      .request({ path: '/x', schema })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 403,
      code: 'PERMISSION_DENIED',
      message: 'You cannot do that.',
    })
  })

  it('degrades gracefully when an error body is not the envelope', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    const error = await setup(fetchImpl)
      .request({ path: '/x', schema })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 502, code: CLIENT_ERROR_CODES.unexpected })
  })

  it('rejects responses that fail schema validation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: 'yes' }))
    const error = await setup(fetchImpl)
      .request({ path: '/x', schema })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: CLIENT_ERROR_CODES.invalidResponse })
  })

  it('maps network failures to a retryable error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await setup(fetchImpl)
      .request({ path: '/x', schema })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ code: CLIENT_ERROR_CODES.network })
    expect((error as ApiError).isRetryable).toBe(true)
  })

  it('fails without calling the network when there is no session token', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const error = await setup(fetchImpl, null)
      .request({ path: '/x', schema })
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 401, code: CLIENT_ERROR_CODES.noSession })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts 204 responses when the schema allows undefined', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    await expect(
      setup(fetchImpl).request({ method: 'DELETE', path: '/x', schema: z.undefined() }),
    ).resolves.toBeUndefined()
  })
})
