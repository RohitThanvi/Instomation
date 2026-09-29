import { CrashScreen } from '@/components/error-boundary'

/** Router `errorElement`: also covers lazy-chunk load failures after a deploy. */
export function RouteError() {
  return (
    <CrashScreen
      onReload={() => {
        window.location.reload()
      }}
    />
  )
}
