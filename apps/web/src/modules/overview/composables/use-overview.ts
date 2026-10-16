import { useQuery } from '@tanstack/vue-query'
import { overviewRepository } from '../api/overview-repository'
export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: ({ signal }) => overviewRepository.get(signal),
  })
}
