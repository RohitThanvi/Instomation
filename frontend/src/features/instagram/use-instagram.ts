import { useMutation, useQuery } from '@tanstack/react-query'
import {
  fetchCapabilities,
  fetchInstagramAccounts,
  isFeatureEnabled,
  startInstagramOAuth,
} from '@/api/instagram'
import { tenantKey } from '@/api/keys'
import { collectPages } from '@/api/pagination'
import { useRequiredOrganization, useSession } from '@/auth/session-context'
import { STORAGE_KEYS } from '@/config/constants'
import { navigateToExternal } from '@/lib/navigation'
import { writeStorage } from '@/lib/storage'

export function useInstagramAccounts() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  return useQuery({
    queryKey: tenantKey(organization.id, 'instagram', 'accounts'),
    queryFn: ({ signal }) =>
      collectPages((cursor) => fetchInstagramAccounts(client, cursor, signal)),
  })
}

export function useCapabilities() {
  const { client } = useSession()
  const organization = useRequiredOrganization()
  const query = useQuery({
    queryKey: tenantKey(organization.id, 'instagram', 'capabilities'),
    queryFn: ({ signal }) => fetchCapabilities(client, signal),
  })
  const capabilities = query.data
  return {
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    /** False until the server confirms the feature is enabled. */
    isEnabled: (feature: string) =>
      capabilities !== undefined && isFeatureEnabled(capabilities, feature),
  }
}

/** Starts Instagram OAuth and sends the browser to Meta. `returnToOnboarding` lets the return page resume setup. */
export function useConnectInstagram(returnToOnboarding: boolean) {
  const { client } = useSession()
  return useMutation({
    mutationFn: () => startInstagramOAuth(client),
    onSuccess: ({ authorization_url }) => {
      if (returnToOnboarding) writeStorage(STORAGE_KEYS.onboardingReturn, '1')
      navigateToExternal(authorization_url)
    },
  })
}
