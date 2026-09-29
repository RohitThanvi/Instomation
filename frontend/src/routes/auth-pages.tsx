import { SignIn, SignUp } from '@clerk/clerk-react'
import type { ReactNode } from 'react'
import { Brand } from '@/components/layout/brand'
import { ROUTES } from '@/config/constants'

const clerkAppearance = {
  variables: {
    colorPrimary: 'var(--color-accent-600)',
    colorText: 'var(--color-ink)',
    colorBackground: 'var(--color-surface)',
    colorInputBackground: 'var(--color-surface)',
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-md)',
  },
  elements: { card: 'shadow-raised border border-line' },
} as const

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-canvas grid min-h-dvh place-items-center px-4 py-12">
      <div className="animate-fade-in flex w-full max-w-md flex-col items-center gap-8">
        <Brand />
        {children}
        <p className="text-ink-subtle text-center text-sm">
          Instomation connects only through Instagram&rsquo;s official APIs. We never ask for your
          Instagram password.
        </p>
      </div>
    </div>
  )
}

export function SignInPage() {
  return (
    <AuthShell>
      <SignIn
        routing="path"
        path={ROUTES.signIn}
        signUpUrl={ROUTES.signUp}
        appearance={clerkAppearance}
      />
    </AuthShell>
  )
}

export function SignUpPage() {
  return (
    <AuthShell>
      <SignUp
        routing="path"
        path={ROUTES.signUp}
        signInUrl={ROUTES.signIn}
        appearance={clerkAppearance}
      />
    </AuthShell>
  )
}
