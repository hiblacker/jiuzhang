# 本机运行与联合备份

本机路径优先复用既有 Java、Node、Python、MySQL 客户端与 PostgreSQL，不自动安装或升级工具。当前验证版本见[实现记录](../docs/36-product-implementation-progress.md)及[模型运行依赖](../apps/model-worker/runtime-lock.json)。Compose 的镜像验证与本机原生运行分开记录。

## 启停

将[运行清单](../docs/templates/local-stack.example.json)保存到忽略目录 `secrets/`，填写本机绝对路径。JSON 清单是管理员维护的本机配置；命令按参数数组启动，不经 shell，也不由 HTTP 接收。`envRefs` 从单独的私有 JSON 文件读取凭证；日志和 PID 记录仅写入指定 `stateRoot`。不要在命令参数中填密码。

```bash
python3 tools/local-stack.py start --config secrets/local-stack.local.json
python3 tools/local-stack.py status --config secrets/local-stack.local.json
python3 tools/local-stack.py stop --config secrets/local-stack.local.json
```

启动顺序为 PostgreSQL、控制 API、控制台、接入 Worker、模型 Worker；停机反序。仅停止 PID 和启动身份仍与本工具记录匹配的进程，避免误杀重用 PID。API 与控制台必须通过 HTTP 探活。默认监听本机回环；湖区和数据库目录须位于持久磁盘。

`LAKE_CALENDAR_DRIVER=local` 由单一本地日历驱动。使用 DolphinScheduler 等外部驱动时改为 `external`，通过已认证的 `/api/v1/lake/calendar/reconcile` 触发，不同时启用两者。重复触发由持久窗口去重。管理令牌在页面输入，不持久化到浏览器存储。

此脚本管理已初始化的 PostgreSQL，不自动改生产 Schema。新环境先按[迁移入口](README.md)初始化和显式执行迁移；已有环境只追加新迁移，校验失败必须停止。当前本机数据库迁移账本与 SQL 文件保持校验和一致。

## 联合冷备份

冷备份会短暂停止本机应用及 PostgreSQL。它保存整个数据库集群、湖区（含文件/API 账本、原件、模型工作目录、outbox）和模型 Git 对象。只接受正常运行且由本工具管理的栈，禁止覆盖目标、符号链接或外部表空间；额外模型仓库通过 `modelRepositories` 列入清单。备份权限为目录 0700、文件 0600。

```bash
python3 tools/local-stack.py backup --config secrets/local-stack.local.json \
  --destination work/backups/warehouse-backup-01
python3 tools/local-stack.py verify --backup work/backups/warehouse-backup-01
python3 tools/local-stack.py restore --backup work/backups/warehouse-backup-01 \
  --destination work/restored/warehouse-restore-01
```

备份停止所有配置的写入服务后才停数据库，复制完成逐文件计算 SHA-256，再封存完整清单；无论复制成功或失败都尝试恢复原服务。失败目录保留诊断，未封存清单不能恢复。复制文件与清单执行 fsync。恢复先核验缺失、额外文件、大小和哈希；只能写入新目录，不覆盖现有数据库或原始区。

恢复默认离线，不会启动源库采集。用**相同 PostgreSQL 主版本和兼容平台**启动恢复库，指定新的回环端口和 socket 路径；复核迁移、项目权限、资产数量、发布指针及候选数据。然后复制运行配置到单独私有文件，将 PostgreSQL 数据目录和湖区指向恢复目录，先验证查询，再启用 Worker。大版本升级使用专门升级流程，不直接打开物理备份。

私有运行配置与明文凭证不进备份；恢复时从独立密钥备份恢复，或重新签发后更新引用。物理数据库包含身份令牌摘要与数据库认证信息，备份按业务数据保护。不得把本机备份上传到公开仓库。

## 故障定位

- 原件封存后控制 API 暂时不可用：Worker outbox 重送相同回执；旧租约回执不能覆盖新执行。
- 文件未齐/目录不可用：保留状态，按 `pollSeconds` 再检查，到 `lateDays` 窗口结束后保留未完成状态等待处置。
- 解析规则错误：修正规则后点击“重解析原件”，不要求外部重新交付。
- MySQL 快照中断：重新读取新的完整快照，失败分片保留；不能拼接不同事务形成假快照。
- 数据集构建失败：活动 release 不变；修正 Git 模型后生成新的候选，通过质量检查再发布。
- 磁盘满：停止新增采集、检查剩余空间和失败记录。此工具不会自动删除原件、备份或日志。
