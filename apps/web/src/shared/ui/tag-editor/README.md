# TagEditor

共享字符串标签编辑行为，首批消费者为 SourceConnectionForm 与 DatasetEditorPage。

- v-model: string[]；disabled 禁止增删。只发出本地草稿值，不请求 HTTP，不拥有业务校验。
- 组合 Naive UI NDynamicTags 的公开 trigger/input/renderTag 接口；NTag/NButton 保留基础交互，不访问第三方 DOM 内部结构。
- 添加聚焦输入；Enter/失焦按原值提交（空值不添加），Escape 放弃本次输入；Enter 与取消回到添加按钮，Tab 保留正常离开顺序。
- 删除按数组位置处理，支持已有重复标签；焦点到下一项，末项到前项，删空到添加按钮。
- 不 trim、不去重，不改变既有传输语义；长标签视觉省略，title 和按钮名称保留完整内容。
- 浏览器行为验证见 tests/e2e/tag-editing.spec.ts，覆盖两处保存、刷新、取消及 768px 明暗主题。
