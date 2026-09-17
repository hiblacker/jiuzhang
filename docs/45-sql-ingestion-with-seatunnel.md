# 45 用 SeaTunnel 做 SQL 接入：实施方案（含前端操作细节，待评审）

状态：**方案，未批准，未开发**。本文回答"接回 SeaTunnel 能不能用 SQL 接入数据"，并给出到前端控件级别的实施方案。批准前不得据此实现。

配套：[43 号 MySQL 接入方案](43-mysql-ingestion-design.md)（能力盘点与总体设计）、[33 号入湖设计](../docs/33-lake-implementation-design.md)（批次与清单约束）、[44 号界面重构方案](44-console-redesign-plan.md)、[工程治理](09-engineering-governance.md)。

## 0. 直接回答

**能。而且这个能力在本仓库里已经被跑通过一次**：`poc/component/st/jobs/objects.json` 是 POC-01 实际执行的 SeaTunnel 2.3.13 作业，其 `Jdbc` source 已经做到"自定义 SQL + 列裁剪 + `AS` 别名 + 水位半开窗口 + 批次列 + 有界 `fetch_size`"，参数由平台注入模板（`__CURSOR__`/`__UPPER__`/`__BATCH__`）。POC-01 的 `adapter/app.py` 也给出了产品化的驱动方式：**通过 SeaTunnel REST 提交作业并轮询状态**。

所以这不是"要不要引入新东西"，而是**把已经验证过的执行路径接回产品，并把欠的工程补齐**：安全校验、批次与清单契约、字段契约、前端交互、失败与取消语义。

**一条边界必须先讲清楚**：SeaTunnel 是**执行器**，不是安全边界，也不是产品契约。放行 SQL 的责任在平台：

| 责任 | 归属 |
|---|---|
| SQL 合法性（单条 SELECT、禁 DDL/DML、禁越库、占位参数声明） | **平台**（SeaTunnel 不校验） |
| 字段名/类型契约、重命名、脱敏、是否对外 | **平台** |
| 批次、幂等键、清单、逐表 sha256、结构漂移审阅、资产登记 | **平台**（沿用现有实现） |
| 读取数据、按 SQL 投影、类型转换、写文件 | **SeaTunnel** |
| 权限、审计、数据预览的脱敏与限额 | **平台** |

## 1. 能力边界（能做什么 / 不能做什么）

**已由仓库内 POC-01 证据支持的能力**（`poc/component/st/jobs/*.json`、`poc/component/adapter/app.py`）：

- 自定义 SQL 抽取：`"query": "SELECT ... FROM t WHERE updated_at > '__CURSOR__' AND updated_at <= '__UPPER__' ORDER BY updated_at, id"`
- **列裁剪 + 表达式 + 别名**（等价于"字段重命名 + 类型规范化"）：`DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updated_at`
- **增量水位半开窗口**：`> cursor AND <= upper`（与[数据加工规范](03-data-processing.md)的半开窗口要求一致）
- 批次列注入：`'__BATCH__' AS batch_id`
- 有界读取：`"fetch_size": 10`（生产值按资源预算设定）
- REST 驱动：`POST http://seatunnel:5801/hazelcast/rest/maps/submit-job` → 返回 `jobId`；`GET .../job-info/{jobId}` 轮询状态（POC 适配器每 3 秒轮询）
- 运行形态：`apache/seatunnel:2.3.13` 容器（版本已锁在 `poc/component/dependencies.lock.json`），`hazelcast` 端口 5801，`job.mode: batch`

**P0-a 尖峰实测结论（2026-09-17，`poc/seatunnel-sql/`，可复现）**：下表已全部取证，不再是假设。原始证据见该目录的 `results.json` 与 [README](../poc/seatunnel-sql/README.md)。

| 问题 | 实测结论 |
|---|---|
| 文件 sink 能否直出 **JSONL** | **能**：每行一个 JSON，分片文件 `T_<jobId>_<hash>_0_1_0.json`；`isJsonl=true`、`isJsonArray=false` |
| `DECIMAL` 精度 | 文件文本**逐位保留**（`12345678901234567.89`、`999999999999999999.99`），但 sink 写成**未加引号的 JSON 数字**，任何浮点读端都会静默丢精度。改用 `CAST(col AS CHAR)` 后写成**字符串**且位数不变 —— 与现有 `mysql-char-v2` 契约一致 |
| `DATETIME` 形态 | 不加 CAST：**UTC 且无时区标记**（`2026-09-17T01:58:11.123`），毫秒为 0 时被省略；加 `CAST(... AS CHAR)`：**源本地墙钟** `2026-09-17 09:58:11.123`（可判定、与 `sourceTimeZone` 配套） |
| 取消接口 | **存在且可用**：`POST /hazelcast/rest/maps/stop-job`，body `{"jobId":"…"}` → 200，状态转 `CANCELED`，**不残留半成品文件** |
| 并发与内存 | 两个作业**同时 RUNNING**（`pending=0`），容器 2 GiB / 1 CPU 下占用 486–530 MiB |
| 只读账号 | `CREATE TABLE` 被拒（`ERROR 1142`），`SELECT` 正常 —— 这正是连接测试要验的 |
| 行数/字节 | 平台自行扫描产物统计，**不依赖**引擎指标（原方案成立） |

