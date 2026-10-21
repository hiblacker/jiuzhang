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
describe('dataset draft SQL preview at the HTTP boundary', () => {
  it('discovers schema without metadata, applies existing mappings, prevents duplicate runs and invalidates edited results', async () => {
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
    const running = preview.run()
    await vi.waitFor(() => expect(preview.isPending.value).toBe(true))
    expect(await preview.run()).toBe(false)
    const completed = await running
    expect(errorMessage.mock.calls.map((call) => String(call[0]))).toEqual([])
    expect(completed).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0]!.name).toBe('')
    expect(requests[0]!.definition.fields).toEqual([])
    expect(requests[1]!.definition.fields[0]).toMatchObject({
      target: 'revenue',
      maskPolicyId: '6001',
    })
    expect(preview.data.value?.rows[0]?.revenue).toBe('12345.6700')
    draft.value.name = 'new name'
    draft.value.definition.deliveryMode = 'direct'
    expect(preview.data.value).toBeDefined()
    draft.value.definition.cleaning = ['trim']
    expect(preview.data.value).toBeUndefined()
  })
  it('keeps the draft and mapping on failure and reports one mutation error before retry', async () => {
    server.use(
      http.post(endpoint, () =>
        HttpResponse.json(
          { error: { code: 'SQL_EXECUTION_FAILED', requestId: 'test' } },
          { status: 422 },
        ),
      ),
    )
    const { draft, preview, errorMessage } = session()
    draft.value.definition.fields = [{ ...field, target: 'revenue' }]
    expect(await preview.run()).toBe(false)
    expect(preview.failed.value).toBe(true)
    expect(errorMessage).toHaveBeenCalledTimes(1)
    expect(draft.value.definition.fields[0]?.target).toBe('revenue')
    server.use(
      http.post(endpoint, async ({ request }) => reply((await request.json()) as DatasetInput)),
    )
    expect(await preview.run()).toBe(true)
    expect(preview.failed.value).toBe(false)
    expect(preview.sqlSchemaCurrent.value).toBe(true)
  })
  it('ignores a completed response after changing source and invalidates source-specific schema', async () => {
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
    const running = preview.run()
    await vi.waitFor(() => expect(started).toBe(true))
    draft.value.definition.sourceId = '1002'
    draft.value.definition.fields = []
    finish()
    expect(await running).toBe(false)
    expect(preview.data.value).toBeUndefined()
    expect(draft.value.definition.fields).toEqual([])
    expect(preview.sqlSchemaCurrent.value).toBe(false)
  })
})
