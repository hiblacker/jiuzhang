# 42 首次上手：投文件 → 出数据集 → 查询

本机 Compose 产品栈（API `60283`、工作台 `60284`）的逐步操作手册。界面字段名与按钮标签取自当前代码 `apps/console/src/*.vue`（提交 `239b377`）；概念与边界见 [41 号运行手册](41-product-workbench-runbook.md)，验收项与现场条件见 [39 号契约](39-next-product-acceptance-contract.md)。

**证据边界**：流程四（注册 SQL）2026-09-17 在 api `0.2.0-dev.17` / worker `0.2.0-dev.24` / console `0.2.0-dev.7` 上由 `tests/sql-ingestion-integration.py` 端到端跑通（精确十进制字符串、遮罩预览、JOIN、资产与作业映射；证据见 [45 号文档 §10](45-sql-ingestion-with-seatunnel.md)）。流程一的入湖链路与流程二的 Git 模型打包，2026-09-17 在 `0.2.0-dev.5` 镜像上本机实测通过（脚本与结论见 `work/diagnostics/`，该目录不提交）；流程二的构建/发布与流程三的授权/查询沿用 [40 号文档](40-product-workbench-progress.md) 记录的浏览器验收，本次未在本机逐步录证。

## 0. 开工前：环境里已有什么

| 名称 | 值 | 备注 |
|---|---|---|
| 工作台 / API | `http://localhost:60284` / `:60283` | 容器只绑定 `127.0.0.1`，Windows 用 `localhost` 访问 |
| 平台管理员账号 | `platform_admin` | 密码是你开户时设的（≥12 字符）；**API 每次重启会话失效，需重新登录** |
| 项目 | `test`（测试项目，id 1） | 你已创建 |
| 执行环境 | `local-product` | 本机产品环境，`maxParallel 2` |
| 已批准资源 | `daily-files`（每日文件目录，FILE_SCAN） | 已授权给项目 `test` |
| Worker | `lake-worker`（入湖）、`model-worker`（模型） | 心跳正常；`/data/inbox` 只读挂载宿主机 `work/product-next/inbox` |
| 模型仓库 | `平台示例模型仓库`（`platform-models`） | `models/commerce`，已授权给项目 `test` |

命令行自检（可选）：

```bash
cd ~/AIProjects/jiuzhang
set -a; . secrets/product-next.env; set +a
docker ps --format '{{.Names}}\t{{.Status}}'
docker exec -e PGPASSWORD="$WAREHOUSE_DB_PASSWORD" jiuzhang-next-warehouse-db-1 psql -U warehouse -d warehouse \
  -c "SELECT environment_code,worker_id,last_seen_at>clock_timestamp()-interval '90 seconds' AS online FROM warehouse.worker_observation;"
```

`online = t` 才说明 Worker 被授权；不是 `t` 就去「项目与设置 → 登记环境」检查 `local-product` 与你实际的 Worker ID。

## 流程一：每天一份文件入湖（约 5 分钟）

### 1. 投递文件

容器把 `work/product-next/inbox` 只读挂到 `/data/inbox`，**直接往宿主机目录放文件即可，不需要重启任何东西**。本例用相对目录 `test-daily`：

```bash
cd ~/AIProjects/jiuzhang
mkdir -p work/product-next/inbox/test-daily
printf 'id,team,amount\n001,east,12345678901234567.89\n002,west,8.20\n' > work/product-next/inbox/test-daily/orders.csv
: > work/product-next/inbox/test-daily/orders.csv.done      # 完成信号：同名 .done
```

### 2. 登记业务系统

「接入管理」→ **登记业务系统**：

| 字段 | 填什么 |
|---|---|
| 稳定编码 | `test-erp`（登记后不变） |
| 系统名称 | `测试ERP` |
| 业务责任人 / 技术责任人 | 任意真实姓名 |
| 归属组织 | `数据组` |
| 系统并行任务上限 | `2` |

### 3. 新增实例

在系统详情页 → **新增实例**：实例编码 `test`、实例名称 `测试实例`、源系统环境 `测试`。

### 4. 接入新来源（连接与采集规则）

在当前实例下 → **接入新来源**，按三步向导的第一屏填写：

