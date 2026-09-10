# GitHub 开源项目调研与选型建议

- 调研截止：2026-09-10（北京时间；公开 GitHub API 观测）
- 证据快照：[`github-snapshot-2026-09-10.json`](github-snapshot-2026-09-10.json)
- 方法：读取公开仓库元数据、截至 2026-09-10 UTC 的默认分支最新提交、前10条 Release，并保存仓库 README 的固定提交证据索引。GitHub Stars、pushed_at 属于观测值，不是质量证明；Release 标签可能含 `rc`/`beta`，不能直接当生产稳定版。

## 1. 结论先行

**一期推荐组合（候选，不是已冻结技术栈）：**

1. 数据接入：优先评估 **Apache SeaTunnel**；如果需要更丰富连接器生态，再评估 **Airbyte**，但必须先完成多许可证合规复核。
2. 调度编排：优先评估 **Apache DolphinScheduler**；团队已有 Airflow 能力时可将 **Apache Airflow** 作为替代。二者一期只选一个。
3. SQL 转换与模型：优先评估 **dbt Core**；如果核心诉求是环境隔离、变更计划和可观测的 SQL 发布，再评估 **SQLMesh**。二者一期只选一个权威模型执行方式。
4. 数据质量：优先评估 **GX Core（原 Great Expectations）**，或先用平台 SQL 规则满足 P0，再在规则数量/跨引擎需求达到门槛后引入。
5. 数据目录/血缘：**OpenMetadata 或 DataHub 二选一**，不建议一期引入；先由平台维护最小元数据和发布血缘。
6. DevOps 首主题：**Apache DevLake** 可以作为参考/候选数据源适配或对比方案，但它不是通用数据中心底座，也不能替代本项目对报表数据集发布、权限和统一周期指标的控制。
7. 查询/存储：**Apache Doris** 可作为分析查询层 PoC；不是必选，先用现有关系型数仓/数据库建立容量基线。

推荐的薄控制面仍由本项目维护：数据集契约、指标版本、数据水位、批次审计、质量门禁、权限策略、发布指针、报表查询和下钻。不要把这些核心责任隐含在第三方工具的界面或元数据库里。

## 2. 适用性矩阵

评分：5=强适配，4=适配，3=需验证，2=明显缺口，1=不建议作为该能力核心。评分是针对本项目的工程判断，不是项目官方评级。

