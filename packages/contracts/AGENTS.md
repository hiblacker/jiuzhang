# 契约规则

继承 [根规则](../../AGENTS.md)。OpenAPI 3.1 是唯一传输结构来源；当前目录已有 openapi.yaml、generated/schema.d.ts 及独立校验/生成脚本。

## 所有权与独立性

- 本包仅含 schema、生成类型和虚构示例，不依赖 web/api、Vue/Pinia、ORM Entity、宿主环境或业务运行时。
- 使用 openapi-typescript 生成类型，前端 openapi-fetch 消费；后端实现同一契约。生成文件不手改，不在业务模块复制 DTO 镜像。
- schema 校验与类型生成仅依赖本包声明的输入/工具，独立从本包执行应成功；根应用构建不能替代这一验证。包内 pnpm check 验证 schema 与生成漂移，pnpm generate 生成声明。

## 传输语义

- /api/v1 前缀；资源名、分页、筛选、枚举、空值、时间及 HTTP 错误码显式定义；路径有唯一 operationId 和请求/成功/失败示例。
- ID 和超过安全整数范围的计数用十进制字符串；Decimal 以明确定义的精度/尺度传输，避免 JS Number 精度损失；时间用 ISO 8601，明确 UTC/时区语义。
- 区分未提供、null、空字符串、0、false。PATCH 未提供表示保持原值，null 只有 schema 允许时才清空；禁止依赖 truthy/falsy 判断字段是否存在。
- OpenAPI 3.1 用 JSON Schema 的类型联合表达 null，不沿用 3.0 nullable 写法。请求 mapper 不能吞掉显式 false/0，响应、Mock 与后端一致。
- 定义稳定 error.code/requestId/字段错误路径；翻译在前端展示层，后端不返回 HTML 或敏感堆栈。验证失败、无权限、缺失资源、版本冲突有明确 HTTP 语义。
- 发布/运行/重试等写操作声明幂等键、适用作用域、冲突处理与版本前置条件；具体 operation 有示例，不泛化所有端点为一个 resource API。

## 变更与验证

- 修改 schema 后同步生成、Mock、mapper、消费者和测试，说明兼容性；枚举/字段/空值或精度语义变化同样可能是破坏性变更。
- 类型生成不等于运行时校验；Mock/后端请求响应做 schema 校验，覆盖 missing/null/false/0/空集合/高精度及错误状态码。
- 不为简化 Mock 改业务语义；契约示例全部虚构，不含真实凭证或个人数据。
- 生成漂移检查在临时目录生成比较，包括未跟踪文件；包内独立校验与生成命令已启用；远端 CI 状态需独立验证。