| 字段 | 填什么 |
|---|---|
| 已授权执行资源 | `每日文件目录 · FILE_SCAN · local-product` |
| 连接编码 / 连接名称 | `files` / `每日订单目录` |
| 来源稳定编码 / 采集通道名称 | `test_orders` / `每日订单` |
| 资源根目录下的相对目录 | `test-daily` |
| 每日子目录（YYYY-MM-DD） | **不勾**（本例文件直接放在 `test-daily` 下；勾了就要放 `test-daily/2026-09-17/`） |
| 交付方式 | `固定每日文件集` |
| 完成信号 | `.done 标记` |
| 每日必需文件 | `orders.csv`（每行一个） |
| 解析格式设置 | `CSV`；编码 `utf-8-sig`（纯 ASCII 用 `utf-8` 也行）；分隔符 `,` |
| 应到时间 / 交付延后天数 | `09:00` / `0` |
| 允许明确的空交付 / 允许内容更正产生新修订 | 按需，本例都不勾 |

点 **保存并测试发现**。

### 5. 预检（测试与发现）

进入第二屏：标签变 `COMPLETE` 并显示「目录可读，发现 N 个结构化文件」。没通过就点 **重新测试**；改了规则点 **修改采集规则** 回到第一屏。

### 6. 交付计划

点 **设置交付计划**：业务时区固定 `Asia/Shanghai`、开始日期 `今天`、每日执行时间 `08:00`、迟到等待天数 `7`、勾选「已确认此来源可按业务日期读取历史交付」→ **确认范围并启用**。

### 7. 立刻跑一次

回到实例的通道列表，该行出现 **采集今日**（只有启用后才出现）→ 点它。

### 8. 核对

- 「资产目录」出现 `orders.csv`，状态 `PARSED`、行数 `2`、大小 `N` 字节
- 「运行中心 → 采集执行」出现一条 `COMPLETE`（本例实测约 0.3 秒）

```bash
docker exec -e PGPASSWORD="$WAREHOUSE_DB_PASSWORD" jiuzhang-next-warehouse-db-1 psql -U warehouse -d warehouse \
  -c "SELECT id,object_key,state,row_count,byte_count,created_at FROM warehouse.external_asset ORDER BY id DESC LIMIT 5;"
docker logs --tail 20 jiuzhang-next-lake-worker-1
cat work/product-next/lake/delivery-ledgers/test_orders/$(date +%F).json   # 交付账本：修订、批次、行数、观测次数
```

计划状态（`ACTIVE` 表示每天按 `08:00` 跑）：

```bash
docker exec -e PGPASSWORD="$WAREHOUSE_DB_PASSWORD" jiuzhang-next-warehouse-db-1 psql -U warehouse -d warehouse \
  -c "SELECT p.id,s.code,p.state FROM lake.ingestion_plan p JOIN control.source_connection s ON s.id=p.source_id ORDER BY p.id;"
```

## 流程二：建模 → 构建 → 发布

数据集的输入必须来自**同一项目**的已入湖资产，所以先做完流程一。

1. 「数据开发」→ **从 Git 模型包建立数据集**。
2. 弹窗「登记 Git 模型包」：批准仓库 `平台示例模型仓库`、模型目录 `models/commerce`、Git 分支、标签或提交填 `main` → **提交打包任务**（只打包已提交内容）。约几秒后点 **刷新包列表**，该行状态 `COMPLETE`、提交 `2a89d2e…`。
3. 该行点 **绑定资产建立模型**：数据集编码 `orders_daily`、数据集名称 `每日订单`；每个输入点 **选择来源对象**，选流程一的 `orders.csv` → **保存模型版本**。
4. 进入该数据集详情：选「模型版本 1」→ 每个输入点 **选择资产版本**（选同一完整批次）→ **使用固定输入构建**。
5. 构建行点 **质量与依赖**：三个页签分别是「质量检查」「节点依赖」「输入版本」。基础结构/唯一性/必填必查；未配置扩展规则时会如实标注。
6. 构建状态变 `READY` 后点 **发布** → 填「发布原因」→ **确认发布**；数据集头部「当前发布」出现发布号。
7. 可选：详情页下方的每日刷新面板可配置服务身份、输入业务日偏移、工作日、触发/截止时间；**默认人工发布**，自动发布要求该模型版本已有人工首发。

## 流程三：授权 → 查询 → 导出

