import { ApiError } from '../api/transport.ts'

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return '会话已失效，请重新连接。'
    }
    if (error.status === 403) {
      return `无权执行此操作（${error.code}）`
    }
    if (error.status === 409) {
      return `数据状态已变化，请刷新后重试（${error.code}）`
    }
    return `操作未完成（${error.code}）`
  }
  if (error instanceof TypeError) {
    return '无法连接控制 API，请检查地址、网络与跨域配置。'
  }
  return error instanceof Error ? error.message : '操作未完成'
}
