import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { RequireOrganization } from '@/auth/require-organization'
import { SessionProvider } from '@/auth/session'
import { ToastProvider } from '@/components/ui/toast'

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
  // A data router, like the app's, so pages can use features such as navigation blockers.
  const router = createMemoryRouter(
    [
      {
        element: (
          <QueryClientProvider client={queryClient}>
            <SessionProvider apiBaseUrl="https://api.test">
              <ToastProvider>
                <Outlet />
              </ToastProvider>
            </SessionProvider>
          </QueryClientProvider>
        ),
        children: [
          {
            element: requireOrganization ? <RequireOrganization /> : <Outlet />,
            children: [{ path: route, element }],
          },
          // Somewhere to navigate to, so a test can leave the page under test.
          { path: '*', element: <p>Elsewhere</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  )
  const rendered = render(<RouterProvider router={router} />)
  return { ...rendered, queryClient, router }
}
