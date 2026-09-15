# 通用数仓产品实施进度

范围：30 号产品报告及 31/33 号验收；复核缺陷修复记录见 [35](35-lake-review-and-remediation.md)。用户要求持续本地提交，页面先简单接通真实操作，后续统一框架。以下只记录实际实现，未验收项继续开发。

## 持续入湖控制面

V012 新增不可变计划版本、应有日期窗口和执行尝试。一个来源只有一个活动计划；修改使用预期版本比较，保留旧定义。每次重试保留旧尝试并获得新租约令牌。

| API | 用途 |
|---|---|
| `GET/POST /api/v1/lake/plans` | 查看/保存计划新版本，`runtimeRef` 只指向 Worker 管理员配置的执行资源 |
| `POST /plans/{id}/state` | `ACTIVE` / `PAUSED` |
| `POST /plans/{id}/trigger` | 指定日期及原因触发；显式 revision 产生修订，普通重复请求返回同一窗口 |
| `POST /calendar/reconcile` | 有界登记漏跑日历，每计划每次最多补齐 31 个窗口；不能恢复的历史快照标 `MISSING` |
| `GET /windows`、`GET /executions` | 查看日期及尝试，支持 `planId` 过滤 |
| `POST /executions/claim` | Worker 按已配置 `runtimeRefs` 领取任务；同计划互斥 |
| `POST /executions/{id}/heartbeat`、`/finish` | 以 owner、租约令牌和有效期围住执行；完成请求可安全重放 |
| `POST /executions/{id}/retry`、`/cancel` | 管理员重试/取消；旧租约拒绝提交 |

表中缩写路径均相对 `/api/v1/lake`。计划、触发和管理操作用 Admin 身份；领取、心跳和完成用 Worker 身份。计划配置不接收路径、SQL、shell 或凭证；资源路径只在 Worker 本地注册表配置。调度来源的 MySQL manifest 必须经执行完成事务登记，不能绕过租约直接提交。

日历驱动通过 `LAKE_CALENDAR_DRIVER` 二选一：默认 `external` 由外部已选调度组件调用 reconcile；本地运行可设置 `local`，后台每 10 秒对账，不依赖页面。此处是平台交付日历，DolphinScheduler 正式集成与部署仍需后续验收。

本批真实 PostgreSQL/HTTP 测试覆盖：先手动触发今天仍可发现昨天的遗漏、重复对账不重复入队、并发领取只有一个成功、租约过期后自动排队新尝试、旧租约提交拒绝、取消可见、重试请求幂等。该控制面切片提交为 `632c308`。

## 独立执行与简单页面

`apps/ingestion-worker/lake-runtime.mjs` 是持续入湖执行进程；复用已有 Node 适配器，原 Java 合成 Worker 保留用于兼容验证。它从控制 API 领取已批准的执行配置，后台续租，取消或失联时终止适配器进程组。完成回执先写本地 outbox 再提交，响应丢失时只重放回执；过期租约不能误报成功。路径与凭证配置在管理员本地注册表，不从任务 HTTP 请求传入。

配置模板见 [Worker 注册表](templates/lake-runtime.example.json)，只保留实际启用的配置，替换绝对路径及来源编码。`datePartitioned: true` 时文件目录为 `<inboxRoot>/<YYYY-MM-DD>/`，保持每日日份独立；CSV 等仍以 `.done` 标记闭合。

```bash
# CONTROL_API_WORKER_TOKEN 从运行环境注入
node apps/ingestion-worker/lake-runtime.mjs --registry /path/to/private-runtime.json \
  --control-api http://127.0.0.1:8080 --instance lake-worker
```

真实集成验证已从 HTTP 入队开始启动独立 Node Worker，完成合成目录的原件封存、CSV 解析、数据库完成状态及回执确认；前导零 `001` 保留。另有网络中断测试验证完成响应丢失后不重新读取已变化的外部文件。

简单控制台已接通来源、计划、暂停/恢复、触发、取消、重试和日历查询。使用本机已有 Playwright 1.62.1 实际点击以上操作通过；无页面脚本错误，390px 视口无页面横向溢出。此测试属于开发验证工具，未新增应用依赖。项目角色、资产及建模页面随后追加。

## 剩余出口条件

1. Worker 用同一执行契约运行真实 MySQL/目录/API；原件和完成回执可恢复，结构变化有发现/阻断/确认路径。
2. 文件每日交付：包判齐、空交付、缺失、迟到、修订、解析规则版本及原件重处理。
3. 项目/角色、主题、资产详情与受控预览；简单页面提供真实操作。
4. Git SQL/dbt 模型、依赖与变更影响、质量、版本发布、服务端行列授权查询；第二主题用配置复用。
5. 本地启动、原始区/元数据/模型联合备份还原、前向迁移及资源结果；真实跨日及 NAS/生产状态分别说明。
