import { MutationCache, QueryCache, QueryClient } from '@tanstack/vue-query'
import { notifyUiError } from '@/shared/ui/error-message'
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: notifyUiError }),
  mutationCache: new MutationCache({ onError: notifyUiError }),
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})
