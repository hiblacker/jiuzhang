import ui from './ui.zh-CN.json'

export default {
  ui,
  masking: {
    sample: '合成样本类型',
    phone: '手机号样本',
    email: '邮箱样本',
    text: '名称样本',
    amount: '金额样本',
    invalidMask: '请输入两项非负整数，例如 3,4',
    invalidGeneralize: '泛化值需要 1 至 120 字的非空文本',
    disabled: '策略已停用，显示未处理的合成样本。',
  },
  lineage: {
    scope: '血缘范围',
    resource: '资源级',
    field: '字段级',
    selected: '选择血缘资源',
    direction: '追踪方向',
    both: '上下游',
    upstream: '仅上游',
    downstream: '仅下游',
    selectedField: '选择字段',
    zoomIn: '放大',
    zoomOut: '缩小',
  },
}
