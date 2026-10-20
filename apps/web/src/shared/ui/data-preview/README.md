# DataPreview

通用的只读二维数据结果，不拥有 HTTP、资源权限、字段映射、查询执行或导出。首批消费者为源预览、数据集详情/编辑器预览、仓库样本、SQL 结果和服务调用结果。

- `columns: (string | { key: string; title: string; width?: number })[]`：有序列定义；字符串同时用作标题和 rows 的精确属性名，结构化定义允许调用者提供翻译后的标题与可选列宽。字段映射、布尔值展示和版本差异文案仍由调用者拥有，不接受 render 回调或请求配置。
- `rows: Model<'Row'>[]`：已由接口过滤/脱敏的结果快照。组件只读，不转换原始值，不创建 DTO 镜像。
- 默认 180px 列宽，内部横向滚动和最大 480px 正文；`fillHeight` 可在高度明确的 flex 容器中填充剩余空间，由 Naive 表格内部滚动，首个消费者是数据源结构浏览区。默认消费者的高度与列宽不变。超过 50 行时分页，每页可选 20/50/100。分页属于当前结果快照的本地阅读状态，不改领域列表 URL；结果或列定义变化重置到第一页并关闭旧值。
- `null` 显示 NULL，缺失属性显示 —；0、false、空字符串和高精度字符串保持原语义，列名按字面属性读取。
- 普通值提供 Naive ellipsis/tooltip；超过 80 字符或包含换行的值额外提供键盘按钮和具名只读弹窗，完整文本使用 Vue 文本插值；关闭回到原按钮，复制复用 shared/ui/copy-button 的成功/失败反馈。
- 不发事件、不发请求、不接管 loading/error/empty；这些状态继续由页面和 AsyncState 所有。没有单元格编辑或批量操作接口。

除六处结果预览，源结构、数据集字段、仓库 schema、版本源快照和差异列表也复用该只读契约。可编辑字段仍归 datasets/DatasetFields，不把交互表格塞入该组件。

浏览器证据位于 `tests/e2e/wide-preview.spec.ts` 与 `tests/e2e/schema-reading.spec.ts`；共享变更还需验证原 source/dataset/pipeline/transfer/service/权限/Tab 消费者。
