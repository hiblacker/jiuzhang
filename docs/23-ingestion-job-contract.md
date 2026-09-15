# 接入任务契约第一切片

- 日期：2026-09-14。
- 工作包：ING-01/ING-02 第一切片。
- 状态：任务登记、查询、契约校验和 V002 迁移已在本地 PostgreSQL 验证；批次状态机和 RAW 完成门禁见后续切片；尚未创建真实 Worker 或抽取器。

## 1. API 与模型

| 方法与路径 | 用途 | 约束 |
|---|---|---|
| `POST /api/v1/ingestion-jobs` | 为已登记来源创建 DRAFT 接入任务 | 同一 sourceId/objectName 唯一；禁用来源拒绝创建 |
| `GET /api/v1/ingestion-jobs` | 分页查询任务 | limit 1–100，offset 0–1000000 |
| `GET /api/v1/ingestion-jobs/{id}` | 查询单个任务 | 不存在返回 404 |

任务对象名只接受一至三个标识符段，不接受 SQL 或表达式。当前支持登记 `FULL`、`UPDATED_AT_KEYSET`、`RECONCILIATION` 三类策略；登记支持不等于执行器已实现。

### UPDATED_AT_KEYSET

```json
{
  "updatedAtColumn": "UPDATE_TIME",
  "keyColumns": ["ID"],
  "overlapSeconds": 300
}
```

- keyColumns 必须有 1–8 个不重复标识符，作为同更新时间分页和幂等合并稳定键。
- overlapSeconds 必须显式提供且为 0–86400；它只定义重叠回读，不替代超窗口迟到对账。
- FULL/RECONCILIATION 不接受 updatedAtColumn 或 overlapSeconds，避免无效配置产生错误保证。

### 删除契约

明确支持 `NONE`、`LOGICAL_FLAG`、`KEY_RECONCILIATION`。逻辑删除必须给出列名和两个不同的标量值，例如 DevOps 已确认规则：

```json
{
  "mode": "LOGICAL_FLAG",
  "column": "DELETE_FLAG",
  "activeValue": 0,
  "deletedValue": 1
}
```

平台不从字段名猜测删除语义。`NONE` 明确表示当前契约不能发现删除，不代表源对象永不删除。

## 2. V002 迁移

V002 为 `control.ingestion_job` 增加 delete_spec、version、created_at、updated_at，并为任务列表和批次历史增加两个索引。迁移是仅扩展变更，既有任务回填为 `{"mode":"NONE"}` 和 version 0。

迁移脚本由单事务执行：失败不记录 V002，修复后使用新的前向迁移或重新执行未记录的 V002；已经成功记录的 V002 不得修改。生产不采用删除新增列的破坏性回滚。

本地验证结果：schema_migration 共 2 条，4 个新增字段和 2 个新增索引均存在。

## 3. 测试证据

Java 测试共 14 项，其中接入任务服务 5 项；覆盖完整 UPDATED_AT_KEYSET、缺失更新时间列、空/重复键、重叠窗口上界、逻辑删除值相同、未知字段、无来源/禁用来源和分页边界。

使用版本镜像 `bydw/control-api:0.1.0-dev` 的本地 PostgreSQL 集成结果：

| 检查 | 结果 |
|---|---|
| 创建 STORY 接入任务 | HTTP 201，DRAFT |
| 游标与删除规则持久化 | UPDATE_TIME / ID / 300秒；DELETE_FLAG 0/1 |
| 单项读取 | HTTP 200 |
| 重复 sourceId/objectName | HTTP 409，`INGESTION_JOB_CONFLICT` |
| 缺失 updatedAtColumn | HTTP 400，`INVALID_UPDATED_AT_COLUMN` |
| 创建与读取审计 | 2 条 |

本次只使用合成来源元数据，没有连接或写入 DevOps MySQL。接入任务仍是声明，不得据此声称已经同步数据。

## 4. 下一步

1. 批次逻辑运行键、固定读取上界和检查点提交状态已在[批次与检查点状态机](24-ingestion-batch-checkpoint.md)完成；尝试次数和超时租约仍待实现。
2. 独立 Worker 边界和数据库角色已落地；受限 MySQL 只读连接测试仍待实现，凭证仅在 Worker 运行时解析。
3. 建立 RAW 信封、来源对象唯一键和重复载荷处理，再实现 STORY 最小全量/增量链路。
4. 只有 RAW 持久化和批次成功后才能推进检查点；失败批次不得推进。
