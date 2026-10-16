import type { Model } from '@/shared/api/types'
import type { MockState } from '../fixtures/seed'
import { resolveFieldOrigins, type FieldOrigins as Origins } from './field-origins'

/** Value provenance for the supported demo operators; no arbitrary SQL inference. */
export function fieldLineage(state: MockState): Model<'Lineage'> {
  const nodes = new Map<string, Model<'Lineage'>['nodes'][number]>()
  const edges = new Map<string, Model<'Edge'>>()
  const notes = new Set<string>([
    '字段血缘来自已发布版本的显式字段映射和受支持节点；不表示真实数据库解析结果，也不包含过滤条件的行级依赖。',
  ])
  const resolved = new Map<string, Origins>(),
    visiting = new Set<string>()
  function link(source: string, target: string) {
    const id = source + '->' + target
    edges.set(id, { id, source, target })
  }
  function sourceFields(objectId: string, version: Model<'DatasetVersion'>): Origins {
    const snapshot = version.sourceSnapshots.find((item) => item.object.id === objectId)
    const object = snapshot?.object
    if (!object) throw new Error('绑定版本缺少源结构快照')
    const source = { id: object.sourceId, name: snapshot!.sourceName }
    return new Map(
      object.fields.map((field) => {
        const id =
          'source-field-' +
          version.datasetId +
          ':' +
          version.version +
          ':' +
          object.id +
          ':' +
          field.name
        nodes.set(id, {
          id,
          kind: 'source',
          label:
            source.name +
            ' / ' +
            object.name +
            '.' +
            field.name +
            ' · ' +
            version.name +
            ' v' +
            version.version,
          path:
            '/datasets/' +
            version.datasetId +
            '/versions/' +
            version.version +
            '?sourceObjectId=' +
            object.id +
            '&field=' +
            encodeURIComponent(field.name),
          resourceId: 'source-' + source.id,
          fieldName: field.name,
        })
        return [field.name, new Set([id])]
      }),
    )
  }
  function versionFields(version: Model<'DatasetVersion'>): Origins {
    const key = version.datasetId + ':' + version.version
    if (resolved.has(key)) return resolved.get(key)!
    if (visiting.has(key)) throw new Error('版本依赖存在环')
    visiting.add(key)
    const definition = version.definition
    let fields: Origins = new Map()
    try {
      let input: Origins
      if (definition.upstreamDatasetId) {
        const upstream = state.versions.find(
          (item) =>
            item.datasetId === definition.upstreamDatasetId &&
            item.version === version.upstreamVersion,
        )
        if (!upstream) throw new Error('绑定的上游版本不存在')
        input = versionFields(upstream)
      } else input = sourceFields(definition.objectId, version)
      fields = resolveFieldOrigins(definition, input, (objectId) => sourceFields(objectId, version))
    } catch (error) {
      notes.add(
        version.name +
          ' v' +
          version.version +
          '：' +
          (error instanceof Error ? error.message : '字段依赖未解析'),
      )
    }
    const output: Origins = new Map()
    for (const field of definition.fields.filter((field) => field.output)) {
      if (
        version.maskingSnapshot.some(
          (policy) =>
            policy.id === field.maskPolicyId && policy.enabled && policy.kind === 'remove',
        )
      )
        continue
      const id = 'dataset-field-' + key + ':' + field.target
      nodes.set(id, {
        id,
        kind: 'dataset',
        label: version.name + ' v' + version.version + ' · ' + field.target,
        path: '/datasets/' + version.datasetId + '/versions/' + version.version,
        resourceId: 'dataset-' + version.datasetId,
        fieldName: field.target,
      })
      for (const source of fields.get(field.name) ?? []) link(source, id)
      output.set(field.target, new Set([id]))
    }
    visiting.delete(key)
    resolved.set(key, output)
    return output
  }
  for (const version of state.versions) versionFields(version)
  for (const table of state.tables) {
    const version = state.versions.find(
      (item) => item.datasetId === table.datasetId && item.version === table.datasetVersion,
    )
    const upstream = version ? versionFields(version) : undefined
    for (const field of table.fields.filter((field) => field.output)) {
      const id = 'table-field-' + table.id + ':' + field.target
      nodes.set(id, {
        id,
        kind: 'table',
        label: table.name + ' · ' + field.target,
        path: '/warehouse/tables/' + table.id,
        resourceId: 'table-' + table.id,
        fieldName: field.target,
      })
      for (const source of upstream?.get(field.target) ?? []) link(source, id)
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], notes: [...notes] }
}
