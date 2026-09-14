# by-data-warehouse · 通用报表数据中心

统一接入业务系统，清洗和加工业务数据，向报表系统发布可追溯、可授权、可版本化的数据集。

**DevOps 是首个业务主题，不是平台边界。** 第二个业务主题应主要通过新增连接配置、模型、SQL 和数据集完成接入，而不是修改平台核心。

## 当前状态

- 2026-09-14：POC-01 本地合成链路已验证——MySQL→SeaTunnel→PostgreSQL RAW→dbt→DolphinScheduler，覆盖重放、迟到、陈旧发布拒绝和失败重试；仍未验证正式平台、NAS部署、容量或真实源全量接入。
- 2026-09-14：正式平台 PLT-01 第一切片已完成本地验证——Spring Boot 控制 API、PostgreSQL 版本化迁移和 Compose 启动链路可运行；身份、真实接入、Naive UI 与 NAS 部署仍待后续切片。
- 2026-09-14：PLT-02/ING-01 第一切片已完成本地验证——管理 Token、来源登记/查询、敏感配置拒绝和审计可运行；真实连接测试、角色授权与抽取仍未实现。
- 2026-09-10：已形成设计规划、完成限量源库调查，并跑通本地合成数据 SQL PoC（P0）。
- 已在用户明确授权的测试库TLS例外下成功连接MySQL 8.1.0，完成两个源库共21个选定对象的元数据调查；另已完成5对象的限量业务采样，发现任务/缺陷状态日志及成员事件候选，但完整历史还原、指标与完整PoC尚未验证。
- 一期建议采用批处理、SQL 优先、复用开源执行能力、薄控制台的路径。
- 技术组件和版本须通过 PoC 后冻结；规划中的周期和性能指标是待确认的验收目标，不是已验证能力。

## 文档导航

| 文档 | 用途 |
|---|---|
| [产品范围与最终目标](docs/01-product-scope.md) | 产品边界、角色、一期取舍、最终目标 |
| [总体架构与详细设计](docs/02-architecture.md) | 部署边界、模块、元数据、接口、安全与发布 |
| [数据加工与指标规范](docs/03-data-processing.md) | 增量、历史、周期统计、幂等和补数 |
| [一期开发计划](docs/04-phase-one-plan.md) | 人员假设、W1–W18、工作包、依赖和里程碑 |
| [最终目标路线图](docs/05-target-roadmap.md) | 能力演进、扩展门槛与成本控制 |
| [测试、验收与运维](docs/06-acceptance-operations.md) | 可执行的验收场景、运行手册和上线门禁 |
| [待确认事项与决策记录](docs/07-decisions-risks.md) | 事实、假设、决策状态和风险 |
| [GitHub开源项目选型](docs/08-github-open-source-research.md) | 13个候选、近期活跃证据、推荐组合和PoC |
| [开发与 Git 协作规范](CONTRIBUTING.md) | 分支、及时提交、变更检查和密钥规则 |
| [合成数据 SQL PoC](docs/17-synthetic-sql-poc.md) | P0范围、精确版本与许可边界、合成口径、运行结果与后续切片 |
| [历史限量采样结果](docs/16-devops-history-sampling.md) | 缺陷日志覆盖、状态单值候选、起止缺失、成员历史缺口与合成PoC输入 |
| [组件PoC依赖矩阵](docs/18-component-poc-matrix.md) | POC-01候选版本与兼容性事实、安装锁定要求、执行设计与GOV-01签字清单 |
| [DevOps首主题域契约](docs/19-devops-domain-contract.md) | 首条真实接入范围、指标发布边界、质量门禁与待确认业务规则 |
| [正式平台骨架实施](docs/20-platform-foundation.md) | 控制 API、元数据迁移、锁定镜像与本地 Compose 验证记录 |
| [后续规划与里程碑](docs/21-next-milestones.md) | 从 PLT-01 起点开始的执行顺序、出口条件、阻断项和近期工作 |
| [来源登记 API 第一切片](docs/22-source-registry.md) | 最小身份校验、来源登记/查询、安全边界和本地集成证据 |
| [源库元数据发现](docs/15-source-metadata-findings.md) | TLS授权例外、真实连接和结构事实、三类指标缺口及本地字典 |
| [测试库发现执行记录](docs/14-mysql-test-discovery.md) | 初次严格TLS失败历史、固定客户端与NAS Compose v2.40.3 |
| [MySQL预检与Compose双版本](docs/13-mysql-preflight-compose.md) | 初次网络预检历史、已更新的账号/客户端状态与NAS入口管理 |
| [只读数据库交接](docs/12-source-db-discovery.md) | 本地连接模板、STORY/DEFECT和历史表发现、安全及只读边界 |
| [PoC已确认输入](docs/11-poc-confirmed-inputs.md) | 用户确认基线、DevOps资料包、状态/团队历史、月报更正和NAS核验 |
| [PoC准入确认清单](docs/10-poc-readiness.md) | 用户待确认项、建议默认值、技术核验责任与启动门槛 |
| [工程治理规范](docs/09-engineering-governance.md) | 商用开源、技术栈、AI编码、Git、PoC、版本与发布 |

AI开始编码前读取 [仓库约束](AGENTS.md)；工程治理和PoC晋级标准见第09号文档。

## 一期交付主线

数据源 → 接入批次 → 原始留存 → 标准明细/历史 → 日月加工 → 质量门禁 → 版本发布 → 报表查询与下钻。

首批业务范围建议优先项目/团队/需求/缺陷；任务、代码、流水线、发布按源数据可获得性和容量排序追加，不作为所有对象同时上线的默认承诺。

## 技术选型原则

1. 平台自行维护业务契约、权限策略、发布记录与统一运行视图。
2. 同步、编排、SQL 建模优先复用成熟组件，通过适配层整合。
3. 一期只选择一套主要调度器和一套模型执行方式，避免重复依赖管理。
4. 研发环境可以轻量部署；生产拓扑通过容量、恢复演练和安全评审后确定。
5. 不因为“最终目标”提前堆叠消息总线、分布式计算、数据目录和湖仓全家桶。

## 文档与证据校验

```powershell
node tools/check-docs.mjs
git diff --check
```

调研证据位于 `docs/research`，包含公开GitHub API快照、搜索记录与固定提交的一手资料索引。候选调研不等于组件已部署或兼容性已验证。
