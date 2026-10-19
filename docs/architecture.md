# 九章数据仓库设计方案

> 状态：第一版本地单机真实闭环已实现；保留 38 路由独立 Mock 前端，长期能力与首版实现分开声明
> 更新时间：2026-10-19
> 参考：Crest 的数据源、数据集、同步任务、字段和执行日志资源模型。新方案只借鉴资源边界，不复用 Crest 的 BI 展示层。
> 当前进度与下一步以 [§12 分阶段交付](#12-分阶段交付) 为统一入口；前端逐页证据见 [页面矩阵](frontend-page-map.md#10-桌面验收收尾)。[纯 Mock 前端设计](frontend-design.md) · [UI 与 Vue 规范](ui-conventions.md) · [AI 开发规范](ai-development.md)。new-api 组件规范的适配依据见 [对照研究](research/new-api-adaptation.md)；当前首版与长期目标的差异以 §12 和 §14 为准。

## 1. 目标与边界

九章定位为一个可私有化部署的数据仓库平台，提供三层能力：

1. **数据源接入层**：统一接入数据库、API 和文件，发现元数据并可靠读取。
2. **数据集加工层**：对数据做标准化、清洗、关联、脱敏、质量校验和定时同步。
3. **仓库服务层**：将已发布数据写入高性能分析仓库，提供 SQL、分页查询、导出和下游 API。

三层之外设置一个控制面，负责元数据、权限、密钥、任务、血缘和审计。控制面不保存业务明细数据，业务数据进入数据平面。

设计原则：

- **SQL 优先**：常规清洗和关联使用可审计 SQL；自定义代码必须运行在受限执行器中。
- **先模块化单体，再按压力拆分**：从零项目先用一个后端和独立 Worker，保留清晰模块边界，避免过早微服务化。
- **至少一次读取 + 幂等写入**：通过业务主键、批次号和版本号实现可重试。
- **原始数据与可用数据隔离**：原始区只对接入服务和受控角色开放，仓库区默认只保存符合权限的字段。
- **元数据先行**：每张表、每个字段、每次运行和每条血缘都可追踪。
- **连接器可插拔**：新增数据源不修改任务编排和仓库写入逻辑。

## 2. 总体架构

~~~mermaid
flowchart LR
    subgraph CP[控制面]
      UI[Vue 管理端]
      API[平台 API]
      META[(PostgreSQL 元数据库)]
      SEC[密钥与权限]
      SCH[Quartz 调度器]
    end

    subgraph EX[执行面]
      W[Worker 执行器]
      CON[Connector SPI]
      TR[SQL/规则转换器]
      Q[质量校验器]
      MASK[脱敏策略引擎]
      PUB[发布协调器]
      ISO[隔离与阻断]
    end

    subgraph DP[数据平面]
      S1[(业务数据库)]
      S2[(外部 API)]
      S3[(文件/对象存储)]
      RAW[(MinIO/S3 原始区 Parquet)]
      STG[(Doris staging)]
      WH[(Apache Doris 仓库)]
      CACHE[(查询/结果缓存)]
    end

    UI --> API
    API --> META
    API --> SEC
    SCH --> META
    SCH --> W
    W --> CON
    CON --> S1
    CON --> S2
    CON --> S3
    W --> RAW
    W --> TR
    RAW --> TR
    TR --> MASK
    MASK --> STG
    STG --> Q
    Q -->|PASS/WARN| PUB
    Q -->|BLOCK| ISO
    PUB --> WH
    PUB --> META
    API --> WH
    WH --> CACHE
    W --> META
    Q --> META
~~~

### 2.1 技术栈与实施状态

| 范围 | 已实施组合 | 边界 |
|---|---|---|
| 前端 | Vue 3、TypeScript strict、Pinia、Naive UI、Vite、Vue Router/Vue Query | 38 路由 Mock；real 只开放首版能力；版本见 manifest/lockfile |
| 接口 | OpenAPI 3.1、openapi-typescript/openapi-fetch | 唯一协议；MSW/IndexedDB 仅 Mock，real 使用 API |
| 后端/构建 | Java 21、Spring Boot 3.5.16、Maven Wrapper 3.9.11 | API/Worker 两进程，共用 platform；精确依赖见 pom |
| 元数据库 | PostgreSQL 17.6、Spring JDBC、Flyway V001–V006 | 单元数据库，显式受控迁移；普通进程不自动升级 |
| 对象存储 | SeaweedFS 3.97、S3 API/AWS SDK | 私有原始所选源字段 NDJSON；未实现 Parquet、生产加密 |
| 分析仓库 | Doris 3.0.8 | 不可变物理表＋稳定逻辑 VIEW；本地单 BE 验证 |
| 执行 | PostgreSQL 运行状态/幂等/租约与 Worker 轮询 | 仅手动全量，Quartz/Cron/依赖/自动重试暂缓 |
| 序列化/验证 | Spring JSON codec、JsonWriter Port、JUnit/AssertJ、ArchUnit | 应用层不依赖 infrastructure/JDBC，Domain 不依赖 JSON/框架 |
| 真实验收 | Compose＋Python/Playwright/AJV | PostgreSQL/MySQL/Doris/S3 实测；Testcontainers 尚未引入 |
| 未来扩展 | Quartz、Redis、OpenTelemetry/Prometheus/Grafana | 规划，不是已完成能力 |

镜像摘要见 Compose，前后端版本分别由 wrapper/pom 与 manifest/lockfile 锁定。已验证本地组合不代表全版本兼容、生产安全或性能承诺。

仓库通过 WarehouseAdapter 隔离。ClickHouse/StarRocks 等后续候选只有在新增适配器与真实验证后才能列为已支持；不因源端可以读取某数据库就宣称可将其作为元数据库或目标仓库。

### 2.2 依赖方向与独立模块

~~~text
当前前端：app -> pages -> modules -> shared
传输协议：packages/contracts（OpenAPI + generated types + examples）
未来后端：Controller -> Application -> Domain / Ports
                         ^             ^
                  应用入口装配     Infrastructure adapters
~~~

Domain/Ports 定义业务不变量与外部能力接口；Infrastructure 依赖这些接口，Application 通过接口调用。应用入口装配实现，不把 HTTP/ORM/存储驱动反向注入领域源码。

- contracts 不能依赖 web/api 的配置、源码或运行时；自身 schema 校验和类型生成须可独立执行，根脚本只委托包内命令。
- connector-spi 只拥有连接器能力、读取计划、批次 schema、游标和取消/资源生命周期契约；不依赖调度器、用户鉴权、元数据库或具体驱动。
- connector-jdbc/http/file 依赖 SPI；密钥解引用、预算、审计上下文通过窄接口注入，不读宿主全局配置。
- 仓库 Port 定义读写/发布能力与结果；Doris 适配器实现具体 SQL、加载及确认行为。API/Worker 使用端口，不在多个层分别拼接相同 SQL。
- 小功能先留在明确领域内；只有实际独立消费者或部署/构建边界时才拆包。已经拆成独立单元，就必须在不借助宿主私有配置/源码的环境单独构建和测试。
- 复用 HTTP client、JSON codec、时间/Decimal 映射和脱敏日志配置；能力所有者是基础设施边界，不做无所不包的 common 模块。

### 2.3 资源所有者

| 领域 | 权威资源/规则 | 公开协作方式 |
|---|---|---|
| sources | 连接定义、对象/字段、读取能力、源游标 | sourceId/objectId、只读发现/读取端口 |
| datasets | 草稿、DAG、转换、不可变发布版本 | datasetId/version、校验和发布用例 |
| jobs | 调度、运行尝试、依赖、重试/取消、租约 | runId、公开运行用例、状态事件 |
| warehouse | 目标 schema、加载批次、发布记录与查询 | tableId/publishId、仓库能力端口 |
| governance | 质量/脱敏策略及其版本 | policyId/version、评估结果；不复制整个数据集状态 |
| identity/secrets/audit | 对象权限、密钥引用、审计事件 | 最小身份上下文、受控密钥解析、追加审计 |

前端可有领域 ViewModel，但不成为后端实体镜像。跨领域传稳定 ID、版本和公开结果，避免直接访问对方 DAO/Store。

## 3. 第一层：数据源接入层

### 3.1 数据源类型

目标连接器目录如下；这是产品覆盖方向，不代表首批全部实现，也不代表当前已具备真实连接能力。真实接入按 §12 的 M1 顺序逐项验收：

- MySQL / MariaDB
- PostgreSQL
- SQL Server
- Oracle / OceanBase Oracle
- ClickHouse / Doris / StarRocks
- REST JSON API
- CSV / XLSX / JSON 文件
- S3/MinIO 文件目录

第二阶段再加入：

- GraphQL、SOAP
- MongoDB
- Kafka/Pulsar
- 数据库日志 CDC

连接器要声明能力：

~~~text
schemaDiscovery       是否支持库、表、字段发现
snapshot              是否支持全量快照
incrementalWatermark  是否支持时间/递增 ID 增量
cdc                   是否支持删除和变更事件
write                 是否允许写入源端
pushdown              是否支持过滤、列裁剪、分页下推
transaction           是否支持一致性快照
~~~

默认所有源端连接均为只读。写回源端必须单独开启，并使用独立连接器能力。

### 3.2 Connector SPI

~~~java
interface SourceConnector {
    SourceType type();

    ConnectionTestResult test(ConnectionConfig config);

    SchemaCatalog discover(ConnectionConfig config);

    ReadPlan plan(ReadRequest request, SourceCheckpoint checkpoint);

    BatchReader read(ReadPlan plan);

    Optional<ChangeReader> readChanges(ChangeRequest request);

    void close();
}
~~~

连接器只负责连接、发现和读取，不负责写 Doris、调度或脱敏。读取结果统一为内部批次格式，包含 runId、sourceId、object、schemaVersion、columns、rows 和 sourceCursor。

### 3.3 数据库接入

数据库源配置包含地址、端口、数据库、schema、只读账号引用、TLS、连接池、超时、并发、批大小、时区、类型映射、默认读取策略和表列白名单。

读取方式：

1. **预览**：只执行只读 SQL，限制扫描时间和返回行数。
2. **全量**：按主键范围或分区拆分批次。
3. **增量**：用 updated_at、递增 ID 或源端变更日志推进游标。
4. **删除同步**：优先 CDC；没有 CDC 时支持软删除字段和周期性全量校准。

没有主键的表必须选择全量或配置复合业务键。

### 3.4 API 接入

API 数据源至少支持：

- Basic、Bearer、API Key、OAuth2 Client Credentials、HMAC
- Header、Query、JSON Body 参数
- 页码、Offset、Cursor、Link Header 分页
- JsonPath 行节点提取和嵌套字段展开
- 请求限流、超时、重试和熔断
- 增量时间参数、递增游标和响应游标保存
- 响应 schema 版本和字段选择
- HTTP 状态码、业务错误码和空数据语义配置

API 每页落地后可记录 rawCursor 作为读取恢复点；对外增量的 successCursor 只在目标发布已确认且元数据提交后前移。两者分开存储，不能把读取完成当作落仓成功。

### 3.5 数据源元数据

~~~text
source_connection
  id, name, type, config_ciphertext, secret_ref, status, owner_id

source_object
  id, source_id, catalog, schema_name, object_name, object_type,
  primary_keys, read_strategy, enabled, schema_hash

source_field
  id, object_id, source_name, logical_name, source_type,
  nullable, ordinal, tags, schema_version

source_checkpoint
  source_id, object_id, cursor_type, cursor_value,
  last_success_run_id, updated_at

source_run
  id, source_id, object_id, run_type, status,
  started_at, ended_at, row_count, byte_count, error_message
~~~

config_ciphertext 只保存加密后的非密钥配置；密码、Token 和私钥只保存 secret_ref，实际值由密钥服务或部署环境提供。

## 4. 第二层：数据集加工层

### 4.1 数据集资源模型

该模型对应 Crest 的资源边界，但把缓存表扩展为可发布的数据产品：

~~~text
dataset
  数据集本身：名称、负责人、目录、模式、状态、版本

dataset_node
  数据集中的输入表、SQL 节点、Join、Union、API 结果或文件

dataset_field
  字段：源字段、展示名、类型、表达式、排序、标签、敏感级别

dataset_edge
  节点之间的依赖关系，形成 DAG

dataset_transform
  清洗、转换、去重、关联、聚合和过滤规则

dataset_mask_policy
  字段级脱敏规则和角色例外

dataset_quality_rule
  完整性、唯一性、范围、枚举、关联和新鲜度规则

dataset_schedule
  调度表达式、依赖、并发、超时、重试和补数参数

dataset_run
  每一次运行的批次、状态、游标、行数、耗时和版本

dataset_run_log
  分阶段日志、SQL、错误、质量结果和告警
~~~

### 4.2 数据集模式

| 模式 | 用途 | 是否落仓 |
|---|---|---|
| DIRECT | 只做预览或临时查询 | 否 |
| MATERIALIZED | 定时加工并供下游复用 | 是 |
| INCREMENTAL | 按游标持续追加/更新 | 是 |
| SNAPSHOT | 每次生成独立快照，支持回溯 | 是 |
| STREAMING | 第二阶段，CDC 或消息流实时处理 | 是 |

默认使用 MATERIALIZED。DIRECT 只允许白名单 SQL 和只读连接，不能绕过脱敏和权限。

### 4.3 数据集 DAG

标准运行：

~~~text
extract
  -> land_raw
  -> infer_schema
  -> standardize
  -> filter_invalid
  -> deduplicate
  -> join_or_aggregate
  -> mask
  -> quality_check
  -> publish
  -> commit_checkpoint
~~~

每个节点产生输入/输出批次、schema hash 和统计信息。节点执行检查点用于恢复中间步骤；源端 successCursor 只能按第 6 节的发布确认流程提交。

第一版 SQL 节点支持字段映射、过滤、Join、Union、聚合、类型转换、去重、业务键合并和参数化 SQL。任意 Java/Python 代码作为后续插件，必须设置 CPU、内存、网络和文件系统限制。

### 4.4 清洗与标准化

统一字段类型：

~~~text
STRING, INT32, INT64, DECIMAL, DOUBLE,
BOOLEAN, DATE, TIMESTAMP, JSON, GEO_POINT, BINARY
~~~

规则：

- 空字符串是否转 NULL 由字段转换策略显式配置，不作为全局隐式转换；缺失、NULL、空字符串、0、false 不混为一谈。
- 日期统一保存 UTC，展示层再转换时区。
- 数值精度由 schema 明确，不允许隐式截断。
- 枚举值建立标准字典。
- 非法记录进入 quarantine 表，保留原因和原始批次。
- 字段重命名保留 source_name，避免血缘断裂。
- schema 变更生成新版本，不覆盖旧版本。

### 4.5 去重与写入语义

每个物化数据集配置：

~~~text
business_key      业务主键或复合键
event_time        事件时间
version_column    版本/更新时间
delete_column     软删除标记，可选
write_mode        APPEND / UPSERT / REPLACE_PARTITION
~~~

实现规则：

- APPEND：事件事实表，允许重复事件但要求 event_id 幂等。
- UPSERT：按业务键合并，使用版本列保留最新记录。
- REPLACE_PARTITION：按日期或租户分区重建，成功后原子替换。
- 全量重建：写入 staging，校验后通过目标引擎已验证的原子发布机制切换可见版本；不得用多个可部分失败的重命名操作冒充原子交换。

### 4.6 脱敏策略

| 策略 | 适用场景 |
|---|---|
| 全部替换 | 密码、Token、身份证等不需要恢复的字段 |
| 部分隐藏 | 手机号、邮箱、姓名 |
| HMAC-SHA256 | 需要关联分析但不能看到原值 |
| Tokenization | 需要受控还原的客户号 |
| AES 加密 | 只有授权服务可解密 |
| 泛化/分桶 | 年龄、金额、地理位置 |
| NULL/删除 | 不允许进入分析区的字段 |

建议：

- 原始区加密并限制为 RAW_READER。
- 默认写入 DWD/DWS/ADS 的 PII 字段使用 HMAC 或部分隐藏。
- 动态脱敏只作为额外保护，不能替代入仓脱敏。
- 脱敏策略版本化；策略变更需要重新发布受影响数据集。
- 记录谁、何时、以什么策略查看过敏感数据。

### 4.7 质量校验

第一版支持：

- 行数范围和日环比变化
- 必填字段非空率
- 业务键唯一率
- 数值范围
- 枚举值合法性
- 主外键关联率
- 数据新鲜度
- schema 漂移
- 源端与目标端行数对账

结果分为 PASS、WARN、BLOCK 和 QUARANTINE。BLOCK 阻止发布，QUARANTINE 只写入隔离区。

## 5. 第三层：仓库服务层

### 5.1 仓库分层

~~~text
ODS  原始镜像/轻度解析，便于回放
DWD  清洗后的明细事实和维度
DWS  面向主题域的汇总层
ADS  面向应用、报表和 API 的服务层
~~~

对象存储保留不可变的原始 Parquet，Doris 不作为唯一历史备份。

### 5.2 表模型

- **Duplicate Key**：日志、事件、追加事实。
- **Unique Key**：客户、订单、商品等需要更新的实体。
- **Aggregate Key**：预聚合指标。
- **临时表**：每次运行使用唯一批次名，完成后交换或合并。

推荐物理规则：

- 时间事实表按天或月分区。
- 分布键优先使用 Join 键或高基数业务键。
- 维度表按业务主键排序。
- 大表避免 select star，查询 API 强制列选择和最大行数。
- 复杂聚合建立物化视图或 ADS 表，避免重复扫描 DWD。

### 5.3 统一仓库适配器

~~~java
interface WarehouseAdapter {
    WarehouseCapabilities capabilities();

    TableHandle createOrUpdateTable(TableSpec spec);

    LoadResult loadBatch(Batch batch, WriteMode mode);

    QueryResult query(QuerySpec query);

    PublishResult atomicPublish(PublishSpec spec);

    TableStats stats(TableHandle table);
}
~~~

平台 API 不直接拼接 Doris SQL。所有 SQL 由 AST/模板生成器产生，标识符白名单校验，值使用参数绑定。

### 5.4 读取服务

支持同步查询、异步查询、数据集 REST API 和受控 JDBC/SQL。查询必须有超时、并发限制、最大扫描量、最大返回行数、查询取消、结果缓存和完整审计。

## 6. 调度、运行和失败恢复

支持手动、一次性、Cron、固定间隔、上游成功触发、时间范围补数和第二阶段的 API 事件触发。

### 6.1 运行与尝试

统一 API/Mock/界面状态枚举为小写：queued、running、validating、publishing、succeeded、failed、blocked、canceled；标签由前端领域词典映射。枚举在契约实施时只有一个来源。

~~~text
queued -> running -> validating -> publishing -> succeeded
   |         |          |
   +---------+----------+-> canceled（发布意图提交前）
   |         |          +-> blocked（质量规则 BLOCK）
   +---------+----------+-> failed（已确定本次失败）
publishing -> failed（仅在确认没有成功发布后）
failed / blocked -> 创建新 runId，retryOfRunId 指向原运行，新运行从 queued 开始
~~~

- succeeded/failed/blocked/canceled 是终态，不能原地“重新运行”；重试新建关联运行，旧日志/版本/结果保持可追踪。任务暂停只阻止未来触发，不暗中取消运行。
- 每次运行绑定 immutable datasetVersion 及 policyVersion，重试默认沿用原版本；若配置/策略已修改，应明确作为基于新版本的新运行，而非覆盖旧运行定义。
- queued/running/validating 可请求取消；取消与发布意图提交采用持久版本条件检查，只有一个动作获胜。进入 publishing 后取消返回明确冲突，不能把已发布数据伪装成 canceled。
- 自动/手动重试沿用同一规则，不把 RETRYING 作为另一套公开状态；界面显示关联与尝试编号。恢复“同一次运行”的未完成加载/发布对账不等于创建新尝试。
- dataset_run 至少记录 runId、retryOfRunId、attempt、datasetId/version、triggerType、时间、status、输入/输出游标、计数、schemaHash、质量结果、错误码、workerId 与 leaseEpoch。

### 6.2 持久化发布与游标

1. 持久化 run 与唯一批次/发布标识，记录输入版本和游标范围；原始数据落地可记录 rawCursor，用于恢复读取。
2. 转换、脱敏和质量检查在 staging/隔离区完成；BLOCK 不发布。节点完成只推进执行检查点，不提前推进面向增量的成功游标。
3. 提交发布意图，包含 datasetVersion、runId、目标、写入策略、幂等键和 worker fencing/leaseEpoch；通过条件更新确定发布所有者。
4. 适配器执行支持的发布操作并确认结果；成功记录与 successCursor 更新在 PostgreSQL 的短事务中提交。只记录与该成功批次相符的游标，过期 Worker 不得覆盖更新。
5. 如果目标已经成功但元数据库确认失败，保留发布意图并按同一标识查询结果/重试确认；若目标结果未知，保持 publishing 等待对账，不能直接判失败再盲目加载。

PostgreSQL、对象存储和 Doris 不假设有一个共同事务。每个适配器必须声明查询加载/发布状态、重复提交、可见性和补偿的能力；不足以证明幂等或原子性的模式不对外承诺。幂等和恢复实现后才可宣称这些不变量得到验证。

### 6.3 重试与租约

网络、限流和临时仓库错误可在有界次数/期限内退避重试；schema 不兼容、权限错误、参数错误和质量阻断不自动无限重试。写请求必须先确定结果或使用已验证幂等机制；不能遇到超时就认定未写入。

Worker 使用租约/心跳和单调 fencing token；接管时确认旧 Worker 无权提交发布或游标。重放沿用不可变批次标识，控制原始落地、staging、发布记录和过期对象的清理策略。

### 6.4 数据正确性不变量

| 不变量 | 验证场景 |
|---|---|
| 发布版本不可变，运行绑定版本 | 发布后编辑不改变历史运行；恢复版本产生新草稿 |
| 单次请求有明确幂等范围 | 同键/同请求返回原结果；同键/不同请求冲突；范围含工作区/动作/资源 |
| BLOCK 不污染可见结果 | 质量阻断不发布，不推进 successCursor |
| 成功游标只对应已确认批次 | 目标成功/元数据失败、超时未知、重启对账后不重复或漏过数据 |
| 租约失效阻止旧执行者提交 | 双 Worker 接管，旧 epoch 发布和游标写入失败 |
| 取消与发布互斥 | 竞态下不能同时报告 canceled 和成功发布 |
| 显式值不丢失 | PATCH 区分缺失/null/false/0/空值；行数/高精度转换不溢出 |
| 隔离与审计完整 | 越权不能查询/导出；敏感值不进入日志；修改与审计关联 requestId/runId |

这些是实现验收要求，不是当前 Mock 已证明的分布式保证。前端先演示可观察状态和失败分支，后端阶段通过真实引擎及确定性故障注入验证。

## 7. 权限、审计和血缘

权限粒度包括数据源、数据集、表、字段、行和操作级别。操作至少覆盖查看、编辑、运行、导出、发布、查看原文。

血缘边：

~~~text
source_object -> source_field
source_field -> dataset_node
dataset_node -> dataset_field
dataset_field -> warehouse_column
warehouse_column -> API/report consumer
~~~

SQL 解析器提取表、字段、表达式和 Join。无法解析的自定义表达式保留节点级血缘，不能伪造字段级精度。

以下为长期生产安全基线；第一版本地例外与实际权限见 §12：

- 外部请求启用 SSRF 防护、域名/IP 白名单和危险端口拦截。
- 数据源账号最小权限，默认只读。
- 密码、Token、私钥不进入前端、日志和异常栈。
- 元数据库、对象存储和 Doris 启用传输加密。
- SQL 只允许白名单语法，禁止 DDL、文件写出和多语句执行。
- 导出需要单独权限、行数限制和审计。
- 删除源或数据集前展示影响范围。
- 日志中的邮箱、手机号、Token 和连接串统一脱敏。

### 7.1 真实认证与会话验证

已接入系统账号、Argon2id、服务端会话、CSRF/Origin 检查、登录限流、退出/改密/停用撤销。适用 OWASP 指南版本与实际验证记录见 §14.1；不因采用某库就宣称安全认证。Mock 仍只控制演示身份。

首版为单工作区固定角色，私有查询/导出按创建者隔离；未实现逐对象授权、敏感操作再认证及独立 export 权限。审计不保存密码、可用 Token 或原始行。外部源要求 TLS，本地回环连接允许已固定公钥认证；元数据库、对象存储与 Doris 的本地服务连接尚未启用 TLS，S3 原始对象未启用服务端加密。

## 8. API 设计

以下为长期资源草图，实际路径、结构与返回码唯一源是 packages/contracts/openapi.yaml；当前实现按 §12/§14 声明。

### 数据源

~~~text
POST   /api/v1/sources
POST   /api/v1/sources/{id}/test
GET    /api/v1/sources/{id}/catalog
GET    /api/v1/sources/{id}/objects
GET    /api/v1/sources/{id}/objects/{objectId}/fields
POST   /api/v1/sources/{id}/preview
POST   /api/v1/sources/{id}/sync
GET    /api/v1/sources/{id}/runs
~~~

### 数据集

~~~text
POST   /api/v1/datasets
GET    /api/v1/datasets/{id}
PUT    /api/v1/datasets/{id}/definition
POST   /api/v1/datasets/{id}/validate
POST   /api/v1/datasets/{id}/preview
POST   /api/v1/datasets/{id}/publish
POST   /api/v1/datasets/{id}/run
POST   /api/v1/datasets/{id}/backfill
GET    /api/v1/datasets/{id}/runs
GET    /api/v1/datasets/{id}/lineage
~~~

### 仓库

~~~text
GET    /api/v1/warehouse/tables
GET    /api/v1/warehouse/tables/{id}/schema
POST   /api/v1/query
POST   /api/v1/query/async
GET    /api/v1/query/{id}
POST   /api/v1/export
~~~

长任务返回 runId，不让 HTTP 请求一直等待。所有接口使用统一 requestId、分页、错误码和审计字段。

## 9. 推荐元数据表

~~~text
iam_user, iam_role, iam_policy
secret_ref
source_connection, source_object, source_field
source_checkpoint, source_run, source_run_log
dataset, dataset_node, dataset_field, dataset_edge
dataset_transform, dataset_mask_policy
dataset_quality_rule, dataset_quality_result
dataset_schedule, dataset_run, dataset_run_log
warehouse_table, warehouse_column, warehouse_publish
lineage_edge
audit_event
~~~

原始源行不进入元数据库。首版查询/导出使用有上限的已处理结果，按账号私有地存于 PostgreSQL；原始已选字段批次存 S3。长期大结果改为受控对象文件，不把此本地方案当作生产容量设计。

## 10. 全栈仓库目录

### 10.1 仓库级布局

采用同一仓库、分别构建和部署的布局。apps 放可运行应用，modules 放后端内部库，packages/contracts 放语言无关协议及生成工具。前端内部 modules 与根目录 modules 不是同一层。

~~~text
jiuzhang/
  AGENTS.md
  package.json / pnpm-workspace.yaml / pnpm-lock.yaml  # 前端与契约工具，已建立
  pom.xml / mvnw / mvnw.cmd / .mvn/                   # 已建立
  apps/
    web/                                              # Vue 应用，pnpm 管理
      package.json
      src/{app,pages,modules,shared,mocks}/
      tests/{integration,e2e,support}/
    api/                                              # 已实现 Spring Boot HTTP 应用
      AGENTS.md                                       # 后端共用规则
      pom.xml
      src/main/java/<base>/api/
        web/                                          # controllers、DTO mapper、HTTP errors
        security/                                     # 认证与请求上下文适配
        configuration/                                # 组合领域用例与基础设施
      src/main/resources/application.yaml
      src/test/java/
    worker/                                           # 已实现独立执行进程
      pom.xml
      src/main/java/<base>/worker/
        execution/                                    # 任务领取、调用用例、心跳/取消协调
        configuration/
      src/main/resources/application.yaml
      src/test/java/
  modules/                                            # 未来 Maven 库，禁止放 Vue/TS
    platform/                                         # 后端首期一个库，内部按领域隔离
      pom.xml
      src/main/java/<base>/
        sources/ datasets/ jobs/ warehouse/
        governance/ identity/ services/ lineage/ secrets/ audit/
      src/test/java/
    connector-spi/                                    # 独立读取能力和批次协议
    connector-jdbc/                                   # 按真实接入需求逐个建立
    connector-http/
    connector-file/
  packages/
    contracts/                                       # 协议的唯一来源，非公共业务工具箱
      AGENTS.md
      package.json                                   # 校验/生成工具，已建立
      openapi.yaml
      generated/schema.d.ts                          # TypeScript 生成类型
      examples/                                      # 前后端可共同验证的虚构样例
  infra/                                              # 后端阶段建立
    compose/                                          # 集成环境
    migrations/postgresql/                            # 元数据库迁移唯一源
    deploy/                                           # 部署配置，无真实密钥
  tools/                                              # 检查器和测试编排
  docs/
~~~

这是包含长期扩展的目标布局。当前已建立 apps/web、apps/api、apps/worker、modules/platform、packages/contracts、infra/migrations 与 Maven Wrapper，以及本地生命周期/验收脚本；仅长期扩展目录按需新增。apps/api 与 apps/worker 不互相依赖，分别装配 modules/platform 的公开用例、连接器及仓库适配器。modules/platform 是首期单一后端库，sources 等是 Java 包级业务边界，并非十个服务或十个 Maven 工程；ArchUnit 验证依赖和跨域公开接口。只有出现独立消费者、插件分发或明确构建隔离需求时才抽出领域库。

`<base>` 是待后端初始化时确定的 Java 包前缀，不代表现有包。Java 源遵循标准 src/main/java 与 src/test/java，API/Worker 配置各自维护，示例配置只放占位值。

### 10.2 后端领域内部结构

~~~text
modules/platform/src/main/java/<base>/sources/
  application/       # 公开用例、command/result；跨域只走明确公开接口
  domain/            # 实体、值对象、不变量、ports；不依赖 Spring/JDBC/HTTP
  infrastructure/    # 元库 Repository、外部适配实现；依赖 domain 的 ports
~~~

REST Controller 与 HTTP DTO mapper 属于 `apps/api/src/main/java/<base>/api/web`，Worker 调用 application 用例，二者不直接操作领域私有 Repository/DAO。modules/platform 的 infrastructure 可以有框架依赖，但 domain 包不能因为同一 jar 就越界。warehouse 的 Port 与 Doris 适配器首期留在 warehouse 的领域/基础设施包中，不提前再建独立 warehouse-spi 工程。

`apps/web/src/modules/sources` 只含源表单、Query/composable 和 HTTP repository；`modules/platform/src/main/java/<base>/sources` 才实现真实服务端规则。这两个模块按业务概念对应，通过 /api/v1 和 contracts 协作，禁止相互源码导入。

### 10.3 构建、契约与迁移所有权

| 事项 | 规划与边界 |
|---|---|
| pnpm 范围 | 明确列入 apps/web、packages/contracts；未来有新 JS 包再加入，不把 apps/api/worker 当 Node 包 |
| Maven 范围 | 根 pom 聚合实际已创建的 apps/api、apps/worker 与 modules 库；不存在的候选不写入 reactor |
| 根命令 | pnpm dev/build/check 默认只覆盖前端及契约；后端用 Maven Wrapper，不让启动前端触发 Java/数据库/Docker |
| Java 工具链 | 后端阶段统一锁定 JDK、Maven/插件和依赖组合；前端开发无需安装 JDK |
| contracts | OpenAPI 是共同协议；TS 声明供前端用，Java 不读取 schema.d.ts，也不把 ORM Entity 发给前端 |
| Java DTO | 后端阶段选择并固定一种 DTO/接口生成或契约校验方式；若生成，产物放 API 的 target/generated-sources，由 mapper 转为应用输入，不生成覆盖 Domain |
| 元数据迁移 | infra/migrations/postgresql 是唯一可编辑源；Maven 显式作为受版本管理的资源打包，运行时不依赖仓库绝对路径 |
| 迁移执行 | 部署时单一受控 migration 步骤/角色执行 Flyway，API/Worker 常规业务身份不并发执行 schema 修改；Worker 不能擅自升级数据库 |
| 产物 | web dist、API jar/image、Worker jar/image 独立交付；父 pom 与 workspace 不等于单一部署物 |

pnpm workspace 路径配置和 Maven reactor/依赖排序按官方机制实施，参考 [pnpm workspace 配置](https://pnpm.io/pnpm-workspace_yaml) 与 [Maven 多模块指南](https://maven.apache.org/guides/mini/guide-multiple-modules.html)。此处未创建这些构建文件，也未声称已独立编译通过。

### 10.4 前后端集成与 CI

- web 变化：前端类型、边界、UI/文案、行为测试与构建；当前 Mock 流程不依赖 Java。
- contracts 变化：schema/生成漂移/样例，前端消费者；后端创建后同时验证 Java DTO/实际 API 响应，破坏性变更声明兼容窗口。
- api/worker/platform/connector 变化：后端构建、ArchUnit、用例及受影响真实引擎测试；改接口时同时验证前端消费者。
- migrations 变化：新建、旧版本升级、重复执行/重启及数据保留；不是只跑 SQL 文本检查。
- 根工具链/共享 CI 变化：覆盖受影响构建；稳定的顶层必需检查汇总实际执行与合理跳过原因，避免路径过滤让保护检查永远 pending 或误报通过。

模块多不代表分支多。同一功能涉及契约和两端时可在一个任务分支保持一致；需要拆分交付时先兼容增加接口，再迁移消费者，最后移除旧接口。具体 Git 工作流见 [根规范](../AGENTS.md#git-分支提交与合并)。

## 11. 开发和部署

### 11.1 独立 Mock 前端

只启动前端开发服务器，数据经 HTTP 被 MSW 拦截并持久化到本地 Mock DB。项目 Node/pnpm 要求、根命令和浏览器验收见 [前端启动方案](frontend-design.md#10-从本地启动到看到页面)；不需要数据库、对象存储或容器。个人工具安装和终端设置不属于仓库规范。

### 11.2 后端集成环境

首版本地 Compose 已提供 PostgreSQL、MySQL、SeaweedFS S3、Doris；API、Worker 与 real 前端由 `bash tools/local.sh up` 管理，具体前置依赖、端口、凭证与启停见 README。Redis 尚未引入。开发服务的版本和配置来自项目文件，不依赖某位开发者的全局目录或隐含工具。

### 11.3 持久化支持与验证矩阵

| 边界 | 首期支持计划 | 发生相关变更时的验证 |
|---|---|---|
| 元数据库 | PostgreSQL；不默认兼容 MySQL/SQLite | 空库创建、代表性旧版本升级、重复迁移/启动；数据、索引、唯一约束及事务保持 |
| 源端连接器 | 按批次承诺的数据库/API/文件类型与版本 | 真实驱动/引擎发现、只读读取、类型/时区/分页/游标、断连与恢复；独立列版本 |
| 分析仓库 | 首个 Doris 适配器 | 实际加载/确认、重复提交、UPSERT/分区发布能力、超时未知和重启恢复；不以其他方言代测 |
| 对象存储 | 选定 S3 兼容实现 | 写读、分页、分段上传、权限/错误、重试清理；声称兼容多个实现时逐一验证差异 |
| Mock DB | 当前 IndexedDB | seed/reset、版本迁移、CRUD 事务、引用、字段值语义；不代替上述真实引擎测试 |

数据库驱动、框架数据访问组件和迁移工具按兼容组合管理，升级其一不推定其他仍兼容。涉及版本特性时验证支持下限；没有确定版本或未运行验证时标为待验证，不写“已支持”。报告中保留实际版本、命令和结果。

### 11.4 生产部署

API、Worker、Web 可独立部署，任务状态与检查点外置；重启恢复不能依赖进程内缓存。Quartz 使用持久 JobStore，跨节点调度、失效接管和重复触发须真实验证；对象存储和 Doris 按目标可用性部署；密钥外置。元数据库、原始对象、仓库数据和发布记录均纳入备份/恢复演练。

生产编排根据部署规模决定，不以引入 Kubernetes 作为项目完成的前置条件。

## 12. 分阶段交付

### 12.1 当前进度（2026-10-19）

用户已确认全部首版规则并授权实施。产品文案已统一为“九章数据工作台”（6c95ef7e），旧工程 19224 个文件的删除已独立提交（01a493dd），不再处于“先别开发”阶段。当前交付目标仍是本地单机验证。

| 功能块 | 状态 | 实际范围 |
|---|---|---|
| Mock B0–B5 | 保留原桌面验收 | 38 路由、190 项历史 E2E；不据此宣称真实能力 |
| M0 工程/身份 | 已实现并本地验证 | Maven/API/Worker/PostgreSQL/Flyway、系统账号/会话/角色/审计 |
| M1 MySQL | 已实现并真实验证 | 只读连接、目录/字段/预览、InnoDB 一致性读取、精度/大小/超时约束 |
| M2 数据集/执行 | 已实现并真实验证 | 草稿/不可变版本、单表清洗/过滤/质量/脱敏、手动运行/取消/新运行重试、租约/恢复 |
| M3 Doris/读取 | 已实现并真实验证 | 不可变表＋逻辑 VIEW 发布、空覆盖保护、历史回收、浏览/受控 SQL/私有 CSV |
| 本地交付 | 已实现，入口见 README | 统一基础设施就绪、安装/构建/迁移、受管进程启停、顺序验收 |
| G2/生产 M4 | 未完成 | 远端 CI/main 保护、生产 TLS/密钥/备份、行列/对象权限、监控/负载与集群运维 |

功能提交依次为 78019305、ea334f6c、4f5eabea、5f0063e2、cc3ecbeb、c1bd9a8f、e39e3648；后续提交以 Git 记录为准。实际命令、版本与故障证据见 §14。前端历史全量发生于 2026-10-17，2026-10-19 重新执行 pnpm check 和真实桌面流程，不将历史全量当作当天重跑。

### 12.2 已确认并落实的数据规则

- 单工作区、首个真实源 MySQL、系统账号、本地单机、单源单表手动全量，每个数据集独占逻辑目标，重复运行替换完整快照，不累加旧批次。
- 首次零行允许；当前非空而新结果为零默认 blocked。仅管理员可批准本次空覆盖，不绕过读取失败、转换失败或质量 BLOCK。
- 发布冻结已使用字段结构、质量与脱敏规则，运行绑定版本。未使用字段增删不阻断；使用字段删除/改名/类型/精度/长度/可空性变化阻断。字段顺序/注释变化不阻断。
- 同数据集只能一个非终态运行，取消中继续占用，第一版不排队。retry 创建新运行并绑定原版本，幂等键重复不得创建额外运行。
- 当前快照不清理；历史最多三份且被替换后最多七天，先到者生效。旧副本清理不删除运行记录/版本，历史原始对象随副本回收；失败暂存产物有补偿清理。
- 发布前失败不影响当前快照，publishing 结果未知不直接失败/重跑源；对账实际 Doris VIEW 后提交元数据。过期租约不能继续发布。

### 12.3 首版权限与运行限制

| 角色 | 允许 |
|---|---|
| admin | 全部首版读/写、用户与审计、原始预览、本次空覆盖批准 |
| developer | 读、数据源/数据集/规则配置、发布、手动运行/取消/重试 |
| viewer | 读已处理仓库、只读查询与本人 CSV 导出 |

首版固定角色授权，没有逐对象权限或独立 export 权限；查询/导出按创建者隔离。敏感输出必须启用脱敏策略，质量检查在脱敏前。长期完整权限模型不等于首版已实现。

保护上限为 200 源表/200 字段，源扫描 100 万行/600 秒，原始批次 256 MiB；查询默认 100/最多 1000 行，15 秒、10 MiB，CSV 24 小时过期。运行列表及部分累计统计最多最近 10000 条，工作台聚合使用完整数据库统计。仓库容量与趋势未采集，不显示为真实零值。以上是保护上限，未进行规模/吞吐承诺。

本地实际支持组合：Java 21.0.12.1、Spring Boot 3.5.16、Maven 3.9.11、PostgreSQL 17.6、MySQL 8.4.6、Doris 3.0.8、SeaweedFS 3.97。API/数据库/S3 仅回环暴露，服务间未 TLS、原始对象未服务端加密；不用于生产安全承诺。

### 12.4 暂缓能力与后续工作

1. 依据首版本地使用反馈修正流程与实际故障，不再重建 Mock 或清理已删除旧工程。
2. 获得对应授权后验证远端 CI/main 保护，不能把本地通过当作远端通过。
3. 下一阶段按需求选择 Cron、其他数据库/API 连接器或增量；需补真实引擎支持矩阵、状态/契约和验收，不能直接将 Mock 功能打开。
4. 生产化单列密钥托管/轮换、TLS/加密、备份恢复、监控、权限和容量基准，性能目标先定义再测量。

暂缓 Join/聚合/任意加工 SQL、CDC/upsert、自动重试/补数/依赖、多工作区、数据服务、生产集群。不为本次交付启动未来基础设施或附加微服务。

### 12.5 验收与所有权

README 拥有启动和验证入口；本节维护范围/状态；§14 记录实际验证；页面矩阵区分 Mock 与 real。功能按契约→实现→消费者→验证→本地提交，完成一块立即提交。未授权 push/PR/发布，本次不执行。

真实验收包含账号越权、精度/null/零、不可变版本、空覆盖、结构变化、质量/脱敏、并发拒绝、取消/重试、Doris 读取与私有导出、真实 SIGKILL 读取/发布断点恢复。原始记录/大规模负载、生产集群、多 Worker 扩展和远端 CI 仍有独立边界，不能用本地三行合成样本证明容量或生产安全。

## 13. 第一版明确不做

- 不把 Airbyte 作为运行时依赖。
- 不直接复制 Crest 的 BI 图表、仪表盘和大屏模块。
- 不在第一版引入 Spark、Flink、Kafka、Trino 等重型组件，除非数据规模证明需要。
- 不允许任意用户代码直接访问源数据库、宿主机文件系统或内网地址。
- 不把数据库元数据和业务事实数据混在同一个 schema 中。
- 不把查询缓存当作仓库的唯一持久化副本。

## 14. 核心决策

Vue Mock 与首版本地真实流程已分别验证。当前实现组合如下，具体版本与证据见本节记录；Quartz 等后续能力未实现：

~~~text
Spring Boot API + Java Worker
PostgreSQL 元数据库
SeaweedFS S3 原始区
Apache Doris 仓库
持久运行记录与租约，手动触发
Vue 3 管理端
~~~

这套设计保留了 Crest 的数据源与数据集资源思路，同时增加真正的仓库层、可恢复执行、脱敏、质量、血缘和高性能服务接口。后续如果数据规模或实时性要求增长，只需要替换执行器和消息层，数据源、数据集、仓库适配器和元数据 API 可以继续保留。

### 14.1 首版实施记录：账号与会话（2026-10-19）

- M0 工程基础提交 `78019305`；账号块实现初始化管理员、登录/退出、修改密码、管理员创建/编辑/停用账号、固定角色权限和审计。服务端会话不依赖浏览器演示角色。
- 参考 OWASP ASVS **5.0.0 V7**、Password Storage / Session Management Cheat Sheets：Argon2id 19 MiB、2 次迭代、并行度 1；256 bit 随机会话，数据库只保存会话 Token 哈希；浏览器 HttpOnly、SameSite=Strict Cookie；CSRF Token 仅在前端内存和服务端保存，不写 localStorage。
- 本地 HTTP 默认绑定回环地址；正式 TLS 部署必须设置 `JIUZHANG_COOKIE_SECURE=true` 和精确的 `JIUZHANG_BROWSER_ORIGIN`。绝对会话 8 小时、空闲 30 分钟；退出/密码修改/停用/角色变化使对应会话失效。首次启动需要私有环境文件中的随机初始化密码，已有账号不会被启动参数重置。
- 每账号/IP 五次失败后限制 15 分钟；身份与密码不存在性统一错误；保留最后一名启用管理员。源码/日志/API 响应不包含密码哈希或原始会话 Cookie。
- 实际验证：Maven verify；真实 PostgreSQL 迁移 V001→V002；`tools/test-identity.py` 覆盖 Cookie、未登录/越权、CSRF/Origin、最后管理员、停用、密码/退出撤销、限流和审计；1280×1000 真实浏览器登录失败/成功、刷新恢复、用户表单取消、密码失败、退出；Mock 用户管理定向 E2E 1 项通过。完整 pnpm check 包含 14 文件 93 项测试、两种构建通过；最后文案/Mock 小改后静态检查通过。
- 真实 UI 使用独立端口 5175；Mock 保持 5174。真实 API 不支持的功能返回 NOT_IMPLEMENTED，不回退 Mock。该账号块提交时尚未实现真实 MySQL/数据集执行/Doris，后续实现与验收见以下记录；工程或账号通过不代表全版本验收。ASVS 是设计依据，不是安全认证结论。

### 14.2 首版实施记录：MySQL 接入（2026-10-19）

- SourceConnector 为纯 Java Port；JDBC 适配器实现只读权限检查、200 表/200 字段目录上限、100 行预览、5 秒连接/30 秒 socket 超时；非本机要求 TLS VERIFY_IDENTITY，地址白名单默认仅回环。元数据与 AES-256-GCM 源密钥引用分表保存，主密钥仅进程环境提供，AAD 绑定 source ID，API 不返回密码。
- 保存/编辑/删除走数据源用例及短事务；浏览器凭证只保留在临时表单中，保存后清除，不写 Pinia/localStorage/IndexedDB；Mock 忽略凭证且拒绝保存账号密码。真实预览要求 readSensitive，目录不读取明细。单工作区对象权限采用固定服务端角色；后续多工作区必须另设归属。
- JDK 21/Spring Boot 3.5.16 的实际托管 MySQL 驱动与 MySQL 8.4.6 真实连接、catalog、错误凭证/拒绝主机、只读权限、预览、字段、PATCH 空字符串/false、编辑密码保留已通过。超安全整数 BIGINT 与 Decimal(20,4) 保留精确字符串，null 不替换为 0。`test-source-snapshot.py` 真实覆盖全量读取一致性和取消/schema变化；1280×1000 页面创建→测试→目录→预览→编辑复测通过。完整 pnpm check 再次通过，含 93 单元/HTTP 测试和两种构建。
- 一致性全量扫描仅对 InnoDB，使用 REPEATABLE READ + consistent snapshot + read only；事务元数据锁后检查已使用字段，使用服务端游标分批；最多 100 万行/10 分钟。1200 行跨批次、并发更新/插入隔离、DDL 等锁、后续扫描读取新值、取消、null/Decimal 与 schema drift 已用真实引擎验证。这个样本不是 100 万行容量/吞吐测试。


### 14.3 数据集与治理规则真实闭环（2026-10-19）

已实现持久草稿、字段选择/改名/精确类型转换、等值过滤、trim、必填与范围质量、字符串部分脱敏的配置与预览；发布冻结定义、质量/脱敏规则及源字段契约，恢复只创建草稿。发布使用按用户/数据集作用域的幂等键，重复键复用版本；目标表名创建后固定。敏感输出必须绑定启用的字符串脱敏策略。第一版拒绝 SQL 加工、多源、复杂画布、自动调度/重试和非 replace 写入，Mock 功能仍保留。

Maven verify（新增 4 项领域测试）、V003→V004 实际 PostgreSQL 升级、tools/test-datasets.py（实际 MySQL/API/PostgreSQL）与 tools/test-real-datasets.mjs（1280×1000 预览/保存/发布）通过；前端 pnpm check 的静态门禁、93 项测试和两种构建通过。完整 Worker/入仓验收仍在后续功能块，不把样本预览当全量质量验收。


### 14.4 手动全量执行与仓库读写（2026-10-19）

已接通 API → PostgreSQL 持久运行 → Worker → MySQL InnoDB 一致性读取 → 转换/质量/脱敏 → 私有 S3 兼容原始批次 → Doris 独立物理快照 → 稳定逻辑视图。逻辑目标在 Doris 中实际存在，可直接 SELECT；发布是将视图显式指向不可变表，不采用会在重复执行时翻回旧数据的 swap。PostgreSQL 与 Doris 不宣称跨系统事务：publishing 在租约超时后以 SHOW CREATE VIEW 对账，相同指向可重复赋值，确认后才提交成功；发布时短暂锁定数据集及运行行，租约失效的 Worker 不能继续提交。读取/加载不占元数据事务。

单数据集活动运行由 PostgreSQL 唯一索引强制，重复幂等请求返回原运行，取消中不释放；重试创建新运行并保留原发布版本。非空→零行默认 blocked，管理员可显式批准本次空覆盖；质量/读取错误仍阻断。当前快照不清理，历史最多 3 份且被替换后最多 7 天；读取和清理协调使用同一数据集锁。原始对象仅 Worker 私有访问，浏览器无对象存储凭证或下载接口。

仓库接口返回实际 Doris 数据，整数/Decimal 保持字符串；SQL 第一版只支持单表字段投影、LIMIT 1–1000、OFFSET ≤1,000,000，默认 100 行，15 秒超时、10MiB 结果上限，使用 JSqlParser 和封闭语法验证后重建 SQL。拒绝 DML、函数、JOIN、子查询、多语句和内部物理表。查询/CSV 导出归创建者，CSV 防公式注入、24 小时可读有效期，导出范围为已查询结果。原始批次单次最多 256MiB、源读取最多 1,000,000 行、最长 600 秒；这些是资源上限，不是吞吐承诺。

本地真实环境：Doris 3.0.8、SeaweedFS 3.97 S3 兼容接口（固定镜像 digest；本地验证使用，非生产部署结论）。Maven verify、前端 pnpm check、tools/test-execution.py、tools/test-warehouse.py、tools/test-execution-safety.py 与 tools/test-real-execution.mjs（1280×1000）实际通过。覆盖成功、重复覆盖与源端删除、空阻断/批准、未使用字段增删、已使用类型变化、重试版本、活动互斥、取消、发布对账、保留上限、精度/null、SQL 拒绝、私有查询/导出；进程恢复与本地交付验收见 §14.6–§14.9。

### 14.5 真实模式入口与工作台（2026-10-19）

- 工作台在 PostgreSQL 可重复读事务中汇总完整来源、数据集、运行、当前快照与近七日趋势；失败列表先筛选再取五条。审计活动仅管理员可见。
- 真实模式导航仅展示首版已实现能力，直接访问任务调度、导入、服务等暂缓路由显示明确说明；Mock 的 38 个路由保持可用。
- 数据集目录移动/复制在真实模式禁用，仓库容量显示未采集，避免以占位零值表示真实容量。查询失败按服务端错误码显示。
- 实际验证：Maven verify、pnpm check（93 个测试、Mock/real 双构建）、test-overview.py、test-real-overview.mjs；浏览器仅 1280×1000。

### 14.6 进程故障与产物回收（2026-10-19）

- V006 在运行记录中保存暂存物理表与原始对象归属。失败、阻断与取消后清理产物；崩溃遗留由 Worker 定期补偿（终态至少五分钟后）。临时 NDJSON 位于私有 `.local/raw`，正常退出删除，崩溃后按运行归属清理。
- 历史快照按三份/七天策略回收物理表及对应原始对象；当前快照保留。原始对象尚未启用服务端加密，本地私有存储与磁盘权限不构成生产安全保障。
- 终态写入要求有效租约；版本/计划解析进入受保护执行块；暂存提交响应不确定时先查持久发布状态，不能误删已发布或待对账表。
- `test-worker-recovery.py` 实际 SIGKILL：①持有真实 MySQL 写锁时中断读取，等待自然 90 秒租约到期，旧快照不变，新运行重试成功；②通过 PostgreSQL 测试触发器暂停成功 UPDATE，确认实际 Doris VIEW 已指向新物理表后杀进程，移除测试触发器，等待自然租约过期并对账成功。该脚本必须独占 Worker，仅操作合成验收数据集。
- `test-real-contracts.mjs` 对 34 个真实成功/错误响应执行 OpenAPI 3.1/AJV 校验。Maven verify 与真实执行、空覆盖/结构变化/并发/取消/保留策略回归通过。
- 应用层 JSON 编码通过 JsonWriter Port，ArchUnit 额外禁止 application 导入 infrastructure/JDBC。

### 14.7 本地交付与最终验收（2026-10-19）

- `bash tools/local.sh up` 提供基础设施就绪、冻结安装、后端验证/迁移及 API/Worker/real Web 启动；`status/start/stop` 依据 PID 与进程启动时间管理本脚本进程，不停止未托管进程或清数据卷。源 fixtures 仅由空 MySQL 卷初始化，不在每次启动重新插入已删除行。
- S3 就绪使用带身份签名的 bucket/对象写入、读取与删除，不将端口开放当作服务可用。Doris 等待实际 backend 存活；迁移前拒绝仍在运行的 API/Worker。
- `test-local-lifecycle.py` 实际完整停止→up→再次 start，API/Worker/Web 就绪，账号、数据集、版本、运行、当前快照指针与源订单数据保持不变。`test-migrations.py` 在独占临时 PostgreSQL 数据库执行 V001–V006，再重复迁移，验证数据/索引/约束保留；结束删除该临时库，不清当前库。
- `test-execution-rules.py` 真实验证首次零行、质量 BLOCK/WARN、冻结规则重试、Decimal 收窄溢出，以及已使用字段长度/可空性/删除变化；失败或阻断保留当前快照。
- `test-storage-recovery.py` 真实停止/恢复 S3 与 Doris FE，故障运行失败且旧快照不变，恢复就绪后新运行重试成功；仅将合成历史记录的替换时间推进到八天前，验证定期清理实际 Doris 表与 S3 原始对象，同时保留当前快照与对象。没有等待真实七个自然日，也不据此声称生产集群故障矩阵已覆盖。
- `bash tools/local.sh verify` 顺序验收真实迁移、身份、MySQL、数据集、执行/安全/规则、Doris 查询/CSV、完整首页汇总、34 个 OpenAPI 响应与 1280×1000 浏览器流程。真实 Worker SIGKILL 测试为 §14.6 的独占入口，不混入常规 verify。
- 最终 `pnpm check` 通过：14 文件 93 项单元/HTTP 测试、契约/边界/UI/i18n/lint/格式/类型及 Mock/real 双构建；Maven verify 10 项测试与所有模块构建通过。另运行 `sources.spec.ts quality-rules.spec.ts tabs.spec.ts`，1280×1000 Mock 回归 23 项通过。
- real 隐藏质量模拟结果按钮，实际结果来自已发布数据集运行；非管理员不自动请求原始预览，禁用相应按钮。未实现同步/血缘/目录入口隐藏。页面修补独立提交 `55012e98`。
- 本地执行日志在 `/tmp/jiuzhang-{real-final-verify,final-check,lifecycle-final,migrations-final,storage-recovery-final,final-mock-regression}.log`，属于临时证据；复现依赖仓库脚本。远端 CI/分支保护、生产 TLS/加密/备份、多 Worker/容量压测未验证；Mock 大 chunk 构建警告保留。

### 14.8 查询结果读取预算（2026-10-19）

- 完成审计发现原 10 MiB 结果上限在全量读取后检查，不能限制 JDBC 缓冲和应用结果积累。Doris 读取改用 Connector/J 流式结果，逐行计算实际 UTF-8 JSON 字节（含转义、逗号和数组界限）；超限立即中止连接，不再读取或持久化后续结果。表样本与 SQL 查询共用读取预算和限制所有者。
- 三项新增单元测试覆盖提前停止、精确边界/转义与 null/大整数/Decimal 文本。`test-result-budget.py` 实际创建 190 行、每行 60000 字节的合成源，完整入仓成功；100 行样本可读，1000 行上限查询超过 10 MiB 时返回 QUERY_RESULT_LIMIT，数据库不新增查询结果，后续两行查询成功且当前快照不变。此样本验证资源保护，不是容量或吞吐基准。
- `local.sh verify` 已接入真实大结果验收。未改变 OpenAPI、前端或 Mock 行为；精确版本沿用已验证组合。

### 14.9 MySQL 一致性读取边界（2026-10-19）

- `test-source-snapshot.py` 通过 Java source launcher 直接调用真实 `MySqlConnector`，用只读连接读取专用 InnoDB 表 1200 行，横跨多个 500 行 cursor 批次。读取首行后并发 UPDATE/INSERT 并发起 ALTER TABLE，现场检查 MySQL processlist 确认 DDL 等待 metadata lock。
- 扫描仍返回事务开始时的 1200 行及旧值/null/Decimal `12345.6700`；提交后下一扫描读取 1201 行与新值。另验证消费者请求取消返回 RUN_CANCELED，已使用 Decimal 精度结构变化在消费数据前返回 SCHEMA_CHANGED。测试表在 finally 清理，正式样本不被修改。
- 常规本地 `verify` 在创建并发现测试 MySQL 源后执行此项；不是模拟 connector，也不代表 100 万行上限的吞吐测试。

### 14.10 过期导出内容清理（2026-10-19）

- CSV 已有 24 小时应用层过期检查，但到期正文仍长期留在 PostgreSQL JSONB。Worker 每分钟按 100 条、单轮最多 1000 条清空到期 `content`，行及文件名、创建时间等审计元数据保留；返回与幂等重放仍显示 expired，不能再次下载。
- `test-warehouse.py` 实际生成私有 CSV 后只把合成测试行的过期时间前移，等待 Worker 定时清理，再直接检查 PostgreSQL 正文为空，并验证 API 读取和原幂等键重放都返回 expired/空正文。未运行真实 24 小时等待。
- 这是活动数据库记录级清理，不声称覆盖数据库 WAL、磁盘介质或备份副本的安全擦除；这些属于部署/备份生命周期控制。
