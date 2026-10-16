import ui from './ui.zh-CN.json'

export default {
  ui,
  services: {
    restrictedDefinition:
      '当前角色只能查看部分字段。可保存名称、描述和访问设置；来源、字段、参数和排序保持原定义，需具备完整字段权限后编辑。',
    parameterName: '参数 {index} 名称',
    parameterType: '参数 {index} 类型',
    parameterRequired: '参数 {index} 必填',
    removeParameter: '删除参数 {index}',
    callInput: '调用参数 JSON',
    invalidJson: '请输入 JSON 对象，参数值使用字符串。',
    invalidParameter: '参数未定义、缺少必填值或数值格式不正确，请对照契约检查。',
    disabled: '服务已停用，启用后才能调用。',
  },
}
