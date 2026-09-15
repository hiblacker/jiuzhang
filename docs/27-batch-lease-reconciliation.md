# 批次租约、心跳与失联对账

- 日期：2026-09-15。
- 工作包：ING-02 第五切片。
- 状态：V007、Worker 心跳、租约写入门禁和管理员失联对账已通过本地构建、迁移升级和隔离 HTTP 集成验证。

## 1. 租约契约

每个 RUNNING 批次必须保存 `lease_owner`、`last_heartbeat_at` 和 `lease_expires_at`。创建批次和重试 attempt 时由服务端使用数据库时间签发租约，客户端不能提交或延长任意期限。

- 默认租约 300 秒，配置范围 30–3600 秒；配置超界时 API 拒绝启动。
- Worker 应在租约过半前调用 `POST /api/v1/ingestion-batches/{batchId}/heartbeat`。
- 心跳、完成、失败和取消只接受当前租约持有者，且数据库判断操作开始时租约仍未过期。
- 过期租约不能复活；必须先由管理员对账为 FAILED，再按既有 attempt 规则重试。
- 当前本地 Token 只区分 `local-worker` 角色，尚不能区分多个 Worker 实例。正式 Worker 身份和数据库角色分离后，`lease_owner` 必须使用稳定实例主体。

租约依赖 PostgreSQL `statement_timestamp()`，不依赖 API 主机时钟。完成操作先锁定批次并验证租约，再推进检查点；与心跳、取消、失败或对账并发时，只能有一个状态转换生效。

## 2. 失联对账

`POST /api/v1/ingestion-batches/reconcile-expired?limit=100` 仅管理员可调用。`limit` 为 1–1000；查询按 `(lease_expires_at,id)` 排序并使用 `FOR UPDATE SKIP LOCKED`，允许多个对账执行者并行而不重复处理同一批次。

对账把过期 RUNNING 批次原子改为 `FAILED`，错误码为 `LEASE_EXPIRED`，不推进任务检查点、不删除 RAW 记录或封存清单。响应返回本轮数量和批次 ID；审计动作是 `INGESTION_BATCH_RECONCILE`。调度周期应小于租约时长，单轮达到 limit 时继续分页式调用，不能一次无界扫描。

## 3. RAW 门禁

V007 为 `raw.ingestion_record` 和 `raw.ingestion_batch_manifest` 增加触发器：

- 批次不是 RUNNING 或租约已过期时，拒绝新记录和新清单；
- 封存清单的 `writer_principal` 必须等于租约持有者；
- 重放仍受原有主键、载荷校验和与清单幂等约束；
- 失败批次的已有 RAW 证据保留，新 attempt 使用新的 batch ID 重新写入和封存。

RAW 过期写入阻断已在本切片落地。控制 API 与 Worker 的独立数据库角色见[数据库角色边界](28-database-role-boundaries.md)，不能把 HTTP Token 隔离误称为唯一权限控制。

## 4. V007 升级与恢复

升级前已存在的 RUNNING 批次没有可信租约，V007 将其标记为 `FAILED/LEASE_MIGRATION_REQUIRED` 并保留原批次和 RAW 数据。运维应在维护窗口等待在途批次结束；无法等待时，升级后核对这些批次并显式重试。迁移不删除表、批次或 RAW 证据。

V007 是不可修改的前向迁移。失败时修复迁移原因后重跑；已经登记成功后不得改文件。应用回退到 V006 代码会缺少租约字段写入，不能与 V007 模式继续创建 RUNNING 批次，因此回退应使用新的兼容修复版本，而不是盲目降级应用。

## 5. 本地验证证据

- 镜像 `bydw/control-api:0.1.0-dev.4` 构建成功，38 项 Java 测试通过。
- 51 项 Node 测试通过，其中 3 项覆盖 V007 非删除迁移、数据库时间门禁、限量对账和身份边界。
- 新 `postgres:16.15` 临时库连续执行 V001–V007 两次，迁移记录保持 7 条。
- V006 测试库中的 RUNNING 批次升级后为 `FAILED/LEASE_MIGRATION_REQUIRED`，完成时间已记录。
- HTTP 集成验证：心跳延长租约；过期完成返回 `409/BATCH_LEASE_NOT_ACTIVE`；Worker 对账返回 401；管理员对账 1 条；重试生成 attempt 2；检查点保持 0。
- RAW 集成验证：错误持有者封存被拒绝，租约过期后的新 RAW 写入被拒绝。
- 现有本地开发库从 V006 升级到 V007 后，来源/任务/批次数量保持 `4/2/2`，API 健康状态为 UP；没有连接 DevOps MySQL、修改源库或部署 NAS。

## 6. 后续工作

1. 控制 API 与 Worker 的 PostgreSQL 登录角色已分离，见[数据库角色边界](28-database-role-boundaries.md)。
2. Worker 周期心跳已在[接入 Worker](29-ingestion-worker.md)落地；管理端定时对账、退避和最大 attempt 仍待实现。
3. 增加批次列表、租约状态、错误分类和告警投影，供 Naive UI 控制台展示。
