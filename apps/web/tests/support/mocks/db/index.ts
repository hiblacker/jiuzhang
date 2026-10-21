import { openDB, type IDBPDatabase } from 'idb'
import { createSeed, type MockState } from '../fixtures/seed'
import { captureSourceSchemas } from '../model/source-snapshot'
import { mockNow, synchronizeSchedules } from '../model/scheduler'
let connection: Promise<IDBPDatabase> | undefined
export function database() {
  connection ??= openDB('jiuzhang-demo', 1, {
    upgrade(db) {
      db.createObjectStore('state')
    },
  })
  return connection
}
export async function seedReady() {
  const db = await database()
  const tx = db.transaction('state', 'readwrite')
  const state = (await tx.store.get('current')) as MockState | undefined
  if (!state) {
    const seed = createSeed()
    synchronizeSchedules(seed, mockNow(seed))
    await tx.store.put(seed, 'current')
  } else {
    // Upgrade existing demos in place; preserve the user's created resources.
    let changed = false
    if (!state.scheduler) {
      synchronizeSchedules(state, mockNow(state))
      changed = true
    }
    if (!state.favoritesByUser) {
      const owner = state.users.find((user) => user.role === 'admin')?.id ?? '8001'
      state.favoritesByUser = { [owner]: [...(state.favorites ?? [])] }
      delete state.favorites
      changed = true
    }
    if (!state.folders) {
      state.folders = []
      changed = true
    }
    for (const dataset of state.datasets) {
      if (dataset.folderId === undefined) {
        dataset.folderId = null
        changed = true
      }
    }
    for (const table of [
      ...state.tables,
      ...Object.values(state.pendingImports ?? {}).map((pending) => pending.table),
    ]) {
      if (table.subjectDomain === undefined) {
        table.subjectDomain = ''
        changed = true
      }
    }
    if (!state.accessVersion) {
      const owner = state.users.find((user) => user.role === 'admin')?.id ?? '8001'
      for (const role of state.roles) {
        if (['admin', 'developer'].includes(role.id) && !role.permissions.includes('readSensitive'))
          role.permissions.push('readSensitive')
      }
      for (const query of state.queries) query.userId = owner
      for (const item of state.exports) {
        item.userId = owner
        item.columns = [
          ...(state.queries.find((query) => query.id === item.queryId)?.columns ?? []),
        ]
      }
      state.accessVersion = 1
      changed = true
    }
    // Legacy idempotency entries retained request bodies. Discard only this short-lived cache.
    for (const [key, entry] of Object.entries(state.idempotency)) {
      if (!entry.fingerprint.startsWith('sha256:')) {
        delete state.idempotency[key]
        changed = true
      }
    }
    for (const table of [
      ...state.tables,
      ...Object.values(state.pendingImports ?? {}).map((pending) => pending.table),
    ]) {
      if (!table.createdAt) {
        table.createdAt = table.updatedAt
        changed = true
      }
    }
    if (!state.pendingImports) {
      state.pendingImports = {}
      changed = true
    }
    if (!state.pendingExports) {
      state.pendingExports = {}
      changed = true
    }
    for (const item of [...state.imports, ...state.exports]) {
      if (item.progress === undefined) {
        item.progress = 100
        changed = true
      }
    }
    for (const version of state.versions) {
      if (!version.sourceSnapshots) {
        version.sourceSnapshots = captureSourceSchemas(
          state.objects,
          state.sources,
          version.definition,
        )
        version.sourceSnapshotOrigin = 'migrated'
        version.sourceSnapshotCapturedAt = new Date(mockNow(state)).toISOString()
        changed = true
      }
      if (!version.qualitySnapshot) {
        version.qualitySnapshot = structuredClone(
          state.quality.filter((rule) => version.definition.qualityRuleIds.includes(rule.id)),
        )
        version.maskingSnapshot = structuredClone(
          state.masking.filter(
            (rule) =>
              version.definition.maskPolicyIds.includes(rule.id) ||
              version.definition.fields.some((field) => field.maskPolicyId === rule.id),
          ),
        )
        version.upstreamVersion =
          state.datasets.find((dataset) => dataset.id === version.definition.upstreamDatasetId)
            ?.publishedVersion ?? 0
        changed = true
      }
    }
    for (const task of state.tasks) {
      if (task.lastSuccessRunId === undefined) {
        const last = state.runs.find((run) => run.taskId === task.id && run.status === 'succeeded')
        task.lastSuccessRunId = last?.id ?? ''
        task.lastSuccessAt = last?.finishedAt ?? null
        changed = true
      }
    }
    for (const run of state.runs) {
      if (run.scheduleSnapshot === undefined) {
        const version = state.versions.find(
          (version) =>
            version.datasetId === run.datasetId && version.version === run.datasetVersion,
        )
        const task = state.tasks.find((task) => task.id === run.taskId)
        if (task || version) {
          run.scheduleSnapshot = structuredClone(task?.schedule ?? version!.definition.schedule)
          run.businessDate = null
          run.executionStartedAt = run.startedAt
          run.waitReason = ''
          if (['queued', 'running'].includes(run.status)) run.qualityResults = []
          changed = true
        }
      }
    }
    if (changed) await tx.store.put(state, 'current')
  }
  await tx.done
}
export async function readState(): Promise<MockState> {
  await seedReady()
  return (await database()).get('state', 'current')
}
export async function transact<T>(change: (state: MockState) => T): Promise<T> {
  await seedReady()
  const db = await database()
  const tx = db.transaction('state', 'readwrite')
  // Observe completion immediately so a failed request cannot leave an unhandled rejection.
  const done = tx.done
  void done.catch(() => undefined)
  try {
    const state = (await tx.store.get('current')) as MockState
    const result = change(state)
    await tx.store.put(state, 'current')
    await done
    return result
  } catch (error) {
    // IndexedDB may already have aborted; preserve the original failure for the HTTP boundary.
    try {
      tx.abort()
    } catch {}
    await done.catch(() => undefined)
    throw error
  }
}
export async function resetState() {
  await (await database()).put('state', createSeed(), 'current')
}
export function nextId(state: MockState) {
  state.counter++
  return String(state.counter)
}
