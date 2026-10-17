# ResponsiveDescriptions

为 Naive UI NDescriptions 补充基于容器宽度的列数与长值换行。复用原生描述项、slots、属性、复制按钮和链接，不拥有请求、业务状态或字段格式化。

- `maxColumns: 1 | 2 | 3 | 4`，默认 3；按每列至少约 280px 的容器宽度计算列数，下限为 1。不是全局视口断点，抽屉或侧栏也按自身可用宽度计算。
- 默认 slot 使用 NDescriptionsItem。其余属性透传给 NDescriptions；列数由本组件所有，不在调用方同时设置 column。
- ResizeObserver 仅在挂载时创建，卸载时断开；初始单列避免未测量时挤压。表格固定布局，长值完整换行，不截断或修改原始数据。
- 已安装 Naive UI 的 column 仅支持数字，没有容器响应能力；现有 NGrid 的 self 断点不适用于描述表格，故在 shared/ui 建立此生命周期所有者。

真实消费者：SourceDetailPage 的四项来源摘要、RunDetailPage 的运行元数据。浏览器测试见 tests/e2e/detail-summary-layout.spec.ts，覆盖长负责人、768→1440→768、明暗主题、复制、Tab 刷新和版本跳转；来源/任务消费者回归见 sources、task-dependencies 和 tasks。其他多列摘要须先验证问题再接入，不批量替换。
