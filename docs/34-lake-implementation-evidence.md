# 入湖实现与实际验收记录

> 记录日期：2026-09-15。这里区分已经在本机运行的结果、合成验证和仍需外部配置的部分；本文件不保存源凭证、业务明细或原始数据。

> **历史记录，完成结论已被复核修正。** 2026-09-16 复核发现重跑、编码、登记权限和发布一致性问题，已分批修复；下面的测试数量和实现判断只代表当时记录。当前修复及实际完成状态见 [35 号复核记录](35-lake-review-and-remediation.md)，完整产品仍在按 30/31/33 号文档开发。

## 已实现的本地能力

| 能力 | 实现入口 | 结果 |
|---|---|---|
| MySQL 整库原始快照 | `tools/lake-ingest.mjs --full` | 单个 `REPEATABLE READ` 一致性事务；按已发现清单读取全部基础表；Schema、JSONL、行数、字节数和 SHA-256 清单原子封存 |
| 每日数据库窗口 | `tools/lake-ingest.mjs --daily --window YYYY-MM-DD` | `daily-ledger.json` 去重；同一窗口成功后重复触发复用原批次；失败不推进成功窗口 |
| 每日文件目录 | `tools/file-ingest.mjs`、`tools/file-parser.py` | 目录与传输工具解耦；`.done` 或显式就绪；原件先封存；CSV、XLSX、JSON、JSONL、Parquet 解析；失败/等待/重复分别记录 |
| REST API | `tools/rest-ingest.mjs` | 仅 GET、HTTPS/本机模拟白名单、认证环境变量引用、分页上界、next-link 同域校验、429/5xx 退避、原响应与规范化 JSONL 分开留存 |
| 模型、质量、发布 | `tools/lake-model.mjs` | 版本化 JSON 契约、键唯一性、必填非空、坏行计数；候选通过后原子切换 `active.json`，质量失败保留旧版本 |
| 每日编排 | `tools/lake-daily.mjs` | 单实例锁、数据库/文件/API 顺序执行、窗口结果账本、失败与不完整状态显式返回 |
| 控制查询和控制台 | `apps/control-api/.../LakeController.java`、`apps/console/index.html` | 提供摘要、运行、交付账本只读接口；静态页面不保存令牌、不执行 SQL |

## 真实测试源结果

用户已授权该测试源使用“强制 TLS、跳过服务器证书身份校验”的例外。授权绑定本地连接配置摘要，默认严格 TLS 仍保留；读取器设置会话只读并在结束时回滚。

修复最终清单落盘门禁后，真实全量批次 `full-fixed3-20260915` 验收如下：

- 状态 `COMPLETE`，一致性标记 `ONE_REPEATABLE_READ_TRANSACTION`。
- 固定清单 157 张表全部提交，原始目录 157 个。
- 实际读取 1,617,565 行、765,352,734 字节。
- 逐表行数、字节数和 SHA-256 与 manifest 全部匹配；无未提交对象。

每日入口 `--daily --window 2026-09-15` 生成批次 `daily-20260915152542-11413b1d`，157 张表同样完整。再次执行同一窗口返回 `reused: true`，未创建第二个成功批次；账本记录窗口、批次和表数。

## 其他验收证据

- 使用真实样例验证 CSV、双工作表 XLSX、JSON、JSONL 和 Parquet 目录解析；JSON 对象包络可通过 `--json-records-path` 显式展开。解析器固定 `openpyxl==3.1.5`、`pyarrow==18.1.0`，依赖由清华 PyPI 镜像安装并记录在 `tools/requirements-lake.txt`。目录入口默认限制单文件 1 GiB、解析 1,000 万行，可通过受控参数收紧，超限进入失败状态。
- REST 测试服务验证 429 重试、分页短页终止、响应原文留存、认证头不进入 manifest，以及跨域/秘密查询参数拒绝。
- 以真实 `VERSION` 表快照构建 `version_snapshot` 候选数据集：295 行，键重复数和必填缺失数均为 0，候选已发布；随后单元测试验证重复键会拒绝新版本并保留旧活动指针。
- Java 控制 API 离线 Maven 测试通过 50 项，Worker 测试通过 8 项；仓库 Node 测试共 74 项通过，其中入湖、每日、模型、文件、注册器、API、账本幂等和本地控制台跨域配置测试均通过；脚本语法检查通过。

## 运行与恢复入口

```bash
# 首次整库（测试源的例外必须显式提供）
node tools/lake-ingest.mjs --full --allow-unverified-test-tls

# 每日数据库窗口
node tools/lake-ingest.mjs --daily --window 2026-09-15 --allow-unverified-test-tls

# 每日编排：目录由外部传输工具填充，文件以 .done 闭合
node tools/lake-daily.mjs --window 2026-09-15 --inbox /data/inbox/source \
  --allow-unverified-test-tls

# 控制 API 启动后，登记清单和批次 manifest（Admin/Worker Token 只从环境读取）
node tools/lake-register.mjs --control-api http://127.0.0.1:8080 \
  --inventory work/lake-foundation/initial-full-snapshot-plan.json \
  --manifest .lake-data/batches/<batch-id>/batch.json

# 质量失败只生成 REJECTED 候选，不移动 active.json；模板中的批次占位符需替换为实际批次
node tools/lake-model.mjs --contract /path/to/versioned-model-contract.json
```

进程终止或解析失败时，暂存文件和失败 manifest 保留；每日窗口账本只有在全部必需数据库对象完成后才写入 `COMPLETE`。重新运行使用新的批次 ID；旧完整批次和失败尝试不覆盖。PostgreSQL 的 `migrations/V009__lake_foundation.sql` 为控制面提供清单、运行、对象、交付账本和原始引用表，`V010__lake_role_boundaries.sql` 允许管理员 API 登记清单、允许只读查询，并给 Worker 最小的运行证据追加权限。

## 尚未声称完成的范围

- 尚未把真实外部文件目录路径或真实 REST API 配置交给系统，因此实际文件日交付和真实 API 端点仍待配置；两条通用链路已用本地样例/模拟服务验收。
- 当前只验证了一个实际窗口和同窗口幂等，未把连续多个自然日运行结果冒充为长期跨日稳定性。
- 本地 Docker Compose、备份还原和跨机器/NAS 部署尚未在本次运行中启动；不覆盖用户既有容器、卷或远程环境。
- `lake.*` 元数据迁移、清单/manifest 登记接口和只读查询接口已实现；本次真实运行因本机 Docker daemon 未启动，没有把本地 manifest 回写 PostgreSQL。下一步运行控制 API 后由注册器按同一提交协议登记引用。