**因尖峰而修改的设计**：① SQL 模式对精度敏感列（`DECIMAL`/`DATETIME`/`TIMESTAMP`）**注入 `CAST(col AS CHAR)`**，保持 JSONL 契约不变、读端零改动、时间可判定（示例作业 `poc/seatunnel-sql/jobs/orders-char-cast.json`）；② **字符集必须作为数据源显式字段**：尖峰首跑因 fixture 未 `SET NAMES utf8mb4` 导致列名双重编码而失败（现有产品路径已固定 `default-character-set=utf8mb4`，见 `tools/mysql-discover.mjs`）；③ 取消可直接暴露到界面，因为取消不留半成品。

## 2. 架构与数据流

```text
控制台（接入向导 · SQL 编辑器 · 预览 · 版本与影响）
   │  定义与预览（受限）
   ▼
控制 API（Java/Spring）
   │  ① SQL 静态校验与版本化 ② 生成作业参数 ③ 批次与清单 ④ 资产登记 ⑤ 权限/审计
   │  提交/轮询（内部 HTTP）
   ▼
SeaTunnel Zeta 2.3.13（新 compose 服务，仅内网，端口 5801）
   │  Jdbc source(query, fetch_size) → 文件 sink(每表一个目录)
   ▼
湖目录（平台计算 sha256/rows/bytes 并写 schema.json + batch.json）
   │
   ▼
既有下游：lake-register → 资产登记 → 模型构建 → 质量 → 发布 → 查询
```

**关键设计选择（本方案的立场）**

1. **SeaTunnel 只做"读 + 投影 + 写文件"，不写数据库表**。POC-01 用 JDBC sink 写 `raw_landing` 表是 PoC 做法；产品形态应落湖目录，保持"不可变原件 + 清单 + 逐表哈希"的既有性质，避免把业务数据灌进仓库库存储。
2. **一表一作业**（与 POC-01 的 `objects.json`/`events.json` 一致）。好处：逐表重试、逐表资产、与 `batch.json` 的逐表条目一一对应；坏处：N 张表 = N 次提交，由资源 `maxParallel` 与作业并发上限控制。
3. **哈希与行数由平台计算**，不用 SeaTunnel 的指标：平台扫描落盘产物（流式），得到 `rows`/`bytes`/`sha256`，沿用现有 `RAW_INTEGRITY_MISMATCH` 校验。这样"完整性由平台负责"的既有性质不变，也不依赖未验证的指标接口。
4. **Worker 不装 JRE、不挂 docker socket**：新增 `seatunnel` 服务，worker 只做提交者与校验者（与现有 `child()` 执行模型的差异仅在"执行体在另一个容器"）。
5. **表清单模式保持现有自研路径**，SQL 模式走 SeaTunnel；两条路径产出**同一份** RAW 契约，禁止同时维护同一来源的两种执行方式（[33 号设计](../docs/33-lake-implementation-design.md)约束）。

## 3. 作业配置与批次契约

### 3.1 平台生成的作业模板（SQL 模式，MySQL→JSONL）

```json
{
  "env": {"job.mode": "batch", "parallelism": 1},
  "source": [{
    "plugin_name": "Jdbc",
    "url": "jdbc:mysql://{{host}}:{{port}}/{{database}}?useSSL=true&serverTimezone={{source_timezone}}",
    "driver": "com.mysql.cj.jdbc.Driver",
    "user": "{{credential_ref_user}}",
    "password": "{{credential_ref_password}}",
    "query": "<用户登记的 SQL：只读、含水位条件或显式全量、列已别名>",
    "fetch_size": 1000
  }],
  "sink": [{
    "plugin_name": "<file sink，P0 尖峰确认>",
    "path": "{{lakeRoot}}/raw/{{sourceCode}}/{{batchId}}/{{table}}/",
    "file_format_type": "json",
    "options": {"{{待确认选项}}": "{{...}}"}
  }]
}
```

