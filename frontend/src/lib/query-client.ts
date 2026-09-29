import { MutationCache, QueryClient } from '@tanstack/react-query'
import { isApiError } from '@/api/errors'
import { QUERY_MAX_RETRIES, QUERY_STALE_MS } from '@/config/constants'

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return isApiError(error) && error.isRetryable && failureCount < QUERY_MAX_RETRIES
}

export function createQueryClient(onMutationError: (error: unknown) => void): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: QUERY_STALE_MS, retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({ onError: onMutationError }),
  })
}
