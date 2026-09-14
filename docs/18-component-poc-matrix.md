# 18 组件PoC依赖矩阵与执行设计

- 日期：2026-09-11。
- 状态：组件矩阵已获批准；POC-01 已在本地 Docker Desktop 完成端到端实测，ADR-007 可进入“实测候选已冻结”评审。
- 目的：完成 [一期计划](04-phase-one-plan.md) 的 POC-01（接入+编排+SQL执行适配），为冻结 ADR-007 提供实测证据；对应 [开源调研](08-github-open-source-research.md) 的 POC-A/POC-B 范围。
- 版本事实证据：[component-compat-2026-09-11.json](research/component-compat-2026-09-11.json)；仓库活跃度证据沿用 [2026-09-10 快照](research/github-snapshot-2026-09-10.json)。
- 边界：本地 Docker Desktop 实验；不连接真实 DevOps 源库、不部署 NAS、不对外服务；执行仍受 [PoC准入](10-poc-readiness.md) 与 [工程治理](09-engineering-governance.md) 约束。

## 1. 候选版本矩阵

| 能力 | 组件 | 候选版本 | 许可证证据 | 运行时事实（2026-09-11实测） | PoC角色 |
|---|---|---|---|---|---|
| 数据接入 | Apache SeaTunnel | 2.3.13（tag） | Apache-2.0（08号快照、09号记录） | 构建目标 JDK 1.8（release tag pom.xml 实测） | JDBC 源→PostgreSQL RAW |
| 编排 | Apache DolphinScheduler | 3.4.3（tag） | Apache-2.0（08号快照） | 构建目标 JDK 1.8（release tag pom.xml 实测） | 调度 dbt 任务、重试与补数参数 |
| SQL转换 | dbt Core | 1.12.4 | Apache-2.0（PyPI 许可字段实测） | Python>=3.10；dbt-adapters>=1.24.5（PyPI 实测） | 模型执行，目标 PostgreSQL 16 |
| 适配器 | dbt-postgres | 1.11.0 | PyPI 许可字段为空；安装锁定期复核仓库 LICENSE/NOTICE | 与 core 1.12.0 同日发布（2026-07-16），配对候选 | PostgreSQL adapter |
| 存储与模拟目标 | PostgreSQL | 16.15（P0 已锁镜像） | 已审（[17号锁文件](../poc/synthetic-sql/dependencies.lock.json)） | 复用现有缓存镜像，不新增 | 目标库 |
| 模拟源 | MySQL | 复用已缓存 mysql:8.0.43 镜像 | 已记录（[14号](14-mysql-test-discovery.md)） | 同一镜像以 server 模式运行，不新增拉取 | DevOps 源替身（合成数据） |

运行时容器（JDK、Python）由 SeaTunnel/DolphinScheduler 官方镜像内置与独立 Python 镜像提供，不在宿主机安装 JDK/Python；具体镜像使用明确版本标签在安装步骤固定。组件兼容性（尤其 dbt-core 1.12.4 + dbt-postgres 1.11.0）以 PoC 实测为准，不因发布配对推定。

## 2. 安装前锁定要求（批准后的独立步骤）

矩阵批准只批准"组件+版本线"。安装前必须完成并通过复核：

1. Python 锁：容器内 `pip download`/`pip freeze` 生成 dbt-core 1.12.4 + dbt-postgres 1.11.0 完整传递依赖清单，逐包登记许可证与来源；发现非宽松或未知许可证即停止并报告。
2. 镜像锁：SeaTunnel、DolphinScheduler、Python 官方镜像按明确版本标签固定并记录；禁止 `latest` 和 `@sha256` 运行引用。
3. 本地端口、卷目录、资源上限与启动/停止方式记录；不修改现有容器与数据卷。
4. 全部锁文件入 Git 后才开始安装；锁文件不完整不安装。

## 3. POC-01 执行设计

