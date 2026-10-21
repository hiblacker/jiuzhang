# 九章数据仓库工作台

2026-10-20：第一版本地单机真实闭环已实现；前端通过真实 API 运行，桌面验证固定 1280×1000。

2026-10-20：一期投产验证路线已排定（真实库 MySQL 收敛 → OceanBase 接入 → JOIN 与派生字段 → Cron 调度 → K8s 部署 → Crest 联调），范围、日期与验收见[总体架构 §12.6](docs/architecture.md#126-一期投产验证路线2026-10-20-确认)。

## 第一版功能

- 系统账号登录/改密、用户管理、固定角色权限、审计。
- MySQL 只读连接、目录/字段发现、管理员原始预览、InnoDB 一致性全量读取。
- 单源单表数据集：字段选择/改名/精确转换、等值过滤、trim、必填/范围质量、字符串部分脱敏；草稿、不可变发布版本和恢复。
- 手动运行、日志、取消、新运行重试，同数据集最多一个活动运行。
- Doris 完整快照替换、表浏览、受控查询、本人 CSV 导出（24 小时过期）。
- 首次空批允许；非空→零行默认阻断，管理员可批准本次空覆盖，不能绕过读取/质量错误。当前快照保留，历史最多三份且被替换后最多七天。

一期只补 OceanBase（MySQL 模式）、Cron 调度、K8s 部署和 Crest 消费；暂缓 CDC/增量/upsert、依赖编排/补数、多工作区、数据服务及 OceanBase Oracle 模式。SQL 数据集已支持单条只读查询，可使用 CTE、关联、聚合、窗口函数和子查询。投产验证后另行规划面向已发布仓库数据的 AI 问数：自然语言对话生成受控 SQL、查询数据、生成图表并给出可追溯分析；当前尚未实现，也不在一期排期内。规划边界见[总体架构 §12.4](docs/architecture.md#124-暂缓能力与后续工作)。未实现入口显示说明。

## 启动真实版本

准备 .node-version 指定的 Node、根 package.json 指定的 pnpm、JDK 21、Python 3、OpenSSL 和可访问的 Docker Engine/Compose v2。在仓库根目录执行：

~~~bash
bash tools/local.sh up
~~~

顺序完成私有配置→PostgreSQL/MySQL/Doris/S3 就绪→源与仓库账号初始化→冻结安装依赖→Maven verify→显式 Flyway 迁移→API/Worker/真实前端。系统管理员由 API 首次启动初始化。首次需联网下载。Doris 需要足够内存/磁盘；Linux vm.max_map_count 建议至少 2000000，脚本只提示、不改宿主。

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
2. 测试/保存→orders→创建数据集→选择表或自定义 SQL→预览取数→保存；清洗、质量和脱敏从数据集详情配置，再单独发布。入库数据集发布后再手动运行。
3. 仓库表查看当前快照→SQL 工作台→查询→导出 CSV→导出中心下载。

数据集 SQL 支持单条 MySQL 只读 SELECT，包括 CTE、JOIN、子查询、聚合和窗口函数；预览最多 100 行并限制 30 秒/10 MiB，完整入库执行最多 100 万行并受运行超时限制。拒绝多语句、写入语句、锁定读取、变量写入、文件输出及已知副作用函数。仓库 SQL 工作台仍使用独立的有限查询语法。操作细节见[数据集快速指南](docs/dataset-quick-start.md)。

## 权限与限制

admin 可管理用户/审计/原始预览和一次空覆盖；developer 可配置/发布/运行；viewer 可读仓库、查询和导出本人结果。当前无逐对象授权和独立 export 权限，私有结果按创建者隔离。敏感输出必须绑定启用脱敏，质量在脱敏前执行。

PostgreSQL 保存元数据及有上限的已处理查询/导出；原始所选字段批次存私有 SeaweedFS S3，Doris 存脱敏输出。历史与失败暂存产物回收。原始对象未启用服务端加密，本地基础服务之间未启用 TLS；生产密钥、TLS、备份、独立原始保留及负载验证待后续完成。

保护上限：200 表/200 字段、源扫描 100 万行/600 秒、原始批次 256 MiB、输出字符串 65533 字节。上限不是已压测容量。运行列表/部分累计统计最多最近 10000 次，首页汇总完整；仓库容量/趋势未采集。API/基础服务端口仅绑定回环地址，非生产部署方案。

前端仅连接真实 API。安装依赖后运行 `pnpm dev`，访问 **http://localhost:5175**；首次启动需按上方步骤启动本地 API、Worker 与基础服务。自动化测试中的网络替身仅用于隔离测试，不进入应用启动流程。

## 验证

~~~bash
pnpm check
./mvnw -B verify
pnpm --filter @jiuzhang/web exec playwright install chromium
bash tools/local.sh verify
~~~

verify 先在独立临时 PostgreSQL 库验证空库 V001–V007 与重复迁移，再按依赖创建合成源/数据集，验证真实接口/引擎/桌面流程，生成 .local/*-test.json；不能对生产运行。

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

2026-10-19 的基线验证记录见[总体架构 §14.7–§14.10](docs/architecture.md#147-本地交付与最终验收2026-10-19)。本轮变更后的实际验证结果将在此更新；远端 CI/main 保护仍需单独核实，不据本地检查推断生产性能。

## 工程入口

apps/web 前端；apps/api HTTP；apps/worker 执行；modules/platform 后端库；packages/contracts/openapi.yaml 唯一协议；infra/migrations/postgresql 迁移。pnpm/Maven 独立构建。

[总体架构](docs/architecture.md) · [页面矩阵](docs/frontend-page-map.md) · [开发规范](AGENTS.md) · [AI 规范](docs/ai-development.md)。
