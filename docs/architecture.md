# 九章数据仓库设计方案

> 状态：从零设计基线
> 更新时间：2026-10-15
> 参考：Crest 的数据源、数据集、同步任务、字段和执行日志资源模型。新方案只借鉴资源边界，不复用 Crest 的 BI 展示层。
> 当前执行阶段：[纯 Mock 前端设计](frontend-design.md) · [UI 与 Vue 规范](ui-conventions.md) · [AI 开发规范](ai-development.md)。new-api 组件规范的适配依据见 [对照研究](research/new-api-adaptation.md)；本文的后端/仓库部署属于后续阶段。

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

| 范围 | 决策 | 状态与约束 |
|---|---|---|
| 当前前端 | Vue 3 + TypeScript strict + Pinia + Naive UI | 已选，待实现；Vite/Vue Router/Vue Query 配合，完整清单见前端设计 |
| 当前接口/Mock | OpenAPI 3.1 + openapi-typescript/openapi-fetch + MSW + IndexedDB | 已选，待实现；运行不需要后端、数据库或容器 |
| 未来后端 | Java + Spring Boot，API 与 Worker 分进程 | 候选；不沿用未经校验的 JDK/框架主版本，启动后端阶段核验支持周期和依赖兼容 |
| 未来构建 | Maven Wrapper 多模块 | 候选；插件/依赖集中管理；领域/SPIs 仅在必要时成为独立构建单元 |
| 元数据库 | PostgreSQL | 规划；管理事务、JSON 配置、任务/版本元数据，首期只承诺一种元数据库 |
| 元数据访问/迁移 | Spring JDBC/JdbcClient + Flyway | 候选；SQL 留在基础设施适配器，Domain 不依赖表/ORM；版本适配在实施时验证 |
| 对象存储 | S3 兼容 API；MinIO 为候选实现 | 规划；原始批次、隔离记录、Parquet 中间文件，不当作事务数据库 |
| 分析仓库 | Apache Doris | 规划；首个仓库适配器，更新/加载/发布能力按已验证版本矩阵声明 |
| 调度 | Quartz + PostgreSQL | 规划；Cron/触发持久化；依赖图、幂等运行、补数与重试是 jobs 应用规则 |
| 缓存 | Redis，可选 | 规划；缓存不做业务权威状态，不以分布式锁代替持久幂等/版本控制 |
| 序列化/验证 | Spring 管理的 JSON codec + 明确 DTO 校验 | 候选；统一空值、Decimal、时间和错误映射；JSON 库不进入 Domain |
| 后端验证 | JUnit + AssertJ、ArchUnit、Testcontainers | 候选；真实引擎验证不被 Mock 替代；精确组合和命令后端阶段落实 |
| 监控 | OpenTelemetry + Prometheus + Grafana | 规划；按 runId/requestId 关联指标、日志和追踪 |
| 部署 | Compose 集成环境；按规模选择生产编排 | 后端阶段需要；当前前端仅本地静态开发服务 |

已选不等于已安装，规划不等于已经验证。版本以实施后的 manifest/wrapper/lockfile 为准，不能因为个人机器已有某版本就把它定为项目强制基线。

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

第一版建议支持：

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

安全基线：

- 外部请求启用 SSRF 防护、域名/IP 白名单和危险端口拦截。
- 数据源账号最小权限，默认只读。
- 密码、Token、私钥不进入前端、日志和异常栈。
- 元数据库、对象存储和 Doris 启用传输加密。
- SQL 只允许白名单语法，禁止 DDL、文件写出和多语句执行。
- 导出需要单独权限、行数限制和审计。
- 删除源或数据集前展示影响范围。
- 日志中的邮箱、手机号、Token 和连接串统一脱敏。

### 7.1 真实认证与会话验证

