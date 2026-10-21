import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { governanceRepository as repo } from '../api/governance-repository'
import type { Model } from '@/shared/api/types'
export function useQuality(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['governance', 'quality', toValue(filters)]),
    queryFn: ({ signal }) => repo.quality(toValue(filters), signal),
  })
}
export function useMasking(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['governance', 'masking', toValue(filters)]),
    queryFn: ({ signal }) => repo.masking(toValue(filters), signal),
  })
}
export function useCatalog(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['governance', 'catalog', toValue(filters)]),
    queryFn: () => repo.catalog(toValue(filters)),
  })
}
export function useLineage(scope: MaybeRefOrGetter<'resource' | 'field'> = 'resource') {
  return useQuery({
    queryKey: computed(() => ['governance', 'lineage', toValue(scope)]),
    queryFn: () => repo.lineage(toValue(scope)),
  })
}
export function useQualityDetail(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['governance', 'quality', toValue(id)]),
    queryFn: ({ signal }) => repo.qualityDetail(toValue(id), signal),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useMaskDetail(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['governance', 'masking', toValue(id)]),
    queryFn: ({ signal }) => repo.maskDetail(toValue(id), signal),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useGovernanceActions() {
  const cache = useQueryClient()
  const done = () => cache.invalidateQueries({ queryKey: ['governance'] })
  return {
    saveQuality: useMutation({
      mutationFn: ({ body, id }: { body: Model<'QualityInput'>; id?: string }) =>
        repo.saveQuality(body, id),
      onSuccess: done,
    }),
    saveMask: useMutation({
      mutationFn: ({ body, id }: { body: Model<'MaskingInput'>; id?: string }) =>
        repo.saveMask(body, id),
      onSuccess: done,
    }),
    favorite: useMutation({
      mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
        repo.favorite(id, favorite),
      onSuccess: done,
    }),
  }
}
