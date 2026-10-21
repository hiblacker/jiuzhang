import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, effectScope, ref } from 'vue'
import { MutationCache, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { newDataset } from '@/modules/datasets/model/definition'
import type { DatasetInput } from '@/modules/datasets/api/dataset-repository'
import type { Model } from '@/shared/api/types'
import type { useDatasetDraftPreview as DraftPreviewFactory } from '@/modules/datasets/composables/use-dataset-draft-preview'

const server = setupServer()
const endpoint = 'http://localhost/api/v1/datasets/preview'
const cleanups: (() => void)[] = []
let useDatasetDraftPreview: typeof DraftPreviewFactory
beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost/api/v1')
  ;({ useDatasetDraftPreview } =
    await import('@/modules/datasets/composables/use-dataset-draft-preview'))
  Object.defineProperty(globalThis, 'location', {
    value: new URL('http://localhost'),
    configurable: true,
  })
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  server.resetHandlers()
})
afterAll(() => {
  vi.unstubAllEnvs()
  server.close()
  Reflect.deleteProperty(globalThis, 'location')
})
const field: Model<'Field'> = {
  name: 'amount',
  target: 'amount',
  type: 'decimal(12,4)',
  nullable: true,
  output: true,
  sensitive: false,
  maskPolicyId: '',
  description: '',
}
function session() {
  const errorMessage = vi.fn()
  const client = new QueryClient({
    mutationCache: new MutationCache({ onError: errorMessage }),
    defaultOptions: { mutations: { retry: false } },
  })
  const app = createApp({}).use(VueQueryPlugin, { queryClient: client })
  const scope = effectScope()
  const draft = ref(newDataset())
  Object.assign(draft.value.definition, {
    mode: 'sql',
    sourceId: '1001',
    sql: 'SELECT amount FROM orders',
  })
  const preview = app.runWithContext(() => scope.run(() => useDatasetDraftPreview(draft, ''))!)
  cleanups.push(() => {
    scope.stop()
    client.clear()
  })
  return { draft, preview, errorMessage }
}
function reply(input: DatasetInput) {
  const fields = input.definition.fields.length ? input.definition.fields : [field]
  return HttpResponse.json({
    data: { fields, rows: [{ [fields[0]!.target]: '12345.6700' }], notes: [] },
  })
}
describe('dataset definition followed by processing at the HTTP boundary', () => {
  it('runs only raw SQL first, isolates downstream rules, then previews the configured output', async () => {
    const requests: DatasetInput[] = []
    server.use(
      http.post(endpoint, async ({ request }) => {
        const input = (await request.json()) as DatasetInput
        requests.push(input)
        return reply(input)
      }),
    )
    const { draft, preview, errorMessage } = session()
    draft.value.definition.fields = [{ ...field, target: 'revenue', maskPolicyId: '6001' }]
    draft.value.definition.cleaning = ['trim']
    draft.value.definition.maskPolicyIds = ['6001']
    draft.value.definition.qualityRuleIds = ['5001']
    expect(await preview.run()).toBe(false)
    const running = preview.define()
    expect(await preview.define()).toBe(false)
    expect(await running).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.name).toBe('')
    expect(requests[0]!.definition).toMatchObject({
      fields: [],
      cleaning: [],
      maskPolicyIds: [],
      qualityRuleIds: [],
    })
    expect(preview.definitionData.value?.rows[0]?.amount).toBe('12345.6700')
    expect(preview.data.value).toBeUndefined()
    expect(draft.value.definition.fields[0]).toMatchObject({
      target: 'revenue',
      maskPolicyId: '6001',
    })
    expect(await preview.run()).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.definition).toMatchObject({
      cleaning: ['trim'],
      maskPolicyIds: ['6001'],
      qualityRuleIds: ['5001'],
    })
    expect(preview.data.value?.rows[0]?.revenue).toBe('12345.6700')
    draft.value.name = 'new name'
    draft.value.definition.deliveryMode = 'direct'
    expect(preview.data.value).toBeDefined()
    draft.value.definition.cleaning = []
    expect(preview.data.value).toBeUndefined()
    expect(preview.definitionData.value).toBeDefined()
    expect(preview.definitionCurrent.value).toBe(true)
    expect(errorMessage).not.toHaveBeenCalled()
  })
  it('invalidates both stages after SQL changes and reconciles compatible mappings on rerun', async () => {
    let changed = false
    server.use(
      http.post(endpoint, async ({ request }) => {
        const input = (await request.json()) as DatasetInput
        if (changed && !input.definition.fields.length)
          return HttpResponse.json({
            data: { fields: [{ ...field, name: 'total', target: 'total' }], rows: [], notes: [] },
          })
        return reply(input)
      }),
    )
    const { draft, preview } = session()
    expect(await preview.define()).toBe(true)
    draft.value.definition.fields[0]!.target = 'revenue'
    expect(await preview.run()).toBe(true)
    draft.value.definition.sql = 'SELECT SUM(amount) AS total FROM orders'
    expect(preview.definitionCurrent.value).toBe(false)
    expect(preview.definitionData.value).toBeUndefined()
    expect(preview.data.value).toBeUndefined()
    expect(await preview.run()).toBe(false)
    changed = true
    expect(await preview.define()).toBe(true)
    expect(preview.definitionCurrent.value).toBe(true)
    expect(draft.value.definition.fields[0]?.target).toBe('total')
    expect(preview.schemaChanges.value).toMatchObject({ added: ['total'], removed: ['amount'] })
    expect(preview.definitionData.value?.rows).toEqual([])
  })
  it('keeps the draft on raw failure, and keeps confirmed input on processing failure with one message per request', async () => {
    const { draft, preview, errorMessage } = session()
    draft.value.definition.fields = [{ ...field, target: 'revenue' }]
    const failure = () =>
      HttpResponse.json(
        { error: { code: 'SQL_EXECUTION_FAILED', requestId: 'test' } },
        { status: 422 },
      )
    server.use(http.post(endpoint, failure))
    expect(await preview.define()).toBe(false)
    expect(preview.definitionFailed.value).toBe(true)
    expect(errorMessage).toHaveBeenCalledTimes(1)
    expect(draft.value.definition.fields[0]?.target).toBe('revenue')
    server.use(
      http.post(endpoint, async ({ request }) => reply((await request.json()) as DatasetInput)),
    )
    expect(await preview.define()).toBe(true)
    server.use(http.post(endpoint, failure))
    expect(await preview.run()).toBe(false)
    expect(preview.failed.value).toBe(true)
    expect(preview.definitionCurrent.value).toBe(true)
    expect(preview.definitionData.value).toBeDefined()
    expect(preview.data.value).toBeUndefined()
    expect(errorMessage).toHaveBeenCalledTimes(2)
    server.use(
      http.post(endpoint, async ({ request }) => reply((await request.json()) as DatasetInput)),
    )
    expect(await preview.run()).toBe(true)
    expect(preview.failed.value).toBe(false)
  })
  it('ignores a completed raw response after changing source', async () => {
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    let started = false
    server.use(
      http.post(endpoint, async ({ request }) => {
        const input = (await request.json()) as DatasetInput
        started = true
        await gate
        return reply(input)
      }),
    )
    const { draft, preview } = session()
    const running = preview.define()
    await vi.waitFor(() => expect(started).toBe(true))
    draft.value.definition.sourceId = '1002'
    draft.value.definition.fields = []
    finish()
    expect(await running).toBe(false)
    expect(preview.definitionData.value).toBeUndefined()
    expect(draft.value.definition.fields).toEqual([])
    expect(preview.definitionCurrent.value).toBe(false)
  })
  it('ignores stale processing results while retaining the confirmed definition', async () => {
    server.use(
      http.post(endpoint, async ({ request }) => reply((await request.json()) as DatasetInput)),
    )
    const { draft, preview } = session()
    await preview.define()
    let finish!: () => void
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    let started = false
    server.use(
      http.post(endpoint, async ({ request }) => {
        const input = (await request.json()) as DatasetInput
        started = true
        await gate
        return reply(input)
      }),
    )
    const running = preview.run()
    await vi.waitFor(() => expect(started).toBe(true))
    draft.value.definition.fields[0]!.target = 'changed'
    finish()
    expect(await running).toBe(false)
    expect(preview.data.value).toBeUndefined()
    expect(preview.definitionCurrent.value).toBe(true)
  })
  it('reads a selected table with identity fields before applying visual processing', async () => {
    const requests: DatasetInput[] = []
    server.use(
      http.post(endpoint, async ({ request }) => {
        const input = (await request.json()) as DatasetInput
        requests.push(input)
        return reply(input)
      }),
    )
    const { draft, preview } = session()
    Object.assign(draft.value.definition, {
      mode: 'visual',
      objectId: 'table-1',
      fields: [{ ...field, target: 'revenue', sensitive: true }],
      cleaning: ['trim'],
    })
    expect(await preview.define([field])).toBe(true)
    expect(requests[0]!.definition.fields[0]).toMatchObject({
      target: 'amount',
      sensitive: false,
      maskPolicyId: '',
    })
    expect(requests[0]!.definition.cleaning).toEqual([])
    expect(draft.value.definition.fields[0]).toMatchObject({ target: 'revenue', sensitive: true })
    expect(await preview.run()).toBe(true)
    expect(requests[1]!.definition.fields[0]?.target).toBe('revenue')
  })
})