- 所有 `{{...}}` 由**平台注入**：连接信息来自已批准资源与凭证引用，`sourceCode`/`batchId`/`table` 来自本次执行，窗口参数来自计划。
- **精度敏感列必须转文本**（P0-a 尖峰结论）：生成器对 `DECIMAL`/`DATETIME`/`TIMESTAMP` 列注入 `CAST(col AS CHAR)`，使 JSONL 与现有 `mysql-char-v2` 契约一致、读端零改动、时间以源本地墙钟表示。用户手写 SQL 时，校验层要求这些列已 CAST，否则阻断并给出自动修正建议。
- 用户在编辑器里只能写 `SELECT` 本体与**已声明的占位参数**（见 §5.2）。
- `parallelism` 固定 1（单表单文件，避免同表并发写导致清单与哈希难以对应）；提并发靠"多表并行"而不是"单表分片"。若后续需要分片，再评估 `partition_column`（本轮未取证）。

### 3.2 参数注入规则（禁止拼接）

| 参数 | 来源 | 说明 |
|---|---|---|
| `{{window_start}}` / `{{window_end}}` | 计划窗口（半开区间） | 增量模式必需；SQL 中必须出现（校验项） |
| `{{cursor}}` / `{{upper}}` | 水位状态表 + 本次上界 | 与 `window_*` 等价，二选一命名，方案统一用 `window_start/window_end` |
| `{{batch_id}}` | 本次批次 | 若 SQL 未投影批次列，平台可额外注入 `'{{batch_id}}' AS _batch_id`（可配置） |
| `{{source_timezone}}` | 资源登记 | 连接级时区，禁止用户在 SQL 里改 |
| `{{limit}}` | 预览时 | 仅预览注入，**固定上限 1000**（用户不可调大）；正式执行不注入 LIMIT（靠资源与超时限额） |

注入实现：**文本替换限定在占位符 token 上**，替换值来自服务端白名单/格式化函数（时间戳按 `YYYY-MM-DD HH:MM:SS` 格式化，数字按整数），替换后再次校验"结果中不含未声明占位符"。

### 3.3 批次与清单（沿用现有契约，零改动下游）

执行完成后，worker 对每个表目录做一遍流式扫描：

```text
raw/<sourceCode>/<batchId>/<table>/data.jsonl      ← SeaTunnel 产出（或平台规范化后的产物）
raw/<sourceCode>/<batchId>/<table>/schema.json     ← 平台写：columns / primaryKey / scalarEncoding / sourceTimeZone
batches/<batchId>/batch.json                       ← 平台写：逐表 rows / bytes / sha256 + 窗口 + 清单哈希
```

- `rows` = JSONL 行数；`bytes` = 字节数；`sha256` = 文件摘要（三者同一次流式扫描得出）。
- 幂等键沿用现有实现：`<sourceCode>|<inventory_version>|<plan_hash>|<window>`；重复执行命中已有批次直接返回，不重复抽取。
- 失败：写 `batch.failed.json`（现有行为），错误码映射 SeaTunnel 状态（§5.9）。

## 4. 服务端校验与限额（放行 SQL 的唯一闸门）

**校验流水线（保存时 + 预览时 + 执行前各跑一遍）**

1. 词法/语法层：剥离注释后必须是**单条语句**；必须以 `SELECT` 或 `WITH` 开头；出现 `INSERT/UPDATE/DELETE/REPLACE/MERGE/DDL/CALL/LOAD/OUTFILE/INTO` 等一律拒绝。
2. 结构层：解析出的表名必须在**已批准表清单**内（来自该来源的批准清单版本）；禁止 `information_schema`/`mysql`/`performance_schema`/`sys`；禁止跨库（`db.table` 的 db 必须等于批准库）。
3. 参数层：SQL 中出现的占位符必须全部在已声明参数集合内；不得出现 `${` 形式的自由插值。
4. 语义层：增量模式下必须包含水位列投影与水位条件；全量模式必须在定义上显式标注（不允许"忘记写 WHERE"被当成全量）。**JOIN / UNION / CTE / 子查询 / 聚合一律允许**，受 §4.1 的粒度声明约束。
5. 结果层：所有投影列必须有**唯一别名的最终列名**（否则 ODS 列名不可确定）；列类型必须能映射到平台支持的类型集合；重复列名拒绝。
6. 限额层：`fetch_size` 上限、单作业超时、单表最大行数/字节、来源并发（资源 `maxParallel`）、预览强制 `LIMIT 1000`。
7. 粒度层：每个抽取必须声明 `粒度（业务含义）` 与 `唯一键`。简单投影可继承驱动表主键并自动带出；含 JOIN/GROUP BY/UNION 时必须**显式确认**（平台给出建议值，不确认不能启用）。

