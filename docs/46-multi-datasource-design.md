# 46 多数据源设计（参考 DataEase，先做 MySQL，待评审）

状态：**方案，未批准，未开发**。本文设计"一个平台接入多种数据源"的对象模型、与 SeaTunnel 的连接器映射、前端数据源管理与接入向导细节。批准前不得据此实现。

配套：[43 号 MySQL 接入方案](43-mysql-ingestion-design.md)、[45 号 SeaTunnel SQL 接入实施方案](45-sql-ingestion-with-seatunnel.md)（执行层与 SQL 编辑器）、[44 号界面重构方案](44-console-redesign-plan.md)、[38 号工作台建设记录](38-vue-console.md)、[工程治理](09-engineering-governance.md)。

## 0. 结论与范围

- 目标：把"只支持 MySQL 整库快照"扩展为**多类型数据源**，先落 MySQL（已有 PoC 与产品实现），其余类型按方言分批接入。
- 参考对象：**DataEase** 的数据源模型（类型分类、连接表单、测试连接、连接数/超时、SSH 隧道）。**只借鉴交互与信息结构**：DataEase 社区版许可为 **GPL-3.0**（GitHub API 实测 2026-09-17），不可引入代码或镜像。
- 一条关键设计选择：**不新建与现有"资源/连接/通道"并行的第二套概念**。现有 `ingest_resource` 已经是"已批准访问端点 + 环境 + 限额"，多数据源只需把它升级为 `访问族（kind）+ 数据源类型（datasource_type/dialect）`，其余对象关系不动。

## 1. 现状与差距（代码事实）

| 维度 | 现状 | 证据 |
|---|---|---|
| 访问族 | 只有三种，且带 CHECK 约束：`MYSQL_SNAPSHOT` / `FILE_SCAN` / `REST_PULL` | `migrations/V020*.sql`、`ConnectorCatalogController.java` |
| Worker 准入 | 硬编码允许上表三种 kind（v2 profile 校验） | `apps/ingestion-worker/lake-runtime.mjs:29` |
| 通道配置键 | 按 kind 白名单：MySQL 只允许 `database`+`tables`；REST 允许 `path/query/pagination/…` | `ManagedIngestionService.java:217,224-227` |
| 资源限额 | 已有 `max_parallel`、`max_bytes`、`requests_per_second`、`resource_group` | `V020*.sql`、`ManagedIngestionService.resource()` |
| 凭证 | MySQL 走私有配置文件 + TLS 授权摘要校验；凭证值不下发前端 | `tools/lake-ingest.mjs:97-100` |
| 连接测试 | **没有**；只有"探测（probe）"这一业务动作 | `docs/42` 流程一 |
| 类型映射 | 结构以 `schema_json` 存放，无"源类型 → 平台类型"的登记与审阅 | `lake.source_object.schema_json` |
| 差 | 无数据源类型概念、无连接测试、无按方言的表单与校验、无驱动/连接器准入清单、无 SSH 隧道 | —— |

## 2. DataEase 的数据源模型（实测其官方文档 2026-09-17，仅作参考）

- **类型分类**：数据仓库/数据湖（AWS Redshift、Hive 插件）· OLTP（MySQL、MongoDB-BI、SQL Server、Oracle、PostgreSQL、MariaDB、Db2、TiDB、Kingbase、达梦插件）· OLAP（ClickHouse、Doris、Impala、StarRocks、Elasticsearch）· 数据文件（Excel、CSV）· API（API、飞书插件）。
- **连接设置**：类型 → 连接信息 → **连接测试**；支持**连接数**与**查询超时**；支持 **SSH 隧道**（密码/密钥两种）连接其他网络环境的数据源；文档还记录了"校验通过但建数据集报数据源无效时降低连接数"的运维经验。
- **取得数据源后**：可获取数据表清单与字段描述信息（供数据集/图表使用）。
- **其上再建数据集**：自定义 SQL + 动态参数 + 字段重命名（细节见 [45 号 §3.4](45-sql-ingestion-with-seatunnel.md)）。

**可借鉴**：类型分类与图标、连接表单分步、测试连接、连接数/超时、字段描述抓取。
**不照搬**：直连查询模型（我们要求入湖+批次+release）、行列权限作为付费功能（我们是内建）、Calcite 跨源联邦查询（本期不做）。

