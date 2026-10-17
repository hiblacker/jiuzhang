import { route } from './core'
export const overviewHandlers = [
  route('get', '/overview', ({ state, now }) => ({
    sourceCount: state.sources.length,
    datasetCount: state.datasets.length,
    publishedCount: state.datasets.filter((d) => d.publishedVersion > 0).length,
    runCount: state.runs.length,
    successCount: state.runs.filter((r) => r.status === 'succeeded').length,
    blockedCount: state.runs.filter((r) => r.status === 'blocked').length,
    tableCount: state.tables.length,
    rows: state.tables.reduce((sum, t) => sum + BigInt(t.rowCount), 0n).toString(),
    recentRuns: [...state.runs]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 5),
    recentFailures: state.runs
      .filter((run) => run.status === 'failed' || run.status === 'blocked')
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, 5),
    attentionCounts: {
      draftDatasets: state.datasets.filter((dataset) => dataset.status === 'draft').length,
      warningSources: state.sources.filter((source) => source.status === 'warning').length,
      offlineSources: state.sources.filter((source) => source.status === 'offline').length,
    },
    trend: Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.parse(now) - (6 - i) * 86400000).toISOString().slice(0, 10)
      return {
        date,
        succeeded: state.runs.filter(
          (r) => r.startedAt.startsWith(date) && r.status === 'succeeded',
        ).length,
        failed: state.runs.filter(
          (r) => r.startedAt.startsWith(date) && ['failed', 'blocked'].includes(r.status),
        ).length,
      }
    }),
    layerCounts: ['ODS', 'DWD', 'DWS', 'ADS'].map((layer) => ({
      layer,
      tables: state.tables.filter((t) => t.layer === layer).length,
    })),
    recentAudit: state.audit.slice(0, 6),
  })),
]