**执行侧硬约束**：只读账号（沿用现有角色边界，凭证只以引用下发）、每次执行为独立 SeaTunnel 作业、作业内 `parallelism=1`、超时到点记失败（取消见 §5.9 待确认项）。

### 4.1 查询构造策略（2026-09-17 决策：只读查询一律允许）

**允许**（不再限制）：`JOIN`（INNER/LEFT/RIGHT/FULL）、`UNION [ALL]`、CTE（`WITH`）、子查询、`GROUP BY`/聚合函数、窗口函数、`CASE`、表达式与函数、跨多张**已批准表**。理由：这些都在源库内以一条语句完成，InnoDB 单语句读一致性由数据库保证；把 JOIN 拆到平台侧反而更容易产生跨时点不一致。

**仍然禁止**（与"允许查询"不冲突，属安全与边界）：

| 禁止项 | 理由 |
|---|---|
| DDL / DML / 存储过程 / 多语句 | 只读账号 + 语句白名单；写风险与权限不可控 |
| 跨库、系统库（`information_schema`/`mysql`/`performance_schema`/`sys`） | 越出已批准的数据源边界 |
| `INTO OUTFILE` / `LOAD_FILE` 等副作用函数 | 绕过平台落湖通道 |
| 未声明的占位参数、请求参数拼接 | 注入面 |
| 自带 `LIMIT`（正式执行） | 会与平台限额叠加造成静默截断；限额由平台控制 |

**新增要求（不是禁止，是必须确认）**：

1. **粒度与唯一键声明**：含 JOIN / `GROUP BY` / `UNION` 时，平台给出建议值（简单投影=驱动表主键；JOIN=各表主键组合），**一键确认即通过**；不确认不能启用。这是为了满足平台既有的"模型必须定义粒度与唯一键"规则，而不是拦截查询。
2. **行数放大提示**：JOIN 可能产生 1:N 放大，登记时如实记录"结果行数不等于来源表行数"；与上一批次的行数差异超过阈值时按既有质量规则告警（不阻断）。
3. **增量模式下的水位条件**：`GROUP BY`/`UNION`/聚合结果没有天然水位列，因此**聚合或 UNION 的结果默认只允许全量模式**；JOIN 只有在水位条件作用于**驱动表**（并声明驱动表）时才允许增量，且必须在定义里显式确认"维度表更新不会被水位捕获，需靠周期性全量/对账补偿"。
4. **源库负载**：JOIN/聚合类查询必须走资源级限额（语句超时、最大行数/字节、允许执行时段），并在预检里给出行数估计与耗时，避免把报表级大查询压到生产库上。

## 5. 前端操作细节（逐个控件）

### 5.1 入口：接入向导的"来源模式"

路径：「接入管理」→ 选定实例 → **接入新来源** → 步骤 1「连接与采集规则」，在"已授权执行资源"之下新增一个分段控件：

```text
来源模式:   ( 表清单 )   ( 自定义 SQL )        ← 默认"表清单"，保持现有行为
```

- 选「表清单」= 现有界面（相对目录/表范围/交付方式…），MySQL 走既有实现。
- 选「自定义 SQL」= 该资源必须是 `MYSQL_SNAPSHOT` 类；下方原"表范围"替换为：

```text
┌─ SQL 定义 ────────────────────────────────────────────────┐
│  状态：草稿 v3   ·   最近保存 10:24   ·   [编辑 SQL]        │
│  预览：2026-09-17 10:20 · 100 行 · 43 ms · 已截断           │
│  列（6）：order_id(text) team(text) amount(numeric(20,2)) … │
│  参数：{{window_start}} {{window_end}}（平台注入）           │
│  [打开编辑器并预览]   [查看校验结果]                        │
└───────────────────────────────────────────────────────────┘
```

### 5.2 SQL 编辑器页（全屏抽屉，宽 ≥1100px）