- **模拟源**：本地 MySQL 容器（已缓存镜像），建合成 DevOps 样式库：对象表（含类型/项目/状态/时间字段）与状态事件表（事件ID、对象ID、前后状态、事件时间），只读账号；数据显式标注 synthetic。
- **链路A 接入（POC-A）**：SeaTunnel JDBC source → PostgreSQL RAW。必测：全量初始化、检查点推进、失败重试、重复回读幂等、同一更新时间跨分页无丢失、批次审计记录；复用 [06号 T01/T02](06-acceptance-operations.md) 预期。
- **链路B 编排+转换（POC-B）**：DolphinScheduler standalone 调度 dbt run（模拟源→RAW→DWD 日指标）。必测：平台运行ID↔引擎运行ID映射、失败重试、按业务日期补数参数、旧运行晚完成不得覆盖新发布（复用 P0 `warehouse.publish` CAS 门禁）。
- **验收证据**：每步日志、运行ID、水位、批次、失败注入记录与通过/失败/未验证清单；结果入 work/ 并以可提交摘要入文档。
- **不在本PoC**：Naive UI 控制台、GX 质量框架、元数据目录、300 QPS、NAS 部署、真实源联调。

## 4. 资源预估（本机）

SeaTunnel 约1–1.5GB、DolphinScheduler standalone 约2GB、MySQL+PostgreSQL 合计<1GB；峰值合计<5GB 内存，本机可行。NAS（2核/18GB）部署评估推迟至 [11号](11-poc-confirmed-inputs.md) 的 M3 阶段，不以本机结果代替。

## 5. GOV-01 指标口径签字清单（待用户批准）

以下 9 项候选指标来自 [03号文档](03-data-processing.md)，按三类聚合覆盖。批准后作为一期指标口径基线记录于本文；真实源数据条件核实后逐项确认可计算性，不可计算者标记"受限/P1"，不伪造数据。

| # | 指标 | 聚合类型 | 关键口径 |
|---|---|---|---|
| 1 | 新增需求 | 流量计数 | 按创建时间归属期内，来源+需求ID去重；取消/删除处理单独声明 |
| 2 | 完成需求事件 | 流量计数 | 期内 canonical 完成状态事件次数；重开再完成计第二次事件 |
| 3 | 完成需求对象数 | 期内去重 | 期内完成对象按对象ID去重；不与日去重相加 |
| 4 | 期末未完成需求 | 期末存量 | 边界前最后有效状态为未完成的数量；历史不完整为NULL+原因 |
| 5 | 有效交付周期均值 | 均值 | sum_duration/valid_sample_count；缺失/负时长隔离；零样本NULL |
| 6 | 新增缺陷 | 流量计数 | 同1，对象为缺陷 |
| 7 | 关闭缺陷事件 | 流量计数 | 同2，对象为缺陷 |
| 8 | 期末未关闭缺陷 | 期末存量 | 同4，对象为缺陷 |
| 9 | 有效缺陷关闭周期均值 | 均值 | 同5，对象为缺陷 |

通用口径：Asia/Shanghai 自然日/自然月，半开区间 `[start, end)`；月值从月内明细重算，不平均日均值或日去重数；流量归属事件时团队、存量归属期末前团队；[11号](11-poc-confirmed-inputs.md) 三类合成实验契约已实现并通过（17号）。

## 6. 决策影响

- ADR-007 保持"推荐基线，待PoC"；POC-01 通过后以实测版本矩阵冻结，失败则按 [08号决策门](08-github-open-source-research.md) 更换候选。
- GOV-01 签字完成前，本矩阵不阻塞；两者可并行批准。

## 7. 用户批准记录（2026-09-11，聊天确认）

1. **依赖矩阵批准（"批准，锁后安装"）**：第1节矩阵获准进入下一阶段。执行顺序按第2节：传递依赖锁+镜像明确版本固定入Git → 安装 → POC-01执行。本地Docker，不碰NAS、不碰真实源库。
2. **GOV-01签字（"批准全部9项"）**：第5节9项指标作为一期指标口径基线。真实源数据条件核实前，对应指标在交付物中标记"未验证"；不可计算者标记"受限/P1"，口径不删除。

签字主体：项目用户（聊天记录为准）；本记录由AI据回复代记，用户可随时修订。

## 8. 安装锁定与冒烟记录（2026-09-11，POC-01前置完成）

用户开启系统代理后拉取成功；证据与锁文件见 [poc/component](../poc/component/README.md)：

