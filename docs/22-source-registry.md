# 控制 API 来源登记第一切片

- 日期：2026-09-14。
- 工作包：PLT-02/ING-01 第一切片。
- 状态：本地单元测试及 PostgreSQL 集成验证通过；尚未实现真实来源连接测试、凭证解析或全量/增量抽取。

## 1. 接口

| 方法与路径 | 用途 | 约束 |
|---|---|---|
| `POST /api/v1/sources` | 创建 DRAFT 来源 | code 为小写稳定标识；sourceType 为大写稳定标识；config 只允许非敏感 JSON；credentialRef 只接受 `env://VARIABLE_NAME` |
| `GET /api/v1/sources?limit=50&offset=0` | 分页查询来源 | limit 1–100，offset 0–1000000；不返回凭证引用 |
| `GET /api/v1/sources/{id}` | 查询单个来源 | 正整数 ID；不存在返回 404 |

所有来源接口要求 `Authorization: Bearer <CONTROL_API_ADMIN_TOKEN>`。Token 仅由运行时环境注入，长度至少 24 字符，不保存到元数据库或日志。当前身份固定投影为 `local-admin`，适合内部单管理员开发部署；正式多用户/SSO 和角色授权仍是后续切片，当前实现不得宣称用户级隔离。

健康接口 `/actuator/health` 和状态接口 `/api/v1/status` 保持匿名可用。每个响应含 `X-Request-Id` 且设置 `Cache-Control: no-store`。

## 2. 数据与安全边界

- SQL 表名和语句固定，值使用 JDBC 参数绑定；接口不接受 SQL、表名或排序表达式。
- `source_connection.credential_ref` 保存引用，不保存密码；API 响应模型没有 credentialRef 字段。
- config 递归拒绝 password、secret、token、API key、private key 和 credential 等敏感键，并限制序列化后最多 16384 字节。
- 创建来源和 `SOURCE_CREATE` 审计在同一数据库事务中；列表和单项读取分别记录 `SOURCE_LIST`、`SOURCE_READ`。
- 当前不提供 `/sources/{id}/test`，因为凭证解析、目标网络白名单、超时和只读会话门禁尚未实现。不能用登记成功替代连接成功。

## 3. 本地验证证据

Java 测试共 9 项：既有服务身份 1 项、认证过滤器 4 项、来源服务 4 项。覆盖缺失 Token、精确 Bearer Token、公开健康接口、弱 Token 启动拒绝、嵌套敏感键、凭证引用格式、稳定编码和分页边界。

本地集成使用已有 `bydw-foundation` PostgreSQL、临时随机管理 Token 和合成来源配置：

| 检查 | 结果 |
|---|---|
| Actuator 健康 | `UP` |
| 无 Token 查询来源 | HTTP 401 |
| 创建合成 MYSQL 来源 | HTTP 201，状态 DRAFT |
| 创建响应包含 credentialRef/变量名 | 否 |
| 查询来源列表 | 成功，包含本轮创建的合成记录 |
| config 含 password 键 | HTTP 400，`SENSITIVE_CONFIG_KEY` |
| 重复 source code | HTTP 409，`SOURCE_CONFLICT` |
| 非数字 limit | HTTP 400，`INVALID_PARAMETER` |
| 单项读取 | HTTP 200，响应不含 credentialRef |
| 创建与读取审计 | 2 条：`SOURCE_CREATE`、`SOURCE_READ` |

集成测试没有连接真实 DevOps MySQL，没有写源库，也没有执行数据库清理。合成来源登记保留在本地开发元数据库，不是生产配置。

## 4. 后续切片

1. 增加来源更新/禁用的并发版本控制，禁止覆盖已变更记录。
2. 增加受限凭证解析器和目标主机/端口白名单，再实现只读连接测试。
3. ingestion job 登记、批次状态机和 RAW 完成门禁已分别在[接入任务契约](23-ingestion-job-contract.md)、[接入批次与检查点](24-ingestion-batch-checkpoint.md)和[RAW 批次门禁](25-raw-batch-evidence.md)完成；执行仍交给独立 Worker，不放入 HTTP 请求线程。
4. 将本地管理 Token 替换为可配置身份提供方和角色策略；SQL 报表账号单独设计。
