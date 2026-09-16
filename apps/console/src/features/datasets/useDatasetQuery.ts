import { onScopeDispose, ref, shallowRef } from 'vue'
import type { DatasetApi } from './api.ts'
import type { QueryInput } from './types.ts'
import type { QueryResult } from '../../shared/types.ts'

export function useDatasetQuery(api: Pick<DatasetApi, 'query' | 'export'>, datasetId: number) {
  const result = shallowRef<QueryResult | null>(null)
  const snapshot = shallowRef<QueryInput | null>(null)
  const loading = ref(false)
  let generation = 0
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    reset()
  })

  function reset() {
    generation++
    result.value = null
    snapshot.value = null
  }

  async function query(input: QueryInput) {
    if (loading.value || disposed) {
      return
    }
    reset()
    loading.value = true
    const revision = generation
    // Detach the submitted request from editable form data before the first await.
    const body = structuredClone(input)
    try {
      const response = await api.query(datasetId, body)
      if (disposed || revision !== generation) {
        return
      }
      result.value = response
      snapshot.value = { ...body, releaseId: response.releaseId, columns: [...response.columns] }
    }
    finally {
      loading.value = false
    }
  }

  async function page(offset: number) {
    if (!snapshot.value || loading.value || disposed) {
      return
    }
    const revision = generation
    const body = structuredClone({ ...snapshot.value, offset })
    loading.value = true
    try {
      const response = await api.query(datasetId, body)
      if (!disposed && revision === generation) {
        result.value = response
        snapshot.value = body
      }
    }
    finally {
      loading.value = false
    }
  }

  async function exportPage() {
    if (!snapshot.value || !result.value || loading.value || disposed) {
      return
    }
    const revision = generation
    const filename = `dataset-${result.value.datasetId}-release-${result.value.releaseId}.csv`
    loading.value = true
    try {
      const blob = await api.export(datasetId, structuredClone(snapshot.value))
      if (!disposed && revision === generation) {
        return { blob, filename }
      }
    }
    finally {
      loading.value = false
    }
  }

  return { result, loading, query, page, exportPage, reset }
}
