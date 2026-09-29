import type { z } from 'zod'
import { CLIENT_ERROR_CODES, ApiError, errorEnvelopeSchema } from './errors'

export type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  schema: S
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal | undefined
}

export interface ApiClientConfig {
  baseUrl: string
  getToken: () => Promise<string | null>
  /** Selection only: the server validates membership. Never a tenant claim. */
  getSelectedOrganizationId: () => string | null
  fetchImpl?: typeof fetch
}

export interface ApiClient {
  request: <S extends z.ZodType>(options: RequestOptions<S>) => Promise<z.infer<S>>
}

const NO_CONTENT = 204

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestOptions<z.ZodType>['query'],
): string {
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function readErrorBody(response: Response): Promise<{ code: string; message: string }> {
  const parsed = errorEnvelopeSchema.safeParse(await response.json().catch(() => null))
  if (parsed.success) return parsed.data.error
  return {
    code: CLIENT_ERROR_CODES.unexpected,
    message: `The server returned an unexpected response (${response.status}).`,
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? ((...args) => fetch(...args))

  async function request<S extends z.ZodType>(options: RequestOptions<S>): Promise<z.infer<S>> {
    const token = await config.getToken()
    if (token === null) {
      throw new ApiError(
        401,
        CLIENT_ERROR_CODES.noSession,
        'Your session has ended. Please sign in again.',
      )
    }

    const requestId = crypto.randomUUID()
    const headers = new Headers({
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Request-ID': requestId,
    })
    const organizationId = config.getSelectedOrganizationId()
    if (organizationId !== null) headers.set('X-Organization-ID', organizationId)

    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: options.signal ?? null,
    }
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      init.body = JSON.stringify(options.body)
    }

    let response: Response
    try {
      response = await doFetch(buildUrl(config.baseUrl, options.path, options.query), init)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      throw new ApiError(
        0,
        CLIENT_ERROR_CODES.network,
        'Cannot reach Instomation. Check your connection and try again.',
        requestId,
      )
    }

    if (!response.ok) {
      const { code, message } = await readErrorBody(response)
      throw new ApiError(response.status, code, message, requestId)
    }

    const payload: unknown =
      response.status === NO_CONTENT ? undefined : await response.json().catch(() => null)
    const parsed = options.schema.safeParse(payload)
    if (!parsed.success) {
      throw new ApiError(
        response.status,
        CLIENT_ERROR_CODES.invalidResponse,
        'The server sent data in an unexpected shape.',
        requestId,
      )
    }
    return parsed.data as z.infer<S>
  }

  return { request }
}
