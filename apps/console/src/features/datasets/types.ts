import type { Row } from '../../shared/types'

export interface ModelVersion {
  version: number
  runtime_ref: string
  git_revision: string
  bundle_sha256: string
  contract: Row
  created_by: string
  created_at: string
}

export interface Build {
  id: number
  model_version: number
  state: string
  error_code?: string | null
  finished_at?: string | null
  result?: Row
}

export interface Release {
  id: number
  model_version: number
  published_by: string
  published_at: string
  reason: string
}

export interface ModelInput {
  code: string
  name: string
  runtimeRef: string
  expectedVersion: number
  gitRevision: string
  bundleSha256: string
  contract: Row
}

export interface BuildInput {
  modelVersion: number
  inputs: Row
  requestKey: string
}

export interface PolicyInput {
  identity: string
  columns: string[]
  rowEquals: Row
}

export interface QueryInput {
  releaseId?: number
  columns?: string[]
  equals: Row
  limit: number
  offset: number
}
