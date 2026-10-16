import ui from './ui.zh-CN.json'

export default {
  ui,
  identity: {
    audit: {
      openDetail: '查看审计记录 {id} 详情',
      actions: {
        post: '创建或执行',
        patch: '更新',
        delete: '删除',
        call: '调用',
        publish: '入仓发布',
        failed: '失败',
        blocked: '质量阻断',
        succeeded: '成功',
        ready: '文件就绪',
        expired: '文件过期',
        retry: '自动重试',
        schedule: '计划派发',
        queued: '排队',
        running: '执行中',
        validating: '质量校验中',
        publishing: '发布中',
        seed: '初始化',
      },
    },
    user: '演示用户',
    disabled: '已停用',
  },
  settings: {
    saved: '设置已保存',
    title: '系统设置',
    description: '工作区偏好与演示环境信息',
    timezone: '显示时区',
    notifications: '演示通知',
    hint: '通知仅保存在本地，不发送外部消息',
  },
}
