# 后端开发规则

继承 [根规则](../../AGENTS.md)。根规则明确要求 API、Worker、后端库及元数据迁移的变更共同遵守本文件；跨目录适用来自根规则的显式指定。2026-10-19 已获准开始首个真实版本；独立前端 Mock 启动仍不依赖后端。详细架构见 [总体方案](../../docs/architecture.md)。

## 技术栈与模块

- Java/Spring Boot 为候选；Maven Wrapper、Flyway、ArchUnit、JUnit/AssertJ 与 Testcontainers 为后端工程候选。实施时统一验证并锁定 JDK、框架、插件和驱动，不把设计中的版本当成已验证组合。
- PostgreSQL 为首个元数据库，Doris 为首个分析仓库，S3 兼容存储为原始/隔离批次存储。源端支持多种数据库不等于元数据库支持多种方言。
- Controller → Application → Domain/Port；Infrastructure 实现 Port。Controller 管传输/身份/DTO，Application 管用例和短事务，Domain 管规则，适配器管外部 I/O。
- 模块通过公开 application API、领域事件和稳定 ID 协作，禁止跨域 DAO/ORM 导入。应用入口负责装配，API 与 Worker 不互相依赖入口代码。
- Controller/HTTP DTO mapper 放 apps/api，领域用例/规则/基础设施首期放 modules/platform 内各领域包，Worker 直接调用公开 application 用例。包级依赖也须 ArchUnit 验证，不因同一 jar 放宽边界。
- PostgreSQL 迁移唯一源在 infra/migrations/postgresql，构建显式打包，由单一受控迁移步骤执行；普通 API/Worker 进程不并发自动升级 schema。
- Connector SPI、纯转换与仓库 Port 不依赖宿主服务、Spring 配置、持久化或前端；只有明确需要独立消费时才拆独立构建模块，并单独验证。

## 接口、序列化与副作用

- OpenAPI 是跨语言边界；DTO 不暴露 ORM Entity。输入缺失/null/0/false 语义显式定义，PATCH 的字段存在性不能仅靠普通 nullable 字段推断。
- 复用统一 JSON 配置、时间/Decimal 映射、错误结构和日志脱敏；配置属于传输/基础设施边界，领域纯规则不依赖 JSON 库。业务代码不每处 new 一套序列化器。
- HTTP、SQL、存储、连接器调用经注入的适配器；明确超时、取消、重试、资源关闭与并发预算。查询值参数化，动态标识符白名单校验。
- 事务不跨长时间源端读取、文件上传或仓库加载；通过持久状态、幂等键、发布记录与对账恢复处理跨系统失败，不假设 PostgreSQL/Doris/S3 可共同回滚。
- 发布版本不可变，运行绑定版本；写入/发布确认前不推进成功游标。重试新建关联运行，不重写失败运行日志；Worker 租约过期不能继续发布。
- 计数/批量/超时/分页有下限和上限，高精度值不隐式浮点化；非法值明确拒绝，数据类型收窄或丢行必须由策略允许且审计。

## 安全与验证

- 服务端执行对象权限、密钥引用、脱敏、导出范围和幂等验证；真实认证变更核对适用 OWASP 指南，审计排除密码/可用 Token/原始敏感行。
- 源端 HTTP 防 SSRF 和重定向绕过；数据库账号默认只读；演示场景与真实环境隔离。
- 持久化/驱动/迁移变化执行受影响真实引擎的支持矩阵；覆盖空库初始化、代表性旧 schema 升级、重复启动/迁移、数据/索引/约束保留。只跑 Mock 或构建不能报告兼容。
- 功能小改优先扩展已有测试；按行为边界覆盖关键不变量，不在每层重复 fixture/断言。并发、重试、游标和失败恢复需确定性测试。
- ArchUnit、OpenAPI 一致性、迁移与真实引擎集成测试均待实施；报告实际版本、命令、结果和未验证范围，不提前宣称完成。
