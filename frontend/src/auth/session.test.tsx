import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { z } from 'zod'
import { SessionProvider } from './session'
import { useSession } from './session-context'
import { STORAGE_KEYS } from '@/config/constants'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
}))

const ORG_A = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha',
  account_type: 'business',
  role: 'owner',
}
const ORG_B = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Beta',
  account_type: 'creator',
  role: 'staff',
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function Probe() {
  const { client, currentOrganization, selectOrganization } = useSession()
  return (
    <>
      <p data-testid="current">{currentOrganization?.name ?? 'none'}</p>
      <button
        onClick={() => {
          selectOrganization(ORG_B.id)
        }}
      >
        pick beta
      </button>
      <button onClick={() => void client.request({ path: '/probe', schema: z.unknown() })}>
        probe
      </button>
    </>
  )
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider apiBaseUrl="https://api.test">
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  )
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function headerOfCall(fetchMock: Mock<typeof fetch>, urlPart: string): string | null {
  const call = fetchMock.mock.calls.find(([url]) => urlOf(url).includes(urlPart)) as
    [string, RequestInit] | undefined
  return new Headers(call?.[1].headers).get('X-Organization-ID')
}

describe('SessionProvider tenant selection', () => {
  let fetchMock: Mock<typeof fetch>

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends no organization header for a user with one organization', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ items: [ORG_A], next_cursor: null })))
    mount()
    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('Alpha')
    })
    await userEvent.click(screen.getByText('probe'))
    await waitFor(() => {
      expect(headerOfCall(fetchMock, '/probe')).toBeNull()
    })
  })

  it('sends the selected organization for a multi-organization user and remembers the choice', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ items: [ORG_A, ORG_B], next_cursor: null })),
    )
    mount()
    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('Alpha')
    })

    await userEvent.click(screen.getByText('pick beta'))
    await waitFor(() => {
      expect(screen.getByTestId('current')).toHaveTextContent('Beta')
    })
    expect(window.localStorage.getItem(STORAGE_KEYS.selectedOrganization)).toBe(ORG_B.id)

    await userEvent.click(screen.getByText('probe'))
    await waitFor(() => {
      expect(headerOfCall(fetchMock, '/probe')).toBe(ORG_B.id)
    })
  })

  it('follows every page of the cursor-paginated organization list', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [ORG_A], next_cursor: 'c2' }))
      .mockResolvedValueOnce(json({ items: [ORG_B], next_cursor: null }))
    mount()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(urlOf(fetchMock.mock.calls[1]?.[0] ?? '')).toContain('cursor=c2')
  })
})
