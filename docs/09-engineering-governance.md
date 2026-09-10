# 09 商用开源、技术栈、AI编码、Git与版本发布规范

- 基线日期：2026-09-10
- 状态：推荐工程基线；不是PoC通过、远程分支保护启用或CI已部署的声明。
- 本文是工程治理基线；许可证最终解释和对外分发由法务/开源办公室确认。

## 1. “能商用”的判定标准

“商业可用”不是只看 GitHub 页面写着 Open Source，也不是只看仓库顶层 SPDX 字段。引入前必须确认：实际代码路径和依赖的许可证；是否有商用/托管服务限制；是否保留 LICENSE、NOTICE、版权和修改声明；是否有专利、商标、贡献者协议；是否需要购买商业版；是否向外部客户提供该组件本身的能力。

### 许可证红线

- **优先**：Apache-2.0、MIT、BSD 等经法务确认的宽松许可证。
- **谨慎**：Elastic License、BSL、SSPL、Commons Clause、商业双许可证或仓库不同目录混合许可证。可用于企业内部不代表可用于对外托管、转售或再分发。
- **禁止默认引入**：许可证未知、源码与发行物许可证不一致、依赖许可证未清点、带“仅非商业”条款而业务性质未确认的组件。
- 许可证报告是版本和路径维度的；不能用“项目总体是 Apache-2.0”覆盖某个插件、连接器、镜像或运行时依赖的其他许可证。

Airbyte仓库根许可证为ELv2，包含向第三方提供其实质性功能的托管服务限制，因此不纳入一期默认白名单。SeaTunnel、DolphinScheduler和dbt Core的许可证文件为Apache-2.0；证据见文末官方来源与此前固定提交索引。版本、连接器、驱动、镜像及传递依赖仍需复核，不能依据项目名称直接批准全部发行物。

GPL/LGPL/AGPL不等于“禁止商用”；其分发、链接、网络交互等义务需要按具体许可证和使用方式判断。本项目是为降低闭源商业交付的复杂性而默认优先宽松许可证，不将copyleft错误归类为非商业许可证。OpenJDK运行时还需单独核查其GPL及Classpath Exception适用范围，不笼统宣称全栈只有Apache/MIT。

商用有三种范围：企业内部部署、交付客户私有部署、对外SaaS。本项目按后两种也可能发生的保守准入标准设计。引入宽松许可依赖不等于必须把本项目代码开源；本项目是否闭源或另选许可证由权利人决定，当前不替用户添加项目LICENSE。

### 一期商用友好候选

| 能力 | 首选候选 | 商用开源判断 | 决策 |
|---|---|---|---|
| 数据接入 | Apache SeaTunnel | Apache-2.0 方向，固定发行版复核 | PoC首选 |
| 调度 | Apache DolphinScheduler | Apache-2.0 方向，固定发行版复核 | PoC首选 |
| SQL转换 | dbt Core | Apache-2.0；不把其他发行版/商业平台混入 | PoC首选 |
| 质量 | 自研SQL规则起步；必要时GX Core | 固定版本和依赖复核 | P1候选 |
| 目录 | 暂不引入；后续OpenMetadata/DataHub二选一 | 逐组件、逐依赖复核 | P1/P2 |
| 查询存储 | 先用现有数据库；需要时Apache Doris | Apache-2.0 方向，固定版本复核 | 容量触发 |

Apache 组件许可证不等于无需履行义务；生产镜像必须带许可证清单和NOTICE。任何对外提供数据中心服务的场景必须额外进行托管服务、商标和分发评估。

## 2. 一期技术选型

### 推荐基线

```text
控制面：Java 21 + Spring Boot + Spring Security + JDBC（模块化单体）
控制台：Vue 3 + TypeScript + Vite + Element Plus
接入：Apache SeaTunnel（通过本项目适配器）
编排：Apache DolphinScheduler（一期只选一个调度器）
转换：dbt Core + dbt-postgres + SQL（锁定兼容组合，隔离Python运行镜像）
质量：平台SQL规则；规则复杂后评估GX Core
存储：无既有平台约束时默认 PostgreSQL；元数据和业务仓库分库/分账号；不足再PoC Doris
查询：优先受控查询API；若报表必须直连，使用数据集专用账号/视图并验证行权限
元数据：平台最小元数据库；规模触发后 OpenMetadata/DataHub 二选一
部署：Linux OCI镜像；默认PoC/开发及非HA小规模一期使用Docker Engine + Compose；有企业平台则复用
```

