# 九章前端页面与验收矩阵

> 更新：2026-10-21。本文只记录当前真实 API 前端入口与交付边界。桌面浏览器验收固定为 `1280×1000`，不执行小屏幕专项。
> [前端架构](frontend-design.md) · [数据集快速操作](dataset-quick-start.md) · [总体架构与进度](architecture.md)

## 当前可用页面

| 页面 | 路由 | 当前行为 | 验收入口 |
|---|---|---|---|
| 工作台 | `/overview` | 服务端汇总数据源、数据集、运行和仓库状态 | `tools/test-overview.py`、`tools/test-real-overview.mjs` |
| 数据源列表/新建/编辑/详情 | `/sources`、`/sources/new`、`/sources/:id/edit`、`/sources/:id` | MySQL 连接测试、保存、平铺表名列表和搜索；选表后展示字段结构与说明，不展示样本预览 | `tools/test-sources.py`、`tools/test-real-sources.mjs` |
| 数据集列表/新建/编辑/详情/版本 | `/datasets`、`/datasets/new`、`/datasets/:id/edit`、`/datasets/:id`、`/datasets/:id/versions/:version` | 可视化选表或只读 SQL；字段映射、预览、质量、脱敏；直连或手动快照入库；发布与版本恢复 | `tools/test-datasets.py`、`tools/test-real-datasets.mjs` |
| 运行列表/详情 | `/runs`、`/runs/:id` | 已发布入库数据集的手动运行、状态、阶段日志、取消和重试 | `tools/test-execution.py`、`tools/test-real-execution.mjs` |
| 数仓概览/表/SQL/导出 | `/warehouse/overview`、`/warehouse/tables`、`/warehouse/query`、`/warehouse/exports` | Doris 当前快照、受限查询和本人 CSV 导出 | `tools/test-warehouse.py`、`tools/test-real-execution.mjs` |
| 质量规则/脱敏策略 | `/governance/quality`、`/governance/masking` | 创建和维护首版支持的质量与脱敏策略 | `tools/test-execution-rules.py`、`tools/test-real-datasets.mjs` |
| 用户/审计 | `/system/users`、`/system/audit` | 固定角色账号、会话管理和审计查询 | `tools/test-identity.py`、`tools/test-real-identity.mjs` |
| 登录/权限错误 | `/login`、`/403`、`/404` | 真实服务端会话、权限拒绝和未找到页面 | `tools/test-identity.py`、`tools/test-real-identity.mjs` |

详情标签不单独计为路由。新建/编辑数据集占满浏览器可视区域，隐藏全局菜单和页头。新建页以左侧数据源/对象目录、右侧 SQL/结果的单页工作区完成取数与保存；清洗、字段和脱敏配置从数据集详情进入。

## 当前业务范围

- 数据源仅真实 MySQL；凭证由服务端保护，浏览器不会连接源库。
- 数据集可视化定义支持单表、等值过滤、字段选择/改名/类型映射、trim、质量和脱敏。复杂关联、聚合和窗口计算使用自定义单条只读 SQL。
- SQL 查询在所选 MySQL 数据源内执行，支持 CTE、JOIN、子查询、聚合、窗口函数和计算表达式；通过服务端只读连接、查询时限、行数/字节上限和副作用语法拒绝规则约束。创建页左侧选择定义方式、数据源和对象，右侧编辑 SQL 并查看取数结果；支持表名搜索、数据库字段补全、目录插入及最多 20 条数据源的远端搜索。表名大小写遵循源数据库规则。取数不依赖名称、目标表或下游规则；失败保留输入，兼容字段配置按源字段名保留。数据集保存后从详情页单独编辑处理和脱敏配置。
- 直连数据集发布后按查询请求读取源库，不创建 Doris 快照或运行。入库数据集首版手动全量运行，以快照替换其独占目标表；发布时目标表配置必填，预览和保存草稿不依赖目标表。
- 自动调度、增量同步、多数据源关联、数据服务、目录/血缘、逐对象授权和生产集群部署仍在后续计划中。

## 验收命令

安装依赖并启动本地真实服务后，可执行：

```bash
pnpm test:e2e
```

该命令连接 `http://localhost:5175`，以 `1280×1000` 真实浏览器验证单页取数/保存、数据源搜索与 20 条接口分页、SQL 补全/表字段插入/选择高亮/快捷键、明暗主题、错误恢复，以及详情页处理预览与保存、编辑保留处理配置和取消草稿。完整前后端、数据库、仓库和存储验收执行：

```bash
bash tools/local.sh verify
```

静态、契约、单元测试和前端构建执行 `pnpm check`。只有实际执行并通过的检查才可写入交付结论；启动方法和本地账号位置见 [README](../README.md)。
