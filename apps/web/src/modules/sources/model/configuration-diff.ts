import type { SourceInput } from '../api/source-repository'

const sourceLabels = {
  name: 'name',
  description: 'description',
  owner: 'owner',
  tags: 'tags',
  type: 'type',
} satisfies Record<Exclude<keyof SourceInput, 'settings'>, string>

const settingLabels = {
  host: 'sources.host',
  port: 'sources.port',
  database: 'sources.database',
  schema: 'sources.schema',
  tls: 'sources.tls',
  method: 'sources.method',
  baseUrl: 'sources.baseUrl',
  path: 'sources.path',
  headers: 'sources.headers',
  query: 'sources.query',
  body: 'sources.body',
  authType: 'sources.auth',
  pagination: 'sources.pagination',
  dataPath: 'sources.dataPath',
  incrementalField: 'sources.incremental',
  rateLimit: 'sources.rateLimit',
} satisfies Record<keyof SourceInput['settings'], string>

export interface SourceConfigurationChange {
  key: string
  labelKey: string
  before: string
  after: string
}

/** JSON notation keeps empty strings, zero, false and arrays distinguishable. */
export function compareSourceConfiguration(
  before: SourceInput,
  after: SourceInput,
): SourceConfigurationChange[] {
  const changes: SourceConfigurationChange[] = []
  for (const key of Object.keys(sourceLabels) as (keyof typeof sourceLabels)[]) {
    const previous = JSON.stringify(before[key])
    const next = JSON.stringify(after[key])
    if (previous !== next)
      changes.push({ key, labelKey: sourceLabels[key], before: previous, after: next })
  }
  for (const key of Object.keys(settingLabels) as (keyof typeof settingLabels)[]) {
    const previous = JSON.stringify(before.settings[key])
    const next = JSON.stringify(after.settings[key])
    if (previous !== next)
      changes.push({
        key: 'settings.' + key,
        labelKey: settingLabels[key],
        before: previous,
        after: next,
      })
  }
  return changes
}
