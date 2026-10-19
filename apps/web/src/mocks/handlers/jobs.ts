import type { Model } from '@/shared/api/types'
import type { MockState } from '../fixtures/seed'
import { nextId } from '../db'
import { route, ensure, find, audit, MockError } from './core'
import { datasetPreview } from './datasets'
import { mergeOutput } from '../model/dataset-runtime'
import { admissionReason, terminalRun } from '../model/run-admission'
import { scheduleIssues } from '../model/schedule'
import { mockNow, synchronizeSchedules, visibleTask, visibleRun } from '../model/scheduler'
import { nextScheduleTimes } from '@/shared/lib/schedule-time'

function finishRun(
  state: MockState,
  run: Model<'Run'>,
  status: 'failed' | 'blocked' | 'succeeded',
  now: number,
  code = '',
) {
  run.status = status
  run.finishedAt = new Date(now).toISOString()
  run.durationMs = Math.max(0, now - Date.parse(run.startedAt))
  run.errorCode = code
  run.waitReason = ''
  ;(run as Model<'Run'> & { retryAt?: string | null }).retryAt =
    status === 'failed' && (run.retryAttempt ?? 0) < run.scheduleSnapshot.retries
      ? new Date(now + 5000).toISOString()
      : null
  audit(state, 'worker-demo', status, 'runs', run.id, run.logs.at(-1))
}

