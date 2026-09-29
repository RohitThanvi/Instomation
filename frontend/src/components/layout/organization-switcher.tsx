import { useSession } from '@/auth/session-context'

export function OrganizationSwitcher() {
  const { organizations, currentOrganization, selectOrganization } = useSession()
  if (organizations.length < 2 || currentOrganization === null) return null

  return (
    <label className="text-ink-muted flex items-center gap-2 text-sm">
      <span className="sr-only md:not-sr-only">Workspace</span>
      <select
        value={currentOrganization.id}
        onChange={(event) => {
          selectOrganization(event.target.value)
        }}
        className="border-line-strong bg-surface text-ink shadow-card h-9 max-w-48 rounded-md border px-2 text-sm"
      >
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  )
}