这是“候选基线”，不是已完成的兼容性验证。PoC必须验证 SeaTunnel → DolphinScheduler → dbt → 存储 → 数据集服务的运行ID、日志、检查点、失败重试、权限和发布一致性。若现有单位已有成熟 Airflow、Flink、ETL 或数仓平台，先做复用评估，不为了“开源”重复建设。

### 控制面和工具选择细化

| 模块 | 推荐选择 | 决策边界 |
|---|---|---|
| 后端 | Java 21、Spring Boot、Spring Security、JDBC | Spring选择仍在社区支持期且与Java21兼容的发行线；不在文档阶段随意写最新patch |
| 前端 | Vue 3、TypeScript、Vite、Element Plus | 具体版本在工程骨架阶段验证后锁定 |
| 构建 | Maven Wrapper、pnpm锁文件 | 禁止SNAPSHOT、动态版本及未审查安装脚本 |
| 元数据 | PostgreSQL | 独立数据库、角色、备份；不与调度器共用其内部表 |
| 业务数据 | PostgreSQL起步，表/分区按容量规划 | RAW、明细、汇总/发布分权限；性能不足才引入Doris |
| 模型执行 | dbt Core与dbt-postgres | Python/adapter/Core必须验证兼容；不把dbt Fusion/Cloud当同一许可证产品 |
| 迁移 | 版本化SQL迁移和校验清单 | 迁移执行工具通过许可证/数据库支持复核后确定；禁止生产自动建改表 |
| 测试 | Java单元/集成；前端单元/端到端；SQL黄金样本 | 框架补丁版在骨架阶段固定，所有引入项都进依赖清单 |
| 身份 | 对接企业OIDC/SSO，服务端强制权限 | 没有现成SSO时提供隔离的测试身份，不伪造生产认证完成 |
| 缓存/消息 | 一期默认不增加Redis/Kafka | 需求和压测触发，不为了架构图完整而引入 |

以上是建议采用的技术路线，而不是安装清单。PoC开跑前就必须锁定实验依赖；PoC通过后将实测组合登记为正式批准矩阵，而不是PoC全程使用latest。未来转Doris需重测SQL方言、dbt adapter、事务发布及权限，不能当作无成本替换。

SeaTunnel仅负责其经验证连接器的数据移动；若DevOps为特殊API，需要一个轻量接入适配器实现分页、认证和游标。不能因选了SeaTunnel就声称任意DevOps接口都已支持。

DolphinScheduler管理跨系统/阶段依赖和重试；dbt管理一次模型构建内部依赖；禁止两个调度器同时驱动相同SQL模型。Worker独立运行各组件所需Java/Python版本，不强制SeaTunnel/DolphinScheduler共用控制面的Java21运行时。

### 为什么不是全自研

自研重点放在业务差异化和数据可信交付：数据集契约、指标版本、历史/日月规则、质量门禁、授权、审计、发布指针和下钻。连接器、DAG调度、SQL执行等通用能力优先复用，以降低长期维护面。

### 为什么不把所有组件一期装上

调度器、转换器、接入器、质量平台、目录、分析数据库分别有运行和升级成本。只保留一条主链路：`SeaTunnel/必要API适配器 + DolphinScheduler + dbt Core + PostgreSQL`；质量和目录按门槛引入，避免多套事实源、重复调度和许可证扩散。

## 3. AI 编码规范

### 3.1 AI的角色

AI是受约束的代码助手，不是架构决策人、业务口径签字人、生产发布人或安全审查替代者。AI生成的代码与人工代码承担同等审查责任。

### 3.2 每个AI编码任务必须提供

```text
背景与目标
不在本次范围内的内容
允许修改的目录/文件
接口、数据模型和错误兼容性约束
安全/权限/性能要求
验收测试与黄金样本
完成定义
```

提示词不得包含真实密码、Token、身份证号、客户明细或未脱敏生产数据。真实敏感信息只能通过批准的企业AI环境和最小必要上下文处理。

### 3.3 AI输出的强制流程