```text
┌ 顶部：来源 test-erp / 连接 erp-orders（只读） · 库 erp（只读） · 时区 Asia/Shanghai ────────────┐
│  安全提示条：仅允许单条 SELECT；禁止 DDL/DML/多语句/跨库；已批准表 157 张                      │
├──────────────┬──────────────────────────────────────────────────────────────┬─────────────────┤
│ 左树（可搜索）│  ① 编辑器（语法高亮/行号/注释/格式化）                        │ 右栏：参数与限额 │
│ ▸ erp        │  1 SELECT o.id AS order_id, o.team AS team,                  │ 参数（自动识别） │
│   ▸ biz_order│  2        DATE_FORMAT(o.updated_at,'%Y-%m-%d %H:%i:%s')      │ {{window_start}}│
│     id (bigint)      │ AS updated_at,                                    │   类型: 时间     │
│     team(varchar)    │  3        '{{batch_id}}' AS batch_id                │ {{window_end}}  │
│     amount(decimal)  │  4   FROM biz_order o                               │   类型: 时间     │
│   ▸ order_item       │  5  WHERE o.updated_at > '{{window_start}}'         │ 限额            │
│                      │  6    AND o.updated_at <= '{{window_end}}'          │ 预览 LIMIT 1000 │
│   点击表/列→插入光标处│  7  ORDER BY o.updated_at, o.id                     │ 作业超时 3600s  │
│                      │                                                      │ fetch_size 1000 │
│                      │  [预览数据 Ctrl+Enter]  [格式化]  [清空]             │ 最大行数 5,000,000│
├──────────────┴──────────────────────────────────────────────────────────────┴─────────────────┤
│ ② 预览结果（网格）：列名 · 类型 · 遮罩标记 ；本页 1000 行 · 43 ms · 已截断（上限 1000）      │
│    order_id │ team │ amount            │ updated_at          │ batch_id                        │
│    1001     │ east │ 123456789012345.67 │ 2026-09-17 09:58:11 │ 20260917T015800Z                │
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ ③ 校验结果：[通过] 单条 SELECT · 表在批准清单 · 参数已声明 · 别名唯一 · 类型可映射             │
│            [警告] 未投影主键 id（增量对账需要）                                                │
│ 底部操作：[保存为新版本]  [保存并返回向导]                      主按钮：保存前必须预览过一次      │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

**交互细节（逐条）**

| 控件/操作 | 行为 |
|---|---|
| 左树搜索 | 按表名/列名过滤；只列**已批准清单**里的表与列（清单外的表不出现，手写也会在校验层被拒） |
| 点击表名 / 列名 | 在光标处插入 `` `table` `` / `` `table`.`column` ``（带反引号转义）；按住 `Alt` 点击插入为 `AS 别名` |
| 编辑器 | Monaco 类编辑器；MySQL 语法高亮；支持 `--`/`/* */` 注释；`Tab` 缩进；括号自动配对 |
| `Ctrl+Enter` | 触发预览（等价点击【预览数据】）；预览中按钮转 loading，可取消 |
| 参数栏 | 从 SQL 文本自动识别 `{{...}}`；未声明的自定义占位符 → 立刻标红并阻止保存；参数类型可改（时间/整数/文本），默认按名称推断 |
| 预览 | 强制注入 `LIMIT 1000`（UI 显示"已截断"；上限固定，用户不可调大）；显示列名、类型、脱敏标记、耗时、估计总行数（若可廉价获得，否则不显示估计值，禁止瞎猜） |
| 预览审计 | 每次预览都写审计：身份、来源、SQL 版本哈希、返回行数、耗时、requestId |
| 脱敏 | 命中脱敏规则的列在预览里以 `138****0000` 形式显示，并在列头标 `遮罩`；网格不可复制原始值（复制走审计接口） |
| 保存 | 仅在"校验通过 + 至少一次成功预览"后可用；保存即产生**新 SQL 版本**（不可变），旧版本只读保留 |
| 保存后 | 自动回到向导步骤 2（测试与发现），触发一次"试跑预检" |
| 快捷键 | `Ctrl+S` 保存、`Ctrl+Enter` 预览、`Ctrl+/` 注释、`Esc` 关闭（有未保存改动时二次确认） |
| 错误呈现 | 编辑器内联波浪线 + 底部问题列表（行号可点击跳转）；服务端错误显示中文说明 + 错误码 + `requestId` |

### 5.3 保存前校验清单与文案

| 校验项 | 触发条件 | 提示文案 | 级别 |
|---|---|---|---|
| 单语句 | 出现 `;` 分隔的多条语句 | 只能有一条查询语句 | 阻断 |
| 只读 | 出现 DDL/DML/`INTO OUTFILE`/`LOAD_FILE`/存储过程 | 只允许查询（SELECT）；写入、改结构与导出文件都不允许 | 阻断 |
| 批准表 | 引用了清单外的表 | 表 `xxx` 不在已批准清单内；请先完成预检并确认范围 | 阻断 |
| 跨库/系统库 | `db.table` 的库不等于批准库，或引用系统库 | 不允许跨库或访问系统库 | 阻断 |
| 参数声明 | SQL 里有未声明占位符 | 未声明的参数 `{{x}}`；可用参数：`{{window_start}}`… | 阻断 |
| 水位条件 | 增量计划下缺水位列或水位条件 | 增量模式必须包含水位条件：`> {{window_start}} AND <= {{window_end}}` | 阻断 |
| 别名唯一 | 结果列名重复或缺失 | 第 N 列与第 M 列重名；请为每列指定唯一别名 | 阻断 |
| 类型可映射 | 出现平台不支持的类型 | 列 `x` 的类型 `geometry` 暂不支持 | 阻断 |
| 主键未投影 | 清单里有主键但结果未包含 | 未包含主键 `id`，增量对账与去重将受限 | 警告 |
| 无 `LIMIT` | 正式执行 SQL 自带 `LIMIT` | 正式执行不应自带 `LIMIT`；限额由平台控制 | 警告 |
| 粒度未确认 | 含 JOIN / `GROUP BY` / `UNION` 且未确认粒度与唯一键 | 检测到多表/聚合查询；请确认粒度与唯一键（已给出建议值，一键采用） | 阻断（可一键确认） |
| 聚合 + 增量 | 含 `GROUP BY`/聚合/`UNION` 且选了水位增量 | 聚合结果没有天然水位列；请改用全量快照，或说明如何按驱动表对账 | 阻断 |
| JOIN + 增量未声明驱动表 | 含 JOIN 且增量模式未指定驱动表 | JOIN 增量只能按驱动表捕获变化；维度表更新不会被水位发现，需周期性全量或对账补偿。请选择驱动表并确认 | 阻断（可一键确认） |
| JOIN 行数放大 | 含 JOIN 且本批次行数显著高于来源表行数 | 本批次 N 行（来源表约 M 行）：JOIN 可能放大了行数，请确认粒度 | 警告 |

### 5.4 步骤 2「测试与发现」在 SQL 模式下的展示

```text
状态：● 试跑完成（SeaTunnel 作业 20260917T…，耗时 6.2 s）
发现：1 个结果对象 · 6 列 · 抽样 1000 行 · 读取字节 1.2 MB（试跑限额内）
列清单：order_id text · team text · amount numeric(20,2) · updated_at timestamp · batch_id text
校验：类型全部可映射 · 结构哈希 a1b2c3…（与上次清单一致 / 首次记录）
[修改 SQL]  [重新试跑]  →  [设置交付计划]
```

失败时给出可读原因与建议（不是原始堆栈）：连接失败 / 账号权限不足 / 语法错误 / 超时 / 超出限额 / 类型不支持 / 水位列缺失。

### 5.5 步骤 3「交付计划」在 SQL 模式下的增量配置

```text
业务时区  Asia/Shanghai（只读）
开始日期  2026-09-18      每日执行时间 08:00      迟到等待天数 7
抽取模式  ( 全量快照 )  ( 水位增量 )        ← SQL 模式新增
   └ 选水位增量时：
      水位列        [updated_at ▾]（来自结果列，必选）
      上界来源      ( 计划窗口结束时间 )  ( 数据库当前时间 )
      重叠回读      5 分钟（用于抵消时间回拨与边界丢数；默认 0，需显式设置）
      对账策略      每周日抽样 1%（可选，见 43 号 §3.2）
