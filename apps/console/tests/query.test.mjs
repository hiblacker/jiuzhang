import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectScope } from 'vue'
import { useDatasetQuery } from '../src/features/datasets/useDatasetQuery.ts'

const input = () => ({ equals: { id: '001' }, columns: ['id', 'amount'], offset: 0, limit: 1 })
const result = body => ({
  datasetId: 1,
  releaseId: 7,
  policyRevision: 2,
  columns: ['id', 'amount'],
  rows: [{ id: '001', amount: '1234567890123456.78' }],
  limit: body.limit,
  offset: body.offset,
})

test('query snapshot is detached from the draft and reused for pages and exports', async () => {
  const calls = []
  const scope = effectScope()
  const api = {
    query: async (id, body) => {
      calls.push({ id, body })
      return result(body)
    },
    export: async (id, body) => {
      calls.push({ id, body })
      return new Blob(['synthetic csv'])
    },
  }
  const query = scope.run(() => useDatasetQuery(api, 1))
  const draft = input()
  await query.query(draft)
  draft.equals.id = 'edited-not-submitted'
  draft.columns.length = 0
  draft.releaseId = 99
  await query.page(1)
  const file = await query.exportPage()
  assert.deepEqual(calls[1].body, { ...input(), offset: 1, releaseId: 7 })
  assert.deepEqual(calls[2].body, calls[1].body)
  assert.equal(file.filename, 'dataset-1-release-7.csv')
  assert.equal(query.result.value.rows[0].amount, '1234567890123456.78')
  scope.stop()
  assert.equal(query.result.value, null)
})

test('disposal rejects late query and late export results even if an API ignores cancellation', async () => {
  let finishQuery
  const scope = effectScope()
  const query = scope.run(() =>
    useDatasetQuery(
      {
        query: () =>
          new Promise((resolve) => {
            finishQuery = resolve
          }),
        export: async () => new Blob(),
      },
      1,
    ),
  )
  const pending = query.query(input())
  scope.stop()
  finishQuery(result(input()))
  await pending
  assert.equal(query.result.value, null)

  let finishExport
  const secondScope = effectScope()
  const second = secondScope.run(() =>
    useDatasetQuery(
      {
        query: async () => result(input()),
        export: () =>
          new Promise((resolve) => {
            finishExport = resolve
          }),
      },
      1,
    ),
  )
  await second.query(input())
  const download = second.exportPage()
  secondScope.stop()
  finishExport(new Blob(['synthetic']))
  assert.equal(await download, undefined)
})

test('failed pagination keeps the displayed page and its export request together', async () => {
  let count = 0
  let exported
  const scope = effectScope()
  const query = scope.run(() =>
    useDatasetQuery(
      {
        query: async (_id, body) => {
          if (++count > 1) {
            throw new Error('synthetic failure')
          }
          return result(body)
        },
        export: async (_id, body) => {
          exported = body
          return new Blob()
        },
      },
      1,
    ),
  )
  await query.query(input())
  await assert.rejects(query.page(1))
  await query.exportPage()
  assert.equal(query.result.value.offset, 0)
  assert.equal(exported.offset, 0)
  assert.equal(query.loading.value, false)
  scope.stop()
})

test('new query invalidates old results and duplicate submits do not create duplicate requests', async () => {
  let finish
  let count = 0
  const scope = effectScope()
  const query = scope.run(() =>
    useDatasetQuery(
      {
        query: () => {
          count++
          return new Promise((resolve) => {
            finish = resolve
          })
        },
        export: async () => new Blob(),
      },
      1,
    ),
  )
  const first = query.query(input())
  await query.query(input())
  assert.equal(count, 1)
  finish(result(input()))
  await first
  query.reset()
  assert.equal(query.result.value, null)
  assert.equal(await query.exportPage(), undefined)
  scope.stop()
})
