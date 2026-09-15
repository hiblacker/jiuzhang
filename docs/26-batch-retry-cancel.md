# 批次重试与取消

- 日期：2026-09-15。
- 工作包：ING-02 第四切片。
- 状态：V006、失败/取消批次重试、取消接口和 attempt 幂等语义已通过本地构建、全新迁移和隔离 HTTP 集成验证。

## 1. 重试模型

同一 `(job_id, run_key)` 表示同一逻辑运行，`attempt` 表示该逻辑运行的执行尝试：

| 状态 | 可重试 | 说明 |
|---|---:|---|
| `RUNNING` | 否 | 运行中的批次不能重复启动另一个 attempt |
| `FAILED` | 是 | 创建 `attempt + 1` 的新 RUNNING 批次 |
| `CANCELLED` | 是 | 创建 `attempt + 1` 的新 RUNNING 批次 |
| `SUCCEEDED` | 否 | 成功批次不可重试，避免重复推进检查点 |
| `STALE` | 否 | 已被更新检查点淘汰，不可重新提交 |

新 attempt 继承原批次的 `cursor_from`、`cursor_to` 和捕获的检查点版本。RAW 记录按 `batch_id` 隔离，重试必须重新写入并封存自己的 RAW 清单，不复用旧 attempt 的完成证据。

## 2. 接口

| 方法与路径 | 身份 | 行为 |
|---|---|---|
| `POST /api/v1/ingestion-batches/{batchId}/retry` | Worker | FAILED/CANCELLED 创建或返回最新 attempt |
| `POST /api/v1/ingestion-batches/{batchId}/cancel` | Worker | RUNNING 变为 CANCELLED；不推进检查点 |

重试使用 `(job_id, run_key, attempt)` 唯一约束和数据库冲突处理：并发重复请求最多创建一个新 attempt；竞争失败的请求读取并返回已经创建的最新 attempt。对旧 attempt 调用重试时，如果更新 attempt 已存在，则返回最新 attempt，调用方需要对最新 attempt 再发起后续操作。

取消只改变控制批次状态并记录 `CANCELLED_BY_WORKER`，不删除 RAW，不回退检查点。取消与完成并发时由状态条件和控制事务决定单一结果；未成功完成的请求返回冲突，不把取消伪装成成功。

## 3. V006 迁移

V006 删除旧的 `(job_id, run_key)` 唯一约束，增加 `(job_id, run_key, attempt)` 唯一约束和最新 attempt 查询索引。已执行的 V001–V005 不修改，生产通过前向迁移升级；不得通过删除批次数据修复唯一约束。

## 4. 审计与边界

重试和取消分别记录 `INGESTION_BATCH_RETRY`、`INGESTION_BATCH_CANCEL`，主体为 `local-worker` 或正式 Worker 身份。接口仍不接收业务载荷；长时间抽取、租约心跳和失联对账由后续 Worker 负责。

本切片不实现自动重试调度、最大尝试次数、退避策略、租约超时或历史批次列表。最大尝试次数应在任务契约中显式配置后再加入，不使用隐藏默认值。

## 5. 本地验证证据

- 版本镜像 `bydw/control-api:0.1.0-dev.1` 构建通过，构建阶段执行 Java 测试 31 项。
- Node 测试 48 项通过，其中 2 项验证 V006 唯一键、Worker 路由和无业务载荷接口边界。
- 新 PostgreSQL `postgres:16.15` 临时库执行 V001–V006 两遍成功，迁移记录为 6，attempt 唯一约束和 CANCELLED 状态约束存在。
- 隔离 HTTP 集成得到 `1:FAILED,2:CANCELLED,3:RUNNING`；重复重试返回同一 attempt 2；RUNNING 重试返回 409/`BATCH_NOT_RETRYABLE`；检查点版本保持 0。
- 审计顺序包含开始、失败、重试、取消、再次重试；没有连接真实 DevOps MySQL、修改源库或部署 NAS。
