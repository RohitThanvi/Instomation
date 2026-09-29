import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { EnvError, parseEnv, type Env } from '@/config/env'
import { ConfigError } from '@/routes/config-error'
import { createAppRouter } from '@/routes/router'
import './index.css'

const container = document.getElementById('root')
if (container === null) throw new Error('Missing #root element')

let env: Env | null = null
let issues: readonly string[] = []
try {
  env = parseEnv(import.meta.env)
} catch (error) {
  if (!(error instanceof EnvError)) throw error
  issues = error.issues
}

createRoot(container).render(
  <StrictMode>
    {env === null ? (
      <ConfigError issues={issues} />
    ) : (
      <RouterProvider router={createAppRouter(env)} />
    )}
  </StrictMode>,
)
