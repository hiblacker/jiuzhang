import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia } from 'pinia'
import { effectScope } from 'vue'
import { createConsoleContext } from '../src/app/context.ts'
import { useApi } from '../src/shared/composables/useApi.ts'

const rows = [
  { id: 1, code: 'one', name: 'One', role: 'OWNER' },
  { id: 2, code: 'two', name: 'Two', role: 'VIEWER' },
]
const credential = 'synthetic-state-test-only'
const response = value =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })

test('shared stores derive permissions and credentials never enter Pinia state', async () => {
  const pinia = createPinia()
  const context = createConsoleContext(pinia, async () => response(rows))
  await context.connect('http://localhost:18080', credential, 'project')
  assert.equal(context.session.connected, true)
  assert.equal(context.projects.owner, true)
  context.projects.select(2)
  assert.equal(context.projects.engineer, false)
  assert.throws(() => context.projects.select(99))
  assert.equal(JSON.stringify(pinia.state.value).includes(credential), false)
  context.disconnect()
  assert.equal(context.projects.projectId, null)
  assert.deepEqual(context.projects.projects, [])
  assert.equal(context.session.connected, false)
})

test('late failed connection cannot disconnect a newer session', async () => {
  let rejectOld
  let count = 0
  const context = createConsoleContext(createPinia(), async () => {
    if (++count === 1) {
      return new Promise((_resolve, reject) => {
        rejectOld = reject
      })
    }
    return response(rows)
  })
  const old = context.connect('http://localhost:18080', 'synthetic-old', 'admin')
  const rejected = assert.rejects(old)
  await context.connect('http://localhost:18080', 'synthetic-new', 'project')
  rejectOld(new TypeError('old network failed'))
  await rejected
  assert.equal(context.session.connected, true)
  assert.equal(context.session.mode, 'project')
})

test('logout and stale project loads cannot restore shared scope', async () => {
  let resolveLoad
  let count = 0
  const context = createConsoleContext(createPinia(), async () => {
    if (++count === 1) {
      return response(rows)
    }
    return new Promise((resolve) => {
      resolveLoad = resolve
    })
  })
  await context.connect('http://localhost:18080', credential, 'project')
  const pending = context.loadProjects()
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  context.disconnect()
  resolveLoad(response(rows))
  await rejected
  assert.deepEqual(context.projects.projects, [])
})

test('project refresh uses newest response and role changes invalidate the scope', async () => {
  const pending = []
  let count = 0
  const context = createConsoleContext(createPinia(), async () => {
    if (++count === 1) {
      return response(rows)
    }
    return new Promise(resolve => pending.push(resolve))
  })
  await context.connect('http://localhost:18080', credential, 'project')
  const generation = context.projects.generation
  const old = context.loadProjects()
  const current = context.loadProjects()
  pending[1](response([{ ...rows[0], role: 'VIEWER' }]))
  await current
  pending[0](response(rows))
  await old
  assert.equal(context.projects.owner, false)
  assert.ok(context.projects.generation > generation)
})

test('page requests abort synchronously on project switch and cannot commit delayed JSON', async () => {
  let finish
  let signal
  const context = createConsoleContext(createPinia(), async (url, options) => {
    if (url.endsWith('/warehouse/projects')) {
      return response(rows)
    }
    signal = options.signal
    return {
      ok: true,
      json: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    }
  })
  await context.connect('http://localhost:18080', credential, 'project')
  const scope = effectScope()
  const api = scope.run(() => useApi(context))
  let committed = false
  const pending = api.run(async () => {
    await api.call('warehouse/projects/1/assets')
    committed = true
  })
  await Promise.resolve()
  context.projects.select(2)
  assert.equal(signal.aborted, true)
  finish([])
  await pending
  assert.equal(committed, false)
  assert.equal(api.error.value, '')
  assert.equal(api.loading.value, false)
  scope.stop()
})

test('independent Pinia instances cannot share session or project state', async () => {
  const first = createConsoleContext(createPinia(), async () => response(rows))
  const second = createConsoleContext(createPinia(), async () => response([]))
  await first.connect('http://localhost:18080', credential, 'admin')
  assert.equal(second.session.connected, false)
  assert.equal(second.projects.projectId, null)
  second.disconnect()
  assert.equal(first.session.connected, true)
})
