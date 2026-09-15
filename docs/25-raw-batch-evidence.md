# RAW 批次信封与完成门禁

- 日期：2026-09-14。
- 工作包：ING-02 第三切片。
- 状态：V005、RAW 幂等写入/封存函数、控制 API 完成门禁和本地隔离集成已通过；真实 MySQL Worker 和完整 RAW 保留策略仍待实现。数据库角色边界见[28号文档](28-database-role-boundaries.md)。

## 1. 目标与范围

本切片解决“批次状态成功但 RAW 尚未完整落库”的一致性缺口。平台不在 HTTP 请求中接收业务载荷；Worker 将记录写入 `raw.ingestion_record`，完成写入后封存 `raw.ingestion_batch_manifest`，再调用批次完成接口。控制面只有在封存证据与完成请求一致时才允许推进检查点。

本切片的 RAW 是通用记录信封，不包含 DevOps 状态、Story/Defect 字段或指标公式。业务字段映射留在后续 `domains/devops` 模型。

## 2. RAW 记录信封

| 字段 | 约束 |
|---|---|
| `batch_id` / `job_id` | 必须关联控制面批次；批次不是 RUNNING 时拒绝写入 |
| `source_record_key` | 非空 JSON 对象；同批次内作为来源对象幂等键 |
| `payload` | 非空 JSON 对象；原始业务字段不在 RAW 层改名或计算 |
| `payload_checksum` | Worker 计算的 64 位十六进制载荷校验值；数据库校验格式并统一为小写，不在本切片内重新计算载荷摘要 |
| `source_updated_at` | 来源更新时间，可空；不替代事件时间 |
| `event_time` | 来源事件时间，可空；不使用入仓时间代替 |
| `ingested_at` | 数据中心实际入仓时间 |

批次内相同来源键、相同载荷和校验值返回 `REPLAYED`；相同来源键但载荷或校验值不同返回 `RAW_RECORD_CONFLICT`，不静默覆盖。批次封存后拒绝新增 RAW 记录。

## 3. 封存与检查点门禁

`raw.seal_ingestion_batch` 在批次行锁下统计已写入记录，生成不可变清单：

```text
batch_id
job_id
record_count
checksum
writer_principal
sealed_at
```

封存操作按 `(batch_id, checksum, writer_principal)` 幂等重放；同一批次使用不同清单参数返回 `RAW_MANIFEST_CONFLICT`。空批次也必须显式封存，不能通过“没有记录”隐式推断成功。

`POST /api/v1/ingestion-batches/{batchId}/complete` 现在强制要求：

1. 完成请求带非空 64 位十六进制校验值；
2. 批次存在已封存 RAW 清单；
3. 请求 `rowCount` 等于清单 `record_count`；
4. 请求校验值等于清单 `checksum`，清单写入主体等于当前 Worker 身份；
5. 以上条件满足后，才执行原有 checkpoint CAS。

因此 RAW 未封存、证据不一致或检查点已被其他批次推进时，均不得推进检查点。RAW 数据库事务与控制元数据事务尚未跨库原子化；Worker 必须把 RAW 封存作为完成调用前置条件，失败时由重试/对账恢复。

## 4. 身份边界

- `local-admin`：来源、任务等控制面管理接口。
- `local-worker`：批次开始、RAW 完成/失败等执行接口；可读取检查点。
- 管理员 Token 与 Worker Token 必须存在、长度至少 24 且互不相同。
- 当前两类身份已在 HTTP 过滤器中隔离；Worker Token 不能访问来源管理接口，管理员 Token 不能调用批次写接口。
- HTTP Token 隔离与数据库角色隔离是两层门禁。控制 API 现已使用 `bydw_control_api_login`；Worker 数据库登录角色已预留，真实 Worker 进程仍待接入，见[数据库角色边界](28-database-role-boundaries.md)。

## 5. V005 迁移与恢复

V005 新增 `raw` schema、RAW 记录表、批次清单表、批次复合外键和两个受控 `SECURITY DEFINER` 函数，并撤销公开角色的 RAW schema/table/function 权限。已执行的 V001–V005 不修改；失败修复使用新迁移前向处理。

验证要求：空库首次执行和重复执行均成功；迁移记录为 5；RAW 同键重放不增行；同键异内容冲突；封存后拒绝写入；完成门禁阻断未封存及证据不一致。

## 6. 本地证据

- Java 容器构建执行 27 项测试通过；完整 Node 测试 46 项通过。
- 新 PostgreSQL `postgres:16.15` 临时库中 V001–V005 两遍迁移通过，`migration_count=5`。
- SQL 集成通过：`INSERTED`、`REPLAYED`、异内容冲突、封存后拒写、空批次封存、公开角色无函数执行权限。
- HTTP 集成通过：健康 UP；管理员对普通及前导零批次路径均为 401；Worker 来源管理访问 401；未封存 409/`RAW_BATCH_NOT_SEALED`；行数或封存主体不一致均为 409/`RAW_BATCH_EVIDENCE_MISMATCH`；匹配后 `SUCCEEDED` 且检查点版本推进。

上述证据均使用合成数据和明确版本标签 `postgres:16.15`、`bydw/control-api:0.1.0-dev`；没有连接 DevOps MySQL、写源库或部署 NAS。

## 7. 后续工作

1. 增加只读 MySQL 连接测试和凭证运行时解析；Worker 数据库角色已与控制 API 分离。
2. 由 Worker 记录批次统计和稳定诊断引用，补充租约、超时、取消及失联批次对账。
3. 建立 STORY/DEFECT 的来源键映射和 RAW→ODS 领域模型；先验证 `TYPE`、`PID`、`DELETE_FLAG`，不把未知状态直接发布成指标。
