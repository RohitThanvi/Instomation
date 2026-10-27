import { useCallback, useState } from 'react'
import { useRequiredOrganization } from '@/auth/session-context'
import { can } from '@/auth/permissions'
import { Notice } from '@/components/ui/notice'
import { AssistantSection } from './assistant-section'
import { ProfileSection } from './profile-section'
import { UnsavedChangesGuard } from './unsaved-changes'

export function SettingsPage() {
  const { role } = useRequiredOrganization()
  const [assistantDirty, setAssistantDirty] = useState(false)
  const [profileDirty, setProfileDirty] = useState(false)
  const reportAssistant = useCallback((dirty: boolean) => {
    setAssistantDirty(dirty)
  }, [])
  const reportProfile = useCallback((dirty: boolean) => {
    setProfileDirty(dirty)
  }, [])
  return (
    <div className="animate-fade-in max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Settings</h1>
        <p className="text-ink-muted max-w-xl">
          Tell the assistant about your business and how careful to be. Changes apply to the next
          message it handles.
        </p>
      </div>
      {can(role, 'settings_manage') ? (
        <>
          <UnsavedChangesGuard dirty={assistantDirty || profileDirty} />
          <AssistantSection onDirtyChange={reportAssistant} />
          <ProfileSection onDirtyChange={reportProfile} />
        </>
      ) : (
        <Notice tone="info" title="Settings are for owners and admins">
          Ask an owner or admin if the assistant needs to behave differently.
        </Notice>
      )}
    </div>
  )
}
