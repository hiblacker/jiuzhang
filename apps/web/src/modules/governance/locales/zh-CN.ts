import ui from './ui.zh-CN.json'

export default {
  ui,
  governance: {
    openBinding: '打开{label}选择',
    searchBinding: '搜索{label}',
    bindingOptionsCount: '已加载 {loaded} 项',
    bindingOptionsTotal: '已加载 {loaded} / {total} 项',
    loadMoreBindings: '加载更多选项',
  },
  quality: {
    realEvaluationHint:
      '质量检查在数据集运行时执行，请发布绑定此规则的数据集后运行，在下方查看真实检查结果。',
    noParameter: '必填与唯一规则无需参数，已有参数不参与检查。',
    rangeHint: '输入有序的最小值,最大值，包含边界；支持十进制文本，例如 -0.10,100.00。',
    enumHint: '输入逗号分隔的非空枚举值，例如 杭州,上海；各项两侧空格会被忽略。',
    freshnessHint: '输入 1 至 87600 的整数小时；未来时间或无法解析的时间不通过检查。',
    sampleSeverityHint: '质量结果在入库运行时计算；运行使用发布版本绑定的规则。',
  },
  masking: {
    sample: '字段示例',
    phone: '手机号字段',
    email: '邮箱字段',
    text: '文本字段',
    amount: '金额字段',
    invalidMask: '请输入两项非负整数，例如 3,4',
    invalidGeneralize: '泛化值需要 1 至 120 字的非空文本',
    disabled: '策略已停用，发布数据集时不会应用该策略。',
  },
  lineage: {
    canvas: '数据血缘图',
    nodePicker: '定位血缘节点',
    nodeHint: '可搜索节点定位并查看详情，或使用 Tab 聚焦节点、Enter/空格选中、Escape 取消。',
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
