import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}
interface State {
  failed: boolean
}

export function CrashScreen({ onReload }: { onReload: () => void }) {
  return (
    <div role="alert" className="bg-canvas grid min-h-dvh place-items-center p-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="font-display text-2xl font-medium tracking-tight">Something went wrong</h1>
        <p className="text-ink-muted">
          An unexpected error stopped this page. Reloading usually fixes it, and nothing you saved
          has been lost.
        </p>
        <Button onClick={onReload}>Reload</Button>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console/monitoring hook without leaking user data to the UI.
    console.error('Unhandled render error', error.name, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.failed)
      return (
        <CrashScreen
          onReload={() => {
            window.location.reload()
          }}
        />
      )
    return this.props.children
  }
}