> 注意：行列授权弹窗里的「项目查看者 / 服务身份」**只列出本项目中角色为 VIEWER 的成员**。项目 `test` 目前没有任何成员，所以这一步前必须先加人。

1. 「项目与设置」→ 二选一：
   - **为已有账号设置角色**：账号 `platform_admin`、项目角色 `VIEWER`（单机自测最省事，你自己就能当查看者）；或
   - **邀请新账号**：账号 `reader`、显示名称、项目角色 `VIEWER` → **邀请新账号** 会弹一次性邀请码；用**无痕窗口**打开工作台 → 「使用邀请码开户 / 重置密码」→ 粘贴 43 位邀请码 + ≥12 字符密码 → 返回登录。
2. 用管理员窗口：「数据服务」→ 选数据集 `每日订单` → **配置行列授权**：
   - 项目查看者 / 服务身份：`platform_admin`（或 `reader`）
   - 允许查询字段：`order_id`、`team`、`amount`
   - 行范围 → **增加行条件**：如 `team` 等于 `east`（多个条件是"同时满足"）
   - **保存授权新版本**
3. 查询：**固定发布版本** 选刚发布的版本 → 勾选查询字段 → 「查询」→ 结果只含授权字段与授权行；**导出本页 CSV** 只导出当前有界页。
4. 想看服务化调用：「调用示例」给出服务令牌调用方式（令牌只回显一次，不写浏览器存储）。
5. 审计与异常：「运行中心 → 查询审计」保存身份、发布/策略版本、条件摘要、行数、耗时与请求 ID（不保存条件原值和结果行）；「站内异常」确认只记录责任人，**只有真实完整交付或成功发布才转恢复**。

## 流程四：写一条 SQL 入湖（注册 SQL，约 8 分钟）

适用场景：源库已经能连上，但你要的是一段自己写的查询（可 JOIN、可聚合），而不是整表快照。执行层是 SeaTunnel，只读查询一律放行（ADR-012）。

1. 「项目与设置」→ 数据源：登记 MySQL 连接（主机、端口、库、账号、凭据引用名），保存后自动做一次**连接测试**；只有拿到"只读证明"的数据源才能被 SQL 渠道使用。密码只落在 `${PRODUCT_CONFIG_ROOT}/datasources/<凭据引用>.json`（0600），界面不回显。
2. 「接入管理」→ 新建接入 → 步骤 1「连接与采集规则」：
   - 来源模式选 **注册 SQL**；
   - 这一步不再选表，直接进入 SQL 面板：面板上方列出**允许使用的表**（点击可插入表名），下方是 SQL 文本域；
   - 依次点 **校验**（看是否有阻断项：写操作、多语句、系统库、未声明参数）→ **保存草稿** → **预览**。
3. 预览结果：最多 1000 行（服务端硬上限，界面不可调大）；勾选为**遮罩列**的字段显示为 `***`；预览会写入审计。预览是启用版本的前置条件——没跑成功预览就存不出可启用版本。
4. 在面板里填写**粒度**与**唯一键**，点 **保存为新版本**，再对目标版本点 **启用**（必须填启用原因，会写审计；默认不强制双人评审）。
5. 步骤 2「测试与发现」在 SQL 模式下不需要预检；直接到步骤 3「交付计划」：时区固定 `Asia/Shanghai`、触发时间、起始日期、`lateDays`、超时与最大尝试次数 → **确认范围并启用**。
6. 「采集今日」立刻跑一次；完成后到「运行中心」看这次执行（SeaTunnel 作业 id、状态、耗时都在这里），再到资产/数据集侧看到新落湖的对象。
7. 核对落湖：`work/product-next/lake/raw/<渠道 code>/<批次>/<渠道 code>/data.jsonl` 与 `schema.json`，批次元数据在 `lake/batches/<批次>/batch.json`（含 `sqlVersionId`、`sqlSha256`、`scalarEncoding=mysql-char-v2`、`inventoryVersion`）。

**SQL 模式下的状态与错误**

