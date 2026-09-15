# 接入批次与检查点状态机

- 日期：2026-09-14。
- 工作包：ING-02 第二切片。
- 状态：批次开始、幂等重放、成功/失败、检查点 CAS 和陈旧批次拒绝已通过本地镜像及 PostgreSQL 验证；后续 RAW 完成门禁见[25号文档](25-raw-batch-evidence.md)，真实抽取 Worker 仍未实现。

## 1. 状态与接口

| 接口 | 行为 |
|---|---|
| `POST /api/v1/ingestion-jobs/{jobId}/batches` | 为 ACTIVE 任务创建 RUNNING 批次；服务端原子捕获当前 checkpoint 和版本 |
| `POST /api/v1/ingestion-batches/{batchId}/complete` | 仅 RUNNING 可完成；检查点版本 CAS 成功后进入 SUCCEEDED |
| `POST /api/v1/ingestion-batches/{batchId}/fail` | 仅 RUNNING 可失败；保存稳定错误码和可选诊断引用，不保存任意原始错误文本 |
| `GET /api/v1/ingestion-jobs/{jobId}/checkpoint` | 返回当前检查点 JSON 及单调递增版本 |

状态范围为 RUNNING、SUCCEEDED、FAILED、CANCELLED、STALE。CANCELLED 通过 Worker 的 cancel 接口产生；不能通过直接改表模拟控制面操作。

## 2. 一致性约束

### 固定输入窗口

开始批次只接受 runKey 和非空 cursorTo。cursorFrom 与 checkpointVersion 从 ingestion_job 在 INSERT SELECT 中读取，客户端不能伪造起点。Worker 必须使用批次返回的半开窗口读取。

### 幂等重放

`(job_id, run_key)` 标识逻辑运行，V006 起物理唯一键为 `(job_id, run_key, attempt)`。首次创建使用默认 attempt 1 和 `ON CONFLICT DO NOTHING RETURNING`：

- 相同 runKey、相同 cursorTo 返回已有批次，不创建第二行；
- 相同 runKey、不同 cursorTo 返回 409 `BATCH_RUN_KEY_MISMATCH`；
- 不在 PostgreSQL 唯一键异常后的已中止事务中继续查询。

### 检查点提交

完成请求必须携带该批次捕获的 expectedCheckpointVersion、非空 nextCheckpoint、非负落库行数和可选 64 位十六进制校验值。

在同一控制库事务中先按 jobId/version 比较并更新检查点，再将 RUNNING 批次更新为 SUCCEEDED。若检查点已经推进，批次更新为 STALE、错误码为 STALE_CHECKPOINT，API 返回 HTTP 409；不修改当前检查点。若批次状态在事务中并发变化，整个检查点更新回滚。

该事务只覆盖控制元数据。V005 已要求 Worker 先封存 RAW 批次清单并通过行数/校验值匹配，再调用 complete；跨数据库不宣称原子事务。

## 3. 迁移与恢复

- V003 为 ingestion_job 增加 checkpoint/checkpoint_version，为 ingestion_batch 增加 runKey、attempt、错误码、诊断引用、批次检查点版本和提交时间。
- 既有批次按 `legacy-{id}` 回填唯一 runKey，避免同一任务多批次迁移冲突。
- V004 是独立前向迁移，扩展状态约束以加入 STALE。V003 已执行后未原地修改。
- 空库 V001–V004 连续执行并重复运行成功；开发库从 V002 升级至 V004 成功。已执行迁移不得修改，故障通过新迁移前向修复。

## 4. 验证证据

Java 测试共 22 项，其中批次服务 8 项，覆盖 ACTIVE 门禁、服务端检查点、相同重放、不同上界冲突、版本不匹配、陈旧提交、失败诊断引用和检查点审计。

版本镜像 `bydw/control-api:0.1.0-dev` 的本地 PostgreSQL 集成结果：

| 场景 | 结果 |
|---|---|
| 相同 runKey 重放 | 返回同一 batchId |
| 同 runKey 改 cursorTo | HTTP 409，`BATCH_RUN_KEY_MISMATCH` |
| 新上界批次先完成 | SUCCEEDED，checkpointVersion=1 |
| 旧上界批次后完成 | HTTP 409，状态 STALE，错误码 STALE_CHECKPOINT |
| 最终检查点 | version=1，保持新上界 ID 20 |
| 数据库批次状态 | 一个 SUCCEEDED，一个 STALE |

集成测试使用合成来源和人工激活的本地测试任务；没有连接 DevOps MySQL，也没有写源库。

## 5. 未完成项

1. 数据库登录角色和真实 Worker 进程；HTTP Worker 身份隔离及 RAW 完成门禁已在[25号文档](25-raw-batch-evidence.md)完成。
2. 失败重试 attempt 和取消已在[26号文档](26-batch-retry-cancel.md)完成；超时租约和失联批次对账已在[27号文档](27-batch-lease-reconciliation.md)完成。
3. 按 UPDATED_AT_KEYSET 语义校验 nextCheckpoint 不倒退；通用 JSON 版本 CAS 本身不能比较业务水位大小。
4. 批次列表、运行日志引用和告警投影。