## 3. 设计目标与原则

1. **接入族与方言分离**：`kind` 表达访问方式（数据库快照 / 目录文件 / REST 拉取），`datasource_type` 表达具体数据源（MYSQL / POSTGRESQL / …）。这样连接器准入清单小、类型可扩展，迁移面最小。
2. **只读与最小权限**：每个数据源一个只读账号；平台侧**连接测试必须验证"写入被拒"**（不是只测 `SELECT 1`）。
3. **凭证只引用**：表单只填"凭证引用"（secret 名称/路径）；凭证值永不下发前端、不落日志。
4. **每源独立边界**：允许的库/schema/表清单、语句超时、最大行数/字节、允许执行时段、最大连接数。
5. **驱动/连接器准入**：类型进入清单前必须完成许可、版本固定、CVE 与传递依赖检查（各 JDBC driver 的许可不同，必须逐项记录）。
6. **一次只做一种**：MySQL 先打通全链路（含 SQL 模式），再按方言分批扩；不同时铺开多种类型。

## 4. 对象模型与迁移草案（V027+，仅草案）

不改动 V001–V026。新增/调整均为追加：

```text
warehouse.data_source                ← 新增（或作为现有 ingest_resource 的扩展表，二选一，见下）
  code, name, kind, datasource_type, environment_code, resource_group,
  config_json(非敏感: host,port,database|service_name|schema,sslmode,timezone),
  credential_ref, allowed_schemas[], allowed_tables[],
  max_connections, statement_timeout_ms, max_rows, max_bytes, allowed_window,
  enabled, created_by, last_tested_at, last_test_result
```

**与现有表的关系（推荐写法）**：

- 方案 A（推荐）：**扩展 `warehouse.ingest_resource`**，新增 `datasource_type`、`config_json`、`credential_ref`、`statement_timeout_ms`、`allowed_schemas`、`allowed_tables`、`max_connections`、`last_tested_at`、`last_test_result`。理由：资源已经是"已批准端点 + 环境 + 限额"，并被项目授权（`resource_project`）、被连接引用（`ingest_connection.resource_id`）；新增一张平行表会导致同一概念两处登记。
- 方案 B：新建 `warehouse.data_source` 并被 `ingest_resource` 引用。适用于"一个数据源被多个环境/资源复用"的场景，当前无此需求，不推荐。

**必须同步调整的既有约束（列出精确触点）**：

| 触点 | 现在 | 需要 |
|---|---|---|
| `migrations/V020` 的 `ingest_resource.kind` CHECK | 仅三种 kind | 新迁移追加/替换约束（**不改旧迁移文件**），并为 `datasource_type` 增加 CHECK 或字典表 |
| `lake-runtime.mjs` v2 profile 校验（kind 白名单） | 硬编码三种 | 改为读取控制面下发的连接器能力声明 |
| `ManagedIngestionService` 通道 config 键白名单 | 按 kind switch | 按 `kind + datasource_type` 组合白名单 |
| `ConnectorCatalogController` | 三个条目 | 按 kind 列出，并按 `datasource_type` 给出方言能力（分页/类型/增量/连接器插件） |
| 前端接入向导 | MySQL 固定字段 | 按类型渲染字段（§6.3） |

## 5. 与 SeaTunnel 的连接器映射（先 MySQL）

| 数据源类型 | SeaTunnel 连接器 | 关键参数 | 验证状态 |
|---|---|---|---|
| **MySQL / MariaDB** | `Jdbc` | `url`、`driver`、`user`/`password`（引用）、`query`、`fetch_size` | **POC-01 已验证**（`poc/component/st/jobs/*.json`） |
| PostgreSQL / Kingbase | `Jdbc` | 同上，`driver=org.postgresql.Driver` | 未验证（同插件，方言差异） |
| Oracle / SQL Server / Db2 | `Jdbc` | 同上，驱动与 URL 形式不同；分页/标识符大小写差异 | 未验证 |
| ClickHouse / Doris / StarRocks / TiDB / Impala | `Jdbc` | 同上；部分类型对批量/事务语义不同 | 未验证 |
| MongoDB | `MongoDB` | 连接串、集合、管道 | 未验证（非 JDBC） |
| Elasticsearch | `Elasticsearch` | 索引、查询体 | 未验证 |
| REST API | `Http` | URL、分页、记录路径 | 本平台已有 `REST_PULL` 通道，**不急于走 SeaTunnel** |
| Excel / CSV | `LocalFile`/`File` | 路径、格式、表头 | 本平台已有 `FILE_SCAN` 通道，**不急于走 SeaTunnel** |
| MySQL/PostgreSQL CDC | `MySQL-CDC` / `PostgreSQL-CDC` | binlog/WAL 前置条件 | 单独立项（[43 号 §3.3](43-mysql-ingestion-design.md)） |