```text
AI生成/修改
  → 人工检查差异和依赖
  → 自动测试、类型/静态检查、secret扫描、许可证扫描
  → 数据边界测试和安全测试
  → 同行评审
  → 测试环境运行
  → 业务口径验收
  → 生产审批
```

涉及权限、SQL拼接、凭证、迁移、删除数据、调度状态、发布指针和数据质量门禁的代码必须人工逐行检查。禁止把任意用户输入拼接为SQL或shell；必须使用参数化查询、白名单和资源限额。

### 3.4 数据加工的AI专用约束

- AI不得自行决定“空值填0、负数删除、取消不计、月指标求和”等业务规则。
- 每个指标必须关联口径、统计总体、时间字段、归属规则、分子/分母、聚合方式和样本。
- AI修改日/月SQL时，必须补充边界样本：时区、月初月末、迟到、重开、重复、分母为零、快照缺失、团队变更。
- SQL提交必须写明目标粒度，避免多事实表直接关联造成乘法膨胀。
- AI建议的开源组件、版本、许可证和API都必须重新核查，不得以模型记忆作为事实。

### 3.5 AI提交说明

提交正文或PR描述增加：

```text
AI assistance: none / used for draft / used for implementation
Human verification: tests, security, data sample, reviewer
Risk areas: permissions / SQL / migration / runtime / none
```

不要把业务源代码、内部架构或数据样本发送给未经批准的公共服务；团队应按组织AI使用政策配置日志、保留期和模型供应商。

## 4. Git分支管理

### 推荐模型：短分支 + 受保护main

```text
main                 经验证的集成基线；正式发布由不可变标签+制品标识
feature/<issue>-<name>  功能开发，短生命周期
fix/<issue>-<name>      缺陷修复
hotfix/<issue>-<name>   从受影响生产标签/维护线创建，不默认从main创建
release/<version>       可选，需稳定化窗口或维护旧版本时才创建
poc/<topic>             PoC隔离试验，可丢弃但必须保留结论
```

一期阶段不建议长期维护 `develop`、`test`、`uat` 多个环境分支。环境应由同一提交配不同配置发布；否则会产生“测试通过但main没有”或环境分支漂移。若组织已有强制GitFlow，可保留其流程，但 `main` 仍是唯一生产来源，不能把环境分支当作运行状态。

### 合并规则

- 远程建立后必须对 `main` 启用保护：禁止强推、禁止删除、至少一名代码评审、CI通过、无未解决高危安全问题。
- 变更按一个可验证工作包提交；业务SQL、口径、黄金样本和迁移一起评审。
- PR标题关联Issue；描述影响、测试、回滚和数据重算范围。
- 合并优先 squash merge，保持可回滚提交；重大版本可保留合并提交和发布清单。
- 当前只有本地仓库，分支保护、PR审批和CI状态检查尚未配置；本地文档初始化可经检查后合并，但不能冒充同行审批。
- 每个提交都应可构建或明确标记为文档/实验；PoC不得被直接当生产发布。
- 禁止提交生产数据、环境文件、密钥、临时下载包；CI做secret、依赖许可证和镜像扫描。

### 提交节奏

完成一个功能切片即提交：例如“接入批次状态”“需求明细模型”“日指标SQL”“发布指针测试”，不要等整条链路全部完成。提交前运行 `git diff --check`、相关测试和文档校验；失败提交不得为了“及时”强行进入受保护main。

## 5. PoC与正式版本的关系

**不会默认“做完PoC就全部删除”。** PoC分为三类：

| 类型 | 处理方式 |
|---|---|
| 一次性验证脚本/临时配置 | 保留必要的可复现实验于 `experiments/`，临时运行产物放 `work/`；明确批准后才清理，不得进生产镜像 |
| 可复用适配器、契约、测试样本、性能脚本 | 经代码审查后迁移为正式实现，重构接口、补齐测试和安全约束 |
| PoC中验证失败或不可维护的实现 | 保留结论和可复现分支/提交；不合并失败实现到正式源码；清理须经确认 |

推荐流程：

