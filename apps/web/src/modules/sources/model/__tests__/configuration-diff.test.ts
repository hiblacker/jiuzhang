import { describe, expect, it } from 'vitest'
import { newSource, toSourceInput } from '../connectors'
import { compareSourceConfiguration } from '../configuration-diff'

describe('source configuration differences', () => {
  it('retains empty strings, false, zero and arrays without mutating the baseline', () => {
    const before = newSource()
    before.description = '虚构说明'
    const after = toSourceInput(before)
    after.description = ''
    after.tags.push('演示标签')
    after.settings.tls = false
    after.settings.port = 0
    expect(compareSourceConfiguration(before, after)).toEqual([
      { key: 'description', labelKey: 'description', before: '"虚构说明"', after: '""' },
      { key: 'tags', labelKey: 'tags', before: '[]', after: '["演示标签"]' },
      { key: 'settings.port', labelKey: 'sources.port', before: '3306', after: '0' },
      { key: 'settings.tls', labelKey: 'sources.tls', before: 'true', after: 'false' },
    ])
    expect(before.tags).toEqual([])
    expect(before.settings.port).toBe(3306)
    expect(before.settings.tls).toBe(true)
    expect(compareSourceConfiguration(before, toSourceInput(before))).toEqual([])
  })

  it('compares every editable field, including hidden settings retained across connector changes', () => {
    const before = newSource()
    const after = toSourceInput(before)
    after.name = '虚构 API'
    after.description = '虚构说明'
    after.owner = '虚构负责人'
    after.tags = ['synthetic']
    after.type = 'REST API'
    after.settings = {
      host: 'changed.invalid',
      port: 443,
      database: 'changed',
      schema: 'changed',
      tls: false,
      method: 'POST',
      baseUrl: 'https://changed.invalid',
      path: '/changed',
      headers: '{"Accept":"application/json"}',
      query: '{"page":0}',
      body: '{"enabled":false}',
      authType: 'bearer',
      pagination: 'cursor',
      dataPath: 'data.changed',
      incrementalField: 'changed_at',
      rateLimit: 100,
    }
    expect(compareSourceConfiguration(before, after).map((change) => change.key)).toEqual([
      'name',
      'description',
      'owner',
      'tags',
      'type',
      ...Object.keys(after.settings).map((key) => 'settings.' + key),
    ])
    expect(after.settings.query).toBe('{"page":0}')
  })
})