当前只有演示身份；接入真实认证、会话或凭证管理时，按当时稳定版 [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) 与适用 [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 等专题选择控制，记录实际版本/条目和验证证据。

服务端负责对象/工作区权限、会话失效/轮换、敏感操作重新验证，以及所选会话协议需要的 CSRF/重放防护。审计只保存必要非敏感上下文，不保存密码、验证码、恢复码、私钥或可使用 Token；按实际流程覆盖失败、过期、越权和撤销，不因采用某库就宣称合规。当前文档没有完成这些控制的实施或认证。

## 8. API 设计

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

元数据只保存配置、状态和统计；原始业务行、失败原文和大批次日志进入对象存储。

## 10. 全栈仓库目录

### 10.1 仓库级布局

采用同一仓库、分别构建和部署的布局。apps 放可运行应用，modules 放后端内部库，packages/contracts 放语言无关协议及生成工具。前端内部 modules 与根目录 modules 不是同一层。

~~~text
jiuzhang/
  AGENTS.md
  package.json / pnpm-workspace.yaml / pnpm-lock.yaml  # 前端与契约工具，B0 待建
  pom.xml / mvnw / mvnw.cmd / .mvn/                   # 后端阶段才建
  apps/
    web/                                              # Vue 应用，pnpm 管理
      package.json
      src/{app,pages,modules,shared,mocks}/
      tests/{integration,e2e,support}/
    api/                                              # 未来 Spring Boot HTTP 应用
      AGENTS.md                                       # 当前仅此规则已存在
      pom.xml
      src/main/java/<base>/api/
        web/                                          # controllers、DTO mapper、HTTP errors
        security/                                     # 认证与请求上下文适配
        configuration/                                # 组合领域用例与基础设施
      src/main/resources/application.yaml
      src/test/java/
    worker/                                           # 未来独立任务执行进程
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
      package.json                                   # 校验/生成工具，B0 待建
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

这是目标布局，当前只有文档与目录规则。apps/api 与 apps/worker 不互相依赖，分别装配 modules/platform 的公开用例、连接器及仓库适配器。modules/platform 是首期单一后端库，sources 等是 Java 包级业务边界，并非十个服务或十个 Maven 工程；ArchUnit 验证依赖和跨域公开接口。只有出现独立消费者、插件分发或明确构建隔离需求时才抽出领域库。

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

### 11.1 当前前端阶段

只启动前端开发服务器，数据经 HTTP 被 MSW 拦截并持久化到本地 Mock DB。项目 Node/pnpm 要求、根命令和浏览器验收见 [前端启动方案](frontend-design.md#10-从本地启动到看到页面)；不需要数据库、对象存储或容器。个人工具安装和终端设置不属于仓库规范。

### 11.2 后端集成环境

后端阶段再建立 Compose 或等效真实服务：PostgreSQL、S3 兼容存储、Doris、API 与 Worker；Redis 仅在已有功能需要时启用。开发服务的版本和配置来自项目文件，不依赖某位开发者的全局目录或隐含工具。

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

本节 M0–M4 是后端与真实数仓路线；当前先执行前端 B0–B5，参见前端方案，两个阶段不要混为同一启动要求。

### M0：骨架与元数据

- 用户、角色、数据源、数据集、任务和运行日志可创建。
- PostgreSQL 迁移可重复执行。
- API 有 OpenAPI 文档和统一错误码。
- Docker Compose 可一键启动。

### M1：数据库和 API 接入

- MySQL、PostgreSQL、REST JSON、CSV 可测试连接和发现 schema。
- API 支持分页、Bearer、游标和 JsonPath。
- 全量与时间增量任务可运行。
- 原始批次写入 MinIO，失败可重试。

### M2：数据集加工

- 支持字段映射、SQL、Join、去重、参数和预览。
- 支持 Cron、手动、补数、重试、超时和依赖。
- 支持 schema 漂移检查、质量规则和 quarantine。
- 支持字段级脱敏和策略版本。

### M3：Doris 仓库服务

- 支持 Duplicate Key、Unique Key 和分区表。
- 支持批量写入、Upsert、分区替换和原子发布。
- 支持同步查询、异步导出、查询超时和审计。
- 能从数据集字段追踪到仓库列。

### M4：生产治理

- 行级/列级权限、SSRF 防护、密钥外置、审计完整。
- Worker 失联可接管，任务可从检查点恢复。
- Prometheus 指标、告警、备份恢复演练完成。
- 连接器 SDK 和示例连接器可扩展。

## 13. 第一版明确不做

- 不把 Airbyte 作为运行时依赖。
- 不直接复制 Crest 的 BI 图表、仪表盘和大屏模块。
- 不在第一版引入 Spark、Flink、Kafka、Trino 等重型组件，除非数据规模证明需要。
- 不允许任意用户代码直接访问源数据库、宿主机文件系统或内网地址。
- 不把数据库元数据和业务事实数据混在同一个 schema 中。
- 不把查询缓存当作仓库的唯一持久化副本。

## 14. 核心决策

当前先交付 Vue 纯 Mock 前端；后端阶段的最小可行落点是：

~~~text
Spring Boot API + Java Worker
PostgreSQL 元数据库
MinIO/S3 原始区
Apache Doris 仓库
Quartz 调度
Vue 3 管理端
~~~

这套设计保留了 Crest 的数据源与数据集资源思路，同时增加真正的仓库层、可恢复执行、脱敏、质量、血缘和高性能服务接口。后续如果数据规模或实时性要求增长，只需要替换执行器和消息层，数据源、数据集、仓库适配器和元数据 API 可以继续保留。
