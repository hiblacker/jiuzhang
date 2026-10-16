import type { Model } from '@/shared/api/types'

export function referencedObjectIds(definition: Model<'DatasetDefinition'>) {
  return [
    ...new Set([
      ...(!definition.upstreamDatasetId && definition.objectId ? [definition.objectId] : []),
      ...(definition.mode === 'visual'
        ? definition.nodes
            .filter((node) => node.type === 'input' && node.config.trim())
            .map((node) => node.config.trim())
        : []),
    ]),
  ]
}

export function captureSourceSchemas(
  objects: Model<'SourceObject'>[],
  sources: Model<'Source'>[],
  definition: Model<'DatasetDefinition'>,
): Model<'SourceSchemaSnapshot'>[] {
  return referencedObjectIds(definition).flatMap((id) => {
    const object = objects.find((object) => object.id === id)
    if (!object) return []
    return [
      {
        sourceName:
          sources.find((source) => source.id === object.sourceId)?.name ?? object.sourceId,
        object: structuredClone(object),
      },
    ]
  })
}
