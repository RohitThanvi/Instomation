import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { ProtectedRoute } from '@/auth/protected-route'
import { AppLayout } from '@/components/layout/app-layout'
import { ROUTES } from '@/config/constants'
import type { Env } from '@/config/env'
import { RootProviders } from './providers'
import { RouteError } from './route-error'

export function createRoutes(env: Env): RouteObject[] {
  return [
    {
      element: <RootProviders env={env} />,
      errorElement: <RouteError />,
      children: [
        {
          path: `${ROUTES.signIn}/*`,
          lazy: async () => ({ Component: (await import('./auth-pages')).SignInPage }),
        },
        {
          path: `${ROUTES.signUp}/*`,
          lazy: async () => ({ Component: (await import('./auth-pages')).SignUpPage }),
        },
        {
          element: <ProtectedRoute />,
          children: [
            {
              element: <AppLayout />,
              children: [
                {
                  index: true,
                  lazy: async () => ({ Component: (await import('./home-page')).HomePage }),
                },
                {
                  path: '*',
                  lazy: async () => ({
                    Component: (await import('./not-found-page')).NotFoundPage,
                  }),
                },
              ],
            },
          ],
        },
      ],
    },
  ]
}

export function createAppRouter(env: Env) {
  return createBrowserRouter(createRoutes(env))
}
