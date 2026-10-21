import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import {
  useQuery,
  useQueries,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/vue-query'
import type { Model } from '@/shared/api/types'
import { jobRepository } from '../api/job-repository'
export function useTasks(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['tasks', toValue(filters)]),
    queryFn: ({ signal }) => jobRepository.tasks(toValue(filters), signal),
  })
}
export function useTask(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['tasks', 'detail', toValue(id)]),
    queryFn: ({ signal }) => jobRepository.task(toValue(id), signal),
    enabled: computed(() => !!toValue(id)),
  })
}
export function useDependencyTaskOptions(
  search: MaybeRefOrGetter<string>,
  excludedId: MaybeRefOrGetter<string>,
  excludedDatasetId: MaybeRefOrGetter<string>,
) {
  return useInfiniteQuery({
    queryKey: computed(() => [
      'tasks',
      'dependency-options',
      toValue(search),
      toValue(excludedId),
      toValue(excludedDatasetId),
    ]),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      jobRepository.tasks(
        {
          q: toValue(search),
          excludeId: toValue(excludedId),
          excludeDatasetId: toValue(excludedDatasetId),
          page: String(pageParam),
          pageSize: '20',
          sort: 'name',
        },
        signal,
      ),
    getNextPageParam: (lastPage) => {
      const { page = 1, pageSize = 20, total } = lastPage.meta
      if (total === undefined) return lastPage.data.length === pageSize ? page + 1 : undefined
      return page * pageSize < total ? page + 1 : undefined
    },
  })
}
export function useSelectedTasks(ids: MaybeRefOrGetter<string[]>) {
  return useQueries({
    queries: computed(() =>
      [...new Set(toValue(ids))].map((id) => ({
        queryKey: ['tasks', 'detail', id],
        queryFn: ({ signal }: { signal: AbortSignal }) => jobRepository.task(id, signal),
      })),
    ),
  })
}
export function useRuns(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['runs', toValue(filters)]),
    queryFn: ({ signal }) => jobRepository.runs(toValue(filters), signal),
    refetchInterval: (q) =>
      q.state.data?.data.some(
        (r) =>
          ['queued', 'running', 'validating', 'publishing'].includes(r.status) ||
          Boolean(r.retryAt && !r.retryRunId && !r.retryPaused),
      )
        ? 1000
        : false,
    refetchIntervalInBackground: false,
  })
}
export function useRun(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['runs', 'detail', toValue(id)]),
    queryFn: () => jobRepository.detail(toValue(id)),
    refetchInterval: (q) =>
      q.state.data &&
      (!['succeeded', 'failed', 'blocked', 'canceled'].includes(q.state.data.status) ||
        Boolean(q.state.data.retryAt && !q.state.data.retryRunId && !q.state.data.retryPaused))
        ? 750
        : false,
    refetchIntervalInBackground: false,
  })
}
export function useJobActions() {
  const cache = useQueryClient()
  const done = async () => {
    await Promise.all(
      ['tasks', 'runs', 'overview', 'warehouse'].map((key) =>
        cache.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
  return {
    run: useMutation({
      mutationFn: ({
        datasetId,
        allowEmptySnapshot,
        key,
      }: {
        datasetId: string
        allowEmptySnapshot?: boolean
        key?: string
      }) => jobRepository.run(datasetId, allowEmptySnapshot, key),
      onSuccess: done,
    }),
    toggle: useMutation({
      mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
        jobRepository.toggle(id, enabled),
      onSuccess: done,
    }),
    save: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Model<'TaskInput'> }) =>
        jobRepository.save(id, input),
      onSuccess: done,
    }),
    cancel: useMutation({ mutationFn: jobRepository.cancel, onSuccess: done }),
    retry: useMutation({
      mutationFn: ({
        id,
        allowEmptySnapshot,
        key,
      }: {
        id: string
        allowEmptySnapshot?: boolean
        key?: string
      }) => jobRepository.retry(id, allowEmptySnapshot, key),
      onSuccess: done,
    }),
    backfill: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Model<'BackfillInput'> }) =>
        jobRepository.backfill(id, input),
      onSuccess: done,
    }),
  }
}
