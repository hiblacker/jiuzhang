# 九章前端页面与验收矩阵

> 更新：2026-10-20。本文只记录当前真实 API 前端入口与交付边界。桌面浏览器验收固定为 `1280×1000`，不执行小屏幕专项。
> [前端架构](frontend-design.md) · [数据集快速操作](dataset-quick-start.md) · [总体架构与进度](architecture.md)

## 当前可用页面

| 页面 | 路由 | 当前行为 | 验收入口 |
|---|---|---|---|
| 工作台 | `/overview` | 服务端汇总数据源、数据集、运行和仓库状态 | `tools/test-overview.py`、`tools/test-real-overview.mjs` |
| 数据源列表/新建/编辑/详情 | `/sources`、`/sources/new`、`/sources/:id/edit`、`/sources/:id` | MySQL 连接测试、保存、目录发现、字段结构和管理员原始数据预览 | `tools/test-sources.py`、`tools/test-real-sources.mjs` |
| 数据集列表/新建/编辑/详情/版本 | `/datasets`、`/datasets/new`、`/datasets/:id/edit`、`/datasets/:id`、`/datasets/:id/versions/:version` | 可视化选表或只读 SQL；字段映射、预览、质量、脱敏；直连或手动快照入库；发布与版本恢复 | `tools/test-datasets.py`、`tools/test-real-datasets.mjs` |
| 运行列表/详情 | `/runs`、`/runs/:id` | 已发布入库数据集的手动运行、状态、阶段日志、取消和重试 | `tools/test-execution.py`、`tools/test-real-execution.mjs` |
| 数仓概览/表/SQL/导出 | `/warehouse/overview`、`/warehouse/tables`、`/warehouse/query`、`/warehouse/exports` | Doris 当前快照、受限查询和本人 CSV 导出 | `tools/test-warehouse.py`、`tools/test-real-warehouse.mjs` |
| 质量规则/脱敏策略 | `/governance/quality`、`/governance/masking` | 创建和维护首版支持的质量与脱敏策略 | `tools/test-execution-rules.py`、`tools/test-real-datasets.mjs` |
| 用户/审计 | `/system/users`、`/system/audit` | 固定角色账号、会话管理和审计查询 | `tools/test-identity.py`、`tools/test-real-identity.mjs` |
| 登录/权限错误 | `/login`、`/403`、`/404` | 真实服务端会话、权限拒绝和未找到页面 | `tools/test-identity.py`、`tools/test-real-identity.mjs` |

编辑器和详情中的标签页不单独计为路由，但数据集定义、预览、字段、输出方式和发布等行为都纳入对应真实验收脚本。

## 当前业务范围

- 数据源仅真实 MySQL；凭证由服务端保护，浏览器不会连接源库。
- 数据集可视化定义支持单表、等值过滤、字段选择/改名/类型映射、trim、质量和脱敏。复杂关联、聚合和窗口计算使用自定义单条只读 SQL。
- SQL 查询在所选 MySQL 数据源内执行，支持 CTE、JOIN、子查询、聚合、窗口函数和计算表达式；通过服务端只读连接、查询时限、行数/字节上限和副作用语法拒绝规则约束。
- 直连数据集发布后按查询请求读取源库，不创建 Doris 快照或运行。入库数据集首版手动全量运行，以快照替换其独占目标表；运行前目标表配置必填，预览不依赖目标表。
- 自动调度、增量同步、多数据源关联、数据服务、目录/血缘、逐对象授权和生产集群部署仍在后续计划中。

## 验收命令

安装依赖并启动本地真实服务后，可执行：

```bash
pnpm test:e2e
```

该命令连接 `http://localhost:5175`，以 `1280×1000` 浏览器验证可视化预览（目标表留空）、SQL 预览、直连发布和查询。完整前后端、数据库、仓库和存储验收执行：

```bash
bash tools/local.sh verify
```

静态、契约、单元测试和前端构建执行 `pnpm check`。只有实际执行并通过的检查才可写入交付结论；启动方法和本地账号位置见 [README](../README.md)。
