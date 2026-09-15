# 接入 Worker 第一切片

- 日期：2026-09-15。
- 工作包：ING-02 第七切片。
- 状态：独立 Worker 进程、Worker 数据库登录、租约心跳、夹具 RAW 写入/封存和完成检查点已通过本地构建与隔离集成；真实 MySQL 抽取仍未实现。

## 1. 进程边界

Worker 是独立 Java 进程，不提供业务 HTTP API，不在控制 API 请求线程中执行抽取。一次运行处理一个 `(jobId, runKey)` 批次后退出。

| 通道 | 身份 | 用途 |
|---|---|---|
| HTTP | Worker Token，可选 `X-Worker-Instance` | 读取任务/检查点，开始批次，心跳，完成/失败 |
| JDBC | `bydw_ingestion_worker_login` | 只调用 `raw.ingest_record` 和 `raw.seal_ingestion_batch` |

控制 API 镜像为 `bydw/control-api:0.1.0-dev.6`。Worker 镜像为 `bydw/ingestion-worker:0.1.0-dev.1`。Worker 不接收管理 Token 或数据库拥有者密码。

未携带实例头时租约持有者为 `local-worker`；携带合法 `X-Worker-Instance` 时，租约、封存 `writer_principal` 和完成证据使用同一实例名。非法实例名返回 400 `INVALID_WORKER_INSTANCE`。

## 2. 控制面补充

| 接口 | 身份 | 行为 |
|---|---|---|
| `POST /api/v1/ingestion-jobs/{id}/activate` | 管理员 | `DRAFT`/`ACTIVE` 转为 `ACTIVE`；`DISABLED` 返回 409 |
| `GET /api/v1/ingestion-jobs/{id}` | 管理员或 Worker | Worker 可读单个任务契约，不能列举全部任务 |

Worker 仍不能登记来源、激活任务或对账失联批次。

## 3. 执行契约

1. 等待控制 API `/api/v1/status`。
2. 读取任务；仅执行 `FULL` 和 `UPDATED_AT_KEYSET`。`RECONCILIATION` 返回 `UNSUPPORTED_STRATEGY`，不开始批次。
3. 开始批次。若已有相同 runKey 且状态为 `SUCCEEDED`，视为幂等重放并成功退出。
4. 仅当 `leaseOwner` 等于本实例时继续；否则退出，不抢租约。
5. 立即按租约一半（可配置）发送 heartbeat。
6. 读取夹具 JSONL，按半开窗口过滤后调用 RAW 写入函数。
7. 以写入顺序的载荷 SHA-256 换行拼接再取 SHA-256 作为批次校验值；空批次使用空输入的 SHA-256。
8. 以实例名封存清单，再用封存行数和校验值完成批次；`nextCheckpoint` 等于本次 `cursorTo`。

`UPDATED_AT_KEYSET` 使用夹具 `sourceUpdatedAt` 与 `cursorTo.updatedAt`。检查点有 `updatedAt` 时，下界为该时间减去 `overlapSeconds`。缺少更新时间的记录不进入增量窗口，不补当前时间。`FULL` 不过滤时间。本切片不连接 MySQL，不解析来源凭证。

夹具每行必须是对象，且含非空 `sourceRecordKey` 与 `payload`。合成样例在 `deploy/fixtures/synthetic-story.jsonl`。

## 4. 运行方式

环境变量：`CONTROL_API_BASE_URL`、`CONTROL_API_WORKER_TOKEN`、`WAREHOUSE_DB_URL`、`INGESTION_WORKER_DB_PASSWORD`、`INGESTION_JOB_ID`、`INGESTION_RUN_KEY`、`INGESTION_CURSOR_TO`、`INGESTION_FIXTURE_PATH`。可选 `WORKER_INSTANCE_ID`。

```powershell
docker compose -p bydw -f deploy/compose.yaml --profile worker run --rm ingestion-worker
```

默认 `up` 不启动 Worker。任务须先由管理员激活。失败时 Worker 尝试把仍在 RUNNING 且由本实例持有的批次标为失败，错误码为稳定大写标识符，不把夹具正文写入日志。

## 5. 本地验证证据

- 控制 API `0.1.0-dev.6` 构建成功，42 项 Java 测试通过；Worker `0.1.0-dev.1` 构建成功，8 项 Java 测试通过。
- 56 项 Node 测试通过，其中 2 项覆盖 Worker 使用受限登录、禁止管理 Token、RAW 函数写入、心跳和实例头。
- 隔离集成：管理员创建并激活任务；Worker 实例 `worker-a` 以 `bydw_ingestion_worker_login` 写入窗口内 3 条记录并封存；批次 `SUCCEEDED`，检查点推进到 `2026-09-15T12:00:00+08:00`；同 runKey 再次运行直接成功退出；Worker 不能 `SELECT raw.ingestion_record`。
- 没有连接 DevOps MySQL、修改源库或部署 NAS。

## 6. 后续工作

1. 为 MYSQL 来源实现只读连接测试和运行时凭证解析，替换夹具抽取。
2. 由调度器提交 runKey/cursorTo，并配置最大 attempt 与退避。
3. 建立 STORY/DEFECT RAW/ODS；状态方向和历史团队归属未确认前不发布对应指标。
