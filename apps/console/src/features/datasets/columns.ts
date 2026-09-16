import type { Column } from '../../shared/types'

export const versionColumns: Column[] = [
  { key: 'version', title: '版本', width: 80 },
  { key: 'git_revision', title: 'Git 提交', width: 350 },
  { key: 'created_by', title: '创建身份' },
  { key: 'created_at', title: '登记时间', width: 220 },
]
export const buildColumns: Column[] = [
  { key: 'id', title: '构建', width: 80 },
  { key: 'model_version', title: '模型版本', width: 90 },
  { key: 'state', title: '状态', state: true },
  { key: 'error_code', title: '错误', width: 220 },
  { key: 'finished_at', title: '完成时间', width: 220 },
]
export const releaseColumns: Column[] = [
  { key: 'id', title: 'Release', width: 80 },
  { key: 'model_version', title: '模型版本', width: 90 },
  { key: 'published_by', title: '发布身份' },
  { key: 'published_at', title: '发布时间', width: 220 },
  { key: 'reason', title: '理由', width: 220 },
]