```text
poc/<topic>
  → 记录假设、版本、输入、结果、资源、失败原因
  → 评审 Go / No-Go / Conditional Go
  → 若Go：新建feature正式化，逐步迁移可复用资产
  → 重新设计生产接口、配置、监控、权限、回滚和测试
  → 合并main并打正式版本
  → 若No-Go：保留PoC提交或研究标签及调研证据；按约定归档分支，不自动删除实验资产
```

PoC代码不能直接作为生产代码的理由：缺少异常、权限、容量、升级、恢复和数据契约。PoC验证的是选型和关键风险，正式版需要重新达到工程完成定义；但测试数据、实验结果和已经审查过的通用代码可以保留。

## 6. 版本控制

### 四种版本必须分开

1. **平台软件版本**：按 SemVer `MAJOR.MINOR.PATCH`；破坏公开兼容性升级MAJOR；兼容功能升级MINOR；兼容修复升级PATCH。内部数据库迁移是否升级主版本取决于公开契约和兼容性，而非只要改表就升级主版本。
2. **数据模型/数据集契约版本**：数据集字段删除、改类型、粒度改变升级MAJOR；确认所有消费者可忽略新字段时，新增兼容字段才可升级MINOR；修复文案或非语义错误升级PATCH。
3. **指标口径版本**：口径、统计总体、时间字段、归属或聚合改变必须新版本，并记录生效日期；历史是否重算须单独审批。
4. **数据发布版本**：每次运行有不可变 `release_id`，记录输入水位、代码、模型、指标和质量结果；修正通过新发布，不覆盖旧审计记录。

### 版本联锁

一个数据集发布清单至少包含：

```text
platform_version
model_version
workflow_version
metric_definition_version
source_watermark
dimension_version
quality_result_version
release_id
```

报表绑定的是数据集契约和发布指针，不绑定“latest”。同一数据集在同一时间只暴露一个 active release；重大口径变更可并行提供 `v2`，给报表迁移窗口。

### 开源依赖版本

使用锁定的 Release/tag 或经审核的 commit，不使用 `latest`；保存 SBOM、镜像摘要、许可证/NOTICE和漏洞扫描结果。升级先在独立分支做兼容性、数据回放、性能和恢复测试，再生成变更记录。

## 7. Docker还是其他发布方式

### 推荐：容器构建，平台发布

```text
代码提交
  → CI测试/扫描/SBOM
  → 构建不可变镜像并按digest登记
  → 推送企业镜像仓库
  → 测试环境部署
  → 验证/审批
  → 生产容器平台滚动或蓝绿发布
```

- **开发环境**：Docker Compose，方便启动控制面、元数据库、模拟执行器；不用于模拟生产高可用。
- **测试/预生产**：与选定生产拓扑一致；生产用Compose则验证Compose环境，生产用Kubernetes则验证相应平台。保持存储、权限和发布路径一致。
- **生产**：有企业Kubernetes/容器平台则复用；没有现成平台且接受单主机故障窗口的一期默认Linux Docker Engine + Compose，由运维负责启动、探活、重启、日志、限制、备份和恢复。若要求跨主机自动容灾，则该方案不能通过HA验收，需另选多主机平台并验证有状态组件。
- **数据库**：一期不建议把生产元数据库和大数据存储简单绑在应用容器生命周期里；使用企业数据库/受管实例或有明确持久卷、备份、恢复和迁移流程的部署。
- **数据任务**：执行Worker与API分离；镜像只含代码和锁定依赖，连接凭证由运行时密钥注入；禁止把密钥写入镜像、Compose文件或Git。

Docker是打包和交付格式，不是高可用、权限、数据持久化或发布一致性的替代品。镜像标签可读但不唯一，生产部署记录必须使用digest；配置与镜像分离；数据库迁移遵循向前兼容，回滚优先回滚应用或数据集发布指针，避免破坏性“降级数据库”。

### 发布策略

- 小版本：有编排器和多副本时滚动发布；单机Compose采用受控维护窗口或明确搭建的双实例代理切换，不声称Compose天然支持跨主机滚动/自动容灾。
- 数据模型变更：先扩展兼容结构，再部署读写双方，回填/验证，最后清理旧结构。
- 数据集：构建新release，质量通过后切换指针；失败保留旧release。
- 紧急修复：`hotfix` 分支修复、测试、生产发布后回合并main和正在进行的release分支。
- 回滚：应用镜像按digest回滚；数据发布切回旧release；任务重算使用明确版本，不盲目回滚已写入的事实数据。

