import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAiSettings,
  fetchBusinessProfile,
  saveBusinessProfile,
  updateAiSettings,
  type AiSettingsPatch,
  type BusinessProfile,
} from '@/api/business'
import { tenantKey } from '@/api/keys'
import { useRequiredOrganization, useSession } from '@/auth/session-context'
import { useToast } from '@/components/ui/toast-context'

export const settingsKeys = {
  profile: (organizationId: string) => tenantKey(organizationId, 'settings', 'profile'),
  ai: (organizationId: string) => tenantKey(organizationId, 'settings', 'ai'),
}

// Settings are read fresh on every visit: onboarding and other tabs change them, and an editor
// that opens on stale values would quietly overwrite someone else's change.
export function useBusinessProfile() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: settingsKeys.profile(organization.id),
    queryFn: ({ signal }) => fetchBusinessProfile(client, signal),
    refetchOnMount: 'always',
  })
}

export function useAiSettings() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: settingsKeys.ai(organization.id),
    queryFn: ({ signal }) => fetchAiSettings(client, signal),
    refetchOnMount: 'always',
  })
}

export function useSaveProfile() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (profile: BusinessProfile) => saveBusinessProfile(client, profile),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKeys.profile(organization.id), saved)
      toast({ title: 'Business profile saved', variant: 'success' })
    },
  })
}

export function useSaveAiSettings() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (patch: AiSettingsPatch) => updateAiSettings(client, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsKeys.ai(organization.id), saved)
      toast({ title: 'Assistant settings saved', variant: 'success' })
    },
  })
}
