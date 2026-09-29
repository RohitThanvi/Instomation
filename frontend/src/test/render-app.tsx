import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { RequireOrganization } from '@/auth/require-organization'
import { SessionProvider } from '@/auth/session'

/**
 * Real SessionProvider + router + query cache; only `fetch` and Clerk are faked.
 * `requireOrganization` mounts the route under the same guard the app router uses.
 */
export function renderWithSession(
  element: ReactElement,
  {
    path,
    route,
    requireOrganization = false,
  }: { path: string; route: string; requireOrganization?: boolean },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider apiBaseUrl="https://api.test">
          <Routes>
            <Route element={requireOrganization ? <RequireOrganization /> : <Outlet />}>
              <Route path={route} element={element} />
            </Route>
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
