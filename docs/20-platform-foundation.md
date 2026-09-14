# 20 正式平台骨架实施记录

- 日期：2026-09-14。
- 状态：PLT-01 第一切片已完成本地构建和 Compose 运行验证；不代表 NAS 部署或生产验收。
- 范围：Java 控制 API、PostgreSQL 元数据迁移和 Compose 基础。PoC 继续保留在 `poc/`，不直接打入正式应用镜像。

## 1. 已锁定版本

| 组件 | 版本/摘要 | 用途与边界 |
|---|---|---|
| Spring Boot | 3.5.16 | Java 21 控制 API；选择 3.5 维护线，不采用里程碑版本 |
| PostgreSQL JDBC | 42.7.7 | 控制元数据库连接 |
| 控制 API 镜像 | `bydw/control-api:0.1.0-dev` | 当前开发版本；正式发布时改为对应 SemVer |
| Maven 构建镜像 | `maven:3.9.11-eclipse-temurin-21` | Maven 3.9.11 + Temurin 21，多阶段构建 |
| Temurin JRE | `eclipse-temurin:21.0.12_8-jre-jammy` | API 运行时，非 root 用户 |
| PostgreSQL | `postgres:16.15` | 控制元数据库与迁移服务 |

直接版本已固定；Spring Boot BOM 管理的传递版本仍需在交付前生成完整 SBOM、许可证和漏洞报告。Docker 使用版本标签而非 digest；Maven 构建使用不进入运行镜像的 BuildKit 缓存，以便网络中断后继续下载。发布时另行记录构建摘要和扫描结果。当前锁定不等于外部私有化交付许可已经批准。

## 2. 迁移策略

迁移文件位于 `migrations/`，已执行文件不得修改。Compose 通过一次性 `migrate` 服务按文件名顺序执行：先建立 `control.schema_migration`，再记录文件 SHA-256；相同版本校验和变化会失败。每个业务迁移在单事务内执行，失败时 API 不启动。

生产/正式 NAS 部署不得依赖 PostgreSQL 的首次初始化目录，也不得由 API 自动更新模式。数据库恢复采用备份恢复后重新核对迁移记录；破坏性回滚不作为默认方案，修复使用新的前向迁移。

## 3. 当前能力与边界

首版迁移包含来源、接入任务/批次、数据集版本/发布/活动指针和审计日志的最小表。API 已提供服务状态及来源登记/查询第一切片，详见[来源登记 API](22-source-registry.md)；长时间接入和模型执行不会放进 HTTP 请求处理器。

2026-09-14 本地验证：API 镜像构建成功且构建阶段测试通过；PostgreSQL、一次性迁移服务和 API 按依赖顺序启动；V001 记录校验和并创建 8 张 `control` 表；重复运行迁移后记录仍为 1 条；`/actuator/health` 与 `/api/v1/status` 均返回 `UP`。

尚未实现：多用户/角色授权、来源连接测试、运行控制、真实 DevOps 抽取、RAW/ODS、质量门禁、数据集发布服务、Naive UI、NAS 部署、备份恢复和容量测试。后续实施顺序、出口证据和阻断项见[后续规划与里程碑](21-next-milestones.md)。
