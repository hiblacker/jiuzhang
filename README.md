# 九章数据仓库工作台

2026-10-20：第一版本地单机真实闭环已实现；前端通过真实 API 运行，桌面验证固定 1280×1000。

2026-10-20：一期投产验证路线已排定（真实库 MySQL 收敛 → OceanBase 接入 → JOIN 与派生字段 → Cron 调度 → K8s 部署 → Crest 联调），范围、日期与验收见[总体架构 §12.6](docs/architecture.md#126-一期投产验证路线2026-10-20-确认)。

## 第一版功能

- 系统账号登录/改密、用户管理、固定角色权限、审计。
- MySQL / OceanBase（MySQL 模式）/ PostgreSQL 只读连接、目录/字段发现、管理员原始预览、一致性全量读取；OceanBase 使用主键游标，已在本机 CE 4.4.2.1 observer 跑通直连和入库；PostgreSQL 17.6 使用事务内前向游标，支持无主键全量、schema 和本地 TLS。
- Excel 文件数据源：上传 `.xls` / `.xlsx`，选择工作表与表头行，预览、保存，并复用数据集发布、处理和入库流程；操作见[快速指南](docs/dataset-quick-start.md#excel-数据源)。
- 单源单表数据集：字段选择/改名/精确转换、等值过滤、trim、必填/范围质量、字符串部分脱敏；草稿、不可变发布版本和恢复。
- 手动运行、日志、取消、新运行重试，同数据集最多一个活动运行。
- Doris 全量替换／追加写入、表浏览、受控查询、本人 CSV 导出（24 小时过期）。
- 全量首次空批允许，非空→零行默认阻断，管理员可批准本次空覆盖；追加零行保留已有数据。两者都不能绕过读取／质量错误。当前快照保留，历史最多三份且被替换后最多七天。

OceanBase（MySQL 模式）和 Cron/间隔调度已本地实现并验收；一期继续客户环境、K8s 部署和 Crest 消费验证。暂缓 CDC/水位增量/upsert、依赖编排/补数、多工作区、数据服务及 OceanBase Oracle 模式。SQL 数据集支持单条只读查询，可使用 CTE、关联、聚合、窗口函数和子查询；入库数据集支持 Cron/固定间隔计划并持久化到 PostgreSQL。自动重试、任务依赖和补数仍暂缓。投产验证后另行规划面向已发布仓库数据的 AI 问数：自然语言对话生成受控 SQL、查询数据、生成图表并给出可追溯分析；当前尚未实现，也不在一期排期内。规划边界见[总体架构 §12.4](docs/architecture.md#124-暂缓能力与后续工作)。未实现入口显示说明。

## 启动真实版本

准备 .node-version 指定的 Node、根 package.json 指定的 pnpm、JDK 21、Python 3、OpenSSL 和可访问的 Docker Engine/Compose v2。在仓库根目录执行：

~~~bash
bash tools/local.sh up
~~~

顺序完成私有配置→元数据库与独立 PostgreSQL 测试源/MySQL/Doris/S3 就绪→源与仓库账号初始化→冻结安装依赖→Maven verify→显式 Flyway 迁移→API/Worker/真实前端。系统管理员由 API 首次启动初始化。首次需联网下载。Doris 需要足够内存/磁盘；Linux vm.max_map_count 建议至少 2000000，脚本只提示、不改宿主。

访问 **http://localhost:5175/login**。初始化账号/随机密码见未跟踪的 .env：JIUZHANG_BOOTSTRAP_USER / JIUZHANG_BOOTSTRAP_PASSWORD，在编辑器内查看，不复制到聊天/日志/Git。仅空账号表创建管理员，不覆盖已有账号。

~~~bash
bash tools/local.sh status
bash tools/local.sh stop            # 仅停止本脚本受管进程，保留数据卷
bash tools/local.sh start           # 校验并使用已有构建，不安装/迁移
bash tools/local.sh stop worker
bash tools/local.sh start worker
bash tools/local.sh prepare         # 停止应用后安装/构建/迁移
bash tools/local.sh infra           # 单独准备基础服务
~~~

日志在 .local/logs/{api,worker,web}.log。升级先 stop 再 up，迁移时不能保留旧 API/Worker 连接。脚本不终止其他方式启动的进程，不清空卷，不修改 Docker 权限。使用同一具备 Docker 权限的账号，避免私有文件归属冲突；不要使用 --remove-orphans 或 down -v 清理数据。

手动三终端模式：bash tools/backend.sh api、bash tools/backend.sh worker、pnpm dev；进程由终端管理。启动采用不可变 jar 副本，后续构建不覆盖运行文件。构建通过 `bash tools/backend.sh build` 记录源码和 JAR 指纹；启动与迁移拒绝缺失或过期构建，已运行的旧 JAR 也不会被误报为最新版。源码更新后执行 stop → up；启动检查回归为 `python3 tools/test-backend-build.py`。

## 操作流程

1. 新建 MySQL 源：127.0.0.1:13306 / demo_retail / jiuzhang_reader，密码为 .env 的 SOURCE_READ_PASSWORD。本地关闭 TLS 使用固定公钥；外部源须启用 TLS。服务器不限制数据库主机白名单，但会拒绝未指定、IPv6、未分配、组播及链路本地地址。
2. 测试/保存→orders→创建数据集→在标题栏改名、左侧设置提供方式／全量或追加，选择表或自定义 SQL→预览取数→直接保存草稿；清洗、质量和脱敏从数据集详情配置，再单独发布。入库数据集发布后可手动运行，也可在任务中心启用 Cron 或固定间隔计划。
3. 仓库表查看当前快照→SQL 工作台→查询→导出 CSV→导出中心下载。

数据集 SQL 在所选 MySQL/OceanBase MySQL/PostgreSQL 源库执行，支持单条只读 SELECT，包括 CTE、JOIN、子查询、聚合和窗口函数；预览最多 100 行并限制 30 秒/10 MiB，完整入库执行最多 100 万行并受运行超时限制。拒绝多语句、写入语句、锁定读取、变量写入、文件输出及已知副作用函数。仓库 SQL 工作台仍使用独立的有限查询语法。操作细节见[数据集快速指南](docs/dataset-quick-start.md)。

## 权限与限制

admin 可管理用户/审计/原始预览和一次空覆盖；developer 可配置/发布/运行；viewer 可读仓库、查询和导出本人结果。当前无逐对象授权和独立 export 权限，私有结果按创建者隔离。敏感输出必须绑定启用脱敏，质量在脱敏前执行。

PostgreSQL 保存元数据及有上限的已处理查询/导出；原始所选字段批次存私有 SeaweedFS S3，Doris 存脱敏输出。历史与失败暂存产物回收。原始对象未启用服务端加密，本地元数据库/MySQL/Doris/S3 链路未启用 TLS，独立 PostgreSQL 测试源已启用本地证书 TLS；生产密钥、TLS、备份、独立原始保留及负载验证待后续完成。

保护上限：200 表/200 字段、源扫描 100 万行/600 秒、原始批次 256 MiB、输出字符串 65533 字节。上限不是已压测容量。运行列表/部分累计统计最多最近 10000 次，首页汇总完整；仓库容量/趋势未采集。API/基础服务端口仅绑定回环地址，非生产部署方案。

前端仅连接真实 API。安装依赖后运行 `pnpm dev`，访问 **http://localhost:5175**；首次启动需按上方步骤启动本地 API、Worker 与基础服务。自动化测试中的网络替身仅用于隔离测试，不进入应用启动流程。

## 验证

~~~bash
pnpm check
./mvnw -B verify
pnpm --filter @jiuzhang/web exec playwright install chromium
bash tools/local.sh verify
~~~

verify 先在独立临时 PostgreSQL 库验证空库 V001–V015、V009/V011/V012/V013/V014 升级与重复迁移，并验证调度原子性、退避和有界清理，再按依赖创建合成源/数据集，验证真实接口/引擎/桌面流程。包含 PostgreSQL 数据源的 schema/类型/游标/快照/TLS 和直连/Doris 入库，以及 Excel 文件、版本隔离、存储回收，以及双 Worker 的三个一分钟槽位和派发中 SIGKILL（该项约三分钟）；生成 .local/*-test.json，不能对生产运行。双 Worker 脚本会检查进程归属、暂停受管 Worker、自建两个实例，结束后恢复原受管 Worker；发现未归属 Worker 或已有活动运行则拒绝停止进程。调度语义见[总体架构 §6.5](docs/architecture.md#65-多实例调度语义)。

已启动本地栈、完成 `tools/test-sources.py` 后，可单独复现调度验收：

~~~bash
set -a; source .env; set +a
python3 tools/test-scheduling-atomic.py
python3 tools/test-scheduling-multiworker.py --cycles 4
~~~

`--cycles` 默认 4、最少 2；常规 verify 使用 3，保留崩溃后的后续周期验证。脚本还插入专属过期终态槽，确认启动中的 Worker 定期清理实际删除它。

调度运维配置可通过私有 `.env` 或进程环境覆盖，API/Worker 实例应使用一致配置：

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `JIUZHANG_SCHEDULE_SLOT_RETENTION_DAYS` | `30` | 正整数天；只清理 advanced_to 早于保留期限的 enqueued/skipped 槽位 |
| `JIUZHANG_SCHEDULE_ACTIVE_BACKOFF_SECONDS` | `5` | 正整数秒；活动运行阻塞当前槽位时，下一次尝试的最小间隔 |

槽位清理复用每 60 秒的定期清理，单批最多 500 条，跳过被锁记录；保留清理永不删除 pending，advanced_to 为 NULL 的终态也保留。运行记录及其唯一约束保留，清理槽位不删除运行。过期 EXPIRED 判断优先于退避窗口，不延后一个周期以外的槽位处理。

OceanBase 实例由部署者准备，不随默认 Compose 创建。验收读取 `OCEANBASE_HOST`、`OCEANBASE_PORT`、`OCEANBASE_DATABASE`、`OCEANBASE_USER`、`OCEANBASE_PASSWORD`（通过私有环境设置，不提交凭证），`OCEANBASE_TLS` 默认 true，本机无 TLS 实例显式设为 false。完整账号原样填写；默认表为 orders，可用 `OCEANBASE_TEST_TABLE` 指定有 id/amount 字段和显式主键的合成测试表。启动本地 API/Worker 后执行：

~~~bash
python3 tools/test-oceanbase.py
node tools/test-oceanbase-ui.mjs
~~~

未配置时打印“未验证”并跳过；不能把 verify 中的跳过当作 OceanBase 已通过。有 `OCEANBASE_FIXTURE_USER` / `OCEANBASE_FIXTURE_PASSWORD` 时，脚本用单独测试账号创建并清理专属 1201 行复合主键表，验证跨批快照与并发更新；平台数据源始终使用上面的读取账号。只读 SQL、选表扫描和 Doris 入库均走真实连接器，不引入连接池、CDC 或 Oracle 模式。会话超时与 TLS 边界见[总体架构 §3](docs/architecture.md#3-数据源接入层)。

PostgreSQL 数据源默认端口为 5432，schema 留空使用 public。外部连接要求 TLS 并验证证书与主机名；CA 文件由 API/Worker 的 `JIUZHANG_POSTGRESQL_SSL_ROOT_CERT` 指定，未指定时使用 pgJDBC 默认根证书路径。两进程应使用相同配置。全量单语句超时 `JIUZHANG_POSTGRESQL_QUERY_TIMEOUT_SECONDS` 默认 300 秒，可设为 1–600 秒；连接测试/目录/预览仍保留更短预算。类型、UTC 与 SQL 名称规则见[快速指南](docs/dataset-quick-start.md#postgresql-数据源)。

默认本地栈另建 PostgreSQL 17.6 源容器，地址 localhost:15433、库 demo_retail、schema Retail、账号 jiuzhang_reader；读取密码保存在私有 .env 的 POSTGRESQL_SOURCE_PASSWORD。它与平台元数据库使用不同容器和数据卷，配置了本地 CA 与仅匹配 localhost 的证书。启动只初始化缺失的合成表，保留已有内容；验收会显式重置这组专用合成表。

~~~bash
python3 tools/init-postgresql-source.py
python3 tools/test-postgresql.py
node tools/test-postgresql-ui.mjs
~~~

首次增加 PostgreSQL CA 配置后需重启 API/Worker，再运行验收。脚本真实检查 1201 行跨批读取、并发更新和 DDL、超时取消、无主键表、大整数/Decimal/null/布尔/UTC、错误 CA/主机名与四种定义/提供方式组合；两个验收脚本均已纳入 verify，不以未配置跳过作为 PostgreSQL 通过。报告和截图在 .local/postgresql-*，测试管理员只操作独立合成源。

本地完整重启验收会停止/重启受管应用并重新构建；存储故障验收会短暂停止本项目 S3 与 Doris FE，仅在没有其他运行时单独执行：

~~~bash
python3 tools/test-local-lifecycle.py
python3 tools/test-storage-recovery.py
~~~

独占 Worker 的真实崩溃测试（约三至五分钟等待自然租约到期）：

~~~bash
bash tools/local.sh stop worker
set -a; source .env; set +a
python3 tools/test-worker-recovery.py
bash tools/local.sh start worker
~~~

覆盖 MySQL 等待读取时 SIGKILL，以及 Doris VIEW 已更新而 PostgreSQL 成功事务未提交时 SIGKILL；结束移除专用触发器并停止自建 Worker。

2026-10-30 多实例调度修复后的 Maven verify、pnpm check 和完整 local.sh verify 均实际通过；四个一分钟槽位各成功执行一次，派发中 SIGKILL 后本地两次实测约 0.1–1s 接续，具体记录见[总体架构 §14.15](docs/architecture.md#1415-多实例调度修复与验收2026-10-30)。接续验收上限为两个周期，实测范围不是生产时延承诺。2026-10-19 基线记录保留在 §14.7–§14.10；远端 CI/main 保护仍需单独核实，不据本地检查推断生产性能。

V013 槽位收口后，Maven verify（36 项）、真实 PostgreSQL 迁移/退避/保留/级联和完整 local.sh verify 均实际通过；三周期双 Worker 验收及定期清理检查通过，记录见[总体架构 §14.16](docs/architecture.md#1416-调度槽位生命周期收口-v0132026-10-30)。

OceanBase 接入后，Maven verify（41 项）、pnpm check（103 项）与带 OceanBase 配置的完整 local.sh verify 均实际通过；本机 CE 4.4.2.1 observer 已跑通发现/预览/查询、跨批扫描及选表/SQL 两种 Doris 入库。ODP、外部 TLS 和客户环境尚未真实验证，详见[总体架构 §14.17](docs/architecture.md#1417-oceanbase-mysql-模式接入2026-10-30)。

PostgreSQL 接入后，Maven verify（45 项）、pnpm check（104 项）及带真实 OceanBase 配置的完整 local.sh verify 均实际通过。PostgreSQL 17.6 的 schema/游标/类型/快照/TLS 与四种定义/提供方式组合已真实验证，详见[总体架构 §14.18](docs/architecture.md#1418-postgresql-数据源接入2026-11-02)。

## 工程入口

apps/web 前端；apps/api HTTP；apps/worker 执行；modules/platform 后端库；packages/contracts/openapi.yaml 唯一协议；infra/migrations/postgresql 迁移。pnpm/Maven 独立构建。

[总体架构](docs/architecture.md) · [页面矩阵](docs/frontend-page-map.md) · [开发规范](AGENTS.md) · [AI 规范](docs/ai-development.md) · [例会待办](docs/meeting-todos.md)。

追加写入的真实验收（先按上文启动本地栈并完成源初始化，在私有环境加载配置后执行）：

~~~bash
python3 tools/test-dataset-append.py
node tools/test-dataset-append-ui.mjs
~~~

追加不按业务键去重；SQL 决定本次取数范围，定时策略只控制执行时刻。首版复用快照发布，历史结果原样复制进新快照，不重新计算；累计数据越大，复制成本越高。更多规则见[数据集快速指南](docs/dataset-quick-start.md#提供方式与发布)。
