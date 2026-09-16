import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datasetApi } from '../src/features/datasets/api.ts'
import { planApi } from '../src/features/plans/api.ts'
import { sourceApi } from '../src/features/sources/api.ts'
import { assetApi } from '../src/features/assets/api.ts'
import { accessApi } from '../src/features/access/api.ts'

test('typed API modules preserve version, scope, reason and export contracts', async () => {
  const calls = []
  const call = async (...args) => {
    calls.push(args)
    return {}
  }
  await planApi(call).save({ expectedVersion: 2, contract: { pollSeconds: 300 } })
  assert.deepEqual(calls.at(-1), [
    'lake/plans',
    { expectedVersion: 2, contract: { pollSeconds: 300 } },
  ])
  await planApi(call).trigger({ plan: 3, day: '2026-09-16', reason: 'synthetic', revision: true })
  assert.deepEqual(calls.at(-1), [
    'lake/plans/3/trigger',
    { day: '2026-09-16', reason: 'synthetic', revision: true },
  ])
  await datasetApi(call, 4).publish(5, 6, 'synthetic review')
  assert.deepEqual(calls.at(-1), [
    'warehouse/projects/4/datasets/5/builds/6/publish',
    { reason: 'synthetic review' },
  ])
  await datasetApi(call, 4).export(5, {
    releaseId: 7,
    columns: ['id'],
    equals: {},
    offset: 0,
    limit: 1,
  })
  assert.equal(calls.at(-1)[2], true)
  await assetApi(call, 4).detail('file/a?b')
  assert.equal(calls.at(-1)[0], 'warehouse/projects/4/assets/file%2Fa%3Fb')
  assert.throws(() => accessApi(call, null).members())
})

test('source pagination consumes every page, including more than 100 sources', async () => {
  const paths = []
  const api = sourceApi(async (path) => {
    paths.push(path)
    return { items: Array.from({ length: paths.length === 1 ? 100 : 15 }, (_, id) => ({ id })) }
  })
  assert.equal((await api.all()).length, 115)
  assert.deepEqual(paths, ['sources?limit=100&offset=0', 'sources?limit=100&offset=100'])
})