## 8. 最终建议结论

一期冻结前的技术路线：`Vue3/TypeScript + Java21/Spring Boot + PostgreSQL + SeaTunnel + DolphinScheduler + dbt Core/dbt-postgres`。这是候选基线，必须通过本项目PoC和法务/安全审批后才成为正式决策。

Git采用受保护`main`和短功能分支；PoC独立隔离，验证成功的资产重构迁移而不是整包复制；软件、数据集、指标和数据发布分别版本化；开发用Compose，生产有企业容器平台则复用；没有平台且接受单机故障窗口时使用Engine+Compose，数据库与密钥使用持久化/托管能力。


## 9. 发布清单与版本落点

Git标签如 `v0.1.0`（首个实验性可运行版本）、`v0.1.0-rc.1`（候选）、`v1.0.0`（首个正式契约）仅为未来命名示例，当前不创建这些标签，也不宣称软件已发布。稳定之后标签不可移动。

每次发布一个清单：Git SHA、应用版本、各镜像digest、依赖锁文件摘要、配置版本、数据库迁移目标、工作流/模型/指标版本、SBOM和测试结果。开发→测试→生产晋级同一镜像digest，不在每个环境重新构建不同镜像。

软件制品发布清单与数据release_id分开：同一软件版本可生成多次业务数据发布。数据库迁移单独有V001/V002等序号、校验和及执行状态，已经执行的迁移不修改原文件。

依赖清单至少登记组件/模块、用途、上游地址、精确版本、SHA或digest、直接/传递依赖、许可证、NOTICE、漏洞处置、维护者、批准状态。没有明确许可证不进入批准状态；运行时/JDBC驱动/连接器/浏览器和测试工具也在范围内。

## 10. Docker商用许可补充

Docker Desktop与Linux服务器上的Docker Engine应分别进行许可审查，不能把“用Docker发布”解释为“公司开发机可以免费用Desktop”。本轮Docker官方许可页面访问失败，因此不在本基线中将具体免费门槛表述为已核实的当前条款；引入Desktop前必须按当时官方条款核查组织规模、用途及订阅要求。本项目不强制Desktop；开发可连接经批准的Linux Engine环境，生产采用批准的服务器运行时。详见下方官方参考页面。

## 11. 官方来源与适用范围（2026-09-10记录）

- [Apache-2.0原文](https://www.apache.org/licenses/LICENSE-2.0)：商用/分发授权及NOTICE、变更声明等条件。
- [SeaTunnel许可证](https://raw.githubusercontent.com/apache/seatunnel/dev/LICENSE)、[DolphinScheduler许可证](https://raw.githubusercontent.com/apache/dolphinscheduler/dev/LICENSE)、[dbt Core许可证](https://raw.githubusercontent.com/dbt-labs/dbt-core/main/LICENSE)：当前分支声明，生产仍需固定发行物复核。
- [Spring Boot](https://github.com/spring-projects/spring-boot)、[Vue许可证](https://raw.githubusercontent.com/vuejs/core/main/LICENSE)、[PostgreSQL许可证](https://www.postgresql.org/about/licence/)：控制面候选来源。
- [Airbyte根许可证](https://raw.githubusercontent.com/airbytehq/airbyte/master/LICENSE)：ELv2及服务限制，不混同MIT协议文件。
- [Docker Desktop许可](https://docs.docker.com/desktop/setup/install/windows-install/)、[Compose生产部署](https://docs.docker.com/compose/how-tos/production/)：开发工具授权与单机部署能力边界。
- [已保存的固定提交资料索引](research/primary-sources-2026-09-10.json)：此前组件调研证据。

- [语义化版本规范](https://semver.org/lang/zh-CN/)：软件版本递增与不可变发布原则。
- [本轮许可复核记录](research/license-verification-2026-09-10.json)：保留成功和失败的HTTP访问记录；浏览工具未返回可用证据，不作为复核依据。SeaTunnel/DolphinScheduler采用此前固定提交资料；参考链接不代表全部已在本轮成功访问，亦非全依赖合规批准。

本文不是具体交付合同的法律意见；对外分发/托管的最终许可审查按固定制品清单由组织负责。