[确认范围并启用]
```

### 5.6 版本与变更（DiffView）

修改已启用 SQL 时进入"确认变更"页：

```text
┌ 变更摘要 ────────────────────────────────────────────────┐
│ SQL  v3 → v4   （+2 行 / -1 行，行级 diff 高亮）           │
│ 列差异：+ discount(decimal(10,2))   ~ amount 改为别名 total│
│          未变：order_id team updated_at batch_id           │
│ 影响：下游数据集 1 个（每日订单）· 质量规则 2 条引用 amount │
│ 影响：行条件授权 1 条引用 team                             │
│ 需要重新预检：是（表/列发生变化）                          │
└───────────────────────────────────────────────────────────┘
变更原因 [必填]                     [取消]  [保存新版本并重新预检]
```

### 5.7 运行中心与数据预览

- 运行中心：SQL 模式的执行详情显示「SQL 版本」「SeaTunnel 作业 ID」「窗口」「读取行数/字节」「试跑 vs 正式」，并提供重试（同窗口幂等 → 复用结果）与取消（见 §5.9）。
- 资产详情新增「数据预览」页签（对应 43 号 §3.7）：列头显示 `标准列名（SQL 别名）` + 类型 + 遮罩标记；工具栏显示抽样条件、行数、时间、**是否截断**。

### 5.8 权限与审计

| 动作 | 最低角色 | 说明 |
|---|---|---|
| 查看 SQL 定义 | ENGINEER | 只读；敏感连接信息永不下发前端 |
| 创建/编辑 SQL 草稿 | ENGINEER | 可预览（受脱敏与限额约束） |
| **预览数据** | **ENGINEER 可直接预览**（2026-09-17 用户决定） | 强制 `LIMIT 1000`、脱敏列遮罩、每次写预览审计；原始 RAW 列同规则 |
| 启用/切换 SQL 版本 | OWNER 或平台管理员 | **必须填写原因**；默认**不要求第二个身份评审**（决策见 §5.8.1） |
| 查看审计 | 平台管理员 | 查询审计与预览审计分开记录 |

#### 5.8.1 关于"四眼原则"的决策（AI 代定，可复核）

**默认不做强制双人评审**，理由：当前是两人内部使用、只读账号、无写入风险、变更已有 DiffView + 影响面 + 必填原因 + 全量审计；强推四眼会把日常接入拖成审批流，收益低于成本。同时保留升级路径：

- 计划、资源边界、连接凭证、脱敏规则等**高危变更**仍由平台管理员执行（现有边界不变）；
- 提供可配置开关 `SQL_VERSION_REQUIRE_REVIEW`（默认关），需要合规时打开即可，届时不改代码只改配置；
- "启用"动作本身必须由 OWNER/平台管理员执行并写审计，仍然杜绝"谁都能上生产口径"。
| 查看审计 | 平台管理员 | 查询审计与预览审计分开记录 |

### 5.9 错误与状态映射（前端文案）

| SeaTunnel/平台状态 | 前端文案 | 是否可重试 |
|---|---|---|
| 提交失败（引擎不可用） | 执行引擎暂不可用，请稍后重试（`SEATUNNEL_UNAVAILABLE`） | 是 |
| 作业 FAILED + 源连接错误 | 无法连接业务库；请检查网络与只读账号授权 | 是（修配置后） |
| 作业 FAILED + SQL 语法 | SQL 语法错误：`<原始信息摘要>` | 否（改 SQL） |
| 作业 FAILED + 超时 | 执行超过限额（3600 s）；可缩小范围或调整执行时间 | 是 |
| 作业 FAILED + 超过最大行数/字节 | 结果超过本次预算（N 行 / M 字节） | 是 |
| 取消请求 | 已请求取消（`POST /hazelcast/rest/maps/stop-job`，实测可用且不残留半成品） | —— |
| 产出校验失败 | 产出与清单不一致（`RAW_INTEGRITY_MISMATCH`），已拒绝登记 | 是 |

### 5.10 前端需要的接口（草案，需与后端确认）

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/warehouse/projects/{p}/channels/{source}/sql-drafts` | 保存草稿（返回 `draftId`、版本号） |
| `POST` | `/warehouse/projects/{p}/sql-drafts/{id}/validate` | 静态校验（返回问题列表：级别/行号/文案/错误码） |
| `POST` | `/warehouse/projects/{p}/sql-drafts/{id}/preview` | 试跑预览（强制 LIMIT、脱敏、写审计） |
| `GET` | `/warehouse/projects/{p}/sql-drafts/{id}/columns` | 预览结果的列名/类型/遮罩标记 |
| `POST` | `/warehouse/projects/{p}/channels/{source}/sql-versions` | 定版（不可变），返回 `sqlVersionId` |
| `GET` | `/warehouse/projects/{p}/channels/{source}/sql-versions` | 版本列表 |
| `GET` | `/warehouse/projects/{p}/sql-versions/{id}/diff?against={other}` | DiffView 数据（SQL + 列 + 影响面） |
| `GET` | `/warehouse/projects/{p}/sources/{source}/approved-tables` | 左树数据（已批准表/列/类型） |