**驱动与插件准入**：SeaTunnel 镜像内已带的连接器与驱动要按类型逐一确认版本与许可；新增驱动需要镜像构建记录（`deploy/product-runtime-lock.json` 同级的锁文件）与 NOTICE。**镜像体积与 CVE 也是准入条件**。

## 6. 前端设计

### 6.1 信息架构落点

不新增一级菜单（[44 号 §3.1](44-console-redesign-plan.md) 已是 6 个区域）。**放在「数据接入」下的二级页签**：

```text
数据接入
  ├ 系统与实例      （现有）
  ├ 数据源          ← 新增（管理员与 OWNER 可见）：多类型数据源的登记、测试、授权、限额
  ├ 连接与通道      （现有）
  ├ 交付计划        （现有）
  └ 批次与错误      （现有）
```

### 6.2 数据源列表页

| 列 | 内容 |
|---|---|
| 名称 / 编码 | 名称 + 类型徽标（MySQL / PostgreSQL / …） |
| 类型 | `datasource_type` + 驱动版本 tooltip |
| 环境 | `local-product` 等；不同环境同名数据源不合并 |
| 状态 | `连通` / `未测试` / `失败`（上次测试时间 + 原因）+ Worker 心跳中的可达性 |
| 使用中 | 引用该数据源的连接/通道数（停用前必须先处理） |
| 限额 | 最大连接数 · 语句超时 · 最大行数/字节 · 允许时段 |
| 授权项目 | 已授权项目数（点击查看） |
| 操作 | 测试连接 · 编辑 · 复制 · 授权到项目 · 停用（二次确认 + 原因） |

顶部操作：`新增数据源`（按类型选择）；支持搜索、按类型/环境筛选。

### 6.3 新增/编辑数据源表单（按类型切换字段）

```text
① 类型          （MySQL / PostgreSQL / SQL Server / Oracle / ClickHouse / Doris / …）
② 基本信息       名称 · 稳定编码（登记后不可改）· 环境 · 资源组 · 说明
③ 连接信息       （随类型变化）
     MySQL：主机 · 端口(3306) · 数据库 · 只读账号 · 凭证引用 · SSL 模式 · 时区
     PostgreSQL：主机 · 端口(5432) · 库 · schema · …
     Oracle：主机 · 端口(1521) · 服务名/SID · …
④ 网络与安全     允许的库/schema · 允许的表（可留空=全部，但上限 N·需管理员） · SSH 隧道（见下）
⑤ 限额           最大连接数 · 语句超时 · 最大行数 · 最大字节 · 允许执行时段
⑥ 测试连接       [测试] → 结果区（服务器版本 / 时区 / 可见库表数 / 只读验证 / 延迟 ms）
                 ← 只读验证必须真实尝试一次写操作并确认被拒
[保存]（保存后仍可测试；未通过测试的数据源不能用于启用通道）
```

- **SSH 隧道**（DataEase 支持，我们建议 P1 再做）：字段为跳板机主机/端口/账号/密码或密钥引用；实现方式用 SeaTunnel 侧或 worker 侧的隧道进程。**P0 先用"已批准网络路径"（源库可达即可）**，把隧道列入 P1，避免 P0 引入额外组件与凭证面。
- **凭证引用**只允许选择已登记的 secret 名称；表单不出现明文密码，前端不缓存。

### 6.4 接入向导里的差异（与 [45 号 §5](45-sql-ingestion-with-seatunnel.md) 衔接）