function setRunStage(
  state: MockState,
  run: Model<'Run'>,
  status: 'queued' | 'running' | 'validating' | 'publishing',
) {
  if (run.status === status) return
  audit(state, 'worker-demo', status, 'runs', run.id, run.status + ' → ' + status)
  run.status = status
}
export function advanceRuns(state: MockState, now = mockNow(state)) {
  const ordered = [...state.runs].sort(
    (a, b) =>
      Date.parse(a.startedAt) - Date.parse(b.startedAt) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
  )
  for (const run of ordered) {
    if (terminalRun(run)) continue
    run.durationMs = Math.max(0, now - Date.parse(run.startedAt))
    const deadline = Date.parse(run.startedAt) + run.scheduleSnapshot.timeoutSeconds * 1000
    if (
      now >= deadline &&
      (run.executionStartedAt === null || Date.parse(run.executionStartedAt) + 5500 > deadline)
    ) {
      run.logs.push('模拟 SLA 超时（含排队时间），未发布')
      finishRun(state, run, 'failed', deadline, 'SLA_TIMEOUT')
      continue
    }
    if (run.executionStartedAt === null) {
      run.waitReason = admissionReason(state, run)
      if (run.waitReason) continue
      run.executionStartedAt = new Date(now).toISOString()
      run.logs.push('依赖与并发条件已满足，开始执行')
    }
    const elapsed = now - Date.parse(run.executionStartedAt)
    if (elapsed < 1500) {
      setRunStage(state, run, 'queued')
      continue
    }
    if (elapsed < 3500) {
      setRunStage(state, run, 'running')
      continue
    }
    if (elapsed < 5500) {
      setRunStage(state, run, 'validating')
      continue
    }
    if (run.outcome !== 'succeeded') {
      if (run.outcome === 'blocked') {
        const version = state.versions.find(
          (v) => v.datasetId === run.datasetId && v.version === run.datasetVersion,
        )
        run.qualityResults = (version?.qualitySnapshot ?? [])
          .filter((rule) => rule.enabled)
          .map((rule) => ({
            ruleId: rule.id,
            version: rule.version,
            result: 'BLOCK' as const,
            message: '显式模拟质量阻断',
          }))
      }
      run.logs.push(
        run.outcome === 'blocked' ? '质量检查 BLOCK，未写入仓库' : '模拟源端读取失败，未发布',
      )
      finishRun(
        state,
        run,
        run.outcome,
        Date.parse(run.executionStartedAt) + 5500,
        run.outcome === 'blocked' ? 'QUALITY_BLOCK' : 'DEMO_READ_FAILURE',
      )
      continue
    }
    try {
      const dataset = find(state.datasets, run.datasetId)
      const version = state.versions.find(
        (v) => v.datasetId === run.datasetId && v.version === run.datasetVersion,
      )
      ensure(version, 409, 'VERSION_CONFLICT', '运行版本不存在')
      const preview = datasetPreview(
        state,
        version.definition,
        version,
        [],
        Date.parse(run.executionStartedAt) + 5500,
      )
      run.qualityResults = (preview.qualityResults ?? []).map(
        ({ ruleId, version, result, message }) => ({ ruleId, version, result, message }),
      )
      if (run.qualityResults.some((result) => result.result === 'BLOCK')) {
        run.logs.push('样本质量规则阻断，仓库未写入，成功游标未推进')
        finishRun(state, run, 'blocked', Date.parse(run.executionStartedAt) + 5500, 'QUALITY_BLOCK')
        continue
      }
      if (now >= deadline && Date.parse(run.executionStartedAt) + 7500 > deadline) {
        run.logs.push('模拟发布阶段 SLA 超时，未写入仓库')
        finishRun(state, run, 'failed', deadline, 'SLA_TIMEOUT')
        continue
      }
      if (elapsed < 7500) {
        setRunStage(state, run, 'publishing')
        continue
      }

      let table = state.tables.find((t) => t.name === version.definition.output.table)
      const rows = mergeOutput(table?.sample ?? [], preview.rows, version.definition.output)
      if (!table) {
        table = {
          id: nextId(state),
          name: version.definition.output.table,
          description: dataset.description,
          createdAt: new Date(now).toISOString(),
          owner: dataset.owner,
          tags: dataset.tags,
          updatedAt: new Date(now).toISOString(),
          layer: version.definition.output.layer,
          subjectDomain: version.definition.output.subjectDomain?.trim() ?? '',
          datasetId: dataset.id,
          datasetVersion: version.version,
          sourceId: version.definition.sourceId,
          rowCount: String(rows.length),
          fields: preview.fields,
          sample: rows,
          partitions: [run.businessDate ?? new Date(now).toISOString().slice(0, 10)],
          version: 1,
        }
        state.tables.unshift(table)
      } else {
        table.fields = preview.fields
        table.sample = rows
        table.rowCount = String(rows.length)
        table.datasetId = dataset.id
        table.sourceId = version.definition.sourceId
        table.layer = version.definition.output.layer
        table.subjectDomain = version.definition.output.subjectDomain?.trim() ?? ''
        table.datasetVersion = version.version
        table.version++
        table.updatedAt = new Date(now).toISOString()
        const partition = run.businessDate ?? new Date(now).toISOString().slice(0, 10)
        if (!table.partitions.includes(partition)) table.partitions.push(partition)
      }
      run.logs.push('读取样本完成', '字段与脱敏处理完成', '模拟发布完成，输出表 ' + table.name)
      finishRun(state, run, 'succeeded', Date.parse(run.executionStartedAt) + 7500)
      run.outputTableId = table.id
      run.rowCount = String(preview.rows.length)
      const task = state.tasks.find((task) => task.id === run.taskId)
      if (task) {
        task.lastSuccessRunId = run.id
        task.lastSuccessAt = run.finishedAt
      }
      audit(
        state,
        'worker-demo',
        'publish',
        'warehouse',
        table.id,
        '运行 ' + run.id + ' 完成模拟入仓',
      )
    } catch (error) {
      run.logs.push('发布失败：' + (error instanceof Error ? error.message : '无法完成样本变换'))
      finishRun(state, run, 'failed', now, 'PUBLICATION_FAILED')
    }
  }
}
export function createRun(
  state: MockState,
  datasetId: string,
  outcome: Model<'RunOutcome'>,
  trigger: Model<'Run'>['trigger'],
  now: string,
  retryOf = '',
  businessDate: string | null = null,
  retryMode: 'manual' | 'automatic' = 'manual',
): Model<'Run'> {
  const d = find(state.datasets, datasetId)
  ensure(d.publishedVersion > 0, 409, 'VERSION_CONFLICT', '请先发布数据集版本')
  const previous = retryOf ? find(state.runs, retryOf) : undefined
  const version = previous?.datasetVersion ?? d.publishedVersion
  const task = state.tasks.find((t) => t.datasetId === d.id)
  const published = state.versions.find((v) => v.datasetId === d.id && v.version === version)
  ensure(published, 409, 'VERSION_CONFLICT', '运行版本不存在')
  const run: Model<'Run'> = {
    id: nextId(state),
    datasetId: d.id,
    datasetVersion: version,
    taskId: task?.id ?? '',
    retryOf,
    retryMode,
    retryAttempt: retryMode === 'automatic' ? (previous?.retryAttempt ?? 0) + 1 : 0,
    retryAt: null,
    status: 'queued',
    outcome,
    trigger,
    businessDate: previous?.businessDate ?? businessDate,
    scheduleSnapshot: structuredClone(
      previous?.scheduleSnapshot ?? task?.schedule ?? published.definition.schedule,
    ),
    executionStartedAt: null,
    waitReason: '',
    startedAt: now,
    finishedAt: null,
    durationMs: 0,
    outputTableId: '',
    rowCount: '0',
    logs: ['已创建模拟运行，绑定版本 v' + version],
    qualityResults: [],
    errorCode: '',
  }
  run.waitReason = admissionReason(state, run)
  if (!run.waitReason) run.executionStartedAt = now
  if (run.businessDate)
    run.logs.push('补数业务日期：' + run.businessDate + ' · ' + run.scheduleSnapshot.timezone)
  state.runs.unshift(run)
  return run
}