请求/响应示意（预览）：

```json
POST /warehouse/projects/1/sql-drafts/12/preview
{"sqlVersionHash":"a1b2…","limit":1000}
→ 200 {"columns":[{"name":"order_id","type":"text","masked":false},
                  {"name":"amount","type":"numeric(20,2)","masked":true}],
        "rows":[["1001","east","138****0000"]],
        "rowCount":1000,"truncated":true,"elapsedMs":43,
        "requestId":"8f1c…"}
```

## 6. 数据模型（迁移草案 V027+，仅草案）

- `warehouse.extraction_sql_draft`：草稿（来源、SQL 文本、文本哈希、参数声明、创建人、更新时间）。
- `warehouse.extraction_sql_version`：不可变版本（版本号、SQL 文本或受控存储引用、参数、校验结果、评审人、启用时间、原因）。
- `warehouse.seatunnel_job`：执行映射（批次、来源、表或结果对象、SeaTunnel `jobId`、提交/结束时间、状态、错误码、读取行数/字节）。
- `lake.object_watermark`：水位状态（上次成功水位、重叠窗口、对账结果、依据与负责人）——与 43 号方案共用。
- `warehouse.preview_audit`：预览与试跑审计（身份、来源、SQL 版本、行数、耗时、requestId、是否截断）。

