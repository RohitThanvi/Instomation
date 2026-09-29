export function ConfigError({ issues }: { issues: readonly string[] }) {
  return (
    <div role="alert" className="bg-canvas grid min-h-dvh place-items-center p-6">
      <div className="max-w-lg space-y-3">
        <h1 className="font-display text-2xl font-medium tracking-tight">
          Instomation is not configured
        </h1>
        <p className="text-ink-muted">Set these environment variables and rebuild:</p>
        <ul className="text-danger-600 list-disc pl-5 text-sm">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
