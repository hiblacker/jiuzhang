import type { Model } from '@/shared/api/types'
import type { MockState } from '../fixtures/seed'
import { nextId } from '../db'
import { route, find, ensure } from './core'
import { qualityIssues } from '../model/quality-runtime'
import { fieldLineage } from '../model/lineage'
import { maskingIssues } from '../model/masking'
function catalog(state: MockState, userId: string): Model<'CatalogItem'>[] {
  const favorites = state.favoritesByUser[userId] ?? []
  return [
    ...state.sources.map((x) => ({
      id: 'source-' + x.id,
      name: x.name,
      kind: 'source' as const,
      owner: x.owner,
      tags: x.tags,
      path: '/sources/' + x.id,
      certified: false,
      favorite: favorites.includes('source-' + x.id),
    })),
    ...state.datasets.map((x) => ({
      id: 'dataset-' + x.id,
      name: x.name,
      kind: 'dataset' as const,
      owner: x.owner,
      tags: x.tags,
      path: '/datasets/' + x.id,
      certified: x.publishedVersion > 0,
      favorite: favorites.includes('dataset-' + x.id),
    })),
    ...state.tables.map((x) => ({
      id: 'table-' + x.id,
      name: x.name,
      kind: 'table' as const,
      owner: x.owner,
      tags: x.tags,
      path: '/warehouse/tables/' + x.id,
      certified: true,
      favorite: favorites.includes('table-' + x.id),
    })),
  ]
}
export const governanceHandlers = [
  route('get', '/governance/catalog', ({ state, userId }) => catalog(state, userId), {
    list: true,
  }),
  route(
    'post',
    '/governance/catalog/{id}/favorite',
    ({ state, params, body, userId }) => {
      const item = find(catalog(state, userId), params.id)
      const value = (body as { favorite: boolean }).favorite
      state.favoritesByUser[userId] = (state.favoritesByUser[userId] ?? []).filter(
        (id) => id !== item.id,
      )
      if (value) state.favoritesByUser[userId].push(item.id)
      return { ...item, favorite: value }
    },
    { readAction: true, mutates: true },
  ),
  route('get', '/governance/lineage', ({ state, url, userId }) =>
    url.searchParams.get('scope') === 'field'
      ? fieldLineage(state)
      : {
          notes: ['资源图展示当前定义的依赖关系；字段图按已发布版本和仓库表绑定版本追踪。'],
          nodes: catalog(state, userId).map((x) => ({
            id: x.id,
            label: x.name,
            kind: x.kind,
            path: x.path,
            resourceId: x.id,
            fieldName: '',
          })),
          edges: [
            ...state.datasets
              .filter((x) => x.definition.upstreamDatasetId || x.definition.sourceId)
              .map((x) => ({
                id: 'source-' + x.id,
                source: x.definition.upstreamDatasetId
                  ? 'dataset-' + x.definition.upstreamDatasetId
                  : 'source-' + x.definition.sourceId,
                target: 'dataset-' + x.id,
              })),
            ...state.tables
              .filter((x) => x.datasetId)
              .map((x) => ({
                id: 'table-' + x.id,
                source: 'dataset-' + x.datasetId,
                target: 'table-' + x.id,
              })),
            ...state.datasets.flatMap((dataset) =>
              dataset.definition.nodes
                .filter((node) => node.type === 'input' && node.config.trim())
                .flatMap((node) => {
                  const object = state.objects.find((object) => object.id === node.config.trim())
                  return object
                    ? [
                        {
                          id: 'input-' + dataset.id + '-' + node.id,
                          source: 'source-' + object.sourceId,
                          target: 'dataset-' + dataset.id,
                        },
                      ]
                    : []
                }),
            ),
          ],
        },
  ),
  route('get', '/governance/quality', ({ state }) => state.quality, { list: true }),
  route('get', '/governance/quality/{id}', ({ state, params }) => find(state.quality, params.id)),
  route(
    'post',
    '/governance/quality',
    ({ state, body, now }) => {
      const input = body as Model<'QualityInput'>
      ensure(!qualityIssues(input).length, 422, 'VALIDATION_ERROR', qualityIssues(input).join('；'))
      const rule: Model<'Quality'> = { ...input, id: nextId(state), version: 1, updatedAt: now }
      state.quality.unshift(rule)
      return rule
    },
    { input: 'QualityInput', created: true },
  ),
  route(
    'patch',
    '/governance/quality/{id}',
    ({ state, params, body, now }) => {
      const rule = find(state.quality, params.id)
      const input = { ...rule, ...(body as Model<'QualityInputPatch'>) }
      ensure(!qualityIssues(input).length, 422, 'VALIDATION_ERROR', qualityIssues(input).join('；'))
      Object.assign(rule, body, { version: rule.version + 1, updatedAt: now })
      return rule
    },
    { input: 'QualityInput' },
  ),
  route('delete', '/governance/quality/{id}', ({ state, params }) => {
    const rule = find(state.quality, params.id)
    ensure(
      !state.datasets.some((d) => d.definition.qualityRuleIds.includes(rule.id)) &&
        !state.versions.some((v) => v.definition.qualityRuleIds.includes(rule.id)),
      409,
      'DEPENDENCY_CONFLICT',
      '规则仍被引用',
    )
    state.quality = state.quality.filter((x) => x.id !== rule.id)
    return { message: '已删除' }
  }),
  route('get', '/governance/masking', ({ state }) => state.masking, { list: true }),
  route('get', '/governance/masking/{id}', ({ state, params }) => find(state.masking, params.id)),
  route(
    'post',
    '/governance/masking',
    ({ state, body, now }) => {
      const input = body as Model<'MaskingInput'>
      ensure(!maskingIssues(input).length, 422, 'VALIDATION_ERROR', maskingIssues(input).join('；'))
      const rule: Model<'Masking'> = { ...input, id: nextId(state), version: 1, updatedAt: now }
      state.masking.unshift(rule)
      return rule
    },
    { input: 'MaskingInput', created: true },
  ),
  route(
    'patch',
    '/governance/masking/{id}',
    ({ state, params, body, now }) => {
      const rule = find(state.masking, params.id)
      const input = { ...rule, ...(body as Model<'MaskingInputPatch'>) }
      ensure(!maskingIssues(input).length, 422, 'VALIDATION_ERROR', maskingIssues(input).join('；'))
      Object.assign(rule, body, { version: rule.version + 1, updatedAt: now })
      return rule
    },
    { input: 'MaskingInput' },
  ),
  route('delete', '/governance/masking/{id}', ({ state, params }) => {
    const rule = find(state.masking, params.id)
    ensure(
      !state.datasets.some(
        (d) =>
          d.definition.maskPolicyIds.includes(rule.id) ||
          d.definition.fields.some((f) => f.maskPolicyId === rule.id),
      ) &&
        !state.versions.some(
          (v) =>
            v.definition.maskPolicyIds.includes(rule.id) ||
            v.definition.fields.some((f) => f.maskPolicyId === rule.id),
        ),
      409,
      'DEPENDENCY_CONFLICT',
      '策略仍被引用',
    )
    state.masking = state.masking.filter((x) => x.id !== rule.id)
    return { message: '已删除' }
  }),
]
