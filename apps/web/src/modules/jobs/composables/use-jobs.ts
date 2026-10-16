import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import type { Model } from '@/shared/api/types'
import { jobRepository } from '../api/job-repository'
export function useTasks(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['tasks', toValue(filters)]),
    queryFn: () => jobRepository.tasks(toValue(filters)),
  })
}
export function useTask(id: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: computed(() => ['tasks', 'detail', toValue(id)]),
    queryFn: () => jobRepository.task(toValue(id)),
  })
}
export function useRuns(filters: MaybeRefOrGetter<Record<string, string>> = {}) {
  return useQuery({
    queryKey: computed(() => ['runs', toValue(filters)]),
    queryFn: () => jobRepository.runs(toValue(filters)),
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
      mutationFn: ({ datasetId, outcome }: { datasetId: string; outcome: Model<'RunOutcome'> }) =>
        jobRepository.run(datasetId, outcome),
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
      mutationFn: ({ id, outcome }: { id: string; outcome: Model<'RunOutcome'> }) =>
        jobRepository.retry(id, outcome),
      onSuccess: done,
    }),
    backfill: useMutation({
      mutationFn: ({ id, input }: { id: string; input: Model<'BackfillInput'> }) =>
        jobRepository.backfill(id, input),
      onSuccess: done,
    }),
  }
}