| 项目 | 定位/适合能力 | 接入 | 编排 | SQL/模型 | 质量 | 治理 | 一期建议 | 主要注意事项 |
|---|---|---:|---:|---:|---:|---:|---|---|
| [Apache SeaTunnel](https://github.com/apache/seatunnel) | 批流一体、多连接器数据集成 | 5 | 3 | 2 | 3 | 2 | 优先PoC | 连接器实际支持、CDC语义、源负载和批次幂等须验证 |
| [Apache DolphinScheduler](https://github.com/apache/dolphinscheduler) | 工作流/DAG、回填、数据源和权限 | 2 | 5 | 3 | 2 | 2 | 优先PoC | 需通过适配层接入；平台运行ID和发布状态不能丢 |
| [Apache Airflow](https://github.com/apache/airflow) | Python DAG 编排和生态 | 2 | 5 | 3 | 2 | 2 | 可替代DS | Python运行环境、插件、升级和任务资源治理成本 |
| [dbt Core](https://github.com/dbt-labs/dbt-core) | SQL 转换、模型、测试、文档 | 2 | 3 | 5 | 3 | 3 | 优先PoC | 不是数据采集/权限服务；须接入平台发布、审计和权限 |
| [SQLMesh](https://github.com/SQLMesh/sqlmesh) | SQL/Python转换、计划、影响控制 | 2 | 3 | 5 | 3 | 4 | 与dbt二选一PoC | 版本、引擎兼容和团队学习成本需实际验证 |
| [GX Core](https://github.com/great-expectations) | 数据质量 Expectations/验证结果 | 2 | 2 | 2 | 5 | 3 | P1候选 | 需定义规则生命周期、门禁和结果与发布版本绑定 |
| [OpenMetadata](https://github.com/open-metadata/OpenMetadata) | 目录、元数据、血缘和治理 | 2 | 2 | 2 | 3 | 5 | P1/P2 | 运行依赖和接入维护成本；不替代平台授权与发布 |
| [DataHub](https://github.com/datahub-project/datahub) | 元数据目录、发现、血缘 | 2 | 2 | 2 | 3 | 5 | P1/P2 | 与OpenMetadata二选一；不要两套目录并行 |
| [Apache DevLake](https://github.com/apache/incubator-devlake) | DevOps 数据采集、分析和工程效能 | 4 | 3 | 3 | 2 | 2 | 参考/适配候选 | 面向DevOps，不是通用报表数据中心；主题和许可证/版本边界需评估 |
| [Apache Doris](https://github.com/apache/doris) | MPP/实时分析查询存储 | 2 | 2 | 2 | 2 | 3 | 存储PoC | 数据库迁移、运维、资源隔离和报表SQL兼容性 |
| [Airbyte](https://github.com/airbytehq/airbyte) | API/数据库/文件数据移动和连接器 | 5 | 3 | 2 | 3 | 2 | 合规后评估 | GitHub仓库显示混合许可证信息；不能只看仓库顶部一个License字段 |
| [Apache Hop](https://github.com/apache/hop) | 可视化数据编排/ETL | 4 | 4 | 3 | 2 | 2 | 备选 | 与SeaTunnel+调度器叠加后职责重合，需证明收益 |

## 3. 活跃度观测摘要

截至 2026-09-10 的公开 API 快照中，候选仓库均为非归档且默认分支在截止时间前有提交；Stars 仅作发现信号。示例观测：SeaTunnel约9,628、DolphinScheduler约14,462、Airflow约46,799、dbt Core约13,796、OpenMetadata约15,158。完整数值、提交时间、分支、许可证字段和 Release 见 JSON 快照。

调研脚本为 `tools/research-github.mjs`，可在未来以指定截止日期重跑。它不调用 GitHub 登录凭据，也不把当前仓库的 GitHub 活跃度猜测成历史活跃度。

## 4. 组件组合的边界

```text
本项目控制面
  ├── 来源/模型/指标/数据集契约
  ├── 业务规则、版本、质量门禁、权限、审计
  ├── 批次/水位/补数/发布指针
  └── 报表查询和下钻
       │
       ├── SeaTunnel 或 Airbyte：数据移动
       ├── DolphinScheduler 或 Airflow：调度
       ├── dbt Core 或 SQLMesh：SQL模型
       ├── GX Core：质量（按需）
       ├── OpenMetadata 或 DataHub：目录（后续）
       └── Doris：查询层（按容量）
```

一个第三方工具若同时宣称接入、调度、模型、目录和质量，仍按单项适配协议接入，不把其完整产品元数据库当成平台事实源。每个适配器必须能返回：外部运行ID、状态、日志引用、输入水位、输出对象、取消结果和错误分类。

## 5. 一期 PoC 设计

### POC-A：数据接入

用 DevOps 的一个真实或脱敏对象，覆盖首次全量、同一更新时间多页、迟到记录、逻辑删除/物理删除边界、失败重试、源端限流。验收：批次可追溯；检查点只在成功提交后推进；重复回读不增加业务对象；已知不支持的删除被明确告警。

### POC-B：编排与模型

使用一条需求/缺陷日指标链路，选择 DolphinScheduler/ Airflow 之一和 dbt Core/SQLMesh 之一。验证参数化日/月、依赖、重试、取消、回填、SQL版本、模型依赖和平台运行ID映射。验收：旧运行不能覆盖新发布；重跑同一范围结果一致。

### POC-C：数据集发布

构建新版本、故意让一个下游对象失败、查询旧版本，再完整重建并切换发布指针。验证报表连接方式是 API 还是数据库视图；汇总和下钻固定同一个 release_id；越权汇总、下钻和导出均拒绝。

### POC-D：质量与治理

用 10–20 条规则覆盖唯一、非空、引用、时间边界、对账、月末快照缺失和分母为零。验证规则结果与发布版本绑定；目录/血缘工具只同步已发布模型，不影响生产结果。

### POC-E：容量与运维

使用一期预计峰值数据、真实报表查询和整月重算，不用空数据演示。记录源负载、处理耗时、查询P95、内存/CPU、失败恢复、备份恢复、升级和回滚。只有达到需求门槛的组件才进入方案。

## 6. 许可证和供应链门禁

每个候选要锁定仓库提交/发行版、镜像来源、依赖清单、LICENSE/NOTICE、组件使用模式（内部部署、对外服务、是否二次分发）、安全公告和升级责任人。

Apache-2.0 候选通常更易纳入企业内部部署，但仍需保留 NOTICE、版权和专利条款检查。Airbyte 仓库公开 README 同时展示 MIT/ELv2 标识，API 元数据可能显示 `NOASSERTION`；本项目不在未完成逐目录许可证审查前把 Airbyte 视为单一宽松许可证组件。Great Expectations 的仓库已重定向到 `fivetran/great_expectations`，应以实际代码和发行物许可证为准。

开源软件可以内部使用不等于可以对外托管或再分发；最终结论交由组织法务/开源办公室复核，不以本报告代替法律意见。

## 7. 推荐决策门

- 通过 POC-A：从 SeaTunnel/Airbyte 中选一个主接入方案；另一个仅保留备选。
- 通过 POC-B：从 DolphinScheduler/Airflow 中选一个编排器；从 dbt Core/SQLMesh 中选一个模型方案。
- POC-C 不通过：不允许上线，先解决发布一致性和报表连接边界。
- 质量规则少且SQL可维护：暂不引入GX；规则规模/跨引擎增长后再引入。
- 目录/血缘没有多人发现需求：不引入OpenMetadata/DataHub；否则二选一。
- 查询压测达不到SLA或扫描成本不可接受：再启动Doris PoC，不能预先假定切换收益。

## 8. 采购/实施清单

- [ ] 取得 DevOps 连接方式、数据字典、历史和状态事件样本。
- [ ] 取得报表系统的 API/SQL/缓存及用户身份传递约束。
- [ ] 固定测试数据集和指标黄金结果。
- [ ] 为候选组件建立版本矩阵、许可证/NOTICE和安全清单。
- [ ] 完成 POC-A 至 POC-E 并将结果、日志、资源和失败原因入库/入文档。
- [ ] 通过 ADR 冻结一期组合，明确替换路径。
- [ ] 只在冻结后创建生产部署目录和依赖锁定文件。