1. 选「已授权执行资源」时，资源项显示 `数据源类型 · 环境`（现在只显示 `名称 · kind · 环境`）。
2. 选「自定义 SQL」时，左侧表树的**方言**来自数据源类型：MySQL 用反引号、PostgreSQL/Oracle 用双引号；关键字高亮与函数提示按方言切换。
3. 连接信息（库/schema）由数据源带出，**用户不可在通道里改库**（避免越界）；需要新库就走"编辑数据源 + 重新授权"。
4. 预检（probe）按类型走不同适配器：JDBC 家族统一走"列出库表 + 列类型 + 主键 + 可空 + 注释"；非 JDBC 类型（MongoDB/ES）需要各自的发现实现。

### 6.5 字段类型映射页（新增二级页签）

| 源类型（按方言） | 平台类型 | 说明 |
|---|---|---|
| `bigint` / `int` / `smallint` / `tinyint` | integer | 位宽与无符号处理需逐类型验证 |
| `decimal(p,s)` / `numeric` | numeric(p,s) | **精度必须保留**（一期要求） |
| `varchar` / `char` / `text` | text | 编码与长度上限 |
| `date` / `datetime` / `timestamp` | timestamp | 时区语义（源时区 → 平台时区）需显式记录 |
| `json` / `blob` / `geometry` | **本期不支持**（阻断并说明） | 不静默降级为文本 |

未映射类型在预检页标红并阻断启用；映射结果可人工覆盖（覆盖必须记录原因与版本）。

### 6.6 状态与文案

| 状态 | 文案 |
|---|---|
| 未测试 | 尚未测试连接；启用通道前必须完成一次成功测试 |
| 测试失败（网络） | 无法连接主机 `host:port`；请检查网络与防火墙 |
| 测试失败（认证） | 账号或凭证无效 |
| 测试失败（只读验证） | 该账号具备写权限，不符合只读要求 |
| 已停用 | 已停用；引用它的连接不能执行 |
| 版本不受支持 | 服务器版本 `x.y` 未在批准清单内 |

## 7. 分期

| 阶段 | 交付 | 验收 |
|---|---|---|
| **P0-a** | MySQL 数据源升级：`datasource_type` + 连接测试（含只读验证）+ 限额字段 + 列表/表单/类型映射页 | `SELECT 1` 成功；写操作被拒；停用后通道不可执行；凭证不出现在任何响应与日志 |
| **P0-b** | 与 [45 号](45-sql-ingestion-with-seatunnel.md) 的 SQL 模式打通（MySQL → SeaTunnel `Jdbc`） | 合成 MySQL：SQL 抽取 → 落 RAW → 登记资产；重复执行幂等 |
| **P1-a** | JDBC 家族扩展：PostgreSQL → Oracle/SQL Server → ClickHouse/Doris/StarRocks/TiDB | 每种类型逐个出"连接 + 发现 + 全量 + 类型映射"证据；未验证不上线 |
| **P1-b** | SSH 隧道（跳板机） | 通过跳板机连一个不可直达的合成库 |
| **P2** | 非 JDBC 类型（MongoDB / Elasticsearch）与 CDC | 各自立项与准入 |

## 8. 风险与待决

1. **驱动许可与镜像体积**：JDBC 驱动许可各异（如 Oracle/DB2 的驱动分发条款），必须逐项核；SeaTunnel 镜像加驱动后体积与 CVE 需重新评估。
2. **类型保真**：`DECIMAL`/`DATETIME`/`ZEROFILL`/`UNSIGNED`/字符集在 SeaTunnel→JSONL 链路上的保真度必须逐类型实测（[45 号 §1](45-sql-ingestion-with-seatunnel.md) 待确认表）。
3. **源库负载**：连接数、语句超时、允许时段必须有默认值，并由业务确认（尤其 OLTP 生产库上的 JOIN/聚合查询）。
4. **探查与授权范围**：允许的库/schema/表清单由谁维护、多久复核一次；建议每季度复核并留审计。
5. **待用户确认**：P1 的目标类型顺序（我建议 PostgreSQL → Oracle/SQL Server → ClickHouse/Doris/StarRocks）；是否需要 SSH 隧道进 P0。
