import type { Model } from '@/shared/api/types'
export function maskingIssues(policy: Model<'MaskingInput'>) {
  const issues: string[] = []
  if (!policy.name.trim()) issues.push('名称必填')
  if (policy.kind === 'mask' && !/^[0-9]{1,3},[0-9]{1,3}$/.test(policy.parameter.trim()))
    issues.push('掩码参数应为两项非负整数，例如 3,4')
  if (policy.kind === 'generalize' && (!policy.parameter.trim() || policy.parameter.length > 120))
    issues.push('泛化值必须为 1 至 120 字的非空文本')
  return issues
}
