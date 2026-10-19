# 九章数据仓库设计方案

> 状态：三层数仓目标设计；纯 Mock 前端已完成本地桌面验收，真实后端与仓库尚未实施
> 更新时间：2026-10-19
> 参考：Crest 的数据源、数据集、同步任务、字段和执行日志资源模型。新方案只借鉴资源边界，不复用 Crest 的 BI 展示层。
> 当前进度与下一步以 [§12 分阶段交付](#12-分阶段交付) 为统一入口；前端逐页证据见 [页面矩阵](frontend-page-map.md#10-桌面验收收尾)。[纯 Mock 前端设计](frontend-design.md) · [UI 与 Vue 规范](ui-conventions.md) · [AI 开发规范](ai-development.md)。new-api 组件规范的适配依据见 [对照研究](research/new-api-adaptation.md)；本文的后端/仓库部署属于后续阶段。

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
| 当前前端 | Vue 3 + TypeScript strict + Pinia + Naive UI | 已实现，38 路由已完成 1280×1000 本地 Mock 桌面验收；Vite/Vue Router/Vue Query 配合，完整清单见前端设计 |
| 当前接口/Mock | OpenAPI 3.1 + openapi-typescript/openapi-fetch + MSW + IndexedDB | 已实现契约、生成类型、HTTP Mock 与持久化；真实服务端尚未实现，当前运行不需要后端、数据库或容器 |
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
  package.json / pnpm-workspace.yaml / pnpm-lock.yaml  # 前端与契约工具，已建立
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

这是包含未来后端的目标布局。当前已建立 apps/web、packages/contracts、tools 和前端 CI 配置；apps/api 只有 AGENTS.md，apps/worker、根 modules、infra 和 Maven 构建尚未建立。apps/api 与 apps/worker 不互相依赖，分别装配 modules/platform 的公开用例、连接器及仓库适配器。modules/platform 是首期单一后端库，sources 等是 Java 包级业务边界，并非十个服务或十个 Maven 工程；ArchUnit 验证依赖和跨域公开接口。只有出现独立消费者、插件分发或明确构建隔离需求时才抽出领域库。

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

### 12.1 当前进度基线（2026-10-19）

本节统一维护整体进度与实施顺序，页面矩阵继续拥有逐页验收证据。当前完成的是前端 B0–B5 的纯 Mock 桌面范围；M0–M4 的真实后端与数仓实现均未开始，不把前端进度折算为整个产品的完成百分比。

| 范围 | 已完成 | 尚未完成 / 当前边界 |
|---|---|---|
| 产品与工程设计 | 三层架构、全栈目录、前后端职责、OpenAPI、AI 开发与 Git 增量提交规范 | 真实后端版本组合、物理模型与执行协议仍需落地 |
| 前端 B0–B5 | Vue 3/TypeScript/Pinia/Naive UI；38 路由、主要交互、明暗主题与 1280×1000 本地验收 | 后续按使用反馈迭代；不再执行小屏幕专项 |
| 第一层：数据源 | 八类连接器的 Mock 配置、模拟测试、对象/字段发现与预览页面 | 尚无真实数据库/API 连接器、密钥管理和可靠读取 |
| 第二层：数据集 | 草稿/不可变发布版本、图/预设 SQL、字段、质量/脱敏、前台调度、运行/重试/补数的 Mock 闭环 | 尚无服务端计算、持久调度、Worker、真实检查点与恢复 |
| 第三层：仓库 | Mock 入仓、表/来源/血缘、SQL 场景、CSV 导入、查询导出与服务页面 | 尚无 Doris 读写、真实发布确认、查询治理或性能测量 |
| 契约与本地质量 | OpenAPI 与生成类型、MSW/IndexedDB、静态门禁、单元/HTTP 测试、E2E、demo/real 构建 | real 构建排除 Mock 不代表已接入真实后端 |
| 交付工程 | 本地功能块提交和 GitHub Actions 配置已建立 | 远端 CI/分支保护未验证；旧工程删除尚未形成可交付的清理提交 |

最后一次完整应用验收为 **2026-10-17、e43b1530 基线**：52 文件 190 项桌面 E2E、14 文件 93 项单元/HTTP 集成及完整 pnpm check 通过；16 类筛选重复两次的 32 项单独通过。e63f2441 为对应文档收尾提交。2026-10-19 本次整理核对代码、规则和已提交验收记录，未重新运行上述全量检查；旧 `/tmp` 执行日志/退出文件已不在当前环境，历史结果以页面矩阵和已有执行记录为依据，不宣称当天重跑。

仓库核对：apps/api 只有 AGENTS.md，apps/worker、根 modules、infra 和 Maven 构建尚未建立。工作区保留 19224 个旧工程未暂存删除；它们不是前端缺陷，也未纳入本次文档提交，但后续干净检出/远端 CI 必须采用与当前源树一致的基线。2026-10-19 用户已明确授权删除旧工程并单独提交，同时要求先明确后续工作、暂不开发；清理尚未执行。进入执行阶段后先核对删除路径与现有工程的关系，再精确暂存为独立清理提交，不恢复旧工程、不夹带新功能。

### 12.2 近期执行队列

| 顺序 / 编号 | 任务与状态 | 交付物 | 完成条件 |
|---|---|---|---|
| 1 · F1 产品收尾 | 用户已同意，待进入执行阶段：处理“零售数据工作区”的歧义 | 统一为“九章数据工作台”，零售仅作为演示样本说明；同步侧栏、顶部和概览消费者 | 页面不暗示不存在的工作区切换/设置；1280×1000 复核、相关文案检查通过后独立提交 |
| 2 · G1 可复现交付基线 | 用户已授权删除旧工程并单独提交，待进入执行阶段 | 核对当前删除清单，保留新前端/契约/规范与必要文件，形成独立清理提交及可干净检出的基线 | 无关修改不夹带，旧工程不复活；新检出可冻结安装并执行项目检查，不依赖当前工作区的未提交删除 |
| 3 · G2 远端质量闭环 | 配置已存在，执行待验证；推送/PR 按既有授权边界处理 | 实际 CI 结果、失败证据保留及 main 保护规则核对 | CI 的 workers/超时与完整套件实测匹配；检查和分支规则实查，不能将本地通过写成远端通过 |
| 4 · D1 后端实施规格 | 当前工作：业务边界已部分确认，继续形成可审阅的规格；版本研究及运行验证待后续阶段 | 已确认决策、接口差异清单、元数据模型、执行/发布协议、支持矩阵和验收场景；详细分工见 §12.5 | 业务范围与设计稿明确；正式编码前完成版本核验，涉及实际原型/真实引擎验证时单列任务，不把设计稿当运行证明 |
| 5 · M0 → M3 首个真实闭环 | 路线已同意，尚未开始；当前指令为暂不开发 | MySQL → 已发布数据集 → 手动全量运行 → Doris 最新快照 → 查询/导出 | 重复全量运行替换该数据集独占表的上一批数据；失败、取消不破坏上一成功快照；发布确认和重启恢复有证据 |

当前先完成 D1 的范围沟通与方案说明；F1、G1 和真实闭环已获方向或操作授权，但遵循用户“先别开发，先明确接下来的工作”，本轮不改应用、不执行旧工程清理。恢复执行后先分别完成 F1 与 G1，再按 D1 拆分后端功能块。G2 可与后端设计并行准备，在共享或发布前落实；本次确认不包含 push、PR 或远端配置修改。

当前 CI 的浏览器步骤使用默认 1 worker、整个 job 超时 25 分钟；已记录的 190 项全量是在 2 workers 下耗时 16.0 分钟，另有安装与 pnpm check。两者不能直接等同，G2 需测量并调整执行预算，尚不能断言远端会通过或超时。

### 12.3 首个真实版本的范围基线

- **单工作区**：沿用当前单工作区范围，不预建多工作区页面。现在“零售数据工作区”仍是固定文案；F1 已同意统一为“九章数据工作台”，尚未实施。若后续需要多工作区，须单独设计成员、对象归属、隔离、缓存和审计边界。
- **源与写入（已确认）**：首个真实源为 MySQL，先做手动全量读取；每个数据集独占一个逻辑目标表，新批次成功后替换上一成功快照，重复运行不累计上一批行。旧的“首批追加写入”建议已被本次确认取代。建议以单源单表开始；后续再补 PostgreSQL、REST JSON、CSV、增量和 upsert，§3.1 的完整连接器目录仍为长期方向。
- **登录与部署（已确认）**：系统自带账号登录；首个交付目标为本地单机验证。真实账号、密码校验、会话和权限由服务端实现；当前演示角色切换不直接作为真实登录。具体会话方案和账号初始化方式由 D1 设计。
- **数据集**：先落地字段映射、基础过滤、必填/范围质量校验和一种可验证的脱敏策略，草稿/发布版本与运行绑定从第一批就正确；Join、聚合及更复杂 SQL 在最小执行链跑通后扩展。Mock 预设 SQL 不直接充当真实计算引擎。
- **服务与运行**：首批即实现服务端身份/对象权限、密钥引用、访问限制、超时、审计和可恢复运行；这些基础边界不能延后到 M4 才补。后台定时、补数、依赖、并发及多 Worker 扩展在手动运行与持久状态正确后推进。
- **容量与性能**：D1 明确预期数据量、单批大小、更新频率、并发查询数、资源预算和时延目标；目标数值尚未确定，不给出未经测量的吞吐/延迟承诺。性能验收在 M3 使用已声明的数据与资源条件执行。

### 12.4 后端里程碑与退出标准

执行顺序为 **M0 → M1 首个源 → M2 最小执行 → M3 首次入仓/读取**；打通后再交替补齐 M1–M3 的扩展能力，最后进行 M4 生产治理。不要先堆齐全部连接器或全部转换节点，再尝试首次入仓。

| 阶段 | 交付内容 | 退出标准 |
|---|---|---|
| M0 骨架、元数据与真实会话 | Maven Wrapper；apps/api、apps/worker、modules/platform；PostgreSQL/Flyway；系统自带账号/会话、服务端权限/审计与统一错误；基础资源 CRUD | 按工程基础、账号/会话、数据源元信息三个可验证功能块提交；前端 real 模式 → API → PostgreSQL，登录与数据源记录重启后按各自规则恢复；未登录/越权/校验/事务失败正确；契约和包依赖检查通过 |
| M1 真实数据源接入 | Connector Port 与首个 JDBC 适配器；连接测试、schema 发现、限额预览、分批读取和原始落地 | 在真实源上验证类型/时区/分页、只读账号、超时/取消、失败重试；原始批次可追踪；无凭证进入前端、日志或持久化明文配置 |
| M2 数据集执行与调度 | 发布版本、持久 run/状态机、Worker 租约、最小转换、质量/脱敏；后续扩展 Quartz、重试/补数/依赖 | 手动运行绑定版本；BLOCK/失败/取消不推进成功游标；重启从记录恢复且旧 Worker 无权提交；后续定时任务在浏览器关闭后仍执行 |
| M3 Doris 写入、发布与读取 | 首先实现数据集独占目标表的全量快照替换及 SQL/导出；再扩展其他写入模式、表模型和数据服务 | 成功前上一快照可读，成功后完整切换；失败/取消不清空旧表或暴露半批数据；同批重试不重复发布，源 → 版本 → run → 表 → 查询/导出可追溯；结果未知及元数据确认失败可重启对账；具体引擎能力有真实证据 |
| M4 生产治理与运维 | 扩展行/列权限、完整审计与访问控制；多 Worker 接管、指标/告警、备份恢复、连接器扩展与部署文档 | 完成适用安全控制验证、故障/接管与恢复演练、目标负载测试和部署回滚；真实版本/资源/命令可复现 |

后端初始化先启动当批需要的服务：M0 使用 PostgreSQL；读取落地时引入选定 S3 实现；首次真实入仓时引入 Doris。原始落地/发布 Port 需在 M1–M3 之间提前约定。领域用例与客户端状态保持已有所有者，不为联调把领域请求搬到 Vue 页面。每块按契约 → 实现 → 受影响消费者 → 验证 → 本地提交完成，真实模式失败不得悄悄回退 Mock。

### 12.5 如何明确 D1：决策、规格与验收

“明确后端规格”分为用户选择产品行为、设计者形成技术方案、实际运行验证三步。用户确认业务与使用目标；模块边界、表结构、API 映射、版本选型与验证方法由设计者提出有依据的方案，不要求用户替代技术设计。产品决策确认不等于代码已实现或版本兼容已验证。

#### 已确认的决策（2026-10-19）

| 事项 | 用户确认 | 当前状态 |
|---|---|---|
| 产品名称 | “零售数据工作区”改为“九章数据工作台”，零售只作演示样本说明 | 已同意，应用尚未修改 |
| 旧工程 | 删除旧工程，独立提交 | 已授权；本轮暂缓执行；执行时核对具体路径并单独提交，无需重复索取同一授权 |
| 首个数据源 | MySQL | 范围已定，具体引擎/驱动版本待核验 |
| 部署目标 | 先做本地单机验证 | 第一版不以生产集群为交付条件；用户个人环境不进入仓库规范 |
| 登录 | 系统自带账号登录 | 真实账号、会话及初始化细节待设计 |
| 首个入仓行为 | 手动全量；成功后替换该数据集独占目标表的上一批数据，保留最新完整快照 | 已确认；不采用跨运行累加；发布机制待真实引擎验证 |
| 后端路线 | 按最小纵向闭环逐步接通真实源、数据集、仓库查询/导出 | 路线已同意，执行暂停在规划阶段 |

#### 接下来需要形成的设计成果

| 设计项 | 需要明确的内容 | 应提供的审阅成果 / 完成条件 |
|---|---|---|
| 首版范围 | 首个端到端样例、必做转换/质量/脱敏、支持与延后能力、用户操作流程 | 明确“可接什么、可做什么、结果是什么”；以虚构测试数据设计，真实业务样例非必需 |
| 数据模型 | 用户/角色/会话、数据源及密钥引用、草稿/版本、运行/批次/发布记录、目标表归属和审计 | ER 图、关键字段/唯一约束、状态和所有者；元数据不存放业务明细；先设计，不生成迁移文件 |
| 接口适配 | 现有 OpenAPI 哪些可复用；登录/会话、真实连接参数、异步任务、错误/取消/幂等和并发修改需补什么 | 接口差异清单、请求/响应示例及前端影响；当前不修改契约或生成类型 |
| MySQL 读取 | 只读权限、类型/Decimal/时区、schema 变化、批量读取、全量快照的一致性边界 | 读取协议与支持矩阵；源端扫描期间发生更新时如何处理要有明确语义，不把分页扫描自动视为一致性快照 |
| 执行与发布 | 分批读取/原始落地 → 转换/质量/脱敏 → staging → 发布 → 元数据确认；暂停、取消、失败、租约和恢复 | 时序图、运行状态迁移与故障矩阵；发布意图前失败保留上一成功快照，进入 publishing 结果未知时对账；不以先删旧表再写入实现快照替换 |
| 登录与密钥 | 管理员初始化、账号增改/禁用、密码处理、会话失效/退出、角色权限；源凭证输入/密钥引用/存取与日志边界 | 可审阅的登录和密钥生命周期方案、适用安全控制与失败场景；具体库/版本后续查证；不沿用演示身份作为服务端权限依据 |
| 运行条件与容量 | 各组件职责及启动顺序、选定版本、源数据量/行宽/单批大小、查询并发、机器资源、存储与清理预算 | 确定版本/资源的验证矩阵；性能指标区分目标与实测值，缺少业务规模时先提出标注为建议的合成数据基准，不能写成用户承诺 |
| 验收与拆分 | 每个功能块用户可见结果、测试数据、成功/失败/恢复场景和依赖 | 按依赖排序的提交清单；每项有完成条件；版本查证与真实原型/运行实验分开记录 |

2026-10-19 用户已确认以下规则，并授权开始第一版开发。数据集之间不共享同一逻辑目标。

- 首次空结果可成功；已有非空快照而本次最终结果为零时默认阻断，明确允许本次空覆盖才可发布。读取或质量错误不能用空覆盖绕过。
- 发布固定字段定义；运行只按字段名称匹配。新增未使用字段和无关字段删除不阻断；已使用字段的删除、改名、类型/精度/长度/可空性变化阻断，修改草稿重新发布后生效；字段顺序/注释变化不阻断。
- 同一数据集只能有一个非终态运行，取消中也占用；服务端强制，首版不排队。
- 当前成功快照永久保留至被替换；历史快照最多三份，且被替换后最多七天，先达到的上限生效；运行记录/不可变版本不随数据副本清理。

执行已恢复：F1 文案提交 `6c95ef7e`；G1 旧工程删除独立提交 `01a493dd`，共 19224 个已核对的旧文件。干净归档检出冻结安装、契约与依赖边界检查已通过；不据此宣称全量前端验收已重跑。

#### 首个真实闭环的可观察验收

1. 使用系统账号登录，创建 MySQL 源，测试连接并读取表/字段；无权限、错误凭证与超时有明确结果。
2. 选择源表、配置最小字段/过滤、质量和脱敏，保存草稿并发布固定版本；运行始终绑定该版本。
3. 首次手动全量运行成功，目标表内容与预期转换/质量/脱敏结果一致；查询和导出均可追溯同一批次。
4. 修改源数据后再次运行：目标表反映最新成功快照，源端已删除行从最新快照消失；不会因为又跑一次而累加上一批数据。
5. 注入读取失败、质量 BLOCK 和允许阶段的取消：保留上一成功快照，不暴露部分新数据；首次无成功快照时不声称已有可用表。
6. 同批重试、重复请求、发布结果未知、目标成功但元数据确认失败、进程重启：恢复后只确认一次发布；具体策略由 D1 协议规定并通过真实引擎验证。

#### 当前执行边界与后续安排

本轮只将确认项与待设计项写入已有规划并提交文档；不开始应用开发、旧工程清理、依赖安装、服务/容器启动或远端操作。接下来的规划成果是可审阅的 D1 设计稿，完成范围、模型、接口差异、执行/发布、账号与密钥、版本/容量验证矩阵和验收拆分后，再进入实施阶段。尚未确定实际数据量与机器资源，可先提出明确标注的验证档位，不因此虚构真实性能或阻断其他设计。

恢复实施时，F1 文案调整与 G1 旧工程清理各自独立验证和本地提交；后端 M0 再按工程基础 → 账号/会话 → 数据源元信息开始。G2 远端执行按授权另行处理。技术版本及具体引擎原子替换机制尚未研究/验证，不在本次规划中锁死。

本节维护阶段状态、下一步和退出条件；逐页证据留在页面矩阵，启动命令留在 README，职责与代码约束留在各级 AGENTS/AI 规范。D1 设计细节优先补充本文对应领域章节，只在产生独立长期主题时新增文档，避免多处维护同一规则。

## 13. 第一版明确不做

- 不把 Airbyte 作为运行时依赖。
- 不直接复制 Crest 的 BI 图表、仪表盘和大屏模块。
- 不在第一版引入 Spark、Flink、Kafka、Trino 等重型组件，除非数据规模证明需要。
- 不允许任意用户代码直接访问源数据库、宿主机文件系统或内网地址。
- 不把数据库元数据和业务事实数据混在同一个 schema 中。
- 不把查询缓存当作仓库的唯一持久化副本。

## 14. 核心决策

Vue 纯 Mock 前端已完成本地桌面验收；后端阶段的规划落点是（精确版本及兼容组合仍待实施验证）：

~~~text
Spring Boot API + Java Worker
PostgreSQL 元数据库
MinIO/S3 原始区
Apache Doris 仓库
Quartz 调度
Vue 3 管理端
~~~

这套设计保留了 Crest 的数据源与数据集资源思路，同时增加真正的仓库层、可恢复执行、脱敏、质量、血缘和高性能服务接口。后续如果数据规模或实时性要求增长，只需要替换执行器和消息层，数据源、数据集、仓库适配器和元数据 API 可以继续保留。