原则不变：追加迁移、显式执行、可前向修复、不自动改 Schema、不 DROP、不复用编码。

## 7. 分期落地

| 阶段 | 交付 | 验收（可复现，含反例） |
|---|---|---|
| ~~P0-a 尖峰~~ **已完成 2026-09-17** | SeaTunnel 容器接线 + 文件 sink / 类型保真 / 取消 / 并发实测 | ✅ 见 §1 结论表与 [`poc/seatunnel-sql/`](../poc/seatunnel-sql/README.md)：JSONL 直出、`CAST` 保精度、`stop-job` 可用、2 作业并发；**遗留**：CPU 密集型并发与容量未测 |
| **P0-b SQL 定义 + 全量执行** | 编辑器 + 校验 + 预览 + 版本 + SeaTunnel 单表全量抽取 → 落 RAW → 登记资产 | 拒绝 DDL/DML/多语句/越库/未声明参数/重名列；预览强制 LIMIT 且写审计；同窗口重复执行幂等；产出哈希与清单一致 |
| **P0-c 增量水位** | `WHERE window_start/window_end` 注入 + 水位状态 + 重叠回读 | 半开窗口不重不漏；水位回拨/补数/迟到三组边界；跨日连续；重复执行复用结果 |
| **P1-a 变更与影响** | DiffView + 列契约联动 + 影响面 | 改别名的下游契约与授权显式跟随；旧版本只读保留；回放可用 |
| **P1-b 失败与取消完善** | 取消接口（实测后）、错误映射、限额告警 | 取消后不登记资产；限额超限明确拒绝 |
| **P2** | 多表 SQL（一条 SQL 多个结果对象）、对账策略 | 需另评审：多结果对象与清单粒度的关系 |

## 8. 风险与待决问题

1. **文件 sink 形态**（§1 待确认表第一项）决定 P0-b 的工期：若不能直接产出 JSONL，需平台做单遍规范化（可接受，但要在验收里覆盖"规范化后哈希与清单一致"）。
2. **SeaTunnel 成为单点**：引擎不可用时 SQL 模式无法执行。需要：引擎健康检查进"环境与 Worker"页、失败快速反馈、表清单模式可回落（同一来源两种模式**二选一**，不允许自动回落，以免语义漂移）。
3. **资源与故障域扩大**：新增容器（内存/并发/日志轮转），必须纳入现有运维与备份说明。
4. **SQL 评审责任**未定：谁启用、是否要求第二个身份评审（见 §5.8）。
5. **JOIN 与聚合的语义风险（允许，但需治理）**：查询本身不再限制；风险转移到"结果粒度与增量正确性"，靠 §4.1 的粒度声明、增量驱动表确认、行数放大告警与周期性对账覆盖。**需要业务侧确认**：哪些抽取允许聚合、哪些 JOIN 属于"维度表会变"的情况。
6. **许可复核**：SeaTunnel Apache-2.0、镜像 2.3.13 已锁；接回前按治理流程补 SBOM/CVE/NOTICE（[09 号文档](09-engineering-governance.md)）。

## 9. 已确认的决定与剩余待定（2026-09-17）

**用户已确认**

1. **执行层**：接回 SeaTunnel（新增 `seatunnel` 服务；worker 只提交任务与校验产物）。
2. **查询范围**：**只读查询一律允许**，包括 JOIN/UNION/CTE/子查询/聚合；不再禁止 JOIN。保留"禁写、禁 DDL/DML、禁跨库与系统库、禁多语句、禁自带 LIMIT"。
3. **预览上限**：前端预览固定 `LIMIT 1000`，用户不可调大。
4. **预览权限**：ENGINEER **可直接预览**（脱敏列遮罩 + 每次审计）。
5. **多数据源**：需要设计多数据源场景，参考 DataEase 的数据源模型，**先实现 MySQL**；设计见 [46 号多数据源设计](46-multi-datasource-design.md)。

**AI 代定（可复核）**

6. **不强制四眼评审**：启用 SQL 版本由 OWNER/平台管理员执行并写原因/审计，另提供 `SQL_VERSION_REQUIRE_REVIEW` 配置开关，默认关闭（理由见 §5.8.1）。

**仍然待定（影响 P0-b 排期）**

- 首期是否同时支持"多结果对象"（一条 SQL 产出多个对象）→ 建议 P2。
- 脱敏规则的初始清单（哪些列必遮）由谁维护。
- 源库允许执行时段与并发上限（需要业务/运维给出窗口）。
- 多数据源的目标类型顺序（见 46 号 §7）。
