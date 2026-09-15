# 控制 API 与 Worker 数据库角色边界

- 日期：2026-09-15。
- 工作包：ING-02 第六切片。
- 状态：V008、受限登录角色开通和 Compose 启动顺序已通过本地构建、全新迁移、权限拒绝和隔离 HTTP 验证。独立 Worker 进程见[29号文档](29-ingestion-worker.md)。

## 1. 角色模型

迁移创建两组角色，密码不写入 SQL：

| 角色 | 类型 | 用途 |
|---|---|---|
| `bydw_control_api` | 无登录权限组 | 控制面表与 RAW 清单的最小权限 |
| `bydw_ingestion_worker` | 无登录权限组 | 仅执行 RAW 写入/封存函数 |
| `bydw_control_api_login` | 登录角色，成员属于控制组 | Compose 中控制 API 的数据库用户 |
| `bydw_ingestion_worker_login` | 登录角色，成员属于 Worker 组 | 预留给后续 Worker 进程 |

`warehouse` 仍是数据库拥有者和迁移执行账号，不作为应用连接用户。登录角色在 V008 中保持 `NOLOGIN`；一次性 `provision-roles` 服务从环境变量读取密码后才 `ALTER ROLE ... LOGIN`。控制组与 Worker 组密码必须不同，且各自不少于 24 字符。

## 2. 权限边界

| 对象 | 控制 API | Worker |
|---|---|---|
| `control.source_connection` | `SELECT, INSERT` | 无 |
| `control.ingestion_job` | `SELECT, INSERT, UPDATE` | 无 |
| `control.ingestion_batch` | `SELECT, INSERT, UPDATE` | 无 |
| `control.audit_log` | `INSERT` | 无 |
| `raw.ingestion_batch_manifest` | `SELECT` | 无表权限 |
| `raw.ingestion_record` | 无 | 无表权限 |
| `raw.ingest_record(...)` | 无 | `EXECUTE` |
| `raw.seal_ingestion_batch(...)` | 无 | `EXECUTE` |
| 数据库 `CONNECT` | 有 | 有 |
| `DELETE` / `TRUNCATE` / `GRANT ALL` | 无 | 无 |

Worker 通过 `SECURITY DEFINER` 函数写入 RAW，函数以拥有者权限运行，不把 RAW 明细表授权给应用登录角色。控制 API 完成批次时只读取封存清单，不读取或改写 RAW 记录。本切片不授予数据集发布表、调度内部表或任意 DDL。

`REVOKE CONNECT ON DATABASE ... FROM PUBLIC` 后，未授权角色不能连接本库。后续新表不会自动获得上述权限，需要在对应迁移中显式授予。

## 3. 开通与密钥

`deploy/scripts/provision-roles.sh` 用 `psql \getenv` 从环境读取 `CONTROL_API_DB_PASSWORD` 和 `INGESTION_WORKER_DB_PASSWORD`，再以 `:'variable'` 字面量绑定到 `ALTER ROLE`。密码不出现在进程参数、脚本标准输出或 Git。

Compose 顺序为：`warehouse-db` 健康 → `migrate` 成功 → `provision-roles` 成功 → `control-api` 以 `bydw_control_api_login` 启动。控制 API 不再接收 `WAREHOUSE_DB_PASSWORD`。镜像标签为 `bydw/control-api:0.1.0-dev.5`。

## 4. V008 升级与恢复

V008 是不可修改的前向迁移。已有对象和数据不删除。失败时修复原因后重跑；登记成功后不得改文件。应用回退到 V007 代码会以数据库拥有者或旧环境变量连接，不能当作已完成权限隔离。回退应使用新的兼容修复版本。

已有开发库从 V007 升级到 V008 后，需再运行 `provision-roles` 才能让登录角色生效；仅执行 SQL 不会写入密码。丢失 `.env` 时按密钥托管重新开通，不把密码写入迁移或镜像。

## 5. 本地验证证据

- 镜像 `bydw/control-api:0.1.0-dev.5` 构建成功，38 项 Java 测试通过。
- 54 项 Node 测试通过，其中 3 项覆盖 V008 最小授权、禁止 `GRANT ALL`/`DELETE`、登录角色无密码、以及开通脚本不把密钥放入命令行。
- 新 `postgres:16.15` 临时库连续执行 V001–V008 两次，迁移记录保持 8 条。
- 权限验证：控制登录可读写来源/任务/批次并读取 RAW 清单，不能 `SELECT raw.ingestion_record` 或执行 RAW 函数；Worker 登录可执行两个 RAW 函数，不能读控制表或 RAW 明细。
- HTTP 验证：受限控制登录下 `/actuator/health` 与 `/api/v1/status` 为 `UP`；管理员可登记来源，Worker 可创建 RUNNING 批次；Worker 登录随后 `INSERTED` 并封存 1 条 RAW 记录。
- 没有连接 DevOps MySQL、修改源库或部署 NAS。真实 Worker 进程、只读源连接测试和报表查询账号仍未实现。

## 6. 后续工作

1. 独立 Worker 进程已使用 `bydw_ingestion_worker_login` 调用 RAW 函数并发送心跳，见[接入 Worker](29-ingestion-worker.md)。
2. 完成 DevOps 测试源只读连接测试和凭证运行时解析。
3. 建立 STORY/DEFECT RAW/ODS 最小链路；状态方向和历史团队归属未确认前不发布对应指标。
