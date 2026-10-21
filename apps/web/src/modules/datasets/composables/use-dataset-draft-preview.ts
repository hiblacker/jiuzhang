import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import { useMutation } from '@tanstack/vue-query'
import type { Model } from '@/shared/api/types'
import { datasetRepository, type DatasetInput } from '../api/dataset-repository'
import { reconcileSqlFields, toInput } from '../model/definition'

/** Own the draft snapshot, discovered SQL schema and displayed result as one editing session. */
export function useDatasetDraftPreview(draft: Ref<DatasetInput>, id: MaybeRefOrGetter<string>) {
  const data = shallowRef<Model<'Preview'>>()
  const failed = ref(false)
  const schemaChanges = shallowRef<{ added: string[]; removed: string[] }>()
  const validatedSql = ref('')
  const sqlKey = () => JSON.stringify([draft.value.definition.sourceId, draft.value.definition.sql])
  let revision = 0
  onScopeDispose(() => {
    revision++
  })
  watch(
    () =>
      JSON.stringify([toValue(id), draft.value.definition.sourceId, draft.value.definition.mode]),
    () => {
      validatedSql.value = ''
    },
    { flush: 'sync' },
  )
  watch(
    () => {
      const {
        sourceId,
        objectId,
        upstreamDatasetId,
        mode,
        sql,
        fields,
        nodes,
        edges,
        cleaning,
        qualityRuleIds,
        maskPolicyIds,
      } = draft.value.definition
      return JSON.stringify([
        toValue(id),
        sourceId,
        objectId,
        upstreamDatasetId,
        mode,
        sql,
        fields,
        nodes,
        edges,
        cleaning,
        qualityRuleIds,
        maskPolicyIds,
      ])
    },
    () => {
      revision++
      data.value = undefined
      failed.value = false
      schemaChanges.value = undefined
    },
    { flush: 'sync' },
  )
  function acceptDefinition() {
    validatedSql.value = draft.value.definition.mode === 'sql' ? sqlKey() : ''
  }
  const mutation = useMutation({
    mutationFn: async ({ input }: { input: DatasetInput; revision: number }) => {
      const refreshSchema =
        input.definition.mode === 'sql' &&
        (!input.definition.fields.length ||
          validatedSql.value !== JSON.stringify([input.definition.sourceId, input.definition.sql]))
      if (!refreshSchema) return { result: await datasetRepository.preview(input) }
      const discovery = toInput(input)
      discovery.definition.fields = []
      const schema = await datasetRepository.preview(discovery)
      const reconciled = reconcileSqlFields(input.definition.fields, schema.fields)
      input.definition.fields = reconciled.fields
      return { result: await datasetRepository.preview(input), reconciled }
    },
    onMutate: () => {
      data.value = undefined
      failed.value = false
      schemaChanges.value = undefined
    },
    onSuccess: ({ result, reconciled }, request) => {
      if (request.revision !== revision) return
      if (reconciled) draft.value.definition.fields = reconciled.fields
      acceptDefinition()
      data.value = result
      schemaChanges.value = reconciled
    },
    onError: (_error, request) => {
      if (request.revision === revision) failed.value = true
    },
  })
  async function run() {
    if (mutation.isPending.value) return false
    try {
      await mutation.mutateAsync({ input: toInput(draft.value), revision })
      return !!data.value
    } catch {
      // The application mutation bridge owns the Naive UI error message.
      return false
    }
  }
  return {
    data,
    failed,
    schemaChanges,
    isPending: mutation.isPending,
    run,
    acceptDefinition,
    sqlSchemaCurrent: computed(
      () => draft.value.definition.mode !== 'sql' || validatedSql.value === sqlKey(),
    ),
  }
}