/** One overdue occurrence per task; missed slots are skipped, never replayed as fake history. */
export function advanceJobs(state: MockState, now = mockNow(state)) {
  synchronizeSchedules(state, now)
  const beforeRuns = new Map(
    state.runs.map((run) => [
      run.id,
      JSON.stringify([
        run.status,
        run.finishedAt,
        run.executionStartedAt,
        run.retryAt,
        run.outputTableId,
        run.rowCount,
        run.waitReason,
        run.durationMs,
      ]),
    ]),
  )
  advanceRuns(state, now)
  let retryRuns = 0,
    scheduledRuns = 0
  for (const failed of [...state.runs]) {
    if (failed.status !== 'failed' || !failed.retryAt || Date.parse(failed.retryAt) > now) continue
    if (!state.tasks.some((task) => task.id === failed.taskId && task.enabled)) continue
    if (state.runs.some((run) => run.retryOf === failed.id)) continue
    if ((failed.retryAttempt ?? 0) >= failed.scheduleSnapshot.retries) continue
    const retry = createRun(
      state,
      failed.datasetId,
      failed.outcome,
      'retry',
      new Date(now).toISOString(),
      failed.id,
      null,
      'automatic',
    )
    retry.logs.push(
      '自动重试 ' +
        retry.retryAttempt +
        '/' +
        retry.scheduleSnapshot.retries +
        '；保留原版本与业务日期',
    )
    audit(state, 'scheduler-demo', 'retry', 'runs', retry.id, '重试运行 ' + failed.id)
    retryRuns++
  }
  for (const task of state.tasks) {
    const cursor = state.scheduler!.cursors[task.id]
    if (!task.enabled || !cursor?.nextAt || Date.parse(cursor.nextAt) > now) continue
    const scheduledAt = cursor.nextAt
    const run = createRun(
      state,
      task.datasetId,
      'succeeded',
      'schedule',
      new Date(now).toISOString(),
    )
    run.logs.push('模拟计划时间：' + scheduledAt + '；离线错过的其他时刻已跳过，可手动补数')
    cursor.nextAt = nextScheduleTimes(task.schedule, now, 1).dates[0] ?? null
    audit(state, 'scheduler-demo', 'schedule', 'runs', run.id, '计划时间 ' + scheduledAt)
    scheduledRuns++
  }
  const changed =
    scheduledRuns > 0 ||
    retryRuns > 0 ||
    state.runs.some(
      (run) =>
        beforeRuns.get(run.id) !==
        JSON.stringify([
          run.status,
          run.finishedAt,
          run.executionStartedAt,
          run.retryAt,
          run.outputTableId,
          run.rowCount,
          run.waitReason,
          run.durationMs,
        ]),
    )
  return { now: new Date(now).toISOString(), scheduledRuns, retryRuns, changed }
}
function checkSchedule(state: MockState, id: string, s: Model<'Schedule'>) {
  const issues = scheduleIssues(state, id, s)
  if (issues.length) throw new MockError(422, 'VALIDATION_ERROR', '调度配置无效', issues)
}
export const jobHandlers = [
  route(
    'get',
    '/tasks',
    ({ state, url }) => {
      advanceJobs(state)
      const excludedId = url.searchParams.get('excludeId')
      const excludedDatasetId = url.searchParams.get('excludeDatasetId')
      return state.tasks
        .filter((task) => task.id !== excludedId && task.datasetId !== excludedDatasetId)
        .map((task) => visibleTask(state, task))
    },
    { list: true },
  ),
  route('get', '/tasks/{id}', ({ state, params }) => {
    advanceJobs(state)
    return visibleTask(state, find(state.tasks, params.id))
  }),
  route(
    'patch',
    '/tasks/{id}',
    ({ state, params, body, now }) => {
      const task = find(state.tasks, params.id)
      const input = { ...task, ...(body as Model<'TaskInputPatch'>) }
      ensure(input.name.trim(), 422, 'VALIDATION_ERROR', '请填写任务名称')
      checkSchedule(state, task.id, input.schedule)
      Object.assign(task, input, { updatedAt: now })
      synchronizeSchedules(state, Date.parse(now))
      return visibleTask(state, task)
    },
    { input: 'TaskInput' },
  ),
  ...(['pause', 'resume'] as const).map((action) =>
    route('post', '/tasks/{id}/' + action, ({ state, params }) => {
      const task = find(state.tasks, params.id)
      task.enabled = action === 'resume'
      synchronizeSchedules(state, mockNow(state))
      return visibleTask(state, task)
    }),
  ),
  route(
    'post',
    '/tasks/{id}/runs',
    ({ state, params, body, now }) =>
      createRun(
        state,
        find(state.tasks, params.id).datasetId,
        (body as Model<'RunInput'>).outcome ?? 'succeeded',
        'manual',
        now,
      ),
    { input: 'RunInput', created: true },
  ),
  route(
    'post',
    '/tasks/{id}/backfills',
    ({ state, params, body, now }) => {
      const input = body as Model<'BackfillInput'>
      const from = Date.parse(input.from),
        to = Date.parse(input.to)
      ensure(
        Number.isFinite(from) && Number.isFinite(to) && to >= from && (to - from) / 86400000 <= 30,
        422,
        'VALIDATION_ERROR',
        '补数范围最多 31 天',
      )
      return Array.from({ length: Math.floor((to - from) / 86400000) + 1 }, (_, index) =>
        createRun(
          state,
          find(state.tasks, params.id).datasetId,
          input.outcome ?? 'succeeded',
          'backfill',
          now,
          '',
          new Date(from + index * 86400000).toISOString().slice(0, 10),
        ),
      )
    },
    { input: 'BackfillInput', created: true },
  ),
  route(
    'post',
    '/datasets/{id}/runs',
    ({ state, params, body, now }) =>
      createRun(
        state,
        String(params.id),
        (body as Model<'RunInput'>).outcome ?? 'succeeded',
        'manual',
        now,
      ),
    { input: 'RunInput', created: true },
  ),
  route(
    'get',
    '/runs',
    ({ state, url }) => {
      advanceJobs(state)
      const sourceId = url.searchParams.get('sourceId')
      const qualityRuleId = url.searchParams.get('qualityRuleId')
      return state.runs
        .filter(
          (run) =>
            (!qualityRuleId ||
              run.qualityResults.some((result) => result.ruleId === qualityRuleId)) &&
            (!sourceId ||
              state.versions.some(
                (version) =>
                  version.datasetId === run.datasetId &&
                  version.version === run.datasetVersion &&
                  (version.definition.sourceId === sourceId ||
                    version.sourceSnapshots.some(
                      (snapshot) => snapshot.object.sourceId === sourceId,
                    )),
              )),
        )
        .map((run) => visibleRun(state, run))
    },
    { list: true },
  ),
  route('get', '/runs/{id}', ({ state, params }) => {
    advanceJobs(state)
    return visibleRun(state, find(state.runs, params.id))
  }),
  route('post', '/runs/{id}/cancel', ({ state, params, now }) => {
    advanceRuns(state)
    const run = find(state.runs, params.id)
    ensure(
      ['queued', 'running', 'validating'].includes(run.status),
      409,
      'STATE_CONFLICT',
      '该阶段不能取消',
    )
    run.status = 'canceled'
    run.finishedAt = now
    run.durationMs = Math.max(0, Date.parse(now) - Date.parse(run.startedAt))
    run.waitReason = ''
    run.logs.push('用户取消，未发布')
    return run
  }),
  route(
    'post',
    '/runs/{id}/retry',
    ({ state, params, body, now }) => {
      advanceRuns(state)
      const run = find(state.runs, params.id)
      ensure(
        ['failed', 'blocked', 'canceled'].includes(run.status),
        409,
        'STATE_CONFLICT',
        '仅失败、阻断或取消运行可重试',
      )
      ensure(
        !state.runs.some((candidate) => candidate.retryOf === run.id),
        409,
        'STATE_CONFLICT',
        '已存在关联重试运行，请打开该运行',
      )
      return createRun(
        state,
        run.datasetId,
        (body as Model<'RunInput'>).outcome ?? 'succeeded',
        'retry',
        now,
        run.id,
      )
    },
    { input: 'RunInput', created: true },
  ),
]