- 三个新镜像已按版本固定并拉取：`python:3.12-slim`、`apache/seatunnel:2.3.13`（内置JDK 1.8.0_342，LICENSE/NOTICE齐备）、`apache/dolphinscheduler-standalone-server:3.4.3`（内置JDK 1.8.0_502）。`postgres:16.15` 与 `mysql:8.0.43` 复用已锁缓存，无新增拉取。
- dbt传递依赖锁：59个包逐包登记许可证；`psycopg2-binary`（LGPL+链接例外）与`text-unidecode`（Artistic/GPL双许可，走Artistic路径）标记为"内部使用/交付期复核"。
- 冒烟：dbt --version 确认 core 1.12.4 + postgres 1.11.0 配对可运行；SeaTunnel FakeSource→Console 批作业以 `-e local` 运行结束状态 `FINISHED`；DS standalone 约50秒启动后 API 200、登录端点返回会话，临时容器已清理。
- 边界：冒烟只证明二进制可在本机运行；不是POC-A/B验收、不是ADR-007冻结、不是NAS或容量结果。下一步工作包为POC-01链路执行（模拟源建表→SeaTunnel JDBC接入→dbt日指标→DS调度与补数→旧运行拒绝覆盖）。

## 9. Docker Desktop 升级后验证与 POC-01 实测结果（2026-09-14）

### 9.1 环境与镜像

Docker Desktop 升级后验证环境为 Docker client/server `29.7.2`、API `1.55`、Docker Desktop CLI plugin `v0.4.3`，`docker desktop status` 持续为 `running`。Compose 使用本地 `docker compose` v2 插件；本轮不触碰 NAS。

本轮运行仅使用以下明确版本标签：`mysql:8.0.43`、`postgres:16.15`、`python:3.12-slim`、`apache/seatunnel:2.3.13`、`apache/dolphinscheduler-standalone-server:3.4.3`。运行配置和命令均不得改用镜像 ID 或 digest。

### 9.2 结果

单次完整报告：[poc01-20260914065750_4de84df7.json](../work/poc01-20260914065750_4de84df7.json)。结果为 `PASS`，覆盖：

- Compose 五服务健康启动；
- MySQL→SeaTunnel JDBC→PostgreSQL RAW，21 个事件、12 个对象；
- 重放幂等、迟到数据重建、陈旧发布拒绝且活动指针不变；
- DolphinScheduler 工作流成功并验证失败重试策略；
- dbt Core 1.12.4 + dbt-postgres 1.11.0 的 4 个数据测试通过。

### 9.3 本轮修正

- dbt 项目只读挂载时显式指定 `--project-dir /opt/dbt_project`，并把 `--target-path`、`--log-path` 指向 `/tmp`，避免容器内写只读目录。
- runner 错误信息同时保留 stdout 和 stderr，避免 dbt 将诊断输出写 stdout 时出现空错误。
- DolphinScheduler 3.4.3 默认以 `-Xms4g -Xmx4g` 和约 400 线程启动，在 2 GiB/400 PIDs 容器限制下会导致 `procReady not received`，并使后续 `docker exec` 无法创建进程。Compose 已将 PoC JVM 调整为 `-Xms512m -Xmx1280m -Xss512k -XX:ActiveProcessorCount=2`；实测约 1.36 GiB、195 PIDs，`docker exec` 和完整链路均正常。

### 9.4 网络与边界

Docker Hub 及 Maven/PyPI 下载过程中仍观察到代理 `EOF`、TLS handshake timeout、closed pipe；有限重试后镜像和依赖均完成。该问题属于当前 Clash Verge 节点网络稳定性，不是 Docker Desktop 后端崩溃。C 盘用户目录的原子 Rename 失败仍高度疑似 Sangfor UEM 文件过滤驱动拦截，不能通过升级 Docker Desktop 认定已修复；正式修复仍需终端安全管理员放行 Docker 目录 Rename 或升级 UEM 客户端。

本结果不覆盖真实 DevOps 源库、NAS 部署、生产数据、300 QPS、CVE 扫描、SBOM、正式许可证交付清单或高可用能力。