| 现象 / 错误码 | 含义 | 处理 |
|---|---|---|
| `SQL_VERSION_NOT_ENABLED` | 渠道没有已启用的 SQL 版本 | 先在 SQL 面板保存版本并**启用** |
| `SUCCESSFUL_SQL_PREVIEW_REQUIRED` | 该版本没有成功预览记录 | 回到 SQL 面板点**预览**，等状态变 `COMPLETED` |
| 预览 `SQL_BLOCKED` | 静态校验有阻断项 | 按面板提示改 SQL（去写操作/多语句/系统库/未声明参数） |
| 执行 `SEATUNNEL_EXTRACT_FAILED` | SeaTunnel 作业失败 | 看 Worker 日志里的 `detail` 与作业状态；确认源库连通与列名正确 |
| 执行 `SQL_RUNTIME_PROFILE_INCOMPLETE` | 计划/渠道配置缺 SQL 字段 | 重新启用渠道版本，确认 SQL 版本处于 ENABLED |
| 预览超时 | 查询超过 `statement_timeout_ms` | 优化 SQL 或调整数据源的语句超时 |

> 精度提示：注册 SQL 的结果全部按字符串落湖（`CAST(... AS CHAR)`），`DECIMAL` 不会丢精度、时间保持源库墙钟。列类型目前是**推断值**（`inferred:true`），正式建模前请人工确认。

## 常见状态与错误

| 现象 / 错误码 | 含义 | 处理 |
|---|---|---|
| Worker 日志 `SYSTEM_ACCESS_DENIED` | 环境未登记，或该环境的 `workerIds` 不含该 Worker | 项目与设置 → 登记环境：`local-product` + Worker ID `lake-worker`；改完只重启对应 Worker |
| `NOT_FOUND` (404) | 请求地址不存在 | 检查页面/接口路径；这是路由错误，不是服务故障 |
| `INVALID_INVITATION_FORMAT` | 邀请码不是 43 位（带了引号/花括号/换行） | 只复制邀请文件里 `invitation` 的值 |
| `INVALID_PASSWORD_FORMAT` | 密码不足 12 字符或超 72 字节 | 用 ≥12 字符的 ASCII 密码 |
| `INVITATION_EXPIRED` | 邀请码已使用、过期或不存在 | 让管理员在「项目与设置」重置该账号并重新签发 |
| `MODEL_PROJECT_PATH_NOT_APPROVED` | 模型子路径未批准 | 项目与设置 → 模型仓库「允许模型子路径」加 `models/commerce` |
| `MODEL_WORKER_NOT_ALLOWED` | 模型 Worker ID 未包含 | 登记模型仓库时 `模型 Worker ID` 填 `model-worker` |
| 通道无「采集今日」 | 计划未启用 | 先走完预检 → 设置交付计划 → 确认范围并启用 |
| 计划 `PAUSED` | 计划被暂停（含人工暂停、系统/实例暂停） | 「接入管理」恢复该计划；层级暂停会阻止后代新任务 |
| 执行 `SCHEMA_CHANGE_REVIEW_REQUIRED` | 结构与基线不同 | 「运行中心」执行详情填写原因后 **批准已显示的结构差异** |
| 「尚未取得 dbt 节点依赖」 | 动态 SQL 未解析列级依赖 | 属如实标注，不是失败 |

## 出问题先看哪里

```bash
cd ~/AIProjects/jiuzhang
docker ps --format '{{.Names}}\t{{.Status}}'                  # 1. 服务是否在跑
docker logs --tail 30 jiuzhang-next-control-api-1              # 2. API 故障（含 requestId）
docker logs --tail 30 jiuzhang-next-lake-worker-1              # 3. 入湖 Worker 状态
docker logs --tail 30 jiuzhang-next-model-worker-1             # 4. 模型 Worker 状态
ls work/product-next/lake/delivery-ledgers/                    # 5. 交付账本（按来源/按日）
ls work/product-next/lake/worker-outbox/lake-worker/            # 6. 未确认的 Worker 回执
```

页面报错时把提示里的 `requestId` 一起记下来，它与 API 日志中的同名字段对应。

## 已知边界

- 真实连续每日窗口、真实目录/API、NAS 部署与人工试用（A18）尚未验收；自动化通过不等于生产稳定。
- 本机 Windows 回归套件存在既有失败（目录 fsync EPERM、路径分隔符），隔离基线同样失败，未通过削弱持久化保障来变绿。
- 一期历史数据不能由当前态补造；MySQL 当前态快照无法回读过去。
