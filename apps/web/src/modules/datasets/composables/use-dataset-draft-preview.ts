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
import { reconcileSqlFields, sourceFieldType, toInput } from '../model/definition'

/** Definition and processing have separate results and validity within one editing session. */
export function useDatasetDraftPreview(draft: Ref<DatasetInput>, id: MaybeRefOrGetter<string>) {
  const definitionData = shallowRef<Model<'Preview'>>()
  const data = shallowRef<Model<'Preview'>>()
  const definitionFailed = ref(false)
  const failed = ref(false)
  const schemaChanges = shallowRef<{ added: string[]; removed: string[] }>()
  const confirmedDefinition = ref('')
  const definitionKey = () => {
    const { sourceId, objectId, upstreamDatasetId, mode, sql } = draft.value.definition
    return JSON.stringify([toValue(id), sourceId, objectId, upstreamDatasetId, mode, sql])
  }
  const definitionCurrent = computed(() => confirmedDefinition.value === definitionKey())
  let definitionRevision = 0
  let processingRevision = 0
  let inFlight = false
  onScopeDispose(() => {
    definitionRevision++
    processingRevision++
  })
  watch(
    definitionKey,
    () => {
      definitionRevision++
      confirmedDefinition.value = ''
      definitionData.value = undefined
      definitionFailed.value = false
      schemaChanges.value = undefined
    },
    { flush: 'sync' },
  )
  watch(
    () => {
      const { fields, nodes, edges, cleaning, qualityRuleIds, maskPolicyIds } =
        draft.value.definition
      return JSON.stringify([
        definitionKey(),
        fields,
        nodes,
        edges,
        cleaning,
        qualityRuleIds,
        maskPolicyIds,
      ])
    },
    () => {
      processingRevision++
      data.value = undefined
      failed.value = false
    },
    { flush: 'sync' },
  )
  function acceptDefinition() {
    confirmedDefinition.value = definitionKey()
  }
  const mutation = useMutation({
    mutationFn: async (request: {
      kind: 'definition' | 'processing'
      input: DatasetInput
      revision: number
    }) => datasetRepository.preview(request.input),
    onSuccess: (result, request) => {
      if (request.kind === 'definition') {
        if (request.revision !== definitionRevision) return
        const reconciled = reconcileSqlFields(draft.value.definition.fields, result.fields)
        draft.value.definition.fields = reconciled.fields
        acceptDefinition()
        definitionData.value = result
        schemaChanges.value = reconciled
      } else if (request.revision === processingRevision && definitionCurrent.value) {
        data.value = result
      }
    },
    onError: (_error, request) => {
      if (request.kind === 'definition' && request.revision === definitionRevision)
        definitionFailed.value = true
      if (request.kind === 'processing' && request.revision === processingRevision)
        failed.value = true
    },
  })
  async function execute(kind: 'definition' | 'processing', input: DatasetInput) {
    inFlight = true
    try {
      await mutation.mutateAsync({
        kind,
        input,
        revision: kind === 'definition' ? definitionRevision : processingRevision,
      })
      return kind === 'definition' ? !!definitionData.value : !!data.value
    } catch {
      // The application mutation bridge owns the Naive UI error message.
      return false
    } finally {
      inFlight = false
    }
  }
  async function define(sourceFields: Model<'Field'>[] = []) {
    if (inFlight) return false
    definitionData.value = undefined
    definitionFailed.value = false
    schemaChanges.value = undefined
    confirmedDefinition.value = ''
    data.value = undefined
    failed.value = false
    const input = toInput(draft.value)
    // Fetching is independent of downstream mappings, cleaning, graph and governance.
    input.definition.fields =
      input.definition.mode === 'sql'
        ? []
        : sourceFields.map((field) => ({
            ...field,
            target: field.name,
            type: sourceFieldType(field.type),
            output: true,
            sensitive: false,
            maskPolicyId: '',
          }))
    input.definition.nodes = [{ id: 'input', type: 'input', label: '', x: 0, y: 0, config: '' }]
    input.definition.edges = []
    input.definition.cleaning = []
    input.definition.qualityRuleIds = []
    input.definition.maskPolicyIds = []
    return execute('definition', input)
  }
  async function run() {
    if (
      inFlight ||
      !definitionCurrent.value ||
      !draft.value.definition.fields.some((field) => field.output)
    )
      return false
    data.value = undefined
    failed.value = false
    return execute('processing', toInput(draft.value))
  }
  return {
    definitionData,
    data,
    definitionFailed,
    failed,
    schemaChanges,
    definitionCurrent,
    isPending: mutation.isPending,
    define,
    run,
    acceptDefinition,
  }
}
