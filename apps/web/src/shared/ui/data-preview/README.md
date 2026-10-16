# DataPreview

通用的只读二维数据结果，不拥有 HTTP、资源权限、字段映射、查询执行或导出。首批消费者为源预览、数据集详情/编辑器预览、仓库样本、SQL 结果和服务调用结果。

- `columns: string[]`：有序列名，同时作为 rows 的精确属性名；字段展示名/源名由调用者映射。
- `rows: Model<'Row'>[]`：已由接口过滤/脱敏的结果快照。组件只读，不转换原始值，不创建 DTO 镜像。
- 180px 列宽，内部横向滚动和最大 480px 正文；超过 50 行时分页，每页可选 20/50/100。分页属于当前结果快照的本地阅读状态，不改领域列表 URL；结果或列定义变化重置到第一页并关闭旧值。
- `null` 显示 NULL，缺失属性显示 —；0、false、空字符串和高精度字符串保持原语义，列名按字面属性读取。
- 普通值提供 Naive ellipsis/tooltip；超过 80 字符或包含换行的值额外提供键盘按钮和具名只读弹窗，完整文本使用 Vue 文本插值；关闭回到原按钮，复制复用 shared/ui/copy-button 的成功/失败反馈。
- 不发事件、不发请求、不接管 loading/error/empty；这些状态继续由页面和 AsyncState 所有。没有单元格编辑或批量操作接口。

浏览器证据位于 `tests/e2e/wide-preview.spec.ts`；共享变更还需验证原 source/dataset/pipeline/transfer/service/权限/Tab 消费者。
